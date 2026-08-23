/**
 * Stable discovery loop guard: session-level deduplication of read-only
 * discovery calls and blocking of duplicate write-capable calls. Extracted
 * from plugins/odf-delegation.ts.
 */

import type { Hooks, ToolContext } from "@opencode-ai/plugin"
import * as nodeCrypto from "node:crypto"
import { canonicalChangeName, canonicalWorkspaceRoot, ODF_REGISTERED_TOOLS, type ODFEntryAuthorizations, type ODFEntryGenerations, type OpencodeClient } from "./odf-delegation-shared.js"

// STABLE DISCOVERY LOOP GUARD
// ==========================================

export const LOOP_GUARD_READ_TOOLS = new Set([
  "read", "glob", "grep", "webfetch",
  "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource",
  "codegraph_codegraph_explore", "fff_find_files", "fff_grep", "fff_multi_grep",
  "engram_mem_context", "engram_mem_search", "engram_mem_get_observation",
  "engram_mem_current_project", "engram_mem_doctor",
  "odf_workflow_route", "odf_workflow_advance", "odf_entry_triage",
  "odf_skill_inject", "odf_skill_resolve", "odf_registry_read", "odf_notebooklm_lookup",
  "odf_profile_select", "odf_community_tool_detect", "odf_status", "odf_workflow_status", "odf_health",
])
export const LOOP_GUARD_MAX_SESSIONS = 128
export const LOOP_GUARD_MAX_TOOLS = 64
export const LOOP_GUARD_MAX_CALLS = 128
export const LOOP_GUARD_STOP_REASON = "ODF runtime loop guard stopped this session: the same stable discovery call returned the same result twice for one user intent. Review the existing result or send a new request."
export const LOOP_GUARD_WRITE_REASON = "ODF runtime loop guard blocked a duplicate write-capable or unclassified tool call in the same user intent. Send a new explicit request to retry it."
export const ODF_ENTRY_HEALTH_REASON = "ODF entry health gate blocked this session: /odf-new requires a successful odf_health call as its first ODF operation, before questions, writes, or delegation."
export const ENGRAM_READ_ONLY_TOOLS = new Set([
  "engram_mem_context", "engram_mem_search", "engram_mem_get_observation",
  "engram_mem_current_project", "engram_mem_doctor",
])

export type LoopGuardHooks = Pick<Hooks, "dispose" | "event" | "chat.message" | "command.execute.before" | "tool.execute.before" | "tool.execute.after">
export type LoopGuardState = {
  intentID: string
  generation: number
  workspaceRoot: string
  entryChange: string | null
  stopped: boolean
  stopReason?: string
  entryHealth: "not-required" | "not-run" | "running" | "passed" | "failed"
  tools: Map<string, { signatureDigest: string; resultDigest?: string }>
  calls: Map<string, { tool: string; signatureDigest: string; intentID: string; generation: number }>
}

export function isReadOnlyEngramTool(toolName: string, args: unknown): boolean {
  if (ENGRAM_READ_ONLY_TOOLS.has(toolName)) return true
  return toolName === "engram_mem_review" && Boolean(args && typeof args === "object" && (args as Record<string, unknown>).action === "list")
}

export function isODFEntryGatedTool(toolName: string, args: unknown): boolean {
  return toolName.startsWith("odf_") || (toolName.startsWith("engram_mem_") && !isReadOnlyEngramTool(toolName, args)) ||
    ["question", "task", "bash", "write", "edit", "apply_patch"].includes(toolName)
}

export function isSuccessfulODFEntryHealth(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const result = value as Record<string, any>
  return result.schema_version === 1 && (result.status === "ok" || result.status === "warning") &&
    result.registry?.status === "valid" && Array.isArray(result.registry?.skills?.missing) && result.registry.skills.missing.length === 0 &&
    Array.isArray(result.registry?.agents?.missing) && result.registry.agents.missing.length === 0 &&
    result.plugin?.loaded === true && result.plugin?.file_status === "readable" &&
    result.command?.status === "readable" && result.task_api?.function_present === true
}

export function canonicalLoopGuardValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalLoopGuardValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalLoopGuardValue(item)]),
    )
  }
  return value
}

