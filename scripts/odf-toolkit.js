#!/usr/bin/env node
/**
 * ODF deterministic toolkit (odf-toolkit).
 *
 * Read-side CLI subcommands that keep deterministic work out of the LLM:
 *   result    normalize a phase result envelope (status/design_closed/artifact refs)
 *   resolve   preview agent + skills + profile for a phase task
 *   state     compact runtime bundle for a change (state + receipts + gates)
 *   evidence  git evidence pack for BUILD/VERIFY
 *   context   CodeGraph explore context pack for a task (shells out to `codegraph`)
 *
 * Usage:
 *   node scripts/odf-toolkit.js result  --result <json> [--root <dir>] [--phase DESIGN]
 *   node scripts/odf-toolkit.js resolve --phase DESIGN --task "<prompt>" [--files a.py,b.js] [--odoo-version 18]
 *   node scripts/odf-toolkit.js state   --root <dir> --change <name>
 *   node scripts/odf-toolkit.js evidence --repo <dir> [--json]
 *   node scripts/odf-toolkit.js context --repo <dir> --task "<query>" [--max-files 8] [--json]
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import YAML from "yaml"
import { collectDelegations, resolveMetricsDir } from "./odf-metrics.js"

const CONFIG_DIR = process.env.ODF_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode")
const REGISTRY_PATH = path.join(CONFIG_DIR, "odf-registry.json")

// ==========================================
// shared helpers
// ==========================================

function fileExists(...parts) {
  try {
    return fs.statSync(path.join(...parts)).isFile()
  } catch {
    return false
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function runGit(repoDir, args) {
  try {
    return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch {
    return null
  }
}

function cap(value, max = 2000) {
  if (typeof value !== "string") return value
  return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`
}

export function asBoolean(value) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return value.trim().toLowerCase() === "true"
  return false
}

// ==========================================
// result — phase result envelope normalizer
// ==========================================

const INNER_STATUSES = new Set(["ok", "warning", "blocked", "failed"])

export function normalizeResult(raw, opts = {}) {
  const warnings = []
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "error", design_closed: false, executive_summary: null, artifacts_saved: [], warnings: ["result envelope is not an object"] }
  }
  const status = INNER_STATUSES.has(raw.status) ? raw.status : "error"
  if (status === "error") warnings.push(`unknown inner status: ${String(raw.status)}`)
  const designClosed = asBoolean(raw.design_closed)
  if ((opts.phase === "DESIGN" || opts.phase === "PLAN") && !designClosed) {
    warnings.push("DESIGN/PLAN result missing design_closed: true")
  }
  const artifactsSaved = []
  const rawRefs = Array.isArray(raw.artifacts_saved) ? raw.artifacts_saved : Array.isArray(raw.artifact_refs) ? raw.artifact_refs : []
  for (const entry of rawRefs) {
    if (typeof entry === "string") {
      const verified = opts.root ? fileExists(opts.root, entry) : null
      artifactsSaved.push({ ref: entry, verified })
      if (verified === false) warnings.push(`artifact_ref not found on disk: ${entry}`)
      continue
    }
    if (!entry || typeof entry !== "object") continue
    const ref = entry.artifact_ref?.ref ?? entry.ref
    const store = entry.artifact_ref?.store ?? entry.store ?? "openspec"
    let verified = null
    if (ref && store === "openspec" && opts.root) verified = fileExists(opts.root, ref)
    else if (ref && store === "engram") verified = "engram-topic"
    artifactsSaved.push({ name: entry.name, store, ref, verified })
    if (verified === false) warnings.push(`artifact_ref not found on disk: ${ref}`)
  }
  return {
    status,
    design_closed: designClosed,
    executive_summary: typeof raw.executive_summary === "string" ? raw.executive_summary : null,
    artifacts_saved: artifactsSaved,
    warnings,
  }
}

// ==========================================
// resolve — agent + skills + profile preview
// ==========================================

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
  "is", "was", "are", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "can", "shall", "this", "that", "these", "those",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
  "what", "which", "who", "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such",
  "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "also", "odoo",
  "el", "la", "los", "las", "un", "una", "y", "o", "pero", "en", "de", "con", "por", "para",
])

const DEFAULT_AGENTS = {
  PROPOSE: "odoo_proposer",
  ASSESS: "odoo_functional_consultant",
  "QA-PLAN": "odoo_qa_engineer",
  DESIGN: "odoo_backend_engineer",
  IMPLEMENT: "odoo_backend_engineer",
  VERIFY: "odoo_qa_engineer",
  EXPLORE: "odoo_functional_consultant",
  FIX: "odoo_backend_engineer",
}

function filterStopWords(keywords) {
  return keywords.filter(kw => {
    const lower = kw.toLowerCase().trim()
    return Boolean(lower) && lower.length >= 3 && !STOP_WORDS.has(lower) && !/^\d+$/.test(lower)
  })
}

export function resolveAgent(registry, phase, taskKeywords) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_AGENTS, phase)) return null
  const filtered = filterStopWords(taskKeywords)
  if (filtered.length === 0) return DEFAULT_AGENTS[phase]
  let best = null
  for (const agent of registry.agents || []) {
    if (!agent.installed) continue
    if (!agent.phases?.includes(phase) && !agent.phases?.includes("ANY")) continue
    const descLower = String(agent.description || "").toLowerCase()
    let score = 0
    for (const kw of filtered) if (descLower.includes(kw.toLowerCase())) score++
    if (score > 0 && (!best || score > best.score)) best = { name: agent.name, score }
  }
  return best ? best.name : DEFAULT_AGENTS[phase]
}

export function matchSkills(registry, phase, context) {
  const taskLower = String(context.task || "").toLowerCase()
  const matches = []
  for (const skill of registry.skills || []) {
    if (skill.removed) continue
    if (context.odooVersion && skill.odoo_versions?.length > 0 && !skill.odoo_versions.includes(context.odooVersion)) continue
    let score = 0
    for (const file of context.files || []) {
      const fileLower = String(file).toLowerCase()
      for (const trigger of skill.triggers || []) if (fileLower.includes(String(trigger).toLowerCase())) score += 2
    }
    for (const trigger of skill.triggers || []) if (taskLower.includes(String(trigger).toLowerCase())) score += 1
    if (score > 0) matches.push({ name: skill.name, _score: score })
  }
  matches.sort((a, b) => (b._score || 0) - (a._score || 0))
  return matches.slice(0, 5).map(m => m.name)
}

export function loadRegistry() {
  return readJson(REGISTRY_PATH)
}

function resolvePreview(phase, task, files, odooVersion) {
  const registry = loadRegistry()
  if (!registry) return { status: "error", warnings: [`registry not found at ${REGISTRY_PATH}`] }
  const keywords = task.split(/\s+/).slice(0, 10)
  const agent = resolveAgent(registry, phase, keywords)
  const skills = matchSkills(registry, phase, { task, files, odooVersion })
  const profile = (registry.profiles || []).find(p => p.name === "default")?.phases?.[phase] || null
  return { status: "ok", agent, skills, profile }
}

// ==========================================
// state — compact runtime bundle (read-only)
// ==========================================

export function stateBundle(root, change) {
  const changeDir = path.join(root, "openspec", "changes", change)
  let files = []
  try {
    files = fs.readdirSync(changeDir, { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => {
        const stat = fs.statSync(path.join(changeDir, e.name))
        return { name: e.name, size: stat.size, mtime: stat.mtime.toISOString() }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch { /* dir missing */ }

  const readArtifact = (name) => {
    const p = path.join(changeDir, name)
    if (!fileExists(p)) return null
    const raw = fs.readFileSync(p, "utf8")
    try {
      return cap(JSON.stringify(YAML.parse(raw)))
    } catch {
      return cap(raw)
    }
  }

  const odfDir = path.join(root, ".odf")
  const readOdfJson = (name) => readJson(path.join(odfDir, name))

  return {
    change,
    state: readArtifact("state.yaml"),
    artifacts: files,
    receipt: readOdfJson(`receipt-${change}.json`),
    policy_gate: readOdfJson(`policy-gate-${change}.json`),
    validation_evidence: readOdfJson(`validation-evidence-${change}.json`),
    parallel_join: readOdfJson(`parallel-join-${change}.json`),
  }
}

