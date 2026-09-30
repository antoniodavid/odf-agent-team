/**
 * Opaque delegation tokens for the native prepare/seal path (roadmap issue #55).
 *
 * The orchestrator calls `odf_delegation_prepare`, then the host `subagent`
 * tool, then `odf_delegation_seal`. The token binds those three steps: it is
 * minted in prepare, persisted under `<workspace>/.odf/`, and consumed by seal,
 * which verifies the launched child session against it before any gate runs.
 *
 * Pure filesystem helpers: no registry, sessions, or workflow state live here.
 * Bounded by design: one JSON file per token (max 16 KiB), opaque 128-bit token,
 * kebab-case change names, workspace-contained paths, two-hour TTL.
 */
import * as fsSync from "node:fs"
import * as path from "node:path"
import * as nodeCrypto from "node:crypto"
import { CHANGE_NAME_PATTERN, canonicalWorkspaceRoot, isWithinRoot } from "./odf-delegation-shared.js"

export const DELEGATION_TOKEN_SCHEMA_VERSION = 1 as const
export const DELEGATION_TOKEN_TTL_MS = 2 * 60 * 60 * 1000
export const DELEGATION_TOKEN_PATTERN = /^odf-tok-[a-f0-9]{32}$/

const MAX_TOKEN_FILE_BYTES = 32 * 1024
const MAX_CONTEXT_FILES = 64
const MAX_TASK_CHARS = 8192
const MAX_ROOT_CHARS = 2048
const MAX_JSON_FIELD_CHARS = 4096
const MAX_ACK_CHARS = 1024
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const PROMPT_DIGEST_PATTERN = /^[a-f0-9]{64}$/

export const DELEGATION_PHASES = ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY", "EXPLORE", "FIX"] as const
export type DelegationPhase = (typeof DELEGATION_PHASES)[number]
export type DelegationTokenStatus = "prepared" | "sealed"
export type DelegationArtifactStore = "openspec" | "engram" | "hybrid"

export interface DelegationTokenBranchInput {
  branch_id: string
  agent: string
  attempt_id: string
  /** Final prepared prompt the child must receive verbatim (digested). */
  prompt: string
  /** Raw branch task used by the proof-backed replay. */
  task: string
  context_files?: string[]
}

export interface DelegationTokenBranch {
  branch_id: string
  agent: string
  attempt_id: string
  prompt_digest: string
  task: string
  context_files: string[]
}

export interface DelegationTokenInput {
  change: string
  phase: DelegationPhase
  agent: string
  /** Pre-minted token (obtained with newDelegationToken) so the prompt marker can carry it. */
  token?: string
  /** Skills injected at prepare time, for envelope parity at seal. */
  skills_injected?: string[]
  /** Profile payload (name/model/temperature/reasoning) for envelope parity. */
  profile?: Record<string, unknown> | null
  /** Workspace root the delegation belongs to; canonicalized before storage. */
  workspace: string
  /** Enriched prompt the orchestrator must pass to the host subagent tool verbatim. */
  prompt: string
  /**
   * Raw phase task text. Seal uses it for deterministic source-authority hints
   * so injected contract text cannot change the relation detection.
   */
  task: string
  /** Deterministic Odoo source roots resolved at prepare time, when required. */
  source_root?: string
  source_repos?: string
  /** Exact workflow_advance proof for proof-backed BUILD/VERIFY phases. */
  workflow_advance?: Record<string, unknown>
  /** Policy gate resolved and persisted at prepare time (proof-backed phases). */
  policy_gate?: Record<string, unknown> | null
  /** Persisted governance target for the proof-backed commit. */
  target?: string
  /** Explicit final OCA acknowledgment for the proof-backed commit. */
  governance_acknowledgment?: Record<string, unknown> | null
  /** Parallel BUILD branches (2-3) for a cross-domain delegation. */
  branches?: DelegationTokenBranchInput[]
  artifact_store?: DelegationArtifactStore
  context_files?: string[]
  attempt_id?: string
  branch_id?: string
  now?: Date
  ttl_ms?: number
}

