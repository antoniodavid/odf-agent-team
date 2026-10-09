import { Plugin } from "@opencode/plugin"
import type { Context as V2Context, Cleanup as V2Cleanup } from "@opencode/plugin/promise/plugin"
import type { ToolContext as V2ToolContext } from "@opencode/plugin/promise/tool"
import { tool, type ToolContext as V1ToolContext, type ToolResult as V1ToolResult } from "./odf-tool.js"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  createStableDiscoveryGuard,
  type LoopGuardRuntime,
} from "./odf-delegation-loopguard.js"
import {
  ODF_REGISTERED_TOOLS,
  type ODFEntryAuthorizations,
  type ODFEntryGenerations,
  type OpencodeClient,
} from "./odf-delegation-shared.js"
import {
  createV2SessionTaskApi,
  ODF_V2_SESSION,
  type TaskApi,
  type V2SessionApi,
} from "./odf-delegation-health.js"
import { observeOpenCodeSessionEvent } from "./odf-session-status.js"
import { ODF_PLUGIN_ID } from "./runtime-boundary.js"
import { loadRegistry } from "./odf-registry-io.js"

const ODF_ORCHESTRATOR_AGENT = "odoo_orchestrator"
const ODF_NATIVE_DELEGATION_TOOLS = new Set(["subagent", "task"])
const ODF_DELEGATION_MARKER = "<!-- ODF-DELEGATION "

/**
 * Chokepoint guard for the V2 native delegation path: the ODF orchestrator must
 * launch registered ODF specialists through `odf_delegation_prepare`/`odf_delegate`
 * so the delegation gates stay in control. A direct `subagent`/`task` call from
 * the orchestrator without the prepared prompt marker is blocked with an
 * actionable error; manual agent use from other sessions is untouched.
 */
async function odfSubagentChokepointError(input: { tool: string; agent: string; input: unknown }): Promise<string | null> {
  if (input.agent !== ODF_ORCHESTRATOR_AGENT) return null
  if (!ODF_NATIVE_DELEGATION_TOOLS.has(input.tool)) return null
  const args = input.input && typeof input.input === "object" && !Array.isArray(input.input)
    ? input.input as Record<string, unknown>
    : null
  const target = typeof args?.agent === "string"
    ? args.agent
    : typeof args?.subagent_type === "string"
      ? args.subagent_type
      : null
  if (!target) return null
  let isOdfAgent = false
  try {
    const registry = await loadRegistry()
    isOdfAgent = Boolean(registry?.agents?.some(agent => agent.name === target && agent.installed === true))
  } catch {
    // The registry is advisory here: if it cannot be read, do not block.
    return null
  }
  if (!isOdfAgent) return null
  const prompt = typeof args?.prompt === "string" ? args.prompt : ""
  if (prompt.includes(ODF_DELEGATION_MARKER)) return null
  return `Blocked: ${target} is an ODF specialist. Delegate through odf_delegation_prepare → odf_delegation_launch → odf_delegation_seal (or odf_delegate for fast-lane/parallel) so the ODF gates run; direct ${input.tool} calls to ODF agents from the orchestrator are not allowed.`
}

type JsonSchema = Record<string, unknown>
type ODFRegisteredToolMap = import("../plugins/odf-delegation.js").ODFRegisteredToolMap
type V1Tool = ODFRegisteredToolMap[keyof ODFRegisteredToolMap]
type V2Registration = { dispose: () => Promise<void> }
const ODF_REGISTERED_TOOL_NAMES = new Set<string>(ODF_REGISTERED_TOOLS)