export function loopGuardDigest(value: unknown): string {
  return nodeCrypto.createHash("sha256")
    .update(JSON.stringify(canonicalLoopGuardValue(value)) ?? "null")
    .digest("hex")
}

export function expandedCommandDigest(parts: unknown[]): string {
  return loopGuardDigest(parts.map(part => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return part
    const value = part as Record<string, unknown>
    return { type: value.type, text: value.text, filename: value.filename, url: value.url }
  }))
}

export function createStableDiscoveryGuard(
  client: OpencodeClient,
  entryAuthorizations: ODFEntryAuthorizations = new Map(),
  entryGenerations: ODFEntryGenerations = new Map(),
  workspaceDir = process.cwd(),
): LoopGuardHooks {
  const sessions = new Map<string, LoopGuardState>()
  const pendingCommands = new Map<string, { partsDigest: string; changeName: string; generation: number }>()
  const workspaceRoot = canonicalWorkspaceRoot(workspaceDir)
  const abortSession = async (sessionID: string): Promise<void> => {
    try {
      await client.session.abort({ path: { id: sessionID } })
    } catch {
      // The hook still fails closed even if the host abort endpoint is unavailable.
    }
  }
  const boundedSet = <K, V>(map: Map<K, V>, key: K, value: V, limit: number): void => {
    map.delete(key)
    if (!map.has(key) && map.size >= limit) map.delete(map.keys().next().value!)
    map.set(key, value)
  }
  const nextGeneration = (sessionID: string): number => {
    const generation = (entryGenerations.get(sessionID) || 0) + 1
    boundedSet(entryGenerations, sessionID, generation, LOOP_GUARD_MAX_SESSIONS)
    return generation
  }
  const clearSession = (sessionID: string, clearGeneration: boolean): void => {
    sessions.delete(sessionID)
    pendingCommands.delete(sessionID)
    entryAuthorizations.delete(sessionID)
    if (clearGeneration) entryGenerations.delete(sessionID)
  }

  return {
    dispose: async () => {
      sessions.clear()
      pendingCommands.clear()
      entryAuthorizations.clear()
      entryGenerations.clear()
    },
    event: async ({ event }) => {
      if (event.type === "server.instance.disposed") {
        sessions.clear()
        pendingCommands.clear()
        entryAuthorizations.clear()
        entryGenerations.clear()
      }
      if (event.type === "session.deleted") {
        const deletedID = event.properties?.info?.id
        if (deletedID) clearSession(deletedID, true)
        return
      }
      // session.idle and session.error clear the transient loop-guard state but preserve the
      // entry authorization so a resumed session can still complete a legitimate bind.
      const sessionID = event.type === "session.idle" || event.type === "session.error"
        ? event.properties.sessionID
        : null
      if (sessionID) {
        sessions.delete(sessionID)
        pendingCommands.delete(sessionID)
      }
    },
    "command.execute.before": async (input, output) => {
      clearSession(input.sessionID, false)
      const generation = nextGeneration(input.sessionID)
      const changeName = canonicalChangeName(input.arguments.trim().split(/\s+/, 1)[0])
      if (/^\/?odf-new$/.test(input.command) && changeName) {
        boundedSet(pendingCommands, input.sessionID, {
          partsDigest: expandedCommandDigest(output.parts),
          changeName,
          generation,
        }, LOOP_GUARD_MAX_SESSIONS)
      }
    },
    "chat.message": async (input, output) => {
      const synthetic = output.parts.length > 0 && output.parts.every(part => "synthetic" in part && part.synthetic === true)
      if (synthetic) return
      const pendingCommand = pendingCommands.get(input.sessionID)
      pendingCommands.delete(input.sessionID)
      // Do NOT revoke the entry authorization here. It is single-use and scoped to change +
      // workspace, so letting it survive intervening messages keeps a legitimate /odf-new flow
      // resilient to rate-limit aborts and retries. It is superseded by a new command and
      // consumed by a successful bind.
      const generation = pendingCommand?.generation ?? nextGeneration(input.sessionID)
      const agent = input.agent ?? output.message.agent
      if (agent !== "odoo_orchestrator") {
        sessions.delete(input.sessionID)
        return
      }
      boundedSet(sessions, input.sessionID, {
        intentID: input.messageID ?? output.message.id,
        generation,
        workspaceRoot,
        entryChange: pendingCommand?.changeName || null,
        stopped: false,
        entryHealth: pendingCommand?.partsDigest === expandedCommandDigest(output.parts) ? "not-run" : "not-required",
        tools: new Map(),
        calls: new Map(),
      }, LOOP_GUARD_MAX_SESSIONS)
    },
    "tool.execute.before": async (input, output) => {
      const state = sessions.get(input.sessionID)
      if (!state) return
      if (state.stopped) throw new Error(state.stopReason || LOOP_GUARD_STOP_REASON)

      if (state.entryHealth !== "not-required" && state.entryHealth !== "passed") {
        if (input.tool === "odf_health" && state.entryHealth === "not-run") {
          state.entryHealth = "running"
        } else if (isODFEntryGatedTool(input.tool, output.args)) {
          state.stopped = true
          state.stopReason = ODF_ENTRY_HEALTH_REASON
          await abortSession(input.sessionID)
          throw new Error(ODF_ENTRY_HEALTH_REASON)
        }
      }

      const signatureDigest = loopGuardDigest({ tool: input.tool, args: output.args })
      const previous = state.tools.get(input.tool)
      if (previous?.signatureDigest === signatureDigest && !LOOP_GUARD_READ_TOOLS.has(input.tool)) {
        state.stopped = true
        await abortSession(input.sessionID)
        throw new Error(LOOP_GUARD_WRITE_REASON)
      }
      if (!previous || previous.signatureDigest !== signatureDigest) {
        boundedSet(state.tools, input.tool, { signatureDigest }, LOOP_GUARD_MAX_TOOLS)
      }
      boundedSet(state.calls, input.callID, {
        tool: input.tool,
        signatureDigest,
        intentID: state.intentID,
        generation: state.generation,
      }, LOOP_GUARD_MAX_CALLS)
    },
    "tool.execute.after": async (input, output) => {
      const state = sessions.get(input.sessionID)
      const call = state?.calls.get(input.callID)
      if (!state || !call || call.intentID !== state.intentID || call.generation !== state.generation ||
        entryGenerations.get(input.sessionID) !== state.generation) return
      state.calls.delete(input.callID)
      if (call.tool === "odf_health" && state.entryHealth === "running") {
        let result: unknown = null
        try {
          result = typeof output.output === "string" ? JSON.parse(output.output) : null
        } catch {
          result = null
        }
        if (isSuccessfulODFEntryHealth(result)) {
          state.entryHealth = "passed"
          if (state.entryChange) {
            boundedSet(entryAuthorizations, input.sessionID, {
              nonce: nodeCrypto.randomUUID(),
              sessionID: input.sessionID,
              messageID: state.intentID,
              generation: state.generation,
              changeName: state.entryChange,
              workspaceRoot: state.workspaceRoot,
              claimed: false,
            }, LOOP_GUARD_MAX_SESSIONS)
          }
        } else {
          entryAuthorizations.delete(input.sessionID)
          state.entryHealth = "failed"
          state.stopped = true
          state.stopReason = ODF_ENTRY_HEALTH_REASON
          await abortSession(input.sessionID)
        }
      }
      if (state.stopped || call.tool !== input.tool || !LOOP_GUARD_READ_TOOLS.has(input.tool)) return

      const signatureDigest = loopGuardDigest({ tool: input.tool, args: input.args })
      const entry = state.tools.get(input.tool)
      if (!entry || entry.signatureDigest !== signatureDigest || call.signatureDigest !== signatureDigest) return
      const resultDigest = loopGuardDigest(output.output)
      if (entry.resultDigest === undefined || entry.resultDigest !== resultDigest) {
        entry.resultDigest = resultDigest
        return
      }

      state.stopped = true
      output.title = "ODF stable discovery loop stopped"
      output.output = LOOP_GUARD_STOP_REASON
      output.metadata = { odf_loop_guard: { status: "stopped", reason: "stable-discovery-repeat" } }
      await abortSession(input.sessionID)
    },
  }
}

// ==========================================
