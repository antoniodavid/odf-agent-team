import * as fsSync from "node:fs"
import * as path from "node:path"
import { getMetricsDir, type TelemetrySpanKind } from "./odf-delegation-metrics.js"
import type { ParallelJoinArtifact } from "./odf-parallel-join.js"
import type { WorkflowStatus } from "./odf-workflow-status.js"

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const DAILY_FILE_PATTERN = /^delegations-(\d{4}-\d{2}-\d{2})\.jsonl$/
const MAX_TELEMETRY_DAYS = 7
const MAX_TELEMETRY_FILE_BYTES = 256 * 1024
const MAX_TELEMETRY_LINES = 5_000
const MAX_EVENTS = 1_000
const MAX_ACTIVE_ITEMS = 100
const MAX_WARNINGS = 32
// ponytail: fixed seven-day, bounded reads keep status cheap without inventing stale semantics.

export type ObservabilityDataStatus = "complete" | "partial" | "no_data"
export type ObservabilitySource = "telemetry" | "attempt-ledger" | "parallel-join" | "receipt"

export interface ObservabilityEvent {
  source: ObservabilitySource
  timestamp: string | null
  kind: "delegation" | "attempt" | "join" | "receipt"
  lifecycle?: "started" | "finished"
  phase?: string
  stage?: string
  agent?: string
  branch_id?: string
  attempt_id?: string
  run_id?: string
  status?: string
  reason?: string
}

export interface ObservabilityAttemptRecord {
  attempt_id: string
  branch_id?: string
  change: string
  phase: "IMPLEMENT" | "VERIFY"
  next_stage: "BUILD" | "VERIFY"
  status: "running" | "completed" | "failed"
  started_at: string
  updated_at: string
  settled_at: string | null
  reason: string
  result_status: string
}

export interface ObservabilityAttemptSummary {
  attempt_id: string
  branch_id?: string
  phase: "IMPLEMENT" | "VERIFY"
  stage: "BUILD" | "VERIFY"
  status: "running"
  started_at: string | null
  updated_at: string | null
}

export interface TelemetryRecord {
  timestamp: string
  event: "run" | "span"
  lifecycle: "started" | "finished"
  span_kind?: TelemetrySpanKind
  run_id?: string
  change: string
  trace_id?: string
  span_id?: string
  parent_span_id?: string
  phase?: string
  agent?: string
  branch_id?: string
  attempt_id?: string
  status?: string
  error?: string
}

export interface TelemetryReadResult {
  records: TelemetryRecord[]
  warnings: string[]
  files_read: number
  records_read: number
}

export interface ObservabilityTimeline {
  schema_version: 1
  data_status: ObservabilityDataStatus
  change: string
  events: ObservabilityEvent[]
  active_run_ids: string[]
  active_attempts: ObservabilityAttemptSummary[]
  parallel_join: {
    status: ParallelJoinArtifact["join"]["status"]
    expected: number
    completed: number
    failed: number
    running: number
    validation_verified: boolean
    timestamp: string
  } | null
  warnings: string[]
  source_coverage: {
    telemetry: { status: ObservabilityDataStatus; files_read: number; records_read: number; window_days: number }
    "attempt-ledger": { status: ObservabilityDataStatus; records_read: number }
    "parallel-join": { status: ObservabilityDataStatus; branches: number; timestamp: string | null }
    receipt: { status: ObservabilityDataStatus; state: WorkflowStatus["receipt"]["state"] }
    workflow: { status: ObservabilityDataStatus; warnings: number }
  }
}

