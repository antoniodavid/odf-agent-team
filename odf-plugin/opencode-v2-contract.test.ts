import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { tool as v1Tool } from "@opencode-ai/plugin"
import type { Context as V2Context } from "@opencode/plugin/promise/plugin"
import {
  createODFRegisteredTools,
  handleNativeDelegationSessionEvent,
  ODF_SYSTEM_RULES,
  OdfDelegationPluginV2,
} from "../plugins/odf-delegation.js"
import OdfEntrypoint from "../plugins/odf-delegation.js"
import {
  DEFAULT_DELEGATION_CANCELLATION_DEADLINE_MS,
  clearCancellationIndex,
  delegationCancellationDeadlineMs,
  readCancellationOutcome,
  registerCancellationChild,
} from "./odf-delegation-cancellation.js"
import { ODF_REGISTERED_TOOLS } from "./odf-delegation-shared.js"
import { ODF_PLUGIN_ID } from "./runtime-boundary.js"
import { setupODFV2 } from "./opencode-v2-adapter.js"
import { writeProjectActivation } from "../scripts/lib/odf-project-activation.js"

/**
 * The installed V2 event contract, read through the public plugin surface:
 * `context.event.subscribe` yields the `V2Event` union.
 */
type V2SubscribedEvent = ReturnType<V2Context["event"]["subscribe"]> extends AsyncIterable<infer Event>
  ? Event
  : never
type SessionExecutionInterruptedEvent = Extract<V2SubscribedEvent, { type: "session.execution.interrupted" }>

/** DESIGN-pinned trigger event name (design §2): referenced once, then asserted. */
const PARENT_CANCELLATION_EVENT = "session.execution.interrupted"

/** The installed confirmation capabilities `session.interrupt`/`session.wait`. */
type CancellationConfirmationCapabilities = Pick<
  V2Context["session"],
  "interrupt" | "wait" | "get" | "context"
>
const CANCELLATION_CONFIRMATION_CAPABILITIES = ["interrupt", "wait", "get", "context"] as const satisfies ReadonlyArray<
  keyof CancellationConfirmationCapabilities
>

/** Every installed `session.execution.interrupted` reason must be accepted. */
const CANCELLATION_REASONS = ["user", "shutdown", "superseded", "inactivity"] as const satisfies ReadonlyArray<
  SessionExecutionInterruptedEvent["data"]["reason"]
>

/** Test-only deadline override; the production deadline is never a literal here. */
const CONTRACT_DEADLINE_OVERRIDE_MS = 40

type ContractHook = {
  domain: "tool" | "session"
  name: string
  callback: (input: any) => Promise<void>
}

const activeContractRoot = fs.mkdtempSync(path.join(os.tmpdir(), "odf-contract-project-"))
writeProjectActivation({ directory: activeContractRoot, project: "odf-contract-project" })
afterAll(() => { fs.rmSync(activeContractRoot, { recursive: true, force: true }) })

function createContractFixture() {
  const tools: any[] = []
  const hooks: ContractHook[] = []
  const disposers: Array<ReturnType<typeof vi.fn>> = []
  let eventSignal: AbortSignal | undefined
  const session = {
    hook: vi.fn(async (name: string, callback: (input: any) => Promise<void>) => {
      hooks.push({ domain: "session", name, callback })
      const dispose = vi.fn(async () => undefined)
      disposers.push(dispose)
      return { dispose }
    }),
    get: vi.fn(async () => ({ agent: "odoo_orchestrator" })),
    create: vi.fn(async () => ({ id: "contract-child" })),
    prompt: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    context: vi.fn(async () => [{ type: "assistant", content: [{ type: "text", text: '{"status":"ok"}' }] }]),
    interrupt: vi.fn(async () => undefined),
  }
  const registration = () => {
    const dispose = vi.fn(async () => undefined)
    disposers.push(dispose)
    return { dispose }
  }
  const context = {
    location: { directory: activeContractRoot },
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
    session,
    event: {
      subscribe: vi.fn(({ signal }: { signal: AbortSignal }) => {
        eventSignal = signal
        return {
          async *[Symbol.asyncIterator]() {
            await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }))
          },
        }
      }),
    },
  }

  return {
    context,
    tools,
    hooks,
    disposers,
    session,
    get eventSignal() { return eventSignal },
  }
}

const toolContext = {
  sessionID: "contract-session",
  messageID: "contract-message",
  agent: "odoo_orchestrator",
  signal: new AbortController().signal,
  progress: vi.fn(async () => undefined),
}