export interface DelegationTokenRecord {
  schema_version: 1
  token: string
  change: string
  phase: DelegationPhase
  agent: string
  artifact_store?: DelegationArtifactStore
  /** Canonical workspace root the token is bound to. */
  workspace: string
  /** SHA-256 of the enriched prompt the child session must have received. */
  prompt_digest: string
  /** Raw phase task text used for source-authority hints at seal time. */
  task: string
  source_root?: string
  source_repos?: string
  workflow_advance?: Record<string, unknown>
  policy_gate?: Record<string, unknown> | null
  target?: string
  governance_acknowledgment?: Record<string, unknown> | null
  branches?: DelegationTokenBranch[]
  skills_injected: string[]
  profile: Record<string, unknown> | null
  context_files: string[]
  attempt_id?: string
  branch_id?: string
  proposal_artifact_ref?: string
  proposal_digest?: string
  proposal_session_id?: string
  created_at: string
  expires_at: string
  status: DelegationTokenStatus
  sealed_at?: string
}

export type DelegationTokenReadResult =
  | { record: DelegationTokenRecord; error: null }
  | { record: null; error: string }

function safeLabel(value: unknown): string | null {
  return typeof value === "string" && SAFE_LABEL_PATTERN.test(value) ? value : null
}

function safeTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null
}

function safeTask(value: unknown): string | null {
  // Phase tasks are natural-language prompts and may contain line breaks;
  // reject non-printing controls without rejecting ordinary prompt formatting.
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TASK_CHARS &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/.test(value)
    ? value.trim()
    : null
}

function safeRoot(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ROOT_CHARS && !/[\0\r\n]/.test(value)
    ? value.trim()
    : null
}

function safeProfile(value: unknown): { ok: boolean; profile: Record<string, unknown> | null } {
  if (value === undefined || value === null) return { ok: true, profile: null }
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, profile: null }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { ok: false, profile: null }
  }
  if (typeof serialized !== "string" || serialized.length > 1024 || serialized.includes("\0")) return { ok: false, profile: null }
  return { ok: true, profile: value as Record<string, unknown> }
}

function safeJsonObject(value: unknown, maxChars: number): { ok: boolean; value: Record<string, unknown> | null } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, value: null }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { ok: false, value: null }
  }
  if (typeof serialized !== "string" || serialized.length > maxChars || serialized.includes("\0")) return { ok: false, value: null }
  return { ok: true, value: value as Record<string, unknown> }
}

function canonicalWorkspace(workspace: string): string | null {
  try {
    return canonicalWorkspaceRoot(workspace)
  } catch {
    return null
  }
}

export function delegationPromptDigest(prompt: string): string {
  return nodeCrypto.createHash("sha256").update(typeof prompt === "string" ? prompt : "").digest("hex")
}

/** New opaque token. 16 random bytes rendered as 32 lowercase hex characters. */
export function newDelegationToken(): string {
  return `odf-tok-${nodeCrypto.randomBytes(16).toString("hex")}`
}

