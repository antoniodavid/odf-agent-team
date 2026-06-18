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
import { type Plugin, type ToolContext, tool } from "@opencode-ai/plugin"
import type { createOpencodeClient } from "@opencode-ai/sdk"

export type OpencodeClient = ReturnType<typeof createOpencodeClient>

// ==========================================
// ODF REGISTRY
// ==========================================

const REGISTRY_PATH = path.join(os.homedir(), ".config", "opencode", "odf-registry.json")

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

interface ODFRegistry {
  version: number
  last_updated: string
  skills: ODFSkill[]
  agents: ODFAgent[]
  profiles?: ODFProfile[]
  notebooklm_sources?: Record<string, string>
  package?: ODFPackage
  commands?: ODFCommand[]
  flags?: Record<string, boolean | string | number>
}

function resolvePath(registryDir: string, entryPath: string): string {
  if (!entryPath) return ""
  if (path.isAbsolute(entryPath)) return entryPath
  if (entryPath.startsWith("~/")) {
    return path.join(os.homedir(), entryPath.slice(2))
  }
  return path.resolve(registryDir, entryPath)
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
  } catch {
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
  const skillsDir = path.join(os.homedir(), ".config", "opencode", "skills")
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

const CACHE_FILE = path.join(os.homedir(), ".config", "opencode", ".registry-cache.json")

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
  // Build a deterministic fingerprint from all skills
  const parts = registry.skills.map(s => `${s.name}:${(s as any).version || "1.0"}`).sort()
  const hash = await crypto.subtle?.digest?.("SHA-256", new TextEncoder().encode(parts.join("|")))
  if (hash) {
    return Array.from(new Uint8Array(hash)).slice(0, 8).map(b => b.toString(16)).join("")
  }
  return parts.length.toString()
}

async function hasSkillsChanged(): Promise<boolean> {
  const cache = await loadRegistryCache()
  if (!cache) return true

  const skillsDir = path.join(os.homedir(), ".config", "opencode", "skills")
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
  session_id: string
  phase: string
  agent: string
  skills_injected: string[]
  skill_resolution: "injected" | "self-discovered" | "none"
  duration_ms: number
  token_estimate: number
  status: "ok" | "fallback" | "error" | "timeout"
  task_api_source: "ctx.task" | "toolCtx.task" | "sdk" | "unavailable"
  error?: string
}

let metricsBuffer: DelegationMetrics[] = []
const METRICS_FLUSH_INTERVAL = 30_000 // flush every 30s
let metricsTimer: ReturnType<typeof setInterval> | null = null

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function startMetricsFlusher(): void {
  if (metricsTimer) return
  metricsTimer = setInterval(async () => {
    if (metricsBuffer.length === 0) return
    const batch = metricsBuffer.splice(0)
    try {
      // Save metrics to a local JSON log file
      const metricsDir = path.join(os.homedir(), ".config", "opencode", "metrics")
      await fs.mkdir(metricsDir, { recursive: true })
      const today = new Date().toISOString().split("T")[0]
      const logFile = path.join(metricsDir, `delegations-${today}.jsonl`)
      const lines = batch.map(m => JSON.stringify(m)).join("\n") + "\n"
      await fs.appendFile(logFile, lines, "utf8")
    } catch {
      // Metrics logging is best-effort
    }
  }, METRICS_FLUSH_INTERVAL)
}

