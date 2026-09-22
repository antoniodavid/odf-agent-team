import { afterEach, describe, expect, it, vi } from "vitest"
import { ODF_REGISTERED_TOOLS } from "./odf-delegation-shared.js"
import { ODF_SYSTEM_RULES } from "../plugins/odf-delegation.js"
import { invokeTask } from "../plugins/odf-delegation.js"
import { createV2SessionTaskApi, findTaskApi } from "./odf-delegation-health.js"
import { OdfDelegationPluginV2, createV2ToolContext, setupODFV2 } from "./opencode-v2-adapter.js"

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
