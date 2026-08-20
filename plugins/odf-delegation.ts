/**
 * odf-delegation
 * Odoo Development Framework delegation plugin for OpenCode
 *
 * Extends OpenCode with ODF-specific delegation tools:
 * - odf_delegate: Delegate to phase-specific agents with skill injection
 * - odf_health: Read-only installed/runtime health inspection
 * - odf_skill_inject: Read registry and inject compact rules
 * - odf_registry_read: Query the ODF skill registry
 *
 * Based on background-agents from gentle-ai (MIT License)
 */

import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import * as nodeCrypto from "node:crypto"
import { type Hooks, type Plugin, type ToolContext, tool } from "@opencode-ai/plugin"
import { execFileSync, execSync } from "node:child_process"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { isMap, parseDocument, stringify } from "yaml"
import {
  advanceWorkflow,
  resolveWorkflowRoute,
  WORK_TYPES,
  type CanonicalStage,
  type WorkType,
  type WorkflowAdvanceInput,
  type WorkflowPhaseResultStatus,
  type WorkflowValidationStatus,
  type WorkflowReceiptState,
  type WorkflowRoute,
} from "../odf-plugin/odf-workflow.js"
import {
  deriveWorkflowStatus,
  normalizeArtifactKey,
  parseWorkflowState,
  type WorkflowReceipt,
  type WorkflowStage,
  type WorkflowStatus,
} from "../odf-plugin/odf-workflow-status.js"
import {
  parallelJoinArtifactRef,
  readParallelJoinArtifact,
  writeParallelJoinArtifact,
  type ParallelJoinArtifact,
} from "../odf-plugin/odf-parallel-join.js"
import { buildCandidateManifest, computeCandidateDigest, extractChangedPaths } from "../odf-plugin/candidate-manifest.js"
import { classifyEntryTriage, type EntryTriageInput } from "../odf-plugin/entry-triage.js"
import { validateExpectations, validDate } from "../odf-plugin/odf-expectations.js"
import { sanitizeChangeName, validatePreflight, type PreflightRecord } from "../scripts/lib/preflight.js"
import { inspectToolArgs } from "../scripts/odf-safety.js"

export type OpencodeClient = ReturnType<typeof createOpencodeClient>

// ==========================================
// CONFIGURATION / SAFE PATHS
// ==========================================

/**
 * Return the ODF configuration directory.
 *
 * Uses ODF_CONFIG_DIR when it is set and absolute. Falls back to
 * ~/.config/opencode. The resolved path is always absolute.
 */
function getOdfConfigDir(): string {
  const envDir = process.env.ODF_CONFIG_DIR?.trim()
  if (envDir) {
    if (path.isAbsolute(envDir)) {
      return path.normalize(envDir)
    }
    console.warn(`[odf-delegation] ODF_CONFIG_DIR "${envDir}" is not absolute; falling back to default.`)
  }
  return path.join(os.homedir(), ".config", "opencode")
}

function isWithinRoot(candidate: string, root: string): boolean {
  const normalizedRoot = path.normalize(root)
  const normalizedCandidate = path.normalize(candidate)
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep)
  )
}

function resolveWorkspaceRoot(cwd = process.cwd()): string {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (root) return path.normalize(root)
  } catch {
    // Fall back for non-Git workspaces.
  }
  return path.normalize(path.resolve(cwd))
}

function canonicalWorkspaceRoot(cwd = process.cwd()): string {
  return fsSync.realpathSync(resolveWorkspaceRoot(cwd))
}

// Debug logging: silent by default; enable with ODF_DEBUG=1 to restore the
// informational [odf-delegation] lines (warnings always print).
const ODF_DEBUG = process.env.ODF_DEBUG === "1" || process.env.ODF_DEBUG === "true"
function debugLog(...args: unknown[]): void {
  if (ODF_DEBUG) console.log("[odf-delegation]", ...args)
}

function workspaceProjectName(workspaceRoot: string): string {
  try {
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (gitRoot) return path.basename(path.normalize(gitRoot))
  } catch {
    // Fall back for non-Git workspaces.
  }
  return path.basename(path.normalize(workspaceRoot))
}

// ==========================================
// ODF REGISTRY
// ==========================================

const REGISTRY_PATH = path.join(getOdfConfigDir(), "odf-registry.json")

// Registry cache with TTL (5 seconds) to avoid disk reads on every tool call
let registryCache: ODFRegistry | null = null
let registryCacheTime = 0
const REGISTRY_CACHE_TTL_MS = 5000

// Hot-reload: watch registry file for changes
let registryWatcher: fsSync.FSWatcher | null = null
function startRegistryWatcher(): void {
  if (registryWatcher) return
  try {
    registryWatcher = fsSync.watch(REGISTRY_PATH, (eventType) => {
      if (eventType === "change") {
        registryCache = null
        registryCacheTime = 0
        debugLog(`[odf-delegation] Registry changed on disk. Cache invalidated.`)
      }
    })
  } catch {
    // Registry file may not exist yet — watcher will be started on first load
  }
}

interface ODFSkill {
  name: string
  title: string
  category: string
  triggers: string[]
  compact_rules: string
  path: string
  odoo_versions: number[]
  sdd_phase: string | null
}

interface ODFAgent {
  name: string
  mode: string
  description: string
  phases: string[]
  model: string | null
  path: string
  installed: boolean
}

interface ODFProfile {
  phase: string
  model: string
  temperature: number
  reasoning?: boolean
  description: string
}

interface ODFPackage {
  name: string
  version: string
  description: string
  repository: string
  dependencies: Record<string, string>
}

interface ODFCommand {
  name: string
  description: string
  path: string
  triggers?: string[]
}

interface ODFCapability {
  name: string
  type: 'capability' | 'agent'
  description?: string
  path: string
}

interface ODFCommunityTool {
  name: string
  title: string
  package_name: string
  command_name: string
  repo_url: string
  description: string
  installed: boolean
}

interface ODFRegistry {
  version: number
  last_updated: string
  skills: ODFSkill[]
  agents: ODFAgent[]
  profiles?: ODFProfile[]
  notebooklm_sources?: Record<string, string>
  package?: ODFPackage
  commands?: ODFCommand[]
  capabilities?: ODFCapability[]
  community_tools?: ODFCommunityTool[]
  flags?: Record<string, boolean | string | number>
}

const ODF_REGISTERED_TOOLS = [
  "odf_delegate",
  "odf_parallel_delegate",
  "odf_workflow_route",
  "odf_workflow_advance",
  "odf_workflow_bind",
  "odf_entry_triage",
  "odf_skill_inject",
  "odf_registry_read",
  "odf_notebooklm_lookup",
  "odf_profile_select",
  "odf_skill_resolve",
  "odf_community_tool_detect",
  "odf_community_tool_install",
  "odf_status",
  "odf_workflow_status",
  "odf_policy_gate",
  "odf_receipt",
  "odf_health",
] as const

/**
 * Resolve a registry path safely.
 *
 * Rules:
 * - Reject empty paths.
 * - Reject any path containing ".." segments (path traversal).
 * - Absolute paths are allowed only if they live under the registry directory
 *   or the ODF config directory.
 * - "~/" is expanded relative to the user's home directory and then checked
 *   against the same allowed roots.
 * - Relative paths are resolved against the registry directory and must stay
 *   within the allowed roots.
 */
function resolvePath(registryDir: string, entryPath: string): string {
  if (typeof entryPath !== "string" || !entryPath) return ""
  if (entryPath.split(/[\\/]/).includes("..")) return ""

  const allowedRoots = [path.normalize(registryDir), getOdfConfigDir()]

  let resolved: string
  if (path.isAbsolute(entryPath)) {
    resolved = path.normalize(entryPath)
  } else if (entryPath.startsWith("~/")) {
    resolved = path.normalize(path.join(os.homedir(), entryPath.slice(2)))
  } else {
    resolved = path.resolve(registryDir, entryPath)
  }

  if (!allowedRoots.some(root => isWithinRoot(resolved, root))) {
    return ""
  }

  if (fsSync.existsSync(resolved)) {
    try {
      if (!fsSync.statSync(resolved).isFile()) return ""
      if (!allowedRoots.some(root => isWithinRoot(fsSync.realpathSync(resolved), root))) return ""
    } catch {
      return ""
    }
  }

  return resolved
}

async function loadRegistry(): Promise<ODFRegistry | null> {
  const now = Date.now()
  if (registryCache && (now - registryCacheTime) < REGISTRY_CACHE_TTL_MS) {
    return registryCache
  }
  try {
    const data = await fs.readFile(REGISTRY_PATH, "utf8")
    const parsed = JSON.parse(data) as ODFRegistry
    const registryDir = path.dirname(REGISTRY_PATH)

    // Resolve relative skill/agent paths against the registry directory
    for (const skill of parsed.skills || []) {
      skill.path = resolvePath(registryDir, skill.path)
    }
    for (const agent of parsed.agents || []) {
      agent.path = resolvePath(registryDir, agent.path)
    }

    registryCache = parsed
    registryCacheTime = now
    startRegistryWatcher()
    return parsed
  } catch (err) {
    if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    console.warn(`[odf-delegation] Registry at ${REGISTRY_PATH} is unreadable or corrupt: ${err}`)
    return null
  }
}

// ==========================================
// READ-ONLY HEALTH
// ==========================================

type HealthStatus = "ok" | "warning" | "blocked" | "failed"
type HealthFileStatus = "readable" | "missing" | "permission-denied" | "unreadable"

interface HealthIo {
  readFile: (filePath: string) => Promise<string>
  stat: (filePath: string) => Promise<{ isFile: () => boolean }>
  access: (filePath: string) => Promise<void>
  locateExecutable: (command: string) => string
  readVersion: (command: string) => string
}

const defaultHealthIo: HealthIo = {
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

interface HealthFileCheck {
  status: HealthFileStatus
  permissionDenied: boolean
}

function healthErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

function healthFileFailure(code: string | undefined): HealthFileCheck {
  if (code === "ENOENT" || code === "ENOTDIR") return { status: "missing", permissionDenied: false }
  if (code === "EACCES" || code === "EPERM") return { status: "permission-denied", permissionDenied: true }
  return { status: "unreadable", permissionDenied: false }
}

async function checkHealthFile(filePath: string, io: HealthIo): Promise<HealthFileCheck> {
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

interface RegistryHealth {
  status: "valid" | HealthFileStatus | "malformed"
  path: string
  skills: { registered: number; readable: number; missing: string[] }
  agents: { registered: number; readable: number; missing: string[] }
  profiles: number
}

interface HealthInspection {
  registry: RegistryHealth
  warnings: string[]
  permissionDenied: boolean
}

function emptyRegistryHealth(registryPath: string, status: RegistryHealth["status"]): RegistryHealth {
  return {
    status,
    path: registryPath,
    skills: { registered: 0, readable: 0, missing: [] },
    agents: { registered: 0, readable: 0, missing: [] },
    profiles: 0,
  }
}

function isHealthEntry(value: unknown): value is { name: string; path: string } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { path?: unknown }).path === "string"
}

async function inspectRegistryHealth(registryPath: string, io: HealthIo): Promise<HealthInspection> {
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

interface EngramHealth {
  cli: "available" | "unavailable" | "not-checked"
  path?: string
  version?: string
  export_probe: "not-run"
}

interface EngramInspection {
  engram: EngramHealth
  warnings: string[]
  blocked: boolean
}

function inspectEngramHealth(io: HealthIo): EngramInspection {
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

async function inspectODFHealth(toolCtx: ToolContext, client: OpencodeClient | undefined, io: HealthIo): Promise<{
  schema_version: 1
  status: HealthStatus
  checked_at: string
  config_dir: string
  registry: RegistryHealth
  plugin: { file_status: HealthFileStatus; loaded: true; registered_tools: readonly string[] }
  command: { command: string; path: string; status: HealthFileStatus }
  task_api: { source: DelegationMetrics["task_api_source"]; function_present: boolean; usability: "unverified" | "unavailable"; probe: "not-run" }
  engram: EngramHealth
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
    warnings: Array.from(new Set(warnings)),
  }
}

// ==========================================
// VERSION DETECTION
// ==========================================

async function detectOdooVersion(projectDir: string): Promise<number | null> {
  try {
    // Try to find __manifest__.py in project or subdirectories
    const manifestPaths = [
      path.join(projectDir, "__manifest__.py"),
      path.join(projectDir, "*", "__manifest__.py"),
    ]
    
    for (const pattern of manifestPaths) {
      if (pattern.includes("*")) {
        // Glob-like: check direct children
        const entries = await fs.readdir(projectDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const manifestPath = path.join(projectDir, entry.name, "__manifest__.py")
            try {
              const content = await fs.readFile(manifestPath, "utf8")
              const versionMatch = content.match(/['"]version['"]\s*:\s*['"](\d+)\.\d+/)
              if (versionMatch) {
                return parseInt(versionMatch[1], 10)
              }
            } catch {
              // Continue to next directory
            }
          }
        }
      } else {
        try {
          const content = await fs.readFile(pattern, "utf8")
          const versionMatch = content.match(/['"]version['"]\s*:\s*['"](\d+)\.\d+/)
          if (versionMatch) {
            return parseInt(versionMatch[1], 10)
          }
        } catch {
          // Continue
        }
      }
    }
  } catch {
    // Could not detect version
  }
  return null
}

// ==========================================
// AUTO-DISCOVERY
// ==========================================

async function discoverUnregisteredSkills(registry: ODFRegistry): Promise<string[]> {
  const skillsDir = path.join(getOdfConfigDir(), "skills")
  const unregistered: string[] = []

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("odoo_")) {
        const registryName = entry.name.replace(/_/g, "-")
        const exists = registry.skills.some(s => s.name === registryName)
        if (!exists) {
          unregistered.push(entry.name)
        }
      }
    }
  } catch {
    // skills dir doesn't exist or not readable
  }

  return unregistered
}

// ==========================================
// CACHE FINGERPRINT (P0.3: Startup perf)
// ==========================================

const CACHE_FILE = path.join(getOdfConfigDir(), ".registry-cache.json")

interface CacheEntry {
  path: string
  mtime: string
  size: number
}

interface RegistryCache {
  timestamp: string
  last_refresh: string
  skills: CacheEntry[]
  permissions_fingerprint: string
}

async function loadRegistryCache(): Promise<RegistryCache | null> {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf8")
    return JSON.parse(data)
  } catch {
    return null
  }
}

async function saveRegistryCache(cache: RegistryCache): Promise<void> {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8")
  } catch {
    // Cache file is optional
  }
}

async function computePermissionsFingerprint(registry: ODFRegistry): Promise<string> {
  // Include rule content so cache invalidation follows behavior, not only metadata.
  const parts = registry.skills.map(s => JSON.stringify({
    name: s.name,
    version: (s as any).version || "1.0",
    triggers: s.triggers,
    compact_rules: s.compact_rules,
  })).sort()
  const hash = await crypto.subtle?.digest?.("SHA-256", new TextEncoder().encode(parts.join("|")))
  if (hash) {
    return Array.from(new Uint8Array(hash)).slice(0, 8).map(b => b.toString(16)).join("")
  }
  return parts.length.toString()
}

async function hasSkillsChanged(): Promise<boolean> {
  const cache = await loadRegistryCache()
  if (!cache) return true

  const skillsDir = path.join(getOdfConfigDir(), "skills")
  try {
    const entries = await fs.readdir(skillsDir, { recursive: true })
    const skillFiles = entries.filter(e => e.endsWith("SKILL.md"))

    for (const file of skillFiles) {
      const fullPath = path.join(skillsDir, file)
      try {
        const stat = await fs.stat(fullPath)
        const cached = cache.skills.find(c => c.path === fullPath)
        if (!cached || cached.mtime !== stat.mtime.toISOString() || cached.size !== stat.size) {
          return true
        }
      } catch {
        return true
      }
    }

    // Check for removed skills
    if (skillFiles.length !== cache.skills.length) return true

    return false
  } catch {
    return false
  }
}

// ==========================================
// METRICS (F1: Agent Observatory)
// ==========================================

// Versioned telemetry schema (T7). `event` distinguishes a full delegation
// (run) from a sub-step / tool call (span). Every emitted line carries
// schema_version, a trace_id, and parent/span ids so runs can be correlated
// with their spans. Host-provided fields (model, provider, model_version,
// tokens) are captured ONLY when the host exposes them; absent fields are
// serialized explicitly as null / model_available=false. The heuristic
// estimateTokens() is never treated as real input/output token counts.
export type TelemetryEvent = "run" | "span"

export interface TelemetryTokens {
  /** Real input tokens from the host, when exposed. */
  input?: number | null
  /** Real output tokens from the host, when exposed. */
  output?: number | null
  /** Heuristic len/4 estimate, always flagged as estimated. */
  estimated?: number | null
}

export interface DelegationMetrics {
  timestamp: string
  session_hash: string
  phase: string
  agent: string
  skills_injected: string[]
  skill_resolution: "injected" | "self-discovered" | "none"
  duration_ms: number
  token_estimate: number
  status: "ok" | "blocked" | "error" | "timeout"
  task_api_source: "toolCtx.task" | "sdk.session" | "unavailable"
  work_type?: WorkType
  branch_id?: string
  join_status?: "running" | "complete" | "blocked"
  join_expected?: number
  join_completed?: number
  join_failed?: number
  join_running?: number
  validation_ratio?: number
  error?: string
  // T7 telemetry
  event?: TelemetryEvent
  schema_version?: 1
  trace_id?: string
  parent_span_id?: string
  span_id?: string
  task?: string
  tool?: string
  model?: string | null
  provider?: string | null
  model_version?: string | null
  model_available?: boolean
  tokens?: TelemetryTokens
  retry_count?: number
  candidate_digest?: string
  receipt_ref?: string
  warnings?: string[]
}

type DelegationMetricInput = Omit<DelegationMetrics, "session_hash"> & {
  session_id: string
  error?: string
}

let metricsBuffer: DelegationMetrics[] = []
const METRICS_FLUSH_INTERVAL = 30_000 // flush every 30s
let metricsTimer: ReturnType<typeof setInterval> | null = null

