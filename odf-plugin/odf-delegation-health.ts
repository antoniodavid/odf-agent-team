/**
 * Read-only health inspection and the task() API adapters (toolCtx.task /
 * SDK child session). Extracted from plugins/odf-delegation.ts.
 */

import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import type { ToolContext } from "@opencode-ai/plugin"
import type { createOpencodeClient } from "@opencode-ai/sdk"
type OpencodeClient = ReturnType<typeof createOpencodeClient>
import {
  getOdfConfigDir,
  ODF_REGISTERED_TOOLS,
  resolvePath,
  type ODFRegistry,
} from "./odf-delegation-shared.js"
import type { DelegationMetricInput, DelegationMetrics } from "./odf-delegation-metrics.js"

// READ-ONLY HEALTH
// ==========================================

export type HealthStatus = "ok" | "warning" | "blocked" | "failed"
export type HealthFileStatus = "readable" | "missing" | "permission-denied" | "unreadable"

export interface HealthIo {
  readFile: (filePath: string) => Promise<string>
  stat: (filePath: string) => Promise<{ isFile: () => boolean }>
  access: (filePath: string) => Promise<void>
  locateExecutable: (command: string) => string
  readVersion: (command: string) => string
}

export const defaultHealthIo: HealthIo = {
  readFile: (filePath) => fs.readFile(filePath, "utf8"),
  stat: (filePath) => fs.stat(filePath),
  access: (filePath) => fs.access(filePath, fsSync.constants.R_OK),
  locateExecutable: (command) => {
    const which = process.platform === "win32" ? "where" : "which"
    return execFileSync(which, [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim().split(/\r?\n/)[0] || ""
  },
  readVersion: (command) => execFileSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  }).trim().split(/\r?\n/)[0] || "",
}

export interface HealthFileCheck {
  status: HealthFileStatus
  permissionDenied: boolean
}

export function healthErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

export function healthFileFailure(code: string | undefined): HealthFileCheck {
  if (code === "ENOENT" || code === "ENOTDIR") return { status: "missing", permissionDenied: false }
  if (code === "EACCES" || code === "EPERM") return { status: "permission-denied", permissionDenied: true }
  return { status: "unreadable", permissionDenied: false }
}

export async function checkHealthFile(filePath: string, io: HealthIo): Promise<HealthFileCheck> {
  if (!filePath) return { status: "missing", permissionDenied: false }
  try {
    const stat = await io.stat(filePath)
    if (!stat.isFile()) return { status: "unreadable", permissionDenied: false }
    await io.access(filePath)
    return { status: "readable", permissionDenied: false }
  } catch (error) {
    return healthFileFailure(healthErrorCode(error))
  }
}

export interface RegistryHealth {
  status: "valid" | HealthFileStatus | "malformed"
  path: string
  skills: { registered: number; readable: number; missing: string[] }
  agents: { registered: number; readable: number; missing: string[] }
  profiles: number
}

export interface HealthInspection {
  registry: RegistryHealth
  warnings: string[]
  permissionDenied: boolean
}

export function emptyRegistryHealth(registryPath: string, status: RegistryHealth["status"]): RegistryHealth {
  return {
    status,
    path: registryPath,
    skills: { registered: 0, readable: 0, missing: [] },
    agents: { registered: 0, readable: 0, missing: [] },
    profiles: 0,
  }
}

export function isHealthEntry(value: unknown): value is { name: string; path: string } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { path?: unknown }).path === "string"
}

