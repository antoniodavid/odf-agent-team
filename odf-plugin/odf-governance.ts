import * as fsSync from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { tool } from "@opencode-ai/plugin"
import { canonicalWorkspaceRoot, isWithinRoot } from "./odf-delegation-shared.js"

export const OCA_POLICY_SOURCE = "https://github.com/OCA/.github/blob/master/AI_POLICY.md"
export const GOVERNANCE_SCHEMA_VERSION = 1 as const

const GOVERNANCE_PHASES = ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY", "EXPLORE", "FIX"] as const
type GovernancePhase = typeof GOVERNANCE_PHASES[number]
const PROVENANCE_LOCK_ATTEMPTS = 20
const PROVENANCE_LOCK_RETRY_MS = 10

export interface AiProvenanceRecord {
  target: "oca"
  phase: GovernancePhase
  agent: string
  model: string
  files: string[]
  recorded_at: string
}

export interface AiProvenanceDocument {
  schema_version: 1
  updated_at: string
  records: AiProvenanceRecord[]
}

export interface AiProvenanceInput {
  target: string
  phase: string
  agent: string
  model: string
  files: string[]
}

const SECRET_LIKE = /(?:^|[._/\\-])(?:\.env|env|secret|secrets|credential|credentials|password|passwd|token|tokens|api[_-]?key|private[_-]?key)(?:$|[._/\\-])|(?:gh[pousr]_|github_pat_|sk-[A-Za-z0-9])/i
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function hasSecretLikeValue(value: string): boolean {
  return SECRET_LIKE.test(value)
}

function isSafeLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200 && !CONTROL_CHARS.test(value) && !hasSecretLikeValue(value)
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && !CONTROL_CHARS.test(value) && !Number.isNaN(Date.parse(value))
}

function resolveGovernanceRoot(workspaceDir: string): string {
  if (typeof workspaceDir !== "string" || !workspaceDir.trim()) throw new Error("workspace is required")
  try {
    const root = canonicalWorkspaceRoot(workspaceDir)
    if (!fsSync.statSync(root).isDirectory()) throw new Error("not a directory")
    return root
  } catch {
    throw new Error("workspace is invalid")
  }
}

function safeRelativePath(root: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || CONTROL_CHARS.test(value) || hasSecretLikeValue(value)) return null
  const candidateValue = value.trim()
  if (path.isAbsolute(candidateValue) || /^~(?:[\\/]|$)/.test(candidateValue) || /^[A-Za-z]:[\\/]/.test(candidateValue)) return null
  const components = candidateValue.split(/[\\/]/)
  if (components.includes("..") || components.some(component => component === "")) return null

  const candidate = path.resolve(root, candidateValue)
  if (!isWithinRoot(candidate, root)) return null

  let realRoot: string
  try {
    realRoot = fsSync.realpathSync(root)
  } catch {
    return null
  }

  const relative = path.relative(root, candidate)
  let current = root
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component)
    try {
      const stat = fsSync.lstatSync(current)
      if (stat.isSymbolicLink() || (current !== candidate && !stat.isDirectory())) return null
      if (!isWithinRoot(fsSync.realpathSync(current), realRoot)) return null
      if (current === candidate && !stat.isFile()) return null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break
      return null
    }
  }
  return relative.split(path.sep).join("/") || null
}

function ensureSafeOdfDirectory(root: string): string | null {
  const directory = path.join(root, ".odf")
  let realRoot: string
  try {
    realRoot = fsSync.realpathSync(root)
  } catch {
    return null
  }
  try {
    const stat = fsSync.lstatSync(directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null
    try {
      fsSync.mkdirSync(directory, { mode: 0o700 })
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== "EEXIST") return null
    }
  }
  try {
    const stat = fsSync.lstatSync(directory)
    return !stat.isSymbolicLink() && stat.isDirectory() && isWithinRoot(fsSync.realpathSync(directory), realRoot) ? directory : null
  } catch {
    return null
  }
}

function provenancePath(root: string, createDirectory = false): string {
  if (createDirectory && !ensureSafeOdfDirectory(root)) throw new Error("provenance directory is unsafe")
  const file = path.join(root, ".odf", "ai-provenance.json")
  if (!safeRelativePath(root, ".odf/ai-provenance.json")) throw new Error("provenance path is unsafe")
  return file
}

function assertExactKeys(value: Record<string, unknown>, keys: string[]): void {
  const actual = Object.keys(value).sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) throw new Error("provenance schema is invalid")
}