export function createDelegationTokenRecord(input: DelegationTokenInput): DelegationTokenRecord | null {
  const change = typeof input.change === "string" && CHANGE_NAME_PATTERN.test(input.change.trim()) ? input.change.trim() : null
  const agent = safeLabel(input.agent)
  const phase = DELEGATION_PHASES.includes(input.phase) ? input.phase : null
  const workspace = canonicalWorkspace(input.workspace)
  if (!change || !agent || !phase || !workspace) return null
  const task = safeTask(input.task)
  if (!task) return null
  const token = input.token === undefined ? newDelegationToken() : (DELEGATION_TOKEN_PATTERN.test(input.token) ? input.token : null)
  if (!token) return null
  const skills = Array.isArray(input.skills_injected)
    ? input.skills_injected.filter((name): name is string => safeLabel(name) !== null).slice(0, 8)
    : []
  const profile = safeProfile(input.profile)
  if (!profile.ok) return null
  const branches = input.branches === undefined ? null : buildBranches(input.branches)
  if (input.branches !== undefined && !branches) return null
  if (input.source_root !== undefined && !safeRoot(input.source_root)) return null
  if (input.source_repos !== undefined && !safeRoot(input.source_repos)) return null
  if (input.target !== undefined && input.target !== "oca") return null
  const workflowAdvance = safeJsonObject(input.workflow_advance, MAX_JSON_FIELD_CHARS)
  if (!workflowAdvance.ok) return null
  const policyGate = safeJsonObject(input.policy_gate, MAX_JSON_FIELD_CHARS)
  if (!policyGate.ok) return null
  const acknowledgment = safeJsonObject(input.governance_acknowledgment, MAX_ACK_CHARS)
  if (!acknowledgment.ok) return null
  if (input.artifact_store !== undefined && !["openspec", "engram", "hybrid"].includes(input.artifact_store)) return null
  if (input.attempt_id !== undefined && !safeLabel(input.attempt_id)) return null
  if (input.branch_id !== undefined && !safeLabel(input.branch_id)) return null
  const contextFiles = Array.isArray(input.context_files)
    ? input.context_files
      .filter((file): file is string => typeof file === "string" && file.length > 0 && file.length <= 512 && !/[\0\r\n]/.test(file))
      .slice(0, MAX_CONTEXT_FILES)
    : []
  const created = input.now instanceof Date && Number.isFinite(input.now.getTime()) ? input.now : new Date()
  const ttl = Number.isFinite(input.ttl_ms) && (input.ttl_ms as number) > 0 ? (input.ttl_ms as number) : DELEGATION_TOKEN_TTL_MS
  const expires = new Date(created.getTime() + ttl)
  return {
    schema_version: DELEGATION_TOKEN_SCHEMA_VERSION,
    token,
    change,
    phase,
    agent,
    ...(input.artifact_store ? { artifact_store: input.artifact_store } : {}),
    workspace,
    prompt_digest: delegationPromptDigest(input.prompt),
    task,
    ...(input.source_root ? { source_root: input.source_root } : {}),
    ...(input.source_repos ? { source_repos: input.source_repos } : {}),
    ...(workflowAdvance.value ? { workflow_advance: workflowAdvance.value } : {}),
    ...(policyGate.value ? { policy_gate: policyGate.value } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(acknowledgment.value ? { governance_acknowledgment: acknowledgment.value } : {}),
    ...(branches ? { branches } : {}),
    skills_injected: skills,
    profile: profile.profile,
    context_files: contextFiles,
    ...(input.attempt_id ? { attempt_id: input.attempt_id } : {}),
    ...(input.branch_id ? { branch_id: input.branch_id } : {}),
    created_at: created.toISOString(),
    expires_at: expires.toISOString(),
    status: "prepared",
  }
}

function isTokenBranch(value: unknown): value is DelegationTokenBranch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const branch = value as Record<string, unknown>
  return safeLabel(branch.branch_id) !== null &&
    safeLabel(branch.agent) !== null &&
    safeLabel(branch.attempt_id) !== null &&
    typeof branch.prompt_digest === "string" && PROMPT_DIGEST_PATTERN.test(branch.prompt_digest) &&
    safeTask(branch.task) !== null &&
    Array.isArray(branch.context_files) && branch.context_files.every(file => typeof file === "string")
}

