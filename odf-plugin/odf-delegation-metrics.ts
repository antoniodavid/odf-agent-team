/**
 * Delegation metrics (F1 observability): telemetry records flushed to the
 * JSONL log under the ODF config dir. Extracted from plugins/odf-delegation.ts.
 */

import * as fsSync from "node:fs"
import * as nodeCrypto from "node:crypto"
import * as path from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { getOdfConfigDir } from "./odf-delegation-shared.js"
import { WORK_TYPES, type WorkType } from "./odf-workflow.js"

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

export type DelegationMetricInput = Omit<DelegationMetrics, "session_hash"> & {
  session_id: string
  error?: string
}

export let metricsBuffer: DelegationMetrics[] = []
export const METRICS_FLUSH_INTERVAL = 30_000 // flush every 30s
export let metricsTimer: ReturnType<typeof setInterval> | null = null

export function getMetricsBufferCap(): number {
  const parsed = parseInt(process.env.ODF_METRICS_BUFFER_CAP || "1000", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000
}

export function getMetricsDir(): string {
  return path.join(getOdfConfigDir(), "metrics")
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function hashSession(sessionId: string): string {
  return nodeCrypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 8)
}

export function sanitizeError(error?: string): string | undefined {
  if (!error) return undefined
  const safe = scrubMetricSecrets(error).replace(/\r?\n/g, " ").replace(/"/g, "'").trim()
  return safe.length > 200 ? safe.slice(0, 200) + "..." : safe
}

export const METRIC_SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
export const METRIC_MAX_JOIN_COUNT = 3

export function sanitizeMetricToken(value: unknown): string | undefined {
  return typeof value === "string" && METRIC_SAFE_TOKEN_PATTERN.test(value) ? value : undefined
}

export function sanitizeMetricWorkType(value: unknown): WorkType | undefined {
  return typeof value === "string" && WORK_TYPES.includes(value as WorkType) ? value as WorkType : undefined
}

export function sanitizeMetricJoinStatus(value: unknown): DelegationMetrics["join_status"] {
  return value === "running" || value === "complete" || value === "blocked" ? value : undefined
}

export function sanitizeMetricJoinCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= METRIC_MAX_JOIN_COUNT
    ? value
    : undefined
}

export function sanitizeMetricValidationRatio(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}

export const METRIC_TASK_MAX = 120

/**
 * Scrub PII/secret-bearing substrings from a free-text value before it is
 * persisted: absolute home paths (`/home/<user>/...`), and env-like
 * `NAME=VALUE` assignments (which commonly carry secrets). Applied to the
 * error and task labels so prompts, user paths and env values never leak into
 * the JSONL.
 */
export function scrubMetricSecrets(value: string): string {
  return value
    .replace(/\/home\/[^/\s,"']+(?:\/[^\s,"']*)?/g, "[home]")
    .replace(/\/Users\/[^/\s,"']+(?:\/[^\s,"']*)?/g, "[home]")
    .replace(/\b[A-Z][A-Z0-9_]{2,}=[^\s,"']{1,64}\b/g, "[env]")
}

export function sanitizeMetricTask(prompt?: string): string | undefined {
  if (!prompt || typeof prompt !== "string") return undefined
  const firstLine = prompt.split(/\r?\n/).map(l => l.trim()).find(Boolean)
  if (!firstLine) return undefined
  const safe = scrubMetricSecrets(firstLine).replace(/"/g, "'").slice(0, METRIC_TASK_MAX)
  return safe.length > 0 ? safe : undefined
}

export function sanitizeMetricTokenCount(value: unknown): number | null | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Token counts are always honest: host-provided counts are used verbatim;
 * otherwise input/output stay null and only `estimated` (the len/4 heuristic)
 * is recorded. The estimate is never surfaced as a real token count.
 */
export function sanitizeMetricTokens(
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

export function sanitizeMetricBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export function sanitizeMetricRetryCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

export const METRIC_MODEL_MAX = 80
export const METRIC_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9./:_-]{0,79}$/

/** Model/provider/version identifiers are bounded and shape-checked. */
export function sanitizeMetricModel(value: unknown): string | null | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().slice(0, METRIC_MODEL_MAX)
  return METRIC_MODEL_PATTERN.test(trimmed) ? trimmed : null
}

/**
 * A span id derived from the session hash + phase + monotonic sequence, so a
 * delegation and its sub-steps are correlated without storing the raw session.
 */
export let telemetrySpanCounter = 0
export function nextTelemetrySpanId(sessionId: string, phase: string): string {
  telemetrySpanCounter = (telemetrySpanCounter + 1) % 0xffff
  return `${hashSession(sessionId)}-${phase.slice(0, 8).replace(/[^A-Za-z0-9]/g, "") || "x"}-${telemetrySpanCounter.toString(16)}`
}

export function sanitizeMetricSafeToken(value: unknown): string | undefined {
  return typeof value === "string" && METRIC_SAFE_TOKEN_PATTERN.test(value) ? value : undefined
}

/** Long candidate digests / receipt refs are bounded to safe tokens. */
export function sanitizeMetricDigest(value: unknown): string | undefined {
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
export function flushMetricsSync(): void {
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

export function startMetricsFlusher(): void {
  if (metricsTimer) return
  metricsTimer = setInterval(() => {
    flushMetricsSync()
  }, METRICS_FLUSH_INTERVAL)
}

export function recordMetrics(metric: DelegationMetricInput): void {
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