function validateRecord(root: string, value: unknown): AiProvenanceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("provenance record is invalid")
  const record = value as Record<string, unknown>
  assertExactKeys(record, ["target", "phase", "agent", "model", "files", "recorded_at"])
  if (record.target !== "oca" || typeof record.phase !== "string" || !GOVERNANCE_PHASES.includes(record.phase as GovernancePhase) ||
    !isSafeLabel(record.agent) || !isSafeLabel(record.model) || !isValidTimestamp(record.recorded_at) || !Array.isArray(record.files)) {
    throw new Error("provenance record is invalid")
  }
  const files = record.files.map(file => safeRelativePath(root, file)).filter((file): file is string => file !== null)
  if (files.length !== record.files.length) throw new Error("provenance contains an unsafe file path")
  return {
    target: "oca",
    phase: record.phase as GovernancePhase,
    agent: record.agent,
    model: record.model,
    files: [...new Set(files)].sort(),
    recorded_at: record.recorded_at,
  }
}

function parseProvenance(root: string, raw: string): AiProvenanceDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("provenance JSON is invalid")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("provenance schema is invalid")
  const document = parsed as Record<string, unknown>
  assertExactKeys(document, ["schema_version", "updated_at", "records"])
  if (document.schema_version !== GOVERNANCE_SCHEMA_VERSION || !isValidTimestamp(document.updated_at) || !Array.isArray(document.records)) {
    throw new Error("provenance schema is invalid")
  }
  return {
    schema_version: 1,
    updated_at: document.updated_at,
    records: document.records.map(record => validateRecord(root, record)),
  }
}