function buildBranches(inputs: DelegationTokenBranchInput[]): DelegationTokenBranch[] | null {
  if (inputs.length < 2 || inputs.length > 3) return null
  const seenBranches = new Set<string>()
  const seenAttempts = new Set<string>()
  const branches: DelegationTokenBranch[] = []
  for (const input of inputs) {
    const branchId = safeLabel(input?.branch_id)
    const agent = safeLabel(input?.agent)
    const attemptId = safeLabel(input?.attempt_id)
    const task = safeTask(input?.task)
    if (!branchId || !agent || !attemptId || !task) return null
    if (seenBranches.has(branchId) || seenAttempts.has(attemptId)) return null
    seenBranches.add(branchId)
    seenAttempts.add(attemptId)
    const contextFiles = Array.isArray(input.context_files)
      ? input.context_files.filter((file): file is string => typeof file === "string" && file.length > 0 && file.length <= 512 && !/[\0\r\n]/.test(file)).slice(0, MAX_CONTEXT_FILES)
      : []
    branches.push({
      branch_id: branchId,
      agent,
      attempt_id: attemptId,
      prompt_digest: delegationPromptDigest(input.prompt),
      task,
      context_files: contextFiles,
    })
  }
  return branches
}

function isDelegationTokenRecord(value: unknown): value is DelegationTokenRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const hasProposalEvidence = record.proposal_artifact_ref !== undefined || record.proposal_digest !== undefined || record.proposal_session_id !== undefined
  const proposalEvidenceValid = !hasProposalEvidence || (
    record.phase === "PROPOSE" &&
    record.proposal_artifact_ref === `openspec/changes/${String(record.change)}/proposal.md` &&
    typeof record.proposal_digest === "string" && PROMPT_DIGEST_PATTERN.test(record.proposal_digest) &&
    typeof record.proposal_session_id === "string" && record.proposal_session_id.length > 0 &&
    record.proposal_session_id.length <= 256 && !/[\0\r\n]/.test(record.proposal_session_id)
  )
  return record.schema_version === DELEGATION_TOKEN_SCHEMA_VERSION &&
    typeof record.token === "string" && DELEGATION_TOKEN_PATTERN.test(record.token) &&
    typeof record.change === "string" && CHANGE_NAME_PATTERN.test(record.change) &&
    typeof record.phase === "string" && (DELEGATION_PHASES as readonly string[]).includes(record.phase) &&
    safeLabel(record.agent) !== null &&
    (record.artifact_store === undefined || ["openspec", "engram", "hybrid"].includes(record.artifact_store as string)) &&
    typeof record.workspace === "string" && record.workspace.length > 0 &&
    typeof record.prompt_digest === "string" && PROMPT_DIGEST_PATTERN.test(record.prompt_digest) &&
    safeTask(record.task) !== null &&
    (record.source_root === undefined || safeRoot(record.source_root) !== null) &&
    (record.source_repos === undefined || safeRoot(record.source_repos) !== null) &&
    (record.workflow_advance === undefined || (typeof record.workflow_advance === "object" && !Array.isArray(record.workflow_advance))) &&
    (record.policy_gate === undefined || record.policy_gate === null || (typeof record.policy_gate === "object" && !Array.isArray(record.policy_gate))) &&
    (record.target === undefined || record.target === "oca") &&
    (record.governance_acknowledgment === undefined || (typeof record.governance_acknowledgment === "object" && !Array.isArray(record.governance_acknowledgment))) &&
    (record.branches === undefined || (Array.isArray(record.branches) && record.branches.length >= 2 && record.branches.length <= 3 && record.branches.every(isTokenBranch))) &&
    Array.isArray(record.skills_injected) && record.skills_injected.every(name => safeLabel(name) !== null) &&
    (record.profile === null || (typeof record.profile === "object" && !Array.isArray(record.profile))) &&
    Array.isArray(record.context_files) && record.context_files.every(file => typeof file === "string") &&
    safeTimestamp(record.created_at) !== null &&
    safeTimestamp(record.expires_at) !== null &&
    (record.status === "prepared" || record.status === "sealed") &&
    (record.sealed_at === undefined || safeTimestamp(record.sealed_at) !== null) &&
    proposalEvidenceValid
}

