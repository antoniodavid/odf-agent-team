import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { CHANGE_NAME_PATTERN, canonicalWorkspaceRoot, isWithinRoot } from "./odf-delegation-shared.js"
import { DELEGATION_TOKEN_PATTERN } from "./odf-delegation-tokens.js"

export const LATE_SEAL_CAPABILITY_TTL_MS = 10 * 60 * 1000
export const LATE_SEAL_CAPABILITY_PATTERN = /^odf-late-[a-f0-9]{64}$/
const ATTEMPT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const MAX_CAPABILITY_FILE_BYTES = 4 * 1024

export interface LateSealCapabilityBinding {
  change: string
  token: string
  attempt_id: string
  parent_session_id: string
  child_session_id: string
}

interface LateSealCapabilityRecord {
  schema_version: 1
  change: string
  token_digest: string
  attempt_id: string
  parent_session_digest: string
  child_session_digest: string
  capability_digest: string
  integrity_digest: string
  created_at: string
  expires_at: string
}

export interface LateSealCapabilityRead {
  valid: boolean
  reason: string | null
  expires_at: string | null
}

function safeSessionId(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value)
}

function digest(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex")
}

function safeDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function equalDigest(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, "hex")
  const right = Buffer.from(expected, "hex")
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function integrityDigest(record: Omit<LateSealCapabilityRecord, "integrity_digest">, capability: string): string {
  return digest(JSON.stringify([
    capability,
    record.schema_version,
    record.change,
    record.token_digest,
    record.attempt_id,
    record.parent_session_digest,
    record.child_session_digest,
    record.capability_digest,
    record.created_at,
    record.expires_at,
  ]))
}

function bindingIsValid(binding: LateSealCapabilityBinding): boolean {
  return CHANGE_NAME_PATTERN.test(binding.change) && DELEGATION_TOKEN_PATTERN.test(binding.token) &&
    ATTEMPT_PATTERN.test(binding.attempt_id) && safeSessionId(binding.parent_session_id) && safeSessionId(binding.child_session_id)
}

function capabilityFilePath(workspace: string, change: string, token: string): string | null {
  if (!CHANGE_NAME_PATTERN.test(change) || !DELEGATION_TOKEN_PATTERN.test(token)) return null
  let root: string
  try {
    root = canonicalWorkspaceRoot(workspace)
  } catch {
    return null
  }
  const directory = path.join(root, ".odf")
  try {
    const info = fs.lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || !isWithinRoot(fs.realpathSync(directory), root)) return null
  } catch {
    return null
  }
  const filePath = path.join(directory, `late-seal-${change}-${token}.json`)
  return isWithinRoot(filePath, root) ? filePath : null
}

function readRecord(filePath: string): LateSealCapabilityRecord | null {
  try {
    const info = fs.lstatSync(filePath)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CAPABILITY_FILE_BYTES) return null
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (record.schema_version !== 1 || typeof record.change !== "string" || !CHANGE_NAME_PATTERN.test(record.change) ||
      !safeDigest(record.token_digest) || typeof record.attempt_id !== "string" || !ATTEMPT_PATTERN.test(record.attempt_id) ||
      !safeDigest(record.parent_session_digest) || !safeDigest(record.child_session_digest) ||
      !safeDigest(record.capability_digest) || !safeDigest(record.integrity_digest) ||
      typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at)) ||
      typeof record.expires_at !== "string" || !Number.isFinite(Date.parse(record.expires_at)) ||
      Date.parse(record.expires_at) <= Date.parse(record.created_at) ||
      Date.parse(record.expires_at) - Date.parse(record.created_at) > LATE_SEAL_CAPABILITY_TTL_MS) return null
    return record as unknown as LateSealCapabilityRecord
  } catch {
    return null
  }
}

function matches(record: LateSealCapabilityRecord, capability: string, binding: LateSealCapabilityBinding): boolean {
  return record.change === binding.change && record.attempt_id === binding.attempt_id &&
    equalDigest(record.token_digest, digest(binding.token)) &&
    equalDigest(record.parent_session_digest, digest(binding.parent_session_id)) &&
    equalDigest(record.child_session_digest, digest(binding.child_session_id)) &&
    equalDigest(record.capability_digest, digest(capability)) &&
    equalDigest(record.integrity_digest, integrityDigest(record, capability))
}