// ==========================================
// evidence — git evidence pack
// ==========================================

export function evidencePack(repoDir) {
  const head = runGit(repoDir, ["rev-parse", "HEAD"])
  const branch = runGit(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"])
  const porcelain = runGit(repoDir, ["status", "--porcelain"])
  const dirty = porcelain !== null && porcelain.length > 0
  const numstat = runGit(repoDir, ["diff", "--numstat", "HEAD"])
  const changed = []
  for (const line of (numstat || "").split("\n")) {
    const parts = line.split(/\s+/)
    if (parts.length < 3) continue
    changed.push({ added: Number(parts[0]) || 0, deleted: Number(parts[1]) || 0, path: parts.slice(2).join(" ") })
    if (changed.length >= 200) break
  }
  const diffCheck = (runGit(repoDir, ["diff", "--check"]) ?? "") === ""
  return { head, branch, dirty, changed, diff_check: diffCheck }
}

// ==========================================
// context — CodeGraph explore pack (shell-out)
// ==========================================

function codegraphAvailable() {
  try {
    execFileSync("codegraph", ["--version"], { stdio: "ignore", timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

export function contextPack(repoDir, task, maxFiles = 8) {
  if (!codegraphAvailable()) return { status: "unavailable", hint: "codegraph CLI not found. Install with npm i -g @colbymchenry/codegraph or run odf_community_tool_install('codegraph')." }
  if (!fs.existsSync(path.join(repoDir, ".codegraph"))) {
    return { status: "unindexed", hint: "No .codegraph index in the repo. Run `codegraph init <repo>` or `node <pack>/scripts/odf-project-scan.js --root <root> --repo <repo> --codegraph`." }
  }
  try {
    const output = execFileSync("codegraph", ["explore", task, "--path", repoDir, "--max-files", String(maxFiles)], {
      encoding: "utf8", timeout: 60_000, maxBuffer: 128 * 1024, stdio: ["ignore", "pipe", "ignore"],
    })
    return { status: "ok", context: cap(output, 60_000) }
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).slice(0, 500) : String(error?.message || "codegraph explore failed").slice(0, 500)
    return { status: "error", hint: stderr }
  }
}

// ==========================================
// metrics — delegation dashboard summary
// ==========================================

export function metricsSummary(days = 14) {
  const dir = resolveMetricsDir()
  const records = collectDelegations(dir, days)
  const byPhase = {}
  for (const record of records) {
    const key = record.phase || "?"
    byPhase[key] ??= { calls: 0, ok: 0, blocked: 0, error: 0, timeout: 0, total_duration_ms: 0, avg_duration_ms: 0 }
    const bucket = byPhase[key]
    bucket.calls++
    if (record.status && record.status in bucket) bucket[record.status]++
    bucket.total_duration_ms += Number(record.duration_ms) || 0
  }
  for (const bucket of Object.values(byPhase)) {
    bucket.avg_duration_ms = bucket.calls ? Math.round(bucket.total_duration_ms / bucket.calls) : 0
  }
  return { days, records: records.length, by_phase: byPhase }
}

function renderMetrics(summary) {
  const lines = [`metrics: ${summary.records} records in the last ${summary.days} days`]
  for (const [phase, bucket] of Object.entries(summary.by_phase)) {
    lines.push(`  ${phase}: ${bucket.calls} calls (ok ${bucket.ok}, blocked ${bucket.blocked}, error ${bucket.error}, timeout ${bucket.timeout}) avg ${bucket.avg_duration_ms}ms`)
  }
  return lines.join("\n")
}

// ==========================================
// manual-evidence — record user-run test evidence for VERIFY
// ==========================================

export function buildManualEvidence({ change, command, database, output, exitCode = 0, testIdentity, root }) {
  const problems = []
  if (!change) problems.push("change is required")
  if (!command || !/\s-d\s+\S+/.test(command)) problems.push("command must include an explicit -d <test_db>")
  if (!database) problems.push("database is required")
  if (!output || !/0 failed/i.test(output)) problems.push("output must show a passing result (contains '0 failed')")
  if (exitCode !== 0) problems.push(`exit code must be 0, got ${exitCode}`)
  const gate = root ? readJson(path.join(root, ".odf", `policy-gate-${change}.json`)) : null
  const evidence = {
    change,
    phase: "VERIFY",
    batch: 1,
    risk_tier: gate?.risk_tier ?? "MEDIUM",
    frozen_diff_ref: gate?.frozen_diff_ref ?? null,
    candidate_digest: gate?.candidate_digest ?? null,
    executor: "user-manual",
    test_identity: testIdentity || `${change} test suite (manual)`,
    resolved_at: new Date().toISOString(),
    commands: [{
      name: "odoo-tests",
      command,
      database,
      exit_code: exitCode,
      output_tail: String(output).slice(-2000),
      output_evidence: String(output).slice(-2000),
    }],
  }
  if (gate && !gate.candidate_digest) problems.push("policy gate has no candidate_digest; the evidence may be rejected at commit")
  return { problems, evidence }
}

// ==========================================
// redundancy — pre-check for existing implementation + prior learnings
// ==========================================

const REDUNDANCY_DIRS = ["models", "views", "static/src", "controllers", "data", "tests", "wizard"]
const REDUNDANCY_MAX_FILES = 400
const REDUNDANCY_MAX_MATCHES = 20
const REDUNDANCY_MAX_FILE_BYTES = 64 * 1024

/** Bounded search for existing implementations of the given domain terms. */
export function redundancyCheck(repoDir, terms) {
  const normalized = terms.map(t => String(t).trim().toLowerCase()).filter(Boolean)
  if (normalized.length === 0) return { terms: [], matches: [] }
  const matches = []
  let scanned = 0
  for (const dir of REDUNDANCY_DIRS) {
    const abs = path.join(repoDir, dir)
    if (!fs.existsSync(abs)) continue
    const walk = (current, rel) => {
      if (scanned >= REDUNDANCY_MAX_FILES || matches.length >= REDUNDANCY_MAX_MATCHES) return
      let entries
      try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (scanned >= REDUNDANCY_MAX_FILES || matches.length >= REDUNDANCY_MAX_MATCHES) return
        if (entry.name.startsWith(".")) continue
        const entryPath = path.join(current, entry.name)
        if (entry.isDirectory()) walk(entryPath, path.join(rel, entry.name))
        else if (entry.isFile() && /\.(py|xml|js|ts|scss)$/.test(entry.name)) {
          scanned++
          let content
          try {
            const stat = fs.statSync(entryPath)
            if (stat.size > REDUNDANCY_MAX_FILE_BYTES) continue
            content = fs.readFileSync(entryPath, "utf8").toLowerCase()
          } catch { continue }
          const lines = content.split("\n")
          for (const term of normalized) {
            if (!content.includes(term)) continue
            const lineNo = lines.findIndex(l => l.includes(term)) + 1
            matches.push({ file: path.join(rel, entry.name), term, line: lineNo })
            if (matches.length >= REDUNDANCY_MAX_MATCHES) break
          }
        }
      }
    }
    walk(abs, dir)
  }
  return { terms: normalized, matches }
}

/** Prior learnings/rejections from Engram topics `odf-learned/{project}*`. */
export function priorLearnings(project) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "odf-learned-"))
  const tmpFile = path.join(tmpDir, "export.json")
  try {
    execFileSync("engram", ["export", tmpFile], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 })
    const raw = JSON.parse(fs.readFileSync(tmpFile, "utf8"))
    const observations = Array.isArray(raw) ? raw : raw?.observations
    return (observations || [])
      .filter(o => String(o.topic_key || "").startsWith(`odf-learned/${project}`))
      .map(o => ({ topic: o.topic_key, title: String(o.content || "").slice(0, 80) }))
  } catch {
    return []
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

// ==========================================
// CLI dispatch
// ==========================================

function argValue(argv, flag, fallback = null) {
  const idx = argv.indexOf(flag)
  return idx >= 0 && argv[idx + 1] !== undefined ? argv[idx + 1] : fallback
}

function main(argv) {
  const sub = argv[0]
  const json = argv.includes("--json")
  let result
  switch (sub) {
    case "result": {
      const raw = argValue(argv, "--result")
      if (!raw) return usage("result  --result <json> [--root <dir>] [--phase <PHASE>]")
      let parsed
      try { parsed = JSON.parse(raw) } catch { parsed = { raw } }
      result = normalizeResult(parsed, { root: argValue(argv, "--root"), phase: argValue(argv, "--phase") })
      break
    }
    case "resolve": {
      const phase = argValue(argv, "--phase")
      const task = argValue(argv, "--task")
      if (!phase || !task) return usage("resolve --phase <PHASE> --task \"<prompt>\" [--files a.py,b.js] [--odoo-version 18]")
      const files = argValue(argv, "--files", "")?.split(",").filter(Boolean) || []
      const version = Number(argValue(argv, "--odoo-version")) || null
      result = resolvePreview(phase, task, files, version)
      break
    }
    case "state": {
      const root = argValue(argv, "--root")
      const change = argValue(argv, "--change")
      if (!root || !change) return usage("state --root <dir> --change <name>")
      result = stateBundle(path.resolve(root), change)
      break
    }
    case "evidence": {
      const repo = argValue(argv, "--repo")
      if (!repo) return usage("evidence --repo <dir>")
      result = evidencePack(path.resolve(repo))
      break
    }
    case "context": {
      const repo = argValue(argv, "--repo")
      const task = argValue(argv, "--task")
      if (!repo || !task) return usage("context --repo <dir> --task \"<query>\" [--max-files 8]")
      result = contextPack(path.resolve(repo), task, Number(argValue(argv, "--max-files")) || 8)
      break
    }
    case "metrics": {
      result = metricsSummary(Number(argValue(argv, "--days")) || 14)
      if (!json) {
        process.stdout.write(renderMetrics(result) + "\n")
        process.exit(0)
      }
      break
    }
    case "redundancy": {
      const repo = argValue(argv, "--repo")
      const terms = (argValue(argv, "--terms") || "").split(",")
      const project = argValue(argv, "--project")
      if (!repo || terms.length === 0 || terms.every(t => !t.trim())) {
        return usage("redundancy --repo <dir> --terms \"term1,term2\" [--project <name>]")
      }
      const check = redundancyCheck(path.resolve(repo), terms)
      const learnings = project ? priorLearnings(project) : []
      result = { ...check, prior_learnings: learnings }
      break
    }
    case "manual-evidence": {
      const change = argValue(argv, "--change")
      const command = argValue(argv, "--command")
      const database = argValue(argv, "--database")
      const root = argValue(argv, "--root")
      const outputFile = argValue(argv, "--output-file")
      const outputText = argValue(argv, "--output")
      if (!change || !command || !database || (!outputFile && outputText === null)) {
        return usage("manual-evidence --change <name> --command \"<cmd with -d db>\" --database <db> --output-file <path>|--output \"<text>\" [--root <dir>] [--exit-code 0] [--test-identity <id>]")
      }
      let output
      if (outputFile) {
        try { output = fs.readFileSync(path.resolve(root || process.cwd(), outputFile), "utf8") }
        catch { return usage(`manual-evidence: cannot read output file ${outputFile}`) }
      } else {
        output = outputText
      }
      const built = buildManualEvidence({
        change, command, database, output,
        exitCode: Number(argValue(argv, "--exit-code")) || 0,
        testIdentity: argValue(argv, "--test-identity") || undefined,
        root: root ? path.resolve(root) : undefined,
      })
      if (built.problems.length) {
        process.stderr.write(`manual-evidence rejected:\n- ${built.problems.join("\n- ")}\n`)
        process.exit(1)
      }
      const odfDir = path.join(root ? path.resolve(root) : process.cwd(), ".odf")
      fs.mkdirSync(odfDir, { recursive: true })
      const evidencePath = path.join(odfDir, `validation-evidence-${change}.json`)
      fs.writeFileSync(evidencePath, JSON.stringify(built.evidence, null, 2))
      result = { status: "written", path: evidencePath, evidence: built.evidence }
      break
    }
    default:
      return usage()
  }
  process.stdout.write(json ? JSON.stringify(result, null, 2) + "\n" : JSON.stringify(result, null, 2) + "\n")
  if (sub === "context" && result.status === "ok") {
    process.stdout.write("\n# freshness: if a relevant file was edited moments ago, read it directly — the index syncs within ~1s.\n")
  }
  process.exit(sub === "context" && result.status !== "ok" ? 1 : 0)
}

function usage(detail = "") {
  console.error(detail ? `Usage: odf-toolkit ${detail}` : "Usage: odf-toolkit <result|resolve|state|evidence|context|metrics|manual-evidence|redundancy> [options]")
  process.exit(2)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