function readExistingProvenance(root: string): AiProvenanceDocument | null {
  const file = provenancePath(root)
  try {
    return parseProvenance(root, fsSync.readFileSync(file, "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

function sameRecordIdentity(left: AiProvenanceRecord, right: AiProvenanceRecord): boolean {
  return left.target === right.target && left.phase === right.phase && left.agent === right.agent && left.model === right.model &&
    JSON.stringify(left.files) === JSON.stringify(right.files)
}

function writeAtomically(file: string, content: string): void {
  const temporary = `${file}.tmp-${process.pid}`
  let fd: number | null = null
  try {
    fd = fsSync.openSync(temporary, "wx", 0o600)
    fsSync.writeFileSync(fd, content, "utf8")
    fsSync.closeSync(fd)
    fd = null
    fsSync.renameSync(temporary, file)
  } finally {
    if (fd !== null) {
      try { fsSync.closeSync(fd) } catch { /* best effort */ }
    }
    try { fsSync.unlinkSync(temporary) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { /* best effort */ }
    }
  }
}

function withProvenanceLock<T>(file: string, operation: () => T): T {
  const lockPath = `${file}.lock`
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4))
  let locked = false
  for (let attempt = 0; attempt < PROVENANCE_LOCK_ATTEMPTS; attempt++) {
    try {
      fsSync.mkdirSync(lockPath, { mode: 0o700 })
      locked = true
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (attempt + 1 < PROVENANCE_LOCK_ATTEMPTS) Atomics.wait(waitBuffer, 0, 0, PROVENANCE_LOCK_RETRY_MS)
    }
  }
  if (!locked) throw new Error("provenance lock unavailable")
  try {
    return operation()
  } finally {
    try { fsSync.rmdirSync(lockPath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { /* best effort */ }
    }
  }
}

export function recordAiProvenance(workspaceDir: string, input: AiProvenanceInput): AiProvenanceDocument {
  const root = resolveGovernanceRoot(workspaceDir)
  if (input.target !== "oca" || typeof input.phase !== "string" || !GOVERNANCE_PHASES.includes(input.phase as GovernancePhase)) throw new Error("target or phase is invalid")
  if (!isSafeLabel(input.agent) || !isSafeLabel(input.model)) throw new Error("agent or model label is unsafe")
  if (!Array.isArray(input.files)) throw new Error("files are invalid")
  const files = input.files.map(file => safeRelativePath(root, file))
  if (files.some(file => file === null)) throw new Error("provenance contains an unsafe file path")
  const record: AiProvenanceRecord = {
    target: "oca",
    phase: input.phase as GovernancePhase,
    agent: input.agent.trim(),
    model: input.model.trim(),
    files: [...new Set(files as string[])].sort(),
    recorded_at: new Date().toISOString(),
  }
  const file = provenancePath(root, true)
  return withProvenanceLock(file, () => {
    const existing = readExistingProvenance(root)
    const records = existing ? [...existing.records] : []
    const index = records.findIndex(item => sameRecordIdentity(item, record))
    if (index >= 0) records[index] = record
    else records.push(record)
    const document: AiProvenanceDocument = { schema_version: 1, updated_at: new Date().toISOString(), records }
    writeAtomically(file, `${JSON.stringify(document, null, 2)}\n`)
    return document
  })
}

export interface GovernanceTrailers {
  assisted_by: string[]
  coauthored_by: string[]
}

export function parseGovernanceTrailers(message: string | null): GovernanceTrailers {
  const result: GovernanceTrailers = { assisted_by: [], coauthored_by: [] }
  if (typeof message !== "string") return result
  let trailerBlock = ""
  try {
    trailerBlock = execFileSync("git", ["interpret-trailers", "--parse"], {
      input: message,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    })
  } catch {
    return result
  }
  for (const line of trailerBlock.split(/\r?\n/)) {
    const match = /^\s*(Assisted-by|Co-authored-by):\s*(.+?)\s*$/i.exec(line)
    if (!match) continue
    const key = match[1].toLowerCase() === "assisted-by" ? "assisted_by" : "coauthored_by"
    result[key].push(match[2])
  }
  return result
}

const AI_IDENTITY = /\b(?:ai|bot|copilot|claude|chatgpt|gpt(?:-[0-9.]+)?|openai|cursor|gemini|anthropic|llama|mistral|codex)\b/i

function isAiIdentity(value: string, labels: string[]): boolean {
  const lower = value.toLowerCase()
  return AI_IDENTITY.test(value) || labels.some(label => lower.includes(label.toLowerCase()))
}

function runGit(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

function runGitRaw(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    return null
  }
}

function untrackedNumstat(root: string, relativePath: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "diff", "--no-ext-diff", "--no-index", "--numstat", "--", "/dev/null", path.resolve(root, relativePath)], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch (error) {
    const stdout = (error as { stdout?: string | Buffer }).stdout
    return stdout ? String(stdout) : null
  }
}

function listLines(value: string | null): string[] {
  return value ? value.split(/\r?\n/).filter(Boolean) : []
}

function listNullTerminated(value: string | null): string[] {
  return value ? value.split("\0").filter(Boolean) : []
}

function addNumstat(value: string | null, totals: { additions: number; deletions: number }): void {
  for (const line of listLines(value)) {
    const [added, deleted] = line.split("\t")
    if (added === "-" || deleted === "-") continue
    totals.additions += Number(added) || 0
    totals.deletions += Number(deleted) || 0
  }
}

function readDiff(root: string) {
  const available = runGit(root, ["rev-parse", "--git-dir"]) !== null
  if (!available) return { git_available: false, additions: 0, deletions: 0, changed_lines: 0, files: [], untracked_files: [] }
  const trackedFiles = listLines(runGit(root, ["diff", "--no-ext-diff", "--name-only", "HEAD", "--"]))
  const untrackedFiles = listNullTerminated(runGitRaw(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
  const totals = { additions: 0, deletions: 0 }
  addNumstat(runGit(root, ["diff", "--no-ext-diff", "--numstat", "HEAD", "--"]), totals)
  for (const file of untrackedFiles) addNumstat(untrackedNumstat(root, file), totals)
  const files = [...new Set([...trackedFiles, ...untrackedFiles])].sort()
  return { git_available: true, additions: totals.additions, deletions: totals.deletions, changed_lines: totals.additions + totals.deletions, files, untracked_files: untrackedFiles.sort() }
}

export interface GovernanceCheckResult {
  schema_version: 1
  status: "ok" | "warning" | "blocked"
  target: "oca"
  source: string
  diff: ReturnType<typeof readDiff>
  provenance: { path: string; present: boolean; record_count: number; error?: string }
  trailers: GovernanceTrailers & { ai_coauthored_by: string[]; recommendations: string[] }
  human_ack_required: true
  human_actions_required: string[]
  pr_disclosure_template: string
  warnings: string[]
}

export function inspectOcaGovernance(workspaceDir: string, commitMessage?: string): GovernanceCheckResult {
  const root = resolveGovernanceRoot(workspaceDir)
  const diff = readDiff(root)
  const warnings: string[] = []
  let provenance: AiProvenanceDocument | null = null
  let provenanceError: string | undefined
  try {
    provenance = readExistingProvenance(root)
  } catch (error) {
    provenanceError = error instanceof Error ? error.message : "provenance could not be read"
    warnings.push(provenanceError)
  }

  const labels = provenance?.records.flatMap(record => [record.agent, record.model]) || []
  const message = commitMessage === undefined ? runGit(root, ["log", "-1", "--format=%B"]) : commitMessage
  const parsedTrailers = parseGovernanceTrailers(message)
  const aiCoauthoredBy = parsedTrailers.coauthored_by.filter(value => isAiIdentity(value, labels))
  const recommendations: string[] = []
  if (provenance?.records.length) {
    for (const label of [...new Set(labels)]) {
      if (!parsedTrailers.assisted_by.some(value => value.toLowerCase().includes(label.toLowerCase()))) {
        recommendations.push(`Add Assisted-by: ${label} for this AI-assisted contribution.`)
      }
    }
  } else {
    recommendations.push("If AI assisted this contribution, record provenance and add one Assisted-by trailer per model or agent.")
  }
  if (aiCoauthoredBy.length) recommendations.push("Remove AI identities from Co-authored-by; use Assisted-by instead.")
  if (diff.changed_lines >= 30 || diff.files.length > 1) recommendations.push("Review the OCA quantity reference point: under 30 changed lines in one file.")
  if (diff.changed_lines > 500) recommendations.push("Obtain prior maintainer agreement for a contribution over 500 changed lines.")
  if (!diff.git_available) warnings.push("Current diff could not be inspected because the workspace is not a readable Git worktree.")
  const humanAckRequired = true
  warnings.push("Human acknowledgment is unresolved; readiness and publication remain blocked.")
  const status = aiCoauthoredBy.length || provenanceError || humanAckRequired ? "blocked" : recommendations.length ? "warning" : "ok"
  const disclosureLabels = [...new Set(labels)]
  const prDisclosure = [
    "## AI disclosure",
    ...(disclosureLabels.length ? disclosureLabels.map(label => `Assisted-by: ${label}`) : ["Assisted-by: <model-or-agent>"]),
    "",
    "Human acknowledgment (complete manually): I reviewed, understand, and take responsibility for this contribution and any AI-assisted review or summary.",
  ].join("\n")
  return {
    schema_version: 1,
    status,
    target: "oca",
    source: OCA_POLICY_SOURCE,
    diff,
    provenance: { path: ".odf/ai-provenance.json", present: provenance !== null, record_count: provenance?.records.length || 0, ...(provenanceError ? { error: provenanceError } : {}) },
    trailers: { ...parsedTrailers, ai_coauthored_by: aiCoauthoredBy, recommendations },
    human_ack_required: humanAckRequired,
    human_actions_required: [
      "A human must review and acknowledge the contribution before commit, review, or PR publication.",
      "A human must assess OCA quantity, rate, and quality guardrails.",
    ],
    pr_disclosure_template: prDisclosure,
    warnings,
  }
}

export function createODFGovernanceProvenance(): ReturnType<typeof tool> {
  return tool({
    description: `Record or update minimal OCA AI provenance in <worktree>/.odf/ai-provenance.json. Merges records, rejects unsafe paths and secret-like values, and never records human approval.`,
    args: {
      target: tool.schema.enum(["oca"]).describe("Explicit governance target: oca"),
      phase: tool.schema.enum([...GOVERNANCE_PHASES]).describe("ODF phase that used AI assistance"),
      agent: tool.schema.string().describe("Agent label without secrets"),
      model: tool.schema.string().describe("Model label without secrets"),
      files: tool.schema.array(tool.schema.string()).describe("Affected paths relative to the worktree"),
      workspace_dir: tool.schema.string().optional().describe("Current worktree (defaults to cwd)"),
    },
    async execute(args: AiProvenanceInput & { workspace_dir?: string }): Promise<string> {
      try {
        const document = recordAiProvenance(args.workspace_dir || process.cwd(), args)
        return JSON.stringify({ status: "ok", path: ".odf/ai-provenance.json", schema_version: document.schema_version, records: document.records.length }, null, 2)
      } catch (error) {
        return JSON.stringify({ status: "error", reason: error instanceof Error ? error.message : "provenance write failed" }, null, 2)
      }
    },
  })
}

export function createODFGovernanceCheck(): ReturnType<typeof tool> {
  return tool({
    description: `Read-only OCA governance check for the current worktree. Checks diff size/files, provenance, Assisted-by recommendations, and AI Co-authored-by misuse. It never commits, publishes, or issues an ODF VERIFY verdict.`,
    args: {
      target: tool.schema.enum(["oca"]).describe("Explicit governance target: oca"),
      workspace_dir: tool.schema.string().optional().describe("Current worktree (defaults to cwd)"),
      commit_message: tool.schema.string().optional().describe("Optional proposed commit message to inspect for trailers"),
    },
    async execute(args: { target: string; workspace_dir?: string; commit_message?: string }): Promise<string> {
      try {
        if (args.target !== "oca") throw new Error("target is not supported by this profile")
        return JSON.stringify(inspectOcaGovernance(args.workspace_dir || process.cwd(), args.commit_message), null, 2)
      } catch (error) {
        return JSON.stringify({ status: "error", target: args.target, human_ack_required: true, reason: error instanceof Error ? error.message : "governance check failed" }, null, 2)
      }
    },
  })
}