function recordMetrics(metric: DelegationMetrics): void {
  metricsBuffer.push(metric)
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
  const metricsDir = path.join(os.homedir(), ".config", "opencode", "metrics")
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

async function getProfileByPhase(registry: ODFRegistry, phase: string): Promise<{ model: string; temperature: number; reasoning?: boolean } | null> {
  if (!registry.profiles) return null

  // Find active profile first
  const profiles = registry.profiles as any[]
  const activeProfile = profiles.find(p => p.active === true) || profiles.find(p => p.name === "default") || profiles[0]

  if (activeProfile && activeProfile.phases && activeProfile.phases[phase.toUpperCase()]) {
    return activeProfile.phases[phase.toUpperCase()]
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

function resolveAgent(registry: ODFRegistry, phase: string, taskKeywords: string[]): string {
  // Filter out stop words before matching
  const filteredKeywords = filterStopWords(taskKeywords)
  if (filteredKeywords.length === 0) {
    // No meaningful keywords — use defaults
    const defaults: Record<string, string> = {
      ASSESS: "odoo_functional_consultant",
      "QA-PLAN": "odoo_qa_engineer",
      DESIGN: "odoo_backend_engineer",
      IMPLEMENT: "odoo_backend_engineer",
      VERIFY: "odoo_qa_engineer",
    }
    return defaults[phase] || "odoo_backend_engineer"
  }

  // Check for custom agents matching phase and keywords
  const taskLower = filteredKeywords.join(" ").toLowerCase()

  for (const agent of registry.agents) {
    if (!agent.installed) continue
    if (!agent.phases.includes(phase) && !agent.phases.includes("ANY")) continue

    // Check if agent description matches filtered task keywords
    const descLower = agent.description.toLowerCase()
    if (filteredKeywords.some(kw => descLower.includes(kw.toLowerCase()))) {
      return agent.name
    }
  }

  // Fallback to default agents
  const defaults: Record<string, string> = {
    ASSESS: "odoo_functional_consultant",
    "QA-PLAN": "odoo_qa_engineer",
    DESIGN: "odoo_backend_engineer",
    IMPLEMENT: "odoo_backend_engineer",
    VERIFY: "odoo_qa_engineer",
  }

  return defaults[phase] || "odoo_backend_engineer"
}

// ==========================================
// TASK INVOCATION AND FALLBACK
// ==========================================

type TaskApi = (input: {
  agent: string
  prompt: string
  context_files?: string[]
}) => Promise<unknown>

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
  contextFiles?: string[]
): Promise<{ status: string; result: unknown }> {
  const result = await taskApi({ agent: agentName, prompt, context_files: contextFiles })
  return { status: "delegated", result }
}

function buildFallbackOutput(
  phase: string,
  agentName: string,
  skills: ODFSkill[],
  enrichedPrompt: string
): string {
  return `ODF Delegation (fallback — task() unavailable):

Phase: ${phase}
Agent: ${agentName}
Skills injected: ${skills.length > 0 ? skills.map(s => s.name).join(", ") : "none"}
Status: fallback

Use task() with agent="${agentName}" and the enriched prompt below:

---ENCRYPTED_PROMPT_START---
${enrichedPrompt}
---ENCRYPTED_PROMPT_END---`
}

const ALLOWED_PHASES = ["ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY"]

// ==========================================
// TOOL CREATORS
// ==========================================

function createODFDelegate(client?: OpencodeClient): ReturnType<typeof tool> {
  return tool({
    description: `Delegate an ODF task to the appropriate phase-specific agent.

This tool:
1. Reads the ODF registry to find the best agent for the phase
2. Injects relevant skill compact rules into the prompt
3. Delegates via the native task tool when available, or falls back to an instruction envelope

Use this instead of generic task() for ODF workflow delegation.`,
    args: {
      phase: tool.schema
        .string()
        .describe("ODF phase: ASSESS, QA-PLAN, DESIGN, IMPLEMENT, VERIFY"),
      prompt: tool.schema
        .string()
        .describe("The full detailed prompt for the agent."),
      context_files: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Files the agent will work with (for skill matching)"),
    },
    async execute(args: { phase: string; prompt: string; context_files?: string[] }, toolCtx: ToolContext): Promise<string> {
      if (!toolCtx?.sessionID) {
        return "❌ odf_delegate requires sessionID"
      }

      if (!ALLOWED_PHASES.includes(args.phase)) {
        return `❌ Invalid phase "${args.phase}". Allowed: ${ALLOWED_PHASES.join(", ")}`
      }

      const startTime = Date.now()
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found. Run /odf-init or check ~/.config/opencode/odf-registry.json"
      }

      // Detect Odoo version from project
      const odooVersion = await detectOdooVersion(process.cwd())
      if (odooVersion) {
        console.log(`[odf-delegation] Detected Odoo version: ${odooVersion}`)
      }

      // Match skills (with version filter)
      const skills = matchSkills(registry, {
        files: args.context_files,
        task: args.prompt,
        odooVersion: odooVersion,
      })

      // Resolve agent
      const keywords = args.prompt.split(/\s+/).slice(0, 10)
      const agentName = resolveAgent(registry, args.phase, keywords)
      console.log(`[odf-delegation] odf_delegate: phase=${args.phase} agent=${agentName} skills=${skills.length} version=${odooVersion || "auto"}`)

      // Inject compact rules
      const rules = formatCompactRules(skills)
      const enrichedPrompt = rules
        ? `${rules}\n\n---\n\n${args.prompt}\n\n## Skill Resolution Status\nReport: injected (received from odf-delegation plugin)`
        : `${args.prompt}\n\n## Skill Resolution Status\nReport: none (no matching skills in registry)`

      const duration = Date.now() - startTime
      const taskApiInfo = findTaskApi(toolCtx, client)

      if (taskApiInfo) {
        try {
          const taskResult = await invokeTask(taskApiInfo.taskApi, agentName, enrichedPrompt, args.context_files)
          recordMetrics({
            timestamp: new Date().toISOString(),
            session_id: toolCtx.sessionID,
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
            skill_resolution: skills.length > 0 ? "injected" : "none",
            duration_ms: Date.now() - startTime,
            token_estimate: estimateTokens(enrichedPrompt),
            status: "ok",
            task_api_source: taskApiInfo.source,
          })
          return JSON.stringify({
            status: "delegated",
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
            task_api_source: taskApiInfo.source,
            result: taskResult.result,
          }, null, 2)
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          recordMetrics({
            timestamp: new Date().toISOString(),
            session_id: toolCtx.sessionID,
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
            skill_resolution: skills.length > 0 ? "injected" : "none",
            duration_ms: Date.now() - startTime,
            token_estimate: estimateTokens(enrichedPrompt),
            status: "error",
            task_api_source: taskApiInfo.source,
            error: errorMessage,
          })
          return JSON.stringify({
            status: "error",
            phase: args.phase,
            agent: agentName,
            task_api_source: taskApiInfo.source,
            message: errorMessage,
          }, null, 2)
        }
      }

      // Fallback: task() not available
      recordMetrics({
        timestamp: new Date().toISOString(),
        session_id: toolCtx.sessionID,
        phase: args.phase,
        agent: agentName,
        skills_injected: skills.map(s => s.name),
        skill_resolution: skills.length > 0 ? "injected" : "none",
        duration_ms: duration,
        token_estimate: estimateTokens(enrichedPrompt),
        status: "fallback",
        task_api_source: "unavailable",
      })

      return buildFallbackOutput(args.phase, agentName, skills, enrichedPrompt)
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
        .describe("ODF phase: ASSESS, QA-PLAN, DESIGN, IMPLEMENT, VERIFY"),
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
        .describe("ODF phase: ASSESS, QA-PLAN, DESIGN, IMPLEMENT, VERIFY"),
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
        `**Selected:** ${agentName}`,
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
// SYSTEM PROMPT INJECTION
// ==========================================

const ODF_SYSTEM_RULES = `<odf-system>
## ODF Delegation System

You have ODF-specific tools for structured Odoo development:

- \`odf_delegate(phase, prompt, context_files)\` — Delegate to phase-specific agent with auto skill injection + metrics
- \`odf_skill_inject(context_files, task_description)\` — Get compact rules for manual injection
- \`odf_skill_resolve(phase, task, context_files)\` — Preview what skills/agent/profile would match (debugging)
- \`odf_registry_read(query, type)\` — Query the ODF skill/agent registry (31 skills, 12 agents)
- \`odf_notebooklm_lookup(domain)\` — Resolve domain to NotebookLM notebook ID
- \`odf_profile_select(phase)\` — Get optimal model/temperature for a phase from the active profile

### Available Commands

| Command | Purpose |
|---------|---------|
| \`/odf-registry-refresh\` | Rescan skills/, update registry, persist to Engram |
| \`/odf-profile list\|switch\|create\|delete\` | Manage model profiles per phase |
| \`/odf-backup create\|list\|restore\` | Snapshot & restore ODF config |
| \`/odf-skill-log <name>\|--all\` | View skill version history |
| \`/odf-metrics [--days N]\` | Agent Observatory dashboard |

### When to Use Delegation Tools

| Scenario | Tool |
|----------|------|
| Delegating ODF phase work | \`odf_delegate\` |
| Manually injecting standards | \`odf_skill_inject\` |
| Debugging: preview matches | \`odf_skill_resolve\` |
| Finding available skills/agents | \`odf_registry_read\` |
| Need NotebookLM ID for domain | \`odf_notebooklm_lookup\` |
| Configuring sub-agent model | \`odf_profile_select\` |

### ODF Phase Agent Mapping

| Phase | Default Agent |
|-------|---------------|
| ASSESS | odoo_functional_consultant |
| QA-PLAN | odoo_qa_engineer |
| DESIGN | odoo_backend_engineer |
| IMPLEMENT | odoo_backend_engineer |
| VERIFY | odoo_qa_engineer |

Custom agents in the registry override defaults when their triggers match.

### SDD Profiles (Per-Phase Model Assignment)

Each phase has an optimal model profile in the registry. Use \`odf_profile_select\` before delegating. Switch profiles with \`/odf-profile switch <name>\`.

### Skill Injection + Metrics

All ODF delegations automatically inject matching compact rules and record performance metrics for the Agent Observatory.
Sub-agents receive \`## Project Standards (auto-resolved)\` in their prompt.
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
      const skillsDir = path.join(os.homedir(), ".config", "opencode", "skills")
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

  console.log(`[odf-delegation] Plugin loaded. Tools: odf_delegate, odf_skill_inject, odf_registry_read, odf_notebooklm_lookup, odf_profile_select, odf_skill_resolve`)

  return {
    tool: {
      odf_delegate: createODFDelegate(client),
      odf_skill_inject: createODFSkillInject(),
      odf_skill_resolve: createODFSkillResolve(),
      odf_registry_read: createODFRegistryRead(),
      odf_notebooklm_lookup: createODFNotebookLMLookup(),
      odf_profile_select: createODFProfileSelect(),
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
  matchSkills,
  resolveAgent,
  formatCompactRules,
  invokeTask,
  findTaskApi,
  createODFDelegate,
  ALLOWED_PHASES,
  type ODFRegistry,
  type ODFSkill,
  type ODFAgent,
  type DelegationMetrics,
}
