/**
 * odf-delegation
 * Odoo Development Framework delegation plugin for OpenCode
 *
 * Extends OpenCode with ODF-specific delegation tools:
 * - odf_delegate: Delegate to phase-specific agents with skill injection
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
import { type Plugin, type ToolContext, tool } from "@opencode-ai/plugin"
import { execFileSync, execSync } from "node:child_process"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { resolveWorkflowRoute, type WorkType, type WorkflowRoute } from "./odf-workflow.js"
import {
  deriveWorkflowStatus,
  normalizeArtifactKey,
  parseWorkflowState,
  type WorkflowReceipt,
  type WorkflowStage,
  type WorkflowStatus,
} from "./odf-workflow-status.js"

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
    }).trim()
    if (root) return path.normalize(root)
  } catch {
    // Fall back for non-Git workspaces.
  }
  return path.normalize(path.resolve(cwd))
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
        console.log(`[odf-delegation] Registry changed on disk. Cache invalidated.`)
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

interface DelegationMetrics {
  timestamp: string
  session_hash: string
  phase: string
  agent: string
  skills_injected: string[]
  skill_resolution: "injected" | "self-discovered" | "none"
  duration_ms: number
  token_estimate: number
  status: "ok" | "blocked" | "error" | "timeout"
  task_api_source: "ctx.task" | "toolCtx.task" | "sdk" | "unavailable"
  error?: string
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
  const safe = error.replace(/\r?\n/g, " ").replace(/"/g, "'").trim()
  return safe.length > 200 ? safe.slice(0, 200) + "..." : safe
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
  const { session_id, ...rest } = metric
  const sanitized: DelegationMetrics = {
    ...rest,
    session_hash: hashSession(session_id),
    error: sanitizeError(metric.error),
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
  context: { files?: string[]; task?: string; odooVersion?: number | null }
): ODFSkill[] {
  const matches: ODFSkill[] = []
  const taskLower = context.task?.toLowerCase() || ""

  for (const skill of registry.skills) {
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

    if (score > 0) {
      matches.push({ ...skill, _score: score } as ODFSkill & { _score: number })
    }
  }

  // Sort by score (desc) then by compact_rules length (more specific first)
  matches.sort((a: any, b: any) => {
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

type TaskApi = (input: {
  agent: string
  prompt: string
  context_files?: string[]
}) => Promise<unknown>

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

function findTaskApi(toolCtx: ToolContext, client?: OpencodeClient): { taskApi: TaskApi; source: DelegationMetrics["task_api_source"] } | null {
  if (typeof (toolCtx as any).task === "function") {
    return { taskApi: (toolCtx as any).task as TaskApi, source: "toolCtx.task" }
  }
  if (client && typeof (client as any).task === "function") {
    return { taskApi: (client as any).task as TaskApi, source: "ctx.task" }
  }
  return null
}

async function invokeTask(
  taskApi: TaskApi,
  agentName: string,
  prompt: string,
  contextFiles?: string[],
  timeoutMs = 120_000
): Promise<{ status: string; result: unknown }> {
  const result = await Promise.race([
    taskApi({ agent: agentName, prompt, context_files: contextFiles }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`task() timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
  if (isCancellation(result)) throw new Error("task-cancelled: task() was cancelled")
  if (isEmptyTaskResult(result)) throw new Error("empty-task-result: task() returned no usable result")
  return { status: "delegated", result }
}

const ALLOWED_PHASES = ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY", "EXPLORE", "FIX"]

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

function gitHead(workspaceDir: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: workspaceDir, encoding: "utf8" }).trim() || null
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
      changed_lines: null,
      correction_budget_lines: null,
      changed_paths: [],
      resolved_at: new Date().toISOString(),
    }
  }

  const gatePath = path.join(workspace, ".odf", `policy-gate-${opts.change}.json`)
  const head = gitHead(workspace)

  // Idempotency: reuse a frozen decision for the same change + phase + ref.
  try {
    const existing = JSON.parse(fsSync.readFileSync(gatePath, "utf8")) as PolicyGateDecision
    if (
      existing.phase === opts.phase &&
      existing.frozen_diff_ref != null &&
      head !== null &&
      existing.frozen_diff_ref === head
    ) {
      return existing
    }
  } catch {
    // No prior gate, stale, or unreadable → recompute.
  }

  let frozenDiffRef: string | null = null
  let changedLines: number | null = null
  let changedPaths: string[] = []
  let riskTier: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM"
  let correctionBudget: number | null = null

  if (opts.phase === "VERIFY") {
    frozenDiffRef = head
    if (frozenDiffRef) {
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
      try {
        changedPaths = execSync("git diff --name-only HEAD", { cwd: workspace, encoding: "utf8" })
          .trim()
          .split("\n")
          .filter(Boolean)
      } catch {
        changedPaths = []
      }
      riskTier = classifyRiskTierWithContent(changedPaths, workspace)
      correctionBudget = changedLines != null ? Math.min(200, Math.ceil(changedLines / 2)) : null
    } else {
      // git unavailable → fail-open for VERIFY (the odf-verify skill demands bytes).
      riskTier = "LOW"
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
  resolved_at: string
  commands: ValidationEvidenceCommand[]
}

export interface ValidationVerdict {
  status: "verified" | "missing" | "invalid"
  reason: string
  commands_validated: number
}

const EVIDENCE_FRESHNESS_MS = 60 * 60 * 1000 // 60 min window

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
  now?: Date
}): ValidationVerdict {
  const now = opts.now || new Date()
  const filePath = path.join(opts.workspaceDir, ".odf", `validation-evidence-${opts.change}.json`)

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

  const commands = Array.isArray(evidence.commands) ? evidence.commands : []
  if (commands.length < EVIDENCE_MIN_COMMANDS[opts.tier]) {
    return { status: "invalid", reason: `tier ${opts.tier} requires at least ${EVIDENCE_MIN_COMMANDS[opts.tier]} command(s), got ${commands.length}`, commands_validated: commands.length }
  }

  let checked = 0
  for (const cmd of commands) {
    if (!cmd || typeof cmd.name !== "string" || typeof cmd.exit_code !== "number") {
      return { status: "invalid", reason: "evidence command missing name or exit_code", commands_validated: checked }
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

  return { status: "verified", reason: `stop-validation evidence verified (${checked} command(s))`, commands_validated: checked }
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
  resolved_at: string
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
    console.log(`[odf-delegation] odf_receipt: change=${merged.change} phase=${merged.phase} status=${merged.status} cause=${merged.cause} action=${mergedAction}`)
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
      console.log(`[odf-delegation] odf_policy_gate: change=${decision.change} phase=${decision.phase} gate=${decision.gate} tdd=${decision.tdd.effective} tier=${decision.risk_tier}`)
      return JSON.stringify(decision, null, 2)
    },
  })
}

// ==========================================
// TOOL CREATORS
// ==========================================

function createODFDelegate(client?: OpencodeClient, canonicalDirectory?: string): ReturnType<typeof tool> {
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
    },
    async execute(args: { phase: string; prompt: string; context_files?: string[]; profile?: string; change?: string; timeout_ms?: number }, toolCtx: ToolContext): Promise<string> {
      if (!toolCtx?.sessionID) {
        return "❌ odf_delegate requires sessionID"
      }

      if (!ALLOWED_PHASES.includes(args.phase)) {
        return `❌ Invalid phase "${args.phase}". Allowed: ${ALLOWED_PHASES.join(", ")}`
      }

      const startTime = Date.now()
      const workspaceRoot = resolveWorkspaceRoot(canonicalDirectory || process.cwd())
      const gatedPhase = args.phase === "IMPLEMENT" || args.phase === "VERIFY"
      const changeName = args.change?.trim() || extractChangeName(args.prompt)
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

      // Validate context_files against the repository root, not a nested cwd.
      for (const file of args.context_files || []) {
        if (typeof file !== "string" || file.split(/[\\/]/).includes("..")) {
          return `❌ context_files entry "${file}" contains path traversal`
        }
        const resolvedFile = path.resolve(workspaceRoot, file)
        if (!isWithinRoot(resolvedFile, workspaceRoot)) {
          return `❌ context_files entry "${file}" escapes workspace root`
        }
        if (fsSync.existsSync(resolvedFile)) {
          try {
            if (!fsSync.statSync(resolvedFile).isFile()) {
              return `❌ context_files entry "${file}" is not a file`
            }
            if (!isWithinRoot(fsSync.realpathSync(resolvedFile), workspaceRoot)) {
              return `❌ context_files entry "${file}" escapes workspace root`
            }
          } catch {
            return `❌ context_files entry "${file}" cannot be read`
          }
        }
      }

      const registry = await loadRegistry()
      if (!registry) {
        return `❌ ODF registry not found. Run /odf-init or check ${REGISTRY_PATH}`
      }

      // Policy Gate (chokepoint): resolve + persist before any IMPLEMENT/VERIFY
      // delegation. The gate documents the decision; the sub-agent applies it
      // (never recomputes). Safety net — the orchestrator calls odf_policy_gate
      // explicitly; this re-runs the same decision and injects it.
      let policyGate: PolicyGateDecision | null = null
      if (gatedPhase) {
        policyGate = computePolicyGate({
          change: changeName!,
          phase: args.phase as "IMPLEMENT" | "VERIFY",
          workspaceDir: workspaceRoot,
          registry,
        })
      }

      // Detect Odoo version from project
      const odooVersion = await detectOdooVersion(workspaceRoot)
      if (odooVersion) {
        console.log(`[odf-delegation] Detected Odoo version: ${odooVersion}`)
      }

      // Match skills (with version filter)
      const skills = matchSkills(registry, {
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
      console.log(`[odf-delegation] odf_delegate: phase=${args.phase} agent=${agentName} skills=${skills.length} version=${odooVersion || "auto"} profile=${profile?.name || "default"}`)

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

      const taskApiInfo = findTaskApi(toolCtx, client)
      const profilePayload = profile
        ? { name: profile.name, model: profile.model, temperature: profile.temperature, reasoning: profile.reasoning }
        : null

      if (taskApiInfo) {
        try {
          const timeoutMs = args.timeout_ms ?? 120_000
          const taskResult = await invokeTask(taskApiInfo.taskApi, agentName, delegationPrompt, args.context_files, timeoutMs)
          recordMetrics({
            timestamp: new Date().toISOString(),
            session_id: toolCtx.sessionID,
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
            skill_resolution: skills.length > 0 ? "injected" : "none",
            duration_ms: Date.now() - startTime,
            token_estimate: estimateTokens(delegationPrompt),
            status: "ok",
            task_api_source: taskApiInfo.source,
          })
          // Stop-validation seal (slice 2): after an IMPLEMENT delegation, stamp
          // the envelope with the deterministic evidence verdict. The sub-agent
          // executes the commands and writes validation-evidence-{change}.json;
          // this plugin only validates the artifact — prose never counts.
          let validation: ValidationVerdict | null = null
          if (args.phase === "IMPLEMENT" && policyGate) {
            validation = validateValidationEvidence({
              workspaceDir: workspaceRoot,
              change: policyGate.change,
              tier: policyGate.risk_tier,
              frozenDiffRef: policyGate.frozen_diff_ref,
            })
          }
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
          }, null, 2)
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          const isTimeout = errorMessage.includes("timed out")
          const isCancelled = isCancellationMessage(errorMessage)
          const reason = isCancelled
            ? "task-cancelled"
            : errorMessage.startsWith("empty-task-result")
              ? "empty-task-result"
              : undefined
          recordMetrics({
            timestamp: new Date().toISOString(),
            session_id: toolCtx.sessionID,
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
            skill_resolution: skills.length > 0 ? "injected" : "none",
            duration_ms: Date.now() - startTime,
            token_estimate: estimateTokens(delegationPrompt),
            status: isTimeout ? "timeout" : isCancelled ? "blocked" : "error",
            task_api_source: taskApiInfo.source,
            error: errorMessage,
          })
          // Receipt auto-seal (slice 4): persist a failure disposition so the
          // learning loop does not depend on orchestrator memory. Best-effort.
          if (policyGate) {
            const receipt: ODFReceipt = {
              change: policyGate.change,
              phase: args.phase as ODFReceipt["phase"],
              status: isCancelled ? "blocked" : "failed",
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
            status: isTimeout ? "timeout" : isCancelled ? "blocked" : "error",
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

      const message = "Native task() API is unavailable. Restart OpenCode after loading the plugin, then retry the delegation."
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

      const skills = matchSkills(registry, {
        files: args.context_files,
        task: args.task_description,
      })
      console.log(`[odf-delegation] odf_skill_inject: matched ${skills.length} skills`)

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
      console.log(`[odf-delegation] odf_profile_select: phase=${args.phase} model=${profile.model} temp=${profile.temperature}`)

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
      const skills = matchSkills(registry, {
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
  "tasks", "apply-progress", "implement-progress", "archive-report",
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

async function readEngramObservations(workspaceRoot: string): Promise<EngramObservation[] | null> {
  let project: string
  try {
    project = path.basename(
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: workspaceRoot, encoding: "utf8" }).trim()
    )
  } catch {
    project = path.basename(workspaceRoot)
  }

  // ponytail: unique tmpdir (not a Date.now() filename) so parallel workers never race the same path
  const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "odf-status-"))
  const tmpFile = path.join(tmpDir, "export.json")
  try {
    execFileSync("engram", ["export", "--project", project, "--output", tmpFile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    })
  } catch {
    try { fsSync.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
    return null
  }

  try {
    const raw = fsSync.readFileSync(tmpFile, "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  } finally {
    try { fsSync.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
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

function readReceiptJson(workspaceRoot: string, changeName: string): WorkflowReceipt | null {
  try {
    return JSON.parse(
      fsSync.readFileSync(path.join(workspaceRoot, ".odf", `receipt-${changeName}.json`), "utf8")
    ) as WorkflowReceipt
  } catch {
    return null
  }
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
  status.workflowStatus = deriveWorkflowStatus({
    change: bestChange,
    artifacts: workflowArtifacts,
    receipt: readReceiptJson(workspaceRoot, bestChange),
    source: { state: "engram", artifacts: workflowArtifacts.map((artifact) => artifact.key) },
    warnings,
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
  const workflowStatus = deriveWorkflowStatus({
    change: openSpec.change,
    state: openSpec.state?.content || null,
    artifacts: mergedArtifacts,
    receipt: readReceiptJson(workspaceRoot, openSpec.change),
    source: { state: "openspec", artifacts: Array.from(new Set(sourceRefs)) },
    warnings: Array.from(new Set(warnings)),
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

async function loadCombinedWorkflowStatus(workspaceRoot: string, changeName?: string): Promise<ODFChangeStatus | null> {
  const requestedChange = changeName?.trim() || undefined
  const observations = await readEngramObservations(workspaceRoot)
  const engram = observations
    ? selectEngramSnapshot(observations, requestedChange)
    : null
  const targetChange = requestedChange || engram?.change
  const openSpec = targetChange ? await loadOpenSpecStatus(workspaceRoot, targetChange) : null
  if (!openSpec?.state) {
    return engram ? buildEngramStatus(workspaceRoot, engram, openSpec?.warnings || []) : null
  }
  return buildMergedStatus(workspaceRoot, openSpec, engram)
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
- \`odf_workflow_route\`: read-only canonical route selection by work type
- \`odf_skill_inject\`, \`odf_skill_resolve\`, \`odf_registry_read\`: standards and routing inspection
- \`odf_policy_gate\`, \`odf_receipt\`: policy and failure persistence
- \`odf_status\`, \`odf_workflow_status\`, \`odf_profile_select\`, \`odf_notebooklm_lookup\`: state, canonical progress, profile, and research lookup
- \`odf_community_tool_detect\`, \`odf_community_tool_install\`: optional community tooling

## Non-negotiable invariants

- Use \`odf_delegate\` for ODF phase work; inject at most five matching compact skill blocks.
- Resolve and persist the authoritative Policy Gate before IMPLEMENT/VERIFY; never recompute it.
- IMPLEMENT closes only when the plugin seal has \`validation.status === "verified"\` from fresh bound evidence; prose never counts.
- VERIFY uses evidence-based risk tier, frozen ref, and one correction budget; an inconclusive frozen-byte inspection does not consume the attempt and there is no auto-loop.
- On VERIFY FAIL, persist the receipt before the single user disposition question; \`/odf-continue\` re-discovers pending receipts.
- Metrics remain bounded, session-hashed, and canonical JSONL data for the metrics command. Content signals may escalate risk to HIGH, never downgrade it.
- The outer plugin envelope and inner agent \`## ODF Result\` are separate; preserve the agent result and inspect both layers.
</odf-system>`

// ==========================================
// PLUGIN EXPORT
// ==========================================

export const OdfDelegationPlugin: Plugin = async (ctx) => {
  const { directory, client } = ctx

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
    console.log(`[odf-delegation] Skills changed since last refresh. Invalidating registry cache.`)
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
      console.log(`[odf-delegation] Learning: top skills by success rate — ${top.map(i => `${i.skill}(${i.success_rate}%)`).join(", ")}`)
    }

    // Quick health check
    const healthChecks: string[] = []
    healthChecks.push(`skills=${registry.skills.length}`)
    healthChecks.push(`agents=${registry.agents?.length || 0}`)
    healthChecks.push(`profiles=${registry.profiles?.length || 0}`)
    console.log(`[odf-delegation] Health: ${healthChecks.join(", ")}`)
  }

  console.log(`[odf-delegation] Plugin loaded. Tools: odf_delegate, odf_workflow_route, odf_skill_inject, odf_registry_read, odf_notebooklm_lookup, odf_profile_select, odf_skill_resolve, odf_community_tool_detect, odf_community_tool_install, odf_status, odf_workflow_status, odf_policy_gate, odf_receipt`)

  return {
    tool: {
      odf_delegate: createODFDelegate(client, directory),
      odf_workflow_route: createODFWorkflowRoute(),
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
    },

    // Inject ODF system rules into system prompt
    "experimental.chat.system.transform": async (_input, output) => {
      const combined = [...output.system, ODF_SYSTEM_RULES].join("\n\n---\n\n")
      output.system = [combined]
    },
  }
}

export default OdfDelegationPlugin

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
  createODFWorkflowRoute,
  createODFWorkflowStatus,
  getProfileByPhase,
  recordMetrics,
  ALLOWED_PHASES,
  createODFPolicyGate,
  type ODFRegistry,
  type ODFSkill,
  type ODFAgent,
  type ODFCommunityTool,
  type DelegationMetrics,
  type WorkType,
  type WorkflowRoute,
}

export function getMetricsBuffer(): DelegationMetrics[] {
  return metricsBuffer
}

export function clearMetricsBuffer(): void {
  metricsBuffer.length = 0
}