export async function inspectRegistryHealth(registryPath: string, io: HealthIo): Promise<HealthInspection> {
  let raw: string
  try {
    raw = await io.readFile(registryPath)
  } catch (error) {
    const failure = healthFileFailure(healthErrorCode(error))
    return {
      registry: emptyRegistryHealth(registryPath, failure.status),
      warnings: [`registry-${failure.status}: ${registryPath}`],
      permissionDenied: failure.permissionDenied,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      registry: emptyRegistryHealth(registryPath, "malformed"),
      warnings: ["registry-malformed: odf-registry.json is not valid JSON"],
      permissionDenied: false,
    }
  }

  const value = parsed as Partial<ODFRegistry> | null
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !Array.isArray(value.skills) || !Array.isArray(value.agents) ||
    value.skills.some(skill => !isHealthEntry(skill)) ||
    value.agents.some(agent => !isHealthEntry(agent)) ||
    (value.profiles !== undefined && !Array.isArray(value.profiles))) {
    return {
      registry: emptyRegistryHealth(registryPath, "malformed"),
      warnings: ["registry-malformed: skills and agents must be registered arrays"],
      permissionDenied: false,
    }
  }

  const registryDir = path.dirname(registryPath)
  const checkEntries = async (entries: Array<{ name: string; path: string }>) => {
    const checks = await Promise.all(entries.map(entry => {
      const resolved = resolvePath(registryDir, entry.path)
      return checkHealthFile(resolved, io).then(check => ({ entry, check }))
    }))
    return {
      registered: entries.length,
      readable: checks.filter(({ check }) => check.status === "readable").length,
      missing: checks.filter(({ check }) => check.status !== "readable").map(({ entry }) => entry.name),
      permissionDenied: checks.some(({ check }) => check.permissionDenied),
    }
  }

  const [skills, agents] = await Promise.all([
    checkEntries(value.skills),
    checkEntries(value.agents),
  ])
  const warnings = [
    ...skills.missing.map(name => `registry-skill-missing: ${name}`),
    ...agents.missing.map(name => `registry-agent-missing: ${name}`),
  ]
  return {
    registry: {
      status: "valid",
      path: registryPath,
      skills: { registered: skills.registered, readable: skills.readable, missing: skills.missing },
      agents: { registered: agents.registered, readable: agents.readable, missing: agents.missing },
      profiles: Array.isArray(value.profiles) ? value.profiles.length : 0,
    },
    warnings,
    permissionDenied: skills.permissionDenied || agents.permissionDenied,
  }
}

export interface EngramHealth {
  cli: "available" | "unavailable" | "not-checked"
  path?: string
  version?: string
  export_probe: "not-run"
}

export interface EngramInspection {
  engram: EngramHealth
  warnings: string[]
  blocked: boolean
}

export function inspectEngramHealth(io: HealthIo): EngramInspection {
  const unavailable = (warning: string, blocked = false): EngramInspection => ({
    engram: { cli: "unavailable", export_probe: "not-run" },
    warnings: [warning],
    blocked,
  })
  let cliPath: string
  try {
    cliPath = io.locateExecutable("engram")
  } catch (error) {
    const code = healthErrorCode(error)
    if (code === "ETIMEDOUT") return unavailable("runtime-timeout: Engram CLI discovery timed out", true)
    if (code === "EACCES" || code === "EPERM") return unavailable("permission-denied: Engram CLI discovery", true)
    return unavailable("engram-cli-unavailable")
  }
  if (!cliPath) return unavailable("engram-cli-unavailable")

  const engram: EngramHealth = { cli: "available", path: cliPath, export_probe: "not-run" }
  try {
    const version = io.readVersion(cliPath)
    if (version) engram.version = version
  } catch (error) {
    const code = healthErrorCode(error)
    if (code === "ETIMEDOUT") return { engram, warnings: ["runtime-timeout: Engram version discovery timed out"], blocked: true }
    if (code === "EACCES" || code === "EPERM") return { engram, warnings: ["permission-denied: Engram version discovery"], blocked: true }
    // Version output is optional; a working executable is still available.
  }
  return { engram, warnings: [], blocked: false }
}