interface InternalEvent {
  event: ObservabilityEvent
  sourceOrder: number
  index: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeToken(value: unknown): string | null {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value) ? value : null
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 || /[\r\n\0]/.test(value)) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function safeReason(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined
  const safe = value
    .replace(/\/home\/[^/\s,"']+(?:\/[^\s,"']*)?/g, "[path]")
    .replace(/\/Users\/[^/\s,"']+(?:\/[^\s,"']*)?/g, "[path]")
    .replace(/\b[A-Z][A-Z0-9_]{2,}=[^\s,"']{1,64}\b/g, "[env]")
    .replace(/(?:openspec|\.odf|odf)[/\\][^\s,"']+/gi, "[ref]")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, "'")
    .trim()
  if (!safe) return undefined
  return safe.length > 200 ? `${safe.slice(0, 197)}...` : safe
}

function safeLabel(value: unknown): string | undefined {
  return safeToken(value) || undefined
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning)
}

function warningList(values: string[]): string[] {
  const result: string[] = []
  for (const value of values) {
    const safe = safeReason(value)
    if (safe) addWarning(result, safe)
  }
  if (result.length > MAX_WARNINGS) {
    result.splice(MAX_WARNINGS - 1)
    result.push("observability-warning-limit")
  }
  return result
}

function dateWindow(): { cutoff: string; today: string } {
  const today = new Date().toISOString().split("T")[0]
  const cutoffDate = new Date(`${today}T00:00:00.000Z`)
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - (MAX_TELEMETRY_DAYS - 1))
  return { cutoff: cutoffDate.toISOString().split("T")[0], today }
}

function isTelemetryRecord(value: unknown, change: string): value is Record<string, unknown> {
  const record = asRecord(value)
  return Boolean(record && record.change === change)
}

function normalizeTelemetryRecord(value: Record<string, unknown>, change: string): TelemetryRecord | null {
  const timestamp = safeTimestamp(value.timestamp)
  const event = value.event === "run" || value.event === "span" ? value.event : null
  const runId = safeToken(value.run_id)
  const lifecycle = value.lifecycle === "started" || value.lifecycle === "finished" ? value.lifecycle : null
  const spanKind = value.span_kind === "branch" || value.span_kind === "task" ? value.span_kind : null
  const traceId = safeToken(value.trace_id)
  const spanId = safeToken(value.span_id)
  const parentSpanId = safeToken(value.parent_span_id)
  if (value.schema_version !== 1 || !timestamp || !event || !lifecycle || safeToken(value.change) !== change) return null
  if (event === "run" && !runId) return null
  if (event === "span" && (!spanKind || !traceId || !spanId || !parentSpanId)) return null

  const status = safeToken(value.status)
  const phase = safeLabel(value.phase)
  const agent = safeLabel(value.agent)
  const branchId = safeToken(value.branch_id)
  const attemptId = safeToken(value.attempt_id)
  if (event === "span" && spanKind === "branch" && (!branchId || !attemptId)) return null
  const error = safeReason(value.error)
  return {
    timestamp,
    event,
    lifecycle,
    ...(event === "span" && spanKind ? { span_kind: spanKind } : {}),
    ...(runId ? { run_id: runId } : {}),
    change,
    ...(traceId ? { trace_id: traceId } : {}),
    ...(spanId ? { span_id: spanId } : {}),
    ...(parentSpanId ? { parent_span_id: parentSpanId } : {}),
    ...(phase ? { phase } : {}),
    ...(agent ? { agent } : {}),
    ...(branchId ? { branch_id: branchId } : {}),
    ...(attemptId ? { attempt_id: attemptId } : {}),
    ...(status ? { status } : {}),
    ...(error ? { error } : {}),
  }
}

/** Read only recent daily files; malformed rows never become timeline evidence. */
export function readTelemetry(change: string, metricsDir = getMetricsDir()): TelemetryReadResult {
  const result: TelemetryReadResult = { records: [], warnings: [], files_read: 0, records_read: 0 }
  let files: string[]
  try {
    files = fsSync.readdirSync(metricsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result
    addWarning(result.warnings, "telemetry-directory-unreadable")
    return result
  }

  const { cutoff, today } = dateWindow()
  const selected = files
    .map(file => ({ file, match: file.match(DAILY_FILE_PATTERN) }))
    .filter(({ match }) => Boolean(match && match[1] >= cutoff && match[1] <= today))
    .sort((a, b) => a.file.localeCompare(b.file))
    .slice(-MAX_TELEMETRY_DAYS)

  for (const { file } of selected) {
    const filePath = path.join(metricsDir, file)
    let stat: fsSync.Stats
    try {
      stat = fsSync.statSync(filePath)
    } catch {
      addWarning(result.warnings, "telemetry-file-unreadable")
      continue
    }
    if (!stat.isFile() || stat.size > MAX_TELEMETRY_FILE_BYTES) {
      addWarning(result.warnings, "telemetry-file-limit")
      continue
    }

    let content: string
    try {
      content = fsSync.readFileSync(filePath, "utf8")
    } catch {
      addWarning(result.warnings, "telemetry-file-unreadable")
      continue
    }
    result.files_read++
    const lines = content.split(/\r?\n/).filter(Boolean)
    if (lines.length > MAX_TELEMETRY_LINES) {
      addWarning(result.warnings, "telemetry-file-line-limit")
      lines.splice(MAX_TELEMETRY_LINES)
    }
    for (const line of lines) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        addWarning(result.warnings, "telemetry-malformed-record")
        continue
      }
      if (!isTelemetryRecord(parsed, change)) continue
      result.records_read++
      const normalized = normalizeTelemetryRecord(parsed, change)
      if (!normalized) {
        addWarning(result.warnings, "telemetry-invalid-lifecycle-record")
        continue
      }
      result.records.push(normalized)
    }
  }
  return result
}

function compareAttemptRecords(a: ObservabilityAttemptRecord, b: ObservabilityAttemptRecord): number {
  const aTime = Date.parse(a.updated_at)
  const bTime = Date.parse(b.updated_at)
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime
  if (a.updated_at !== b.updated_at) return a.updated_at.localeCompare(b.updated_at)
  return 0
}

function latestAttempts(records: ReadonlyArray<ObservabilityAttemptRecord>, change: string, warnings: string[]): Map<string, ObservabilityAttemptRecord> {
  const latest = new Map<string, ObservabilityAttemptRecord>()
  records.forEach(record => {
    if (record.change !== change) {
      addWarning(warnings, "attempt-ledger-change-mismatch")
      return
    }
    const previous = latest.get(record.attempt_id)
    if (!previous || compareAttemptRecords(previous, record) <= 0) latest.set(record.attempt_id, record)
    if (!Number.isFinite(Date.parse(record.updated_at))) addWarning(warnings, "attempt-ledger-timestamp-invalid")
  })
  return latest
}

function addEvent(events: InternalEvent[], event: ObservabilityEvent, sourceOrder: number, index: number): void {
  events.push({ event, sourceOrder, index })
}

function eventTimestamp(event: ObservabilityEvent): number {
  return event.timestamp ? Date.parse(event.timestamp) : Number.POSITIVE_INFINITY
}

function eventIdentity(event: ObservabilityEvent): string {
  return [event.kind, event.run_id, event.attempt_id, event.branch_id, event.status, event.reason].join("|")
}

export interface BuildObservabilityInput {
  change: string
  workflow: WorkflowStatus
  telemetry: TelemetryReadResult
  attempts: ReadonlyArray<ObservabilityAttemptRecord>
  attempt_error?: string
  parallel_join?: ParallelJoinArtifact | null
  parallel_join_warning?: string | null
}

export function buildObservabilityTimeline(input: BuildObservabilityInput): ObservabilityTimeline {
  const change = safeToken(input.change) || "invalid-change"
  const warnings = [...input.telemetry.warnings]
  if (input.attempt_error) addWarning(warnings, input.attempt_error)
  if (input.parallel_join_warning) addWarning(warnings, input.parallel_join_warning)
  const events: InternalEvent[] = []
  const runStates = new Map<string, { started: boolean; finished: boolean }>()

  for (const [index, record] of input.telemetry.records.entries()) {
    if (record.event !== "run" || !record.run_id) continue
    const state = runStates.get(record.run_id) || { started: false, finished: false }
    state[record.lifecycle] = true
    runStates.set(record.run_id, state)
    addEvent(events, {
      source: "telemetry",
      timestamp: record.timestamp,
      kind: "delegation",
      lifecycle: record.lifecycle,
      ...(record.phase ? { phase: record.phase } : {}),
      ...(record.agent ? { agent: record.agent } : {}),
      ...(record.branch_id ? { branch_id: record.branch_id } : {}),
      ...(record.attempt_id ? { attempt_id: record.attempt_id } : {}),
      run_id: record.run_id,
      ...(record.status ? { status: record.status } : {}),
      ...(record.error ? { reason: record.error } : {}),
    }, 0, index)
  }

  const activeRunIds = [...runStates.entries()]
    .filter(([, state]) => state.started && !state.finished)
    .map(([runId]) => runId)
    .sort()
  for (const [runId, state] of runStates) {
    if (state.finished && !state.started) addWarning(warnings, "telemetry-finished-without-start")
  }
  if (activeRunIds.length) addWarning(warnings, "telemetry-unfinished-runs")

  const latest = latestAttempts(input.attempts, change, warnings)
  for (const [index, record] of input.attempts.entries()) {
    if (record.change !== change) continue
    addEvent(events, {
      source: "attempt-ledger",
      timestamp: safeTimestamp(record.updated_at),
      kind: "attempt",
      phase: record.phase,
      stage: record.next_stage,
      attempt_id: record.attempt_id,
      ...(record.branch_id ? { branch_id: record.branch_id } : {}),
      status: record.status,
      ...(safeReason(record.reason) ? { reason: safeReason(record.reason) } : {}),
    }, 1, index)
  }

  const activeAttempts = [...latest.values()]
    .filter(record => record.change === input.change && record.status === "running")
    .sort((a, b) => a.attempt_id.localeCompare(b.attempt_id))
    .slice(0, MAX_ACTIVE_ITEMS)
    .map(record => ({
      attempt_id: record.attempt_id,
      ...(record.branch_id ? { branch_id: record.branch_id } : {}),
      phase: record.phase,
      stage: record.next_stage,
      status: "running" as const,
      started_at: safeTimestamp(record.started_at),
      updated_at: safeTimestamp(record.updated_at),
    }))
  if ([...latest.values()].filter(record => record.status === "running").length > MAX_ACTIVE_ITEMS) {
    addWarning(warnings, "active-attempt-limit")
  }
  if (activeAttempts.length) addWarning(warnings, "active-attempts")

  let parallelJoin: ObservabilityTimeline["parallel_join"] = null
  if (input.parallel_join) {
    const join = input.parallel_join.join
    const timestamp = safeTimestamp(input.parallel_join.timestamp)
    parallelJoin = {
      status: join.status,
      expected: join.expected,
      completed: join.completed,
      failed: join.failed,
      running: join.running,
      validation_verified: join.validation_verified,
      timestamp: timestamp || "",
    }
    addEvent(events, {
      source: "parallel-join",
      timestamp,
      kind: "join",
      phase: "IMPLEMENT",
      stage: "BUILD",
      status: join.status,
      reason: `${join.completed}/${join.expected} branches complete; ${join.failed} failed; validation ${join.validation_verified ? "verified" : "pending"}`,
    }, 2, 0)
    if (join.status !== "complete") addWarning(warnings, `parallel-join-${join.status}`)
    if (!timestamp) addWarning(warnings, "parallel-join-timestamp-invalid")
  }

  const receipt = input.workflow.receipt
  if (receipt.state !== "none") {
    const receiptStatus = safeToken(receipt.status) || receipt.state
    addEvent(events, {
      source: "receipt",
      timestamp: null,
      kind: "receipt",
      ...(input.workflow.legacy_phase ? { phase: input.workflow.legacy_phase } : {}),
      stage: input.workflow.canonical_stage,
      status: receiptStatus,
      ...(receipt.action ? { reason: receipt.action } : {}),
    }, 3, 0)
    if (receipt.state === "pending") addWarning(warnings, "receipt-pending")
  }

  for (const warning of input.workflow.warnings) addWarning(warnings, warning)
  if (activeRunIds.length > MAX_ACTIVE_ITEMS) {
    activeRunIds.splice(MAX_ACTIVE_ITEMS)
    addWarning(warnings, "active-run-limit")
  }
  if (runStates.size > 0 && [...runStates.values()].some(state => state.finished && !state.started)) {
    addWarning(warnings, "telemetry-incomplete-lifecycle")
  }

  events.sort((a, b) => eventTimestamp(a.event) - eventTimestamp(b.event) ||
    a.sourceOrder - b.sourceOrder || a.index - b.index || eventIdentity(a.event).localeCompare(eventIdentity(b.event)))
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS)
    addWarning(warnings, "observability-event-limit")
  }

  const hasRuntimeEvidence = input.telemetry.records.length > 0 ||
    input.attempts.some(record => record.change === change) ||
    input.parallel_join !== null && input.parallel_join !== undefined
  if (receipt.state !== "none" && !hasRuntimeEvidence) addWarning(warnings, "runtime-evidence-missing")

  const sourceWarnings = warningList(warnings)
  const telemetryStatus: ObservabilityDataStatus = input.telemetry.warnings.length
    ? "partial"
    : input.telemetry.records.length ? "complete" : "no_data"
  const attemptStatus: ObservabilityDataStatus = input.attempt_error
    ? "partial"
    : input.attempts.some(record => record.change === change) ? "complete" : "no_data"
  const joinStatus: ObservabilityDataStatus = input.parallel_join_warning
    ? "partial"
    : input.parallel_join ? "complete" : "no_data"
  const receiptStatus: ObservabilityDataStatus = receipt.state === "none" ? "no_data" : "complete"
  const workflowStatus: ObservabilityDataStatus = input.workflow.warnings.length ? "partial" : "complete"
  const hasEvidence = events.length > 0 || input.telemetry.records.length > 0

  return {
    schema_version: 1,
    data_status: sourceWarnings.length ? "partial" : hasEvidence ? "complete" : "no_data",
    change,
    events: events.map(item => item.event),
    active_run_ids: activeRunIds,
    active_attempts: activeAttempts,
    parallel_join: parallelJoin,
    warnings: sourceWarnings,
    source_coverage: {
      telemetry: {
        status: telemetryStatus,
        files_read: input.telemetry.files_read,
        records_read: input.telemetry.records_read,
        window_days: MAX_TELEMETRY_DAYS,
      },
      "attempt-ledger": { status: attemptStatus, records_read: input.attempts.filter(record => record.change === change).length },
      "parallel-join": {
        status: joinStatus,
        branches: input.parallel_join?.branches.length || 0,
        timestamp: input.parallel_join ? safeTimestamp(input.parallel_join.timestamp) : null,
      },
      receipt: { status: receiptStatus, state: receipt.state },
      workflow: { status: workflowStatus, warnings: input.workflow.warnings.length },
    },
  }
}