describe("OpenCode V1/V2 contract fixtures", () => {
  afterEach(() => vi.restoreAllMocks())

  it("keeps one V2 entrypoint and one stable plugin ID", () => {
    expect(ODF_PLUGIN_ID).toBe("odf-delegation")
    expect(OdfDelegationPluginV2.id).toBe(ODF_PLUGIN_ID)
    expect(Object.keys(OdfEntrypoint).sort()).toEqual(["id", "setup"])
    expect(OdfEntrypoint).toEqual({
      id: "odf-delegation",
      setup: OdfDelegationPluginV2.setup,
    })
    expect(OdfEntrypoint).not.toHaveProperty("server")
  })

  it("exposes the complete registered tool surface through both runtimes", async () => {
    const v1Tools = createODFRegisteredTools()
    const fixture = createContractFixture()
    const cleanup = await setupODFV2(fixture.context as any)

    try {
      expect(Object.keys(v1Tools).sort()).toEqual([...ODF_REGISTERED_TOOLS].sort())
      expect(fixture.tools.map(tool => tool.name)).toEqual([...ODF_REGISTERED_TOOLS])
      expect(new Set(fixture.tools.map(tool => tool.name)).size).toBe(ODF_REGISTERED_TOOLS.length)
    } finally {
      await cleanup()
    }
  })

  it("teaches models to use ODF's control plane without probing pack source", () => {
    const tools = createODFRegisteredTools()

    expect(ODF_SYSTEM_RULES).toContain("ODF is a control-plane API")
    expect(ODF_SYSTEM_RULES).toContain("Do not inspect or search the installed ODF runtime source")
    expect(ODF_SYSTEM_RULES).toContain("one `odf_workflow_status` call")
    expect(ODF_SYSTEM_RULES).toContain("`odf_workflow_archive`")
    expect(tools.odf_workflow_status.description).toContain("Use this first for a current-state or continuation question")
    expect(tools.odf_workflow_archive.description).toContain("idempotent")
    expect(ODF_REGISTERED_TOOLS).not.toContain("odf_status")
    expect(tools).not.toHaveProperty("odf_status")
  })

  it("keeps JSON Schema fields and validation aligned with the V1 schemas", async () => {
    const v1Tools = createODFRegisteredTools()
    const fixture = createContractFixture()
    const cleanup = await setupODFV2(fixture.context as any)

    try {
      const v2Tools = new Map(fixture.tools.map(tool => [tool.name, tool]))
      for (const name of ODF_REGISTERED_TOOLS) {
        const v1Definition = v1Tools[name] as any
        const v2Definition = v2Tools.get(name)
        expect(v2Definition?.input).toMatchObject({ type: "object", additionalProperties: false })
        expect(Object.keys(v2Definition?.input.properties || {}).sort()).toEqual(Object.keys(v1Definition.args).sort())
      }

      const invalid = { work_type: "not-a-work-type" }
      const v1Schema = v1Tool.schema.object((v1Tools.odf_workflow_route as any).args)
      expect(() => v1Schema.parse(invalid)).toThrow()
      await expect(v2Tools.get("odf_workflow_route")!.execute(invalid, toolContext as any)).rejects.toThrow()

      const valid = { work_type: "feature" }
      const v1Result = await (v1Tools.odf_workflow_route as any).execute(valid, toolContext as any)
      const v2Result = await v2Tools.get("odf_workflow_route")!.execute(valid, toolContext as any)
      expect(v2Result).toEqual({ content: v1Result })
    } finally {
      await cleanup()
    }
  })

  it("preserves supported hook mappings and lifecycle cleanup without claiming command parity", async () => {
    const fixture = createContractFixture()
    const cleanup = await setupODFV2(fixture.context as any)
    const v2Hooks = fixture.hooks.map(hook => `${hook.domain}.${hook.name}`)

    try {
      expect(v2Hooks).toEqual(expect.arrayContaining([
        "tool.execute.before",
        "tool.execute.after",
        "session.context",
        "session.prompt",
      ]))
      expect(fixture.context.event.subscribe).toHaveBeenCalledOnce()
      expect(v2Hooks).not.toContain("command.execute.before")

      const contextHook = fixture.hooks.find(hook => hook.domain === "session" && hook.name === "context")!
      const promptHook = fixture.hooks.find(hook => hook.domain === "session" && hook.name === "prompt")!
      const modelContext = { system: [] as Array<{ type: "text"; text: string }> }
      await contextHook.callback(modelContext)
      expect(modelContext.system).toEqual([{ type: "text", text: ODF_SYSTEM_RULES }])
      await promptHook.callback({ sessionID: "contract-session", messageID: "contract-message", prompt: { text: "/odf-new migration" } })
      expect(fixture.session.get).toHaveBeenCalledWith({ sessionID: "contract-session" })
    } finally {
      await cleanup()
    }

    expect(fixture.disposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
    expect(fixture.eventSignal?.aborted).toBe(true)
  })
})

describe("OpenCode V2 parent-cancellation contract", () => {
  afterEach(() => {
    clearCancellationIndex()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("pins the parent-cancellation trigger event shape", async () => {
    // The literal is checked against the installed shape: the event name, the
    // durable envelope, `data.sessionID`, and the `data.reason` union.
    const triggerEvent = {
      id: "event-parent-cancelled",
      created: 1,
      type: PARENT_CANCELLATION_EVENT,
      durable: { aggregateID: "contract-cancel-parent", seq: 1, version: 1 },
      data: { sessionID: "contract-cancel-parent", reason: "user" },
    } satisfies SessionExecutionInterruptedEvent
    expect(CANCELLATION_CONFIRMATION_CAPABILITIES).toEqual(["interrupt", "wait", "get", "context"])
    // The complete V2 session API: a confirmed verdict also requires get/context (REQ-06/E-06).
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      get: vi.fn(async () => ({})),
      context: vi.fn(async () => []),
    }
    registerCancellationChild({
      parentSessionId: "contract-cancel-parent",
      childSessionId: "contract-cancel-child",
      path: "native",
    })

    await handleNativeDelegationSessionEvent(triggerEvent, session)

    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "contract-cancel-child" })
    expect(session.wait).toHaveBeenCalledWith({ sessionID: "contract-cancel-child" })
    expect(readCancellationOutcome("contract-cancel-parent")?.trigger).toEqual({
      event: PARENT_CANCELLATION_EVENT,
      reason: "user",
    })

    // Every installed reason value is accepted.
    for (const reason of CANCELLATION_REASONS) {
      const parentSessionId = `contract-reason-${reason}`
      const childSessionId = `contract-reason-child-${reason}`
      registerCancellationChild({ parentSessionId, childSessionId, path: "sequential" })
      const reasonSession = {
        interrupt: vi.fn(async () => undefined),
        wait: vi.fn(async () => undefined),
        get: vi.fn(async () => ({})),
        context: vi.fn(async () => []),
      }

      await handleNativeDelegationSessionEvent({
        ...triggerEvent,
        data: { sessionID: parentSessionId, reason },
      }, reasonSession)

      expect(reasonSession.interrupt).toHaveBeenCalledWith({ sessionID: childSessionId })
      expect(readCancellationOutcome(parentSessionId)?.confirmed).toEqual([childSessionId])
    }

    // Same-shaped non-cancellation events do not trigger a run.
    const idleSession = { interrupt: vi.fn(async () => undefined), wait: vi.fn(async () => undefined) }
    registerCancellationChild({
      parentSessionId: "contract-idle-parent",
      childSessionId: "contract-idle-child",
      path: "native",
    })
    await handleNativeDelegationSessionEvent({
      type: "session.idle",
      durable: { aggregateID: "contract-idle-parent", seq: 1, version: 1 },
      data: { sessionID: "contract-idle-parent" },
    }, idleSession)
    await handleNativeDelegationSessionEvent({
      type: "session.error",
      durable: { aggregateID: "contract-idle-parent", seq: 1, version: 1 },
      data: { sessionID: "contract-idle-parent", error: { name: "ProviderError" } },
    }, idleSession)

    expect(idleSession.interrupt).not.toHaveBeenCalled()
    expect(idleSession.wait).not.toHaveBeenCalled()
    expect(readCancellationOutcome("contract-idle-parent")).toBeNull()
  })

  it("uses the exported deadline constant and env override, never a literal", () => {
    expect(delegationCancellationDeadlineMs()).toBe(DEFAULT_DELEGATION_CANCELLATION_DEADLINE_MS)

    vi.stubEnv("ODF_DELEGATION_CANCELLATION_DEADLINE_MS", String(CONTRACT_DEADLINE_OVERRIDE_MS))
    expect(delegationCancellationDeadlineMs()).toBe(CONTRACT_DEADLINE_OVERRIDE_MS)
  })
})