export async function inspectODFHealth(toolCtx: ToolContext, client: OpencodeClient | undefined, io: HealthIo): Promise<{
  schema_version: 1
  status: HealthStatus
  checked_at: string
  config_dir: string
  registry: RegistryHealth
  plugin: { file_status: HealthFileStatus; loaded: true; registered_tools: readonly string[] }
  command: { command: string; path: string; status: HealthFileStatus }
  task_api: { source: DelegationMetrics["task_api_source"]; function_present: boolean; usability: "unverified" | "unavailable"; probe: "not-run" }
  engram: EngramHealth
  tooling: { codegraph: "available" | "unavailable"; docker: "available" | "unavailable"; git: "available" | "unavailable"; node: "available" | "unavailable" }
  warnings: string[]
}> {
  const configDir = getOdfConfigDir()
  const registryPath = path.join(configDir, "odf-registry.json")
  const pluginPath = path.join(configDir, "plugins", "odf-delegation.ts")
  const commandPath = path.join(configDir, "command", "odf-health.md")
  const [registryInspection, pluginFile, commandFile] = await Promise.all([
    inspectRegistryHealth(registryPath, io),
    checkHealthFile(pluginPath, io),
    checkHealthFile(commandPath, io),
  ])
  const taskApi = findTaskApi(toolCtx, client)
  const taskApiHealth = {
    source: taskApi?.source || "unavailable" as const,
    function_present: Boolean(taskApi),
    usability: taskApi ? "unverified" as const : "unavailable" as const,
    probe: "not-run" as const,
  }
  const taskWarning = taskApi
    ? "task-api-unverified: task usability was not probed because probing executes a task"
    : "task-api-unavailable"
  const engramInspection = inspectEngramHealth(io)
  const probeCli = (command: string): "available" | "unavailable" => {
    try {
      io.locateExecutable(command)
      execFileSync(command, ["--version"], { stdio: "ignore", timeout: 5_000 })
      return "available"
    } catch {
      return "unavailable"
    }
  }
  const tooling = {
    codegraph: probeCli("codegraph"),
    docker: probeCli("docker"),
    git: probeCli("git"),
    node: probeCli("node"),
  }
  const warnings = [
    ...registryInspection.warnings,
    ...(pluginFile.status !== "readable" ? [`plugin-file-${pluginFile.status}: ${pluginPath}`] : []),
    ...(commandFile.status !== "readable" ? [`command-file-${commandFile.status}: ${commandPath}`] : []),
    taskWarning,
    ...engramInspection.warnings,
  ]
  const staticFailure = registryInspection.registry.status !== "valid" ||
    registryInspection.registry.skills.missing.length > 0 ||
    registryInspection.registry.agents.missing.length > 0 ||
    pluginFile.status !== "readable" || commandFile.status !== "readable"
  const permissionBlocked = registryInspection.permissionDenied ||
    pluginFile.permissionDenied || commandFile.permissionDenied || engramInspection.blocked
  const status: HealthStatus = permissionBlocked
    ? "blocked"
    : staticFailure
      ? "failed"
      : !taskApi
        ? "blocked"
        : "warning"

  return {
    schema_version: 1,
    status,
    checked_at: new Date().toISOString(),
    config_dir: configDir,
    registry: registryInspection.registry,
    plugin: { file_status: pluginFile.status, loaded: true, registered_tools: ODF_REGISTERED_TOOLS },
    command: { command: "/odf-health", path: commandPath, status: commandFile.status },
    task_api: taskApiHealth,
    engram: engramInspection.engram,
    tooling,
    warnings: Array.from(new Set(warnings)),
  }
}

// ==========================================

export type TaskApiInput = {
  agent: string
  prompt: string
  context_files?: string[]
}

export type TaskApi = ((input: TaskApiInput) => Promise<unknown>) & {
  abort?: (invocation: Promise<unknown>) => Promise<void>
}

export const EXECUTOR_BOUNDARY = `## Executor Boundary (non-negotiable)
- Executor only: do not delegate, call nested agents, or ask whether to proceed.
- Return a complete ODF Result as the last section of the response.
- If required evidence, context, or tooling is missing, stop with status: blocked; do not claim success.
- Never drop, truncate, or reset any database, schema, or table.
- Never run dropdb, DROP DATABASE, TRUNCATE, or destructive re-initialization without current explicit user consent for that exact database.
- Test commands must use the exact -d <test_db>; disposable databases are preferred, and a non-isolated development database requires current user authorization for that exact database. State that authorization and warn that tests may mutate module, schema, and test data. This authorization does not authorize destructive operations.`