/** Create a distinct, short-lived capability; the original delegation token is untouched. */
export function createLateSealCapability(
  workspace: string,
  binding: LateSealCapabilityBinding,
  now = new Date(),
): { capability: string; expires_at: string } | { error: string } {
  if (!bindingIsValid(binding)) return { error: "late-seal-binding-invalid" }
  if (!Number.isFinite(now.getTime())) return { error: "late-seal-time-invalid" }
  const filePath = capabilityFilePath(workspace, binding.change, binding.token)
  if (!filePath) return { error: "late-seal-workspace-unavailable" }

  const capability = `odf-late-${crypto.randomBytes(32).toString("hex")}`
  const expiresAt = new Date(now.getTime() + LATE_SEAL_CAPABILITY_TTL_MS).toISOString()
  const unsignedRecord: Omit<LateSealCapabilityRecord, "integrity_digest"> = {
    schema_version: 1,
    change: binding.change,
    token_digest: digest(binding.token),
    attempt_id: binding.attempt_id,
    parent_session_digest: digest(binding.parent_session_id),
    child_session_digest: digest(binding.child_session_id),
    capability_digest: digest(capability),
    created_at: now.toISOString(),
    expires_at: expiresAt,
  }
  const record: LateSealCapabilityRecord = {
    ...unsignedRecord,
    integrity_digest: integrityDigest(unsignedRecord, capability),
  }
  const consumedPath = `${filePath}.consumed`
  const temporaryPath = `${filePath}.${crypto.randomBytes(8).toString("hex")}.tmp`
  try {
    let consumed: fs.Stats | null = null
    try { consumed = fs.lstatSync(consumedPath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    if (consumed) return { error: consumed.isSymbolicLink() || !consumed.isFile() ? "late-seal-state-unsafe" : "late-seal-capability-already-used" }

    let existing: LateSealCapabilityRecord | null = null
    try { existing = readRecord(filePath) } catch { existing = null }
    if (fs.existsSync(filePath) && !existing) return { error: "late-seal-state-unsafe" }
    if (existing && Date.parse(existing.expires_at) >= now.getTime()) return { error: "late-seal-capability-already-issued" }
    fs.writeFileSync(temporaryPath, JSON.stringify(record), { encoding: "utf8", flag: "wx", mode: 0o600 })
    fs.renameSync(temporaryPath, filePath)
    return { capability, expires_at: expiresAt }
  } catch {
    try { fs.unlinkSync(temporaryPath) } catch { /* best-effort temp cleanup */ }
    return { error: "late-seal-capability-write-failed" }
  }
}

/** Check a capability without consuming it. The seal still revalidates every ordinary gate. */
export function readLateSealCapability(
  workspace: string,
  capability: string,
  binding: LateSealCapabilityBinding,
  now = new Date(),
): LateSealCapabilityRead {
  if (!Number.isFinite(now.getTime())) return { valid: false, reason: "late-seal-time-invalid", expires_at: null }
  if (!LATE_SEAL_CAPABILITY_PATTERN.test(capability) || !bindingIsValid(binding)) {
    return { valid: false, reason: "late-seal-capability-invalid", expires_at: null }
  }
  const filePath = capabilityFilePath(workspace, binding.change, binding.token)
  if (!filePath) return { valid: false, reason: "late-seal-capability-unavailable", expires_at: null }
  const consumedPath = `${filePath}.consumed`
  try {
    const consumed = fs.lstatSync(consumedPath)
    if (consumed.isSymbolicLink() || !consumed.isFile()) return { valid: false, reason: "late-seal-state-unsafe", expires_at: null }
    return { valid: false, reason: "late-seal-capability-already-used", expires_at: null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { valid: false, reason: "late-seal-capability-unavailable", expires_at: null }
  }
  const record = readRecord(filePath)
  if (!record) return { valid: false, reason: "late-seal-capability-unavailable", expires_at: null }
  if (!matches(record, capability, binding)) return { valid: false, reason: "late-seal-capability-mismatch", expires_at: null }
  const expires = Date.parse(record.expires_at)
  if (now.getTime() >= expires) return { valid: false, reason: "late-seal-capability-expired", expires_at: record.expires_at }
  return { valid: true, reason: null, expires_at: record.expires_at }
}

/** Atomically consume the matching capability so concurrent/replayed seals cannot reuse it. */
export function consumeLateSealCapability(
  workspace: string,
  capability: string,
  binding: LateSealCapabilityBinding,
  now = new Date(),
): LateSealCapabilityRead {
  const read = readLateSealCapability(workspace, capability, binding, now)
  if (!read.valid) return read
  const filePath = capabilityFilePath(workspace, binding.change, binding.token)
  if (!filePath) return { valid: false, reason: "late-seal-capability-unavailable", expires_at: null }
  const consumedPath = `${filePath}.consumed`
  try {
    // Hard-link creation is exclusive: concurrent consumers cannot overwrite
    // the consumed marker and only one can obtain the capability.
    fs.linkSync(filePath, consumedPath)
    const consumed = readRecord(consumedPath)
    if (!consumed || !matches(consumed, capability, binding)) {
      fs.unlinkSync(consumedPath)
      return { valid: false, reason: "late-seal-capability-mismatch", expires_at: null }
    }
    fs.unlinkSync(filePath)
    return read
  } catch {
    return { valid: false, reason: "late-seal-capability-already-used", expires_at: read.expires_at }
  }
}
