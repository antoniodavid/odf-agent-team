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

const MAX_TOKEN_FILE_BYTES = 16 * 1024
const MAX_CONTEXT_FILES = 64
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const PROMPT_DIGEST_PATTERN = /^[a-f0-9]{64}$/

export const DELEGATION_PHASES = ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY", "EXPLORE", "FIX"] as const
export type DelegationPhase = (typeof DELEGATION_PHASES)[number]
export type DelegationTokenStatus = "prepared" | "sealed"
export type DelegationArtifactStore = "openspec" | "engram" | "hybrid"

export interface DelegationTokenInput {
  change: string
  phase: DelegationPhase
  agent: string
  /** Workspace root the delegation belongs to; canonicalized before storage. */
  workspace: string
  /** Enriched prompt the orchestrator must pass to the host subagent tool verbatim. */
  prompt: string
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
  context_files: string[]
  attempt_id?: string
  branch_id?: string
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
    token: newDelegationToken(),
    change,
    phase,
    agent,
    ...(input.artifact_store ? { artifact_store: input.artifact_store } : {}),
    workspace,
    prompt_digest: delegationPromptDigest(input.prompt),
    context_files: contextFiles,
    ...(input.attempt_id ? { attempt_id: input.attempt_id } : {}),
    ...(input.branch_id ? { branch_id: input.branch_id } : {}),
    created_at: created.toISOString(),
    expires_at: expires.toISOString(),
    status: "prepared",
  }
}

function isDelegationTokenRecord(value: unknown): value is DelegationTokenRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.schema_version === DELEGATION_TOKEN_SCHEMA_VERSION &&
    typeof record.token === "string" && DELEGATION_TOKEN_PATTERN.test(record.token) &&
    typeof record.change === "string" && CHANGE_NAME_PATTERN.test(record.change) &&
    typeof record.phase === "string" && (DELEGATION_PHASES as readonly string[]).includes(record.phase) &&
    safeLabel(record.agent) !== null &&
    (record.artifact_store === undefined || ["openspec", "engram", "hybrid"].includes(record.artifact_store as string)) &&
    typeof record.workspace === "string" && record.workspace.length > 0 &&
    typeof record.prompt_digest === "string" && PROMPT_DIGEST_PATTERN.test(record.prompt_digest) &&
    Array.isArray(record.context_files) && record.context_files.every(file => typeof file === "string") &&
    safeTimestamp(record.created_at) !== null &&
    safeTimestamp(record.expires_at) !== null &&
    (record.status === "prepared" || record.status === "sealed") &&
    (record.sealed_at === undefined || safeTimestamp(record.sealed_at) !== null)
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
