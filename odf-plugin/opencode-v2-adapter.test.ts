import { afterEach, describe, expect, it, vi } from "vitest"
import { ODF_REGISTERED_TOOLS } from "./odf-delegation-shared.js"
import { ODF_SYSTEM_RULES } from "../plugins/odf-delegation.js"
import { invokeTask } from "../plugins/odf-delegation.js"
import { createV2SessionTaskApi, findTaskApi } from "./odf-delegation-health.js"
import { ODF_ENTRY_HEALTH_REASON } from "./odf-delegation-loopguard.js"
import { OdfDelegationPluginV2, createV2ToolContext, detectOdfNewEntry, loadOdfNewCommandBody, setupODFV2 } from "./opencode-v2-adapter.js"

function testContext() {
  const tools: any[] = []
  const hooks: Array<{ domain: string; name: string; callback: (input: any) => Promise<void> }> = []
  const disposers: ReturnType<typeof vi.fn>[] = []
  let subscribedSignal: AbortSignal | undefined

  const registration = () => {
    const dispose = vi.fn(async () => undefined)
    disposers.push(dispose)
    return { dispose }
  }

  const context = {
    location: { directory: process.cwd() },
    tool: {
      transform: async (callback: (editor: { add: (tool: any) => void }) => void) => {
        callback({ add: tool => tools.push(tool) })
        return registration()
      },
      hook: async (name: string, callback: (input: any) => Promise<void>) => {
        hooks.push({ domain: "tool", name, callback })
        return registration()
      },
    },
    session: {
      hook: async (name: string, callback: (input: any) => Promise<void>) => {
        hooks.push({ domain: "session", name, callback })
        return registration()
      },
      get: vi.fn(async () => ({ agent: "odoo_orchestrator" })),
      create: vi.fn(async () => ({ id: "child-session" })),
      prompt: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      context: vi.fn(async () => []),
      interrupt: vi.fn(async () => undefined),
    },
    event: {
      subscribe: vi.fn(({ signal }: { signal: AbortSignal }) => {
        subscribedSignal = signal
        return {
          async *[Symbol.asyncIterator]() {
            await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }))
          },
        }
      }),
    },
  }

  return { context, tools, hooks, disposers, get eventSignal() { return subscribedSignal } }
}

function taskContext() {
  return {
    sessionID: "parent-session",
    messageID: "message",
    agent: "odoo_orchestrator",
    signal: new AbortController().signal,
    progress: vi.fn(async () => undefined),
  }
}

function v2Session(contextResponse: unknown = [{ type: "assistant", content: [{ type: "text", text: '{"status":"ok"}' }] }]) {
  return {
    create: vi.fn(async () => ({ id: "child-session" })),
    get: vi.fn(async () => ({ model: { providerID: "provider", id: "model" } })),
    prompt: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    context: vi.fn(async () => contextResponse),
    interrupt: vi.fn(async () => undefined),
  }
}