function schemaFor(name: string, definition: V1Tool): { parse: (input: unknown) => unknown; input: JsonSchema } {
  const schema = tool.schema.object(definition.args)
  try {
    const input = tool.schema.toJSONSchema(schema) as unknown
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("schema conversion did not return an object")
    }
    return { parse: (value: unknown) => schema.parse(value), input: input as JsonSchema }
  } catch (error) {
    throw new Error(`ODF V2 schema conversion failed for ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const value = result as Record<string, unknown>
    if (typeof value.output === "string") return value.output
    if (typeof value.content === "string") return value.content
  }
  try {
    return JSON.stringify(result) ?? ""
  } catch {
    return String(result)
  }
}

function toV2Result(result: V1ToolResult): { content: string; metadata?: Record<string, unknown> } {
  if (typeof result === "string") return { content: result }
  return {
    content: result.output,
    ...(result.metadata && typeof result.metadata === "object" ? { metadata: result.metadata } : {}),
  }
}

export function createV2ToolContext(context: V2ToolContext, directory: string, session: V2SessionApi): V1ToolContext & {
  task: TaskApi
  [ODF_V2_SESSION]: V2SessionApi
} {
  const legacyContext: V1ToolContext = {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory,
    worktree: directory,
    abort: context.signal,
    metadata: ({ title, metadata }) => {
      void context.progress({ title, ...(metadata || {}) })
    },
    ask: async () => {
      throw new Error("ODF V2 does not expose the V1 permission prompt from a tool context")
    },
  }
  return {
    ...legacyContext,
    task: createV2SessionTaskApi(legacyContext, session),
    [ODF_V2_SESSION]: session,
  }
}

function v2AbortClient(context: V2Context): OpencodeClient {
  return {
    session: {
      abort: async (input: { path: { id: string } }) => context.session.interrupt({ sessionID: input.path.id }),
    },
  } as unknown as OpencodeClient
}

function stripCommandFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return (match ? raw.slice(match[0].length) : raw).trim()
}

/**
 * Load the installed /odf-new command body: the template OpenCode V2 expands
 * into a prompt (trimmed Markdown body, arguments appended after a blank line).
 * The command files ship beside this module in every installed layout.
 */
function loadOdfCommandBody(command: "odf-new" | "odf-fix"): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(here, "..", "command", `${command}.md`),
    path.join(here, "..", "commands", `${command}.md`),
  ]
  for (const candidate of candidates) {
    try {
      return stripCommandFrontmatter(readFileSync(candidate, "utf8"))
    } catch {
      // Try the next layout (singular command/ vs plural commands/).
    }
  }
  return null
}

export function loadOdfNewCommandBody(): string | null {
  return loadOdfCommandBody("odf-new")
}

export function loadOdfFixCommandBody(): string | null {
  return loadOdfCommandBody("odf-fix")
}

/**
 * Detect a /odf-new entry in a V2 prompt. V2 expands the slash command before
 * the prompt hook runs, so accept both the raw form and the expanded command
 * document (template body plus appended arguments).
 */
export function detectOdfNewEntry(text: string, commandBody: string | null): { args: string } | null {
  const raw = text.match(/^\/?odf-new(?:\s|$)/)
  if (raw) return { args: text.slice(raw[0].length).trim() }
  if (!commandBody) return null
  if (text === commandBody) return { args: "" }
  if (text.startsWith(`${commandBody}\n\n`)) return { args: text.slice(commandBody.length + 2).trim() }
  return null
}

export function detectOdfFixEntry(text: string, commandBody: string | null): { args: string } | null {
  const raw = text.match(/^\/?odf-fix(?:\s|$)/)
  if (raw) return { args: text.slice(raw[0].length).trim() }
  if (!commandBody) return null
  if (text === commandBody) return { args: "" }
  if (text.startsWith(`${commandBody}\n\n`)) return { args: text.slice(commandBody.length + 2).trim() }
  return null
}

/**
 * Narrow admission detector for direct natural-language work starts. Questions,
 * quoted requests, and generic continuation/backchannel text are not starts.
 */
export function detectNaturalWorkflowEntry(text: string): "new" | "bugfix" | null {
  const firstLine = text.trim().split(/\r?\n/, 1)[0]?.trim() || ""
  if (!firstLine || firstLine.length > 1_000 || /[?`]$/.test(firstLine) || /^["'“‘>]/.test(firstLine)) return null
  const bugfix = /^(?:(?:please|can you|could you)\s+)?(?:fix|repair|resolve)\b|^(?:there(?:'s| is)\s+(?:an?\s+)?(?:bug|error|failure)\b|this is broken\b|(?:arregla|corrige|soluciona|repara)\b|(?:hay|tengo)\s+(?:un|una)\s+(?:error|fallo|bug)\b)/i
  if (bugfix.test(firstLine)) return "bugfix"
  const feature = /^(?:(?:please|can you|could you|i want you to|i need you to)\s+)?(?:implement|add|build|create|develop)\b|^(?:(?:por favor|puedes|podrías|quiero que|necesito que)\s+)?(?:implementa|agrega|añade|construye|crea|desarrolla)\b/i
  if (feature.test(firstLine)) return "new"
  return null
}

function eventForV1Guard(event: unknown): unknown {
  if (!event || typeof event !== "object" || Array.isArray(event)) return event
  const value = event as Record<string, unknown>
  const data = value.data && typeof value.data === "object" && !Array.isArray(value.data)
    ? value.data as Record<string, unknown>
    : {}
  return {
    ...value,
    properties: {
      ...data,
      info: data.info ?? data,
      sessionID: data.sessionID ?? data.sessionId,
    },
  }
}

async function registerV2Hooks(
  context: V2Context,
  guard: LoopGuardRuntime,
  registrations: V2Registration[],
  systemRules: string,
  odfNewCommandBody: string | null,
  odfFixCommandBody: string | null,
): Promise<void> {
  registrations.push(await context.tool.hook("execute.before", async (input) => {
    // ODF custom-tool executors apply the same guard internally. Code Mode can
    // invoke those executors without emitting these host hooks, so keep the
    // executor as the single guard boundary and avoid processing twice here.
    if (!ODF_REGISTERED_TOOL_NAMES.has(input.tool)) {
      const output = { args: input.input }
      await guard["tool.execute.before"]?.({
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.id,
      }, output)
      input.input = output.args
    }
    const chokepoint = await odfSubagentChokepointError({
      tool: input.tool,
      agent: input.agent,
      input: input.input,
    })
    if (chokepoint) throw new Error(chokepoint)
  }))

  registrations.push(await context.tool.hook("execute.after", async (input) => {
    const output = {
      title: "",
      output: input.status === "completed" ? resultText(input.result) : String(input.error),
      metadata: input.status === "completed" && input.result?.metadata ? input.result.metadata : {},
    }
    if (!ODF_REGISTERED_TOOL_NAMES.has(input.tool)) {
      await guard["tool.execute.after"]?.({
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.id,
        args: input.input,
      }, output)
    }
    if (output.metadata?.odf_loop_guard?.status === "stopped") throw new Error(output.output)
  }))

  registrations.push(await context.session.hook("context", async (input) => {
    if (!input.system.some(part => part.type === "text" && part.text === systemRules)) {
      input.system.push({ type: "text", text: systemRules })
    }
    // V1 injected this through experimental.chat.system.transform; V2's
    // `context` hook is the equivalent seam. The notice is one-shot, so a later
    // model call for the same session no longer receives it.
    const sessionID = (input as { sessionID?: string }).sessionID
    const pressureNotice = sessionID ? guard.consumeContextPressureNotice(sessionID) : null
    if (pressureNotice && !input.system.some(part => part.type === "text" && part.text === pressureNotice)) {
      input.system.push({ type: "text", text: pressureNotice })
    }
  }))

  // V2 has no command.execute.before hook. The prompt hook is the narrowest
  // supported seam: V2 expands the slash command before admission, so detect
  // both the raw /odf-new form and the expanded command document, then
  // initialize the existing V1 guard.
  registrations.push(await context.session.hook("prompt", async (input) => {
    const session = await context.session.get({ sessionID: input.sessionID })
    const agent = typeof session.agent === "string" ? session.agent : undefined
    if (!agent) return
    const parts = [{ type: "text", text: input.prompt.text }] as never
    const newEntry = detectOdfNewEntry(input.prompt.text, odfNewCommandBody)
    const fixEntry = detectOdfFixEntry(input.prompt.text, odfFixCommandBody)
    const naturalEntry = newEntry || fixEntry ? null : detectNaturalWorkflowEntry(input.prompt.text)
    if (newEntry) {
      await guard["command.execute.before"]?.({
        command: "odf-new",
        sessionID: input.sessionID,
        arguments: newEntry.args,
      }, { parts } as never)
    } else if (fixEntry) {
      await guard["command.execute.before"]?.({
        command: "odf-fix",
        sessionID: input.sessionID,
        arguments: fixEntry.args,
      }, { parts } as never)
    } else if (naturalEntry) {
      await guard["command.execute.before"]?.({
        command: "odf-natural-entry",
        sessionID: input.sessionID,
        arguments: naturalEntry,
      }, { parts } as never)
    }
    await guard["chat.message"]?.({ sessionID: input.sessionID, agent, messageID: input.messageID } as never, {
      message: { id: input.messageID, agent } as never,
      parts,
    } as never)
  }))

  const eventAbort = new AbortController()
  const eventTask = (async () => {
    try {
      for await (const event of context.event.subscribe({ signal: eventAbort.signal })) {
        observeOpenCodeSessionEvent(event)
        await guard.event?.({ event: eventForV1Guard(event) as never })
      }
    } catch (error) {
      if (!eventAbort.signal.aborted) throw error
    }
  })()
  registrations.push({
    dispose: async () => {
      eventAbort.abort()
      await eventTask
    },
  })

}

export async function setupODFV2(context: V2Context): Promise<V2Cleanup> {
  const registrations: V2Registration[] = []
  const directory = context.location.directory
  // The guard mints the single-use entry capability; the registered tools
  // (odf_workflow_bind) consume it. Both sides must share the same maps.
  const entryAuthorizations: ODFEntryAuthorizations = new Map()
  const entryGenerations: ODFEntryGenerations = new Map()
  const guard = createStableDiscoveryGuard(v2AbortClient(context), entryAuthorizations, entryGenerations, directory)

  try {
    const { createODFRegisteredTools, ODF_SYSTEM_RULES, startOdfRuntime } = await import("../plugins/odf-delegation.js")
    // Registry cache, metrics flusher, unregistered-skill discovery and the
    // learning loop used to run inside the V1 `server` entrypoint. Running them
    // here keeps those side effects alive under the V2 host.
    await startOdfRuntime()
    // Tool execution is guarded here rather than only in host hooks: Code Mode
    // can call these registered executors directly without execute.before/after.
    let toolCallSequence = 0
    registrations.push(await context.tool.transform((editor) => {
      const tools = createODFRegisteredTools(undefined, directory, entryAuthorizations, entryGenerations)
      for (const name of ODF_REGISTERED_TOOLS) {
        const definition = tools[name]
        const schema = schemaFor(name, definition)
        editor.add({
          name,
          description: definition.description,
          input: schema.input,
          execute: async (input, toolContext) => {
            const validated = schema.parse(input)
            const call = {
              tool: name,
              sessionID: toolContext.sessionID,
              callID: `odf-v2-${++toolCallSequence}`,
            }
            const guardedInput = { args: validated }
            await guard["tool.execute.before"]?.(call, guardedInput)
            const v1Context = createV2ToolContext(toolContext, directory, context.session)
            let result: Awaited<ReturnType<typeof definition.execute>>
            try {
              result = await definition.execute(guardedInput.args as never, v1Context)
            } catch (error) {
              await guard["tool.execute.after"]?.({ ...call, args: guardedInput.args }, {
                title: "",
                output: String(error),
                metadata: {},
              })
              throw error
            }
            const v2Result = toV2Result(result)
            const guardedResult = {
              title: "",
              output: v2Result.content,
              metadata: v2Result.metadata || {},
            }
            await guard["tool.execute.after"]?.({ ...call, args: guardedInput.args }, guardedResult)
            const loopGuard = guardedResult.metadata.odf_loop_guard as { status?: unknown } | undefined
            if (loopGuard?.status === "stopped") throw new Error(guardedResult.output)
            return v2Result
          },
        })
      }
    }))
    await registerV2Hooks(context, guard, registrations, ODF_SYSTEM_RULES, loadOdfNewCommandBody(), loadOdfFixCommandBody())
    return async () => {
      await Promise.allSettled(registrations.splice(0).map(registration => registration.dispose()))
      await guard.dispose?.()
    }
  } catch (error) {
    await Promise.allSettled(registrations.splice(0).map(registration => registration.dispose()))
    await guard.dispose?.()
    throw error
  }
}

export const OdfDelegationPluginV2 = Plugin.define({
  id: ODF_PLUGIN_ID,
  setup: setupODFV2,
})