export function isDelegationTokenExpired(record: DelegationTokenRecord, now: Date = new Date()): boolean {
  const expires = Date.parse(record.expires_at)
  return Number.isFinite(expires) && now.getTime() > expires
}

/** Absolute token path, or null when any component would escape the workspace. */
export function delegationTokenPath(workspace: string, change: string, token: string): string | null {
  const root = canonicalWorkspace(workspace)
  if (!root) return null
  if (!CHANGE_NAME_PATTERN.test(change)) return null
  if (!DELEGATION_TOKEN_PATTERN.test(token)) return null
  const filePath = path.join(root, ".odf", `delegation-${change}-${token}.json`)
  return isWithinRoot(filePath, root) ? filePath : null
}

function ensureOdfDirectory(root: string): string | null {
  const directory = path.join(root, ".odf")
  if (!isWithinRoot(directory, root)) return null
  try {
    fsSync.mkdirSync(directory, { recursive: true })
    return directory
  } catch {
    return null
  }
}

/** Persist a token atomically. Returns an error code, or null on success. */
export function writeDelegationToken(workspace: string, record: DelegationTokenRecord): string | null {
  const filePath = delegationTokenPath(workspace, record.change, record.token)
  if (!filePath) return "delegation-token-unsafe-path"
  const root = canonicalWorkspace(workspace)
  if (!root || !ensureOdfDirectory(root)) return "delegation-token-unsafe-path"
  let serialized: string
  try {
    serialized = JSON.stringify(record, null, 2)
  } catch {
    return "delegation-token-write-failed"
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_TOKEN_FILE_BYTES) return "delegation-token-limit"
  const tempPath = `${filePath}.${process.pid}.${nodeCrypto.randomUUID()}.tmp`
  try {
    fsSync.writeFileSync(tempPath, serialized, { encoding: "utf8", flag: "wx" })
    fsSync.renameSync(tempPath, filePath)
    return null
  } catch {
    try {
      fsSync.unlinkSync(tempPath)
    } catch {
      // Best-effort cleanup.
    }
    return "delegation-token-write-failed"
  }
}

export function readDelegationToken(workspace: string, change: string, token: string): DelegationTokenReadResult {
  const filePath = delegationTokenPath(workspace, change, token)
  if (!filePath) return { record: null, error: "delegation-token-invalid" }
  let raw: string
  try {
    const stat = fsSync.statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_TOKEN_FILE_BYTES) return { record: null, error: "delegation-token-malformed" }
    raw = fsSync.readFileSync(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { record: null, error: "delegation-token-unknown" }
    return { record: null, error: "delegation-token-read-failed" }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { record: null, error: "delegation-token-malformed" }
  }
  if (!isDelegationTokenRecord(parsed)) return { record: null, error: "delegation-token-malformed" }
  if (parsed.token !== token || parsed.change !== change) return { record: null, error: "delegation-token-mismatch" }
  return { record: parsed, error: null }
}

/** Mark a prepared token as sealed (or return an error code). */
export function markDelegationTokenSealed(
  workspace: string,
  record: DelegationTokenRecord,
  now: Date = new Date(),
): string | null {
  if (record.status !== "prepared") return "delegation-token-already-sealed"
  const sealed: DelegationTokenRecord = {
    ...record,
    status: "sealed",
    sealed_at: (Number.isFinite(now.getTime()) ? now : new Date()).toISOString(),
  }
  return writeDelegationToken(workspace, sealed)
}

/** Remove a consumed token file. Best-effort: a missing file is success. */
export function deleteDelegationToken(workspace: string, change: string, token: string): void {
  const filePath = delegationTokenPath(workspace, change, token)
  if (!filePath) return
  try {
    fsSync.unlinkSync(filePath)
  } catch {
    // Best-effort cleanup.
  }
}