describe("OpenCode V2 ODF adapter", () => {
  afterEach(() => vi.restoreAllMocks())

  it("defines the stable V2 plugin and registers every ODF tool exactly once", async () => {
    const fixture = testContext()
    expect(OdfDelegationPluginV2).toMatchObject({ id: "odf-delegation" })
    expect(OdfDelegationPluginV2).toHaveProperty("setup")
    expect(OdfDelegationPluginV2).not.toHaveProperty("server")

    const cleanup = await setupODFV2(fixture.context as any)
    expect(fixture.tools).toHaveLength(ODF_REGISTERED_TOOLS.length)
    expect(fixture.tools.map(tool => tool.name)).toEqual([...ODF_REGISTERED_TOOLS])
    await cleanup()
  })

  it("uses JSON Schema and preserves V1 validation plus result output", async () => {
    const fixture = testContext()
    const cleanup = await setupODFV2(fixture.context as any)
    const route = fixture.tools.find(tool => tool.name === "odf_workflow_advance")

    expect(route.input).toMatchObject({ type: "object", additionalProperties: false })
    await expect(route.execute({ work_type: "not-a-work-type" }, {} as any)).rejects.toThrow()

    const result = await route.execute({
      work_type: "feature",
      completed_stages: ["DECIDE", "PLAN"],
      candidate_stage: "BUILD",
      phase_result_status: "ok",
      validation_status: "verified",
      receipt_state: "resolved",
      resumable_state: true,
      archived_state: false,
    }, {
      sessionID: "session",
      messageID: "message",
      agent: "odoo_orchestrator",
      signal: new AbortController().signal,
      progress: vi.fn(async () => undefined),
    })
    expect(result.content).toContain('"status": "advanced"')
    await cleanup()
  })

  it("maps V2 tool/session hooks and context injection", async () => {
    const fixture = testContext()
    const cleanup = await setupODFV2(fixture.context as any)
    const contextHook = fixture.hooks.find(hook => hook.domain === "session" && hook.name === "context")
    const promptHook = fixture.hooks.find(hook => hook.domain === "session" && hook.name === "prompt")
    expect(fixture.hooks.map(hook => `${hook.domain}.${hook.name}`)).toEqual(expect.arrayContaining([
      "tool.execute.before",
      "tool.execute.after",
      "session.context",
      "session.prompt",
    ]))

    const modelContext = { system: [] as Array<{ type: "text"; text: string }> }
    await contextHook!.callback(modelContext)
    expect(modelContext.system).toEqual([{ type: "text", text: ODF_SYSTEM_RULES }])
    await promptHook!.callback({
      sessionID: "session",
      messageID: "message",
      prompt: { text: "/odf-new sample-change" },
    })
    expect(fixture.context.session.get).toHaveBeenCalledWith({ sessionID: "session" })
    await cleanup()
  })

  it("injects the one-shot context pressure notice through the V2 context hook", async () => {
    const previous = process.env.ODF_CONTEXT_WARN_TOKENS
    process.env.ODF_CONTEXT_WARN_TOKENS = "1000"
    try {
      const fixture = testContext()
      const cleanup = await setupODFV2(fixture.context as any)
      const contextHook = fixture.hooks.find(hook => hook.domain === "session" && hook.name === "context")!
      const promptHook = fixture.hooks.find(hook => hook.domain === "session" && hook.name === "prompt")!
      const afterHook = fixture.hooks.find(hook => hook.domain === "tool" && hook.name === "execute.after")!

      // V2 replaces V1's chat.message seam with the prompt hook.
      await promptHook.callback({ sessionID: "s1", messageID: "m1", prompt: { text: "go" } })
      // Cross the threshold with a large tool result.
      await afterHook.callback({
        tool: "read",
        sessionID: "s1",
        id: "c1",
        input: { filePath: "a" },
        status: "completed",
        result: { output: "y".repeat(20_000), metadata: {} },
      })

      const first: { system: Array<{ type: "text"; text: string }>; sessionID?: string } = { system: [], sessionID: "s1" }
      await contextHook.callback(first as any)
      expect(first.system.map(part => part.text).join("\n")).toContain("<odf-context-pressure>")

      const second: { system: Array<{ type: "text"; text: string }>; sessionID?: string } = { system: [], sessionID: "s1" }
      await contextHook.callback(second as any)
      expect(second.system.map(part => part.text).join("\n")).not.toContain("<odf-context-pressure>")

      await cleanup()
    } finally {
      if (previous === undefined) delete process.env.ODF_CONTEXT_WARN_TOKENS
      else process.env.ODF_CONTEXT_WARN_TOKENS = previous
    }
  })

  it("disposes hook registrations and the event subscription", async () => {
    const fixture = testContext()
    const cleanup = await setupODFV2(fixture.context as any)
    await cleanup()
    expect(fixture.disposers).toHaveLength(5)
    expect(fixture.disposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
    expect(fixture.eventSignal?.aborted).toBe(true)
  })

  it("bridges V2 session delegation through the shared TaskApi boundary", async () => {
    const session = v2Session()
    const bridge = createV2ToolContext(taskContext() as any, "/tmp/odf-project", session as any)

    expect(findTaskApi(bridge as any)).toMatchObject({ source: "toolCtx.task" })
    await expect(bridge.task({
      agent: "odoo_qa_engineer",
      prompt: "Return the requested ODF result.",
      context_files: ["README.md"],
    })).resolves.toEqual({ status: "ok" })
    expect(session.get).toHaveBeenCalledWith({ sessionID: "parent-session" })
    expect(session.create).toHaveBeenCalledWith({
      agent: "odoo_qa_engineer",
      model: { providerID: "provider", id: "model" },
      location: { directory: "/tmp/odf-project" },
    })
    expect(session.prompt).toHaveBeenCalledWith({
      sessionID: "child-session",
      text: expect.stringContaining("README.md"),
    })
    expect(session.wait).toHaveBeenCalledWith({ sessionID: "child-session" })
    expect(session.context).toHaveBeenCalledWith({ sessionID: "child-session" })
  })

  it("creates the V2 child session in the requested directory, and in the host session's by default", async () => {
    // context_files are validated relative paths: they only resolve when the child
    // works in the same root, so the workspace root has to reach session.create.
    const explicit = v2Session()
    await createV2SessionTaskApi(taskContext() as any, explicit as any)({
      agent: "odoo_qa_engineer",
      prompt: "work",
      directory: "/workspace/root",
    })
    expect(explicit.create).toHaveBeenCalledWith(expect.objectContaining({
      location: { directory: "/workspace/root" },
    }))

    // No directory given: unchanged behaviour, the host session's own directory.
    const fallback = v2Session()
    await createV2SessionTaskApi({ ...taskContext(), directory: "/host/session" } as any, fallback as any)({
      agent: "odoo_qa_engineer",
      prompt: "work",
    })
    expect(fallback.create).toHaveBeenCalledWith(expect.objectContaining({
      location: { directory: "/host/session" },
    }))
  })

  it("keeps the workspace root on the task api that findTaskApi hands back", async () => {
    const session = v2Session()
    const bridge = createV2SessionTaskApi({ ...taskContext(), directory: "/host/session" } as any, session as any)
    const resolved = findTaskApi({ ...taskContext(), directory: "/host/session", task: bridge } as any, undefined)

    await resolved!.taskApi({ agent: "odoo_qa_engineer", prompt: "work", directory: "/workspace/root" })

    expect(session.create).toHaveBeenCalledWith(expect.objectContaining({
      location: { directory: "/workspace/root" },
    }))
  })

  it("aborts the V2 child session for explicit cancellation", async () => {
    const session = v2Session()
    let rejectPrompt: ((error: Error) => void) | undefined
    session.prompt.mockImplementation(() => new Promise((_, reject) => { rejectPrompt = reject }))
    const task = createV2SessionTaskApi(taskContext() as any, session as any)
    const invocation = task({ agent: "odoo_qa_engineer", prompt: "wait" })
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalled())

    await task.abort?.(invocation)
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "child-session" })
    rejectPrompt?.(new Error("aborted by user"))
    await expect(invocation).rejects.toThrow("task-cancelled")
  })

  it("aborts the V2 child session when the shared timeout expires", async () => {
    const session = v2Session()
    session.prompt.mockImplementation(() => new Promise(() => undefined))
    const task = createV2SessionTaskApi(taskContext() as any, session as any)

    await expect(invokeTask(task, "odoo_qa_engineer", "wait", undefined, 5)).rejects.toThrow("timed out")
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "child-session" })
  })

  it("interrupts the V2 child session when the task api is resolved through findTaskApi", async () => {
    // The real delegation path: the adapter injects its own bridge as
    // toolCtx.task, so findTaskApi resolves it. It used to re-wrap that bridge,
    // which replaced the promise the bridge's abort keys on and dropped the
    // interrupt — the child then ran past the timeout and finished on its own
    // (measured live: parent returned `timeout` at 1.5s, child finished at 2.4s
    // with `outcome: succeeded`).
    const session = v2Session()
    session.prompt.mockImplementation(() => new Promise(() => undefined))
    const bridge = createV2SessionTaskApi(taskContext() as any, session as any)

    const resolved = findTaskApi({ ...taskContext(), task: bridge } as any, undefined)
    expect(resolved?.source).toBe("toolCtx.task")
    expect(resolved?.taskApi).toBe(bridge)

    await expect(invokeTask(resolved!.taskApi, "odoo_qa_engineer", "wait", undefined, 5)).rejects.toThrow("timed out")
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "child-session" })
  })

  it("still interrupts the child when a wrapper hides the promise identity", async () => {
    // Safety net for the same failure mode: abort must not quietly do nothing
    // when it is handed a promise it does not recognise.
    const session = v2Session()
    session.prompt.mockImplementation(() => new Promise(() => undefined))
    const bridge = createV2SessionTaskApi(taskContext() as any, session as any)
    const wrapper = Object.assign((input: never) => bridge(input), { abort: bridge.abort })

    const invocation = wrapper({ agent: "odoo_qa_engineer", prompt: "wait" } as never)
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalled())
    await wrapper.abort?.(invocation)

    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "child-session" })
  })

  it.each([
    ["empty", [], "empty-task-result"],
    ["malformed", [{ type: "user", text: "not an ODF result" }], "invalid-task-result"],
    ["error", [{ type: "assistant", error: { type: "ProviderError", message: "provider failed" } }], "session-prompt-error"],
  ])("rejects %s V2 context output without fabricating a result", async (_label, output, expected) => {
    const session = v2Session(output)
    const task = createV2SessionTaskApi(taskContext() as any, session as any)

    await expect(task({ agent: "odoo_qa_engineer", prompt: "return" })).rejects.toThrow(expected)
  })
})