function getMetricsBufferCap(): number {
  const parsed = parseInt(process.env.ODF_METRICS_BUFFER_CAP || "1000", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000
}

function getMetricsDir(): string {
  return path.join(getOdfConfigDir(), "metrics")
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function hashSession(sessionId: string): string {
  return nodeCrypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 8)
}

function sanitizeError(error?: string): string | undefined {
  if (!error) return undefined
  const safe = scrubMetricSecrets(error).replace(/\r?\n/g, " ").replace(/"/g, "'").trim()
  return safe.length > 200 ? safe.slice(0, 200) + "..." : safe
}

const METRIC_SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const METRIC_MAX_JOIN_COUNT = 3

function sanitizeMetricToken(value: unknown): string | undefined {
  return typeof value === "string" && METRIC_SAFE_TOKEN_PATTERN.test(value) ? value : undefined
}

function sanitizeMetricWorkType(value: unknown): WorkType | undefined {
  return typeof value === "string" && WORK_TYPES.includes(value as WorkType) ? value as WorkType : undefined
}

function sanitizeMetricJoinStatus(value: unknown): DelegationMetrics["join_status"] {
  return value === "running" || value === "complete" || value === "blocked" ? value : undefined
}

function sanitizeMetricJoinCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= METRIC_MAX_JOIN_COUNT
    ? value
    : undefined
}

function sanitizeMetricValidationRatio(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}

const METRIC_TASK_MAX = 120

/**
 * Scrub PII/secret-bearing substrings from a free-text value before it is
 * persisted: absolute home paths (`/home/<user>/...`), and env-like
 * `NAME=VALUE` assignments (which commonly carry secrets). Applied to the
 * error and task labels so prompts, user paths and env values never leak into
 * the JSONL.
 */
function scrubMetricSecrets(value: string): string {
  return value
    .replace(/\/home\/[^/\s,"']+(?:\/[^\s,"']*)?/g, "[home]")
    .replace(/\/Users\/[^/\s,"']+(?:\/[^\s,"']*)?/g, "[home]")
    .replace(/\b[A-Z][A-Z0-9_]{2,}=[^\s,"']{1,64}\b/g, "[env]")
}

function sanitizeMetricTask(prompt?: string): string | undefined {
  if (!prompt || typeof prompt !== "string") return undefined
  const firstLine = prompt.split(/\r?\n/).map(l => l.trim()).find(Boolean)
  if (!firstLine) return undefined
  const safe = scrubMetricSecrets(firstLine).replace(/"/g, "'").slice(0, METRIC_TASK_MAX)
  return safe.length > 0 ? safe : undefined
}

function sanitizeMetricTokenCount(value: unknown): number | null | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Token counts are always honest: host-provided counts are used verbatim;
 * otherwise input/output stay null and only `estimated` (the len/4 heuristic)
 * is recorded. The estimate is never surfaced as a real token count.
 */
function sanitizeMetricTokens(
  input: unknown,
  output: unknown,
  estimated: unknown
): TelemetryTokens {
  return {
    input: sanitizeMetricTokenCount(input),
    output: sanitizeMetricTokenCount(output),
    estimated: sanitizeMetricTokenCount(estimated),
  }
}

function sanitizeMetricBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function sanitizeMetricRetryCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

const METRIC_MODEL_MAX = 80
const METRIC_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9./:_-]{0,79}$/

/** Model/provider/version identifiers are bounded and shape-checked. */
function sanitizeMetricModel(value: unknown): string | null | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().slice(0, METRIC_MODEL_MAX)
  return METRIC_MODEL_PATTERN.test(trimmed) ? trimmed : null
}

/**
 * A span id derived from the session hash + phase + monotonic sequence, so a
 * delegation and its sub-steps are correlated without storing the raw session.
 */
let telemetrySpanCounter = 0
function nextTelemetrySpanId(sessionId: string, phase: string): string {
  telemetrySpanCounter = (telemetrySpanCounter + 1) % 0xffff
  return `${hashSession(sessionId)}-${phase.slice(0, 8).replace(/[^A-Za-z0-9]/g, "") || "x"}-${telemetrySpanCounter.toString(16)}`
}

function sanitizeMetricSafeToken(value: unknown): string | undefined {
  return typeof value === "string" && METRIC_SAFE_TOKEN_PATTERN.test(value) ? value : undefined
}

/** Long candidate digests / receipt refs are bounded to safe tokens. */
function sanitizeMetricDigest(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) return undefined
  return trimmed.toLowerCase()
}

/**
 * Metrics policy:
 * - Buffer is capped at ODF_METRICS_BUFFER_CAP (default 1000 entries).
 *   When the cap is reached the buffer is flushed synchronously to disk
 *   (backpressure) so memory stays bounded.
 * - session_id is hashed (sha256, first 8 hex chars) before persistence;
 *   the raw session_id never appears in the JSONL log.
 * - Error messages are truncated to 200 characters and newlines are replaced
 *   with spaces so each log line remains a single JSON object.
 * - Metrics are written to ${ODF_CONFIG_DIR}/metrics. The directory should be
 *   protected by normal filesystem permissions (user-owned, not world-readable).
 * - Retention is daily JSONL files; downstream consumers should rotate or purge
 *   old files according to their own policy.
 */
function flushMetricsSync(): void {
  if (metricsBuffer.length === 0) return
  const batch = metricsBuffer.splice(0)
  try {
    const metricsDir = getMetricsDir()
    fsSync.mkdirSync(metricsDir, { recursive: true })
    const today = new Date().toISOString().split("T")[0]
    const logFile = path.join(metricsDir, `delegations-${today}.jsonl`)
    const lines = batch.map(m => JSON.stringify(m)).join("\n") + "\n"
    fsSync.appendFileSync(logFile, lines, "utf8")
  } catch (err) {
    // Metrics logging is best-effort. If sync flush fails we drop the batch
    // rather than letting the buffer grow unbounded.
    console.warn(`[odf-delegation] Metrics flush failed: ${err}`)
  }
}

function startMetricsFlusher(): void {
  if (metricsTimer) return
  metricsTimer = setInterval(() => {
    flushMetricsSync()
  }, METRICS_FLUSH_INTERVAL)
}

function recordMetrics(metric: DelegationMetricInput): void {
  const {
    session_id,
    work_type,
    branch_id,
    join_status,
    join_expected,
    join_completed,
    join_failed,
    join_running,
    validation_ratio,
    error,
    task,
    tool,
    model,
    provider,
    model_version,
    tokens,
    retry_count,
    candidate_digest,
    receipt_ref,
    event,
    trace_id,
    span_id,
    parent_span_id,
    ...rest
  } = metric
  const isSpan = event === "span"
  const runSpanId = span_id || nextTelemetrySpanId(session_id, rest.phase || "phase")
  const sanitized: DelegationMetrics = {
    ...rest,
    session_hash: hashSession(session_id),
    ...(sanitizeMetricWorkType(work_type) ? { work_type: sanitizeMetricWorkType(work_type) } : {}),
    ...(sanitizeMetricToken(branch_id) ? { branch_id: sanitizeMetricToken(branch_id) } : {}),
    ...(sanitizeMetricJoinStatus(join_status) ? { join_status: sanitizeMetricJoinStatus(join_status) } : {}),
    ...(sanitizeMetricJoinCount(join_expected) !== undefined ? { join_expected: sanitizeMetricJoinCount(join_expected) } : {}),
    ...(sanitizeMetricJoinCount(join_completed) !== undefined ? { join_completed: sanitizeMetricJoinCount(join_completed) } : {}),
    ...(sanitizeMetricJoinCount(join_failed) !== undefined ? { join_failed: sanitizeMetricJoinCount(join_failed) } : {}),
    ...(sanitizeMetricJoinCount(join_running) !== undefined ? { join_running: sanitizeMetricJoinCount(join_running) } : {}),
    ...(sanitizeMetricValidationRatio(validation_ratio) !== undefined ? { validation_ratio: sanitizeMetricValidationRatio(validation_ratio) } : {}),
    error: sanitizeError(error),
    event: isSpan ? "span" : "run",
    schema_version: 1,
    trace_id: sanitizeMetricSafeToken(trace_id) || hashSession(session_id),
    span_id: sanitizeMetricSafeToken(span_id) || runSpanId,
    // A span's parent must be supplied by the caller (the enclosing run's
    // span_id). Root runs omit parent_span_id. Never synthesized.
    ...(isSpan && sanitizeMetricSafeToken(parent_span_id) ? { parent_span_id: sanitizeMetricSafeToken(parent_span_id) } : {}),
    ...(sanitizeMetricTask(task) ? { task: sanitizeMetricTask(task) } : {}),
    ...(sanitizeMetricToken(tool) ? { tool: sanitizeMetricToken(tool) } : {}),
    model: sanitizeMetricModel(model) ?? null,
    provider: sanitizeMetricModel(provider) ?? null,
    model_version: sanitizeMetricModel(model_version) ?? null,
    model_available: sanitizeMetricBool(model !== undefined && model !== null) ?? false,
    tokens: sanitizeMetricTokens(
      (tokens as any)?.input,
      (tokens as any)?.output,
      (tokens as any)?.estimated ?? (rest as any).token_estimate,
    ),
    ...(sanitizeMetricRetryCount(retry_count) !== undefined ? { retry_count: sanitizeMetricRetryCount(retry_count) } : {}),
    ...(sanitizeMetricDigest(candidate_digest) ? { candidate_digest: sanitizeMetricDigest(candidate_digest) } : {}),
    ...(sanitizeMetricSafeToken(receipt_ref) ? { receipt_ref: sanitizeMetricSafeToken(receipt_ref) } : {}),
  }
  metricsBuffer.push(sanitized)
  if (metricsBuffer.length >= getMetricsBufferCap()) {
    flushMetricsSync()
  }
}

// ==========================================
// LEARNING LOOP (F4)
// ==========================================

interface LearningInsight {
  skill: string
  success_rate: number
  total_uses: number
  avg_duration_ms: number
}

async function learnFromMetrics(): Promise<LearningInsight[]> {
  const metricsDir = getMetricsDir()
  const insights: Map<string, { successes: number; total: number; durations: number[] }> = new Map()

  try {
    const files = await fs.readdir(metricsDir)
    const recentFiles = files.filter(f => f.startsWith("delegations-")).slice(-7) // last 7 days

    for (const file of recentFiles) {
      const content = await fs.readFile(path.join(metricsDir, file), "utf8")
      const lines = content.trim().split("\n")
      for (const line of lines) {
        try {
          const m: DelegationMetrics = JSON.parse(line)
          for (const skill of m.skills_injected) {
            if (!insights.has(skill)) {
              insights.set(skill, { successes: 0, total: 0, durations: [] })
            }
            const data = insights.get(skill)!
            data.total++
            data.durations.push(m.duration_ms)
            if (m.status === "ok") data.successes++
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // No metrics directory yet
    return []
  }

  const result: LearningInsight[] = []
  for (const [skill, data] of insights.entries()) {
    const avgDur = data.durations.length > 0
      ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
      : 0
    result.push({
      skill,
      success_rate: data.total > 0 ? Math.round((data.successes / data.total) * 100) : 0,
      total_uses: data.total,
      avg_duration_ms: avgDur,
    })
  }

  result.sort((a, b) => b.success_rate - a.success_rate)
  return result
}

async function getProfileByPhase(
  registry: ODFRegistry,
  phase: string,
  profileName?: string
): Promise<{ model: string; temperature: number; reasoning?: boolean; name?: string } | null> {
  if (!registry.profiles) return null

  // Find active profile first
  const profiles = registry.profiles as any[]
  const selectedProfile = profileName
    ? profiles.find(p => p.name === profileName)
    : profiles.find(p => p.active === true) || profiles.find(p => p.name === "default") || profiles[0]

  if (selectedProfile && selectedProfile.phases && selectedProfile.phases[phase.toUpperCase()]) {
    return {
      ...selectedProfile.phases[phase.toUpperCase()],
      name: selectedProfile.name,
    }
  }

  // Fall back to flat profile structure
  const flatProfile = registry.profiles.find(p => (p as any).phase === phase.toUpperCase())
  if (flatProfile) {
    return {
      model: (flatProfile as any).model,
      temperature: (flatProfile as any).temperature,
      reasoning: (flatProfile as any).reasoning,
    }
  }

  return null
}

function formatProfileBlock(
  profile: { model: string; temperature: number; reasoning?: boolean; name?: string },
  phase: string
): string {
  return `## SDD Profile (auto-resolved)
Profile: ${profile.name || "default"}
Phase: ${phase}
Model: ${profile.model}
Temperature: ${profile.temperature}
Reasoning: ${profile.reasoning ? "enabled" : "disabled"}`
}

// ==========================================
// SKILL MATCHING
// ==========================================

function matchSkills(
  registry: ODFRegistry,
  phase: string | null,
  context: { files?: string[]; task?: string; odooVersion?: number | null }
): ODFSkill[] {
  const matches: ODFSkill[] = []
  const taskLower = context.task?.toLowerCase() || ""
  const normalizedPhase = phase?.toUpperCase() || null
  const canonicalName = normalizedPhase === "QA-PLAN"
    ? "odf-qa"
    : normalizedPhase
      ? `odf-${normalizedPhase.toLowerCase()}`
      : null

  for (const skill of registry.skills) {
    const isOdfSkill = skill.category === "odf" || skill.category.startsWith("odf/")
    if (isOdfSkill && normalizedPhase && skill.sdd_phase && skill.sdd_phase.toUpperCase() !== normalizedPhase) {
      continue
    }

    const isCanonical = skill.name === canonicalName
    // Version pinning: skip skills that don't support the detected version
    if (context.odooVersion && skill.odoo_versions.length > 0) {
      if (!skill.odoo_versions.includes(context.odooVersion)) {
        continue
      }
    }

    let score = 0

    // Match by file context
    if (context.files) {
      for (const file of context.files) {
        const fileLower = file.toLowerCase()
        for (const trigger of skill.triggers) {
          if (fileLower.includes(trigger.toLowerCase())) {
            score += 2
          }
        }
      }
    }

    // Match by task context
    for (const trigger of skill.triggers) {
      if (taskLower.includes(trigger.toLowerCase())) {
        score += 1
      }
    }

    if (score > 0 || isCanonical) {
      matches.push({ ...skill, _score: score, _canonical: isCanonical } as ODFSkill & { _score: number; _canonical: boolean })
    }
  }

  // Sort by score (desc) then by compact_rules length (more specific first)
  matches.sort((a: any, b: any) => {
    if (b._canonical !== a._canonical) {
      return Number(b._canonical) - Number(a._canonical)
    }
    if (b._score !== a._score) {
      return b._score - a._score
    }
    return b.compact_rules.length - a.compact_rules.length
  })

  return matches.slice(0, 5)
}

// Karpathy-inspired precision guardrails — always injected first
const KARPATHY_COMPACT_RULES = [
  "- State assumptions explicitly before implementing. If uncertain, ask.",
  "- If multiple interpretations exist, present all — do NOT pick silently.",
  "- No features beyond what was asked. No abstractions for single-use code.",
  "- No 'flexibility' or 'configurability' that wasn't requested.",
  "- Don't 'improve' adjacent code, comments, or formatting.",
  "- Don't refactor things that aren't broken. Match existing style.",
  "- Every changed line must trace directly to the task requirement.",
  "- Transform 'fix bug' → 'write failing test first, then make it pass'.",
  "- For multi-step: state plan with verification per step.",
  "- If 200 lines could be 50, rewrite it smaller.",
].join("\n")

function formatCompactRules(skills: ODFSkill[]): string {
  const sections: string[] = ["## Project Standards (auto-resolved)\n"]

  // Precision guardrails always injected first (karpathy-precision)
  sections.push("### Precision Guardrails")
  sections.push(KARPATHY_COMPACT_RULES)
  sections.push("")

  for (const skill of skills) {
    sections.push(`### ${skill.title}`)
    sections.push(skill.compact_rules)
    sections.push("")
  }

  return sections.join("\n")
}

// ==========================================
// AGENT RESOLUTION
// ==========================================

const STOP_WORDS = new Set([
  // English
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
  "from", "as", "is", "was", "are", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might", "must",
  "can", "shall", "this", "that", "these", "those", "i", "you", "he", "she", "it",
  "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
  "their", "what", "which", "who", "when", "where", "why", "how", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just", "also",
  // Spanish
  "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o", "pero", "en",
  "de", "con", "por", "para", "desde", "hasta", "entre", "sobre", "bajo", "ante",
  "sin", "según", "durante", "mediante", "excepto", "salvo", "hacia", "a", "al",
  "del", "lo", "le", "les", "se", "es", "son", "está", "están", "fue", "fueron",
  "ser", "sido", "siendo", "haber", "han", "había", "tener", "tiene", "tienen",
  "tuvo", "hacer", "hace", "hacen", "hizo", "este", "esta", "estos", "estas",
  "ese", "esa", "esos", "esas", "aquel", "aquella", "aquellos", "aquellas",
  "yo", "tú", "él", "ella", "nosotros", "nosotras", "vosotros", "vosotras",
  "ellos", "ellas", "mí", "ti", "sí", "conmigo", "contigo", "mío", "mía",
  "míos", "mías", "tuyo", "tuya", "suyo", "suya", "nuestro", "nuestra",
  "qué", "cuál", "cuáles", "quién", "quiénes", "cuándo", "dónde", "cómo",
  "porqué", "cuánto", "cuánta", "cuántos", "cuántas", "todo", "toda",
  "todos", "todas", "cada", "alguno", "alguna", "algunos", "algunas",
  "ninguno", "ninguna", "otro", "otra", "otros", "otras", "mismo", "misma",
  "mismos", "mismas", "tal", "tales", "tan", "tanto", "tanta", "tantos",
  "tantas", "muy", "poco", "poca", "pocos", "pocas", "más", "menos",
  "mucho", "mucha", "muchos", "muchas", "demasiado", "demasiada",
  "sólo", "solo", "solamente", "ya", "aún", "todavía", "siempre",
  "nunca", "jamás", "ahora", "antes", "después", "luego", "pronto",
  "tarde", "temprano", "ayer", "hoy", "mañana", "aquí", "ahí", "allí",
  "donde", "cuando", "como", "que", "quien", "cuyo", "cuya", "cuyos",
  "cuyas", "cual", "cuales", "cuanto", "cuanta", "cuantos", "cuantas"
])

function filterStopWords(keywords: string[]): string[] {
  return keywords.filter(kw => {
    const lower = kw.toLowerCase().trim()
    // Filter out: empty, stop words, shorter than 3 chars, pure numbers
    if (!lower || lower.length < 3) return false
    if (STOP_WORDS.has(lower)) return false
    if (/^\d+$/.test(lower)) return false
    return true
  })
}

const DEFAULT_AGENTS: Record<string, string> = {
  PROPOSE: "odoo_functional_consultant",
  ASSESS: "odoo_functional_consultant",
  "QA-PLAN": "odoo_qa_engineer",
  DESIGN: "odoo_backend_engineer",
  IMPLEMENT: "odoo_backend_engineer",
  VERIFY: "odoo_qa_engineer",
  EXPLORE: "odoo_functional_consultant",
  FIX: "odoo_backend_engineer",
}

function resolveAgent(registry: ODFRegistry, phase: string, taskKeywords: string[]): string | null {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_AGENTS, phase)) return null

  // Filter out stop words before matching
  const filteredKeywords = filterStopWords(taskKeywords)
  if (filteredKeywords.length === 0) {
    return DEFAULT_AGENTS[phase]
  }

  // Check for custom agents matching phase and keywords
  for (const agent of registry.agents) {
    if (!agent.installed) continue
    if (!agent.phases.includes(phase) && !agent.phases.includes("ANY")) continue

    // Check if agent description matches filtered task keywords
    const descLower = agent.description.toLowerCase()
    if (filteredKeywords.some(kw => descLower.includes(kw.toLowerCase()))) {
      return agent.name
    }
  }

  return DEFAULT_AGENTS[phase]
}

// ==========================================
// TASK INVOCATION
// ==========================================

type TaskApiInput = {
  agent: string
  prompt: string
  context_files?: string[]
}

type TaskApi = ((input: TaskApiInput) => Promise<unknown>) & {
  abort?: (invocation: Promise<unknown>) => Promise<void>
}

const EXECUTOR_BOUNDARY = `## Executor Boundary (non-negotiable)
- Executor only: do not delegate, call nested agents, or ask whether to proceed.
- Return a complete ODF Result as the last section of the response.
- If required evidence, context, or tooling is missing, stop with status: blocked; do not claim success.
- Never drop, truncate, or reset any database, schema, or table.
- Never run dropdb, DROP DATABASE, TRUNCATE, or destructive re-initialization without current explicit user consent for that exact database.
- Test commands must name an isolated database with -d <test_db> and must not drop it automatically.`

function isEmptyTaskResult(result: unknown): boolean {
  return result == null ||
    (typeof result === "string" && result.trim().length === 0) ||
    (typeof result === "object" && result !== null && !Array.isArray(result) && Object.keys(result).length === 0)
}

function isCancellation(result: unknown): boolean {
  if (typeof result === "string") return /^(cancelled|canceled|aborted)$/i.test(result.trim())
  if (!result || typeof result !== "object" || Array.isArray(result)) return false
  const status = (result as { status?: unknown }).status
  return typeof status === "string" && /^(cancelled|canceled|aborted)$/i.test(status.trim())
}

function isCancellationMessage(message: string): boolean {
  return /\b(cancelled|canceled|aborted)\b/i.test(message)
}

function innerPhaseResultStatus(result: unknown): WorkflowPhaseResultStatus | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null
  const status = (result as { status?: unknown }).status
  return status === "ok" || status === "warning" || status === "blocked" || status === "failed" ? status : null
}

interface InnerResultDisposition {
  resultStatus: WorkflowPhaseResultStatus | null
  metricStatus: DelegationMetrics["status"]
  accepted: boolean
  failureReceiptStatus: ODFReceipt["status"]
  failureReason: "task-error" | null
  failureResultStatus: Exclude<AttemptLedgerResultStatus, "running"> | null
  message: string
}

function innerResultDisposition(result: unknown): InnerResultDisposition {
  const resultStatus = innerPhaseResultStatus(result)
  if (resultStatus === "ok" || resultStatus === "warning") {
    return {
      resultStatus,
      metricStatus: "ok",
      accepted: true,
      failureReceiptStatus: "failed",
      failureReason: null,
      failureResultStatus: null,
      message: "The inner phase result completed successfully.",
    }
  }

  if (resultStatus === "blocked") {
    return {
      resultStatus,
      metricStatus: "blocked",
      accepted: false,
      failureReceiptStatus: "blocked",
      failureReason: "task-error",
      failureResultStatus: "error",
      message: "The inner phase result is blocked.",
    }
  }

  return {
    resultStatus,
    metricStatus: "error",
    accepted: false,
    failureReceiptStatus: "failed",
    failureReason: "task-error",
    failureResultStatus: "error",
    message: resultStatus === "failed"
      ? "The inner phase result failed."
      : "The inner phase result is missing or has an invalid status.",
  }
}

interface SDKSessionApi {
  create: (options: Record<string, unknown>) => Promise<unknown>
  prompt: (options: Record<string, unknown>) => Promise<unknown>
  abort: (options: Record<string, unknown>) => Promise<unknown>
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

function sessionPromptResult(response: unknown): unknown {
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

function appendValidatedContextFiles(prompt: string, contextFiles?: string[]): string {
  if (!contextFiles || contextFiles.length === 0) return prompt
  return `${prompt}\n\n## Context Files (validated paths only)\n${contextFiles.map(file => `- ${file}`).join("\n")}`
}

function createSDKSessionTaskApi(toolCtx: ToolContext, session: SDKSessionApi): TaskApi {
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

function findTaskApi(toolCtx: ToolContext, client?: OpencodeClient): { taskApi: TaskApi; source: DelegationMetrics["task_api_source"] } | null {
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
function hostTelemetryFromContext(toolCtx: ToolContext): Partial<DelegationMetricInput> {
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

async function invokeTask(
  taskApi: TaskApi,
  agentName: string,
  prompt: string,
  contextFiles?: string[],
  timeoutMs = 120_000,
  abortSignal?: AbortSignal,
): Promise<{ status: string; result: unknown }> {
  const taskPromise = taskApi({ agent: agentName, prompt, context_files: contextFiles })
  let timedOut = false
  let cancelled = false
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let removeAbortListener: (() => void) | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      reject(new Error(`task() timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  const cancellationPromise = abortSignal
    ? new Promise<never>((_, reject) => {
      const onAbort = (): void => {
        cancelled = true
        reject(new Error("task-cancelled: delegation was cancelled"))
      }
      if (abortSignal.aborted) onAbort()
      else {
        abortSignal.addEventListener("abort", onAbort, { once: true })
        removeAbortListener = () => abortSignal.removeEventListener("abort", onAbort)
      }
    })
    : null
  try {
    const result = await Promise.race([...(cancellationPromise ? [cancellationPromise] : []), taskPromise, timeoutPromise])
    if (isCancellation(result)) throw new Error("task-cancelled: task() was cancelled")
    if (isEmptyTaskResult(result)) throw new Error("empty-task-result: task() returned no usable result")
    return { status: "delegated", result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (timedOut || cancelled || isCancellationMessage(message)) {
      try {
        await taskApi.abort?.(taskPromise)
      } catch {
        // Preserve the original timeout/cancellation result if abort also fails.
      }
    }
    throw error
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    removeAbortListener?.()
  }
}

function validateContextFiles(workspaceRoot: string, contextFiles: string[]): { error: string | null; paths: string[] } {
  const paths: string[] = []
  for (const file of contextFiles) {
    if (typeof file !== "string" || file.split(/[\\/]/).includes("..")) {
      return { error: `❌ context_files entry "${file}" contains path traversal`, paths: [] }
    }
    const resolvedFile = path.resolve(workspaceRoot, file)
    if (!isWithinRoot(resolvedFile, workspaceRoot)) {
      return { error: `❌ context_files entry "${file}" escapes workspace root`, paths: [] }
    }
    let comparablePath = path.normalize(resolvedFile)
    if (fsSync.existsSync(resolvedFile)) {
      try {
        if (!fsSync.statSync(resolvedFile).isFile()) {
          return { error: `❌ context_files entry "${file}" is not a file`, paths: [] }
        }
        comparablePath = path.normalize(fsSync.realpathSync(resolvedFile))
        if (!isWithinRoot(comparablePath, workspaceRoot)) {
          return { error: `❌ context_files entry "${file}" escapes workspace root`, paths: [] }
        }
      } catch {
        return { error: `❌ context_files entry "${file}" cannot be read`, paths: [] }
      }
    }
    paths.push(comparablePath)
  }
  return { error: null, paths }
}

const ALLOWED_PHASES = ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY", "EXPLORE", "FIX"]
const PARALLEL_BUILD_CONCURRENCY = 3

type ODFDelegateWorkflowAdvance = Omit<WorkflowAdvanceInput, "route"> & {
  work_type: WorkType
}

type ArtifactStore = "openspec" | "engram" | "hybrid"

interface ODFDelegateArgs {
  phase: string
  prompt: string
  context_files?: string[]
  profile?: string
  change?: string
  timeout_ms?: number
  attempt_id?: string
  artifact_store?: ArtifactStore
  workflow_advance?: ODFDelegateWorkflowAdvance
}

interface DelegateExecutionOptions {
  branch_id?: string
  suppress_failure_receipt?: boolean
  validation_evidence_path?: string
  workflow_result?: ReturnType<typeof advanceWorkflow> | null
  pre_acquired_attempt?: AcquiredAttempt | null
  suppress_workflow_commit?: boolean
  suppress_attempt_settlement?: boolean
}

type InternalODFDelegateArgs = ODFDelegateArgs & {
  __options?: DelegateExecutionOptions
}

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ATTEMPT_LEDGER_MAX_BYTES = 256 * 1024
const ATTEMPT_LEDGER_MAX_LINES = 500
const ATTEMPT_LEDGER_MAX_LINE_BYTES = 512
const ATTEMPT_LEDGER_LOCK_SUFFIX = ".lock"

type AttemptLedgerPhase = "IMPLEMENT" | "VERIFY"
type AttemptLedgerStatus = "running" | "completed" | "failed"
type AttemptLedgerResultStatus =
  | "running"
  | "delegated"
  | "validation-failed"
  | "timeout"
  | "cancelled"
  | "empty-task-result"
  | "error"
  | "task-api-unavailable"
type AttemptLedgerReason =
  | "acquired"
  | "task-completed"
  | "validation-failed"
  | "task-timeout"
  | "task-cancelled"
  | "empty-task-result"
  | "task-error"
  | "task-api-unavailable"

interface AttemptLedgerRecord {
  attempt_id: string
  branch_id?: string
  change: string
  phase: AttemptLedgerPhase
  next_stage: "BUILD" | "VERIFY"
  status: AttemptLedgerStatus
  started_at: string
  updated_at: string
  settled_at: string | null
  reason: AttemptLedgerReason
  result_status: AttemptLedgerResultStatus
  candidate_digest?: string | null
}

interface AcquiredAttempt {
  ledgerPath: string
  record: AttemptLedgerRecord
}

interface AttemptAcquisitionBlocked {
  acquired: false
  reason: string
  message: string
}

interface AttemptAcquisitionAllowed {
  acquired: true
  handle: AcquiredAttempt
}

type AttemptAcquisitionResult = AttemptAcquisitionAllowed | AttemptAcquisitionBlocked

function attemptLedgerPath(workspaceDir: string, change: string): string {
  return path.join(workspaceDir, ".odf", `attempt-ledger-${change}.jsonl`)
}

function isSafeToken(value: unknown): value is string {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value)
}

function isSafeTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32 && !/[\r\n]/.test(value)
}

function isAttemptLedgerRecord(value: unknown): value is AttemptLedgerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Partial<AttemptLedgerRecord>
  return isSafeToken(record.attempt_id) &&
    (record.branch_id === undefined || isSafeToken(record.branch_id)) &&
    isSafeToken(record.change) &&
    (record.phase === "IMPLEMENT" || record.phase === "VERIFY") &&
    (record.next_stage === "BUILD" || record.next_stage === "VERIFY") &&
    (record.status === "running" || record.status === "completed" || record.status === "failed") &&
    isSafeTimestamp(record.started_at) &&
    isSafeTimestamp(record.updated_at) &&
    (record.settled_at === null || isSafeTimestamp(record.settled_at)) &&
    (record.reason === "acquired" || record.reason === "task-completed" || record.reason === "validation-failed" || record.reason === "task-timeout" ||
      record.reason === "task-cancelled" || record.reason === "empty-task-result" || record.reason === "task-error" ||
      record.reason === "task-api-unavailable") &&
    (record.result_status === "running" || record.result_status === "delegated" || record.result_status === "validation-failed" || record.result_status === "timeout" ||
      record.result_status === "cancelled" || record.result_status === "empty-task-result" || record.result_status === "error" ||
      record.result_status === "task-api-unavailable") &&
    (record.candidate_digest === undefined || record.candidate_digest === null || isSafeToken(record.candidate_digest))
}

function attemptBranchId(record: AttemptLedgerRecord): string {
  return record.branch_id || "default"
}

function readAttemptLedger(ledgerPath: string): { records: AttemptLedgerRecord[]; error?: string } {
  let stat: fsSync.Stats
  try {
    stat = fsSync.statSync(ledgerPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { records: [] }
    return { records: [], error: "attempt-ledger-read-failed" }
  }

  if (!stat.isFile() || stat.size > ATTEMPT_LEDGER_MAX_BYTES) {
    return { records: [], error: "attempt-ledger-limit" }
  }

  let content: string
  try {
    content = fsSync.readFileSync(ledgerPath, "utf8")
  } catch {
    return { records: [], error: "attempt-ledger-read-failed" }
  }

  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === "") lines.pop()
  if (lines.length > ATTEMPT_LEDGER_MAX_LINES) return { records: [], error: "attempt-ledger-limit" }

  const records: AttemptLedgerRecord[] = []
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > ATTEMPT_LEDGER_MAX_LINE_BYTES) {
      return { records: [], error: "attempt-ledger-limit" }
    }
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isAttemptLedgerRecord(parsed)) return { records: [], error: "attempt-ledger-invalid" }
      records.push(parsed)
    } catch {
      return { records: [], error: "attempt-ledger-invalid" }
    }
  }
  return { records }
}

function appendAttemptLedgerRecord(ledgerPath: string, record: AttemptLedgerRecord): string | null {
  const line = JSON.stringify(record)
  const lineBytes = Buffer.byteLength(line, "utf8") + 1
  if (lineBytes > ATTEMPT_LEDGER_MAX_LINE_BYTES) return "attempt-ledger-limit"

  try {
    fsSync.mkdirSync(path.dirname(ledgerPath), { recursive: true })
    let currentBytes = 0
    try {
      currentBytes = fsSync.statSync(ledgerPath).size
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return "attempt-ledger-read-failed"
    }
    if (currentBytes + lineBytes > ATTEMPT_LEDGER_MAX_BYTES) return "attempt-ledger-limit"
    if (currentBytes > 0) {
      const existing = fsSync.readFileSync(ledgerPath, "utf8")
      const existingLines = existing.split(/\r?\n/)
      if (existingLines.at(-1) === "") existingLines.pop()
      if (existingLines.length >= ATTEMPT_LEDGER_MAX_LINES) return "attempt-ledger-limit"
    }

    // appendFileSync opens with O_APPEND, keeping each bounded record append-only.
    fsSync.appendFileSync(ledgerPath, `${line}\n`, { encoding: "utf8", flag: "a" })
    return null
  } catch {
    return "attempt-ledger-write-failed"
  }
}

type AttemptLedgerLockResult<T> =
  | { locked: true; value: T }
  | { locked: false; error: string }

function withAttemptLedgerLock<T>(ledgerPath: string, operation: () => T): AttemptLedgerLockResult<T> {
  const lockPath = `${ledgerPath}${ATTEMPT_LEDGER_LOCK_SUFFIX}`
  let lockFd: number | null = null

  try {
    fsSync.mkdirSync(path.dirname(ledgerPath), { recursive: true })
    try {
      // O_EXCL makes acquisition atomic across processes; contention fails closed.
      lockFd = fsSync.openSync(lockPath, "wx")
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return { locked: false, error: code === "EEXIST" ? "attempt-ledger-locked" : "attempt-ledger-lock-failed" }
    }
    return { locked: true, value: operation() }
  } catch {
    return { locked: false, error: "attempt-ledger-lock-failed" }
  } finally {
    if (lockFd !== null) {
      try { fsSync.closeSync(lockFd) } catch { /* best-effort */ }
      try {
        fsSync.unlinkSync(lockPath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`[odf-delegation] Failed to clean up attempt ledger lock: ${lockPath}`)
        }
      }
    }
  }
}

/** Candidate digest of a workspace, or null when git is unavailable (T3 makes it mandatory). */
function candidateDigestOrNull(workspaceDir: string): string | null {
  const manifest = buildCandidateManifest(workspaceDir)
  return manifest.base_head !== null ? computeCandidateDigest(manifest) : null
}

function acquireAttempt(opts: {
  workspaceDir: string
  change: string
  phase: AttemptLedgerPhase
  nextStage: "BUILD" | "VERIFY"
  attemptId: string
  branchId?: string
}): AttemptAcquisitionResult {
  const ledgerPath = attemptLedgerPath(opts.workspaceDir, opts.change)
  const branchId = opts.branchId || "default"
  const result = withAttemptLedgerLock<AttemptAcquisitionResult>(ledgerPath, (): AttemptAcquisitionResult => {
    const ledger = readAttemptLedger(ledgerPath)
    if (ledger.error) {
      return { acquired: false, reason: ledger.error, message: "The attempt ledger could not be read safely." }
    }
    if (ledger.records.some(record => attemptBranchId(record) === branchId && record.attempt_id === opts.attemptId)) {
      return { acquired: false, reason: "attempt-id-reused", message: "The attempt_id was already used for this branch." }
    }

    const latestPhaseRecord = ledger.records
      .filter(record => attemptBranchId(record) === branchId && record.phase === opts.phase)
      .at(-1)
    if (latestPhaseRecord?.status === "running") {
      return { acquired: false, reason: "attempt-phase-running", message: `A ${opts.phase} attempt is already running.` }
    }
    if (latestPhaseRecord?.status === "completed") {
      return { acquired: false, reason: "attempt-phase-completed", message: `The ${opts.phase} phase is already completed.` }
    }

    const now = new Date().toISOString()
    const record: AttemptLedgerRecord = {
      attempt_id: opts.attemptId,
      branch_id: branchId,
      change: opts.change,
      phase: opts.phase,
      next_stage: opts.nextStage,
      status: "running",
      started_at: now,
      updated_at: now,
      settled_at: null,
      reason: "acquired",
      result_status: "running",
      candidate_digest: candidateDigestOrNull(opts.workspaceDir),
    }
    const appendError = appendAttemptLedgerRecord(ledgerPath, record)
    if (appendError) {
      return { acquired: false, reason: appendError, message: "The attempt could not be acquired safely." }
    }
    return { acquired: true, handle: { ledgerPath, record } }
  })
  if (!result.locked) {
    return { acquired: false, reason: result.error, message: "The attempt could not be acquired safely." }
  }
  return result.value
}

function settleAttempt(
  attempt: AcquiredAttempt,
  status: Exclude<AttemptLedgerStatus, "running">,
  resultStatus: Exclude<AttemptLedgerResultStatus, "running">,
  reason: Exclude<AttemptLedgerReason, "acquired">,
): void {
  const now = new Date().toISOString()
  const settled: AttemptLedgerRecord = {
    ...attempt.record,
    status,
    updated_at: now,
    settled_at: now,
    reason,
    result_status: resultStatus,
  }
  const result = withAttemptLedgerLock(attempt.ledgerPath, () => appendAttemptLedgerRecord(attempt.ledgerPath, settled))
  if (!result.locked) {
    console.warn(`[odf-delegation] Failed to settle attempt ledger: ${result.error}`)
  } else if (result.value) {
    console.warn(`[odf-delegation] Failed to settle attempt ledger: ${result.value}`)
  }
}

// ==========================================
// POLICY GATE (slice 1)
// ==========================================

export interface PolicyGateDecision {
  change: string
  phase: "IMPLEMENT" | "VERIFY"
  gate: "allow" | "block"
  reason: string
  tdd: {
    global: boolean
    local_readable: boolean
    local_off: boolean
    effective: "on" | "off"
  }
  risk_tier: "LOW" | "MEDIUM" | "HIGH"
  frozen_diff_ref: string | null
  candidate_digest: string | null
  base_head: string | null
  changed_lines: number | null
  correction_budget_lines: number | null
  changed_paths: string[]
  resolved_at: string
}

/**
 * Classify the risk tier of a change from its changed paths.
 * HIGH: security files, CSV access rules, ir.model.access.
 * LOW: passive byte-proven files (views/data XML, docs, po, demo yml, manifest).
 * Everything else (models, controllers, raw Python) → MEDIUM.
 */
export function classifyRiskTier(changedPaths: string[]): "LOW" | "MEDIUM" | "HIGH" {
  // ponytail: filename-first tier, escalate-only content scan in classifyRiskTierWithContent
  const HIGH_PATTERNS = [
    /security\//i,
    /ir\.model\.access/i,
    /\.csv$/i,
    /groups=/i,
    /_security/i,
  ]
  const LOW_PATTERNS = [
    /views\/[^/]+\.xml$/i,
    /data\/[^/]+\.xml$/i,
    /\.ya?ml$/i,
    /\.md$/i,
    /\.po$/i,
    /\.pot$/i,
    /__manifest__\.py$/i,
  ]

  for (const p of changedPaths) {
    if (HIGH_PATTERNS.some(rx => rx.test(p))) return "HIGH"
  }
  if (changedPaths.length === 0) return "MEDIUM"
  return changedPaths.every(p => LOW_PATTERNS.some(rx => rx.test(p))) ? "LOW" : "MEDIUM"
}

/**
 * Content-aware tier escalation (slice 5). Filename-only classification misses
 * security signals inside otherwise innocent-looking files (raw SQL with
 * interpolation, eval, subprocess, record rules). This scan can ONLY escalate
 * to HIGH — never downgrade — and reads at most MAX bytes per changed file,
 * skipping unreadable or missing ones.
 */
const HIGH_CONTENT_PATTERNS = [
  /env\.cr\s*\.\s*execute|cr\s*\.\s*execute\s*\(/i, // raw SQL
  /\beval\s*\(/i, // eval()
  /\bexec\s*\(/i, // exec()
  /subprocess\s*\.|os\.system\s*\(|shell\s*=\s*True/i, // shell escape
  /model\s*=\s*["']ir\.(?:rule|model\.access)["']/i, // security record in XML
  /groups\s*=\s*["'][^"']*["']/i, // group assignment in data/views
]
const HIGH_CONTENT_MAX_BYTES = 64 * 1024

export function classifyRiskTierWithContent(changedPaths: string[], workspaceDir: string): "LOW" | "MEDIUM" | "HIGH" {
  const byName = classifyRiskTier(changedPaths)
  if (byName === "HIGH") return "HIGH"

  for (const p of changedPaths) {
    let fd: number | null = null
    try {
      const abs = path.resolve(workspaceDir, p)
      fd = fsSync.openSync(abs, "r")
      const buf = Buffer.alloc(HIGH_CONTENT_MAX_BYTES)
      const bytes = fsSync.readSync(fd, buf, 0, HIGH_CONTENT_MAX_BYTES, 0)
      const content = buf.subarray(0, bytes).toString("utf8")
      if (HIGH_CONTENT_PATTERNS.some(rx => rx.test(content))) return "HIGH"
    } catch {
      // Unreadable or missing file — skip; filename tier stands.
    } finally {
      if (fd !== null) {
        try { fsSync.closeSync(fd) } catch { /* best-effort */ }
      }
    }
  }
  return byName
}

export function gitHead(workspaceDir: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null
  } catch {
    return null
  }
}

/**
 * Effective TDD = global `flags.strict_tdd` (registry) AND absence of the
 * local marker `<worktree>/.odf/tdd.off`. Any off → effective OFF; an
 * unreadable local source (anything but ENOENT) → fail-closed OFF.
 */
function resolveTddEffective(
  registry: ODFRegistry,
  workspaceDir: string
): { global: boolean; local_readable: boolean; local_off: boolean; effective: "on" | "off" } {
  const global = registry.flags?.strict_tdd === true
  const marker = path.join(workspaceDir, ".odf", "tdd.off")
  let localReadable = false
  let localOff = false
  try {
    fsSync.readFileSync(marker, "utf8")
    localOff = true
    localReadable = true
  } catch (err) {
    localOff = false
    localReadable = (err as NodeJS.ErrnoException).code === "ENOENT"
  }
  const effective = global && localReadable && !localOff ? "on" : "off"
  return { global, local_readable: localReadable, local_off: localOff, effective }
}

export function savePolicyGateJson(workspaceDir: string, decision: PolicyGateDecision): void {
  try {
    const dir = path.join(workspaceDir, ".odf")
    fsSync.mkdirSync(dir, { recursive: true })
    fsSync.writeFileSync(
      path.join(dir, `policy-gate-${decision.change}.json`),
      JSON.stringify(decision, null, 2),
      "utf8"
    )
  } catch (err) {
    console.warn(`[odf-delegation] Failed to persist policy gate for ${decision.change}: ${err}`)
  }
}

/**
 * Resolve and persist the Policy Gate for a change before IMPLEMENT/VERIFY.
 * Resolves effective TDD and, for VERIFY, freezes the diff ref, counts changed
 * lines, classifies the risk tier, and computes the correction budget.
 *
 * The gate DOCUMENTS the decision — it does not analyze code. `gate` stays
 * "allow" except for hard conditions (missing change name). Idempotent: reuses
 * a persisted decision with the same phase + frozen diff ref (no re-freeze).
 */
export function computePolicyGate(opts: {
  change: string
  phase: "IMPLEMENT" | "VERIFY"
  workspaceDir?: string
  registry: ODFRegistry
}): PolicyGateDecision {
  const workspace = resolveWorkspaceRoot(opts.workspaceDir || process.cwd())
  const tdd = resolveTddEffective(opts.registry, workspace)

  if (!opts.change || !opts.change.trim()) {
    return {
      change: opts.change || "",
      phase: opts.phase,
      gate: "block",
      reason: "missing change name — cannot persist a policy gate",
      tdd,
      risk_tier: "MEDIUM",
      frozen_diff_ref: null,
      candidate_digest: null,
      base_head: null,
      changed_lines: null,
      correction_budget_lines: null,
      changed_paths: [],
      resolved_at: new Date().toISOString(),
    }
  }

  const gatePath = path.join(workspace, ".odf", `policy-gate-${opts.change}.json`)
  const manifest = buildCandidateManifest(workspace)
  const head = manifest.base_head

  // Idempotency: reuse a frozen decision for the same change + phase only when
  // the candidate bytes are unchanged (digest match), not merely when HEAD is.
  try {
    const existing = JSON.parse(fsSync.readFileSync(gatePath, "utf8")) as PolicyGateDecision
    if (
      existing.phase === opts.phase &&
      head !== null &&
      existing.candidate_digest != null &&
      existing.candidate_digest === computeCandidateDigest(manifest)
    ) {
      return existing
    }
  } catch {
    // No prior gate, stale, or unreadable → recompute.
  }

  let frozenDiffRef: string | null = null
  let candidateDigest: string | null = null
  let baseHead: string | null = null
  let changedLines: number | null = null
  let changedPaths: string[] = []
  let riskTier: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM"
  let correctionBudget: number | null = null

  if (opts.phase === "VERIFY") {
    frozenDiffRef = head
    baseHead = head
    if (head !== null) {
      candidateDigest = computeCandidateDigest(manifest)
      try {
        const numstat = execSync("git diff --numstat HEAD", { cwd: workspace, encoding: "utf8" }).trim()
        changedLines = numstat
          .split("\n")
          .filter(Boolean)
          .reduce((sum, line) => {
            const [add, del] = line.split("\t")
            const a = parseInt(add, 10)
            const d = parseInt(del, 10)
            return sum + (Number.isFinite(a) ? a : 0) + (Number.isFinite(d) ? d : 0)
          }, 0)
      } catch {
        changedLines = null
      }
      changedPaths = extractChangedPaths(manifest)
      riskTier = classifyRiskTierWithContent(changedPaths, workspace)
      correctionBudget = changedLines != null ? Math.min(200, Math.ceil(changedLines / 2)) : null
    } else {
      // git unavailable → fail-closed for VERIFY: no reproducible candidate
      // means verification cannot be bound to anything, so the delegation must
      // not run. The user must make the candidate reproducible first.
      return {
        change: opts.change,
        phase: opts.phase,
        gate: "block",
        reason: "verification-unavailable: initialize a git repository or provide candidate discovery; verification cannot proceed without a reproducible candidate",
        tdd,
        risk_tier: "MEDIUM",
        frozen_diff_ref: null,
        candidate_digest: null,
        base_head: null,
        changed_lines: null,
        correction_budget_lines: null,
        changed_paths: [],
        resolved_at: new Date().toISOString(),
      }
    }
  }

  const decision: PolicyGateDecision = {
    change: opts.change,
    phase: opts.phase,
    gate: "allow",
    reason:
      opts.phase === "VERIFY"
        ? "policy gate documented — sub-agent verifies against the frozen diff ref"
        : "policy gate documented — TDD enforcement lives in the odf-tdd skill",
    tdd,
    risk_tier: riskTier,
    frozen_diff_ref: frozenDiffRef,
    candidate_digest: candidateDigest,
    base_head: baseHead,
    changed_lines: changedLines,
    correction_budget_lines: correctionBudget,
    changed_paths: changedPaths,
    resolved_at: new Date().toISOString(),
  }

  savePolicyGateJson(workspace, decision)
  return decision
}

function extractChangeName(prompt: string): string | null {
  const match = prompt.match(/[Cc]hange\s+name\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9_-]*)/)
  return match ? match[1] : null
}

// ==========================================
// STOP-VALIDATION EVIDENCE (slice 2)
// ==========================================

export interface ValidationEvidenceCommand {
  name: string
  command: string
  database?: string
  exit_code: number
  output_tail: string
  output_evidence?: string
}

export interface ValidationEvidenceFile {
  change: string
  phase: string
  batch: number
  risk_tier: "LOW" | "MEDIUM" | "HIGH"
  frozen_diff_ref: string | null
  candidate_digest?: string | null
  executor?: string
  test_identity?: string
  expectations_ids?: string[]
  resolved_at: string
  commands: ValidationEvidenceCommand[]
}

export interface ValidationVerdict {
  status: "verified" | "missing" | "invalid"
  reason: string
  commands_validated: number
  warnings?: string[]
  expectations_ids?: string[]
}

const EVIDENCE_FRESHNESS_MS = 60 * 60 * 1000 // 60 min window

function validationEvidenceRelativePath(change: string, branchId?: string): string {
  const suffix = branchId ? `-${branchId}` : ""
  return path.join(".odf", `validation-evidence-${change}${suffix}.json`)
}

/** Minimum evidence commands required per risk tier. */
const EVIDENCE_MIN_COMMANDS: Record<"LOW" | "MEDIUM" | "HIGH", number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
}

/** Minimal output patterns keyed by command name (only for known commands). */
const EVIDENCE_PATTERNS: Record<string, RegExp> = {
  "odoo-tests": /0 failed/i,
  "odoo-test": /0 failed/i,
  "pytest-odoo": /0 failed/i,
  "pre-commit": /all checks passed/i,
  "pylint-odoo": /^(?:-+)?\s*$/m,
  "pylint": /^(?:-+)?\s*$/m,
}

/**
 * Deterministic stop-validation seal. The sub-agent executes the commands and
 * writes `<worktree>/.odf/validation-evidence-{change}.json`; this function
 * validates the ARTIFACT with blind rules (no prose, no LLM judgment):
 *
 * - present + parseable
 * - `change` bound to the expected change
 * - `frozen_diff_ref` bound to the policy gate (when the gate has a ref)
 * - fresh: `resolved_at` within EVIDENCE_FRESHNESS_MS of now
 * - at least EVIDENCE_MIN_COMMANDS[tier] commands
 * - every command exit_code === 0
 * - known commands match their minimal output pattern
 */
export function validateValidationEvidence(opts: {
  workspaceDir: string
  change: string
  tier: "LOW" | "MEDIUM" | "HIGH"
  frozenDiffRef: string | null
  evidencePath?: string
  expectationsIds?: string[]
  now?: Date
}): ValidationVerdict {
  const now = opts.now || new Date()
  const evidencePath = opts.evidencePath || validationEvidenceRelativePath(opts.change)
  if (path.isAbsolute(evidencePath) || evidencePath.split(/[\\/]/).includes("..")) {
    return { status: "invalid", reason: "validation-evidence path is unsafe", commands_validated: 0 }
  }
  const filePath = path.resolve(opts.workspaceDir, evidencePath)
  if (!isWithinRoot(filePath, path.resolve(opts.workspaceDir))) {
    return { status: "invalid", reason: "validation-evidence path escapes workspace root", commands_validated: 0 }
  }

  let raw: string
  try {
    raw = fsSync.readFileSync(filePath, "utf8")
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      return { status: "missing", reason: "validation-evidence file not found — run stop-validation commands and write the evidence file", commands_validated: 0 }
    }
    return { status: "invalid", reason: "validation-evidence file unreadable", commands_validated: 0 }
  }

  let evidence: ValidationEvidenceFile
  try {
    evidence = JSON.parse(raw) as ValidationEvidenceFile
  } catch {
    return { status: "invalid", reason: "validation-evidence file is not valid JSON", commands_validated: 0 }
  }

  if (evidence.change !== opts.change) {
    return { status: "invalid", reason: `validation-evidence change "${evidence.change}" does not match "${opts.change}"`, commands_validated: 0 }
  }

  if (evidence.candidate_digest != null) {
    const freshDigest = candidateDigestOrNull(opts.workspaceDir)
    if (freshDigest !== null && evidence.candidate_digest !== freshDigest) {
      return {
        status: "invalid",
        reason: `candidate digest mismatch: evidence bound to ${evidence.candidate_digest}, workspace candidate is ${freshDigest}`,
        commands_validated: 0,
      }
    }
  }

  if (opts.frozenDiffRef != null && evidence.frozen_diff_ref !== opts.frozenDiffRef) {
    return { status: "invalid", reason: "validation-evidence frozen_diff_ref does not match the policy gate frozen ref", commands_validated: 0 }
  }

  const resolvedAt = new Date(evidence.resolved_at).getTime()
  if (!Number.isFinite(resolvedAt)) {
    return { status: "invalid", reason: "validation-evidence resolved_at is not a valid timestamp", commands_validated: 0 }
  }
  const ageMs = now.getTime() - resolvedAt
  if (ageMs < 0 || ageMs > EVIDENCE_FRESHNESS_MS) {
    return { status: "invalid", reason: `validation-evidence is stale (resolved ${Math.round(ageMs / 1000)}s ago, window ${EVIDENCE_FRESHNESS_MS / 1000}s)`, commands_validated: 0 }
  }

  const isVerify = evidence.phase === "VERIFY"
  const commands = Array.isArray(evidence.commands) ? evidence.commands : []
  if (isVerify && commands.length === 0) {
    return { status: "invalid", reason: "verification-evidence requires at least one command — status-only evidence is not accepted", commands_validated: 0 }
  }
  if (commands.length < EVIDENCE_MIN_COMMANDS[opts.tier]) {
    return { status: "invalid", reason: `tier ${opts.tier} requires at least ${EVIDENCE_MIN_COMMANDS[opts.tier]} command(s), got ${commands.length}`, commands_validated: commands.length }
  }
  if (isVerify) {
    if (typeof evidence.executor !== "string" || !evidence.executor.trim()) {
      return { status: "invalid", reason: "verification-evidence is missing executor — who ran the verification", commands_validated: 0 }
    }
    if (typeof evidence.test_identity !== "string" || !evidence.test_identity.trim()) {
      return { status: "invalid", reason: "verification-evidence is missing test_identity — which test suite ran", commands_validated: 0 }
    }
    const freshDigest = candidateDigestOrNull(opts.workspaceDir)
    if (freshDigest !== null && (typeof evidence.candidate_digest !== "string" || !evidence.candidate_digest.trim())) {
      return { status: "invalid", reason: "candidate_digest required for verification-evidence — bind the receipt to the verified candidate", commands_validated: 0 }
    }
  }

  let checked = 0
  for (const cmd of commands) {
    if (!cmd || typeof cmd.name !== "string" || typeof cmd.exit_code !== "number") {
      return { status: "invalid", reason: "evidence command missing name or exit_code", commands_validated: checked }
    }
    if (isVerify) {
      if (typeof cmd.command !== "string" || !cmd.command.trim()) {
        return { status: "invalid", reason: `command "${cmd.name}" is missing the full command line`, commands_validated: checked }
      }
      if (typeof cmd.database !== "string" || !cmd.database.trim()) {
        return { status: "invalid", reason: `command "${cmd.name}" is missing the database context`, commands_validated: checked }
      }
      if (!(typeof cmd.output_tail === "string" && cmd.output_tail.trim()) && !(typeof cmd.output_evidence === "string" && cmd.output_evidence.trim())) {
        return { status: "invalid", reason: `command "${cmd.name}" is missing output evidence`, commands_validated: checked }
      }
    }
    if (cmd.exit_code !== 0) {
      return { status: "invalid", reason: `command "${cmd.name}" exited with ${cmd.exit_code}`, commands_validated: checked }
    }
    if (["odoo-tests", "odoo-test", "pytest-odoo"].includes(cmd.name)) {
      if (typeof cmd.database !== "string" || !cmd.database.trim()) {
        return { status: "invalid", reason: `command "${cmd.name}" is missing an explicit isolated database`, commands_validated: checked }
      }
      if (!/\s-d\s+\S+/.test(cmd.command)) {
        return { status: "invalid", reason: `command "${cmd.name}" is missing explicit -d <test_db>`, commands_validated: checked }
      }
    }
    const pattern = EVIDENCE_PATTERNS[cmd.name]
    if (pattern && !pattern.test(cmd.output_evidence || cmd.output_tail || "")) {
      return { status: "invalid", reason: `command "${cmd.name}" output does not match expected success pattern`, commands_validated: checked }
    }
    checked += 1
  }

  const expectationsIds = opts.expectationsIds || evidence.expectations_ids
  return {
    status: "verified",
    reason: `stop-validation evidence verified (${checked} command(s))`,
    commands_validated: checked,
    ...(expectationsIds?.length ? { expectations_ids: expectationsIds } : {}),
  }
}

// ==========================================
// RECEIPT + FAILURE DISPOSITION (slice 4)
// ==========================================

export interface ODFReceipt {
  change: string
  phase: "PROPOSE" | "ASSESS" | "QA-PLAN" | "DESIGN" | "IMPLEMENT" | "VERIFY" | "EXPLORE" | "FIX"
  status: "ok" | "warning" | "blocked" | "failed"
  cause: "validation-failed" | "error" | "timeout" | "scope-change" | "re-plan" | "abandon" | null
  evidence: {
    summary: string
    frozen_diff_ref: string | null
    failing: string[]
    refs: string[]
  } | null
  action: { committed: "scope-change" | "re-plan" | "abandon" | "retry" | "none"; user_decision?: string } | null
  review_gate: { attempts_used: number; budget_lines: number | null; verdict: "FAIL" | "PASS" | "PASS_WITH_WARNINGS" } | null
  frozen_diff_ref: string | null
  candidate_digest?: string | null
  expectations_ids?: string[]
  resolved_at: string
  parallel?: {
    branch_ids: string[]
    summaries: Record<string, string>
    attempt_ledger_refs: string[]
    validation_evidence_refs: string[]
  }
}

export function saveReceiptJson(workspaceDir: string, receipt: ODFReceipt): void {
  try {
    const dir = path.join(workspaceDir, ".odf")
    fsSync.mkdirSync(dir, { recursive: true })
    fsSync.writeFileSync(
      path.join(dir, `receipt-${receipt.change}.json`),
      JSON.stringify(receipt, null, 2),
      "utf8"
    )
  } catch (err) {
    console.warn(`[odf-delegation] Failed to persist receipt for ${receipt.change}: ${err}`)
  }
}

/**
 * Upsert a receipt without clobbering a resolved one. A receipt whose `action`
 * is set is terminal until a deliberate transition; an update with `action:
 * null` never overwrites an existing set action.
 *
 * A written receipt is bound to the candidate digest current at write time
 * (stamped over any caller value), so a later write for the same change after a
 * candidate mutation never inherits the old candidate's binding.
 */
export function mergeReceipt(
  workspaceDir: string,
  incoming: ODFReceipt
): ODFReceipt {  try {
    const existing = JSON.parse(
      fsSync.readFileSync(path.join(workspaceDir, ".odf", `receipt-${incoming.change}.json`), "utf8")
    ) as ODFReceipt
    if (existing.action && !incoming.action) {
      return existing
    }
    if (existing.action && incoming.action && incoming.action.committed !== "retry") {
      return existing
    }
  } catch {
    // No prior receipt or unreadable → write incoming.
  }
  incoming.candidate_digest = candidateDigestOrNull(workspaceDir)
  saveReceiptJson(workspaceDir, incoming)
  return incoming
}

export function createODFReceipt(): ReturnType<typeof tool> {
  return tool({    description: `Persist an ODF receipt (failure disposition) for a change.

Writes/merges <worktree>/.odf/receipt-{change}.json. Use after a phase fails or
blocked: record the cause, evidence refs, and the committed action
(scope-change | re-plan | abandon | retry). A receipt with an action set is
terminal until a deliberate transition — an update without action never
overwrites it. Best-effort like the policy gate: never blocks the flow.`,
    args: {
      change: tool.schema
        .string()
        .describe("Change name (kebab-case)"),
      phase: tool.schema
        .enum(["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY", "EXPLORE", "FIX"])
        .describe("Phase that produced the receipt"),
      status: tool.schema
        .enum(["ok", "warning", "blocked", "failed"])
        .describe("Phase outcome (result-contract status)"),
      cause: tool.schema
        .enum(["validation-failed", "error", "timeout", "scope-change", "re-plan", "abandon"])
        .optional()
        .describe("Why the phase failed/blocked"),
      evidence_summary: tool.schema
        .string()
        .optional()
        .describe("Short decision-grade summary of the evidence"),
      failing: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Commands/tests that failed"),
      refs: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Topic keys / paths of the evidence (e.g. odf/{change}/verify-report)"),
      action: tool.schema
        .enum(["scope-change", "re-plan", "abandon", "retry", "none"])
        .optional()
        .describe("Committed next step (set when the user decides)"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Project directory (defaults to cwd)"),
    },
    async execute(args: {
      change: string
      phase: ODFReceipt["phase"]
      status: ODFReceipt["status"]
      cause?: ODFReceipt["cause"]
      evidence_summary?: string
      failing?: string[]
      refs?: string[]
      action?: "scope-change" | "re-plan" | "abandon" | "retry" | "none"
      workspace_dir?: string
    }): Promise<string> {
      const workspace = resolveWorkspaceRoot(args.workspace_dir || process.cwd())
      const receipt: ODFReceipt = {
        change: args.change,
        phase: args.phase,
        status: args.status,
        cause: args.cause || null,
        evidence:
          args.evidence_summary || args.failing?.length || args.refs?.length
            ? {
                summary: args.evidence_summary || "",
                frozen_diff_ref: gitHead(workspace),
                failing: args.failing || [],
                refs: args.refs || [],
              }
            : null,
      action: args.action ? { committed: args.action } : null,
      review_gate: args.phase === "VERIFY" ? { attempts_used: 1, budget_lines: null, verdict: args.status === "ok" ? "PASS" : args.status === "warning" ? "PASS_WITH_WARNINGS" : "FAIL" } : null,
      frozen_diff_ref: gitHead(workspace),
      resolved_at: new Date().toISOString(),
    }
    const merged = mergeReceipt(workspace, receipt)
    const mergedAction = merged.action?.committed || "pending"
    debugLog(`[odf-delegation] odf_receipt: change=${merged.change} phase=${merged.phase} status=${merged.status} cause=${merged.cause} action=${mergedAction}`)
    return JSON.stringify(merged, null, 2)
  },
})
}

function createODFPolicyGate(): ReturnType<typeof tool> {
  return tool({
    description: `Resolve and persist the ODF Policy Gate for a change before IMPLEMENT/VERIFY.

Resolves the effective TDD mode (global flags.strict_tdd AND local <worktree>/.odf/tdd.off;
any off or unreadable local → off, fail-closed) and, for VERIFY, freezes the diff ref
(git rev-parse HEAD), counts the original changed lines, classifies the risk tier from the
changed paths, and computes the correction budget (min(200, ceil(lines/2))).
Persists the decision to <worktree>/.odf/policy-gate-{change}.json (idempotent for the same
frozen diff ref). The gate documents — the sub-agent applies, never recomputes.`,
    args: {
      change: tool.schema
        .string()
        .describe("Change name (kebab-case)"),
      phase: tool.schema
        .enum(["IMPLEMENT", "VERIFY"])
        .describe("Phase to gate"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Project directory (defaults to cwd)"),
    },
    async execute(args: { change: string; phase: "IMPLEMENT" | "VERIFY"; workspace_dir?: string }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        const blocked: PolicyGateDecision = {
          change: args.change,
          phase: args.phase,
          gate: "block",
          reason: "ODF registry not found — cannot resolve TDD",
          tdd: { global: false, local_readable: false, local_off: false, effective: "off" },
          risk_tier: "MEDIUM",
          frozen_diff_ref: null,
          candidate_digest: null,
          base_head: null,
          changed_lines: null,
          correction_budget_lines: null,
          changed_paths: [],
          resolved_at: new Date().toISOString(),
        }
        return JSON.stringify(blocked, null, 2)
      }
      const decision = computePolicyGate({
        change: args.change,
        phase: args.phase,
        workspaceDir: args.workspace_dir,
        registry,
      })
      debugLog(`[odf-delegation] odf_policy_gate: change=${decision.change} phase=${decision.phase} gate=${decision.gate} tdd=${decision.tdd.effective} tier=${decision.risk_tier}`)
      return JSON.stringify(decision, null, 2)
    },
  })
}

// ==========================================
// TOOL CREATORS
// ==========================================

function createODFDelegate(
  client?: OpencodeClient,
  canonicalDirectory?: string,
  defaultExecutionOptions: DelegateExecutionOptions = {},
): ReturnType<typeof tool> {
  return tool({
    description: `Delegate an ODF task to the appropriate phase-specific agent.

This tool:
1. Reads the ODF registry to find the best agent for the phase
2. Injects relevant skill compact rules into the prompt
 3. Delegates via the native task tool when available, or returns a structured blocked envelope when unavailable

Use this instead of generic task() for ODF workflow delegation.`,
    args: {
      phase: tool.schema
        .string()
        .describe("ODF phase: PROPOSE, ASSESS, QA-PLAN, DESIGN, IMPLEMENT, VERIFY, EXPLORE, FIX"),
      prompt: tool.schema
        .string()
        .describe("The full detailed prompt for the agent."),
      context_files: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Files the agent will work with (for skill matching)"),
      profile: tool.schema
        .string()
        .optional()
        .describe("Optional SDD profile name override"),
      change: tool.schema
        .string()
        .optional()
        .describe("Change name (kebab-case) — used by the Policy Gate hook for IMPLEMENT/VERIFY"),
      timeout_ms: tool.schema
        .number()
        .optional()
        .describe("Task timeout in milliseconds (default: 120000)"),
      attempt_id: tool.schema
        .string()
        .optional()
        .describe("Fresh opaque attempt token for gated IMPLEMENT/VERIFY execution"),
      artifact_store: tool.schema
        .enum(["openspec", "engram", "hybrid"])
        .optional()
        .describe("Authoritative workflow store; required when workflow_advance proof is supplied"),
      workflow_advance: tool.schema
        .object({
          work_type: tool.schema
            .enum([
              "question",
              "investigation",
              "standard-config",
              "small-change",
              "feature",
              "cross-domain",
              "bugfix",
              "migration",
              "security",
              "verify-only",
            ])
            .describe("Resolved work type for the transition"),
          completed_stages: tool.schema
            .array(tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"]))
            .describe("Canonical stages already completed before candidate_stage"),
          candidate_stage: tool.schema
            .enum(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"])
            .nullable()
            .describe("Canonical stage that just completed; null only for an initial transition"),
          phase_result_status: tool.schema
            .enum(["ok", "warning", "blocked", "failed"])
            .describe("Result-contract status for the completed phase"),
          validation_status: tool.schema
            .enum(["verified", "missing", "invalid", "not-required"])
            .describe("Validation seal status"),
          receipt_state: tool.schema
            .enum(["none", "pending", "resolved"])
            .describe("Current receipt state"),
          resumable_state: tool.schema
            .boolean()
            .describe("Whether the workflow can resume"),
          archived_state: tool.schema
            .boolean()
            .describe("Whether the workflow is archived"),
        })
        .optional()
        .describe("Optional machine-checked transition proof for canonical BUILD/VERIFY starts"),
    },
    async execute(args: InternalODFDelegateArgs, toolCtx: ToolContext): Promise<string> {
      if (!toolCtx?.sessionID) {
        return "❌ odf_delegate requires sessionID"
      }

      const executionOptions: DelegateExecutionOptions = {
        ...defaultExecutionOptions,
        ...(args.__options || {}),
      }
      const metricContext = {
        work_type: args.workflow_advance?.work_type,
        branch_id: executionOptions.branch_id,
        // T7: capture host runtime telemetry (model/provider/tokens) when the
        // toolCtx exposes it. This host's ToolContext does not, so these stay
        // null / model_available=false — never synthesized.
        ...hostTelemetryFromContext(toolCtx),
      }

      if (!ALLOWED_PHASES.includes(args.phase)) {
        return `❌ Invalid phase "${args.phase}". Allowed: ${ALLOWED_PHASES.join(", ")}`
      }

      const startTime = Date.now()
      const blockWorkflow = (reason: string, message: string, workflowResult: ReturnType<typeof advanceWorkflow> | null, extra: Record<string, unknown> = {}): string => {
        recordMetrics({
          timestamp: new Date().toISOString(),
          session_id: toolCtx.sessionID,
          phase: args.phase,
          agent: "unresolved",
          skills_injected: [],
          skill_resolution: "none",
          duration_ms: Date.now() - startTime,
          token_estimate: estimateTokens(args.prompt),
           status: "blocked",
           task_api_source: "unavailable",
           ...metricContext,
           error: message,
        })
        return JSON.stringify({
          status: "blocked",
          reason,
          phase: args.phase,
          agent: null,
          skills_injected: [],
          profile: null,
          policy_gate: null,
          validation: null,
          receipt: null,
          task_api_source: "unavailable",
          result: null,
          workflow_advance: workflowResult,
          message,
          ...extra,
        }, null, 2)
      }

      const gatedPhase = args.phase === "IMPLEMENT" || args.phase === "VERIFY"
      let registry: ODFRegistry | null = null
      if (gatedPhase && !args.workflow_advance) {
        registry = await loadRegistry()
        if (registry?.flags?.strict_workflow === true) {
          return blockWorkflow(
            "strict-workflow-proof-required",
            "Strict workflow mode requires workflow_advance for IMPLEMENT/VERIFY; legacy omissions are allowed only when flags.strict_workflow is false.",
            null,
          )
        }
      }

      const workspaceRoot = resolveWorkspaceRoot(canonicalDirectory || process.cwd())
      const changeName = args.change?.trim() || extractChangeName(args.prompt)

      let acquiredAttempt: AcquiredAttempt | null = executionOptions.pre_acquired_attempt || null
      let workflowResult: ReturnType<typeof advanceWorkflow> | null = executionOptions.workflow_result || null
      let effectiveWorkflowAdvance: ODFDelegateWorkflowAdvance | null = null
      if (args.workflow_advance) {
        if (args.artifact_store === undefined) {
          return blockWorkflow(
            "artifact-store-required",
            "Proof-backed IMPLEMENT/VERIFY delegation requires an explicit artifact_store: openspec, engram, or hybrid.",
            null,
          )
        }
        const expectedStage: "BUILD" | "VERIFY" = args.phase === "IMPLEMENT" ? "BUILD" : "VERIFY"
        const { work_type: callerWorkType, ...callerAdvanceInput } = args.workflow_advance
        const callerResult = advanceWorkflow({
          route: resolveWorkflowRoute(callerWorkType),
          ...callerAdvanceInput,
          // Caller state is only a structural preflight. Persisted state and receipt are authoritative below.
          receipt_state: "resolved",
          resumable_state: true,
          archived_state: false,
        })
        workflowResult = callerResult
        if (args.phase !== "IMPLEMENT" && args.phase !== "VERIFY") {
          return blockWorkflow(
            "workflow-gate-unsupported-phase",
            `workflow_advance is supported only for IMPLEMENT and VERIFY starts; ${args.phase} is a composite legacy adapter. Omit workflow_advance for this call.`,
            callerResult,
          )
        }
        if (callerResult.status !== "advanced") {
          return blockWorkflow("workflow-advance-blocked", callerResult.reason, callerResult)
        }
        if (callerResult.next_stage !== expectedStage) {
          return blockWorkflow(
            "workflow-phase-mismatch",
            `Workflow next_stage ${callerResult.next_stage || "none"} does not match ${args.phase}; expected ${expectedStage}.`,
            callerResult,
          )
        }
        if (gatedPhase && !changeName) {
          const message = `Missing change name for ${args.phase}: provide args.change or include "Change name: <name>" in the prompt.`
          recordMetrics({
            timestamp: new Date().toISOString(),
            session_id: toolCtx.sessionID,
            phase: args.phase,
            agent: "unresolved",
            skills_injected: [],
            skill_resolution: "none",
            duration_ms: Date.now() - startTime,
            token_estimate: estimateTokens(args.prompt),
            status: "error",
            task_api_source: "unavailable",
            ...metricContext,
            error: message,
          })
          return JSON.stringify({
            status: "error",
            phase: args.phase,
            agent: null,
            skills_injected: [],
            profile: null,
            policy_gate: null,
            validation: null,
            receipt: null,
            task_api_source: "unavailable",
            result: null,
            message,
          }, null, 2)
        }
        if (gatedPhase && !acquiredAttempt && (!isSafeToken(changeName) || !isSafeToken(args.attempt_id))) {
          return blockWorkflow(
            !isSafeToken(changeName) ? "unsafe-change-name" : "attempt-id-required",
            !isSafeToken(changeName)
              ? "The change name must be a safe token of 1-64 letters, numbers, hyphens, or underscores."
              : "Gated IMPLEMENT/VERIFY delegation requires a fresh safe attempt_id.",
            callerResult,
          )
        }
        const selected = await readSelectedWorkflowState(workspaceRoot, changeName!, args.artifact_store)
        if (!selected.snapshot) {
          return blockWorkflow(
            selected.error || "workflow-state-unavailable",
            "The selected workflow state could not be read before delegation.",
            callerResult,
            { safe_continuation: changeName ? `/odf-continue ${changeName}` : "/odf-continue" },
          )
        }
        const canonical = canonicalizeWorkflowAdvance(selected.snapshot, args.workflow_advance, expectedStage)
        if ("reason" in canonical) return blockWorkflow(canonical.reason, canonical.message, null)
        effectiveWorkflowAdvance = canonical.proof
        const { work_type, ...advanceInput } = effectiveWorkflowAdvance
        workflowResult = advanceWorkflow({
          route: resolveWorkflowRoute(work_type),
          ...advanceInput,
        })
        if (args.phase !== "IMPLEMENT" && args.phase !== "VERIFY") {
          return blockWorkflow(
            "workflow-gate-unsupported-phase",
            `workflow_advance is supported only for IMPLEMENT and VERIFY starts; ${args.phase} is a composite legacy adapter. Omit workflow_advance for this call.`,
            workflowResult,
          )
        }

        if (workflowResult.status !== "advanced") {
          return blockWorkflow(
            workflowResult.status === "complete" ? "workflow-complete" : "workflow-advance-blocked",
            workflowResult.reason,
            workflowResult,
          )
        }

        if (workflowResult.next_stage !== expectedStage) {
          return blockWorkflow(
            "workflow-phase-mismatch",
            `Workflow next_stage ${workflowResult.next_stage || "none"} does not match ${args.phase}; expected ${expectedStage}.`,
            workflowResult,
          )
        }
      }
      if (gatedPhase && !changeName) {
        const message = `Missing change name for ${args.phase}: provide args.change or include "Change name: <name>" in the prompt.`
        recordMetrics({
          timestamp: new Date().toISOString(),
          session_id: toolCtx.sessionID,
          phase: args.phase,
          agent: "unresolved",
          skills_injected: [],
          skill_resolution: "none",
          duration_ms: Date.now() - startTime,
          token_estimate: estimateTokens(args.prompt),
          status: "error",
          task_api_source: "unavailable",
          ...metricContext,
          error: message,
        })
        return JSON.stringify({
          status: "error",
          phase: args.phase,
          agent: null,
          skills_injected: [],
          profile: null,
          policy_gate: null,
          validation: null,
          receipt: null,
          task_api_source: "unavailable",
          result: null,
          message,
        }, null, 2)
      }

      if (gatedPhase && args.workflow_advance && !acquiredAttempt) {
        if (!isSafeToken(changeName)) {
          return blockWorkflow(
            "unsafe-change-name",
            "The change name must be a safe token of 1-64 letters, numbers, hyphens, or underscores.",
            workflowResult!,
          )
        }
        if (!isSafeToken(args.attempt_id)) {
          return blockWorkflow(
            "attempt-id-required",
            "Gated IMPLEMENT/VERIFY delegation requires a fresh safe attempt_id.",
            workflowResult!,
          )
        }
      }

      let transitionStart: TransitionInspection | null = null
      if (gatedPhase && effectiveWorkflowAdvance && workflowResult) {
        const expectedStage: "BUILD" | "VERIFY" = args.phase === "IMPLEMENT" ? "BUILD" : "VERIFY"
        const selected = await readSelectedWorkflowState(workspaceRoot, changeName!, args.artifact_store!)
        if (!selected.snapshot) {
          return blockWorkflow(
            selected.error || "workflow-state-unavailable",
            "The selected workflow state could not be read before delegation.",
            workflowResult,
          )
        }
        transitionStart = inspectPersistedTransition({
          snapshot: selected.snapshot,
          proof: effectiveWorkflowAdvance,
          expectedStage,
          callerResult: workflowResult,
        })
        if (!transitionStart.ok) return blockWorkflow(transitionStart.reason, transitionStart.message, workflowResult)
        if (transitionStart.alreadyCommitted) {
          recordMetrics({
            timestamp: new Date().toISOString(),
            session_id: toolCtx.sessionID,
            phase: args.phase,
            agent: "unresolved",
            skills_injected: [],
            skill_resolution: "none",
            duration_ms: Date.now() - startTime,
            token_estimate: estimateTokens(args.prompt),
            status: "ok",
            task_api_source: "unavailable",
            ...metricContext,
          })
          return JSON.stringify({
            status: "delegated",
            phase: args.phase,
            agent: null,
            skills_injected: [],
            profile: null,
            policy_gate: null,
            validation: null,
            receipt: null,
            task_api_source: "unavailable",
            result: null,
            workflow_advance: workflowResult,
            workflow_commit: {
              status: "already-committed",
              reason: "already-committed",
              store: args.artifact_store,
              message: transitionStart.message,
            },
          }, null, 2)
        }
      }

      const contextValidation = validateContextFiles(workspaceRoot, args.context_files || [])
      if (contextValidation.error) return contextValidation.error

      if (!registry) registry = await loadRegistry()
      if (!registry) {
        return `❌ ODF registry not found. Run /odf-init or check ${REGISTRY_PATH}`
      }

      let policyGate: PolicyGateDecision | null = null

      // Detect Odoo version from project
      const odooVersion = await detectOdooVersion(workspaceRoot)
      if (odooVersion) {
        debugLog(`[odf-delegation] Detected Odoo version: ${odooVersion}`)
      }

      // Match skills (with version filter)
      const skills = matchSkills(registry, args.phase, {
        files: args.context_files,
        task: args.prompt,
        odooVersion: odooVersion,
      })

      // Resolve agent and profile
      const keywords = args.prompt.split(/\s+/).slice(0, 10)
      const agentName = resolveAgent(registry, args.phase, keywords)
      if (!agentName) {
        return `❌ No agent configured for phase "${args.phase}"`
      }
      const profile = await getProfileByPhase(registry, args.phase, args.profile)
      const profileBlock = profile ? formatProfileBlock(profile, args.phase) : ""
      debugLog(`[odf-delegation] odf_delegate: phase=${args.phase} agent=${agentName} skills=${skills.length} version=${odooVersion || "auto"} profile=${profile?.name || "default"}`)

      if (gatedPhase && args.workflow_advance && !acquiredAttempt) {
        const expectedStage: "BUILD" | "VERIFY" = args.phase === "IMPLEMENT" ? "BUILD" : "VERIFY"
        const acquisition = acquireAttempt({
          workspaceDir: workspaceRoot,
          change: changeName!,
          phase: args.phase as AttemptLedgerPhase,
          nextStage: expectedStage,
          attemptId: args.attempt_id!,
          branchId: executionOptions.branch_id,
        })
        if (!acquisition.acquired) {
          return blockWorkflow(acquisition.reason, acquisition.message, workflowResult!)
        }
        acquiredAttempt = acquisition.handle
      }

      // Policy Gate (chokepoint): resolve + persist before any IMPLEMENT/VERIFY
      // delegation. The gate documents the decision; the sub-agent applies it
      // (never recomputes). Safety net — the orchestrator calls odf_policy_gate
      // explicitly; this re-runs the same decision and injects it.
      if (gatedPhase) {
        policyGate = computePolicyGate({
          change: changeName!,
          phase: args.phase as "IMPLEMENT" | "VERIFY",
          workspaceDir: workspaceRoot,
          registry,
        })
        if (policyGate.gate === "block") {
          return blockWorkflow(
            policyGate.reason,
            `Policy gate blocked ${args.phase} before delegation: ${policyGate.reason}`,
            workflowResult,
          )
        }
      }

      // Inject compact rules, profile, and the Policy Gate decision
      const rules = formatCompactRules(skills)
      const hasInjection = rules || profileBlock
      const enrichedPrompt = hasInjection
        ? `${[rules, profileBlock].filter(Boolean).join("\n\n")}\n\n---\n\n${args.prompt}\n\n## Skill Resolution Status\nReport: injected (received from odf-delegation plugin)`
        : `${args.prompt}\n\n## Skill Resolution Status\nReport: none (no matching skills in registry)`
      const delegationPrompt = [
        enrichedPrompt,
        policyGate ? `## Policy Gate Decision (authoritative, do not recompute)\n${JSON.stringify(policyGate, null, 2)}` : "",
        EXECUTOR_BOUNDARY,
      ].filter(Boolean).join("\n\n")

      // T11 pre-tool safety: inspect the USER task payload (args.prompt) BEFORE
      // delegating. Complements native OpenCode permissions
      // (permission.allow/deny) which gate by tool+path; this catches dangerous
      // ARGUMENTS inside an allowed tool's payload. We scan args.prompt (the
      // orchestrator/user request), NOT the enriched delegationPrompt — the
      // latter embeds system-instructive material (skill rules, EXECUTOR_BOUNDARY
      // that legitimately name "DROP DATABASE"/"TRUNCATE"), which would be a
      // false-positive machine. Scoped to corpus classes only.
      const safety = inspectToolArgs({
        tool: "odf_delegate",
        args: { prompt: args.prompt },
        authorized_roots: [workspaceRoot],
      })
      if (safety.blocked) {
        const message = `Pre-tool safety blocked delegation to ${agentName}: ${safety.classes.join(", ")}. ${safety.safe_continuation || "Request explicit user consent for the exact target."}`
        return blockWorkflow("pre-tool-safety", message, workflowResult, {
          classes: safety.classes,
          matched_rules: safety.matched_rules,
          safe_continuation: safety.safe_continuation,
        })
      }

      let expectationsIds: string[] = []
      const phaseWarnings: string[] = []
      if (args.phase === "VERIFY" && effectiveWorkflowAdvance && transitionStart) {
        const expectations = validateExpectations({
          change: changeName!,
          artifacts: transitionStart.snapshot.artifacts,
        })
        expectationsIds = expectations.status === "approved" ? expectations.ids : []
        if (expectations.status === "missing") phaseWarnings.push("missing-expectations")
        if (expectations.status === "invalid" || expectations.status === "tampered") {
          return blockWorkflow(
            expectations.status === "invalid" ? "expectations-not-approved" : "expectations-invalid",
            expectations.status === "invalid"
              ? "Human Expectations are not approved; approve them before VERIFY."
              : "The Expectations artifact is invalid or tampered; restore the approved human artifact before VERIFY.",
            workflowResult,
            { safe_continuation: `/odf-continue ${changeName}` },
          )
        }
      }

      const taskApiInfo = findTaskApi(toolCtx, client)
      const profilePayload = profile
        ? { name: profile.name, model: profile.model, temperature: profile.temperature, reasoning: profile.reasoning }
        : null

      if (taskApiInfo) {
        try {
          const timeoutMs = args.timeout_ms ?? 120_000
          const taskResult = await invokeTask(taskApiInfo.taskApi, agentName, delegationPrompt, contextValidation.paths, timeoutMs, toolCtx.abort)
          // Stop-validation seal (slice 2): after an IMPLEMENT delegation, stamp
          // the envelope with the deterministic evidence verdict. The sub-agent
          // executes the commands and writes the configured evidence path (the
          // legacy change path for sequential calls, branch-specific in parallel);
          // this plugin only validates the artifact — prose never counts.
          let validation: ValidationVerdict | null = null
          if (args.phase === "IMPLEMENT" && policyGate) {
            validation = validateValidationEvidence({
              workspaceDir: workspaceRoot,
              change: policyGate.change,
              tier: policyGate.risk_tier,
              frozenDiffRef: policyGate.frozen_diff_ref,
              evidencePath: executionOptions.validation_evidence_path,
            })
          }
          const proofBacked = gatedPhase && args.workflow_advance !== undefined
          const innerDisposition = innerResultDisposition(taskResult.result)
          const actualResultStatus = innerDisposition.resultStatus
          let workflowCommit: WorkflowCommitResult | null = null
          const settleProofFailure = (summary: string, reason: string, disposition?: InnerResultDisposition): string => {
            if (acquiredAttempt && !executionOptions.suppress_attempt_settlement) {
              settleAttempt(
                acquiredAttempt,
                "failed",
                disposition?.failureResultStatus || "validation-failed",
                disposition?.failureReason || "validation-failed",
              )
            }
            const receipt = proofBacked && !executionOptions.suppress_failure_receipt
              ? persistWorkflowFailureReceipt(
                workspaceRoot,
                changeName!,
                args.phase as ODFReceipt["phase"],
                summary,
                policyGate,
              validation ? [validationEvidenceRelativePath(changeName!, executionOptions.branch_id)] : [],
              disposition?.failureReceiptStatus || "blocked",
              disposition ? "error" : "validation-failed",
              expectationsIds,
            )
              : null
            recordMetrics({
              timestamp: new Date().toISOString(),
              session_id: toolCtx.sessionID,
              phase: args.phase,
              agent: agentName,
              skills_injected: skills.map(s => s.name),
              skill_resolution: skills.length > 0 ? "injected" : "none",
              duration_ms: Date.now() - startTime,
              token_estimate: estimateTokens(delegationPrompt),
              status: disposition?.metricStatus || "blocked",
              task_api_source: taskApiInfo.source,
               ...metricContext,
               warnings: phaseWarnings.length ? phaseWarnings : undefined,
               error: reason,
            })
            return JSON.stringify({
              status: "blocked",
              reason,
              phase: args.phase,
              agent: agentName,
              skills_injected: skills.map(s => s.name),
              profile: profilePayload,
              policy_gate: policyGate,
              validation,
              receipt,
              task_api_source: taskApiInfo.source,
              result: taskResult.result,
              workflow_advance: workflowResult,
               workflow_commit: workflowCommit,
               ...(phaseWarnings.length ? { warnings: phaseWarnings } : {}),
               message: summary,
            }, null, 2)
          }

          const designResult = taskResult.result && typeof taskResult.result === "object"
            ? taskResult.result as Record<string, unknown>
            : null
          if ((args.phase === "DESIGN" || args.phase === "PLAN") && innerDisposition.accepted && designResult?.design_closed !== true) {
            return settleProofFailure(
              "DESIGN/PLAN must return design_closed: true. Resolve the listed open design decisions and continue DESIGN.",
              "design-not-closed",
            )
          }

          if (!innerDisposition.accepted && !proofBacked && policyGate && !executionOptions.suppress_failure_receipt) {
            persistWorkflowFailureReceipt(
              workspaceRoot,
              changeName!,
              args.phase as ODFReceipt["phase"],
              innerDisposition.message,
              policyGate,
              [],
              innerDisposition.failureReceiptStatus,
              "error",
            )
          }
          if (proofBacked && !executionOptions.suppress_workflow_commit) {
            const lifecycle = await resolveProofBackedLifecycle({
              workspaceRoot,
              changeName: changeName!,
              artifactStore: args.artifact_store!,
              proof: effectiveWorkflowAdvance!,
              expectedStage: args.phase === "IMPLEMENT" ? "BUILD" : "VERIFY",
              callerResult: workflowResult!,
              innerResultStatus: actualResultStatus,
              validationStatus: "verified",
              validation,
              expectationsIds,
            })
            const preCommitFailure = !innerDisposition.accepted ||
              args.phase === "IMPLEMENT" && validation?.status !== "verified"
            if (lifecycle.status === "blocked") {
              if (!preCommitFailure) workflowCommit = lifecycle
              return settleProofFailure(
                !innerDisposition.accepted ? innerDisposition.message : lifecycle.message,
                lifecycle.reason,
                !innerDisposition.accepted ? innerDisposition : undefined,
              )
            }
            workflowCommit = lifecycle
            validation = lifecycle.validation
          }
          if (acquiredAttempt && !executionOptions.suppress_attempt_settlement) {
            settleAttempt(acquiredAttempt, "completed", "delegated", "task-completed")
          }
          recordMetrics({
            timestamp: new Date().toISOString(),
            session_id: toolCtx.sessionID,
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
            skill_resolution: skills.length > 0 ? "injected" : "none",
             duration_ms: Date.now() - startTime,
             token_estimate: estimateTokens(delegationPrompt),
              status: innerDisposition.metricStatus,
             task_api_source: taskApiInfo.source,
              ...metricContext,
              warnings: phaseWarnings.length ? phaseWarnings : undefined,
              candidate_digest: policyGate?.candidate_digest ?? undefined,
           })
          return JSON.stringify({
            status: "delegated",
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
            profile: profilePayload,
             policy_gate: policyGate,
             validation,
             task_api_source: taskApiInfo.source,
             result: taskResult.result,
             ...(workflowResult ? { workflow_advance: workflowResult } : {}),
              ...(proofBacked ? {
               workflow_commit: workflowCommit || (executionOptions.suppress_workflow_commit
                 ? { status: "deferred", reason: "parallel-aggregate-commit" }
                 : null),
              } : {}),
              ...(phaseWarnings.length ? { warnings: phaseWarnings } : {}),
            }, null, 2)
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          const isTimeout = errorMessage.includes("timed out")
          const isCancelled = isCancellationMessage(errorMessage)
          const isEmpty = errorMessage.startsWith("empty-task-result")
          const reason = isCancelled
            ? "task-cancelled"
            : isEmpty
              ? "empty-task-result"
              : undefined
          if (acquiredAttempt && !executionOptions.suppress_attempt_settlement) {
            const ledgerResultStatus: Exclude<AttemptLedgerResultStatus, "running"> = isTimeout
              ? "timeout"
              : isCancelled
                ? "cancelled"
                : errorMessage.startsWith("empty-task-result")
                  ? "empty-task-result"
                  : "error"
            const ledgerReason: Exclude<AttemptLedgerReason, "acquired"> = isTimeout
              ? "task-timeout"
              : isCancelled
                ? "task-cancelled"
                : isEmpty
                  ? "empty-task-result"
                  : "task-error"
            settleAttempt(acquiredAttempt, "failed", ledgerResultStatus, ledgerReason)
          }
          recordMetrics({
            timestamp: new Date().toISOString(),
            session_id: toolCtx.sessionID,
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
            skill_resolution: skills.length > 0 ? "injected" : "none",
            duration_ms: Date.now() - startTime,
            token_estimate: estimateTokens(delegationPrompt),
            status: isTimeout ? "timeout" : isCancelled || isEmpty ? "blocked" : "error",
             task_api_source: taskApiInfo.source,
             ...metricContext,
             candidate_digest: policyGate?.candidate_digest ?? undefined,
             error: errorMessage,
          })
          // Receipt auto-seal (slice 4): persist a failure disposition so the
          // learning loop does not depend on orchestrator memory. Best-effort.
          if (policyGate && !executionOptions.suppress_failure_receipt) {
            const receipt: ODFReceipt = {
              change: policyGate.change,
              phase: args.phase as ODFReceipt["phase"],
              status: isCancelled || isEmpty ? "blocked" : "failed",
              cause: isTimeout ? "timeout" : "error",
              evidence: {
                summary: errorMessage,
                frozen_diff_ref: policyGate.frozen_diff_ref,
                failing: [errorMessage],
                refs: [path.join(".odf", `policy-gate-${policyGate.change}.json`)],
              },
              action: null,
              review_gate: null,
              frozen_diff_ref: policyGate.frozen_diff_ref,
              resolved_at: new Date().toISOString(),
            }
            mergeReceipt(workspaceRoot, receipt)
          }
          return JSON.stringify({
            status: isTimeout ? "timeout" : isCancelled || isEmpty ? "blocked" : "error",
            reason,
            phase: args.phase,
            agent: agentName,
            profile: profilePayload,
            policy_gate: policyGate,
            validation: null,
            receipt: null,
            task_api_source: taskApiInfo.source,
            result: null,
            message: errorMessage,
          }, null, 2)
        }
      }

      const message = "SDK session delegation is unavailable. Restart OpenCode after loading the plugin, then retry the delegation."
      if (acquiredAttempt && !executionOptions.suppress_attempt_settlement) {
        settleAttempt(acquiredAttempt, "failed", "task-api-unavailable", "task-api-unavailable")
      }
      recordMetrics({
        timestamp: new Date().toISOString(),
        session_id: toolCtx.sessionID,
        phase: args.phase,
        agent: agentName,
        skills_injected: skills.map(s => s.name),
        skill_resolution: skills.length > 0 ? "injected" : "none",
        duration_ms: Date.now() - startTime,
        token_estimate: estimateTokens(delegationPrompt),
         status: "blocked",
         task_api_source: "unavailable",
         ...metricContext,
         error: "task-api-unavailable",
      })

      return JSON.stringify({
        status: "blocked",
        reason: "task-api-unavailable",
        phase: args.phase,
        agent: agentName,
        skills_injected: skills.map(s => s.name),
        profile: profilePayload,
        policy_gate: policyGate,
        validation: null,
        receipt: null,
        task_api_source: "unavailable",
        result: null,
        message,
      }, null, 2)
    },
  })
}

interface ParallelBranchDescriptor {
  branch_id: string
  attempt_id: string
  prompt: string
  context_files?: string[]
  timeout_ms?: number
}

interface ParallelBranchOutcome {
  branch_id: string
  attempt_id: string
  status: string
  result_status: string | null
  successful: boolean
  validation: ValidationVerdict | null
  validation_verified: boolean
  validation_evidence_ref: string
  summary: string
  attempt_ledger_ref: string
  policy_gate: PolicyGateDecision | null
}

function savedParallelOutcome(branch: ParallelJoinArtifact["branches"][number]): ParallelBranchOutcome {
  return {
    branch_id: branch.branch_id,
    attempt_id: branch.attempt_id,
    status: branch.outcome.status,
    result_status: branch.outcome.result_status,
    successful: branch.outcome.successful,
    validation: branch.outcome.validation,
    validation_verified: branch.outcome.validation_verified,
    validation_evidence_ref: branch.outcome.validation_evidence_ref,
    summary: branch.outcome.summary,
    attempt_ledger_ref: branch.outcome.attempt_ledger_ref,
    policy_gate: null,
  }
}

function freshParallelAttemptId(): string {
  return `retry-${nodeCrypto.randomUUID().replace(/-/g, "")}`
}

function buildParallelJoinArtifact(
  change: string,
  descriptors: ParallelBranchDescriptor[],
  outcomes: ParallelBranchOutcome[],
  join: ParallelJoinArtifact["join"],
  receiptRef: string | null,
): ParallelJoinArtifact {
  return {
    schema_version: 1,
    change,
    work_type: "cross-domain",
    phase: "IMPLEMENT",
    timestamp: new Date().toISOString(),
    join,
    branches: descriptors.map((descriptor, index) => {
      const outcome = outcomes[index]
      return {
        branch_id: descriptor.branch_id,
        attempt_id: descriptor.attempt_id,
        descriptor: {
          prompt: descriptor.prompt,
          context_files: descriptor.context_files || [],
          ...(descriptor.timeout_ms === undefined ? {} : { timeout_ms: descriptor.timeout_ms }),
        },
        outcome: {
          status: outcome.status,
          result_status: outcome.result_status,
          successful: outcome.successful,
          validation: outcome.validation,
          validation_verified: outcome.validation_verified,
          validation_evidence_ref: outcome.validation_evidence_ref,
          attempt_ledger_ref: outcome.attempt_ledger_ref,
          summary: outcome.summary,
        },
        status: outcome.successful ? "complete" : outcome.status === "running" ? "running" : "failed",
      }
    }),
    evidence_refs: Array.from(new Set(outcomes.map(outcome => outcome.validation_evidence_ref))),
    attempt_ledger_refs: Array.from(new Set(outcomes.map(outcome => outcome.attempt_ledger_ref))),
    receipt_ref: receiptRef,
  }
}

function saveParallelJoin(
  workspaceRoot: string,
  change: string,
  descriptors: ParallelBranchDescriptor[],
  outcomes: ParallelBranchOutcome[],
  join: ParallelJoinArtifact["join"],
  receiptRef: string | null,
): { ref: string; error: string | null } {
  const ref = parallelJoinArtifactRef(change)
  const error = writeParallelJoinArtifact(
    workspaceRoot,
    buildParallelJoinArtifact(change, descriptors, outcomes, join, receiptRef),
  )
  return { ref, error }
}

const PARALLEL_SUCCESS_STATUSES = new Set([
  "ok",
  "warning",
])

function boundedSummary(value: unknown): string {
  let summary = typeof value === "string" ? value : ""
  if (!summary && value !== undefined && value !== null) {
    try { summary = JSON.stringify(value) } catch { summary = String(value) }
  }
  summary = summary.replace(/\s+/g, " ").trim()
  return summary.length > 200 ? `${summary.slice(0, 197)}...` : summary
}

function parseDelegateEnvelope(output: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(output)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Keep the bounded fallback envelope below.
  }
  return { status: "error", message: boundedSummary(output) || "parallel branch returned no envelope" }
}

function makeParallelOutcome(
  change: string,
  descriptor: ParallelBranchDescriptor,
  output: string,
  attempt: AcquiredAttempt,
  workspaceRoot: string,
): ParallelBranchOutcome {
  const envelope = parseDelegateEnvelope(output)
  const validation = envelope.validation && typeof envelope.validation === "object" && !Array.isArray(envelope.validation)
    ? envelope.validation as ValidationVerdict
    : null
  const result = envelope.result && typeof envelope.result === "object" ? envelope.result as Record<string, unknown> : null
  const resultStatus = typeof result?.status === "string" ? result.status.toLowerCase() : null
  const successful = envelope.status === "delegated" &&
    resultStatus !== null && PARALLEL_SUCCESS_STATUSES.has(resultStatus)
  const summary = boundedSummary(envelope.message) ||
    boundedSummary(envelope.reason) ||
    boundedSummary(result?.executive_summary) ||
    boundedSummary(result?.message) ||
    boundedSummary(envelope.status) ||
    "parallel branch returned no summary"
  return {
    branch_id: descriptor.branch_id,
    attempt_id: descriptor.attempt_id,
    status: typeof envelope.status === "string" ? envelope.status : "error",
    result_status: resultStatus,
    successful,
    validation,
    validation_verified: validation?.status === "verified",
    validation_evidence_ref: validationEvidenceRelativePath(change, descriptor.branch_id),
    summary,
    attempt_ledger_ref: path.relative(workspaceRoot, attempt.ledgerPath),
    policy_gate: envelope.policy_gate && typeof envelope.policy_gate === "object"
      ? envelope.policy_gate as PolicyGateDecision
      : null,
  }
}

function recordParallelJoinMetrics(
  sessionId: string | undefined,
  startTime: number,
  status: ParallelJoinArtifact["join"]["status"],
  expected: number,
  outcomes: ParallelBranchOutcome[],
): void {
  if (!sessionId || expected < 2 || expected > PARALLEL_BUILD_CONCURRENCY) return
  const completed = Math.min(expected, outcomes.filter(outcome => outcome.successful).length)
  const running = Math.min(expected - completed, outcomes.filter(outcome => outcome.status === "running").length)
  const failed = Math.min(expected - completed - running, Math.max(0, expected - completed - running))
  const validated = Math.min(expected, outcomes.filter(outcome => outcome.successful && outcome.validation_verified).length)
  recordMetrics({
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    phase: "IMPLEMENT",
    agent: "scheduler",
    skills_injected: [],
    skill_resolution: "none",
    duration_ms: Math.max(0, Date.now() - startTime),
    token_estimate: 0,
    status: status === "complete" ? "ok" : "blocked",
    task_api_source: "unavailable",
    work_type: "cross-domain",
    join_status: status,
    join_expected: expected,
    join_completed: completed,
    join_failed: failed,
    join_running: running,
    validation_ratio: validated / expected,
  })
}

function parallelReceipt(
  workspaceRoot: string,
  change: string,
  outcomes: ParallelBranchOutcome[],
): ODFReceipt {
  const summaries = Object.fromEntries(outcomes.map(outcome => [outcome.branch_id, outcome.summary]))
  const validationEvidenceRefs = Array.from(new Set(outcomes.map(outcome => outcome.validation_evidence_ref)))
  const refs = Array.from(new Set([
    path.join(".odf", `attempt-ledger-${change}.jsonl`),
    ...validationEvidenceRefs,
    ...outcomes.map(outcome => outcome.policy_gate ? path.join(".odf", `policy-gate-${change}.json`) : ""),
  ].filter(Boolean)))
  const validationFailed = outcomes.some(outcome => outcome.successful && !outcome.validation_verified)
  const timedOut = outcomes.some(outcome => outcome.status === "timeout")
  const summary = boundedSummary(
    `Parallel BUILD blocked: ${outcomes.map(outcome => `${outcome.branch_id}: ${outcome.summary}`).join("; ")}`,
  )
  const firstPolicyGate = outcomes.find(outcome => outcome.policy_gate)?.policy_gate || null
  return {
    change,
    phase: "IMPLEMENT",
    status: "blocked",
    cause: validationFailed ? "validation-failed" : timedOut ? "timeout" : "error",
    evidence: {
      summary,
      frozen_diff_ref: firstPolicyGate?.frozen_diff_ref || gitHead(workspaceRoot),
      failing: outcomes
        .filter(outcome => !outcome.successful || !outcome.validation_verified)
        .map(outcome => outcome.branch_id),
      refs,
    },
    action: null,
    review_gate: null,
    frozen_diff_ref: firstPolicyGate?.frozen_diff_ref || gitHead(workspaceRoot),
    resolved_at: new Date().toISOString(),
    parallel: {
      branch_ids: outcomes.map(outcome => outcome.branch_id),
      summaries,
      attempt_ledger_refs: Array.from(new Set(outcomes.map(outcome => outcome.attempt_ledger_ref))),
      validation_evidence_refs: validationEvidenceRefs,
    },
  }
}

function createODFParallelDelegate(client?: OpencodeClient, canonicalDirectory?: string): ReturnType<typeof tool> {
  return tool({
    description: `Run a bounded cross-domain IMPLEMENT BUILD with 2-3 independent branches.

The shared workflow_advance proof must advance cross-domain to BUILD. Branch context files
must not overlap. VERIFY remains sequential after the aggregate join is complete.`,
    args: {
      work_type: tool.schema
        .enum(["cross-domain"])
        .describe("Only cross-domain work can use the parallel BUILD scheduler"),
      phase: tool.schema
        .enum(["IMPLEMENT"])
        .describe("Only IMPLEMENT is parallelized; VERIFY remains sequential"),
      change: tool.schema
        .string()
        .describe("Shared change name (kebab-case)"),
      artifact_store: tool.schema
        .enum(["openspec", "engram", "hybrid"])
        .describe("Authoritative workflow store for the aggregate transition"),
      workflow_advance: tool.schema
        .object({
          work_type: tool.schema.enum(["cross-domain"]),
          completed_stages: tool.schema.array(tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY"])),
          candidate_stage: tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY"]).nullable(),
          phase_result_status: tool.schema.enum(["ok", "warning", "blocked", "failed"]),
          validation_status: tool.schema.enum(["verified", "missing", "invalid", "not-required"]),
          receipt_state: tool.schema.enum(["none", "pending", "resolved"]),
          resumable_state: tool.schema.boolean(),
          archived_state: tool.schema.boolean(),
        })
        .describe("Exact shared transition proof; it must advance to BUILD"),
      branches: tool.schema
        .array(tool.schema.object({
          branch_id: tool.schema.string().describe("Unique safe branch identifier"),
          attempt_id: tool.schema.string().describe("Fresh safe attempt identifier"),
          prompt: tool.schema.string().describe("Full branch prompt"),
          context_files: tool.schema.array(tool.schema.string()).optional().describe("Non-overlapping branch context files"),
          timeout_ms: tool.schema.number().optional().describe("Optional branch task timeout in milliseconds"),
        }))
        .optional()
        .describe("Two or three independent branch descriptors; omitted when resuming from a persisted join"),
      resume_from_join: tool.schema
        .boolean()
        .optional()
        .describe("Reconstruct retryable branches from .odf/parallel-join-{change}.json without conversation context"),
    },
    async execute(args: {
      work_type: "cross-domain"
      phase: "IMPLEMENT"
      change: string
      artifact_store: ArtifactStore
      workflow_advance: ODFDelegateWorkflowAdvance
      branches?: ParallelBranchDescriptor[]
      resume_from_join?: boolean
    }, toolCtx: ToolContext): Promise<string> {
      const startTime = Date.now()
      let expected = Array.isArray(args.branches) ? args.branches.length : 0
      let persistedJoinRef: string | null = null
      const blocked = (
        reason: string,
        message: string,
        outcomes: ParallelBranchOutcome[] = [],
        receipt: ODFReceipt | null = null,
        joinStatus: "blocked" | "running" = "blocked",
      ): string => {
        recordParallelJoinMetrics(toolCtx?.sessionID, startTime, joinStatus, expected, outcomes)
        const completed = outcomes.filter(outcome => outcome.successful).length
        const running = outcomes.filter(outcome => outcome.status === "running").length
        const failed = Math.max(0, expected - completed - running)
        return JSON.stringify({
          status: "blocked",
          work_type: args.work_type,
          phase: args.phase,
          reason,
          message,
          branches: outcomes,
          join: {
            status: joinStatus,
            expected,
            completed,
            failed,
            running,
            validation_verified: outcomes.length === expected && outcomes.every(outcome => outcome.successful && outcome.validation_verified),
            evidence_refs: Array.from(new Set(outcomes.map(outcome => outcome.validation_evidence_ref))),
            artifact_ref: persistedJoinRef,
          },
          receipt,
          parallel_join_ref: persistedJoinRef,
        }, null, 2)
      }

      if (!toolCtx?.sessionID) return blocked("session-required", "odf_parallel_delegate requires sessionID")
      if (args.work_type !== "cross-domain") return blocked("parallel-work-type-unsupported", "Only cross-domain work can use the parallel BUILD scheduler.")
      if (args.phase !== "IMPLEMENT") return blocked("parallel-phase-unsupported", "Only IMPLEMENT can use the parallel BUILD scheduler; VERIFY remains sequential.")
      if (!isSafeToken(args.change)) return blocked("unsafe-change-name", "The shared change name must be a safe token.")
      if (args.artifact_store !== "openspec" && args.artifact_store !== "engram" && args.artifact_store !== "hybrid") {
        return blocked("artifact-store-required", "Parallel proof-backed BUILD requires an explicit artifact_store: openspec, engram, or hybrid.")
      }

      const workspaceRoot = resolveWorkspaceRoot(canonicalDirectory || process.cwd())
      if (!args.workflow_advance || args.workflow_advance.work_type !== "cross-domain") {
        return blocked("parallel-workflow-proof-mismatch", "The workflow_advance proof must use work_type cross-domain.")
      }
      const { work_type: callerWorkType, ...callerAdvanceInput } = args.workflow_advance
      const callerResult = advanceWorkflow({
        route: resolveWorkflowRoute(callerWorkType),
        ...callerAdvanceInput,
        // Caller state is only a structural preflight. Persisted state and receipt are authoritative below.
        receipt_state: "resolved",
        resumable_state: true,
        archived_state: false,
      })
      if (callerResult.status !== "advanced") return blocked("workflow-advance-blocked", callerResult.reason)
      if (callerResult.next_stage !== "BUILD") {
        return blocked(
          "workflow-phase-mismatch",
          `Workflow next_stage ${callerResult.next_stage || "none"} does not match IMPLEMENT; expected BUILD.`,
        )
      }
      if (!args.resume_from_join && (!Array.isArray(args.branches) || args.branches.length < 2 || args.branches.length > PARALLEL_BUILD_CONCURRENCY)) {
        return blocked("parallel-branch-count", `The parallel BUILD scheduler requires 2-${PARALLEL_BUILD_CONCURRENCY} branches.`)
      }
      if (args.resume_from_join) {
        if (Array.isArray(args.branches) && args.branches.length > 0) {
          return blocked("parallel-resume-input-mismatch", "Continuation reconstructs branch descriptors from the persisted join; omit branches.")
        }
        const loaded = readParallelJoinArtifact(workspaceRoot, args.change)
        if (loaded.warning) return blocked("parallel-join-invalid", loaded.warning)
        if (!loaded.artifact) return blocked("parallel-join-not-found", "No persisted parallel join exists for this change.")
        if (loaded.artifact.join.status === "running") {
          expected = loaded.artifact.join.expected
          return blocked(
            "parallel-join-running",
            "The persisted parallel join is still running; active branches will not be relaunched.",
            loaded.artifact.branches.map(savedParallelOutcome),
            null,
            "running",
          )
        }
      }
      const selected = await readSelectedWorkflowState(workspaceRoot, args.change, args.artifact_store)
      if (!selected.snapshot) return blocked(selected.error || "workflow-state-unavailable", "The selected workflow state could not be read before launching parallel BUILD.")
      const canonical = canonicalizeWorkflowAdvance(selected.snapshot, args.workflow_advance, "BUILD")
      if ("reason" in canonical) return blocked(canonical.reason, canonical.message)
      const effectiveWorkflowAdvance = canonical.proof
      const { work_type, ...advanceInput } = effectiveWorkflowAdvance
      const workflowResult = advanceWorkflow({
        route: resolveWorkflowRoute(work_type),
        ...advanceInput,
      })
      if (workflowResult.status !== "advanced") {
        return blocked(
          workflowResult.status === "complete" ? "workflow-complete" : "workflow-advance-blocked",
          workflowResult.reason,
        )
      }
      if (workflowResult.next_stage !== "BUILD") {
        return blocked(
          "workflow-phase-mismatch",
          `Workflow next_stage ${workflowResult.next_stage || "none"} does not match IMPLEMENT; expected BUILD.`,
        )
      }
      const transitionStart = inspectPersistedTransition({
        snapshot: selected.snapshot,
        proof: effectiveWorkflowAdvance,
        expectedStage: "BUILD",
        callerResult: workflowResult,
      })
      if (!transitionStart.ok) return blocked(transitionStart.reason, transitionStart.message)

      let savedJoin: ParallelJoinArtifact | null = null
      let descriptors: ParallelBranchDescriptor[] = Array.isArray(args.branches) ? args.branches : []
      let runnableDescriptors = descriptors
      if (args.resume_from_join) {
        if (Array.isArray(args.branches) && args.branches.length > 0) {
          return blocked("parallel-resume-input-mismatch", "Continuation reconstructs branch descriptors from the persisted join; omit branches.")
        }
        const loaded = readParallelJoinArtifact(workspaceRoot, args.change)
        if (loaded.warning) return blocked("parallel-join-invalid", loaded.warning)
        if (!loaded.artifact) return blocked("parallel-join-not-found", "No persisted parallel join exists for this change.")
        savedJoin = loaded.artifact
        expected = savedJoin.join.expected
        persistedJoinRef = parallelJoinArtifactRef(args.change)
        if (savedJoin.join.status === "running") {
          return blocked(
            "parallel-join-running",
            "The persisted parallel join is still running; active branches will not be relaunched.",
            savedJoin.branches.map(savedParallelOutcome),
            null,
            "running",
          )
        }
        if (savedJoin.join.status === "blocked" && selected.snapshot.status.receipt.action !== "retry") {
          return blocked(
            "workflow-retry-disposition-required",
            "A committed retry receipt is required before retrying a blocked parallel join.",
            savedJoin.branches.map(savedParallelOutcome),
          )
        }
        const retryable = savedJoin.branches.filter(branch => !(branch.outcome.successful && branch.outcome.validation_verified))
        descriptors = savedJoin.branches.map(branch => {
          const completed = branch.outcome.successful && branch.outcome.validation_verified
          return {
            branch_id: branch.branch_id,
            attempt_id: completed ? branch.attempt_id : freshParallelAttemptId(),
            prompt: branch.descriptor.prompt,
            context_files: [...branch.descriptor.context_files],
            ...(branch.descriptor.timeout_ms === undefined ? {} : { timeout_ms: branch.descriptor.timeout_ms }),
          }
        })
        runnableDescriptors = descriptors.filter(descriptor => retryable.some(branch => branch.branch_id === descriptor.branch_id))
      }

      if (!args.resume_from_join && (!Array.isArray(args.branches) || args.branches.length < 2 || args.branches.length > PARALLEL_BUILD_CONCURRENCY)) {
        return blocked("parallel-branch-count", `The parallel BUILD scheduler requires 2-${PARALLEL_BUILD_CONCURRENCY} branches.`)
      }
      if (args.resume_from_join && (runnableDescriptors.length > PARALLEL_BUILD_CONCURRENCY || runnableDescriptors.length === 0 && savedJoin?.join.status !== "complete")) {
        return blocked("parallel-join-invalid", "The persisted parallel join has an invalid continuation branch set.")
      }
      if (transitionStart.alreadyCommitted && !args.resume_from_join) {
        return JSON.stringify({
          status: "parallel-delegated",
          work_type: args.work_type,
          phase: args.phase,
          resumed: false,
          branches: [],
          join: { status: "complete", expected, completed: expected, failed: 0, running: 0, validation_verified: true, artifact_ref: null },
          receipt: null,
          workflow_commit: { status: "already-committed", reason: "already-committed", store: args.artifact_store },
          parallel_join_ref: null,
        }, null, 2)
      }

      if (args.resume_from_join && runnableDescriptors.length === 0 && savedJoin) {
        const aggregateStatus = savedJoin.branches.some(branch => branch.outcome.result_status === "warning") ? "warning" : "ok"
        const workflowCommit = await resolveProofBackedLifecycle({
          workspaceRoot,
          changeName: args.change,
          artifactStore: args.artifact_store,
          proof: effectiveWorkflowAdvance,
          expectedStage: "BUILD",
          callerResult: workflowResult,
          innerResultStatus: aggregateStatus,
          validationStatus: "verified",
          validation: { status: "verified", reason: "parallel join validation verified", commands_validated: savedJoin.join.expected },
          parallel: true,
        })
        if (workflowCommit.status === "blocked") {
          const receipt = parallelReceipt(workspaceRoot, args.change, savedJoin.branches.map(savedParallelOutcome))
          const mergedReceipt = mergeReceipt(workspaceRoot, receipt)
          return blocked(workflowCommit.reason, workflowCommit.message, savedJoin.branches.map(savedParallelOutcome), mergedReceipt)
        }
        recordParallelJoinMetrics(toolCtx.sessionID, startTime, savedJoin.join.status, expected, savedJoin.branches.map(savedParallelOutcome))
        return JSON.stringify({
          status: "parallel-delegated",
          work_type: "cross-domain",
          phase: "IMPLEMENT",
          resumed: true,
          branches: savedJoin.branches.map(savedParallelOutcome),
          join: { ...savedJoin.join, artifact_ref: persistedJoinRef },
          receipt: null,
          workflow_commit: workflowCommit,
          parallel_join_ref: persistedJoinRef,
        }, null, 2)
      }

      const seenBranches = new Set<string>()
      const seenAttempts = new Set<string>()
      const seenPaths = new Map<string, string>()
      for (const branch of runnableDescriptors) {
        if (!isSafeToken(branch.branch_id)) return blocked("unsafe-branch-id", "Every branch_id must be a safe token.")
        if (seenBranches.has(branch.branch_id)) return blocked("duplicate-branch-id", `The branch_id "${branch.branch_id}" is duplicated.`)
        seenBranches.add(branch.branch_id)
        if (!isSafeToken(branch.attempt_id)) return blocked("unsafe-attempt-id", `Branch "${branch.branch_id}" requires a fresh safe attempt_id.`)
        if (seenAttempts.has(branch.attempt_id)) return blocked("duplicate-attempt-id", `The attempt_id "${branch.attempt_id}" is duplicated.`)
        seenAttempts.add(branch.attempt_id)
        const contextValidation = validateContextFiles(workspaceRoot, branch.context_files || [])
        if (contextValidation.error) return blocked("invalid-context-files", contextValidation.error)
        for (const contextPath of contextValidation.paths) {
          const owner = seenPaths.get(contextPath)
          if (owner && owner !== branch.branch_id) {
            return blocked("overlapping-context-paths", `Branches "${owner}" and "${branch.branch_id}" share context path "${contextPath}".`)
          }
          seenPaths.set(contextPath, branch.branch_id)
        }
      }

      const registry = await loadRegistry()
      if (!registry) return blocked("registry-unavailable", `ODF registry not found. Run /odf-init or check ${REGISTRY_PATH}`)

      const acquired = new Map<string, AcquiredAttempt>()
      for (const branch of runnableDescriptors) {
        const acquisition = acquireAttempt({
          workspaceDir: workspaceRoot,
          change: args.change,
          phase: "IMPLEMENT",
          nextStage: "BUILD",
          attemptId: branch.attempt_id,
          branchId: branch.branch_id,
        })
        if (!acquisition.acquired) {
          for (const handle of acquired.values()) settleAttempt(handle, "failed", "error", "task-error")
          const ledgerRef = path.relative(workspaceRoot, attemptLedgerPath(workspaceRoot, args.change))
          const outcomes: ParallelBranchOutcome[] = descriptors.map((descriptor, index) => {
            const saved = savedJoin?.branches[index]
            if (saved && saved.outcome.successful && saved.outcome.validation_verified) return savedParallelOutcome(saved)
            return {
              branch_id: descriptor.branch_id,
              attempt_id: descriptor.attempt_id,
              status: "blocked",
              result_status: null,
              successful: false,
              validation: null,
              validation_verified: false,
              validation_evidence_ref: validationEvidenceRelativePath(args.change, descriptor.branch_id),
              summary: `${acquisition.reason}: ${acquisition.message}`,
              attempt_ledger_ref: ledgerRef,
              policy_gate: null,
            }
           })
          const receipt = parallelReceipt(workspaceRoot, args.change, outcomes)
          const mergedReceipt = mergeReceipt(workspaceRoot, receipt)
          const join = {
            status: "blocked" as const,
            expected,
            completed: outcomes.filter(outcome => outcome.successful).length,
            failed: expected - outcomes.filter(outcome => outcome.successful).length,
            running: 0,
            validation_verified: outcomes.every(outcome => outcome.successful && outcome.validation_verified),
          }
          const savedArtifact = saveParallelJoin(
            workspaceRoot,
            args.change,
            descriptors,
            outcomes,
            join,
            path.join(".odf", `receipt-${args.change}.json`),
          )
           if (savedArtifact.error) return blocked("parallel-join-persist-failed", savedArtifact.error, outcomes, mergedReceipt)
           persistedJoinRef = savedArtifact.ref
           return blocked(acquisition.reason, acquisition.message, outcomes, mergedReceipt)
        }
        acquired.set(branch.branch_id, acquisition.handle)
      }

      const outcomes: ParallelBranchOutcome[] = descriptors.map((descriptor, index) => {
        const saved = savedJoin?.branches[index]
        if (saved && saved.outcome.successful && saved.outcome.validation_verified) return savedParallelOutcome(saved)
        const running = runnableDescriptors.some(runnable => runnable.branch_id === descriptor.branch_id)
        return {
          branch_id: descriptor.branch_id,
          attempt_id: descriptor.attempt_id,
          status: running ? "running" : "blocked",
          result_status: running ? "running" : null,
          successful: false,
          validation: null,
          validation_verified: false,
          validation_evidence_ref: validationEvidenceRelativePath(args.change, descriptor.branch_id),
          summary: running ? "parallel branch is running" : "parallel branch has not completed",
          attempt_ledger_ref: path.relative(workspaceRoot, attemptLedgerPath(workspaceRoot, args.change)),
          policy_gate: null,
        }
      })

      const runningJoin = {
        status: "running" as const,
        expected,
        completed: outcomes.filter(outcome => outcome.successful).length,
        failed: outcomes.filter(outcome => !outcome.successful && outcome.status !== "running").length,
        running: outcomes.filter(outcome => outcome.status === "running").length,
        validation_verified: false,
      }
      const runningArtifact = saveParallelJoin(workspaceRoot, args.change, descriptors, outcomes, runningJoin, null)
      if (runningArtifact.error) {
        for (const handle of acquired.values()) settleAttempt(handle, "failed", "error", "task-error")
        const settledOutcomes = outcomes.map(outcome => outcome.status === "running"
          ? { ...outcome, status: "blocked", result_status: null, summary: "parallel join persistence failed before launch" }
          : outcome)
        return blocked("parallel-join-persist-failed", runningArtifact.error, settledOutcomes)
      }
      persistedJoinRef = runningArtifact.ref
      recordParallelJoinMetrics(toolCtx.sessionID, startTime, "running", expected, outcomes)

      const persistRunningProgress = (): void => {
        const running = outcomes.filter(outcome => outcome.status === "running").length
        if (running === 0) return
        saveParallelJoin(workspaceRoot, args.change, descriptors, outcomes, {
          status: "running",
          expected,
          completed: outcomes.filter(outcome => outcome.successful).length,
          failed: outcomes.filter(outcome => !outcome.successful && outcome.status !== "running").length,
          running,
          validation_verified: false,
        }, null)
      }

      let nextIndex = 0
      const worker = async (): Promise<void> => {
        while (true) {
          const index = nextIndex++
          if (index >= runnableDescriptors.length) return
          const branch = runnableDescriptors[index]
          const outcomeIndex = descriptors.findIndex(descriptor => descriptor.branch_id === branch.branch_id)
          const validationEvidenceRef = validationEvidenceRelativePath(args.change, branch.branch_id)
          try {
            const output = await createODFDelegate(client, canonicalDirectory, {
              branch_id: branch.branch_id,
              suppress_failure_receipt: true,
              suppress_workflow_commit: true,
              suppress_attempt_settlement: true,
              validation_evidence_path: validationEvidenceRef,
              workflow_result: workflowResult,
              pre_acquired_attempt: acquired.get(branch.branch_id),
            }).execute({
              phase: "IMPLEMENT",
              prompt: `${branch.prompt}\n\nStop-validation evidence: write \`${validationEvidenceRef}\`.`,
              context_files: branch.context_files,
              change: args.change,
              artifact_store: args.artifact_store,
              timeout_ms: branch.timeout_ms,
              attempt_id: branch.attempt_id,
              workflow_advance: args.workflow_advance,
            }, toolCtx)
            outcomes[outcomeIndex] = makeParallelOutcome(args.change, branch, output as string, acquired.get(branch.branch_id)!, workspaceRoot)
            persistRunningProgress()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            outcomes[outcomeIndex] = makeParallelOutcome(
              args.change,
              branch,
              JSON.stringify({ status: "error", message }),
              acquired.get(branch.branch_id)!,
              workspaceRoot,
            )
            persistRunningProgress()
          }
        }
      }

      await Promise.allSettled(Array.from({ length: Math.min(PARALLEL_BUILD_CONCURRENCY, runnableDescriptors.length) }, () => worker()))

      const completed = outcomes.filter(outcome => outcome.successful).length
      const failed = expected - completed
      const validationVerified = outcomes.every(outcome => outcome.successful && outcome.validation_verified)
      const joinComplete = completed === expected && failed === 0 && validationVerified
      const join = {
        status: joinComplete ? "complete" as const : "blocked" as const,
        expected,
        completed,
        failed,
        running: 0,
        validation_verified: validationVerified,
      }
      if (joinComplete) {
        const savedArtifact = saveParallelJoin(workspaceRoot, args.change, descriptors, outcomes, join, null)
        if (savedArtifact.error) {
          for (const handle of acquired.values()) settleAttempt(handle, "failed", "error", "task-error")
          return blocked("parallel-join-persist-failed", savedArtifact.error, outcomes)
        }
        persistedJoinRef = savedArtifact.ref
        const aggregateStatus = outcomes.some(outcome => outcome.result_status === "warning") ? "warning" : "ok"
         const workflowCommit = await resolveProofBackedLifecycle({
           workspaceRoot,
           changeName: args.change,
           artifactStore: args.artifact_store,
           proof: effectiveWorkflowAdvance,
           expectedStage: "BUILD",
           callerResult: workflowResult,
           innerResultStatus: aggregateStatus,
           validationStatus: "verified",
           validation: { status: "verified", reason: "parallel join validation verified", commands_validated: expected },
           parallel: true,
         })
        if (workflowCommit.status === "blocked") {
          for (const handle of acquired.values()) settleAttempt(handle, "failed", "validation-failed", "validation-failed")
          const receipt = parallelReceipt(workspaceRoot, args.change, outcomes)
          const mergedReceipt = mergeReceipt(workspaceRoot, receipt)
          const blockedJoin = { ...join, status: "blocked" as const, validation_verified: false }
          saveParallelJoin(workspaceRoot, args.change, descriptors, outcomes, blockedJoin, path.join(".odf", `receipt-${args.change}.json`))
          return blocked(workflowCommit.reason, workflowCommit.message, outcomes, mergedReceipt)
        }
        for (const handle of acquired.values()) settleAttempt(handle, "completed", "delegated", "task-completed")
        recordParallelJoinMetrics(toolCtx.sessionID, startTime, "complete", expected, outcomes)
        return JSON.stringify({
          status: "parallel-delegated",
          work_type: "cross-domain",
          phase: "IMPLEMENT",
          resumed: Boolean(args.resume_from_join),
          branches: outcomes,
          join: {
            ...join,
            completed,
            failed,
            evidence_refs: Array.from(new Set(outcomes.map(outcome => outcome.validation_evidence_ref))),
            artifact_ref: persistedJoinRef,
           },
           receipt: null,
           workflow_commit: workflowCommit,
           parallel_join_ref: persistedJoinRef,
        }, null, 2)
      }

      for (const handle of acquired.values()) settleAttempt(handle, "failed", "validation-failed", "validation-failed")
      const receipt = parallelReceipt(workspaceRoot, args.change, outcomes)
      const mergedReceipt = mergeReceipt(workspaceRoot, receipt)
      const savedArtifact = saveParallelJoin(
        workspaceRoot,
        args.change,
        descriptors,
        outcomes,
        join,
        path.join(".odf", `receipt-${args.change}.json`),
      )
       if (savedArtifact.error) return blocked("parallel-join-persist-failed", savedArtifact.error, outcomes, mergedReceipt)
      persistedJoinRef = savedArtifact.ref
      return blocked(
        failed > 0 ? "parallel-branch-failed" : "parallel-validation-incomplete",
        failed > 0 ? "At least one parallel BUILD branch failed." : "Every parallel BUILD branch must return verified validation before BUILD can close.",
        outcomes,
        mergedReceipt,
      )
    },
  })
}

function createODFSkillInject(): ReturnType<typeof tool> {
  return tool({
    description: `Read the ODF registry and return compact rules for matching skills.

Use this to manually inject standards into a sub-agent prompt when not using odf_delegate.`,
    args: {
      context_files: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Files being worked on"),
      task_description: tool.schema
        .string()
        .optional()
        .describe("Description of the task"),
      max_skills: tool.schema
        .number()
        .optional()
        .describe("Max skills to return (default: 5)"),
    },
    async execute(args: { context_files?: string[]; task_description?: string; max_skills?: number }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found"
      }

       const skills = matchSkills(registry, null, {
        files: args.context_files,
        task: args.task_description,
      })
      debugLog(`[odf-delegation] odf_skill_inject: matched ${skills.length} skills`)

      const limit = args.max_skills || 5
      const limited = skills.slice(0, limit)

      if (limited.length === 0) {
        return "No matching skills found in registry for the given context."
      }

      return formatCompactRules(limited)
    },
  })
}

function createODFNotebookLMLookup(): ReturnType<typeof tool> {
  return tool({
    description: `Resolve an Odoo domain to its NotebookLM notebook ID.

Queries the odf-registry.json notebooklm_sources mapping.
Use this before notebooklm_query to get the correct notebook_id.`,
    args: {
      domain: tool.schema
        .string()
        .describe("Odoo domain: sales, accounting, inventory, manufacturing, pos, technical"),
    },
    async execute(args: { domain: string }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry?.notebooklm_sources) {
        return "❌ No notebooklm_sources found in registry. Add them to odf-registry.json."
      }

      const domainLower = args.domain.toLowerCase()
      const notebookId = registry.notebooklm_sources[domainLower]

      if (!notebookId) {
        const available = Object.keys(registry.notebooklm_sources).join(", ")
        return `❌ No notebook found for domain '${args.domain}'. Available: ${available}`
      }

      return `NotebookLM ID for '${args.domain}': ${notebookId}`
    },
  })
}

function createODFProfileSelect(): ReturnType<typeof tool> {
  return tool({
    description: `Get the recommended model and temperature for an ODF phase.
Uses the ACTIVE named profile from the registry.
Reads SDD Profiles from odf-registry.json. Use this to configure
the sub-agent model before delegation for optimal phase performance.`,
    args: {
      phase: tool.schema
        .string()
        .describe("ODF phase: PROPOSE, ASSESS, QA-PLAN, DESIGN, IMPLEMENT, VERIFY"),
    },
    async execute(args: { phase: string }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry?.profiles) {
        return "❌ No SDD profiles found in registry. Using defaults."
      }

      const profile = await getProfileByPhase(registry, args.phase)
      if (!profile) {
        return `No profile for phase ${args.phase}. Using defaults: model=default, temperature=0.2`
      }
      debugLog(`[odf-delegation] odf_profile_select: phase=${args.phase} model=${profile.model} temp=${profile.temperature}`)

      return `Phase: ${args.phase}
Model: ${profile.model}
Temperature: ${profile.temperature}
Reasoning: ${profile.reasoning ? "enabled" : "disabled"}`
    },
  })
}

function createODFSkillResolve(): ReturnType<typeof tool> {
  return tool({
    description: `Preview what skills, agent, and profile would be selected for a task WITHOUT executing.

Use this for debugging:
- "Why was agent X chosen?"
- "What skills would match?"
- "Which profile applies?"`,
    args: {
      phase: tool.schema
        .string()
        .describe("ODF phase: PROPOSE, ASSESS, QA-PLAN, DESIGN, IMPLEMENT, VERIFY, EXPLORE"),
      task: tool.schema
        .string()
        .describe("Task description to analyze"),
      context_files: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Files involved (for skill matching)"),
      odoo_version: tool.schema
        .number()
        .optional()
        .describe("Odoo version (auto-detected if not provided)"),
    },
    async execute(args: { phase: string; task: string; context_files?: string[]; odoo_version?: number }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found"
      }

      // Detect version if not provided
      let version = args.odoo_version || null
      if (!version) {
        // Try to detect from current working directory
        version = await detectOdooVersion(process.cwd())
      }

      // Resolve agent
      const keywords = args.task.split(/\s+/).slice(0, 10)
      const agentName = resolveAgent(registry, args.phase, keywords)
      const agent = registry.agents.find(a => a.name === agentName)

      // Match skills
       const skills = matchSkills(registry, args.phase, {
        files: args.context_files,
        task: args.task,
        odooVersion: version,
      })

      // Get profile (named profile format)
      const profile = await getProfileByPhase(registry, args.phase)

      const lines: string[] = [
        "## ODF Skill Resolution (Preview)",
        "",
        `**Phase:** ${args.phase}`,
        `**Odoo Version:** ${version || "not detected (no version filter applied)"}`,
        "",
        "### Agent Resolution",
        `**Selected:** ${agentName || "none"}`,
      ]

      if (agent) {
        lines.push(`**Description:** ${agent.description}`)
        lines.push(`**Phases:** ${agent.phases.join(", ")}`)
        lines.push(`**Installed:** ${agent.installed}`)
      } else {
        lines.push(`**Status:** ⚠️ Agent not found in registry`)
      }

      lines.push("")
      lines.push("### Skill Matching")
      lines.push(`**Matched:** ${skills.length} skill(s)`)

      if (skills.length > 0) {
        for (const skill of skills) {
          const score = (skill as any)._score || "?"
          const versionNote = skill.odoo_versions.length > 0
            ? ` [v${skill.odoo_versions.join(",")}]`
            : " [all versions]"
          lines.push(`- **${skill.title}** (${skill.name}) — score: ${score}${versionNote}`)
        }
      } else {
        lines.push("_No skills matched the task/files/version._")
      }

      lines.push("")
      lines.push("### SDD Profile")
      if (profile) {
        lines.push(`**Model:** ${profile.model}`)
        lines.push(`**Temperature:** ${profile.temperature}`)
        lines.push(`**Reasoning:** ${profile.reasoning ? "enabled" : "disabled"}`)
      } else {
        lines.push("_No profile for this phase._")
      }

      lines.push("")
      lines.push("### Filtered Keywords")
      const filtered = filterStopWords(keywords)
      lines.push(`Original: [${keywords.join(", ")}]`)
      lines.push(`Filtered: [${filtered.join(", ")}]`)

      return lines.join("\n")
    },
  })
}

function createODFRegistryRead(): ReturnType<typeof tool> {
  return tool({
    description: `Read the full ODF registry or query specific entries.`,
    args: {
      query: tool.schema
        .string()
        .optional()
        .describe("Search query for skills/agents (optional)"),
      type: tool.schema
        .enum(["skills", "agents", "all"])
        .optional()
        .describe("What to search: skills, agents, or all"),
    },
    async execute(args: { query?: string; type?: "skills" | "agents" | "all" }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found at ~/.config/opencode/odf-registry.json"
      }

      const queryLower = args.query?.toLowerCase() || ""
      const results: string[] = []

      if (!args.type || args.type === "skills" || args.type === "all") {
        results.push("## Skills")
        for (const skill of registry.skills) {
          if (!queryLower || skill.name.includes(queryLower) || skill.triggers.some(t => t.includes(queryLower))) {
            results.push(`- ${skill.name}: ${skill.title} [${skill.category}] — phases: ${skill.sdd_phase || "any"}`)
          }
        }
      }

      if (!args.type || args.type === "agents" || args.type === "all") {
        results.push("\n## Agents")
        for (const agent of registry.agents) {
          if (!queryLower || agent.name.includes(queryLower) || agent.description.toLowerCase().includes(queryLower)) {
            results.push(`- ${agent.name}: ${agent.description} [${agent.mode}] — phases: ${agent.phases.join(", ")}`)
          }
        }
      }

      return results.join("\n")
    },
  })
}

function createODFHealth(client?: OpencodeClient, io: HealthIo = defaultHealthIo): ReturnType<typeof tool> {
  return tool({
    description: `Read-only installed/runtime ODF health check.

Checks the installed registry, plugin, command, SDK session delegation capability, and optional
Engram CLI metadata. It never calls task(), Odoo, PostgreSQL, or engram export;
task usability remains unverified because probing it would execute work.`,
    args: {},
    async execute(_args: Record<string, never>, toolCtx: ToolContext): Promise<string> {
      return JSON.stringify(await inspectODFHealth(toolCtx, client, io), null, 2)
    },
  })
}

// ==========================================
// COMMUNITY TOOLS
// ==========================================

const COMMUNITY_TOOL_GUIDANCE: Record<string, string> = {
  codegraph: `## CodeGraph

When answering structural or codebase questions about Odoo, use CodeGraph before broad filesystem searches. This is a hard ordering rule for repo maps, architecture, call flow, dependencies, symbol references, and impact analysis.

Required order for structural/codebase questions:

1. Resolve the project root with \`git rev-parse --show-toplevel || pwd\`.
2. Confirm the root is a real project/workspace. Do not initialize CodeGraph in \$HOME or temporary directories.
3. Check for <project-root>/.codegraph/ before any broad Read/Glob/Grep exploration.
4. If .codegraph/ is missing and codegraph CLI is available, run \`codegraph init <project-root>\` once, then use \`codegraph_explore\`.
5. Only fall back to normal filesystem tools after CodeGraph init or CodeGraph use fails.

Broad Read/Glob/Grep before this CodeGraph check is explicitly discouraged for structural questions.`,
}

function createODFCommunityToolDetect(): ReturnType<typeof tool> {
  return tool({
    description: `Detect the status of a community tool: CLI availability, npm package, and agent guidance wiring.

Returns structured JSON with CLI path, installed version, and agent wiring status.`,
    args: {
      tool_name: tool.schema
        .string()
        .describe("Community tool name from registry: codegraph"),
    },
    async execute(args: { tool_name: string }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return JSON.stringify({ status: "error", message: "ODF registry not found" })
      }

      const def = registry.community_tools?.find(t => t.name === args.tool_name)
      if (!def) {
        return JSON.stringify({ status: "error", message: `Unknown community tool "${args.tool_name}"` })
      }

      const result: Record<string, any> = {
        tool: def.name,
        title: def.title,
        package: def.package_name,
        command: def.command_name,
        cli: { available: false, path: null, version: null },
        npm: { installed: false },
        guidance: { configured: false },
      }

      // Check CLI availability
      try {
        const which = process.platform === "win32" ? "where" : "which"
        const cliPath = execFileSync(which, [def.command_name], { encoding: "utf8" }).trim()
        if (cliPath) {
          result.cli = { available: true, path: cliPath.split("\n")[0], version: null }
          try {
            const ver = execFileSync(def.command_name, ["--version"], { encoding: "utf8" }).trim()
            if (ver) result.cli.version = ver.split("\n")[0]
          } catch {
            // version not available
          }
        }
      } catch {
        // CLI not found
      }

      // Check npm package locally
      try {
        const pkgPath = path.join(getOdfConfigDir(), "node_modules", def.package_name.split("@")[1] || def.package_name)
        await fs.access(pkgPath)
        result.npm = { installed: true }
      } catch {
        // Not installed in ODF config dir
      }

      return JSON.stringify(result, null, 2)
    },
  })
}

function createODFCommunityToolInstall(): ReturnType<typeof tool> {
  return tool({
    description: `Install a community tool (npm package) and inject guidance into ODF agent instructions.

Runs npm install for the tool package and writes the CodeGraph-style guidance block
into the orchestrator's agent instructions for lazy-init wiring.`,
    args: {
      tool_name: tool.schema
        .string()
        .describe("Community tool name from registry: codegraph"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Project directory to init codegraph index in (codegraph only)"),
    },
    async execute(args: { tool_name: string; workspace_dir?: string }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found"
      }

      const def = registry.community_tools?.find(t => t.name === args.tool_name)
      if (!def) {
        return `❌ Unknown community tool "${args.tool_name}"`
      }

      const results: string[] = []

      // Step 1: npm install
      try {
        execFileSync("npm", ["install", "--no-audit", "--no-fund", def.package_name], {
          cwd: getOdfConfigDir(),
          encoding: "utf8",
          timeout: 120_000,
        })
        results.push(`✅ npm install ${def.package_name} succeeded`)
      } catch (err) {
        results.push(`⚠️ npm install ${def.package_name}: ${(err as Error).message || String(err)}`)
      }

      // Step 2: Mark installed in registry cache
      if (registry.community_tools) {
        const idx = registry.community_tools.findIndex(t => t.name === args.tool_name)
        if (idx >= 0) {
          registry.community_tools[idx].installed = true
        }
      }

      // Step 3: Init codegraph index if workspace dir provided
      if (args.tool_name === "codegraph" && args.workspace_dir) {
        try {
          execFileSync("codegraph", ["init", args.workspace_dir], { encoding: "utf8", timeout: 60_000 })
          results.push(`✅ codegraph init ${args.workspace_dir} succeeded`)
        } catch (err) {
          results.push(`⚠️ codegraph init skipped: ${(err as Error).message || String(err)}`)
        }
      }

      return results.join("\n")
    },
  })
}

function injectCommunityToolGuidance(prompt: string, registry: ODFRegistry): string {
  if (!registry.community_tools) return prompt

  let guidance = ""
  for (const tool of registry.community_tools) {
    if (tool.installed && COMMUNITY_TOOL_GUIDANCE[tool.name]) {
      guidance += `\n\n${COMMUNITY_TOOL_GUIDANCE[tool.name]}`
    }
  }
  if (!guidance) return prompt

  // Inject after ## Project Standards or at the top
  const marker = "## Project Standards (auto-resolved)"
  if (prompt.includes(marker)) {
    return prompt.replace(marker, `${marker}\n${guidance}`)
  }
  return `${guidance}\n\n---\n\n${prompt}`
}

// ==========================================
// ODF STATUS FROM ENGRAM
// ==========================================

export interface ODFChangeStatus {
  change: string
  phase: string
  artifacts: Record<string, string>  // artifact type → "done" | "pending" | "in-progress"
  applyProgress: { completed: number; total: number }
  lastUpdated: string | null
  workflowStatus: WorkflowStatus
}

interface StatusArtifact {
  key: string
  content: string
  created: string | null
  source: "openspec" | "engram"
}

interface EngramSnapshot {
  change: string
  artifacts: Map<string, { content: string; created: string | null }>
}

interface OpenSpecSnapshot {
  change: string
  state: StatusArtifact | null
  artifacts: StatusArtifact[]
  warnings: string[]
}

const CHANGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const OPEN_SPEC_ARTIFACT_STEMS = new Set([
  "decision", "plan", "build", "verify", "proposal", "propose", "assess", "spec", "qa-plan", "design",
  "tasks", "apply-progress", "implement-progress", "archive-report", "expectations",
])

function openSpecStem(fileName: string): string {
  return fileName.replace(/\.(json|ya?ml|md)$/i, "").toLowerCase()
}

function isOpenSpecArtifact(fileName: string): boolean {
  const stem = openSpecStem(fileName)
  return OPEN_SPEC_ARTIFACT_STEMS.has(stem) || /^verify-report(?:-.+)?$/.test(stem)
}

function openSpecRef(changeName: string, fileName: string): string {
  return ["openspec", "changes", changeName, fileName].join("/")
}

async function readOpenSpecFile(changeName: string, changeDir: string, fileName: string): Promise<StatusArtifact | null> {
  try {
    const filePath = path.join(changeDir, fileName)
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return null
    return {
      key: openSpecRef(changeName, fileName),
      content: await fs.readFile(filePath, "utf8"),
      created: stat.mtime.toISOString(),
      source: "openspec",
    }
  } catch {
    return null
  }
}

/** Read one explicit OpenSpec change without discovering or mutating state. */
export async function loadOpenSpecStatus(workspaceRoot: string, changeName: string): Promise<OpenSpecSnapshot | null> {
  if (!CHANGE_NAME_PATTERN.test(changeName)) return null
  const changeDir = path.join(workspaceRoot, "openspec", "changes", changeName)
  try {
    const stat = await fs.stat(changeDir)
    if (!stat.isDirectory()) return null
  } catch {
    return null
  }

  const stateFile = await readOpenSpecFile(changeName, changeDir, "state.yaml")
  let state: StatusArtifact | null = null
  const warnings: string[] = []
  if (stateFile) {
    const parsed = parseWorkflowState(stateFile.content)
    warnings.push(...parsed.warnings)
    if (parsed.state) state = stateFile
    else warnings.push("OpenSpec state was not read; status is derived from Engram artifacts.")
  } else {
    warnings.push("OpenSpec state was not read; status is derived from Engram artifacts.")
  }

  const entries = await fs.readdir(changeDir, { withFileTypes: true })
  const artifacts: StatusArtifact[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || entry.name === "state.yaml" || !isOpenSpecArtifact(entry.name)) continue
    const artifact = await readOpenSpecFile(changeName, changeDir, entry.name)
    if (artifact) artifacts.push(artifact)
  }
  return { change: changeName, state, artifacts, warnings: Array.from(new Set(warnings)) }
}

interface EngramObservation {
  content: string
  topic_key?: string
  created_at?: string
}

interface EngramObservationRead {
  observations: EngramObservation[] | null
  error: "engram-cli-unavailable" | "engram-export-timeout" | "engram-export-failed" | "engram-export-invalid" | null
}

function readEngramObservationsWithError(workspaceRoot: string): EngramObservationRead {
  // ponytail: unique tmpdir (not a Date.now() filename) so parallel workers never race the same path
  const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "odf-status-"))
  const tmpFile = path.join(tmpDir, "export.json")
  try {
    execFileSync("engram", ["export", tmpFile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    })
  } catch (error) {
    try { fsSync.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
    const code = (error as NodeJS.ErrnoException).code
    return {
      observations: null,
      error: code === "ENOENT" ? "engram-cli-unavailable" : code === "ETIMEDOUT" ? "engram-export-timeout" : "engram-export-failed",
    }
  }

  try {
    const raw = fsSync.readFileSync(tmpFile, "utf8")
    const parsed: unknown = JSON.parse(raw)
    // `engram export` emits { version, exported_at, sessions, observations, prompts };
    // accept a bare observations array for compatibility with older builds.
    const observations = Array.isArray(parsed)
      ? parsed
      : (parsed as { observations?: unknown } | null)?.observations
    return Array.isArray(observations)
      ? { observations, error: null }
      : { observations: null, error: "engram-export-invalid" }
  } catch {
    return { observations: null, error: "engram-export-invalid" }
  } finally {
    try { fsSync.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

async function readEngramObservations(workspaceRoot: string): Promise<EngramObservation[] | null> {
  return readEngramObservationsWithError(workspaceRoot).observations
}

function selectEngramSnapshot(observations: EngramObservation[], changeName?: string): EngramSnapshot | null {
  const changeMap = new Map<string, Map<string, { content: string; created: string | null }>>()
  for (const obs of observations) {
    const key = obs.topic_key || ""
    const match = key.match(/^odf\/([^/]+)\/(.+)$/)
    if (!match) continue
    const [, change, artifactType] = match
    if (!changeMap.has(change)) changeMap.set(change, new Map())
    changeMap.get(change)!.set(artifactType, { content: obs.content, created: obs.created_at || null })
  }
  if (changeMap.size === 0) return null
  if (changeName && !changeMap.has(changeName)) return null

  const targetKeys = changeName && changeMap.has(changeName)
    ? new Map([[changeName, changeMap.get(changeName)!]])
    : changeMap
  let bestChange: string | null = changeName || null
  if (!bestChange) {
    let newestTimestamp: string | null = null
    let fallbackArtifactCount = 0
    for (const [name, artifacts] of targetKeys) {
      let latestTimestamp: string | null = null
      for (const { created } of artifacts.values()) {
        if (created && (!latestTimestamp || created > latestTimestamp)) latestTimestamp = created
      }
      if (latestTimestamp && (!newestTimestamp || latestTimestamp > newestTimestamp)) {
        newestTimestamp = latestTimestamp
        bestChange = name
      } else if (!newestTimestamp && !latestTimestamp && artifacts.size > fallbackArtifactCount) {
        fallbackArtifactCount = artifacts.size
        bestChange = name
      }
    }
  }
  if (!bestChange) return null
  const artifacts = targetKeys.get(bestChange)
  return artifacts ? { change: bestChange, artifacts } : null
}

interface ReceiptFileRead {
  receipt: WorkflowReceipt | null
  malformed: boolean
}

function readReceiptFile(workspaceRoot: string, changeName: string): ReceiptFileRead {
  const receiptPath = path.join(workspaceRoot, ".odf", `receipt-${changeName}.json`)
  try {
    const parsed: unknown = JSON.parse(fsSync.readFileSync(receiptPath, "utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { receipt: null, malformed: true }
    return { receipt: parsed as WorkflowReceipt, malformed: false }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { receipt: null, malformed: false }
      : { receipt: null, malformed: true }
  }
}

function readReceiptJson(workspaceRoot: string, changeName: string): WorkflowReceipt | null {
  const read = readReceiptFile(workspaceRoot, changeName)
  return read.malformed ? { status: "pending" } : read.receipt
}

interface SelectedWorkflowSnapshot {
  store: ArtifactStore
  state: Record<string, unknown>
  stateContent: string
  artifacts: StatusArtifact[]
  status: WorkflowStatus
}

export interface ExpectationsVerdict {
  status: "approved" | "missing" | "invalid"
  reason: "approved" | "missing-expectations" | "expectations-not-approved" | "expectations-invalid"
  message: string
  ids: string[]
}

function parseExpectationsArtifact(content: string): Record<string, unknown> | null {
  try {
    const value = parseDocument(content).toJSON()
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/** Pure T9 gate for the selected snapshot; no store or filesystem reads. */
export function evaluateExpectations(snapshot: Pick<SelectedWorkflowSnapshot, "artifacts" | "status">): ExpectationsVerdict {
  const artifact = snapshot.artifacts.find((candidate) => normalizeArtifactKey(candidate.key).type === "expectations")
  if (!artifact) {
    return { status: "missing", reason: "missing-expectations", message: "No human Expectations artifact exists; VERIFY uses legacy REQ-based evaluation.", ids: [] }
  }

  const value = parseExpectationsArtifact(artifact.content)
  const entries = value?.expectations
  const ids = Array.isArray(entries)
    ? entries.map((entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>).id : null)
      .filter((id): id is string => typeof id === "string")
    : []
  const validEntries = Array.isArray(entries) && entries.length > 0 && entries.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
    const item = entry as Record<string, unknown>
    return typeof item.id === "string" && /^EXP-\d+$/.test(item.id) &&
      typeof item.statement === "string" && item.statement.trim().length > 0 &&
      typeof item.testable === "boolean" && item.owned_by === "human"
  }) && new Set(ids).size === ids.length
  const matchesChange = value?.change === snapshot.status.change
  if (!value || !matchesChange || !validEntries || value.approved !== true ||
    typeof value.approved_by !== "string" || !value.approved_by.trim() ||
    !validDate(value.approved_at) || !validDate(value.immutable_since)) {
    const reason = value?.approved === false ? "expectations-not-approved" : "expectations-invalid"
    return {
      status: "invalid",
      reason,
      message: reason === "expectations-not-approved"
        ? "Human Expectations are not approved; approve them before VERIFY."
        : "The Expectations artifact is invalid or tampered; restore the approved human artifact before VERIFY.",
      ids,
    }
  }
  return { status: "approved", reason: "approved", message: `Approved human Expectations: ${ids.join(", ")}.`, ids }
}

interface SelectedWorkflowRead {
  snapshot: SelectedWorkflowSnapshot | null
  error: string | null
}

interface TransitionInspection {
  ok: boolean
  alreadyCommitted: boolean
  reason: string
  message: string
  snapshot: SelectedWorkflowSnapshot
  route: WorkflowRoute
  completed: CanonicalStage[]
}

export interface WorkflowCommitResult {
  status: "committed" | "already-committed" | "blocked"
  reason: string
  message: string
  store: ArtifactStore
  state_ref: string
  canonical_stage: WorkflowStage | null
  completed_stages: CanonicalStage[]
  validation: ValidationVerdict | null
  workflow_result: ReturnType<typeof advanceWorkflow> | null
}

const WORKFLOW_LOCK_SUFFIX = ".workflow.lock"

function parseStateDocument(content: string): { state: Record<string, unknown>; document: ReturnType<typeof parseDocument> } | null {
  try {
    const document = parseDocument(content)
    if (document.errors.length > 0 || !isMap(document.contents)) return null
    const value = document.toJSON()
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return { state: value as Record<string, unknown>, document }
  } catch {
    return null
  }
}

function selectedWorkflowArtifacts(changeName: string, observations: EngramObservation[]): StatusArtifact[] {
  const prefix = `odf/${changeName}/`
  const latest = new Map<string, EngramObservation>()
  for (const observation of observations) {
    if (!observation.topic_key?.startsWith(prefix) || observation.topic_key === `${prefix}state`) continue
    latest.set(observation.topic_key, observation)
  }
  return Array.from(latest.entries()).map(([key, observation]) => ({
    key,
    content: observation.content,
    created: observation.created_at || null,
    source: "engram",
  }))
}

async function readSelectedWorkflowState(
  workspaceRoot: string,
  changeName: string,
  store: ArtifactStore,
): Promise<SelectedWorkflowRead> {
  const receiptRead = readReceiptFile(workspaceRoot, changeName)
  if (receiptRead.malformed) return { snapshot: null, error: "workflow-receipt-malformed" }

  if (store === "openspec" || store === "hybrid") {
    const openSpec = await loadOpenSpecStatus(workspaceRoot, changeName)
    if (openSpec?.state) {
      const parsed = parseStateDocument(openSpec.state.content)
      if (!parsed) return { snapshot: null, error: "workflow-state-malformed" }
      const status = deriveWorkflowStatus({
        change: changeName,
        state: openSpec.state.content,
        artifacts: openSpec.artifacts,
        receipt: receiptRead.receipt,
        source: { state: "openspec", artifacts: [openSpec.state.key, ...openSpec.artifacts.map(artifact => artifact.key)] },
        warnings: openSpec.warnings,
      })
      return {
        snapshot: { store, state: parsed.state, stateContent: openSpec.state.content, artifacts: openSpec.artifacts, status },
        error: null,
      }
    }
    if (store === "openspec") return { snapshot: null, error: "workflow-state-not-found" }
  }

  const observations = await readEngramObservations(workspaceRoot)
  if (!observations) return { snapshot: null, error: "engram-state-unavailable" }
  const stateKey = `odf/${changeName}/state`
  const stateObservation = observations.filter(observation => observation.topic_key === stateKey).at(-1)
  if (!stateObservation) return { snapshot: null, error: "workflow-state-not-found" }
  const parsed = parseStateDocument(stateObservation.content)
  if (!parsed) return { snapshot: null, error: "workflow-state-malformed" }
  const artifacts = selectedWorkflowArtifacts(changeName, observations)
  const status = deriveWorkflowStatus({
    change: changeName,
    state: stateObservation.content,
    artifacts,
    receipt: receiptRead.receipt,
    source: { state: "engram", artifacts: [stateKey, ...artifacts.map(artifact => artifact.key)] },
  })
  return {
    snapshot: { store, state: parsed.state, stateContent: stateObservation.content, artifacts, status },
    error: null,
  }
}

function explicitCompletedStages(state: Record<string, unknown>, route: WorkflowRoute): CanonicalStage[] | null {
  const raw = state.completed_canonical_stages ?? state.completed_stages
  if (!Array.isArray(raw)) return null
  const values = raw.filter((value): value is string => typeof value === "string").map(value => value.toUpperCase())
  if (values.length !== raw.length || values.some(value => !route.stages.includes(value as CanonicalStage))) return null
  return route.stages.filter(stage => values.includes(stage))
}

function persistedCompletedStages(snapshot: SelectedWorkflowSnapshot, route: WorkflowRoute): CanonicalStage[] {
  return explicitCompletedStages(snapshot.state, route) || route.stages.filter(stage => snapshot.status.completed_canonical_stages.includes(stage))
}

function sameStages(left: CanonicalStage[], right: CanonicalStage[]): boolean {
  return left.length === right.length && left.every((stage, index) => stage === right[index])
}

function sameWorkflowAdvanceResult(
  left: ReturnType<typeof advanceWorkflow> | null | undefined,
  right: ReturnType<typeof advanceWorkflow>,
): boolean {
  return Boolean(left) && left!.status === right.status &&
    sameStages(left!.completed_stages, right.completed_stages) &&
    left!.next_stage === right.next_stage && left!.reason === right.reason
}

function workflowStateSignals(snapshot: SelectedWorkflowSnapshot): {
  archived: boolean
  resumable: boolean
  receiptState: WorkflowReceiptState
} {
  const archived = snapshot.status.canonical_stage === "ARCHIVED" || snapshot.state.archived === true ||
    String(snapshot.state.canonical_stage || "").toUpperCase() === "ARCHIVED"
  const abandoned = snapshot.state.abandoned === true || String(snapshot.state.status || "").toLowerCase() === "abandoned"
  const receiptAction = snapshot.status.receipt.action
  const orchestratorDisposition = receiptAction !== null && receiptAction !== "retry"
  return {
    archived,
    resumable: !archived && !abandoned && !orchestratorDisposition && snapshot.state.resumable !== false && snapshot.status.receipt.state !== "pending",
    receiptState: snapshot.status.receipt.state,
  }
}

function canonicalizeWorkflowAdvance(
  snapshot: SelectedWorkflowSnapshot,
  proof: ODFDelegateWorkflowAdvance,
  expectedStage: "BUILD" | "VERIFY",
): { proof: ODFDelegateWorkflowAdvance } | { reason: string; message: string } {
  const receiptAction = snapshot.status.receipt.action
  if (snapshot.status.receipt.state === "pending") {
    return { reason: "workflow-receipt-pending", message: "A receipt is pending user disposition." }
  }
  if (receiptAction && receiptAction !== "retry") {
    return {
      reason: "workflow-receipt-action-unhandled",
      message: `The committed receipt action ${receiptAction} requires orchestrator handling before continuation.`,
    }
  }

  const route = resolveWorkflowRoute(proof.work_type)
  const persistedWorkType = snapshot.status.work_type || snapshot.state.work_type
  if (persistedWorkType && persistedWorkType !== proof.work_type) {
    return {
      reason: "workflow-work-type-mismatch",
      message: `Persisted work_type ${persistedWorkType} does not match ${proof.work_type}.`,
    }
  }
  const signals = workflowStateSignals(snapshot)
  const expectedIndex = route.stages.indexOf(expectedStage)
  const candidateIndex = proof.candidate_stage === null ? -1 : route.stages.indexOf(proof.candidate_stage)
  const persisted = persistedCompletedStages(snapshot, route)
  return {
    proof: {
      ...proof,
      completed_stages: candidateIndex >= 0
        ? route.stages.slice(0, candidateIndex).filter(stage => persisted.includes(stage))
        : expectedIndex < 0 ? persisted : route.stages.slice(0, expectedIndex).filter(stage => persisted.includes(stage)),
      receipt_state: signals.receiptState,
      resumable_state: signals.resumable,
      archived_state: signals.archived,
    },
  }
}

function inspectPersistedTransition(opts: {
  snapshot: SelectedWorkflowSnapshot
  proof: ODFDelegateWorkflowAdvance
  expectedStage: "BUILD" | "VERIFY"
  callerResult: ReturnType<typeof advanceWorkflow>
}): TransitionInspection {
  const route = resolveWorkflowRoute(opts.proof.work_type)
  const signals = workflowStateSignals(opts.snapshot)
  const completed = persistedCompletedStages(opts.snapshot, route)
  const workType = opts.snapshot.status.work_type || opts.snapshot.state.work_type
  const fail = (reason: string, message: string): TransitionInspection => ({
    ok: false,
    alreadyCommitted: false,
    reason,
    message,
    snapshot: opts.snapshot,
    route,
    completed,
  })

  const locallyRecomputedProof = advanceWorkflow({
    route,
    completed_stages: opts.proof.completed_stages,
    candidate_stage: opts.proof.candidate_stage,
    phase_result_status: opts.proof.phase_result_status,
    validation_status: opts.proof.validation_status,
    receipt_state: opts.proof.receipt_state,
    resumable_state: opts.proof.resumable_state,
    archived_state: opts.proof.archived_state,
  })
  if (!sameWorkflowAdvanceResult(opts.callerResult, locallyRecomputedProof)) {
    return fail("workflow-proof-mismatch", "The supplied workflow proof is not the local advanceWorkflow result.")
  }

  if (workType !== opts.proof.work_type) {
    return fail(
      "workflow-work-type-mismatch",
      `Persisted work_type ${workType || "none"} does not match ${opts.proof.work_type}.`,
    )
  }
  if (signals.archived) return fail("workflow-archived", "Archived workflow state cannot enter BUILD or VERIFY.")
  if (signals.receiptState === "pending") return fail("workflow-receipt-pending", "A receipt is pending user disposition.")
  if (opts.snapshot.status.receipt.action && opts.snapshot.status.receipt.action !== "retry") {
    return fail("workflow-receipt-action-unhandled", "The committed receipt action requires orchestrator handling before continuation.")
  }
  if (!signals.resumable) return fail("workflow-not-resumable", "Persisted workflow state is not resumable.")

  const expectedIndex = route.stages.indexOf(opts.expectedStage)
  const expectedPrefix = expectedIndex < 0 ? [] : route.stages.slice(0, expectedIndex)
  const desiredAlreadyCommitted = expectedIndex >= 0 && completed.includes(opts.expectedStage) &&
    sameStages(completed, route.stages.slice(0, route.stages.indexOf(opts.expectedStage) + 1)) &&
    (opts.snapshot.status.canonical_stage === opts.expectedStage ||
      opts.snapshot.status.canonical_stage === "VERIFY" && opts.expectedStage === "BUILD")
  if (desiredAlreadyCommitted) {
    return {
      ok: true,
      alreadyCommitted: true,
      reason: "already-committed",
      message: `Workflow state already includes ${opts.expectedStage}.`,
      snapshot: opts.snapshot,
      route,
      completed,
    }
  }
  if (expectedIndex < 0) return fail("workflow-phase-mismatch", `${opts.expectedStage} is not part of the selected route.`)
  if (!sameStages(completed, expectedPrefix)) {
    return fail("workflow-state-stale", "Persisted completed stages do not match the requested route prefix.")
  }
  if (!sameStages(opts.callerResult.completed_stages, expectedPrefix)) {
    return fail("workflow-proof-stale", "The recomputed workflow proof does not identify the persisted route prefix.")
  }
  const pendingStage = route.stages.find(stage => !completed.includes(stage)) || null
  if (pendingStage !== opts.expectedStage) {
    return fail(
      "workflow-pending-stage-mismatch",
      `Persisted pending stage ${pendingStage || "none"} does not match ${opts.expectedStage}.`,
    )
  }
  const currentStage = opts.snapshot.status.canonical_stage
  const previousStage = expectedPrefix.at(-1) || null
  if (currentStage !== opts.expectedStage && currentStage !== previousStage) {
    return fail("workflow-state-stale", `Persisted canonical_stage ${currentStage} is not compatible with ${opts.expectedStage}.`)
  }
  if (opts.callerResult.status !== "advanced" || opts.callerResult.next_stage !== opts.expectedStage) {
    return fail("workflow-advance-blocked", opts.callerResult.reason)
  }
  return { ok: true, alreadyCommitted: false, reason: "ready", message: "Persisted workflow transition is ready.", snapshot: opts.snapshot, route, completed }
}

function workflowArtifactGate(snapshot: SelectedWorkflowSnapshot, expectedStage: "BUILD" | "VERIFY"): { reason: string; message: string } | null {
  const requiredType = expectedStage === "BUILD" ? "implement-progress" : "verify-report"
  const allowedTypes = expectedStage === "BUILD"
    ? new Set(["build", "implement-progress", "implement", "apply-progress", "tasks"])
    : new Set(["verify-report"])
  const refs = snapshot.status.artifact_refs[expectedStage]
  const declared = refs.some((ref) => allowedTypes.has(normalizeArtifactKey(ref).type))
  if (!declared) {
    return {
      reason: `workflow-${requiredType}-missing`,
      message: `${expectedStage} requires a terminal ${requiredType} artifact; persist it in ${snapshot.store} and continue the phase.`,
    }
  }

  const artifactStatus = deriveWorkflowStatus({
    change: snapshot.status.change,
    artifacts: snapshot.artifacts,
    source: snapshot.store,
  })
  if (!artifactStatus.completed_canonical_stages.includes(expectedStage)) {
    return {
      reason: `workflow-${requiredType}-not-terminal`,
      message: `${expectedStage} requires ${requiredType} to be terminal and successful; complete the artifact and continue the phase.`,
    }
  }
  return null
}

/**
 * VERIFY commit gate: re-validate the persisted validation-evidence file with
 * the blind artifact rules. The policy gate carries the authoritative risk tier
 * and frozen ref; without a persisted gate there is nothing to bind the
 * transition to, so the transition stays blocked.
 */
function verifyEvidenceVerdict(workspaceRoot: string, changeName: string, expectationsIds?: string[]): ValidationVerdict {
  let gate: Partial<PolicyGateDecision> | null = null
  try {
    gate = JSON.parse(
      fsSync.readFileSync(path.join(workspaceRoot, ".odf", `policy-gate-${changeName}.json`), "utf8")
    ) as Partial<PolicyGateDecision>
  } catch {
    gate = null
  }
  if (!gate) {
    return { status: "missing", reason: "verification-evidence-missing: no policy gate persisted for this change — run the policy gate before verifying", commands_validated: 0 }
  }
  return validateValidationEvidence({
    workspaceDir: workspaceRoot,
    change: changeName,
    tier: gate.risk_tier ?? "MEDIUM",
    frozenDiffRef: gate.frozen_diff_ref ?? null,
    expectationsIds,
  })
}

function workflowLockPath(workspaceRoot: string, changeName: string): string {
  return path.join(workspaceRoot, ".odf", `workflow-${changeName}${WORKFLOW_LOCK_SUFFIX}`)
}

function workflowStateReference(store: ArtifactStore, changeName: string): string {
  return store === "openspec"
    ? `openspec/changes/${changeName}/state.yaml`
    : store === "engram" ? `odf/${changeName}/state` : `openspec/changes/${changeName}/state.yaml + odf/${changeName}/state`
}

async function withWorkflowLock<T>(
  workspaceRoot: string,
  changeName: string,
  operation: () => Promise<T>,
): Promise<{ locked: true; value: T } | { locked: false; error: string }> {
  let lockPath = ""
  let lockFd: number | null = null
  try {
    const realWorkspace = await fs.realpath(workspaceRoot)
    const lockDirectory = path.join(realWorkspace, ".odf")
    if (!await safeDirectoryPath(realWorkspace, lockDirectory, true)) {
      return { locked: false, error: "workflow-lock-unsafe-path" }
    }
    lockPath = workflowLockPath(realWorkspace, changeName)
    try {
      lockFd = fsSync.openSync(lockPath, "wx")
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return { locked: false, error: code === "EEXIST" ? "workflow-state-locked" : "workflow-lock-failed" }
    }
    return { locked: true, value: await operation() }
  } catch {
    return { locked: false, error: "workflow-lock-failed" }
  } finally {
    if (lockFd !== null) {
      try { fsSync.closeSync(lockFd) } catch { /* best-effort */ }
      try { fsSync.unlinkSync(lockPath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[odf-delegation] Failed to clean up workflow lock: ${lockPath}`)
      }
    }
  }
}

function writeOpenSpecWorkflowState(
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  canonicalStage: "BUILD" | "VERIFY" | "ARCHIVED",
  completedStages: CanonicalStage[],
): string | null {
  const statePath = path.resolve(workspaceRoot, "openspec", "changes", changeName, "state.yaml")
  if (!isWithinRoot(statePath, path.resolve(workspaceRoot))) return "unsafe-state-path"
  const parsed = parseStateDocument(stateContent)
  if (!parsed) return "malformed-state"
  parsed.document.set("work_type", workType)
  parsed.document.set("canonical_stage", canonicalStage)
  parsed.document.set("completed_canonical_stages", completedStages)
  if (canonicalStage === "ARCHIVED") {
    parsed.document.set("phase", "archived")
    parsed.document.set("status", "archived")
    parsed.document.set("archived", true)
  }
  const tempPath = `${statePath}.${process.pid}.${nodeCrypto.randomUUID()}.tmp`
  try {
    const root = fsSync.realpathSync(path.resolve(workspaceRoot))
    const realStatePath = fsSync.realpathSync(statePath)
    if (!isWithinRoot(realStatePath, root)) return "unsafe-state-path"
    const serialized = parsed.document.toString()
    fsSync.writeFileSync(tempPath, serialized, { encoding: "utf8", flag: "wx" })
    fsSync.renameSync(tempPath, statePath)
    return null
  } catch {
    try { fsSync.unlinkSync(tempPath) } catch { /* best-effort */ }
    return "state-write-failed"
  }
}

function writeEngramWorkflowState(
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  canonicalStage: "BUILD" | "VERIFY" | "ARCHIVED",
  completedStages: CanonicalStage[],
): string | null {
  const parsed = parseStateDocument(stateContent)
  if (!parsed) return "malformed-state"
  parsed.document.set("work_type", workType)
  parsed.document.set("canonical_stage", canonicalStage)
  parsed.document.set("completed_canonical_stages", completedStages)
  if (canonicalStage === "ARCHIVED") {
    parsed.document.set("phase", "archived")
    parsed.document.set("status", "archived")
    parsed.document.set("archived", true)
  }
  const topicKey = `odf/${changeName}/state`
  const project = workspaceProjectName(resolveWorkspaceRoot(workspaceRoot))
  const content = JSON.stringify(parsed.document.toJSON())
  try {
    execFileSync("engram", [
      "save", topicKey, content,
      "--type", "architecture",
      "--project", project,
      "--scope", "project",
      "--topic", topicKey,
    ], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    })
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "ENOENT" ? "engram-cli-unavailable" : code === "ETIMEDOUT" ? "engram-save-timeout" : "engram-save-failed"
  }
}

function archiveReport(changeName: string, workType: WorkType, completedStages: CanonicalStage[]): string {
  return stringify({
    change: changeName,
    status: "archived",
    work_type: workType,
    completed_canonical_stages: completedStages,
    archived_at: new Date().toISOString(),
  })
}

function writeOpenSpecArchive(
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  completedStages: CanonicalStage[],
): string | null {
  const reportPath = path.resolve(workspaceRoot, "openspec", "changes", changeName, "archive-report.yaml")
  const root = path.resolve(workspaceRoot)
  if (!isWithinRoot(reportPath, root)) return "unsafe-archive-report-path"
  const reportTemp = `${reportPath}.${process.pid}.${nodeCrypto.randomUUID()}.tmp`
  try {
    fsSync.writeFileSync(reportTemp, archiveReport(changeName, workType, completedStages), { encoding: "utf8", flag: "wx" })
    fsSync.renameSync(reportTemp, reportPath)
  } catch {
    try { fsSync.unlinkSync(reportTemp) } catch { /* best-effort */ }
    return "archive-report-write-failed"
  }
  return writeOpenSpecWorkflowState(workspaceRoot, changeName, stateContent, workType, "ARCHIVED", completedStages)
}

function writeEngramArchive(
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  completedStages: CanonicalStage[],
): string | null {
  const stateError = writeEngramWorkflowState(workspaceRoot, changeName, stateContent, workType, "ARCHIVED", completedStages)
  if (stateError) return stateError
  const topicKey = `odf/${changeName}/archive-report`
  const project = workspaceProjectName(resolveWorkspaceRoot(workspaceRoot))
  try {
    execFileSync("engram", [
      "save", topicKey, archiveReport(changeName, workType, completedStages),
      "--type", "architecture", "--project", project, "--scope", "project", "--topic", topicKey,
    ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000, maxBuffer: 64 * 1024 })
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "ENOENT" ? "engram-cli-unavailable" : code === "ETIMEDOUT" ? "engram-save-timeout" : "archive-report-save-failed"
  }
}

function writeArchiveWorkflow(
  store: ArtifactStore,
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  completedStages: CanonicalStage[],
): string | null {
  if (store === "openspec") return writeOpenSpecArchive(workspaceRoot, changeName, stateContent, workType, completedStages)
  if (store === "engram") return writeEngramArchive(workspaceRoot, changeName, stateContent, workType, completedStages)
  // OpenSpec is the hybrid authority; Engram is an idempotent recovery mirror.
  const openSpecError = writeOpenSpecArchive(workspaceRoot, changeName, stateContent, workType, completedStages)
  if (openSpecError) return openSpecError
  return writeEngramArchive(workspaceRoot, changeName, stateContent, workType, completedStages)
}

/**
 * Block reason when any persisted content-bound artifact (policy gate, validation
 * evidence, receipt) is bound to a candidate digest that no longer matches the
 * workspace. Returns null when git is unavailable or no artifact carries a
 * digest (legacy flows stay unblocked; T3 makes the digest mandatory).
 */
function candidateDigestMismatchReason(workspaceRoot: string, changeName: string): string | null {
  const fresh = candidateDigestOrNull(workspaceRoot)
  if (fresh === null) return null

  const bindings: Array<{ label: string; digest: string }> = []
  try {
    const gate = JSON.parse(
      fsSync.readFileSync(path.join(workspaceRoot, ".odf", `policy-gate-${changeName}.json`), "utf8")
    ) as Partial<PolicyGateDecision>
    if (typeof gate.candidate_digest === "string") bindings.push({ label: "policy gate", digest: gate.candidate_digest })
  } catch { /* no persisted gate */ }
  try {
    const evidence = JSON.parse(
      fsSync.readFileSync(path.join(workspaceRoot, ".odf", `validation-evidence-${changeName}.json`), "utf8")
    ) as Partial<ValidationEvidenceFile>
    if (typeof evidence.candidate_digest === "string") bindings.push({ label: "validation evidence", digest: evidence.candidate_digest })
  } catch { /* no persisted evidence */ }
  const receiptRead = readReceiptFile(workspaceRoot, changeName)
  const receiptDigest = receiptRead.receipt?.candidate_digest
  if (typeof receiptDigest === "string") bindings.push({ label: "receipt", digest: receiptDigest })

  for (const binding of bindings) {
    if (binding.digest !== fresh) {
      return `candidate-digest-mismatch: the ${binding.label} is bound to candidate ${binding.digest}, workspace candidate is ${fresh}`
    }
  }
  return null
}

export async function commitWorkflowTransition(opts: {
  workspaceRoot: string
  changeName: string
  artifactStore: ArtifactStore
  proof: ODFDelegateWorkflowAdvance
  expectedStage: "BUILD" | "VERIFY" | "ARCHIVE"
  callerResult: ReturnType<typeof advanceWorkflow>
  phaseResultStatus: WorkflowPhaseResultStatus
  validationStatus: WorkflowValidationStatus
  validation: ValidationVerdict | null
  expectationsIds?: string[]
  parallel?: boolean
}): Promise<WorkflowCommitResult> {
  const stateRef = workflowStateReference(opts.artifactStore, opts.changeName)
  const makeResult = (
    status: WorkflowCommitResult["status"],
    reason: string,
    message: string,
    snapshot: SelectedWorkflowSnapshot | null,
    completedStages: CanonicalStage[],
    validation: ValidationVerdict | null,
    workflowResult: ReturnType<typeof advanceWorkflow> | null,
    canonicalStage: WorkflowStage | null = snapshot?.status.canonical_stage || null,
  ): WorkflowCommitResult => ({
    status,
    reason,
    message,
    store: opts.artifactStore,
    state_ref: stateRef,
    canonical_stage: canonicalStage,
    completed_stages: completedStages,
    validation,
    workflow_result: workflowResult,
  })

  if (opts.expectedStage !== "BUILD" && opts.expectedStage !== "VERIFY" && opts.expectedStage !== "ARCHIVE") {
    return makeResult(
      "blocked",
      "workflow-stage-unsupported",
      "Workflow commits may only target BUILD or VERIFY.",
      null,
      [],
      opts.validation,
      null,
    )
  }

  const locked = await withWorkflowLock(opts.workspaceRoot, opts.changeName, async () => {
    const read = await readSelectedWorkflowState(opts.workspaceRoot, opts.changeName, opts.artifactStore)
    if (!read.snapshot) {
      return makeResult(
        "blocked",
        read.error || "workflow-state-unavailable",
        "The selected workflow state could not be read safely.",
        null,
        [],
        opts.validation,
        null,
      )
    }
    if (opts.expectedStage === "ARCHIVE") {
      const route = resolveWorkflowRoute(opts.proof.work_type)
      const completed = persistedCompletedStages(read.snapshot, route)
      const alreadyArchived = read.snapshot.status.canonical_stage === "ARCHIVED" &&
        read.snapshot.artifacts.some(artifact => normalizeArtifactKey(artifact.key).type === "archive-report")
      if (alreadyArchived) {
        return makeResult("already-committed", "already-committed", "Workflow is already archived.", read.snapshot, completed, opts.validation, null, "ARCHIVED")
      }
      if (read.snapshot.status.canonical_stage !== "VERIFY" || !completed.includes("VERIFY")) {
        return makeResult("blocked", "workflow-verify-not-terminal", "ARCHIVE requires a terminal VERIFY state.", read.snapshot, completed, opts.validation, null)
      }
      if (opts.phaseResultStatus !== "ok" && opts.phaseResultStatus !== "warning") {
        return makeResult("blocked", "workflow-result-invalid", "The VERIFY result must have status ok or warning before archiving.", read.snapshot, completed, opts.validation, null)
      }
      const writeError = writeArchiveWorkflow(opts.artifactStore, opts.workspaceRoot, opts.changeName, read.snapshot.stateContent, opts.proof.work_type, route.stages)
      if (writeError) {
        return makeResult("blocked", writeError, "The archive state and report could not be synchronized.", read.snapshot, completed, opts.validation, null)
      }
      return makeResult("committed", "committed", `Archived workflow state to ${opts.artifactStore}.`, read.snapshot, route.stages, opts.validation, null, "ARCHIVED")
    }
    const inspection = inspectPersistedTransition({
      snapshot: read.snapshot,
      proof: opts.proof,
      expectedStage: opts.expectedStage,
      callerResult: opts.callerResult,
    })
    if (!inspection.ok || inspection.alreadyCommitted) {
      return makeResult(
        inspection.alreadyCommitted ? "already-committed" : "blocked",
        inspection.reason,
        inspection.message,
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }

    const digestMismatch = candidateDigestMismatchReason(opts.workspaceRoot, opts.changeName)
    if (digestMismatch) {
      return makeResult(
        "blocked",
        "candidate-digest-mismatch",
        digestMismatch,
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }

    if (opts.phaseResultStatus !== "ok" && opts.phaseResultStatus !== "warning") {
      return makeResult(
        "blocked",
        "workflow-result-invalid",
        "The actual phase result must have status ok or warning before workflow state can advance.",
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }

    const artifactFailure = workflowArtifactGate(read.snapshot, opts.expectedStage)
    if (artifactFailure) {
      return makeResult(
        "blocked",
        artifactFailure.reason,
        artifactFailure.message,
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }

    let validation = opts.validation
    if (opts.expectedStage === "VERIFY") validation = verifyEvidenceVerdict(opts.workspaceRoot, opts.changeName, opts.expectationsIds)
    if (validation?.status !== "verified") {
      const reason = validation?.status === "missing" ? "verification-evidence-missing" : "verification-evidence-invalid"
      return makeResult(
        "blocked",
        reason,
        validation?.reason || "Valid transition evidence is required.",
        read.snapshot,
        inspection.completed,
        validation,
        null,
      )
    }

    const postResult = advanceWorkflow({
      route: inspection.route,
      completed_stages: inspection.completed,
      candidate_stage: opts.expectedStage,
      phase_result_status: opts.phaseResultStatus,
      validation_status: opts.validationStatus,
      receipt_state: read.snapshot.status.receipt.state,
      resumable_state: workflowStateSignals(read.snapshot).resumable,
      archived_state: workflowStateSignals(read.snapshot).archived,
    })
    if (postResult.status !== "advanced" && postResult.status !== "complete") {
      return makeResult(
        "blocked",
        "workflow-advance-blocked",
        postResult.reason,
        read.snapshot,
        inspection.completed,
        validation,
        postResult,
      )
    }

    const writeError = opts.artifactStore === "openspec"
      ? writeOpenSpecWorkflowState(opts.workspaceRoot, opts.changeName, read.snapshot.stateContent, opts.proof.work_type, opts.expectedStage, postResult.completed_stages)
      : writeEngramWorkflowState(opts.workspaceRoot, opts.changeName, read.snapshot.stateContent, opts.proof.work_type, opts.expectedStage, postResult.completed_stages)
    if (writeError) {
      return makeResult(
        "blocked",
        writeError,
        "The selected workflow state could not be committed.",
        read.snapshot,
        inspection.completed,
        validation,
        postResult,
      )
    }
    return makeResult(
      "committed",
      "committed",
      `Committed ${opts.expectedStage} workflow state to ${opts.artifactStore}.`,
      read.snapshot,
      postResult.completed_stages,
      validation,
      postResult,
      opts.expectedStage,
    )
  })
  if (!locked.locked) {
    return makeResult(
      "blocked",
      locked.error,
      "The selected workflow state could not be locked safely.",
      null,
      [],
      opts.validation,
      null,
    )
  }
  return locked.value
}

export interface ProofBackedLifecycleInput {
  workspaceRoot: string
  changeName: string
  artifactStore: ArtifactStore
  proof: ODFDelegateWorkflowAdvance
  expectedStage: "BUILD" | "VERIFY"
  callerResult: ReturnType<typeof advanceWorkflow>
  innerResultStatus: WorkflowPhaseResultStatus | null
  validationStatus: WorkflowValidationStatus
  validation: ValidationVerdict | null
  expectationsIds?: string[]
  parallel?: boolean
}

/**
 * Orchestrate only the proof-backed lifecycle boundary. Callers retain
 * ownership of receipts, attempts, metrics, and public response envelopes.
 */
export async function resolveProofBackedLifecycle(opts: ProofBackedLifecycleInput): Promise<WorkflowCommitResult> {
  const stateRef = workflowStateReference(opts.artifactStore, opts.changeName)
  const blocked = (reason: string, message: string): WorkflowCommitResult => ({
    status: "blocked",
    reason,
    message,
    store: opts.artifactStore,
    state_ref: stateRef,
    canonical_stage: null,
    completed_stages: [],
    validation: opts.validation,
    workflow_result: opts.callerResult,
  })

  if (opts.innerResultStatus !== "ok" && opts.innerResultStatus !== "warning") {
    return blocked(
      opts.innerResultStatus === "blocked" ? "inner-result-status-blocked" : "inner-result-status-invalid",
      opts.innerResultStatus === "blocked"
        ? "The inner phase result is blocked."
        : opts.innerResultStatus === "failed"
          ? "The inner phase result failed."
          : "The inner phase result is missing or has an invalid status.",
    )
  }

  if (opts.expectedStage === "BUILD" && opts.validation?.status !== "verified") {
    return blocked(
      "workflow-evidence-invalid",
      opts.validation?.reason || "IMPLEMENT evidence is not verified.",
    )
  }

  return commitWorkflowTransition({
    workspaceRoot: opts.workspaceRoot,
    changeName: opts.changeName,
    artifactStore: opts.artifactStore,
    proof: opts.proof,
    expectedStage: opts.expectedStage,
    callerResult: opts.callerResult,
    phaseResultStatus: opts.innerResultStatus,
    validationStatus: opts.validationStatus,
    validation: opts.validation,
    expectationsIds: opts.expectationsIds,
    parallel: opts.parallel,
  })
}

function persistWorkflowFailureReceipt(
  workspaceRoot: string,
  changeName: string,
  phase: ODFReceipt["phase"],
  summary: string,
  policyGate: PolicyGateDecision | null,
  refs: string[] = [],
  status: ODFReceipt["status"] = "blocked",
  cause: ODFReceipt["cause"] = "validation-failed",
  expectationsIds: string[] = [],
): ODFReceipt {
  const frozenDiffRef = policyGate?.frozen_diff_ref || gitHead(workspaceRoot)
  return mergeReceipt(workspaceRoot, {
    change: changeName,
    phase,
    status,
    cause,
    evidence: {
      summary,
      frozen_diff_ref: frozenDiffRef,
      failing: [summary],
      refs: Array.from(new Set([
        ...refs,
        ...(policyGate ? [path.join(".odf", `policy-gate-${changeName}.json`)] : []),
      ])),
    },
    action: null,
    review_gate: null,
    frozen_diff_ref: frozenDiffRef,
    ...(expectationsIds.length ? { expectations_ids: expectationsIds } : {}),
    resolved_at: new Date().toISOString(),
  })
}

function buildEngramStatus(
  workspaceRoot: string,
  snapshot: EngramSnapshot,
  warnings: string[] = []
): ODFChangeStatus {
  const { change: bestChange, artifacts } = snapshot

  const status = {
    change: bestChange,
    phase: "init",
    artifacts: {},
    applyProgress: { completed: 0, total: 0 },
    lastUpdated: null,
  } as ODFChangeStatus

  // Map artifact types to state
  const artifactStates: Record<string, string> = {}
  for (const [type, data] of artifacts) {
    artifactStates[type] = "done"
    if (data.created && Number.isFinite(Date.parse(data.created)) && (!status.lastUpdated || data.created > status.lastUpdated)) {
      status.lastUpdated = data.created
    }
  }
  status.artifacts = artifactStates

  const workflowArtifacts = Array.from(artifacts.entries()).map(([type, data]) => ({
    key: `odf/${bestChange}/${type}`,
    content: data.content,
    created_at: data.created,
  }))
  const expectationWarnings = validateExpectations({ change: bestChange, artifacts: workflowArtifacts }).status === "missing"
    ? ["missing-expectations"]
    : []
  const expectationsOnly = artifacts.size > 0 && Array.from(artifacts.keys()).every(type => normalizeArtifactKey(type).type === "expectations")
  status.workflowStatus = deriveWorkflowStatus({
    change: bestChange,
    artifacts: workflowArtifacts,
    receipt: readReceiptJson(workspaceRoot, bestChange),
    source: {
      state: artifacts.has("state") || !expectationsOnly ? "engram" : "none",
      artifacts: workflowArtifacts.map((artifact) => artifact.key),
    },
    warnings: [...warnings, ...expectationWarnings],
  })
  status.phase = status.workflowStatus.legacy_phase?.toLowerCase() || "init"
  status.applyProgress = {
    completed: status.workflowStatus.progress.completed,
    total: status.workflowStatus.progress.total,
  }

  return status
}

export async function loadEngramStatus(workspaceRoot: string, changeName?: string): Promise<ODFChangeStatus | null> {
  const observations = await readEngramObservations(workspaceRoot)
  const snapshot = observations ? selectEngramSnapshot(observations, changeName) : null
  return snapshot ? buildEngramStatus(workspaceRoot, snapshot) : null
}

function contentStatus(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const status = parsed.status || parsed.final_verdict || (parsed.outcome as Record<string, unknown> | undefined)?.status
    return typeof status === "string" ? status.toLowerCase() : null
  } catch {
    return content.match(/(?:^|\n)\s*(?:status|final_verdict):\s*["']?([A-Za-z_-]+)/i)?.[1]?.toLowerCase() || null
  }
}

function conflictWarnings(openSpec: OpenSpecSnapshot, engram: EngramSnapshot | null): string[] {
  if (!engram) return []
  const warnings: string[] = []
  const add = (message: string): void => {
    if (!warnings.includes(message)) warnings.push(message)
  }
  const compare = (open: StatusArtifact, legacy: StatusArtifact, label: string): void => {
    if (open.content !== legacy.content) add(`Conflicting ${label} content; OpenSpec artifact "${open.key}" was kept over Engram "${legacy.key}".`)
    if (open.created && legacy.created && open.created !== legacy.created) {
      add(`Conflicting ${label} timestamps; OpenSpec artifact "${open.key}" was kept over Engram "${legacy.key}".`)
    }
    const openStatus = contentStatus(open.content)
    const legacyStatus = contentStatus(legacy.content)
    if (openStatus && legacyStatus && openStatus !== legacyStatus) {
      add(`Conflicting ${label} status; OpenSpec artifact "${open.key}" was kept over Engram "${legacy.key}".`)
    }
  }

  const openState = openSpec.state
  const engramState = Array.from(engram.artifacts.entries())
    .map(([type, data]) => ({ type, data }))
    .find(({ type }) => normalizeArtifactKey(type).type === "state")
  if (openState && engramState) {
    compare(openState, { key: `odf/${engram.change}/${engramState.type}`, ...engramState.data, source: "engram" }, "state")
  }

  for (const [type, data] of engram.artifacts) {
    const legacy: StatusArtifact = { key: `odf/${engram.change}/${type}`, ...data, source: "engram" }
    const normalized = normalizeArtifactKey(legacy.key)
    if (!normalized.group) continue
    const candidates = openSpec.artifacts.filter((artifact) => normalizeArtifactKey(artifact.key).group === normalized.group)
    const open = candidates.find((artifact) => normalizeArtifactKey(artifact.key).type === normalized.type) || candidates[0]
    if (open) compare(open, legacy, `artifact ${normalized.group}`)
  }
  return warnings
}

function buildMergedStatus(
  workspaceRoot: string,
  openSpec: OpenSpecSnapshot,
  engram: EngramSnapshot | null,
): ODFChangeStatus {
  const warnings = [...openSpec.warnings, ...conflictWarnings(openSpec, engram)]
  const openGroups = new Set(openSpec.artifacts
    .map((artifact) => normalizeArtifactKey(artifact.key).group)
    .filter((group): group is WorkflowStage => Boolean(group)))
  const mergedArtifacts = [...openSpec.artifacts]
  if (engram) {
    for (const [type, data] of engram.artifacts) {
      const artifact: StatusArtifact = { key: `odf/${engram.change}/${type}`, ...data, source: "engram" }
      const normalized = normalizeArtifactKey(artifact.key)
      if (
        normalized.type === "state" ||
        (normalized.group !== null && openGroups.has(normalized.group))
      ) continue
      mergedArtifacts.push(artifact)
    }
  }

  const sourceRefs = [
    ...(openSpec.state ? [openSpec.state.key] : []),
    ...openSpec.artifacts.map((artifact) => artifact.key),
    ...(engram ? Array.from(engram.artifacts.keys()).map((type) => `odf/${engram.change}/${type}`) : []),
  ]
  const expectationWarnings = validateExpectations({ change: openSpec.change, artifacts: mergedArtifacts }).status === "missing"
    ? ["missing-expectations"]
    : []
  const workflowStatus = deriveWorkflowStatus({
    change: openSpec.change,
    state: openSpec.state?.content || null,
    artifacts: mergedArtifacts,
    receipt: readReceiptJson(workspaceRoot, openSpec.change),
    source: { state: openSpec.state ? "openspec" : "none", artifacts: Array.from(new Set(sourceRefs)) },
    warnings: Array.from(new Set([...warnings, ...expectationWarnings])),
  })
  const artifactStates: Record<string, string> = {}
  for (const artifact of mergedArtifacts) artifactStates[normalizeArtifactKey(artifact.key).type] = "done"
  let lastUpdated: string | null = null
  for (const artifact of mergedArtifacts) {
    if (artifact.created && Number.isFinite(Date.parse(artifact.created)) && (!lastUpdated || artifact.created > lastUpdated)) {
      lastUpdated = artifact.created
    }
  }
  return {
    change: openSpec.change,
    phase: workflowStatus.legacy_phase?.toLowerCase() || "init",
    artifacts: artifactStates,
    applyProgress: { completed: workflowStatus.progress.completed, total: workflowStatus.progress.total },
    lastUpdated,
    workflowStatus,
  }
}

function attachParallelJoinStatus(status: ODFChangeStatus, workspaceRoot: string): ODFChangeStatus {
  const loaded = readParallelJoinArtifact(workspaceRoot, status.change)
  if (loaded.warning) {
    status.workflowStatus.warnings = Array.from(new Set([...status.workflowStatus.warnings, loaded.warning]))
  } else if (loaded.artifact) {
    status.workflowStatus.parallel_join = loaded.artifact
  }
  return status
}

async function loadCombinedWorkflowStatus(workspaceRoot: string, changeName?: string): Promise<ODFChangeStatus | null> {
  const requestedChange = changeName?.trim() || undefined
  const observations = await readEngramObservations(workspaceRoot)
  const engram = observations
    ? selectEngramSnapshot(observations, requestedChange)
    : null
  const targetChange = requestedChange || engram?.change
  const openSpec = targetChange ? await loadOpenSpecStatus(workspaceRoot, targetChange) : null
  if (!openSpec?.state) {
    if (engram) return attachParallelJoinStatus(buildEngramStatus(workspaceRoot, engram, openSpec?.warnings || []), workspaceRoot)
    return openSpec?.artifacts.length
      ? attachParallelJoinStatus(buildMergedStatus(workspaceRoot, openSpec, null), workspaceRoot)
      : null
  }
  return attachParallelJoinStatus(buildMergedStatus(workspaceRoot, openSpec, engram), workspaceRoot)
}

function createODFStatus(): ReturnType<typeof tool> {
  return tool({
    description: `Show ODF change status by resolving from Engram observations.

Returns structured JSON with current phase, artifact states, task progress,
and timestamps. Useful for /odf-status when no openspec/ directory exists.`,
    args: {
      change_name: tool.schema
        .string()
        .optional()
        .describe("Change name to inspect (omit for latest active change)"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Project directory (defaults to cwd)"),
    },
    async execute(args: { change_name?: string; workspace_dir?: string }): Promise<string> {
      const workspace = args.workspace_dir || process.cwd()
      const status = await loadEngramStatus(workspace, args.change_name)
      if (!status) {
        return JSON.stringify({ status: "not-found", message: "No ODF changes found in Engram" }, null, 2)
      }
      const { workflowStatus: _workflowStatus, ...legacyStatus } = status
      return JSON.stringify({ status: "found", ...legacyStatus }, null, 2)
    },
  })
}

function createODFWorkflowStatus(): ReturnType<typeof tool> {
  return tool({
    description: `Show canonical ODF workflow progress derived read-only from OpenSpec/Engram-compatible artifacts.

Returns canonical stages and legacy compatibility fields. It never writes state or receipts.`,
    args: {
      change_name: tool.schema
        .string()
        .optional()
        .describe("Change name to inspect (omit for latest active change)"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Project directory (defaults to cwd)"),
    },
    async execute(args: { change_name?: string; workspace_dir?: string }): Promise<string> {
      const workspace = args.workspace_dir || process.cwd()
      const status = await loadCombinedWorkflowStatus(workspace, args.change_name)
      if (!status) {
        return JSON.stringify({ status: "not-found", message: "No ODF changes found in Engram" }, null, 2)
      }
      return JSON.stringify({
        status: "found",
        ...status.workflowStatus,
        phase: status.phase,
        artifacts: status.artifacts,
        applyProgress: status.applyProgress,
        lastUpdated: status.lastUpdated,
      }, null, 2)
    },
  })
}

function isCanonicalWorkType(value: unknown): value is WorkType {
  return typeof value === "string" && WORK_TYPES.includes(value as WorkType)
}

interface WorkflowBindExpectations {
  change: string
  intent: string
  expectations: Array<{ id: string; statement: string; testable: boolean; owned_by: "human" }>
  approved: boolean
  approved_by: string
  approved_at: string
  immutable_since: string
}

interface WorkflowBindArgs {
  change_name?: string
  work_type?: unknown
  workspace_dir?: string
  artifact_store?: "openspec" | "engram"
  preflight?: Record<string, unknown>
  expectations?: WorkflowBindExpectations
  terminal_stage?: "DECIDE" | "FIX"
  intent?: string
  expectations_approved?: boolean
  root_cause?: string
  regression?: string
}

interface ODFEntryAuthorization {
  nonce: string
  sessionID: string
  messageID: string
  generation: number
  changeName: string
  workspaceRoot: string
  claimed: boolean
}
type ODFEntryAuthorizations = Map<string, ODFEntryAuthorization>
type ODFEntryGenerations = Map<string, number>

function canonicalChangeName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : ""
  return CHANGE_NAME_PATTERN.test(raw) ? sanitizeChangeName(raw) : ""
}

function canonicalWorkflowValue(value: unknown): string {
  return JSON.stringify(canonicalLoopGuardValue(value))
}

function saveEngramTopic(workspaceRoot: string, project: string, topicKey: string, content: string): string | null {
  try {
    execFileSync("engram", [
      "save", topicKey, content,
      "--type", "architecture",
      "--project", project,
      "--scope", "project",
      "--topic", topicKey,
    ], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    })
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "ENOENT" ? "engram-cli-unavailable" : code === "ETIMEDOUT" ? "engram-save-timeout" : "engram-save-failed"
  }
}

async function writeAtomicFile(filePath: string, content: string): Promise<boolean> {
  const tempPath = `${filePath}.${process.pid}.${nodeCrypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" })
    await fs.rename(tempPath, filePath)
    return true
  } catch {
    try { await fs.unlink(tempPath) } catch { /* best-effort */ }
    return false
  }
}

async function safeDirectoryPath(workspaceRoot: string, directory: string, create: boolean): Promise<boolean> {
  const realRoot = await fs.realpath(workspaceRoot)
  const relative = path.relative(realRoot, directory)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return relative === ""
  let current = realRoot
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) return false
      if (!isWithinRoot(await fs.realpath(current), realRoot)) return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false
      if (!create) return true
      try {
        await fs.mkdir(current)
        const created = await fs.lstat(current)
        if (created.isSymbolicLink() || !created.isDirectory() || !isWithinRoot(await fs.realpath(current), realRoot)) return false
      } catch {
        return false
      }
    }
  }
  return true
}

async function safeOptionalPath(workspaceRoot: string, filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath)
    return !stat.isSymbolicLink() && isWithinRoot(await fs.realpath(filePath), await fs.realpath(workspaceRoot))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
  }
}

function createODFWorkflowBind(
  entryAuthorizations: ODFEntryAuthorizations = new Map(),
  entryGenerations: ODFEntryGenerations = new Map(),
): ReturnType<typeof tool> {
  return tool({
    description: `Start or bind a canonical ODF workflow in the selected artifact store.

With preflight, the operation initializes missing state and persists approved Expectations
only after canonical state exists. Existing state and Expectations are reused only when identical.`,
    args: {
      change_name: tool.schema
        .string()
        .describe("Safe ODF change name"),
      work_type: tool.schema
        .enum([
          "question",
          "investigation",
          "standard-config",
          "small-change",
          "feature",
          "cross-domain",
          "bugfix",
          "migration",
          "security",
          "verify-only",
        ])
        .describe("Canonical work type to persist"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Project directory (defaults to cwd)"),
      artifact_store: tool.schema
        .enum(["openspec", "engram"])
        .optional()
        .describe("Artifact store for the binding (defaults to openspec)"),
      preflight: tool.schema.object({
        change: tool.schema.string(),
        execution_mode: tool.schema.enum(["interactive", "batch"]),
        artifact_store: tool.schema.enum(["openspec", "engram", "hybrid"]),
        delivery_strategy: tool.schema.enum(["ask-always", "ask-on-risk", "auto-chain", "single-pr"]),
        review_budget_lines: tool.schema.number(),
        odoo_version: tool.schema.number(),
        tdd_mode: tool.schema.boolean(),
        solution_strategy: tool.schema.enum(["standard", "custom", "pending"]),
        chain_strategy: tool.schema.enum(["none", "chained", "feature-branch"]),
        persisted_at: tool.schema.string().optional(),
      }).optional().describe("Complete preflight used to initialize a missing workflow state"),
      expectations: tool.schema.object({
        change: tool.schema.string(),
        intent: tool.schema.string(),
        expectations: tool.schema.array(tool.schema.object({
          id: tool.schema.string(),
          statement: tool.schema.string(),
          testable: tool.schema.boolean(),
          owned_by: tool.schema.enum(["human"]),
        })),
        approved: tool.schema.boolean(),
        approved_by: tool.schema.string(),
        approved_at: tool.schema.string(),
        immutable_since: tool.schema.string(),
      }).optional().describe("Approved human Expectations to persist after canonical state"),
      terminal_stage: tool.schema
        .enum(["DECIDE", "FIX"])
        .optional()
        .describe("Materialize the terminal micro prefix before BUILD"),
      intent: tool.schema.string().optional().describe("User intent for a terminal DECIDE"),
      expectations_approved: tool.schema.boolean().optional().describe("Whether the user's Expectations were approved"),
      root_cause: tool.schema.string().optional().describe("Root-cause analysis for a terminal FIX"),
      regression: tool.schema.string().optional().describe("Minimal regression for a terminal FIX"),
    },
    async execute(args: WorkflowBindArgs, toolCtx: ToolContext): Promise<string> {
      const blocked = (reason: string, message: string): string => JSON.stringify({ status: "blocked", reason, message }, null, 2)
      const changeName = canonicalChangeName(args.change_name)
      if (!changeName) {
        return blocked("unsafe-change-path", "The change name is not a safe OpenSpec path segment.")
      }
      if (!isCanonicalWorkType(args.work_type)) {
        return blocked("invalid-work-type", "The work_type is not a canonical ODF work type.")
      }
      if (args.artifact_store !== undefined && args.artifact_store !== "openspec" && args.artifact_store !== "engram") {
        return blocked("invalid-artifact-store", "The artifact_store must be openspec or engram.")
      }

      let workspaceRoot: string
      try {
        workspaceRoot = canonicalWorkspaceRoot(
          typeof args.workspace_dir === "string" && args.workspace_dir.trim()
            ? args.workspace_dir
            : process.cwd(),
        )
      } catch {
        return blocked("unsafe-workspace-path", "The workspace directory does not resolve to a safe existing root.")
      }
      const artifactStore = args.artifact_store || "openspec"
      const terminalStage = args.terminal_stage
      const validTerminal = (args.work_type === "small-change" || args.work_type === "standard-config") && terminalStage === "DECIDE" ||
        args.work_type === "bugfix" && terminalStage === "FIX"
      if (terminalStage !== undefined && !validTerminal) return blocked("invalid-terminal-stage", "The terminal stage is not valid for this work type.")
      const expectationsIntent = args.expectations?.intent.trim()
      if (terminalStage === "DECIDE" && (!(args.intent?.trim() || expectationsIntent) || args.expectations_approved !== true && !args.expectations)) {
        return blocked("expectations-not-approved", "A terminal DECIDE requires user intent and approved Expectations.")
      }
      if (terminalStage === "FIX" && (!args.root_cause?.trim() || !args.regression?.trim())) {
        return blocked("fix-evidence-missing", "A terminal FIX requires root-cause analysis and a minimal regression.")
      }
      if (args.intent?.trim() && expectationsIntent && args.intent.trim() !== expectationsIntent) {
        return blocked("expectations-intent-mismatch", "The terminal intent does not match the approved Expectations artifact.")
      }

      let preflight: PreflightRecord | null = null
      if (args.preflight) {
        const validation = validatePreflight(args.preflight)
        if (!validation.valid) return blocked("invalid-preflight", "The preflight record is incomplete or invalid.")
        preflight = {
          ...validation.normalized,
          persisted_at: validDate(args.preflight.persisted_at)
            ? args.preflight.persisted_at as string
            : validation.normalized.persisted_at,
        }
        if (preflight.change !== changeName) return blocked("preflight-change-mismatch", "Preflight change does not match change_name.")
        if (preflight.artifact_store !== artifactStore && !(preflight.artifact_store === "hybrid" && artifactStore === "openspec")) {
          return blocked("preflight-store-mismatch", "Preflight artifact_store must match the selected binding store; hybrid starts in its OpenSpec authority.")
        }
      }

      const expectations = args.expectations
      if (expectations) {
        const verdict = validateExpectations({
          change: changeName,
          artifacts: [{ key: `odf/${changeName}/expectations`, content: expectations }],
        })
        if (verdict.status !== "approved") {
          return blocked("expectations-invalid", "The supplied Expectations artifact is not a valid approved human contract.")
        }
      }

      const route = resolveWorkflowRoute(args.work_type)
      const stateArtifactStore = preflight?.artifact_store || artifactStore
      const sessionID = toolCtx?.sessionID
      const messageID = toolCtx?.messageID
      const authorization = sessionID ? entryAuthorizations.get(sessionID) : null
      const generation = sessionID ? entryGenerations.get(sessionID) : undefined
      const capabilityMatches = Boolean(authorization && !authorization.claimed &&
        authorization.sessionID === sessionID && authorization.messageID === messageID &&
        authorization.generation === generation && authorization.changeName === changeName &&
        authorization.workspaceRoot === workspaceRoot)
      if (authorization && !capabilityMatches) {
        return blocked("workflow-start-unauthorized", "Workflow initialization authorization does not match this message, generation, change, or workspace.")
      }
      if (capabilityMatches) authorization!.claimed = true
      const claimedCapability = capabilityMatches ? authorization! : null
      const prepareState = (content: string, existed: boolean): {
        document?: ReturnType<typeof parseDocument>
        action?: "created" | "updated" | "reused"
        preflightMirrored?: boolean
        error?: string
      } => {
        let document: ReturnType<typeof parseDocument>
        try {
          document = parseDocument(content)
        } catch {
          return { error: "malformed-state" }
        }
        if (document.errors.length > 0 || !isMap(document.contents)) return { error: "malformed-state" }
        const current = document.toJSON() as Record<string, unknown>
        if (current.work_type !== undefined && current.work_type !== args.work_type) return { error: "work-type-conflict" }
        if (current.change !== undefined && current.change !== changeName) return { error: "state-change-conflict" }
        if (preflight && current.artifact_store !== undefined && current.artifact_store !== stateArtifactStore) return { error: "artifact-store-conflict" }
        if (preflight && current.route !== undefined && canonicalWorkflowValue(current.route) !== canonicalWorkflowValue(route)) {
          return { error: "route-conflict" }
        }
        const explicitStage = typeof current.canonical_stage === "string" ? current.canonical_stage.toUpperCase() : null
        if (terminalStage && explicitStage && explicitStage !== terminalStage) return { error: "active-state-conflict" }

        let persistedPreflight: Record<string, unknown> | null = null
        const currentPreflight = current.preflight && typeof current.preflight === "object" && !Array.isArray(current.preflight)
          ? current.preflight as Record<string, unknown>
          : null
        if (preflight) {
          if (currentPreflight?.work_type !== undefined && currentPreflight.work_type !== args.work_type) return { error: "work-type-conflict" }
          if (currentPreflight) {
            const comparableKeys = Object.keys(preflight).filter(key => key !== "persisted_at")
            if (comparableKeys.some(key => canonicalWorkflowValue(currentPreflight[key]) !== canonicalWorkflowValue(preflight![key]))) {
              return { error: "preflight-conflict" }
            }
          }
          persistedPreflight = {
            ...(currentPreflight || {}),
            ...preflight,
            persisted_at: validDate(currentPreflight?.persisted_at) ? currentPreflight!.persisted_at : preflight.persisted_at,
            work_type: args.work_type,
          }
        }

        const before = canonicalWorkflowValue(current)
        document.set("work_type", args.work_type)
        const existingPreflightNode = document.get("preflight", true)
        if (persistedPreflight) {
          document.set("change", changeName)
          document.set("artifact_store", stateArtifactStore)
          document.set("preflight", persistedPreflight)
          document.set("route", route)
        } else if (isMap(existingPreflightNode)) {
          existingPreflightNode.set("work_type", args.work_type)
        }
        if (!existed) {
          if (preflight) document.set("phase", "preflight")
          if (preflight) document.set("canonical_stage", route.entry)
          if (preflight) document.set("completed_canonical_stages", [])
        }
        if (terminalStage) {
          document.set("canonical_stage", terminalStage)
          document.set("completed_canonical_stages", [terminalStage])
        }
        let action: "created" | "updated" | "reused" = existed ? "reused" : "created"
        if (before !== canonicalWorkflowValue(document.toJSON())) {
          action = existed ? "updated" : "created"
          if (preflight) document.set("last_updated", new Date().toISOString())
        }
        return { document, action, preflightMirrored: isMap(document.get("preflight", true)) }
      }

      const compareExpectations = (existingContent: string | null, stateExists: boolean): "none" | "persisted" | "reused" | string => {
        if (!existingContent) return expectations ? "persisted" : "none"
        const verdict = validateExpectations({
          change: changeName,
          artifacts: [{ key: `odf/${changeName}/expectations`, content: existingContent }],
        })
        if (verdict.status !== "approved") return "expectations-tampered"
        if (!expectations) return stateExists ? "none" : "expectations-reuse-required"
        try {
          const existing = parseDocument(existingContent).toJSON()
          return canonicalWorkflowValue(existing) === canonicalWorkflowValue(expectations)
            ? "reused"
            : "expectations-conflict"
        } catch {
          return "expectations-tampered"
        }
      }

      const compareTerminalArtifact = (existingContent: string | null): "none" | "persisted" | "reused" | "terminal-artifact-conflict" => {
        if (!terminalStage) return "none"
        if (!existingContent) return "persisted"
        try {
          const existing = parseDocument(existingContent).toJSON() as Record<string, unknown>
          const matches = terminalStage === "DECIDE"
            ? existing.status === "passed" && existing.intent === (args.intent?.trim() || expectationsIntent) && existing.expectations_approved === true
            : existing.status === "passed" && existing.root_cause === args.root_cause!.trim() && existing.regression === args.regression!.trim()
          return matches ? "reused" : "terminal-artifact-conflict"
        } catch {
          return "terminal-artifact-conflict"
        }
      }

      let locked: Awaited<ReturnType<typeof withWorkflowLock<string>>>
      try {
        locked = await withWorkflowLock(workspaceRoot, changeName, async (): Promise<string> => {
        if (artifactStore === "engram") {
          const read = readEngramObservationsWithError(workspaceRoot)
          if (!read.observations) return blocked(read.error || "engram-export-failed", "Existing Engram workflow state could not be inspected safely.")
          const stateKey = `odf/${changeName}/state`
          const expectationsKey = `odf/${changeName}/expectations`
          const stateObservation = read.observations.filter(observation => observation.topic_key === stateKey).at(-1)
          const expectationsObservation = read.observations.filter(observation => observation.topic_key === expectationsKey).at(-1)
          if (!stateObservation && !preflight) {
            return blocked("workflow-start-preflight-required", "An ordinary Engram bind can only update existing state; initialization requires complete preflight.")
          }
          if (!stateObservation && !claimedCapability) {
            return blocked("workflow-start-unauthorized", "Engram state initialization requires same-session /odf-new health authorization for this change.")
          }
          const terminalKey = terminalStage ? `odf/${changeName}/${terminalStage === "DECIDE" ? "decision" : "fix"}` : null
          const terminalObservation = terminalKey
            ? read.observations.filter(observation => observation.topic_key === terminalKey).at(-1)
            : null
          const expectationsAction = compareExpectations(expectationsObservation?.content || null, Boolean(stateObservation))
          if (expectationsAction.startsWith("expectations-")) {
            return blocked(expectationsAction, "Existing Expectations are missing from the retry input, different, invalid, or tampered.")
          }
          const terminalAction = compareTerminalArtifact(terminalObservation?.content || null)
          if (terminalAction === "terminal-artifact-conflict") {
            return blocked(terminalAction, "The existing terminal artifact conflicts with this idempotent binding.")
          }
          const prepared = prepareState(stateObservation?.content || "{}", Boolean(stateObservation))
          if (!prepared.document || prepared.error) return blocked(prepared.error || "malformed-state", "Engram workflow state is malformed or conflicts with this binding.")
          const project = workspaceProjectName(workspaceRoot)
          if (prepared.action !== "reused") {
            const stateError = saveEngramTopic(workspaceRoot, project, stateKey, JSON.stringify(prepared.document.toJSON()))
            if (stateError) return blocked(stateError, "The Engram state binding could not be persisted.")
          }
          if (expectationsAction === "persisted") {
            const expectationsError = saveEngramTopic(workspaceRoot, project, expectationsKey, JSON.stringify(expectations))
            if (expectationsError) return blocked(expectationsError, "State exists, but approved Expectations could not be persisted.")
          }
          if (terminalStage && terminalAction === "persisted") {
            const artifactType = terminalStage === "DECIDE" ? "decision" : "fix"
            const artifact = terminalStage === "DECIDE"
              ? { status: "passed", intent: (args.intent?.trim() || expectationsIntent)!, expectations_approved: true, resolved_at: new Date().toISOString() }
              : { status: "passed", root_cause: args.root_cause!.trim(), regression: args.regression!.trim(), resolved_at: new Date().toISOString() }
            const artifactError = saveEngramTopic(workspaceRoot, project, `odf/${changeName}/${artifactType}`, JSON.stringify(artifact))
            if (artifactError) return blocked(artifactError, "Canonical state exists, but the terminal artifact could not be persisted.")
          }
          return JSON.stringify({
            status: "bound",
            change_name: changeName,
            work_type: args.work_type,
            artifact_store: "engram",
            topic_key: stateKey,
            project,
            state_action: prepared.action,
            expectations_action: expectationsAction,
            terminal_action: terminalAction,
            route,
            ...(terminalStage ? { terminal_stage: terminalStage } : {}),
          }, null, 2)
        }

        const realWorkspace = await fs.realpath(workspaceRoot)
        const changeDir = path.resolve(realWorkspace, "openspec", "changes", changeName)
        const statePath = path.join(changeDir, "state.yaml")
        const expectationsPath = path.join(changeDir, "expectations.yaml")
        if (!isWithinRoot(statePath, realWorkspace) || !await safeDirectoryPath(realWorkspace, changeDir, false)) {
          return blocked("unsafe-change-path", "The OpenSpec change path contains a symlink or escapes the workspace.")
        }
        const terminalPath = path.join(changeDir, terminalStage === "DECIDE" ? "decision.yaml" : "fix.yaml")
        if (!await safeOptionalPath(realWorkspace, statePath) ||
          !await safeOptionalPath(realWorkspace, expectationsPath) ||
          terminalStage && !await safeOptionalPath(realWorkspace, terminalPath)) {
          return blocked("unsafe-change-path", "An OpenSpec artifact path is unsafe or resolves outside the workspace.")
        }
        const snapshot = await loadOpenSpecStatus(realWorkspace, changeName)
        const existingExpectations = snapshot?.artifacts.find(artifact => normalizeArtifactKey(artifact.key).type === "expectations")
        const existingTerminal = terminalStage
          ? snapshot?.artifacts.find(artifact => normalizeArtifactKey(artifact.key).type === (terminalStage === "DECIDE" ? "decision" : "fix"))
          : null
        let stateContent = "{}\n"
        let stateExists = false
        try {
          const stateStat = await fs.lstat(statePath)
          if (stateStat.isSymbolicLink() || !stateStat.isFile()) return blocked("unsafe-change-path", "OpenSpec state.yaml is not a safe regular file.")
          stateContent = await fs.readFile(statePath, "utf8")
          stateExists = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return blocked("state-unreadable", "Existing OpenSpec state.yaml could not be read.")
          if (!preflight) return blocked("workflow-start-preflight-required", "An ordinary OpenSpec bind can only update existing state; initialization requires complete preflight.")
          if (!claimedCapability) return blocked("workflow-start-unauthorized", "OpenSpec state initialization requires same-session /odf-new health authorization for this change.")
        }
        const expectationsAction = compareExpectations(existingExpectations?.content || null, stateExists)
        if (expectationsAction.startsWith("expectations-")) {
          return blocked(expectationsAction, "Existing Expectations are missing from the retry input, different, invalid, or tampered.")
        }
        const terminalAction = compareTerminalArtifact(existingTerminal?.content || null)
        if (terminalAction === "terminal-artifact-conflict") {
          return blocked(terminalAction, "The existing terminal artifact conflicts with this idempotent binding.")
        }
        const prepared = prepareState(stateContent, stateExists)
        if (!prepared.document || prepared.error) return blocked(prepared.error || "malformed-state", "OpenSpec workflow state is malformed or conflicts with this binding.")
        if (!await safeDirectoryPath(realWorkspace, changeDir, true)) return blocked("unsafe-change-path", "The OpenSpec change path could not be created safely.")
        if (prepared.action !== "reused") {
          if (!await writeAtomicFile(statePath, prepared.document.toString())) {
            return blocked("state-write-failed", "OpenSpec workflow state could not be persisted.")
          }
        }
        if (expectationsAction === "persisted" && !await writeAtomicFile(expectationsPath, stringify(expectations))) {
          return blocked("expectations-write-failed", "Canonical state exists, but approved Expectations could not be persisted.")
        }
        if (terminalStage && terminalAction === "persisted") {
          const artifact = terminalStage === "DECIDE" ? {
            status: "passed",
            intent: (args.intent?.trim() || expectationsIntent)!,
            expectations_approved: true,
            resolved_at: new Date().toISOString(),
          } : {
            status: "passed",
            root_cause: args.root_cause!.trim(),
            regression: args.regression!.trim(),
            resolved_at: new Date().toISOString(),
          }
          const artifactPath = path.join(changeDir, terminalStage === "DECIDE" ? "decision.yaml" : "fix.yaml")
          if (!await writeAtomicFile(artifactPath, JSON.stringify(artifact, null, 2))) {
            return blocked("terminal-artifact-write-failed", "Canonical state exists, but the terminal artifact could not be persisted.")
          }
        }
        return JSON.stringify({
          status: "bound",
          change_name: changeName,
          work_type: args.work_type,
          artifact_store: "openspec",
          state_path: statePath,
          state_action: prepared.action,
          expectations_action: expectationsAction,
          terminal_action: terminalAction,
          preflight_mirrored: prepared.preflightMirrored,
          route,
          ...(terminalStage ? { terminal_stage: terminalStage } : {}),
        }, null, 2)
        })
      } finally {
        if (claimedCapability && sessionID && entryAuthorizations.get(sessionID)?.nonce === claimedCapability.nonce) {
          entryAuthorizations.delete(sessionID)
        }
      }
      return locked.locked
        ? locked.value
        : blocked(locked.error, "The workflow start is already locked or the lock could not be acquired.")
    },
  })
}

function createODFWorkflowRoute(): ReturnType<typeof tool> {
  return tool({
    description: "Resolve the canonical ODF route for a work type. Read-only: does not delegate, mutate state, or run shell commands.",
    args: {
      work_type: tool.schema
        .enum([
          "question",
          "investigation",
          "standard-config",
          "small-change",
          "feature",
          "cross-domain",
          "bugfix",
          "migration",
          "security",
          "verify-only",
        ])
        .describe("Type of work to route"),
    },
    async execute(args: { work_type: WorkType }): Promise<string> {
      const route: WorkflowRoute = resolveWorkflowRoute(args.work_type)
      const description = `${route.entry} entry; stages ${route.stages.join(" -> ")}; plan ${route.plan}; verification ${route.verification}; risk ${route.risk}.`
      return JSON.stringify({ ...route, description }, null, 2)
    },
  })
}

function createODFEntryTriage(): ReturnType<typeof tool> {
  return tool({
    description: `Classify an ODF change entry as micro, standard, or full and select an existing canonical work type.

Pure and read-only: no disk, registry, delegation, or side effects. If needs_question
is true, ask one grouped question for the missing facts and re-run.`,
    args: {
      command: tool.schema
        .string()
        .optional()
        .describe("Origin command (odf-new or odf-fix)"),
      change: tool.schema
        .string()
        .optional()
        .describe("Change name in kebab-case"),
      description: tool.schema
        .string()
        .describe("User description of the change"),
      explicit_work_type: tool.schema
        .enum([...WORK_TYPES])
        .optional()
        .describe("Explicit canonical work type to honor"),
      module: tool.schema
        .string()
        .optional()
        .describe("Primary Odoo module (micro eligibility)"),
      domain: tool.schema
        .string()
        .optional()
        .describe("Functional domain (micro eligibility)"),
      expected_files: tool.schema
        .number()
        .optional()
        .describe("Forecast number of files to change (micro eligibility)"),
      expectations_clear: tool.schema
        .boolean()
        .optional()
        .describe("Whether expectations are clear (micro eligibility)"),
      risk_signals: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Risk signals detected by the caller (security, migration, payment, public-api, data-loss)"),
    },
    async execute(args: Omit<EntryTriageInput, "change"> & { change?: string }): Promise<string> {
      const result = classifyEntryTriage({
        command: args.command,
        change: args.change || "",
        description: args.description || "",
        explicit_work_type: args.explicit_work_type,
        module: args.module,
        domain: args.domain,
        expected_files: args.expected_files,
        expectations_clear: args.expectations_clear,
        risk_signals: args.risk_signals,
      })
      return JSON.stringify(result, null, 2)
    },
  })
}

function createODFWorkflowAdvance(): ReturnType<typeof tool> {
  return tool({
    description: "Advance a canonical ODF workflow without writing state, receipts, artifacts, or files.",
    args: {
      work_type: tool.schema
        .enum([
          "question",
          "investigation",
          "standard-config",
          "small-change",
          "feature",
          "cross-domain",
          "bugfix",
          "migration",
          "security",
          "verify-only",
        ])
        .describe("Type of work to route"),
      completed_stages: tool.schema
        .array(tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"]))
        .describe("Canonical stages already completed"),
      candidate_stage: tool.schema
        .enum(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"])
        .optional()
        .describe("Canonical stage that just completed"),
      phase_result_status: tool.schema
        .enum(["ok", "warning", "blocked", "failed"])
        .describe("Result-contract status for the completed phase"),
      validation_status: tool.schema
        .enum(["verified", "missing", "invalid", "not-required"])
        .describe("Validation seal status"),
      receipt_state: tool.schema
        .enum(["none", "pending", "resolved"])
        .describe("Current receipt state"),
      resumable_state: tool.schema
        .boolean()
        .describe("Whether the workflow can resume"),
      archived_state: tool.schema
        .boolean()
        .describe("Whether the workflow is archived"),
    },
    async execute(args: {
      work_type: WorkType
      completed_stages: CanonicalStage[]
      candidate_stage?: CanonicalStage
      phase_result_status: WorkflowPhaseResultStatus
      validation_status: WorkflowValidationStatus
      receipt_state: WorkflowReceiptState
      resumable_state: boolean
      archived_state: boolean
    }): Promise<string> {
      const route = resolveWorkflowRoute(args.work_type)
      const input: WorkflowAdvanceInput = {
        route,
        completed_stages: args.completed_stages,
        candidate_stage: args.candidate_stage || null,
        phase_result_status: args.phase_result_status,
        validation_status: args.validation_status,
        receipt_state: args.receipt_state,
        resumable_state: args.resumable_state,
        archived_state: args.archived_state,
      }
      return JSON.stringify(advanceWorkflow(input), null, 2)
    },
  })
}

// ==========================================
// STABLE DISCOVERY LOOP GUARD
// ==========================================

const LOOP_GUARD_READ_TOOLS = new Set([
  "read", "glob", "grep", "webfetch", "mgrep",
  "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource",
  "codegraph_codegraph_explore", "fff_find_files", "fff_grep", "fff_multi_grep",
  "engram_mem_context", "engram_mem_search", "engram_mem_get_observation",
  "engram_mem_current_project", "engram_mem_doctor",
  "odf_workflow_route", "odf_workflow_advance", "odf_entry_triage",
  "odf_skill_inject", "odf_skill_resolve", "odf_registry_read", "odf_notebooklm_lookup",
  "odf_profile_select", "odf_community_tool_detect", "odf_status", "odf_workflow_status", "odf_health",
])
const LOOP_GUARD_MAX_SESSIONS = 128
const LOOP_GUARD_MAX_TOOLS = 64
const LOOP_GUARD_MAX_CALLS = 128
const LOOP_GUARD_STOP_REASON = "ODF runtime loop guard stopped this session: the same stable discovery call returned the same result twice for one user intent. Review the existing result or send a new request."
const LOOP_GUARD_WRITE_REASON = "ODF runtime loop guard blocked a duplicate write-capable or unclassified tool call in the same user intent. Send a new explicit request to retry it."
const ODF_ENTRY_HEALTH_REASON = "ODF entry health gate blocked this session: /odf-new requires a successful odf_health call as its first ODF operation, before questions, writes, or delegation."
const ENGRAM_READ_ONLY_TOOLS = new Set([
  "engram_mem_context", "engram_mem_search", "engram_mem_get_observation",
  "engram_mem_current_project", "engram_mem_doctor",
])

type LoopGuardHooks = Pick<Hooks, "dispose" | "event" | "chat.message" | "command.execute.before" | "tool.execute.before" | "tool.execute.after">
type LoopGuardState = {
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

function isReadOnlyEngramTool(toolName: string, args: unknown): boolean {
  if (ENGRAM_READ_ONLY_TOOLS.has(toolName)) return true
  return toolName === "engram_mem_review" && Boolean(args && typeof args === "object" && (args as Record<string, unknown>).action === "list")
}

function isODFEntryGatedTool(toolName: string, args: unknown): boolean {
  return toolName.startsWith("odf_") || (toolName.startsWith("engram_mem_") && !isReadOnlyEngramTool(toolName, args)) ||
    ["question", "task", "bash", "write", "edit", "apply_patch"].includes(toolName)
}

function isSuccessfulODFEntryHealth(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const result = value as Record<string, any>
  return result.schema_version === 1 && (result.status === "ok" || result.status === "warning") &&
    result.registry?.status === "valid" && Array.isArray(result.registry?.skills?.missing) && result.registry.skills.missing.length === 0 &&
    Array.isArray(result.registry?.agents?.missing) && result.registry.agents.missing.length === 0 &&
    result.plugin?.loaded === true && result.plugin?.file_status === "readable" &&
    result.command?.status === "readable" && result.task_api?.function_present === true
}

function canonicalLoopGuardValue(value: unknown): unknown {
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

function loopGuardDigest(value: unknown): string {
  return nodeCrypto.createHash("sha256")
    .update(JSON.stringify(canonicalLoopGuardValue(value)) ?? "null")
    .digest("hex")
}

function expandedCommandDigest(parts: unknown[]): string {
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
      const sessionID = event.type === "session.idle" || event.type === "session.error"
        ? event.properties.sessionID
        : event.type === "session.deleted" ? event.properties.info.id : null
      if (sessionID) {
        clearSession(sessionID, true)
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
      entryAuthorizations.delete(input.sessionID)
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
// SYSTEM PROMPT INJECTION
// ==========================================

const ODF_SYSTEM_RULES = `<odf-system>
## ODF Responsibilities

| Layer | Responsibility |
|---|---|
| Orchestrator | Route phases, manage state and approvals, ask user disposition |
| Plugin | Resolve registry/agents/skills, invoke task, seal policy/evidence/receipt/metrics |
| Agent prompt | Apply the domain role and boundaries supplied by the orchestrator |
| Phase skill | Define phase method, gates, and output artifact |
| Test runner | Run deterministic ODF regression checks |

## Tools

- \`odf_delegate\`: phase delegation with skill injection and metrics
- \`odf_parallel_delegate\`: bounded cross-domain IMPLEMENT BUILD with branch-aware join
- \`odf_workflow_route\`: read-only canonical route selection by work type
- \`odf_workflow_advance\`: read-only canonical transition validation and next-stage calculation
- \`odf_workflow_bind\`: store-aware start/bind; complete preflight initializes canonical state before approved Expectations
- \`odf_entry_triage\`: read-only deterministic micro/standard/full entry classification and work-type selection for \`/odf-new\`
- Proof-backed BUILD/VERIFY delegation requires an explicit \`artifact_store\`; the selected store is the single workflow-state authority.
- Workflow state commits happen after successful inner results and evidence; ARCHIVED remains an explicit archive transition.
- \`odf_skill_inject\`, \`odf_skill_resolve\`, \`odf_registry_read\`: standards and routing inspection
- \`odf_policy_gate\`, \`odf_receipt\`: policy and failure persistence
- \`odf_status\`, \`odf_workflow_status\`, \`odf_profile_select\`, \`odf_notebooklm_lookup\`: state, canonical progress, profile, and research lookup
- \`odf_health\`: read-only installed/runtime health; it does not probe task usability or execute task/Odoo/PostgreSQL/Engram export
- \`odf_community_tool_detect\`, \`odf_community_tool_install\`: optional community tooling

## Non-negotiable invariants

- For exact \`/odf-new\`, call \`odf_health\` as the first ODF operation. Missing, malformed, failed, or blocked health stops before questions, writes, artifact creation, and delegation.
- Start through one \`odf_workflow_bind\`: missing-state creation requires complete preflight plus same-session exact-command health authorization; persist state before Expectations, reuse identical approved content, and block divergence/tampering.
- Use \`odf_delegate\` for ODF phase work; inject at most five matching compact skill blocks.
- Resolve and persist the authoritative Policy Gate before IMPLEMENT/VERIFY; never recompute it.
- IMPLEMENT closes only when the plugin seal has \`validation.status === "verified"\` from fresh bound evidence; prose never counts.
- VERIFY uses evidence-based risk tier, frozen ref, and one correction budget; an inconclusive frozen-byte inspection does not consume the attempt and there is no auto-loop.
- On VERIFY FAIL, persist the receipt before the single user disposition question; \`/odf-continue\` re-discovers pending receipts.
- Metrics remain bounded, session-hashed, and canonical JSONL data for the metrics command. Content signals may escalate risk to HIGH, never downgrade it.
- Cross-domain joins persist to bounded \`.odf/parallel-join-{change}.json\`; continuation uses \`resume_from_join: true\`, reuses completed branches, and retries only incomplete branches with fresh attempt IDs.
- The outer plugin envelope and inner agent \`## ODF Result\` are separate; preserve the agent result and inspect both layers.
</odf-system>`

export function createODFRuntimeHooks(
  client: OpencodeClient,
  entryAuthorizations: ODFEntryAuthorizations = new Map(),
  entryGenerations: ODFEntryGenerations = new Map(),
  workspaceDir = process.cwd(),
): LoopGuardHooks & Pick<Hooks, "experimental.chat.system.transform"> {
  return {
    ...createStableDiscoveryGuard(client, entryAuthorizations, entryGenerations, workspaceDir),
    "experimental.chat.system.transform": async (_input, output) => {
      const combined = [...output.system, ODF_SYSTEM_RULES].join("\n\n---\n\n")
      output.system = [combined]
    },
  }
}

// ==========================================
// PLUGIN EXPORT
// ==========================================

export const OdfDelegationPlugin: Plugin = async (ctx) => {
  const { directory, client } = ctx
  const entryAuthorizations: ODFEntryAuthorizations = new Map()
  const entryGenerations: ODFEntryGenerations = new Map()
  const runtimeHooks = createODFRuntimeHooks(client, entryAuthorizations, entryGenerations, directory)

  // Ensure registry exists (log warning if not)
  try {
    await fs.access(REGISTRY_PATH)
  } catch {
    console.warn(`[odf-delegation] Registry not found at ${REGISTRY_PATH}. Run /odf-init or create it manually.`)
  }

  // Start metrics flusher (F1)
  startMetricsFlusher()

  // Auto-refresh check (P0.2): compare skills dir vs cache
  const needsRefresh = await hasSkillsChanged()
  if (needsRefresh) {
    debugLog(`[odf-delegation] Skills changed since last refresh. Invalidating registry cache.`)
    registryCache = null
    registryCacheTime = 0
  }

  // Update permissions cache (P0.3)
  const registry = await loadRegistry()
  if (registry) {
    const fp = await computePermissionsFingerprint(registry)
    const cache = await loadRegistryCache()
    if (!cache || cache.permissions_fingerprint !== fp) {
      // Skills changed — save new fingerprint for faster next startup
  const skillsDir = path.join(getOdfConfigDir(), "skills")
      const newCache: RegistryCache = {
        timestamp: new Date().toISOString(),
        last_refresh: new Date().toISOString(),
        permissions_fingerprint: fp,
        skills: [],
      }
      try {
        const entries = await fs.readdir(skillsDir, { recursive: true })
        const skillFiles = entries.filter(e => e.endsWith("SKILL.md"))
        for (const file of skillFiles) {
          const fullPath = path.join(skillsDir, file)
          const stat = await fs.stat(fullPath)
          newCache.skills.push({ path: fullPath, mtime: stat.mtime.toISOString(), size: stat.size })
        }
      } catch {
        // skills dir may not exist
      }
      await saveRegistryCache(newCache)
    }

    // Auto-discover unregistered odoo_* skills
    const unregistered = await discoverUnregisteredSkills(registry)
    if (unregistered.length > 0) {
      console.warn(`[odf-delegation] Unregistered skills found: ${unregistered.join(", ")}. Run /odf-registry-refresh to register them.`)
    }

    // Learning loop (F4): log insights on startup
    const insights = await learnFromMetrics()
    if (insights.length > 0) {
      const top = insights.slice(0, 3)
      debugLog(`[odf-delegation] Learning: top skills by success rate — ${top.map(i => `${i.skill}(${i.success_rate}%)`).join(", ")}`)
    }

    // Quick health check
    const healthChecks: string[] = []
    healthChecks.push(`skills=${registry.skills.length}`)
    healthChecks.push(`agents=${registry.agents?.length || 0}`)
    healthChecks.push(`profiles=${registry.profiles?.length || 0}`)
    debugLog(`[odf-delegation] Health: ${healthChecks.join(", ")}`)
  }

  debugLog(`[odf-delegation] Plugin loaded. Tools: ${ODF_REGISTERED_TOOLS.join(", ")}`)

  return {
    ...runtimeHooks,
    tool: {
      odf_delegate: createODFDelegate(client, directory),
      odf_parallel_delegate: createODFParallelDelegate(client, directory),
      odf_workflow_route: createODFWorkflowRoute(),
      odf_workflow_advance: createODFWorkflowAdvance(),
      odf_workflow_bind: createODFWorkflowBind(entryAuthorizations, entryGenerations),
      odf_entry_triage: createODFEntryTriage(),
      odf_skill_inject: createODFSkillInject(),
      odf_skill_resolve: createODFSkillResolve(),
      odf_registry_read: createODFRegistryRead(),
      odf_notebooklm_lookup: createODFNotebookLMLookup(),
      odf_profile_select: createODFProfileSelect(),
      odf_community_tool_detect: createODFCommunityToolDetect(),
      odf_community_tool_install: createODFCommunityToolInstall(),
      odf_status: createODFStatus(),
      odf_workflow_status: createODFWorkflowStatus(),
      odf_policy_gate: createODFPolicyGate(),
      odf_receipt: createODFReceipt(),
      odf_health: createODFHealth(client),
    },
  }
}

export default {
  id: "odf-delegation",
  server: OdfDelegationPlugin,
}

// Exported for unit testing
export {
  resolvePath,
  resolveWorkspaceRoot,
  matchSkills,
  resolveAgent,
  formatCompactRules,
  invokeTask,
  findTaskApi,
  createODFDelegate,
  createODFParallelDelegate,
  createODFWorkflowRoute,
  createODFWorkflowAdvance,
  createODFWorkflowBind,
  createODFEntryTriage,
  createODFWorkflowStatus,
  createODFHealth,
  getProfileByPhase,
  flushMetricsSync,
  getMetricsBufferCap,
  recordMetrics,
  ALLOWED_PHASES,
  createODFPolicyGate,
  ODF_REGISTERED_TOOLS,
  type ODFRegistry,
  type ODFSkill,
  type ODFAgent,
  type ODFCommunityTool,
  type WorkType,
  type WorkflowRoute,
}

export function getMetricsBuffer(): DelegationMetrics[] {
  return metricsBuffer
}

export function clearMetricsBuffer(): void {
  metricsBuffer.length = 0
}
