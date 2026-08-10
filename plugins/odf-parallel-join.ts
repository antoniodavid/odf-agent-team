import * as fsSync from "node:fs"
import * as path from "node:path"

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const MAX_BYTES = 256 * 1024
const MAX_BRANCHES = 3
const MAX_PROMPT_BYTES = 16 * 1024
const MAX_CONTEXT_FILES = 32
const MAX_REF_BYTES = 256

export type ParallelJoinStatus = "running" | "complete" | "blocked"
export type ParallelJoinBranchStatus = "running" | "complete" | "failed"

export interface ParallelJoinValidation {
  status: "verified" | "missing" | "invalid"
  reason: string
  commands_validated: number
}

export interface ParallelJoinBranchDescriptor {
  prompt: string
  context_files: string[]
  timeout_ms?: number
}

export interface ParallelJoinOutcome {
  status: string
  result_status: string | null
  successful: boolean
  validation: ParallelJoinValidation | null
  validation_verified: boolean
  validation_evidence_ref: string
  attempt_ledger_ref: string
  summary: string
}

export interface ParallelJoinBranch {
  status: ParallelJoinBranchStatus
  branch_id: string
  attempt_id: string
  descriptor: ParallelJoinBranchDescriptor
  outcome: ParallelJoinOutcome
}

export interface ParallelJoinArtifact {
  schema_version: 1
  change: string
  work_type: "cross-domain"
  phase: "IMPLEMENT"
  timestamp: string
  join: {
    status: ParallelJoinStatus
    expected: number
    completed: number
    failed: number
    running: number
    validation_verified: boolean
  }
  branches: ParallelJoinBranch[]
  evidence_refs: string[]
  attempt_ledger_refs: string[]
  receipt_ref: string | null
}

export interface ParallelJoinReadResult {
  artifact: ParallelJoinArtifact | null
  warning: string | null
}

function isSafeToken(value: unknown): value is string {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value)
}

function isSafeText(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && !value.includes("\0") && Buffer.byteLength(value, "utf8") <= maxBytes
}

function isSafeReference(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_REF_BYTES &&
    !path.isAbsolute(value) && !value.includes("\0") && !value.split(/[\\/]/).includes("..")
}

function isSafeContextFile(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_REF_BYTES &&
    !path.isAbsolute(value) && !value.includes("\0") && !value.split(/[\\/]/).includes("..")
}

function isSafeTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !/[\r\n\0]/.test(value) && Number.isFinite(Date.parse(value))
}

function isBoundedStatus(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && !/[\r\n\0]/.test(value)
}

function isValidation(value: unknown): value is ParallelJoinValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const validation = value as Partial<ParallelJoinValidation>
  const commandsValidated = validation.commands_validated
  return (validation.status === "verified" || validation.status === "missing" || validation.status === "invalid") &&
    isSafeText(validation.reason, 512) && typeof commandsValidated === "number" && Number.isInteger(commandsValidated) &&
    commandsValidated >= 0 && commandsValidated <= 100
}

function isDescriptor(value: unknown): value is ParallelJoinBranchDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const descriptor = value as Partial<ParallelJoinBranchDescriptor>
  if (!isSafeText(descriptor.prompt, MAX_PROMPT_BYTES) || !Array.isArray(descriptor.context_files) ||
    descriptor.context_files.length > MAX_CONTEXT_FILES || !descriptor.context_files.every(isSafeContextFile)) return false
  return descriptor.timeout_ms === undefined ||
    (typeof descriptor.timeout_ms === "number" && Number.isInteger(descriptor.timeout_ms) && descriptor.timeout_ms > 0 && descriptor.timeout_ms <= 600_000)
}

function isOutcome(value: unknown): value is ParallelJoinOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const outcome = value as Partial<ParallelJoinOutcome>
  return isBoundedStatus(outcome.status) &&
    (outcome.result_status === null || isBoundedStatus(outcome.result_status)) &&
    typeof outcome.successful === "boolean" &&
    (outcome.validation === null || isValidation(outcome.validation)) &&
    typeof outcome.validation_verified === "boolean" &&
    outcome.validation_verified === (outcome.validation?.status === "verified") &&
    isSafeReference(outcome.validation_evidence_ref) &&
    isSafeReference(outcome.attempt_ledger_ref) &&
    isSafeText(outcome.summary, 512)
}