const HEALTH_OK = JSON.stringify({
  schema_version: 1,
  status: "ok",
  registry: { status: "valid", skills: { missing: [] }, agents: { missing: [] } },
  plugin: { loaded: true, file_status: "readable" },
  command: { status: "readable" },
  task_api: { function_present: true },
})

function entryHooks(fixture: ReturnType<typeof testContext>) {
  return {
    prompt: fixture.hooks.find(hook => hook.domain === "session" && hook.name === "prompt")!,
    before: fixture.hooks.find(hook => hook.domain === "tool" && hook.name === "execute.before")!,
    after: fixture.hooks.find(hook => hook.domain === "tool" && hook.name === "execute.after")!,
  }
}

async function runHealthFlow(
  fixture: ReturnType<typeof testContext>,
  sessionID: string,
  messageID: string,
  promptText: string,
) {
  const hooks = entryHooks(fixture)
  await hooks.prompt.callback({ sessionID, messageID, prompt: { text: promptText } })
  await hooks.before.callback({ tool: "odf_health", sessionID, agent: "odoo_orchestrator", messageID, id: "call-health", input: {} })
  await hooks.after.callback({
    tool: "odf_health", sessionID, agent: "odoo_orchestrator", messageID, id: "call-health", input: {},
    status: "completed", result: { content: HEALTH_OK },
  })
}