export function createSDKSessionTaskApi(toolCtx: ToolContext, session: SDKSessionApi): TaskApi {
  const pending = new WeakMap<Promise<unknown>, { childID?: string; abortRequested: boolean; aborting?: Promise<void> }>()
  const directory = typeof (toolCtx as any).directory === "string" ? (toolCtx as any).directory : process.cwd()

  const taskApi = ((input: TaskApiInput): Promise<unknown> => {
    const invocation = { abortRequested: false } as { childID?: string; abortRequested: boolean; aborting?: Promise<void> }
    const abortChild = async (): Promise<void> => {
      invocation.abortRequested = true
      if (!invocation.childID || invocation.aborting) return invocation.aborting
      invocation.aborting = Promise.resolve(session.abort({
        path: { id: invocation.childID },
        query: { directory },
      })).then(() => undefined)
      await invocation.aborting
    }
    const promise = (async (): Promise<unknown> => {
      let created: any
      try {
        created = await session.create({
          body: { parentID: toolCtx.sessionID, title: `ODF delegation: ${input.agent}` },
          query: { directory },
        })
      } catch (error) {
        throw new Error(`session-create-error: ${error instanceof Error ? error.message : String(error)}`)
      }
      invocation.childID = created?.id || created?.data?.id
      if (typeof invocation.childID !== "string" || invocation.childID.length === 0) {
        throw new Error("session-create-error: session.create returned no child session id")
      }
      if (invocation.abortRequested) {
        await abortChild()
        throw new Error("task-cancelled: child session was aborted")
      }

      let response: unknown
      try {
        response = await session.prompt({
          path: { id: invocation.childID },
          query: { directory },
          body: {
            agent: input.agent,
            parts: [{ type: "text", text: appendValidatedContextFiles(input.prompt, input.context_files) }],
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isCancellationMessage(message)) throw new Error(`task-cancelled: ${message}`)
        throw new Error(`session-prompt-error: ${message}`)
      }
      return sessionPromptResult(response)
    })()
    pending.set(promise, invocation)
    taskApi.abort = async (invocationPromise: Promise<unknown>): Promise<void> => {
      const state = pending.get(invocationPromise)
      if (!state) return
      state.abortRequested = true
      if (!state.childID) return
      if (!state.aborting) {
        state.aborting = Promise.resolve(session.abort({
          path: { id: state.childID },
          query: { directory },
        })).then(() => undefined)
      }
      await state.aborting
    }
    return promise
  }) as TaskApi
  return taskApi
}

export function findTaskApi(toolCtx: ToolContext, client?: OpencodeClient): { taskApi: TaskApi; source: DelegationMetrics["task_api_source"] } | null {
  if (typeof (toolCtx as any).task === "function") {
    return { taskApi: (toolCtx as any).task as TaskApi, source: "toolCtx.task" }
  }
  const session = client && (client as any).session
  if (session && typeof session.create === "function" && typeof session.prompt === "function" && typeof session.abort === "function") {
    return { taskApi: createSDKSessionTaskApi(toolCtx, session as SDKSessionApi), source: "sdk.session" }
  }
  return null
}

/**
 * T7: defensively read host runtime telemetry from toolCtx. The current
 * @opencode-ai/plugin ToolContext type exposes only sessionID/messageID/agent/
 * directory/worktree/abort/metadata/ask — no model, provider, or token usage.
 * A future host may extend it; we read those optional fields here when present
 * and honestly represent absence as null. The heuristic estimate is supplied
 * separately and never masquerades as a real token count.
 */
export function hostTelemetryFromContext(toolCtx: ToolContext): Partial<DelegationMetricInput> {
  const ctx = toolCtx as Record<string, any>
  const model = ctx?.model
  const provider = ctx?.provider
  const modelVersion = ctx?.model_version ?? ctx?.modelVersion
  const usage = ctx?.usage ?? ctx?.tokens ?? ctx?.tokenUsage
  const inputTokens = usage?.input ?? usage?.input_tokens ?? usage?.prompt_tokens
  const outputTokens = usage?.output ?? usage?.output_tokens ?? usage?.completion_tokens
  return {
    model: typeof model === "string" ? model : typeof model?.id === "string" ? model.id : model?.modelID,
    provider: typeof provider === "string" ? provider : provider?.id ?? provider?.providerID,
    model_version: typeof modelVersion === "string" ? modelVersion : undefined,
    tokens: {
      input: typeof inputTokens === "number" ? inputTokens : null,
      output: typeof outputTokens === "number" ? outputTokens : null,
    },
  }
}


export interface SDKSessionApi {
  create: (options: Record<string, unknown>) => Promise<unknown>
  prompt: (options: Record<string, unknown>) => Promise<unknown>
  abort: (options: Record<string, unknown>) => Promise<unknown>
}
export function sessionPromptResult(response: unknown): unknown {
  if (isCancellation(response)) throw new Error("task-cancelled: session.prompt was cancelled")
  if (isEmptyTaskResult(response)) throw new Error("empty-task-result: session.prompt returned no usable result")
  if (typeof response === "string") return sessionResultFromText(response)
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("invalid-task-result: session.prompt returned an invalid response")
  }

  const envelope = response as Record<string, any>
  // The SDK client's default responseStyle is "fields": successful calls return
  // { data, request, response } and failed calls { error, request, response }.
  if (envelope.error) {
    const apiError = envelope.error as Record<string, any>
    const apiMessage = apiError.data?.message || apiError.message || apiError.name || "session.prompt failed"
    if (apiError.name === "MessageAbortedError" || isCancellationMessage(String(apiMessage))) {
      throw new Error(`task-cancelled: ${apiMessage}`)
    }
    throw new Error(`session-prompt-error: ${apiMessage}`)
  }

  const value = (envelope.data ?? envelope) as Record<string, any>
  const error = value.info?.error
  if (error) {
    const message = error.data?.message || error.message || error.name || "session.prompt failed"
    if (error.name === "MessageAbortedError" || isCancellationMessage(String(message))) {
      throw new Error(`task-cancelled: ${message}`)
    }
    throw new Error(`session-prompt-error: ${message}`)
  }
  if (typeof value.status === "string") return value

  const text = Array.isArray(value.parts)
    ? value.parts
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n")
      .trim()
    : ""
  if (!text) throw new Error("empty-task-result: session.prompt returned no text")
  return sessionResultFromText(text)
}
export function appendValidatedContextFiles(prompt: string, contextFiles?: string[]): string {
  if (!contextFiles || contextFiles.length === 0) return prompt
  return `${prompt}\n\n## Context Files (validated paths only)\n${contextFiles.map(file => `- ${file}`).join("\n")}`
}
export function isCancellationMessage(message: string): boolean {
  return /\b(cancelled|canceled|aborted)\b/i.test(message)
}

export function isEmptyTaskResult(result: unknown): boolean {
  return result == null ||
    (typeof result === "string" && result.trim().length === 0) ||
    (typeof result === "object" && result !== null && !Array.isArray(result) && Object.keys(result).length === 0)
}
export function isCancellation(result: unknown): boolean {
  if (typeof result === "string") return /^(cancelled|canceled|aborted)$/i.test(result.trim())
  if (!result || typeof result !== "object" || Array.isArray(result)) return false
  const status = (result as { status?: unknown }).status
  return typeof status === "string" && /^(cancelled|canceled|aborted)$/i.test(status.trim())
}

function sessionResultFromText(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const candidates = [
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    trimmed,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
    } catch {
      // The agent contract is Markdown, so try the ODF Result section next.
    }
  }

  const resultSection = trimmed.match(/##\s*ODF Result\s*([\s\S]*)/i)?.[1] || ""
  const result: Record<string, unknown> = {}
  for (const line of resultSection.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+\*\*([^*]+)\*\*:\s*(.*?)\s*$/)
    if (!match) continue
    const key = match[1].trim().toLowerCase().replace(/[\s-]+/g, "_")
    const rawValue = match[2].trim()
    if (key === "status") {
      result[key] = rawValue.split("|")[0].trim()
      continue
    }
    if (rawValue === "null") {
      result[key] = null
      continue
    }
    if (rawValue.startsWith("[") || rawValue.startsWith("{")) {
      try {
        result[key] = JSON.parse(rawValue)
        continue
      } catch {
        // Preserve non-JSON Markdown values as text.
      }
    }
    result[key] = rawValue
  }
  if (typeof result.status !== "string" || result.status.length === 0) {
    throw new Error("invalid-task-result: session.prompt did not return an ODF Result")
  }
  return result
}