function normalizeArtifact(value: unknown, change: string): ParallelJoinArtifact | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "artifact is not an object"
  const artifact = value as Partial<ParallelJoinArtifact>
  if (artifact.schema_version !== 1) return "unsupported schema_version"
  if (!isSafeToken(artifact.change) || artifact.change !== change) return "change does not match"
  if (artifact.work_type !== "cross-domain" || artifact.phase !== "IMPLEMENT") return "work_type or phase does not match"
  if (!isSafeTimestamp(artifact.timestamp)) return "timestamp is invalid"
  if (!artifact.join || typeof artifact.join !== "object" || Array.isArray(artifact.join)) return "join is invalid"

  const join = artifact.join as Partial<ParallelJoinArtifact["join"]>
  const expected = join.expected
  const completedCount = join.completed
  const failedCount = join.failed
  const runningCount = join.running
  if ((join.status !== "running" && join.status !== "complete" && join.status !== "blocked") ||
    typeof expected !== "number" || !Number.isInteger(expected) || expected < 2 || expected > MAX_BRANCHES ||
    typeof completedCount !== "number" || !Number.isInteger(completedCount) || completedCount < 0 || completedCount > expected ||
    typeof failedCount !== "number" || !Number.isInteger(failedCount) || failedCount < 0 || failedCount > expected ||
    (join.status === "running"
      ? typeof runningCount !== "number" || !Number.isInteger(runningCount) || runningCount < 1 || runningCount > expected
      : runningCount !== undefined && (typeof runningCount !== "number" || !Number.isInteger(runningCount) || runningCount !== 0)) ||
    typeof join.validation_verified !== "boolean") return "join counts are invalid"

  if (!Array.isArray(artifact.branches) || artifact.branches.length !== expected) return "branch count does not match join.expected"
  const branchIds = new Set<string>()
  const attemptIds = new Set<string>()
  const branches: ParallelJoinBranch[] = []
  for (const value of artifact.branches) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "branch is invalid"
    const branch = value as Partial<ParallelJoinBranch>
    const branchStatus = branch.status === undefined
      ? (branch.outcome && typeof branch.outcome === "object" && branch.outcome.successful ? "complete" : "failed")
      : branch.status
    if (join.status === "running" && branch.status === undefined) return "running branch status is missing"
    if ((branchStatus !== "running" && branchStatus !== "complete" && branchStatus !== "failed") ||
      (branchStatus === "running" && (!branch.outcome || branch.outcome.status !== "running" || branch.outcome.successful || branch.outcome.validation_verified)) ||
      (branchStatus === "complete" && (!branch.outcome || !branch.outcome.successful)) ||
      (branchStatus === "failed" && branch.outcome?.successful === true) ||
      !isSafeToken(branch.branch_id) || branchIds.has(branch.branch_id) || !isSafeToken(branch.attempt_id) || attemptIds.has(branch.attempt_id) ||
      !isDescriptor(branch.descriptor) || !isOutcome(branch.outcome)) return "branch descriptor or outcome is invalid"
    branchIds.add(branch.branch_id)
    attemptIds.add(branch.attempt_id)
    branches.push({
      status: branchStatus,
      branch_id: branch.branch_id,
      attempt_id: branch.attempt_id,
      descriptor: {
        prompt: branch.descriptor.prompt,
        context_files: [...branch.descriptor.context_files],
        ...(branch.descriptor.timeout_ms === undefined ? {} : { timeout_ms: branch.descriptor.timeout_ms }),
      },
      outcome: {
        status: branch.outcome.status,
        result_status: branch.outcome.result_status,
        successful: branch.outcome.successful,
        validation: branch.outcome.validation ? { ...branch.outcome.validation } : null,
        validation_verified: branch.outcome.validation_verified,
        validation_evidence_ref: branch.outcome.validation_evidence_ref,
        attempt_ledger_ref: branch.outcome.attempt_ledger_ref,
        summary: branch.outcome.summary,
      },
    })
  }

  const completed = branches.filter(branch => branch.status === "complete").length
  const running = branches.filter(branch => branch.status === "running").length
  const failed = branches.filter(branch => branch.status === "failed").length
  const validationVerified = branches.every(branch => branch.status === "complete" && branch.outcome.successful && branch.outcome.validation_verified)
  if (completed !== completedCount || failed !== failedCount || running !== (runningCount || 0) || validationVerified !== join.validation_verified) {
    return "join counts do not match outcomes"
  }
  if ((join.status === "running" && running === 0) || (join.status !== "running" && running !== 0)) return "join running state is inconsistent"
  if (join.status === "complete" && (!validationVerified || completed !== expected || failedCount !== 0)) return "complete join is not complete"
  if (join.status === "blocked" && validationVerified && completed === expected) return "blocked join is complete"

  if (!Array.isArray(artifact.evidence_refs) || artifact.evidence_refs.length > MAX_BRANCHES || !artifact.evidence_refs.every(isSafeReference) ||
    !Array.isArray(artifact.attempt_ledger_refs) || artifact.attempt_ledger_refs.length > MAX_BRANCHES || !artifact.attempt_ledger_refs.every(isSafeReference) ||
    (artifact.receipt_ref !== null && !isSafeReference(artifact.receipt_ref))) return "artifact references are invalid"
  const evidenceRefs = Array.from(new Set(branches.map(branch => branch.outcome.validation_evidence_ref)))
  const ledgerRefs = Array.from(new Set(branches.map(branch => branch.outcome.attempt_ledger_ref)))
  if (artifact.evidence_refs.length !== evidenceRefs.length || artifact.evidence_refs.some(ref => !evidenceRefs.includes(ref)) ||
    artifact.attempt_ledger_refs.length !== ledgerRefs.length || artifact.attempt_ledger_refs.some(ref => !ledgerRefs.includes(ref))) return "artifact references do not match outcomes"
  if ((join.status === "complete" && artifact.receipt_ref !== null) ||
    (join.status === "blocked" && artifact.receipt_ref === null) ||
    (join.status === "running" && artifact.receipt_ref !== null)) return "receipt reference does not match join status"

  return {
    schema_version: 1,
    change,
    work_type: "cross-domain",
    phase: "IMPLEMENT",
    timestamp: artifact.timestamp,
    join: {
      status: join.status,
      expected,
      completed: completedCount,
      failed: failedCount,
      running,
      validation_verified: join.validation_verified,
    },
    branches,
    evidence_refs: [...artifact.evidence_refs],
    attempt_ledger_refs: [...artifact.attempt_ledger_refs],
    receipt_ref: artifact.receipt_ref,
  }
}