describe("OpenCode V2 /odf-new entry authorization", () => {
  afterEach(() => vi.restoreAllMocks())

  it("detects the raw form and the expanded command document", () => {
    const body = loadOdfNewCommandBody()
    expect(body && body.length).toBeGreaterThan(0)

    expect(detectOdfNewEntry('/odf-new sample-change "desc"', body)).toEqual({ args: 'sample-change "desc"' })
    expect(detectOdfNewEntry("odf-new sample-change", body)).toEqual({ args: "sample-change" })
    expect(detectOdfNewEntry(`${body}\n\nsample-change "desc"`, body)).toEqual({ args: 'sample-change "desc"' })
    expect(detectOdfNewEntry(body!, body)).toEqual({ args: "" })
    expect(detectOdfNewEntry("hello world", body)).toBeNull()
    expect(detectOdfNewEntry(`${body}\nnot-an-appended-argument`, body)).toBeNull()
    expect(detectOdfNewEntry("odf-newer change", body)).toBeNull()
  })

  it("blocks gated tools before health when the command was expanded", async () => {
    const fixture = testContext()
    const cleanup = await setupODFV2(fixture.context as any)
    const body = loadOdfNewCommandBody()!
    const hooks = entryHooks(fixture)

    await hooks.prompt.callback({ sessionID: "session-gated", messageID: "msg-gated", prompt: { text: `${body}\n\nsample-change` } })

    await expect(hooks.before.callback({
      tool: "odf_delegate", sessionID: "session-gated", agent: "odoo_orchestrator", messageID: "msg-gated", id: "call-1", input: {},
    })).rejects.toThrow(ODF_ENTRY_HEALTH_REASON)

    await cleanup()
  })

  it.each([
    ["expanded", (body: string) => `${body}\n\nv2-entry-probe "desc"`],
    ["raw", () => '/odf-new v2-entry-probe "desc"'],
  ])("shares the minted entry capability with the registered bind tool (%s form)", async (_label, makePrompt) => {
    const fsModule = await import("node:fs")
    const osModule = await import("node:os")
    const pathModule = await import("node:path")
    const fixture = testContext()
    const tmpDir = fsModule.realpathSync(fsModule.mkdtempSync(pathModule.join(osModule.tmpdir(), "odf-v2-entry-")))
    fixture.context.location.directory = tmpDir
    const cleanup = await setupODFV2(fixture.context as any)
    const sessionID = "session-bind"
    const messageID = "msg-bind"

    try {
      await runHealthFlow(fixture, sessionID, messageID, makePrompt(loadOdfNewCommandBody()!))

      const bind = fixture.tools.find(tool => tool.name === "odf_workflow_bind")!
      const result = await bind.execute({
        change_name: "v2-entry-probe",
        work_type: "feature",
        workspace_dir: tmpDir,
        artifact_store: "openspec",
        preflight: {
          change: "v2-entry-probe",
          execution_mode: "interactive",
          artifact_store: "openspec",
          delivery_strategy: "ask-on-risk",
          review_budget_lines: 400,
          odoo_version: 18,
          tdd_mode: false,
          solution_strategy: "custom",
          chain_strategy: "none",
        },
      }, {
        sessionID,
        messageID,
        agent: "odoo_orchestrator",
        signal: new AbortController().signal,
        progress: vi.fn(async () => undefined),
      })

      expect(result.content).not.toContain("workflow-start-unauthorized")
      expect(fsModule.existsSync(pathModule.join(tmpDir, "openspec", "changes", "v2-entry-probe", "state.yaml"))).toBe(true)
    } finally {
      fsModule.rmSync(tmpDir, { recursive: true, force: true })
      await cleanup()
    }
  })
})
