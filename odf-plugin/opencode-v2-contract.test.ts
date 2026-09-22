import { afterEach, describe, expect, it, vi } from "vitest"
import { tool as v1Tool } from "@opencode-ai/plugin"
import {
  createODFRegisteredTools,
  createODFRuntimeHooks,
  ODF_SYSTEM_RULES,
  OdfDelegationPlugin,
  OdfDelegationPluginV2,
} from "../plugins/odf-delegation.js"
import OdfEntrypoint from "../plugins/odf-delegation.js"
import { ODF_REGISTERED_TOOLS } from "./odf-delegation-shared.js"
import { ODF_PLUGIN_ID } from "./runtime-boundary.js"
import { setupODFV2 } from "./opencode-v2-adapter.js"

type ContractHook = {
  domain: "tool" | "session"
  name: string
  callback: (input: any) => Promise<void>
}

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

  it("keeps one dual-runtime entrypoint and one stable plugin ID", () => {
    expect(ODF_PLUGIN_ID).toBe("odf-delegation")
    expect(OdfDelegationPluginV2.id).toBe(ODF_PLUGIN_ID)
    expect(Object.keys(OdfEntrypoint).sort()).toEqual(["id", "server", "setup"])
    expect(OdfEntrypoint).toEqual(expect.objectContaining({
      id: "odf-delegation",
      setup: OdfDelegationPluginV2.setup,
      server: OdfDelegationPlugin,
    }))
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
    const v1Hooks = createODFRuntimeHooks({ session: { abort: vi.fn() } } as any)
    expect(Object.keys(v1Hooks).sort()).toEqual([
      "chat.message",
      "command.execute.before",
      "dispose",
      "event",
      "experimental.chat.system.transform",
      "tool.execute.after",
      "tool.execute.before",
    ])

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