function artifactPath(workspaceRoot: string, change: string): string | null {
  if (!isSafeToken(change)) return null
  return path.join(path.resolve(workspaceRoot), ".odf", `parallel-join-${change}.json`)
}

function isWithinRoot(candidate: string, root: string): boolean {
  const normalizedRoot = path.normalize(root)
  const normalizedCandidate = path.normalize(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
}

export function parallelJoinArtifactRef(change: string): string {
  return path.join(".odf", `parallel-join-${change}.json`)
}

export function writeParallelJoinArtifact(workspaceRoot: string, artifact: ParallelJoinArtifact): string | null {
  const filePath = artifactPath(workspaceRoot, artifact.change)
  if (!filePath) return "parallel-join-unsafe-path"
  const normalized = normalizeArtifact(artifact, artifact.change)
  if (typeof normalized === "string") return `parallel-join-invalid: ${normalized}`
  const serialized = JSON.stringify(normalized, null, 2)
  if (Buffer.byteLength(serialized, "utf8") > MAX_BYTES) return "parallel-join-limit"
  try {
    const root = fsSync.realpathSync(path.resolve(workspaceRoot))
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true })
    const realDirectory = fsSync.realpathSync(path.dirname(filePath))
    if (!isWithinRoot(realDirectory, root)) return "parallel-join-unsafe-path"
    if (fsSync.existsSync(filePath) && !isWithinRoot(fsSync.realpathSync(filePath), root)) return "parallel-join-unsafe-path"
    fsSync.writeFileSync(filePath, serialized, { encoding: "utf8", flag: "w" })
    return null
  } catch {
    return "parallel-join-write-failed"
  }
}

export function readParallelJoinArtifact(workspaceRoot: string, change: string): ParallelJoinReadResult {
  const filePath = artifactPath(workspaceRoot, change)
  if (!filePath) return { artifact: null, warning: "Parallel join path is unsafe." }
  let stat: fsSync.Stats
  try {
    stat = fsSync.statSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { artifact: null, warning: null }
    return { artifact: null, warning: "Parallel join artifact is unreadable." }
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return { artifact: null, warning: "Parallel join artifact is oversized or not a regular file." }

  try {
    const root = fsSync.realpathSync(path.resolve(workspaceRoot))
    const realPath = fsSync.realpathSync(filePath)
    if (!isWithinRoot(realPath, root)) return { artifact: null, warning: "Parallel join artifact escapes the workspace." }
    const raw = fsSync.readFileSync(filePath, "utf8")
    if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) return { artifact: null, warning: "Parallel join artifact is oversized." }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { artifact: null, warning: "Malformed parallel join artifact: invalid JSON." }
    }
    const normalized = normalizeArtifact(parsed, change)
    return typeof normalized === "string"
      ? { artifact: null, warning: `Malformed parallel join artifact: ${normalized}.` }
      : { artifact: normalized, warning: null }
  } catch {
    return { artifact: null, warning: "Parallel join artifact is unreadable or malformed." }
  }
}
