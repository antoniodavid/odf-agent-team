/**
 * odf-delegation
 * Odoo Development Framework delegation plugin for OpenCode
 *
 * Extends OpenCode with ODF-specific delegation tools:
 * - odf_delegate: Delegate to phase-specific agents with skill injection
 * - odf_health: Read-only installed/runtime health inspection
 * - odf_skill_inject: Read registry and inject compact rules
 * - odf_registry_read: Query the ODF skill registry
 *
 * Based on background-agents from gentle-ai (MIT License)
 */

import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import type { Dirent } from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import * as nodeCrypto from "node:crypto"
import { type Hooks, type Plugin, type ToolContext, tool } from "@opencode-ai/plugin"
import { execFileSync, execSync } from "node:child_process"
import { filterStopWords, resolveAgent, validateAgentSelection } from "../scripts/lib/agent-resolve.js"
import {
  canonicalChangeName,
  canonicalWorkspaceRoot,
  CHANGE_NAME_PATTERN,
  debugLog,
  getOdfConfigDir,
  type ODFEntryAuthorizations,
  type ODFEntryGenerations,
  isWithinRoot,
  type OpencodeClient,
  ODF_REGISTERED_TOOLS,
  resolvePath,
  resolveWorkspaceRoot,
  workspaceProjectName,
  type ODFAgent,
  type ODFCommunityTool,
  type ODFRegistry,
  type ODFSkill,
} from "../odf-plugin/odf-delegation-shared.js"
import {
  REGISTRY_PATH,
  computePermissionsFingerprint,
  hasSkillsChanged,
  loadRegistry,
  loadRegistryCache,
  resetRegistryCache,
  saveRegistryCache,
  type RegistryCache,
} from "../odf-plugin/odf-registry-io.js"
import {
  createODFSkillInject,
  createODFSkillResolve,
  detectOdooVersion,
  formatCompactRules,
  formatProfileBlock,
  getProfileByPhase,
  matchSkills,
} from "../odf-plugin/odf-skills.js"
import {
  createODFCommunityToolDetect,
  createODFCommunityToolInstall,
} from "../odf-plugin/odf-community-tools.js"
import {
  type DelegationMetrics,
  flushMetricsSync,
  getMetricsBufferCap,
  estimateTokens,
  createTelemetryRunId,
  createTelemetrySpanId,
  createTelemetryTraceId,
  getMetricsDir,
  metricsBuffer,
  recordMetrics,
  resolveFlowStage,
  startMetricsFlusher,
  type DelegationMetricInput,
  type TelemetryFlowStage,
} from "../odf-plugin/odf-delegation-metrics.js"
import {
  EXECUTOR_BOUNDARY,
  defaultHealthIo,
  findTaskApi,
  hostTelemetryFromContext,
  isCancellation,
  isCancellationMessage,
  isEmptyTaskResult,
  inspectODFHealth,
  type HealthIo,
  type TaskApi,
  createODFHealth,
} from "../odf-plugin/odf-delegation-health.js"
import {
  classifyRiskTier,
  classifyRiskTierWithContent,
  computePolicyGate,
  gitHead,
  readPersistedExternalValidationSubjects,
  savePolicyGateJson,
  type PolicyGateDecision,
} from "../odf-plugin/odf-delegation-policy.js"
import {
  captureExternalValidationSubjectManifest,
  normalizeExternalValidationSubjectManifest,
  type ExternalValidationSubjectManifestEntry,
} from "../odf-plugin/candidate-manifest.js"
import {
  canonicalLoopGuardValue,
  CONTEXT_PRESSURE_DEFAULT_TOKENS,
  contextPressureNotice,
  contextPressureThreshold,
  createStableDiscoveryGuard,
  type LoopGuardHooks,
} from "../odf-plugin/odf-delegation-loopguard.js"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { isMap, parseDocument, stringify } from "yaml"
import {
  advanceWorkflow,
  resolveWorkflowRoute,
  WORK_TYPES,
  type CanonicalStage,
  type WorkType,
  type WorkflowAdvanceInput,
  type WorkflowPhaseResultStatus,
  type WorkflowValidationStatus,
  type WorkflowReceiptState,
  type WorkflowTarget,
  type WorkflowRoute,
} from "../odf-plugin/odf-workflow.js"
import {
  deriveWorkflowStatus,
  normalizeArtifactKey,
  parseWorkflowState,
  type WorkflowReceipt,
  type WorkflowStage,
  type WorkflowStatus,
} from "../odf-plugin/odf-workflow-status.js"
import {
  parallelJoinArtifactRef,
  readParallelJoinArtifact,
  writeParallelJoinArtifact,
  type ParallelJoinArtifact,
} from "../odf-plugin/odf-parallel-join.js"
import {
  candidateDigestOrNull,
  createODFReceipt,
  mergeReceipt,
  saveReceiptJson,
  type ODFReceipt,
} from "../odf-plugin/odf-delegation-receipts.js"

// Kept exported for the plugin public surface and unit tests.
export { createODFReceipt, mergeReceipt, saveReceiptJson }
export type { ODFReceipt }
import {
  createODFEntryTriage as createEntryTriageTool,
  validateEntryRouteBinding,
  type EntryRouteBinding,
} from "../odf-plugin/entry-triage.js"
import { createODFContextManifest } from "../odf-plugin/odf-context-manifest.js"
import { validateExpectations, validDate, type ExpectationsConnection, type ExpectationsEntry } from "../odf-plugin/odf-expectations.js"
import { sanitizeChangeName, validatePreflight, type PreflightRecord } from "../scripts/lib/preflight.js"
import { inspectToolArgs } from "../scripts/odf-safety.js"
import {
  buildObservabilityTimeline,
  readTelemetry,
  type ObservabilityTimeline,
} from "../odf-plugin/odf-observability.js"
import {
  establishSourceAuthorityRoots,
  isViewAuthorityWork,
  replaceSourceAuthority,
  scrubSourceAuthority,
  validateSourceAuthority,
  type SourceAuthorityRoots,
} from "../odf-plugin/odf-source-authority.js"
import {
  createODFGovernanceCheck,
  createODFGovernanceProvenance,
  inspectOcaGovernance,
  ocaGovernanceFailure,
  type GovernanceCheckResult,
} from "../odf-plugin/odf-governance.js"

/** Keep the reference-only ICE envelope scoped to the entry-triage tool. */
export function createODFEntryTriage(): ReturnType<typeof createEntryTriageTool> {
  return createEntryTriageTool()
}

// ==========================================
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

// ==========================================
// AGENT RESOLUTION
// ==========================================
// AGENT RESOLUTION
// ==========================================

// STOP_WORDS / filterStopWords / resolveAgent live in
// scripts/lib/agent-resolve.js (single source of truth shared with the
// test runner and the toolkit).

// ==========================================
// TASK INVOCATION
// ==========================================



/** Coerce a boolean-ish inner-result field: true, "true" (any case) → true; anything else → false. */
function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return value.trim().toLowerCase() === "true"
  return false
}



function innerPhaseResultStatus(result: unknown): WorkflowPhaseResultStatus | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null
  const status = (result as { status?: unknown }).status
  return status === "ok" || status === "warning" || status === "blocked" || status === "failed" ? status : null
}

interface InnerResultDisposition {
  resultStatus: WorkflowPhaseResultStatus | null
  metricStatus: DelegationMetrics["status"]
  accepted: boolean
  failureReceiptStatus: ODFReceipt["status"]
  failureReason: "task-error" | null
  failureResultStatus: Exclude<AttemptLedgerResultStatus, "running"> | null
  message: string
}

function innerResultDisposition(result: unknown): InnerResultDisposition {
  const resultStatus = innerPhaseResultStatus(result)
  if (resultStatus === "ok" || resultStatus === "warning") {
    return {
      resultStatus,
      metricStatus: "ok",
      accepted: true,
      failureReceiptStatus: "failed",
      failureReason: null,
      failureResultStatus: null,
      message: "The inner phase result completed successfully.",
    }
  }

  if (resultStatus === "blocked") {
    return {
      resultStatus,
      metricStatus: "blocked",
      accepted: false,
      failureReceiptStatus: "blocked",
      failureReason: "task-error",
      failureResultStatus: "error",
      message: "The inner phase result is blocked.",
    }
  }

  return {
    resultStatus,
    metricStatus: "error",
    accepted: false,
    failureReceiptStatus: "failed",
    failureReason: "task-error",
    failureResultStatus: "error",
    message: resultStatus === "failed"
      ? "The inner phase result failed."
      : "The inner phase result is missing or has an invalid status.",
  }
}


async function invokeTask(
  taskApi: TaskApi,
  agentName: string,
  prompt: string,
  contextFiles?: string[],
  timeoutMs = 600_000,
  abortSignal?: AbortSignal,
): Promise<{ status: string; result: unknown }> {
  const taskPromise = taskApi({ agent: agentName, prompt, context_files: contextFiles })
  let timedOut = false
  let cancelled = false
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let removeAbortListener: (() => void) | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      reject(new Error(`task() timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  const cancellationPromise = abortSignal
    ? new Promise<never>((_, reject) => {
      const onAbort = (): void => {
        cancelled = true
        reject(new Error("task-cancelled: delegation was cancelled"))
      }
      if (abortSignal.aborted) onAbort()
      else {
        abortSignal.addEventListener("abort", onAbort, { once: true })
        removeAbortListener = () => abortSignal.removeEventListener("abort", onAbort)
      }
    })
    : null
  try {
    const result = await Promise.race([...(cancellationPromise ? [cancellationPromise] : []), taskPromise, timeoutPromise])
    if (isCancellation(result)) throw new Error("task-cancelled: task() was cancelled")
    if (isEmptyTaskResult(result)) throw new Error("empty-task-result: task() returned no usable result")
    return { status: "delegated", result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (timedOut || cancelled || isCancellationMessage(message)) {
      try {
        await taskApi.abort?.(taskPromise)
      } catch {
        // Preserve the original timeout/cancellation result if abort also fails.
      }
    }
    throw error
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    removeAbortListener?.()
  }
}

function validateContextFiles(workspaceRoot: string, contextFiles: string[]): { error: string | null; paths: string[]; relativePaths: string[] } {
  const paths: string[] = []
  const relativePaths: string[] = []
  for (const file of contextFiles) {
    if (typeof file !== "string" || file.split(/[\\/]/).includes("..")) {
      return { error: `❌ context_files entry "${file}" contains path traversal`, paths: [], relativePaths: [] }
    }
    const resolvedFile = path.resolve(workspaceRoot, file)
    if (!isWithinRoot(resolvedFile, workspaceRoot)) {
      return { error: `❌ context_files entry "${file}" escapes workspace root`, paths: [], relativePaths: [] }
    }
    let comparablePath = path.normalize(resolvedFile)
    if (fsSync.existsSync(resolvedFile)) {
      try {
        if (!fsSync.statSync(resolvedFile).isFile()) {
          return { error: `❌ context_files entry "${file}" is not a file`, paths: [], relativePaths: [] }
        }
        comparablePath = path.normalize(fsSync.realpathSync(resolvedFile))
        if (!isWithinRoot(comparablePath, workspaceRoot)) {
          return { error: `❌ context_files entry "${file}" escapes workspace root`, paths: [], relativePaths: [] }
        }
      } catch {
        return { error: `❌ context_files entry "${file}" cannot be read`, paths: [], relativePaths: [] }
      }
    }
    paths.push(comparablePath)
    relativePaths.push(path.relative(workspaceRoot, resolvedFile))
  }
  return { error: null, paths, relativePaths }
}

function resolveSelectedWorkspaceRoot(workspaceDir?: string, canonicalDirectory?: string): string | null {
  const selected = typeof workspaceDir === "string" && workspaceDir.trim()
    ? workspaceDir
    : typeof canonicalDirectory === "string" && canonicalDirectory.trim()
      ? canonicalDirectory
      : process.cwd()
  try {
    const root = canonicalWorkspaceRoot(selected)
    return fsSync.statSync(root).isDirectory() ? root : null
  } catch {
    return null
  }
}

const ALLOWED_PHASES = ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY", "EXPLORE", "FIX"]
const PARALLEL_BUILD_CONCURRENCY = 3

type ODFDelegateWorkflowAdvance = Omit<WorkflowAdvanceInput, "route"> & {
  work_type: WorkType
  governance_acknowledgment?: GovernanceAcknowledgment
}

type ArtifactStore = "openspec" | "engram" | "hybrid"

export interface GovernanceAcknowledgment {
  target: "oca"
  acknowledged_by: string
  acknowledged_at: string
  candidate_digest: string
}

interface ODFDelegateArgs {
  phase: string
  prompt: string
  agent?: string
  context_files?: string[]
  target?: string
  workspace_dir?: string
  odoo_source_root?: string
  odoo_source_repos?: string
  profile?: string
  change?: string
  timeout_ms?: number
  attempt_id?: string
  artifact_store?: ArtifactStore
  governance_acknowledgment?: GovernanceAcknowledgment
  workflow_advance?: ODFDelegateWorkflowAdvance
}

export interface FastLanePolicy {
  version: 1
  enabled: boolean
  executor: "odoo_batch_implementer"
  validation: "targeted-then-full"
}

const FAST_LANE_EXECUTOR = "odoo_batch_implementer" as const
const FAST_LANE_VALIDATION = "targeted-then-full" as const
const FAST_LANE_ROLLBACK_VERSION = 1 as const

interface FastLaneRollback {
  version: typeof FAST_LANE_ROLLBACK_VERSION
  change: string
  artifact_store: ArtifactStore
  policy_digest: string
  disabled_at: string
  approved_by: string
  reason: string
}

interface DelegateExecutionOptions {
  branch_id?: string
  suppress_failure_receipt?: boolean
  validation_evidence_path?: string
  workflow_result?: ReturnType<typeof advanceWorkflow> | null
  pre_acquired_attempt?: AcquiredAttempt | null
  suppress_workflow_commit?: boolean
  suppress_attempt_settlement?: boolean
  telemetry_context?: TelemetryExecutionContext
}

interface TelemetryExecutionContext {
  event: "run" | "span"
  trace_id: string
  run_id: string
  span_id: string
  parent_span_id?: string
  emit_lifecycle?: boolean
}

type InternalODFDelegateArgs = ODFDelegateArgs & {
  __options?: DelegateExecutionOptions
}

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ATTEMPT_LEDGER_MAX_BYTES = 256 * 1024
const ATTEMPT_LEDGER_MAX_LINES = 500
const ATTEMPT_LEDGER_MAX_LINE_BYTES = 512
const ATTEMPT_LEDGER_LOCK_SUFFIX = ".lock"

type AttemptLedgerPhase = "IMPLEMENT" | "VERIFY"
type AttemptLedgerStatus = "running" | "completed" | "failed"
type AttemptLedgerResultStatus =
  | "running"
  | "delegated"
  | "validation-failed"
  | "timeout"
  | "cancelled"
  | "empty-task-result"
  | "error"
  | "task-api-unavailable"
type AttemptLedgerReason =
  | "acquired"
  | "task-completed"
  | "validation-failed"
  | "task-timeout"
  | "task-cancelled"
  | "empty-task-result"
  | "task-error"
  | "task-api-unavailable"

interface AttemptLedgerRecord {
  attempt_id: string
  branch_id?: string
  change: string
  phase: AttemptLedgerPhase
  next_stage: "BUILD" | "VERIFY"
  status: AttemptLedgerStatus
  started_at: string
  updated_at: string
  settled_at: string | null
  reason: AttemptLedgerReason
  result_status: AttemptLedgerResultStatus
  candidate_digest?: string | null
}

interface AcquiredAttempt {
  workspaceRoot: string
  ledgerPath: string
  record: AttemptLedgerRecord
}

interface AttemptAcquisitionBlocked {
  acquired: false
  reason: string
  message: string
}

interface AttemptAcquisitionAllowed {
  acquired: true
  handle: AcquiredAttempt
}

type AttemptAcquisitionResult = AttemptAcquisitionAllowed | AttemptAcquisitionBlocked

function attemptLedgerPath(workspaceDir: string, change: string): string {
  return path.join(workspaceDir, ".odf", `attempt-ledger-${change}.jsonl`)
}

function safeWorkspaceStatePath(workspaceRoot: string, candidatePath: string): string | null {
  const root = path.resolve(workspaceRoot)
  const candidate = path.resolve(candidatePath)
  if (!isWithinRoot(candidate, root)) return null

  let realRoot: string
  try {
    realRoot = fsSync.realpathSync(root)
  } catch {
    return null
  }

  let current = root
  const relative = path.relative(root, candidate)
  if (!relative) return candidate
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component)
    try {
      const stat = fsSync.lstatSync(current)
      if (stat.isSymbolicLink() || current !== candidate && !stat.isDirectory()) return null
      if (!isWithinRoot(fsSync.realpathSync(current), realRoot)) return null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate
      return null
    }
  }
  return candidate
}

function ensureSafeOdfDirectory(workspaceRoot: string): string | null {
  const root = path.resolve(workspaceRoot)
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
      fsSync.mkdirSync(directory)
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== "EEXIST") return null
    }
  }

  try {
    const stat = fsSync.lstatSync(directory)
    return !stat.isSymbolicLink() && stat.isDirectory() && isWithinRoot(fsSync.realpathSync(directory), realRoot)
      ? directory
      : null
  } catch {
    return null
  }
}

function isSafeToken(value: unknown): value is string {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value)
}

function isSafeTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32 && !/[\r\n]/.test(value)
}

function isAttemptLedgerRecord(value: unknown): value is AttemptLedgerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Partial<AttemptLedgerRecord>
  return isSafeToken(record.attempt_id) &&
    (record.branch_id === undefined || isSafeToken(record.branch_id)) &&
    isSafeToken(record.change) &&
    (record.phase === "IMPLEMENT" || record.phase === "VERIFY") &&
    (record.next_stage === "BUILD" || record.next_stage === "VERIFY") &&
    (record.status === "running" || record.status === "completed" || record.status === "failed") &&
    isSafeTimestamp(record.started_at) &&
    isSafeTimestamp(record.updated_at) &&
    (record.settled_at === null || isSafeTimestamp(record.settled_at)) &&
    (record.reason === "acquired" || record.reason === "task-completed" || record.reason === "validation-failed" || record.reason === "task-timeout" ||
      record.reason === "task-cancelled" || record.reason === "empty-task-result" || record.reason === "task-error" ||
      record.reason === "task-api-unavailable") &&
    (record.result_status === "running" || record.result_status === "delegated" || record.result_status === "validation-failed" || record.result_status === "timeout" ||
      record.result_status === "cancelled" || record.result_status === "empty-task-result" || record.result_status === "error" ||
      record.result_status === "task-api-unavailable") &&
    (record.candidate_digest === undefined || record.candidate_digest === null || isSafeToken(record.candidate_digest))
}

function attemptBranchId(record: AttemptLedgerRecord): string {
  return record.branch_id || "default"
}

function readAttemptLedger(workspaceRoot: string, ledgerPath: string): { records: AttemptLedgerRecord[]; error?: string } {
  const safePath = safeWorkspaceStatePath(workspaceRoot, ledgerPath)
  if (!safePath) return { records: [], error: "attempt-ledger-unsafe-path" }
  let stat: fsSync.Stats
  try {
    stat = fsSync.statSync(safePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { records: [] }
    return { records: [], error: "attempt-ledger-read-failed" }
  }

  if (!stat.isFile() || stat.size > ATTEMPT_LEDGER_MAX_BYTES) {
    return { records: [], error: "attempt-ledger-limit" }
  }

  let content: string
  try {
    content = fsSync.readFileSync(safePath, "utf8")
  } catch {
    return { records: [], error: "attempt-ledger-read-failed" }
  }

  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === "") lines.pop()
  if (lines.length > ATTEMPT_LEDGER_MAX_LINES) return { records: [], error: "attempt-ledger-limit" }

  const records: AttemptLedgerRecord[] = []
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > ATTEMPT_LEDGER_MAX_LINE_BYTES) {
      return { records: [], error: "attempt-ledger-limit" }
    }
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isAttemptLedgerRecord(parsed)) return { records: [], error: "attempt-ledger-invalid" }
      records.push(parsed)
    } catch {
      return { records: [], error: "attempt-ledger-invalid" }
    }
  }
  return { records }
}

function appendAttemptLedgerRecord(workspaceRoot: string, ledgerPath: string, record: AttemptLedgerRecord): string | null {
  const line = JSON.stringify(record)
  const lineBytes = Buffer.byteLength(line, "utf8") + 1
  if (lineBytes > ATTEMPT_LEDGER_MAX_LINE_BYTES) return "attempt-ledger-limit"

  try {
    if (!ensureSafeOdfDirectory(workspaceRoot)) return "attempt-ledger-unsafe-path"
    const safePath = safeWorkspaceStatePath(workspaceRoot, ledgerPath)
    if (!safePath) return "attempt-ledger-unsafe-path"
    let currentBytes = 0
    try {
      currentBytes = fsSync.statSync(safePath).size
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return "attempt-ledger-read-failed"
    }
    if (currentBytes + lineBytes > ATTEMPT_LEDGER_MAX_BYTES) return "attempt-ledger-limit"
    if (currentBytes > 0) {
      const existing = fsSync.readFileSync(safePath, "utf8")
      const existingLines = existing.split(/\r?\n/)
      if (existingLines.at(-1) === "") existingLines.pop()
      if (existingLines.length >= ATTEMPT_LEDGER_MAX_LINES) return "attempt-ledger-limit"
    }

    // appendFileSync opens with O_APPEND, keeping each bounded record append-only.
    fsSync.appendFileSync(safePath, `${line}\n`, { encoding: "utf8", flag: "a" })
    return null
  } catch {
    return "attempt-ledger-write-failed"
  }
}

type AttemptLedgerLockResult<T> =
  | { locked: true; value: T }
  | { locked: false; error: string }

function withAttemptLedgerLock<T>(workspaceRoot: string, ledgerPath: string, operation: () => T): AttemptLedgerLockResult<T> {
  const lockPath = `${ledgerPath}${ATTEMPT_LEDGER_LOCK_SUFFIX}`
  let lockFd: number | null = null

  try {
    if (!ensureSafeOdfDirectory(workspaceRoot) || !safeWorkspaceStatePath(workspaceRoot, ledgerPath) || !safeWorkspaceStatePath(workspaceRoot, lockPath)) {
      return { locked: false, error: "attempt-ledger-unsafe-path" }
    }
    try {
      // O_EXCL makes acquisition atomic across processes; contention fails closed.
      lockFd = fsSync.openSync(lockPath, "wx")
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return { locked: false, error: code === "EEXIST" ? "attempt-ledger-locked" : "attempt-ledger-lock-failed" }
    }
    return { locked: true, value: operation() }
  } catch {
    return { locked: false, error: "attempt-ledger-lock-failed" }
  } finally {
    if (lockFd !== null) {
      try { fsSync.closeSync(lockFd) } catch { /* best-effort */ }
      try {
        fsSync.unlinkSync(lockPath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`[odf-delegation] Failed to clean up attempt ledger lock: ${lockPath}`)
        }
      }
    }
  }
}

function acquireAttempt(opts: {
  workspaceDir: string
  change: string
  phase: AttemptLedgerPhase
  nextStage: "BUILD" | "VERIFY"
  attemptId: string
  branchId?: string
}): AttemptAcquisitionResult {
  const ledgerPath = attemptLedgerPath(opts.workspaceDir, opts.change)
  const branchId = opts.branchId || "default"
  const result = withAttemptLedgerLock<AttemptAcquisitionResult>(opts.workspaceDir, ledgerPath, (): AttemptAcquisitionResult => {
    const ledger = readAttemptLedger(opts.workspaceDir, ledgerPath)
    if (ledger.error) {
      return { acquired: false, reason: ledger.error, message: "The attempt ledger could not be read safely." }
    }
    if (ledger.records.some(record => attemptBranchId(record) === branchId && record.attempt_id === opts.attemptId)) {
      return { acquired: false, reason: "attempt-id-reused", message: "The attempt_id was already used for this branch." }
    }

    const latestPhaseRecord = ledger.records
      .filter(record => attemptBranchId(record) === branchId && record.phase === opts.phase)
      .at(-1)
    // Only "running" blocks a new attempt (concurrency). Phase completion is
    // owned by the canonical workflow, which is checked BEFORE acquisition
    // (inspectPersistedTransition already-committed / workflow-complete).
    // Rejecting "completed" here permanently closed the phase in the ledger
    // while a multi-batch BUILD still had pending batches (issue #2).
    if (latestPhaseRecord?.status === "running") {
      return { acquired: false, reason: "attempt-phase-running", message: `A ${opts.phase} attempt is already running.` }
    }

    const now = new Date().toISOString()
    const record: AttemptLedgerRecord = {
      attempt_id: opts.attemptId,
      branch_id: branchId,
      change: opts.change,
      phase: opts.phase,
      next_stage: opts.nextStage,
      status: "running",
      started_at: now,
      updated_at: now,
      settled_at: null,
      reason: "acquired",
      result_status: "running",
       candidate_digest: candidateDigestOrNull(opts.workspaceDir, opts.change),
    }
    const appendError = appendAttemptLedgerRecord(opts.workspaceDir, ledgerPath, record)
    if (appendError) {
      return { acquired: false, reason: appendError, message: "The attempt could not be acquired safely." }
    }
    return { acquired: true, handle: { workspaceRoot: opts.workspaceDir, ledgerPath, record } }
  })
  if (!result.locked) {
    return { acquired: false, reason: result.error, message: "The attempt could not be acquired safely." }
  }
  return result.value
}

function settleAttempt(
  attempt: AcquiredAttempt,
  status: Exclude<AttemptLedgerStatus, "running">,
  resultStatus: Exclude<AttemptLedgerResultStatus, "running">,
  reason: Exclude<AttemptLedgerReason, "acquired">,
): void {
  const now = new Date().toISOString()
  const settled: AttemptLedgerRecord = {
    ...attempt.record,
    status,
    updated_at: now,
    settled_at: now,
    reason,
    result_status: resultStatus,
  }
  const result = withAttemptLedgerLock(attempt.workspaceRoot, attempt.ledgerPath, () => appendAttemptLedgerRecord(attempt.workspaceRoot, attempt.ledgerPath, settled))
  if (!result.locked) {
    console.warn(`[odf-delegation] Failed to settle attempt ledger: ${result.error}`)
  } else if (result.value) {
    console.warn(`[odf-delegation] Failed to settle attempt ledger: ${result.value}`)
  }
}

// ==========================================
function extractChangeName(prompt: string): string | null {
  const match = prompt.match(/[Cc]hange\s+name\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9_-]*)/)
  return match ? match[1] : null
}

// ==========================================
// STOP-VALIDATION EVIDENCE (slice 2)
// ==========================================

export interface ValidationEvidenceCommand {
  name: string
  kind?: "targeted" | "full"
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
  candidate_digest?: string | null
  external_validation_subject_manifest?: ExternalValidationSubjectManifestEntry[]
  executor?: string
  test_identity?: string
  expectations_ids?: string[]
  resolved_at: string
  commands: ValidationEvidenceCommand[]
}

export interface ValidationVerdict {
  status: "verified" | "missing" | "invalid"
  reason: string
  commands_validated: number
  warnings?: string[]
  expectations_ids?: string[]
}

const EVIDENCE_FRESHNESS_MS = 60 * 60 * 1000 // 60 min window
const CANDIDATE_DIGEST_PATTERN = /^[0-9a-f]{64}$/

function validationEvidenceRelativePath(change: string, branchId?: string): string {
  const suffix = branchId ? `-${branchId}` : ""
  return path.join(".odf", `validation-evidence-${change}${suffix}.json`)
}

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
 * - optional fast-lane command kind and phase requirements
 */
export function validateValidationEvidence(opts: {
  workspaceDir: string
  change: string
  tier: "LOW" | "MEDIUM" | "HIGH"
  frozenDiffRef: string | null
  evidencePath?: string
  expectationsIds?: string[]
  expectedPhase?: "IMPLEMENT" | "VERIFY"
  requiredCommandKind?: "targeted" | "full"
  now?: Date
}): ValidationVerdict {
  const now = opts.now || new Date()
  const evidencePath = opts.evidencePath || validationEvidenceRelativePath(opts.change)
  if (path.isAbsolute(evidencePath) || evidencePath.split(/[\\/]/).includes("..")) {
    return { status: "invalid", reason: "validation-evidence path is unsafe", commands_validated: 0 }
  }
  const filePath = safeWorkspaceStatePath(opts.workspaceDir, path.resolve(opts.workspaceDir, evidencePath))
  if (!filePath) {
    return { status: "invalid", reason: "validation-evidence path escapes workspace root", commands_validated: 0 }
  }

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

  if (opts.expectedPhase !== undefined && evidence.phase !== opts.expectedPhase) {
    return { status: "invalid", reason: `validation-evidence phase "${evidence.phase}" does not match "${opts.expectedPhase}"`, commands_validated: 0 }
  }

  const freshDigest = candidateDigestOrNull(opts.workspaceDir, opts.change)
  if (evidence.candidate_digest !== undefined && evidence.candidate_digest !== null &&
    (typeof evidence.candidate_digest !== "string" || !CANDIDATE_DIGEST_PATTERN.test(evidence.candidate_digest))) {
    return { status: "invalid", reason: "candidate_digest must be a lowercase SHA-256 hex digest", commands_validated: 0 }
  }
  if (opts.requiredCommandKind === "targeted") {
    if (freshDigest === null) {
      return { status: "invalid", reason: "candidate_digest required for targeted validation evidence — candidate digest is unavailable", commands_validated: 0 }
    }
    if (typeof evidence.candidate_digest !== "string" || evidence.candidate_digest !== freshDigest) {
      return {
        status: "invalid",
        reason: `candidate digest mismatch: targeted evidence is bound to ${String(evidence.candidate_digest)}, workspace candidate is ${freshDigest}`,
        commands_validated: 0,
      }
    }
  } else if (typeof evidence.candidate_digest === "string") {
    if (freshDigest !== null && evidence.candidate_digest !== freshDigest) {
      return {
        status: "invalid",
        reason: `candidate digest mismatch: evidence bound to ${evidence.candidate_digest}, workspace candidate is ${freshDigest}`,
        commands_validated: 0,
      }
    }
  }

  if (opts.frozenDiffRef != null && evidence.frozen_diff_ref !== opts.frozenDiffRef) {
    return { status: "invalid", reason: "validation-evidence frozen_diff_ref does not match the policy gate frozen ref", commands_validated: 0 }
  }

  const persistedSubjects = readPersistedExternalValidationSubjects(opts.workspaceDir, opts.change)
  if (persistedSubjects.invalid) {
    return { status: "invalid", reason: "external-validation subject declaration is malformed or unreadable", commands_validated: 0 }
  }
  if (persistedSubjects.paths) {
    const currentSubjects = captureExternalValidationSubjectManifest(opts.workspaceDir, persistedSubjects.paths)
    if (currentSubjects.error || !currentSubjects.manifest) {
      return { status: "invalid", reason: `external-validation subject unavailable — ${currentSubjects.error || "manifest missing"}`, commands_validated: 0 }
    }
    const evidenceSubjects = normalizeExternalValidationSubjectManifest(evidence.external_validation_subject_manifest)
    if (evidenceSubjects.error || JSON.stringify(evidenceSubjects.manifest) !== JSON.stringify(currentSubjects.manifest)) {
      return { status: "invalid", reason: "external-validation subject manifest mismatch", commands_validated: 0 }
    }
  } else if (evidence.external_validation_subject_manifest !== undefined) {
    return { status: "invalid", reason: "external-validation subject manifest supplied without a policy declaration", commands_validated: 0 }
  }

  const resolvedAt = new Date(evidence.resolved_at).getTime()
  if (!Number.isFinite(resolvedAt)) {
    return { status: "invalid", reason: "validation-evidence resolved_at is not a valid timestamp", commands_validated: 0 }
  }
  const ageMs = now.getTime() - resolvedAt
  if (ageMs < 0 || ageMs > EVIDENCE_FRESHNESS_MS) {
    return { status: "invalid", reason: `validation-evidence is stale (resolved ${Math.round(ageMs / 1000)}s ago, window ${EVIDENCE_FRESHNESS_MS / 1000}s)`, commands_validated: 0 }
  }

  const isVerify = evidence.phase === "VERIFY"
  const commands = Array.isArray(evidence.commands) ? evidence.commands : []
  if (isVerify && commands.length === 0) {
    return { status: "invalid", reason: "verification-evidence requires at least one command — status-only evidence is not accepted", commands_validated: 0 }
  }
  if (commands.length < EVIDENCE_MIN_COMMANDS[opts.tier]) {
    return { status: "invalid", reason: `tier ${opts.tier} requires at least ${EVIDENCE_MIN_COMMANDS[opts.tier]} command(s), got ${commands.length}`, commands_validated: commands.length }
  }
  if (isVerify) {
    if (typeof evidence.executor !== "string" || !evidence.executor.trim()) {
      return { status: "invalid", reason: "verification-evidence is missing executor — who ran the verification", commands_validated: 0 }
    }
    if (typeof evidence.test_identity !== "string" || !evidence.test_identity.trim()) {
      return { status: "invalid", reason: "verification-evidence is missing test_identity — which test suite ran", commands_validated: 0 }
    }
    if (freshDigest !== null && (typeof evidence.candidate_digest !== "string" || !evidence.candidate_digest.trim())) {
      return { status: "invalid", reason: "candidate_digest required for verification-evidence — bind the receipt to the verified candidate", commands_validated: 0 }
    }
  }

  let checked = 0
  for (const cmd of commands) {
    if (!cmd || typeof cmd.name !== "string" || typeof cmd.exit_code !== "number") {
      return { status: "invalid", reason: "evidence command missing name or exit_code", commands_validated: checked }
    }
    if (isVerify) {
      if (typeof cmd.command !== "string" || !cmd.command.trim()) {
        return { status: "invalid", reason: `command "${cmd.name}" is missing the full command line`, commands_validated: checked }
      }
      if (typeof cmd.database !== "string" || !cmd.database.trim()) {
        return { status: "invalid", reason: `command "${cmd.name}" is missing the database context`, commands_validated: checked }
      }
      if (!(typeof cmd.output_tail === "string" && cmd.output_tail.trim()) && !(typeof cmd.output_evidence === "string" && cmd.output_evidence.trim())) {
        return { status: "invalid", reason: `command "${cmd.name}" is missing output evidence`, commands_validated: checked }
      }
    }
    if (cmd.exit_code !== 0) {
      return { status: "invalid", reason: `command "${cmd.name}" exited with ${cmd.exit_code}`, commands_validated: checked }
    }
    if (opts.requiredCommandKind !== undefined && cmd.kind !== opts.requiredCommandKind) {
      return {
        status: "invalid",
        reason: `command "${cmd.name}" must be marked ${opts.requiredCommandKind} validation evidence`,
        commands_validated: checked,
      }
    }
    if (["odoo-tests", "odoo-test", "pytest-odoo"].includes(cmd.name)) {
      if (typeof cmd.database !== "string" || !cmd.database.trim()) {
        return { status: "invalid", reason: `command "${cmd.name}" is missing an explicit database; use -d <test_db>`, commands_validated: checked }
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

  const expectationsIds = opts.expectationsIds || evidence.expectations_ids
  return {
    status: "verified",
    reason: `stop-validation evidence verified (${checked} command(s))`,
    commands_validated: checked,
    ...(expectationsIds?.length ? { expectations_ids: expectationsIds } : {}),
  }
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
      external_validation_scope: tool.schema
        .array(tool.schema.string().max(512))
        .max(64)
        .optional()
        .describe("Optional relative workflow/artifact paths to include in the external-validation candidate"),
      external_validation_subjects: tool.schema
        .array(tool.schema.string().max(512))
        .max(64)
        .optional()
        .describe("Optional relative files/directories to hash-bind in validation evidence; may be Gitignored"),
    },
    async execute(args: {
      change: string
      phase: "IMPLEMENT" | "VERIFY"
      workspace_dir?: string
      external_validation_scope?: string[]
      external_validation_subjects?: string[]
    }): Promise<string> {
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
          candidate_digest: null,
          base_head: null,
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
        externalValidationScope: args.external_validation_scope,
        externalValidationSubjects: args.external_validation_subjects,
      })
      debugLog(`[odf-delegation] odf_policy_gate: change=${decision.change} phase=${decision.phase} gate=${decision.gate} tdd=${decision.tdd.effective} tier=${decision.risk_tier}`)
      return JSON.stringify(decision, null, 2)
    },
  })
}

// ==========================================
// TOOL CREATORS
// ==========================================

function recordTerminalFlowMarkers(
  sessionId: string | undefined,
  workspaceRoot: string,
  change: string,
  workType: WorkType,
  terminalStage: "DECIDE" | "FIX" | undefined,
): void {
  const validTerminal = workType === "small-change" && terminalStage === "DECIDE" ||
    workType === "bugfix" && terminalStage === "FIX"
  if (!sessionId || !validTerminal) return

  const traceId = createTelemetryTraceId()
  const runId = createTelemetryRunId()
  let parentSpanId = createTelemetrySpanId()
  const prefix: Array<{ phase: string; lifecycle: "started" | "finished"; flowStage: TelemetryFlowStage }> = [
    { phase: "PROPOSE", lifecycle: "started", flowStage: "entry_started" },
    { phase: "PROPOSE", lifecycle: "finished", flowStage: "intent_approved" },
    { phase: "ASSESS", lifecycle: "finished", flowStage: "policy_selected" },
  ]

  for (const marker of prefix) {
    const spanId = createTelemetrySpanId()
    recordMetrics({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      phase: marker.phase,
      agent: "workflow-bind",
      skills_injected: [],
      skill_resolution: "none",
      duration_ms: 0,
      token_estimate: 0,
      status: "ok",
      task_api_source: "unavailable",
      work_type: workType,
      event: "span",
      lifecycle: marker.lifecycle,
      span_kind: "task",
      change,
      run_id: runId,
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentSpanId,
      flow_stage: marker.flowStage,
      workspace: workspaceProjectName(workspaceRoot),
      tool: "odf_workflow_bind",
    })
    parentSpanId = spanId
  }
}

function createODFDelegate(
  client?: OpencodeClient,
  canonicalDirectory?: string,
  defaultExecutionOptions: DelegateExecutionOptions = {},
): ReturnType<typeof tool> {
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
      agent: tool.schema
        .string()
        .optional()
        .describe("Optional explicit registered agent override; must be installed and eligible for the phase."),
      context_files: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Files the agent will work with (for skill matching)"),
      target: tool.schema
        .string()
        .optional()
        .describe("Explicit governance target, such as oca"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Selected project directory (defaults to the plugin directory, then cwd)"),
      odoo_source_root: tool.schema
        .string()
        .optional()
        .describe("Explicit Odoo source root required for view-authority DESIGN/IMPLEMENT tasks"),
      odoo_source_repos: tool.schema
        .string()
        .optional()
        .describe("Optional explicit active Odoo repos root for view-authority lookup"),
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
        .describe("Task timeout in milliseconds (default: 600000)"),
      attempt_id: tool.schema
        .string()
        .optional()
        .describe("Fresh opaque attempt token for gated IMPLEMENT/VERIFY execution"),
      artifact_store: tool.schema
        .enum(["openspec", "engram", "hybrid"])
        .optional()
        .describe("Authoritative workflow store; required when workflow_advance proof is supplied"),
      governance_acknowledgment: governanceAcknowledgmentSchema
        .optional()
        .describe("Explicit final human OCA acknowledgment bound to the current candidate digest"),
      workflow_advance: tool.schema
        .object({
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
            .describe("Resolved work type for the transition"),
          target: tool.schema.enum(["oca"]).optional().describe("Persisted governance target"),
          governance_acknowledgment: governanceAcknowledgmentSchema.optional().describe("Explicit final human OCA acknowledgment"),
          completed_stages: tool.schema
            .array(tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"]))
            .describe("Canonical stages already completed before candidate_stage"),
          candidate_stage: tool.schema
            .enum(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"])
            .nullable()
            .describe("Canonical stage that just completed; null only for an initial transition"),
          phase_result_status: tool.schema
            .enum(["ok", "warning", "blocked", "failed"])
            .describe("Result-contract status for the completed phase"),
          validation_status: tool.schema
            .enum(["verified", "missing", "invalid", "not-required"])
            .describe("Validation seal status"),
          receipt_state: tool.schema
            .enum(["none", "pending", "resolved"])
            .describe("Current receipt state"),
          resumable_state: tool.schema
            .boolean()
            .describe("Whether the workflow can resume"),
          archived_state: tool.schema
            .boolean()
            .describe("Whether the workflow is archived"),
        })
        .optional()
        .describe("Optional machine-checked transition proof for canonical BUILD/VERIFY starts"),
    },
    async execute(args: InternalODFDelegateArgs, toolCtx: ToolContext): Promise<string> {
      if (!toolCtx?.sessionID) {
        return "❌ odf_delegate requires sessionID"
      }

      const executionOptions: DelegateExecutionOptions = {
        ...defaultExecutionOptions,
        ...(args.__options || {}),
      }
      const metricContext = {
        work_type: args.workflow_advance?.work_type,
        branch_id: executionOptions.branch_id,
        // T7: capture host runtime telemetry (model/provider/tokens) when the
        // toolCtx exposes it. This host's ToolContext does not, so these stay
        // null / model_available=false — never synthesized.
        ...hostTelemetryFromContext(toolCtx),
      }

      if (!ALLOWED_PHASES.includes(args.phase)) {
        return `❌ Invalid phase "${args.phase}". Allowed: ${ALLOWED_PHASES.join(", ")}`
      }

      const startTime = Date.now()
      const telemetryContext = executionOptions.telemetry_context || {
        event: "run" as const,
        trace_id: createTelemetryTraceId(),
        run_id: createTelemetryRunId(),
        span_id: createTelemetrySpanId(),
      }
      const telemetryIdentity: Partial<DelegationMetricInput> = {
        event: telemetryContext.event,
        run_id: telemetryContext.run_id,
        trace_id: telemetryContext.trace_id,
        span_id: telemetryContext.span_id,
        ...(telemetryContext.parent_span_id ? { parent_span_id: telemetryContext.parent_span_id } : {}),
      }
      // Declared before blockWorkflow so blocked paths can settle the attempt:
      // every post-acquisition rejection (policy gate, pre-tool safety,
      // expectations) must leave a terminal ledger record, never a stuck
      // "running" one (issues #2/#3).
      let acquiredAttempt: AcquiredAttempt | null = executionOptions.pre_acquired_attempt || null
      const blockWorkflow = (reason: string, message: string, workflowResult: ReturnType<typeof advanceWorkflow> | null, extra: Record<string, unknown> = {}): string => {
        if (acquiredAttempt && !executionOptions.suppress_attempt_settlement) {
          settleAttempt(acquiredAttempt, "failed", "validation-failed", "validation-failed")
          acquiredAttempt = null
        }
        recordMetrics({
          timestamp: new Date().toISOString(),
          session_id: toolCtx.sessionID,
          phase: args.phase,
          agent: "unresolved",
          skills_injected: [],
          skill_resolution: "none",
          duration_ms: Date.now() - startTime,
          token_estimate: estimateTokens(args.prompt),
           status: "blocked",
           task_api_source: "unavailable",
           ...metricContext,
           ...telemetryIdentity,
           error: message,
        })
        return JSON.stringify({
          status: "blocked",
          reason,
          phase: args.phase,
          agent: null,
          skills_injected: [],
          profile: null,
          policy_gate: null,
          validation: null,
          receipt: null,
          task_api_source: "unavailable",
          result: null,
          workflow_advance: workflowResult,
          message,
          ...extra,
        }, null, 2)
      }

      const gatedPhase = args.phase === "IMPLEMENT" || args.phase === "VERIFY"
      let registry: ODFRegistry | null = null
      if (gatedPhase && !args.workflow_advance) {
        registry = await loadRegistry()
        if (registry?.flags?.strict_workflow === true) {
          return blockWorkflow(
            "strict-workflow-proof-required",
            "Strict workflow mode requires workflow_advance for IMPLEMENT/VERIFY; legacy omissions are allowed only when flags.strict_workflow is false.",
            null,
          )
        }
      }

      const workspaceRoot = resolveSelectedWorkspaceRoot(args.workspace_dir, canonicalDirectory)
      if (!workspaceRoot) {
        return blockWorkflow(
          "unsafe-workspace-path",
          "The workspace directory does not resolve to a safe existing root.",
          null,
        )
      }
      const changeName = args.change?.trim() || extractChangeName(args.prompt)
      const sourceAuthorityRequired = isViewAuthorityWork(args.phase, args.prompt, args.context_files || [])

      let workflowResult: ReturnType<typeof advanceWorkflow> | null = executionOptions.workflow_result || null
      let effectiveWorkflowAdvance: ODFDelegateWorkflowAdvance | null = null
      let selectedWorkflowSnapshot: SelectedWorkflowSnapshot | null = null
      let fastLanePolicy: FastLanePolicy | null = null
      let fastLanePolicyActive = false
      let fastLaneBuild = false
      if (args.workflow_advance) {
        if (args.artifact_store === undefined) {
          return blockWorkflow(
            "artifact-store-required",
            "Proof-backed IMPLEMENT/VERIFY delegation requires an explicit artifact_store: openspec, engram, or hybrid.",
            null,
          )
        }
        const expectedStage: "BUILD" | "VERIFY" = args.phase === "IMPLEMENT" ? "BUILD" : "VERIFY"
        const { work_type: callerWorkType, ...callerAdvanceInput } = args.workflow_advance
        const callerResult = advanceWorkflow({
          route: resolveWorkflowRoute(callerWorkType),
          ...callerAdvanceInput,
          // Caller state is only a structural preflight. Persisted state and receipt are authoritative below.
          receipt_state: "resolved",
          resumable_state: true,
          archived_state: false,
        })
        workflowResult = callerResult
        if (args.phase !== "IMPLEMENT" && args.phase !== "VERIFY") {
          return blockWorkflow(
            "workflow-gate-unsupported-phase",
            `workflow_advance is supported only for IMPLEMENT and VERIFY starts; ${args.phase} is a composite legacy adapter. Omit workflow_advance for this call.`,
            callerResult,
          )
        }
        if (callerResult.status !== "advanced") {
          return blockWorkflow("workflow-advance-blocked", callerResult.reason, callerResult)
        }
        if (callerResult.next_stage !== expectedStage) {
          return blockWorkflow(
            "workflow-phase-mismatch",
            `Workflow next_stage ${callerResult.next_stage || "none"} does not match ${args.phase}; expected ${expectedStage}.`,
            callerResult,
          )
        }
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
             ...metricContext,
             ...telemetryIdentity,
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
        if (gatedPhase && !acquiredAttempt && (!isSafeToken(changeName) || !isSafeToken(args.attempt_id))) {
          return blockWorkflow(
            !isSafeToken(changeName) ? "unsafe-change-name" : "attempt-id-required",
            !isSafeToken(changeName)
              ? "The change name must be a safe token of 1-64 letters, numbers, hyphens, or underscores."
              : "Gated IMPLEMENT/VERIFY delegation requires a fresh safe attempt_id.",
            callerResult,
          )
        }
        const selected = await readSelectedWorkflowState(workspaceRoot, changeName!, args.artifact_store)
        if (!selected.snapshot) {
          return blockWorkflow(
            selected.error || "workflow-state-unavailable",
            "The selected workflow state could not be read before delegation.",
            callerResult,
            { safe_continuation: changeName ? `/odf-continue ${changeName}` : "/odf-continue" },
          )
        }
        selectedWorkflowSnapshot = selected.snapshot
        const canonical = canonicalizeWorkflowAdvance(selected.snapshot, args.workflow_advance, expectedStage)
        if ("reason" in canonical) return blockWorkflow(canonical.reason, canonical.message, null)
        effectiveWorkflowAdvance = canonical.proof
        const { work_type, ...advanceInput } = effectiveWorkflowAdvance
        workflowResult = advanceWorkflow({
          route: resolveWorkflowRoute(work_type),
          ...advanceInput,
        })
        if (args.phase !== "IMPLEMENT" && args.phase !== "VERIFY") {
          return blockWorkflow(
            "workflow-gate-unsupported-phase",
            `workflow_advance is supported only for IMPLEMENT and VERIFY starts; ${args.phase} is a composite legacy adapter. Omit workflow_advance for this call.`,
            workflowResult,
          )
        }

        if (workflowResult.status !== "advanced") {
          return blockWorkflow(
            workflowResult.status === "complete" ? "workflow-complete" : "workflow-advance-blocked",
            workflowResult.reason,
            workflowResult,
          )
        }

        if (workflowResult.next_stage !== expectedStage) {
          return blockWorkflow(
            "workflow-phase-mismatch",
            `Workflow next_stage ${workflowResult.next_stage || "none"} does not match ${args.phase}; expected ${expectedStage}.`,
            workflowResult,
          )
        }
      }
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
           ...metricContext,
           ...telemetryIdentity,
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

      if (gatedPhase && args.workflow_advance && !acquiredAttempt) {
        if (!isSafeToken(changeName)) {
          return blockWorkflow(
            "unsafe-change-name",
            "The change name must be a safe token of 1-64 letters, numbers, hyphens, or underscores.",
            workflowResult!,
          )
        }
        if (!isSafeToken(args.attempt_id)) {
          return blockWorkflow(
            "attempt-id-required",
            "Gated IMPLEMENT/VERIFY delegation requires a fresh safe attempt_id.",
            workflowResult!,
          )
        }
      }

      let transitionStart: TransitionInspection | null = null
      if (gatedPhase && effectiveWorkflowAdvance && workflowResult) {
        const expectedStage: "BUILD" | "VERIFY" = args.phase === "IMPLEMENT" ? "BUILD" : "VERIFY"
        const selected = await readSelectedWorkflowState(workspaceRoot, changeName!, args.artifact_store!)
        if (!selected.snapshot) {
          return blockWorkflow(
            selected.error || "workflow-state-unavailable",
            "The selected workflow state could not be read before delegation.",
            workflowResult,
          )
        }
        transitionStart = inspectPersistedTransition({
          snapshot: selected.snapshot,
          proof: effectiveWorkflowAdvance,
          expectedStage,
          callerResult: workflowResult,
        })
        if (!transitionStart.ok) return blockWorkflow(transitionStart.reason, transitionStart.message, workflowResult)
        if (transitionStart.alreadyCommitted) {
          recordMetrics({
            timestamp: new Date().toISOString(),
            session_id: toolCtx.sessionID,
            phase: args.phase,
            agent: "unresolved",
            skills_injected: [],
            skill_resolution: "none",
            duration_ms: Date.now() - startTime,
            token_estimate: estimateTokens(args.prompt),
             status: "ok",
             task_api_source: "unavailable",
             ...metricContext,
             ...telemetryIdentity,
           })
          return JSON.stringify({
            status: "delegated",
            phase: args.phase,
            agent: null,
            skills_injected: [],
            profile: null,
            policy_gate: null,
            validation: null,
            receipt: null,
            task_api_source: "unavailable",
            result: null,
            workflow_advance: workflowResult,
            workflow_commit: {
              status: "already-committed",
              reason: "already-committed",
              store: args.artifact_store,
              message: transitionStart.message,
            },
          }, null, 2)
        }
      }

      if (gatedPhase && effectiveWorkflowAdvance && selectedWorkflowSnapshot) {
    const storedFastLane = fastLanePolicyFromState(selectedWorkflowSnapshot.state, workspaceRoot, changeName!)
        if (storedFastLane.reason) {
          return blockWorkflow(
            storedFastLane.reason,
            "The persisted fast-lane policy is malformed and cannot authorize this delegation.",
            workflowResult,
          )
        }
        fastLanePolicy = storedFastLane.policy
        const fastLaneFailure = fastLaneEligibilityFailure(
          effectiveWorkflowAdvance.work_type,
          fastLanePolicy,
          selectedWorkflowSnapshot.state.entry_route_binding,
        ) || (fastLanePolicy?.enabled && args.phase === "IMPLEMENT"
           ? fastLaneCandidateFailure(workspaceRoot, changeName!, selectedWorkflowSnapshot.state.entry_route_binding)
          : null)
        if (fastLaneFailure) {
          return blockWorkflow(
            fastLaneFailure,
            "The persisted fast-lane policy is enabled, but its small-change binding is not currently eligible.",
            workflowResult,
          )
        }
        fastLanePolicyActive = fastLanePolicy?.enabled === true
        fastLaneBuild = fastLanePolicyActive && args.phase === "IMPLEMENT"
      }

      const contextValidation = validateContextFiles(workspaceRoot, args.context_files || [])
      if (contextValidation.error) return contextValidation.error

      if (!registry) registry = await loadRegistry()
      if (!registry) {
        return `❌ ODF registry not found. Run /odf-init or check ${REGISTRY_PATH}`
      }

      let sourceAuthorityRoots: SourceAuthorityRoots | null = null
      if (sourceAuthorityRequired) {
        const roots = establishSourceAuthorityRoots({
          workspaceRoot,
          sourceRoot: args.odoo_source_root,
          reposRoot: args.odoo_source_repos,
        })
        if (!roots.ok) {
          return blockWorkflow(
            "source-authority-unavailable",
            `${roots.reason}. Provide the exact odoo_source_root and retry${changeName ? ` with /odf-continue ${changeName}` : "."}`,
            workflowResult,
            { safe_continuation: changeName ? `/odf-continue ${changeName}` : "/odf-continue" },
          )
        }
        sourceAuthorityRoots = roots.roots
      }

      let policyGate: PolicyGateDecision | null = null

      // Detect Odoo version from project
      const odooVersion = await detectOdooVersion(workspaceRoot)
      if (odooVersion) {
        debugLog(`[odf-delegation] Detected Odoo version: ${odooVersion}`)
      }

      // M0 Slice 2: end-to-end funnel cohorts, tagged on every lifecycle and
      // task span below. Workspace is the project basename (never the raw
      // path); all three ride the existing sanitize allowlist in
      // recordMetrics, so out-of-range values are dropped, never stored.
      const flowContext: Partial<DelegationMetricInput> = {
        ...(odooVersion ? { odoo_version: odooVersion } : {}),
        workspace: workspaceProjectName(workspaceRoot),
        source_authority: Boolean(sourceAuthorityRequired && sourceAuthorityRoots),
      }

      // Match skills (with version filter)
      const skills = matchSkills(registry, args.phase, {
      files: args.context_files,
      task: args.prompt,
      target: args.target,
      odooVersion: odooVersion,
      })

      // Resolve agent and profile
      const keywords = args.prompt.split(/\s+/)
      let agentName: string | null
      if (fastLaneBuild) {
        if (args.agent !== undefined && args.agent !== FAST_LANE_EXECUTOR) {
          return blockWorkflow(
            "fast-lane-executor-conflict",
            `The enabled fast-lane policy requires ${FAST_LANE_EXECUTOR}; do not override its bounded executor.`,
            workflowResult,
          )
        }
        const selection = validateAgentSelection(registry, args.phase, FAST_LANE_EXECUTOR)
        if (!selection.valid) {
          return blockWorkflow(
            "fast-lane-executor-unavailable",
            `The enabled fast-lane executor ${FAST_LANE_EXECUTOR} is not registered, installed, and phase-eligible.`,
            workflowResult,
          )
        }
        agentName = selection.agent.name
      } else if (args.agent !== undefined) {
        const selection = validateAgentSelection(registry, args.phase, args.agent)
        if (!selection.valid) {
          return blockWorkflow(
            selection.reason,
            `Explicit agent "${args.agent}" is not registered, installed, and phase-eligible for ${args.phase}.`,
            workflowResult,
          )
        }
        agentName = selection.agent.name
      } else {
        agentName = resolveAgent(registry, args.phase, keywords)
      }
      if (!agentName) {
        return blockWorkflow(
          "agent-routing-unavailable",
          `No registered, installed, phase-eligible agent is available for ${args.phase}.`,
          workflowResult,
        )
      }
      const profile = await getProfileByPhase(registry, args.phase, args.profile)
      const profileBlock = profile ? formatProfileBlock(profile, args.phase) : ""
      debugLog(`[odf-delegation] odf_delegate: phase=${args.phase} agent=${agentName} skills=${skills.length} version=${odooVersion || "auto"} profile=${profile?.name || "default"}`)

      if (gatedPhase && args.workflow_advance && !acquiredAttempt) {
        const expectedStage: "BUILD" | "VERIFY" = args.phase === "IMPLEMENT" ? "BUILD" : "VERIFY"
        const acquisition = acquireAttempt({
          workspaceDir: workspaceRoot,
          change: changeName!,
          phase: args.phase as AttemptLedgerPhase,
          nextStage: expectedStage,
          attemptId: args.attempt_id!,
          branchId: executionOptions.branch_id,
        })
        if (!acquisition.acquired) {
          return blockWorkflow(acquisition.reason, acquisition.message, workflowResult!)
        }
        acquiredAttempt = acquisition.handle
      }

      // Policy Gate (chokepoint): resolve + persist before any IMPLEMENT/VERIFY
      // delegation. The gate documents the decision; the sub-agent applies it
      // (never recomputes). Safety net — the orchestrator calls odf_policy_gate
      // explicitly; this re-runs the same decision and injects it.
      if (gatedPhase) {
        policyGate = computePolicyGate({
          change: changeName!,
          phase: args.phase as "IMPLEMENT" | "VERIFY",
          workspaceDir: workspaceRoot,
          registry,
        })
        if (policyGate.gate === "block") {
          return blockWorkflow(
            policyGate.reason,
            `Policy gate blocked ${args.phase} before delegation: ${policyGate.reason}`,
            workflowResult,
          )
        }
      }

      // Inject compact rules, profile, and the Policy Gate decision
      const rules = formatCompactRules(skills)
      const hasInjection = rules || profileBlock
      const enrichedPrompt = hasInjection
        ? `${[rules, profileBlock].filter(Boolean).join("\n\n")}\n\n---\n\n${args.prompt}\n\n## Skill Resolution Status\nReport: injected (received from odf-delegation plugin)`
        : `${args.prompt}\n\n## Skill Resolution Status\nReport: none (no matching skills in registry)`
      const sourceAuthorityPrompt = sourceAuthorityRequired && sourceAuthorityRoots
        ? `## Source Authority Contract (mandatory postcondition)\nThis DESIGN/IMPLEMENT task is view-authority work. Return result.source_authority with ok: true, verified: true, relation, target_xmlid, and bounded evidence.relation/evidence.target objects containing the exact file, line, and snippet. For action relations such as search_view_id, also return action_xmlid and evidence.action. For ordinary view inheritance, return view_xmlid and evidence.view, with relation exactly inherit_id. Never put a view XML ID in action_xmlid. The plugin recomputes the explicit action or view relation from this source root; prose and verified flags are not proof.\nOdoo source root: ${sourceAuthorityRoots.source}${sourceAuthorityRoots.repos ? `\nOdoo repos root: ${sourceAuthorityRoots.repos}` : ""}`
        : ""
      const fastLanePrompt = fastLanePolicyActive
        ? `## Fast-Lane Policy (authoritative, opt-in)\n${JSON.stringify(fastLanePolicy, null, 2)}\nThis policy is valid only for the persisted eligible small-change binding. Keep the canonical BUILD/VERIFY transition and every existing safety gate.\n${args.phase === "IMPLEMENT"
          ? `For this bounded BUILD, run only the targeted inner-loop validation and write ${fastLaneEvidenceRelativePath(changeName!, "targeted")} with every command marked kind: targeted. Do not substitute full-gate evidence for targeted evidence.`
          : `For this final VERIFY, run the configured full module/CI validation and write ${fastLaneEvidenceRelativePath(changeName!, "full")} with every command marked kind: full. Targeted evidence cannot substitute for this full gate.`}`
        : ""
      const delegationPrompt = [
        enrichedPrompt,
        sourceAuthorityPrompt,
        fastLanePrompt,
        policyGate ? `## Policy Gate Decision (authoritative, do not recompute)\n${JSON.stringify(policyGate, null, 2)}` : "",
        EXECUTOR_BOUNDARY,
      ].filter(Boolean).join("\n\n")

      // T11 pre-tool safety: inspect the USER task payload (args.prompt) BEFORE
      // delegating. Complements native OpenCode permissions
      // (permission.allow/deny) which gate by tool+path; this catches dangerous
      // ARGUMENTS inside an allowed tool's payload. We scan args.prompt (the
      // orchestrator/user request), NOT the enriched delegationPrompt — the
      // latter embeds system-instructive material (skill rules, EXECUTOR_BOUNDARY
      // that legitimately name "DROP DATABASE"/"TRUNCATE"), which would be a
      // false-positive machine. Scoped to corpus classes only.
      const safety = inspectToolArgs({
        tool: "odf_delegate",
        args: { prompt: args.prompt },
        authorized_roots: [workspaceRoot],
      })
      if (safety.blocked) {
        const message = `Pre-tool safety blocked delegation to ${agentName}: ${safety.classes.join(", ")}. ${safety.safe_continuation || "Request explicit user consent for the exact target."}`
        return blockWorkflow("pre-tool-safety", message, workflowResult, {
          classes: safety.classes,
          matched_rules: safety.matched_rules,
          safe_continuation: safety.safe_continuation,
        })
      }

      let expectationsIds: string[] = []
      const phaseWarnings: string[] = []
      if (args.phase === "VERIFY" && effectiveWorkflowAdvance && transitionStart) {
        const expectations = validateExpectations({
          change: changeName!,
          artifacts: transitionStart.snapshot.artifacts,
        })
        expectationsIds = expectations.status === "approved" ? expectations.ids : []
        if (expectations.status === "missing") phaseWarnings.push("missing-expectations")
        if (expectations.status === "invalid" || expectations.status === "tampered") {
          return blockWorkflow(
            expectations.status === "invalid" ? "expectations-not-approved" : "expectations-invalid",
            expectations.status === "invalid"
              ? "Human Expectations are not approved; approve them before VERIFY."
              : "The Expectations artifact is invalid or tampered; restore the approved human artifact before VERIFY.",
            workflowResult,
            { safe_continuation: `/odf-continue ${changeName}` },
          )
        }
      }

      const taskApiInfo = findTaskApi(toolCtx, client)
      const profilePayload = profile
        ? { name: profile.name, model: profile.model, temperature: profile.temperature, reasoning: profile.reasoning }
        : null

      const emitTelemetryLifecycle = executionOptions.telemetry_context?.emit_lifecycle !== false
      let taskSpanId: string | null = null
      let taskSpanStartTime = 0
      let taskSpanFinished = false

      const recordTaskSpan = (
        lifecycle: "started" | "finished",
        overrides: Partial<DelegationMetricInput> = {},
      ): void => {
        if (!taskSpanId) return
        const flowStage = resolveFlowStage(args.phase, lifecycle, overrides.status)
        recordMetrics({
          timestamp: new Date().toISOString(),
          session_id: toolCtx.sessionID,
          phase: args.phase,
          agent: agentName,
          skills_injected: skills.map(s => s.name),
          skill_resolution: skills.length > 0 ? "injected" : "none",
          duration_ms: lifecycle === "started" ? 0 : Date.now() - taskSpanStartTime,
          token_estimate: estimateTokens(delegationPrompt),
          status: "ok",
          task_api_source: taskApiInfo?.source || "unavailable",
          ...metricContext,
          ...flowContext,
          ...(flowStage ? { flow_stage: flowStage } : {}),
           ...overrides,
           event: "span",
           span_kind: "task",
           lifecycle,
          change: changeName || undefined,
          run_id: telemetryContext.run_id,
          attempt_id: args.attempt_id,
          trace_id: telemetryContext.trace_id,
          span_id: taskSpanId,
          parent_span_id: telemetryContext.span_id,
          task: args.prompt,
          tool: "task",
        })
      }

      const finishTaskSpan = (overrides: Partial<DelegationMetricInput> = {}): void => {
        if (!taskSpanId || taskSpanFinished) return
        taskSpanFinished = true
        recordTaskSpan("finished", overrides)
      }

      const recordLifecycle = (
        lifecycle: "started" | "finished",
        overrides: Partial<DelegationMetricInput> = {},
      ): void => {
        if (lifecycle === "finished") finishTaskSpan(overrides)
        if (!emitTelemetryLifecycle) return
        const flowStage = resolveFlowStage(args.phase, lifecycle, overrides.status)
        const metric: DelegationMetricInput = {
          timestamp: new Date().toISOString(),
          session_id: toolCtx.sessionID,
          phase: args.phase,
          agent: agentName,
          skills_injected: skills.map(s => s.name),
          skill_resolution: skills.length > 0 ? "injected" : "none",
          duration_ms: lifecycle === "started" ? 0 : Date.now() - startTime,
          token_estimate: estimateTokens(delegationPrompt),
          status: "ok",
          task_api_source: taskApiInfo?.source || "unavailable",
          ...metricContext,
          ...flowContext,
          ...(flowStage ? { flow_stage: flowStage } : {}),
          ...overrides,
          event: telemetryContext.event,
          lifecycle,
          change: changeName || undefined,
          run_id: telemetryContext.run_id,
          attempt_id: args.attempt_id,
          trace_id: telemetryContext.trace_id,
          span_id: telemetryContext.span_id,
          ...(telemetryContext.parent_span_id ? { parent_span_id: telemetryContext.parent_span_id } : {}),
        }
        recordMetrics(metric)
      }

      // The start is flushed synchronously so a process dying in task() leaves
      // an observable unfinished run. The finish remains best-effort JSONL.
      recordLifecycle("started")
      flushMetricsSync()

      if (taskApiInfo) {
        try {
          const timeoutMs = args.timeout_ms ?? 600_000
          taskSpanId = createTelemetrySpanId()
          taskSpanStartTime = Date.now()
          recordTaskSpan("started")
          flushMetricsSync()
          const taskResult = await invokeTask(taskApiInfo.taskApi, agentName, delegationPrompt, contextValidation.relativePaths, timeoutMs, toolCtx.abort)
          let resultForOutput: unknown = taskResult.result
          // Stop-validation seal (slice 2): after an IMPLEMENT delegation, stamp
          // the envelope with the deterministic evidence verdict. The sub-agent
          // executes the commands and writes the configured evidence path (the
          // legacy change path for sequential calls, branch-specific in parallel);
          // this plugin only validates the artifact — prose never counts.
          let validation: ValidationVerdict | null = null
          if (args.phase === "IMPLEMENT" && policyGate) {
            validation = validateValidationEvidence({
              workspaceDir: workspaceRoot,
              change: policyGate.change,
              tier: policyGate.risk_tier,
              frozenDiffRef: policyGate.frozen_diff_ref,
              evidencePath: fastLaneBuild
                ? fastLaneEvidenceRelativePath(policyGate.change, "targeted")
                : executionOptions.validation_evidence_path,
              ...(fastLaneBuild ? {
                expectedPhase: "IMPLEMENT" as const,
                requiredCommandKind: "targeted" as const,
              } : {}),
            })
          }
          const proofBacked = gatedPhase && args.workflow_advance !== undefined
           const innerDisposition = innerResultDisposition(taskResult.result)
           const actualResultStatus = innerDisposition.resultStatus
           let workflowCommit: WorkflowCommitResult | null = null
           let workflowMaterialization: LegacyWorkflowMaterialization | null = null
           const settleProofFailure = (summary: string, reason: string, disposition?: InnerResultDisposition, extra: Record<string, unknown> = {}): string => {
            if (acquiredAttempt && !executionOptions.suppress_attempt_settlement) {
              settleAttempt(
                acquiredAttempt,
                "failed",
                disposition?.failureResultStatus || "validation-failed",
                disposition?.failureReason || "validation-failed",
              )
            }
            const receipt = proofBacked && !executionOptions.suppress_failure_receipt
              ? persistWorkflowFailureReceipt(
                workspaceRoot,
                changeName!,
                args.phase as ODFReceipt["phase"],
                summary,
                policyGate,
               validation ? [fastLaneBuild
                 ? fastLaneEvidenceRelativePath(changeName!, "targeted")
                 : validationEvidenceRelativePath(changeName!, executionOptions.branch_id)] : [],
              disposition?.failureReceiptStatus || "blocked",
              disposition ? "error" : "validation-failed",
              expectationsIds,
            )
              : null
            recordLifecycle("finished", {
              status: disposition?.metricStatus || "blocked",
              warnings: phaseWarnings.length ? phaseWarnings : undefined,
              error: reason,
            })
            return JSON.stringify({
              status: "blocked",
              reason,
              phase: args.phase,
              agent: agentName,
              skills_injected: skills.map(s => s.name),
              profile: profilePayload,
              policy_gate: policyGate,
              validation,
              receipt,
              task_api_source: taskApiInfo.source,
              result: resultForOutput,
               workflow_advance: workflowResult,
                workflow_commit: workflowCommit,
                ...(phaseWarnings.length ? { warnings: phaseWarnings } : {}),
                message: summary,
                ...extra,
             }, null, 2)
           }

           if (sourceAuthorityRequired && innerDisposition.accepted && sourceAuthorityRoots) {
             const authority = validateSourceAuthority({
               result: taskResult.result,
               task: args.prompt,
               contextFiles: args.context_files,
               roots: sourceAuthorityRoots,
             })
             if (!authority.ok || !authority.envelope) {
               const rawAuthority = taskResult.result && typeof taskResult.result === "object" && !Array.isArray(taskResult.result)
                 ? (taskResult.result as Record<string, unknown>).source_authority
                 : null
               resultForOutput = replaceSourceAuthority(taskResult.result, scrubSourceAuthority(rawAuthority))
               return settleProofFailure(
                 `Source authority blocked: ${authority.reason || "deterministic lookup did not verify the action relation"}. Return the required structured evidence and retry.`,
                 "source-authority-invalid",
               )
             }
             resultForOutput = replaceSourceAuthority(taskResult.result, authority.envelope)
           }

           const designResult = resultForOutput && typeof resultForOutput === "object"
             ? resultForOutput as Record<string, unknown>
            : null
          if ((args.phase === "DESIGN" || args.phase === "PLAN") && innerDisposition.accepted && !asBoolean(designResult?.design_closed)) {
            return settleProofFailure(
              "DESIGN/PLAN must return design_closed: true. Resolve the listed open design decisions and continue DESIGN.",
              "design-not-closed",
            )
          }

          // Artifact-ref enforcement: claimed OpenSpec refs must exist on disk.
          // Engram topics cannot be verified here (warning only); a result with
          // no claimed refs is a warning, not a blocker (legacy agents).
          if (innerDisposition.accepted && designResult) {
            const rawRefs = Array.isArray(designResult.artifacts_saved) ? designResult.artifacts_saved
              : Array.isArray(designResult.artifact_refs) ? designResult.artifact_refs : []
            const refs = rawRefs
              .map((entry: unknown): string | null => {
                if (typeof entry === "string") return entry
                if (entry && typeof entry === "object" && !Array.isArray(entry)) {
                  const record = entry as Record<string, unknown>
                  const ref = (record.artifact_ref as Record<string, unknown> | undefined)?.ref ?? record.ref
                  return typeof ref === "string" ? ref : null
                }
                return null
              })
              .filter((ref: string | null): ref is string => Boolean(ref))
            const missingOpenSpec = refs.filter(ref =>
              ref.startsWith("openspec/") && !fsSync.existsSync(path.join(workspaceRoot, ref)))
            if (missingOpenSpec.length > 0) {
              return settleProofFailure(
                `Claimed artifact_ref(s) do not exist on disk: ${missingOpenSpec.join(", ")}. Persist the phase artifact in the selected store and retry.`,
                "artifact-ref-missing",
              )
            }
             if (refs.length === 0 && ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT"].includes(args.phase)) {
               phaseWarnings.push("missing-artifact-refs")
             }
           }

           if (innerDisposition.accepted && (args.phase === "ASSESS" || args.phase === "DESIGN") && changeName) {
             workflowMaterialization = await materializeLegacyCanonicalBoundary({
               workspaceRoot,
               changeName,
               phase: args.phase,
               artifactStore: args.artifact_store,
             })
             if (workflowMaterialization?.status === "blocked") {
               return settleProofFailure(
                 workflowMaterialization.message,
                 workflowMaterialization.reason,
                 undefined,
                 { workflow_materialization: workflowMaterialization },
               )
             }
           }

           if (!innerDisposition.accepted && !proofBacked && policyGate && !executionOptions.suppress_failure_receipt) {
            persistWorkflowFailureReceipt(
              workspaceRoot,
              changeName!,
              args.phase as ODFReceipt["phase"],
              innerDisposition.message,
              policyGate,
              [],
              innerDisposition.failureReceiptStatus,
              "error",
            )
          }
          if (proofBacked && !executionOptions.suppress_workflow_commit) {
            const lifecycle = await resolveProofBackedLifecycle({
              workspaceRoot,
              changeName: changeName!,
              artifactStore: args.artifact_store!,
              proof: effectiveWorkflowAdvance!,
              expectedStage: args.phase === "IMPLEMENT" ? "BUILD" : "VERIFY",
              callerResult: workflowResult!,
              innerResultStatus: actualResultStatus,
               validationStatus: "verified",
               validation,
               target: args.target || effectiveWorkflowAdvance?.target,
               governance_acknowledgment: args.governance_acknowledgment || effectiveWorkflowAdvance?.governance_acknowledgment,
               expectationsIds,
            })
            const preCommitFailure = !innerDisposition.accepted ||
              args.phase === "IMPLEMENT" && validation?.status !== "verified"
            if (lifecycle.status === "blocked") {
              if (!preCommitFailure) workflowCommit = lifecycle
              return settleProofFailure(
                !innerDisposition.accepted ? innerDisposition.message : lifecycle.message,
                lifecycle.reason,
                !innerDisposition.accepted ? innerDisposition : undefined,
              )
            }
            workflowCommit = lifecycle
            validation = lifecycle.validation
          }
          if (acquiredAttempt && !executionOptions.suppress_attempt_settlement) {
            settleAttempt(acquiredAttempt, "completed", "delegated", "task-completed")
          }
          recordLifecycle("finished", {
            status: innerDisposition.metricStatus,
            warnings: phaseWarnings.length ? phaseWarnings : undefined,
            candidate_digest: policyGate?.candidate_digest ?? undefined,
          })
          return JSON.stringify({
            status: "delegated",
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
            profile: profilePayload,
             policy_gate: policyGate,
             validation,
             task_api_source: taskApiInfo.source,
              result: resultForOutput,
               ...(workflowResult ? { workflow_advance: workflowResult } : {}),
               ...(workflowMaterialization ? { workflow_materialization: workflowMaterialization } : {}),
               ...(proofBacked ? {
               workflow_commit: workflowCommit || (executionOptions.suppress_workflow_commit
                 ? { status: "deferred", reason: "parallel-aggregate-commit" }
                 : null),
              } : {}),
              ...(phaseWarnings.length ? { warnings: phaseWarnings } : {}),
            }, null, 2)
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          const isTimeout = errorMessage.includes("timed out")
          const isCancelled = isCancellationMessage(errorMessage)
          const isEmpty = errorMessage.startsWith("empty-task-result")
          const reason = isCancelled
            ? "task-cancelled"
            : isEmpty
              ? "empty-task-result"
              : undefined
          if (acquiredAttempt && !executionOptions.suppress_attempt_settlement) {
            const ledgerResultStatus: Exclude<AttemptLedgerResultStatus, "running"> = isTimeout
              ? "timeout"
              : isCancelled
                ? "cancelled"
                : errorMessage.startsWith("empty-task-result")
                  ? "empty-task-result"
                  : "error"
            const ledgerReason: Exclude<AttemptLedgerReason, "acquired"> = isTimeout
              ? "task-timeout"
              : isCancelled
                ? "task-cancelled"
                : isEmpty
                  ? "empty-task-result"
                  : "task-error"
            settleAttempt(acquiredAttempt, "failed", ledgerResultStatus, ledgerReason)
          }
          recordLifecycle("finished", {
            status: isTimeout ? "timeout" : isCancelled || isEmpty ? "blocked" : "error",
            candidate_digest: policyGate?.candidate_digest ?? undefined,
            error: errorMessage,
          })
          // Receipt auto-seal (slice 4): persist a failure disposition so the
          // learning loop does not depend on orchestrator memory. Best-effort.
          if (policyGate && !executionOptions.suppress_failure_receipt) {
            const receipt: ODFReceipt = {
              change: policyGate.change,
              phase: args.phase as ODFReceipt["phase"],
              status: isCancelled || isEmpty ? "blocked" : "failed",
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
            status: isTimeout ? "timeout" : isCancelled || isEmpty ? "blocked" : "error",
            reason,
            phase: args.phase,
            agent: agentName,
            skills_injected: skills.map(s => s.name),
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

      const message = "SDK session delegation is unavailable. Restart OpenCode after loading the plugin, then retry the delegation."
      if (acquiredAttempt && !executionOptions.suppress_attempt_settlement) {
        settleAttempt(acquiredAttempt, "failed", "task-api-unavailable", "task-api-unavailable")
      }
      recordLifecycle("finished", {
        status: "blocked",
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

interface ParallelBranchDescriptor {
  branch_id: string
  attempt_id: string
  prompt: string
  context_files?: string[]
  timeout_ms?: number
}

interface ParallelBranchOutcome {
  branch_id: string
  attempt_id: string
  status: string
  result_status: string | null
  successful: boolean
  validation: ValidationVerdict | null
  validation_verified: boolean
  validation_evidence_ref: string
  summary: string
  attempt_ledger_ref: string
  policy_gate: PolicyGateDecision | null
}

type ParallelTelemetryCohort = Pick<DelegationMetricInput, "odoo_version" | "workspace" | "source_authority">

function savedParallelOutcome(branch: ParallelJoinArtifact["branches"][number]): ParallelBranchOutcome {
  return {
    branch_id: branch.branch_id,
    attempt_id: branch.attempt_id,
    status: branch.outcome.status,
    result_status: branch.outcome.result_status,
    successful: branch.outcome.successful,
    validation: branch.outcome.validation,
    validation_verified: branch.outcome.validation_verified,
    validation_evidence_ref: branch.outcome.validation_evidence_ref,
    summary: branch.outcome.summary,
    attempt_ledger_ref: branch.outcome.attempt_ledger_ref,
    policy_gate: null,
  }
}

function freshParallelAttemptId(): string {
  return `retry-${nodeCrypto.randomUUID().replace(/-/g, "")}`
}

function buildParallelJoinArtifact(
  change: string,
  descriptors: ParallelBranchDescriptor[],
  outcomes: ParallelBranchOutcome[],
  join: ParallelJoinArtifact["join"],
  receiptRef: string | null,
): ParallelJoinArtifact {
  return {
    schema_version: 1,
    change,
    work_type: "cross-domain",
    phase: "IMPLEMENT",
    timestamp: new Date().toISOString(),
    join,
    branches: descriptors.map((descriptor, index) => {
      const outcome = outcomes[index]
      return {
        branch_id: descriptor.branch_id,
        attempt_id: descriptor.attempt_id,
        descriptor: {
          prompt: descriptor.prompt,
          context_files: descriptor.context_files || [],
          ...(descriptor.timeout_ms === undefined ? {} : { timeout_ms: descriptor.timeout_ms }),
        },
        outcome: {
          status: outcome.status,
          result_status: outcome.result_status,
          successful: outcome.successful,
          validation: outcome.validation,
          validation_verified: outcome.validation_verified,
          validation_evidence_ref: outcome.validation_evidence_ref,
          attempt_ledger_ref: outcome.attempt_ledger_ref,
          summary: outcome.summary,
        },
        status: outcome.successful ? "complete" : outcome.status === "running" ? "running" : "failed",
      }
    }),
    evidence_refs: Array.from(new Set(outcomes.map(outcome => outcome.validation_evidence_ref))),
    attempt_ledger_refs: Array.from(new Set(outcomes.map(outcome => outcome.attempt_ledger_ref))),
    receipt_ref: receiptRef,
  }
}

function saveParallelJoin(
  workspaceRoot: string,
  change: string,
  descriptors: ParallelBranchDescriptor[],
  outcomes: ParallelBranchOutcome[],
  join: ParallelJoinArtifact["join"],
  receiptRef: string | null,
): { ref: string; error: string | null } {
  const ref = parallelJoinArtifactRef(change)
  const error = writeParallelJoinArtifact(
    workspaceRoot,
    buildParallelJoinArtifact(change, descriptors, outcomes, join, receiptRef),
  )
  return { ref, error }
}

const PARALLEL_SUCCESS_STATUSES = new Set([
  "ok",
  "warning",
])

function boundedSummary(value: unknown): string {
  let summary = typeof value === "string" ? value : ""
  if (!summary && value !== undefined && value !== null) {
    try { summary = JSON.stringify(value) } catch { summary = String(value) }
  }
  summary = summary.replace(/\s+/g, " ").trim()
  return summary.length > 200 ? `${summary.slice(0, 197)}...` : summary
}

function parseDelegateEnvelope(output: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(output)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Keep the bounded fallback envelope below.
  }
  return { status: "error", message: boundedSummary(output) || "parallel branch returned no envelope" }
}

function makeParallelOutcome(
  change: string,
  descriptor: ParallelBranchDescriptor,
  output: string,
  attempt: AcquiredAttempt,
  workspaceRoot: string,
): ParallelBranchOutcome {
  const envelope = parseDelegateEnvelope(output)
  const validation = envelope.validation && typeof envelope.validation === "object" && !Array.isArray(envelope.validation)
    ? envelope.validation as ValidationVerdict
    : null
  const result = envelope.result && typeof envelope.result === "object" ? envelope.result as Record<string, unknown> : null
  const resultStatus = typeof result?.status === "string" ? result.status.toLowerCase() : null
  const successful = envelope.status === "delegated" &&
    resultStatus !== null && PARALLEL_SUCCESS_STATUSES.has(resultStatus)
  const summary = boundedSummary(envelope.message) ||
    boundedSummary(envelope.reason) ||
    boundedSummary(result?.executive_summary) ||
    boundedSummary(result?.message) ||
    boundedSummary(envelope.status) ||
    "parallel branch returned no summary"
  return {
    branch_id: descriptor.branch_id,
    attempt_id: descriptor.attempt_id,
    status: typeof envelope.status === "string" ? envelope.status : "error",
    result_status: resultStatus,
    successful,
    validation,
    validation_verified: validation?.status === "verified",
    validation_evidence_ref: validationEvidenceRelativePath(change, descriptor.branch_id),
    summary,
    attempt_ledger_ref: path.relative(workspaceRoot, attempt.ledgerPath),
    policy_gate: envelope.policy_gate && typeof envelope.policy_gate === "object"
      ? envelope.policy_gate as PolicyGateDecision
      : null,
  }
}

function recordParallelJoinMetrics(
  sessionId: string | undefined,
  startTime: number,
  status: ParallelJoinArtifact["join"]["status"],
  expected: number,
  outcomes: ParallelBranchOutcome[],
  telemetryContext: TelemetryExecutionContext | null = null,
  telemetryCohort: ParallelTelemetryCohort = {},
): void {
  if (!sessionId || expected < 2 || expected > PARALLEL_BUILD_CONCURRENCY) return
  const completed = Math.min(expected, outcomes.filter(outcome => outcome.successful).length)
  const running = Math.min(expected - completed, outcomes.filter(outcome => outcome.status === "running").length)
  const failed = Math.min(expected - completed - running, Math.max(0, expected - completed - running))
  const validated = Math.min(expected, outcomes.filter(outcome => outcome.successful && outcome.validation_verified).length)
  recordMetrics({
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    phase: "IMPLEMENT",
    agent: "scheduler",
    skills_injected: [],
    skill_resolution: "none",
    duration_ms: Math.max(0, Date.now() - startTime),
    token_estimate: 0,
    status: status === "complete" ? "ok" : "blocked",
    task_api_source: "unavailable",
    work_type: "cross-domain",
    join_status: status,
    join_expected: expected,
    join_completed: completed,
    join_failed: failed,
    join_running: running,
    validation_ratio: validated / expected,
    ...telemetryCohort,
    ...(telemetryContext ? {
      event: "run" as const,
      run_id: telemetryContext.run_id,
      trace_id: telemetryContext.trace_id,
      span_id: telemetryContext.span_id,
    } : {}),
  })
}

function recordSchedulerLifecycle(
  sessionId: string | undefined,
  telemetryContext: TelemetryExecutionContext | null,
  lifecycle: "started" | "finished",
  startTime: number,
  status: DelegationMetrics["status"],
  error?: string,
  change?: string,
  telemetryCohort: ParallelTelemetryCohort = {},
): void {
  if (!sessionId || !telemetryContext) return
  // M0 Slice 2: the scheduler run is the parallel BUILD funnel anchor. The
  // change tag lets the reader pair it with the sequential entry/verify
  // milestones; only the start maps to a funnel stage (build_started).
  const flowStage = resolveFlowStage("IMPLEMENT", lifecycle)
  recordMetrics({
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    phase: "IMPLEMENT",
    agent: "scheduler",
    skills_injected: [],
    skill_resolution: "none",
    duration_ms: lifecycle === "started" ? 0 : Math.max(0, Date.now() - startTime),
    token_estimate: 0,
    status,
    task_api_source: "unavailable",
    work_type: "cross-domain",
    ...telemetryCohort,
    event: "run",
    lifecycle,
    ...(change ? { change } : {}),
    ...(flowStage ? { flow_stage: flowStage } : {}),
    run_id: telemetryContext.run_id,
    trace_id: telemetryContext.trace_id,
    span_id: telemetryContext.span_id,
    ...(error ? { error } : {}),
  })
}

function recordBranchLifecycle(
  sessionId: string | undefined,
  telemetryContext: TelemetryExecutionContext | null,
  branch: ParallelBranchDescriptor,
  lifecycle: "started" | "finished",
  startTime: number,
  spanId: string,
  status: DelegationMetrics["status"],
  error?: string,
  telemetryCohort: ParallelTelemetryCohort = {},
): void {
  if (!sessionId || !telemetryContext) return
  recordMetrics({
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    phase: "IMPLEMENT",
    agent: "branch",
    skills_injected: [],
    skill_resolution: "none",
    duration_ms: lifecycle === "started" ? 0 : Math.max(0, Date.now() - startTime),
    token_estimate: 0,
    status,
    task_api_source: "unavailable",
    work_type: "cross-domain",
    ...telemetryCohort,
     branch_id: branch.branch_id,
     attempt_id: branch.attempt_id,
     event: "span",
     span_kind: "branch",
     lifecycle,
    run_id: telemetryContext.run_id,
    trace_id: telemetryContext.trace_id,
    span_id: spanId,
    parent_span_id: telemetryContext.span_id,
    ...(error ? { error } : {}),
  })
}

function parallelReceipt(
  workspaceRoot: string,
  change: string,
  outcomes: ParallelBranchOutcome[],
): ODFReceipt {
  const summaries = Object.fromEntries(outcomes.map(outcome => [outcome.branch_id, outcome.summary]))
  const validationEvidenceRefs = Array.from(new Set(outcomes.map(outcome => outcome.validation_evidence_ref)))
  const refs = Array.from(new Set([
    path.join(".odf", `attempt-ledger-${change}.jsonl`),
    ...validationEvidenceRefs,
    ...outcomes.map(outcome => outcome.policy_gate ? path.join(".odf", `policy-gate-${change}.json`) : ""),
  ].filter(Boolean)))
  const validationFailed = outcomes.some(outcome => outcome.successful && !outcome.validation_verified)
  const timedOut = outcomes.some(outcome => outcome.status === "timeout")
  const summary = boundedSummary(
    `Parallel BUILD blocked: ${outcomes.map(outcome => `${outcome.branch_id}: ${outcome.summary}`).join("; ")}`,
  )
  const firstPolicyGate = outcomes.find(outcome => outcome.policy_gate)?.policy_gate || null
  return {
    change,
    phase: "IMPLEMENT",
    status: "blocked",
    cause: validationFailed ? "validation-failed" : timedOut ? "timeout" : "error",
    evidence: {
      summary,
      frozen_diff_ref: firstPolicyGate?.frozen_diff_ref || gitHead(workspaceRoot),
      failing: outcomes
        .filter(outcome => !outcome.successful || !outcome.validation_verified)
        .map(outcome => outcome.branch_id),
      refs,
    },
    action: null,
    review_gate: null,
    frozen_diff_ref: firstPolicyGate?.frozen_diff_ref || gitHead(workspaceRoot),
    resolved_at: new Date().toISOString(),
    parallel: {
      branch_ids: outcomes.map(outcome => outcome.branch_id),
      summaries,
      attempt_ledger_refs: Array.from(new Set(outcomes.map(outcome => outcome.attempt_ledger_ref))),
      validation_evidence_refs: validationEvidenceRefs,
    },
  }
}

function createODFParallelDelegate(client?: OpencodeClient, canonicalDirectory?: string): ReturnType<typeof tool> {
  return tool({
    description: `Run a bounded cross-domain IMPLEMENT BUILD with 2-3 independent branches.

The shared workflow_advance proof must advance cross-domain to BUILD. Branch context files
must not overlap. VERIFY remains sequential after the aggregate join is complete.`,
    args: {
      work_type: tool.schema
        .enum(["cross-domain"])
        .describe("Only cross-domain work can use the parallel BUILD scheduler"),
      phase: tool.schema
        .enum(["IMPLEMENT"])
        .describe("Only IMPLEMENT is parallelized; VERIFY remains sequential"),
      target: tool.schema.enum(["oca"]).optional().describe("Explicit governance target"),
      governance_acknowledgment: governanceAcknowledgmentSchema.optional().describe("Explicit final human OCA acknowledgment"),
      change: tool.schema
        .string()
        .describe("Shared change name (kebab-case)"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Selected project directory (defaults to the plugin directory, then cwd)"),
      odoo_source_root: tool.schema
        .string()
        .optional()
        .describe("Explicit Odoo source root required for view-authority branches"),
      odoo_source_repos: tool.schema
        .string()
        .optional()
        .describe("Optional explicit active Odoo repos root for view-authority branches"),
      artifact_store: tool.schema
        .enum(["openspec", "engram", "hybrid"])
        .describe("Authoritative workflow store for the aggregate transition"),
      workflow_advance: tool.schema
        .object({
          work_type: tool.schema.enum(["cross-domain"]),
          target: tool.schema.enum(["oca"]).optional(),
          completed_stages: tool.schema.array(tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY"])),
          candidate_stage: tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY"]).nullable(),
          phase_result_status: tool.schema.enum(["ok", "warning", "blocked", "failed"]),
          validation_status: tool.schema.enum(["verified", "missing", "invalid", "not-required"]),
          receipt_state: tool.schema.enum(["none", "pending", "resolved"]),
          resumable_state: tool.schema.boolean(),
          archived_state: tool.schema.boolean(),
        })
        .describe("Exact shared transition proof; it must advance to BUILD"),
      branches: tool.schema
        .array(tool.schema.object({
          branch_id: tool.schema.string().describe("Unique safe branch identifier"),
          attempt_id: tool.schema.string().describe("Fresh safe attempt identifier"),
          prompt: tool.schema.string().describe("Full branch prompt"),
          context_files: tool.schema.array(tool.schema.string()).optional().describe("Non-overlapping branch context files"),
          timeout_ms: tool.schema.number().optional().describe("Optional branch task timeout in milliseconds"),
        }))
        .optional()
        .describe("Two or three independent branch descriptors; omitted when resuming from a persisted join"),
      resume_from_join: tool.schema
        .boolean()
        .optional()
        .describe("Reconstruct retryable branches from .odf/parallel-join-{change}.json without conversation context"),
    },
    async execute(args: {
      work_type: "cross-domain"
      phase: "IMPLEMENT"
      target?: "oca"
      governance_acknowledgment?: GovernanceAcknowledgment
      change: string
      workspace_dir?: string
      odoo_source_root?: string
      odoo_source_repos?: string
      artifact_store: ArtifactStore
      workflow_advance: ODFDelegateWorkflowAdvance
      branches?: ParallelBranchDescriptor[]
      resume_from_join?: boolean
    }, toolCtx: ToolContext): Promise<string> {
      const startTime = Date.now()
      let expected = Array.isArray(args.branches) ? args.branches.length : 0
      let persistedJoinRef: string | null = null
      const workspaceRoot = resolveSelectedWorkspaceRoot(args.workspace_dir, canonicalDirectory)
      const detectedOdooVersion = workspaceRoot ? await detectOdooVersion(workspaceRoot) : null
      const sourceAuthorityRequiredForTelemetry = Array.isArray(args.branches) && args.branches.some(branch =>
        isViewAuthorityWork("IMPLEMENT", branch.prompt, branch.context_files || []))
      const schedulerTelemetryCohort: ParallelTelemetryCohort = {
        ...(workspaceRoot ? { workspace: workspaceProjectName(workspaceRoot) } : {}),
        ...(detectedOdooVersion ? { odoo_version: detectedOdooVersion } : {}),
        source_authority: Boolean(workspaceRoot && sourceAuthorityRequiredForTelemetry && establishSourceAuthorityRoots({
          workspaceRoot,
          sourceRoot: args.odoo_source_root,
          reposRoot: args.odoo_source_repos,
        }).ok),
      }
      const schedulerTelemetryContext: TelemetryExecutionContext | null = toolCtx?.sessionID
        ? {
          event: "run",
          trace_id: createTelemetryTraceId(),
          run_id: createTelemetryRunId(),
          span_id: createTelemetrySpanId(),
        }
        : null
      let schedulerLifecycleFinished = false
      const finishScheduler = (status: DelegationMetrics["status"], error?: string): void => {
        if (schedulerLifecycleFinished) return
        schedulerLifecycleFinished = true
        recordSchedulerLifecycle(toolCtx?.sessionID, schedulerTelemetryContext, "finished", startTime, status, error, args.change, schedulerTelemetryCohort)
      }
      recordSchedulerLifecycle(toolCtx?.sessionID, schedulerTelemetryContext, "started", startTime, "ok", undefined, args.change, schedulerTelemetryCohort)
      flushMetricsSync()
      const blocked = (
        reason: string,
        message: string,
        outcomes: ParallelBranchOutcome[] = [],
        receipt: ODFReceipt | null = null,
        joinStatus: "blocked" | "running" = "blocked",
      ): string => {
        recordParallelJoinMetrics(toolCtx?.sessionID, startTime, joinStatus, expected, outcomes, schedulerTelemetryContext, schedulerTelemetryCohort)
        finishScheduler("blocked", message)
        const completed = outcomes.filter(outcome => outcome.successful).length
        const running = outcomes.filter(outcome => outcome.status === "running").length
        const failed = Math.max(0, expected - completed - running)
        return JSON.stringify({
          status: "blocked",
          work_type: args.work_type,
          phase: args.phase,
          reason,
          message,
          branches: outcomes,
          join: {
            status: joinStatus,
            expected,
            completed,
            failed,
            running,
            validation_verified: outcomes.length === expected && outcomes.every(outcome => outcome.successful && outcome.validation_verified),
            evidence_refs: Array.from(new Set(outcomes.map(outcome => outcome.validation_evidence_ref))),
            artifact_ref: persistedJoinRef,
          },
          receipt,
          parallel_join_ref: persistedJoinRef,
        }, null, 2)
      }

      if (!toolCtx?.sessionID) return blocked("session-required", "odf_parallel_delegate requires sessionID")
      if (args.work_type !== "cross-domain") return blocked("parallel-work-type-unsupported", "Only cross-domain work can use the parallel BUILD scheduler.")
      if (args.phase !== "IMPLEMENT") return blocked("parallel-phase-unsupported", "Only IMPLEMENT can use the parallel BUILD scheduler; VERIFY remains sequential.")
      if (!isSafeToken(args.change)) return blocked("unsafe-change-name", "The shared change name must be a safe token.")
      if (args.artifact_store !== "openspec" && args.artifact_store !== "engram" && args.artifact_store !== "hybrid") {
        return blocked("artifact-store-required", "Parallel proof-backed BUILD requires an explicit artifact_store: openspec, engram, or hybrid.")
      }

      if (!workspaceRoot) {
        return blocked("unsafe-workspace-path", "The workspace directory does not resolve to a safe existing root.")
      }
      if (!args.workflow_advance || args.workflow_advance.work_type !== "cross-domain") {
        return blocked("parallel-workflow-proof-mismatch", "The workflow_advance proof must use work_type cross-domain.")
      }
      const { work_type: callerWorkType, ...callerAdvanceInput } = args.workflow_advance
      const callerResult = advanceWorkflow({
        route: resolveWorkflowRoute(callerWorkType),
        ...callerAdvanceInput,
        // Caller state is only a structural preflight. Persisted state and receipt are authoritative below.
        receipt_state: "resolved",
        resumable_state: true,
        archived_state: false,
      })
      if (callerResult.status !== "advanced") return blocked("workflow-advance-blocked", callerResult.reason)
      if (callerResult.next_stage !== "BUILD") {
        return blocked(
          "workflow-phase-mismatch",
          `Workflow next_stage ${callerResult.next_stage || "none"} does not match IMPLEMENT; expected BUILD.`,
        )
      }
      if (!args.resume_from_join && (!Array.isArray(args.branches) || args.branches.length < 2 || args.branches.length > PARALLEL_BUILD_CONCURRENCY)) {
        return blocked("parallel-branch-count", `The parallel BUILD scheduler requires 2-${PARALLEL_BUILD_CONCURRENCY} branches.`)
      }
      if (args.resume_from_join) {
        if (Array.isArray(args.branches) && args.branches.length > 0) {
          return blocked("parallel-resume-input-mismatch", "Continuation reconstructs branch descriptors from the persisted join; omit branches.")
        }
        const loaded = readParallelJoinArtifact(workspaceRoot, args.change)
        if (loaded.warning) return blocked("parallel-join-invalid", loaded.warning)
        if (!loaded.artifact) return blocked("parallel-join-not-found", "No persisted parallel join exists for this change.")
        if (loaded.artifact.join.status === "running") {
          expected = loaded.artifact.join.expected
          return blocked(
            "parallel-join-running",
            "The persisted parallel join is still running; active branches will not be relaunched.",
            loaded.artifact.branches.map(savedParallelOutcome),
            null,
            "running",
          )
        }
      }
      const selected = await readSelectedWorkflowState(workspaceRoot, args.change, args.artifact_store)
      if (!selected.snapshot) return blocked(selected.error || "workflow-state-unavailable", "The selected workflow state could not be read before launching parallel BUILD.")
      const canonical = canonicalizeWorkflowAdvance(selected.snapshot, args.workflow_advance, "BUILD")
      if ("reason" in canonical) return blocked(canonical.reason, canonical.message)
      const effectiveWorkflowAdvance = canonical.proof
      const { work_type, ...advanceInput } = effectiveWorkflowAdvance
      const workflowResult = advanceWorkflow({
        route: resolveWorkflowRoute(work_type),
        ...advanceInput,
      })
      if (workflowResult.status !== "advanced") {
        return blocked(
          workflowResult.status === "complete" ? "workflow-complete" : "workflow-advance-blocked",
          workflowResult.reason,
        )
      }
      if (workflowResult.next_stage !== "BUILD") {
        return blocked(
          "workflow-phase-mismatch",
          `Workflow next_stage ${workflowResult.next_stage || "none"} does not match IMPLEMENT; expected BUILD.`,
        )
      }
      const transitionStart = inspectPersistedTransition({
        snapshot: selected.snapshot,
        proof: effectiveWorkflowAdvance,
        expectedStage: "BUILD",
        callerResult: workflowResult,
      })
      if (!transitionStart.ok) return blocked(transitionStart.reason, transitionStart.message)

      let savedJoin: ParallelJoinArtifact | null = null
      let descriptors: ParallelBranchDescriptor[] = Array.isArray(args.branches) ? args.branches : []
      let runnableDescriptors = descriptors
      if (args.resume_from_join) {
        if (Array.isArray(args.branches) && args.branches.length > 0) {
          return blocked("parallel-resume-input-mismatch", "Continuation reconstructs branch descriptors from the persisted join; omit branches.")
        }
        const loaded = readParallelJoinArtifact(workspaceRoot, args.change)
        if (loaded.warning) return blocked("parallel-join-invalid", loaded.warning)
        if (!loaded.artifact) return blocked("parallel-join-not-found", "No persisted parallel join exists for this change.")
        savedJoin = loaded.artifact
        expected = savedJoin.join.expected
        persistedJoinRef = parallelJoinArtifactRef(args.change)
        if (savedJoin.join.status === "running") {
          return blocked(
            "parallel-join-running",
            "The persisted parallel join is still running; active branches will not be relaunched.",
            savedJoin.branches.map(savedParallelOutcome),
            null,
            "running",
          )
        }
        if (savedJoin.join.status === "blocked" && selected.snapshot.status.receipt.action !== "retry") {
          return blocked(
            "workflow-retry-disposition-required",
            "A committed retry receipt is required before retrying a blocked parallel join.",
            savedJoin.branches.map(savedParallelOutcome),
          )
        }
        const retryable = savedJoin.branches.filter(branch => !(branch.outcome.successful && branch.outcome.validation_verified))
        descriptors = savedJoin.branches.map(branch => {
          const completed = branch.outcome.successful && branch.outcome.validation_verified
          return {
            branch_id: branch.branch_id,
            attempt_id: completed ? branch.attempt_id : freshParallelAttemptId(),
            prompt: branch.descriptor.prompt,
            context_files: [...branch.descriptor.context_files],
            ...(branch.descriptor.timeout_ms === undefined ? {} : { timeout_ms: branch.descriptor.timeout_ms }),
          }
        })
        runnableDescriptors = descriptors.filter(descriptor => retryable.some(branch => branch.branch_id === descriptor.branch_id))
      }

      if (!args.resume_from_join && (!Array.isArray(args.branches) || args.branches.length < 2 || args.branches.length > PARALLEL_BUILD_CONCURRENCY)) {
        return blocked("parallel-branch-count", `The parallel BUILD scheduler requires 2-${PARALLEL_BUILD_CONCURRENCY} branches.`)
      }
      if (args.resume_from_join && (runnableDescriptors.length > PARALLEL_BUILD_CONCURRENCY || runnableDescriptors.length === 0 && savedJoin?.join.status !== "complete")) {
        return blocked("parallel-join-invalid", "The persisted parallel join has an invalid continuation branch set.")
      }
      if (transitionStart.alreadyCommitted && !args.resume_from_join) {
        finishScheduler("ok")
        return JSON.stringify({
          status: "parallel-delegated",
          work_type: args.work_type,
          phase: args.phase,
          resumed: false,
          branches: [],
          join: { status: "complete", expected, completed: expected, failed: 0, running: 0, validation_verified: true, artifact_ref: null },
          receipt: null,
          workflow_commit: { status: "already-committed", reason: "already-committed", store: args.artifact_store },
          parallel_join_ref: null,
        }, null, 2)
      }

      if (args.resume_from_join && runnableDescriptors.length === 0 && savedJoin) {
        const aggregateStatus = savedJoin.branches.some(branch => branch.outcome.result_status === "warning") ? "warning" : "ok"
        const workflowCommit = await resolveProofBackedLifecycle({
          workspaceRoot,
          changeName: args.change,
          artifactStore: args.artifact_store,
          proof: effectiveWorkflowAdvance,
          expectedStage: "BUILD",
          callerResult: workflowResult,
          innerResultStatus: aggregateStatus,
           validationStatus: "verified",
           validation: { status: "verified", reason: "parallel join validation verified", commands_validated: savedJoin.join.expected },
           target: args.target,
           governance_acknowledgment: args.governance_acknowledgment,
           parallel: true,
        })
        if (workflowCommit.status === "blocked") {
          const receipt = parallelReceipt(workspaceRoot, args.change, savedJoin.branches.map(savedParallelOutcome))
          const mergedReceipt = mergeReceipt(workspaceRoot, receipt)
          return blocked(workflowCommit.reason, workflowCommit.message, savedJoin.branches.map(savedParallelOutcome), mergedReceipt)
        }
        recordParallelJoinMetrics(toolCtx.sessionID, startTime, savedJoin.join.status, expected, savedJoin.branches.map(savedParallelOutcome), schedulerTelemetryContext, schedulerTelemetryCohort)
        finishScheduler("ok")
        return JSON.stringify({
          status: "parallel-delegated",
          work_type: "cross-domain",
          phase: "IMPLEMENT",
          resumed: true,
          branches: savedJoin.branches.map(savedParallelOutcome),
          join: { ...savedJoin.join, artifact_ref: persistedJoinRef },
          receipt: null,
          workflow_commit: workflowCommit,
          parallel_join_ref: persistedJoinRef,
        }, null, 2)
      }

      const seenBranches = new Set<string>()
      const seenAttempts = new Set<string>()
      const seenPaths = new Map<string, string>()
      for (const branch of runnableDescriptors) {
        if (!isSafeToken(branch.branch_id)) return blocked("unsafe-branch-id", "Every branch_id must be a safe token.")
        if (seenBranches.has(branch.branch_id)) return blocked("duplicate-branch-id", `The branch_id "${branch.branch_id}" is duplicated.`)
        seenBranches.add(branch.branch_id)
        if (!isSafeToken(branch.attempt_id)) return blocked("unsafe-attempt-id", `Branch "${branch.branch_id}" requires a fresh safe attempt_id.`)
        if (seenAttempts.has(branch.attempt_id)) return blocked("duplicate-attempt-id", `The attempt_id "${branch.attempt_id}" is duplicated.`)
        seenAttempts.add(branch.attempt_id)
        const contextValidation = validateContextFiles(workspaceRoot, branch.context_files || [])
        if (contextValidation.error) return blocked("invalid-context-files", contextValidation.error)
        for (const contextPath of contextValidation.paths) {
          const owner = seenPaths.get(contextPath)
          if (owner && owner !== branch.branch_id) {
            return blocked("overlapping-context-paths", `Branches "${owner}" and "${branch.branch_id}" share context path "${contextPath}".`)
          }
          seenPaths.set(contextPath, branch.branch_id)
        }
      }

      const registry = await loadRegistry()
      if (!registry) return blocked("registry-unavailable", `ODF registry not found. Run /odf-init or check ${REGISTRY_PATH}`)

      const sourceAuthorityRequired = runnableDescriptors.some(branch =>
        isViewAuthorityWork("IMPLEMENT", branch.prompt, branch.context_files || []))
      let sourceAuthorityRoots: SourceAuthorityRoots | null = null
      if (sourceAuthorityRequired) {
        const roots = establishSourceAuthorityRoots({
          workspaceRoot,
          sourceRoot: args.odoo_source_root,
          reposRoot: args.odoo_source_repos,
        })
        if (!roots.ok) {
          return blocked(
            "source-authority-unavailable",
            `${roots.reason}. Provide the exact odoo_source_root and retry with /odf-continue ${args.change}.`,
          )
        }
        sourceAuthorityRoots = roots.roots
        schedulerTelemetryCohort.source_authority = true
      }

      const acquired = new Map<string, AcquiredAttempt>()
      for (const branch of runnableDescriptors) {
        const acquisition = acquireAttempt({
          workspaceDir: workspaceRoot,
          change: args.change,
          phase: "IMPLEMENT",
          nextStage: "BUILD",
          attemptId: branch.attempt_id,
          branchId: branch.branch_id,
        })
        if (!acquisition.acquired) {
          for (const handle of acquired.values()) settleAttempt(handle, "failed", "error", "task-error")
          const ledgerRef = path.relative(workspaceRoot, attemptLedgerPath(workspaceRoot, args.change))
          const outcomes: ParallelBranchOutcome[] = descriptors.map((descriptor, index) => {
            const saved = savedJoin?.branches[index]
            if (saved && saved.outcome.successful && saved.outcome.validation_verified) return savedParallelOutcome(saved)
            return {
              branch_id: descriptor.branch_id,
              attempt_id: descriptor.attempt_id,
              status: "blocked",
              result_status: null,
              successful: false,
              validation: null,
              validation_verified: false,
              validation_evidence_ref: validationEvidenceRelativePath(args.change, descriptor.branch_id),
              summary: `${acquisition.reason}: ${acquisition.message}`,
              attempt_ledger_ref: ledgerRef,
              policy_gate: null,
            }
           })
          const receipt = parallelReceipt(workspaceRoot, args.change, outcomes)
          const mergedReceipt = mergeReceipt(workspaceRoot, receipt)
          const join = {
            status: "blocked" as const,
            expected,
            completed: outcomes.filter(outcome => outcome.successful).length,
            failed: expected - outcomes.filter(outcome => outcome.successful).length,
            running: 0,
            validation_verified: outcomes.every(outcome => outcome.successful && outcome.validation_verified),
          }
          const savedArtifact = saveParallelJoin(
            workspaceRoot,
            args.change,
            descriptors,
            outcomes,
            join,
            path.join(".odf", `receipt-${args.change}.json`),
          )
           if (savedArtifact.error) return blocked("parallel-join-persist-failed", savedArtifact.error, outcomes, mergedReceipt)
           persistedJoinRef = savedArtifact.ref
           return blocked(acquisition.reason, acquisition.message, outcomes, mergedReceipt)
        }
        acquired.set(branch.branch_id, acquisition.handle)
      }

      const outcomes: ParallelBranchOutcome[] = descriptors.map((descriptor, index) => {
        const saved = savedJoin?.branches[index]
        if (saved && saved.outcome.successful && saved.outcome.validation_verified) return savedParallelOutcome(saved)
        const running = runnableDescriptors.some(runnable => runnable.branch_id === descriptor.branch_id)
        return {
          branch_id: descriptor.branch_id,
          attempt_id: descriptor.attempt_id,
          status: running ? "running" : "blocked",
          result_status: running ? "running" : null,
          successful: false,
          validation: null,
          validation_verified: false,
          validation_evidence_ref: validationEvidenceRelativePath(args.change, descriptor.branch_id),
          summary: running ? "parallel branch is running" : "parallel branch has not completed",
          attempt_ledger_ref: path.relative(workspaceRoot, attemptLedgerPath(workspaceRoot, args.change)),
          policy_gate: null,
        }
      })

      const runningJoin = {
        status: "running" as const,
        expected,
        completed: outcomes.filter(outcome => outcome.successful).length,
        failed: outcomes.filter(outcome => !outcome.successful && outcome.status !== "running").length,
        running: outcomes.filter(outcome => outcome.status === "running").length,
        validation_verified: false,
      }
      const runningArtifact = saveParallelJoin(workspaceRoot, args.change, descriptors, outcomes, runningJoin, null)
      if (runningArtifact.error) {
        for (const handle of acquired.values()) settleAttempt(handle, "failed", "error", "task-error")
        const settledOutcomes = outcomes.map(outcome => outcome.status === "running"
          ? { ...outcome, status: "blocked", result_status: null, summary: "parallel join persistence failed before launch" }
          : outcome)
        return blocked("parallel-join-persist-failed", runningArtifact.error, settledOutcomes)
      }
      persistedJoinRef = runningArtifact.ref
      recordParallelJoinMetrics(toolCtx.sessionID, startTime, "running", expected, outcomes, schedulerTelemetryContext, schedulerTelemetryCohort)

      const persistRunningProgress = (): void => {
        const running = outcomes.filter(outcome => outcome.status === "running").length
        if (running === 0) return
        saveParallelJoin(workspaceRoot, args.change, descriptors, outcomes, {
          status: "running",
          expected,
          completed: outcomes.filter(outcome => outcome.successful).length,
          failed: outcomes.filter(outcome => !outcome.successful && outcome.status !== "running").length,
          running,
          validation_verified: false,
        }, null)
      }

      let nextIndex = 0
      const worker = async (): Promise<void> => {
        while (true) {
          const index = nextIndex++
          if (index >= runnableDescriptors.length) return
          const branch = runnableDescriptors[index]
          const outcomeIndex = descriptors.findIndex(descriptor => descriptor.branch_id === branch.branch_id)
          const validationEvidenceRef = validationEvidenceRelativePath(args.change, branch.branch_id)
          const branchSpanId = createTelemetrySpanId()
          const branchStartTime = Date.now()
          const branchTelemetryCohort: ParallelTelemetryCohort = {
            ...schedulerTelemetryCohort,
            source_authority: Boolean(sourceAuthorityRoots && isViewAuthorityWork("IMPLEMENT", branch.prompt, branch.context_files || [])),
          }
          recordBranchLifecycle(
            toolCtx.sessionID,
            schedulerTelemetryContext,
            branch,
            "started",
            branchStartTime,
            branchSpanId,
            "ok",
            undefined,
            branchTelemetryCohort,
          )
          flushMetricsSync()
          try {
            const output = await createODFDelegate(client, canonicalDirectory, {
              branch_id: branch.branch_id,
              suppress_failure_receipt: true,
              suppress_workflow_commit: true,
              suppress_attempt_settlement: true,
              validation_evidence_path: validationEvidenceRef,
              workflow_result: workflowResult,
              pre_acquired_attempt: acquired.get(branch.branch_id),
              telemetry_context: {
                event: "span",
                trace_id: schedulerTelemetryContext!.trace_id,
                run_id: schedulerTelemetryContext!.run_id,
                span_id: branchSpanId,
                parent_span_id: schedulerTelemetryContext!.span_id,
                emit_lifecycle: false,
              },
            }).execute({
              phase: "IMPLEMENT",
              prompt: `${branch.prompt}\n\nStop-validation evidence: write \`${validationEvidenceRef}\`.`,
              context_files: branch.context_files,
              workspace_dir: workspaceRoot,
                change: args.change,
                artifact_store: args.artifact_store,
                governance_acknowledgment: args.governance_acknowledgment,
                odoo_source_root: sourceAuthorityRoots?.source,
               odoo_source_repos: sourceAuthorityRoots?.repos,
               timeout_ms: branch.timeout_ms,
              attempt_id: branch.attempt_id,
              workflow_advance: args.workflow_advance,
            }, toolCtx)
            const outcome = makeParallelOutcome(args.change, branch, output as string, acquired.get(branch.branch_id)!, workspaceRoot)
            outcomes[outcomeIndex] = outcome
            recordBranchLifecycle(
              toolCtx.sessionID,
              schedulerTelemetryContext,
              branch,
              "finished",
              branchStartTime,
              branchSpanId,
              outcome.successful ? "ok" : outcome.status === "timeout" ? "timeout" : outcome.status === "blocked" ? "blocked" : "error",
              outcome.successful ? undefined : outcome.summary,
              branchTelemetryCohort,
            )
            persistRunningProgress()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const outcome = makeParallelOutcome(
              args.change,
              branch,
              JSON.stringify({ status: "error", message }),
              acquired.get(branch.branch_id)!,
              workspaceRoot,
            )
            outcomes[outcomeIndex] = outcome
            recordBranchLifecycle(
              toolCtx.sessionID,
              schedulerTelemetryContext,
              branch,
              "finished",
              branchStartTime,
              branchSpanId,
              isCancellationMessage(message) ? "blocked" : message.includes("timed out") ? "timeout" : "error",
              message,
              branchTelemetryCohort,
            )
            persistRunningProgress()
          }
        }
      }

      await Promise.allSettled(Array.from({ length: Math.min(PARALLEL_BUILD_CONCURRENCY, runnableDescriptors.length) }, () => worker()))

      const completed = outcomes.filter(outcome => outcome.successful).length
      const failed = expected - completed
      const validationVerified = outcomes.every(outcome => outcome.successful && outcome.validation_verified)
      const joinComplete = completed === expected && failed === 0 && validationVerified
      const join = {
        status: joinComplete ? "complete" as const : "blocked" as const,
        expected,
        completed,
        failed,
        running: 0,
        validation_verified: validationVerified,
      }
      if (joinComplete) {
        const savedArtifact = saveParallelJoin(workspaceRoot, args.change, descriptors, outcomes, join, null)
        if (savedArtifact.error) {
          for (const handle of acquired.values()) settleAttempt(handle, "failed", "error", "task-error")
          return blocked("parallel-join-persist-failed", savedArtifact.error, outcomes)
        }
        persistedJoinRef = savedArtifact.ref
        const aggregateStatus = outcomes.some(outcome => outcome.result_status === "warning") ? "warning" : "ok"
        const workflowCommit = await resolveProofBackedLifecycle({
           workspaceRoot,
           changeName: args.change,
           artifactStore: args.artifact_store,
           proof: effectiveWorkflowAdvance,
           expectedStage: "BUILD",
           callerResult: workflowResult,
          innerResultStatus: aggregateStatus,
           validationStatus: "verified",
           validation: { status: "verified", reason: "parallel join validation verified", commands_validated: expected },
           target: args.target,
           governance_acknowledgment: args.governance_acknowledgment,
           parallel: true,
        })
        if (workflowCommit.status === "blocked") {
          for (const handle of acquired.values()) settleAttempt(handle, "failed", "validation-failed", "validation-failed")
          const receipt = parallelReceipt(workspaceRoot, args.change, outcomes)
          const mergedReceipt = mergeReceipt(workspaceRoot, receipt)
          const blockedJoin = { ...join, status: "blocked" as const, validation_verified: false }
          saveParallelJoin(workspaceRoot, args.change, descriptors, outcomes, blockedJoin, path.join(".odf", `receipt-${args.change}.json`))
          return blocked(workflowCommit.reason, workflowCommit.message, outcomes, mergedReceipt)
        }
        for (const handle of acquired.values()) settleAttempt(handle, "completed", "delegated", "task-completed")
        recordParallelJoinMetrics(toolCtx.sessionID, startTime, "complete", expected, outcomes, schedulerTelemetryContext, schedulerTelemetryCohort)
        finishScheduler("ok")
        return JSON.stringify({
          status: "parallel-delegated",
          work_type: "cross-domain",
          phase: "IMPLEMENT",
          resumed: Boolean(args.resume_from_join),
          branches: outcomes,
          join: {
            ...join,
            completed,
            failed,
            evidence_refs: Array.from(new Set(outcomes.map(outcome => outcome.validation_evidence_ref))),
            artifact_ref: persistedJoinRef,
           },
           receipt: null,
           workflow_commit: workflowCommit,
           parallel_join_ref: persistedJoinRef,
        }, null, 2)
      }

      for (const handle of acquired.values()) settleAttempt(handle, "failed", "validation-failed", "validation-failed")
      const receipt = parallelReceipt(workspaceRoot, args.change, outcomes)
      const mergedReceipt = mergeReceipt(workspaceRoot, receipt)
      const savedArtifact = saveParallelJoin(
        workspaceRoot,
        args.change,
        descriptors,
        outcomes,
        join,
        path.join(".odf", `receipt-${args.change}.json`),
      )
       if (savedArtifact.error) return blocked("parallel-join-persist-failed", savedArtifact.error, outcomes, mergedReceipt)
      persistedJoinRef = savedArtifact.ref
      return blocked(
        failed > 0 ? "parallel-branch-failed" : "parallel-validation-incomplete",
        failed > 0 ? "At least one parallel BUILD branch failed." : "Every parallel BUILD branch must return verified validation before BUILD can close.",
        outcomes,
        mergedReceipt,
      )
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
      debugLog(`[odf-delegation] odf_profile_select: phase=${args.phase} model=${profile.model} temp=${profile.temperature}`)

      return `Phase: ${args.phase}
Model: ${profile.model ?? "current (inherited)"}
Temperature: ${profile.temperature}
Reasoning: ${profile.reasoning ? "enabled" : "disabled"}`
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
// ODF STATUS FROM ENGRAM
// ==========================================

export interface ODFChangeStatus {
  change: string
  phase: string
  artifacts: Record<string, string>  // artifact type → "done" | "pending" | "in-progress"
  applyProgress: { completed: number; total: number }
  lastUpdated: string | null
  workflowStatus: WorkflowStatus
  observability: ObservabilityTimeline
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

const OPEN_SPEC_ARTIFACT_STEMS = new Set([
  "decision", "plan", "build", "verify", "proposal", "propose", "assess", "spec", "qa-plan", "design",
  "tasks", "apply-progress", "implement-progress", "archive-report", "expectations",
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

  /** Recursive bounded scan: files directly in the change dir plus ONE level
   * of artifact subdirectories (design/design.md, qa-plan/plan.md, ...).
   * Symlinks are skipped (Dirent.isDirectory()/isFile() are false for them),
   * so the scan cannot escape the change dir. */
  const scanChangeDir = async (rel = ""): Promise<StatusArtifact[]> => {
    const artifacts: StatusArtifact[] = []
    let entries: Dirent[] = []
    try {
      entries = await fs.readdir(path.join(changeDir, rel), { withFileTypes: true })
    } catch {
      return artifacts
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (rel === "" && entry.name === "state.yaml") continue
      if (entry.isDirectory() && rel === "") {
        artifacts.push(...await scanChangeDir(entry.name))
      } else if (entry.isFile() && isOpenSpecArtifact(entry.name)) {
        const relPath = rel ? path.join(rel, entry.name) : entry.name
        const artifact = await readOpenSpecFile(changeName, changeDir, relPath)
        if (artifact) artifacts.push(artifact)
      }
    }
    return artifacts
  }

  const artifacts = await scanChangeDir()
  return { change: changeName, state, artifacts, warnings: Array.from(new Set(warnings)) }
}

interface EngramObservation {
  content: string
  topic_key?: string
  created_at?: string
  project?: string
}

interface EngramObservationRead {
  observations: EngramObservation[] | null
  error: "engram-cli-unavailable" | "engram-export-timeout" | "engram-export-failed" | "engram-export-invalid" | null
}

function readEngramObservationsWithError(workspaceRoot: string): EngramObservationRead {
  // ponytail: unique tmpdir (not a Date.now() filename) so parallel workers never race the same path
  const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "odf-status-"))
  const tmpFile = path.join(tmpDir, "export.json")
  try {
    execFileSync("engram", ["export", tmpFile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    })
  } catch (error) {
    try { fsSync.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
    const code = (error as NodeJS.ErrnoException).code
    return {
      observations: null,
      error: code === "ENOENT" ? "engram-cli-unavailable" : code === "ETIMEDOUT" ? "engram-export-timeout" : "engram-export-failed",
    }
  }

  try {
    const raw = fsSync.readFileSync(tmpFile, "utf8")
    const parsed: unknown = JSON.parse(raw)
    // `engram export` emits { version, exported_at, sessions, observations, prompts };
    // accept a bare observations array for compatibility with older builds.
    const observations = Array.isArray(parsed)
      ? parsed
      : (parsed as { observations?: unknown } | null)?.observations
    if (!Array.isArray(observations)) return { observations: null, error: "engram-export-invalid" }
    const project = workspaceProjectName(resolveWorkspaceRoot(workspaceRoot))
    const hasProjectMetadata = observations.some(observation =>
      Boolean(observation && typeof observation === "object" && typeof (observation as { project?: unknown }).project === "string")
    )
    const scoped = hasProjectMetadata
      ? observations.filter(observation =>
        Boolean(observation && typeof observation === "object" && (observation as { project?: unknown }).project === project)
      )
      : observations
    return Array.isArray(scoped)
      ? { observations: scoped as EngramObservation[], error: null }
      : { observations: null, error: "engram-export-invalid" }
  } catch {
    return { observations: null, error: "engram-export-invalid" }
  } finally {
    try { fsSync.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

async function readEngramObservations(workspaceRoot: string): Promise<EngramObservation[] | null> {
  return readEngramObservationsWithError(workspaceRoot).observations
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

interface ReceiptFileRead {
  receipt: WorkflowReceipt | null
  malformed: boolean
}

function readReceiptFile(workspaceRoot: string, changeName: string): ReceiptFileRead {
  const receiptPath = path.join(workspaceRoot, ".odf", `receipt-${changeName}.json`)
  try {
    const parsed: unknown = JSON.parse(fsSync.readFileSync(receiptPath, "utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { receipt: null, malformed: true }
    return { receipt: parsed as WorkflowReceipt, malformed: false }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { receipt: null, malformed: false }
      : { receipt: null, malformed: true }
  }
}

function readReceiptJson(workspaceRoot: string, changeName: string): WorkflowReceipt | null {
  const read = readReceiptFile(workspaceRoot, changeName)
  return read.malformed ? { status: "pending" } : read.receipt
}

interface SelectedWorkflowSnapshot {
  store: ArtifactStore
  state: Record<string, unknown>
  stateContent: string
  artifacts: StatusArtifact[]
  status: WorkflowStatus
}

function isFastLanePolicy(value: unknown): value is FastLanePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const policy = value as Record<string, unknown>
  const keys = Object.keys(policy).sort()
  return keys.join("\0") === ["enabled", "executor", "validation", "version"].join("\0") &&
    policy.version === 1 &&
    typeof policy.enabled === "boolean" &&
    policy.executor === FAST_LANE_EXECUTOR &&
    policy.validation === FAST_LANE_VALIDATION
}

function fastLaneRollbackPath(workspaceRoot: string, changeName: string): string {
  return path.join(workspaceRoot, ".odf", `fast-lane-rollback-${changeName}.json`)
}

function fastLanePolicyDigest(policy: FastLanePolicy): string {
  return nodeCrypto.createHash("sha256").update(canonicalWorkflowValue(policy)).digest("hex")
}

function isFastLaneRollback(value: unknown): value is FastLaneRollback {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const rollback = value as Record<string, unknown>
  const keys = Object.keys(rollback).sort()
  return keys.join("\0") === ["approved_by", "artifact_store", "change", "disabled_at", "policy_digest", "reason", "version"].join("\0") &&
    rollback.version === FAST_LANE_ROLLBACK_VERSION &&
    typeof rollback.change === "string" && isSafeToken(rollback.change) &&
    artifactStoreValue(rollback.artifact_store) !== null &&
    typeof rollback.policy_digest === "string" && CANDIDATE_DIGEST_PATTERN.test(rollback.policy_digest) &&
    typeof rollback.disabled_at === "string" && isSafeTimestamp(rollback.disabled_at) && Number.isFinite(new Date(rollback.disabled_at).getTime()) &&
    typeof rollback.approved_by === "string" && rollback.approved_by.trim().length > 0 && rollback.approved_by.length <= 256 && !/[\r\n]/.test(rollback.approved_by) &&
    typeof rollback.reason === "string" && rollback.reason.trim().length >= 20 && rollback.reason.length <= 2000 && !/[\r\n]/.test(rollback.reason)
}

function readFastLaneRollback(workspaceRoot: string, changeName: string): { rollback: FastLaneRollback | null; reason?: string } {
  const rollbackPath = safeWorkspaceStatePath(workspaceRoot, fastLaneRollbackPath(workspaceRoot, changeName))
  if (!rollbackPath) return { rollback: null, reason: "fast-lane-rollback-unsafe-path" }
  let raw: string
  try {
    raw = fsSync.readFileSync(rollbackPath, "utf8")
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { rollback: null }
      : { rollback: null, reason: "fast-lane-rollback-read-failed" }
  }
  try {
    const rollback: unknown = JSON.parse(raw)
    return isFastLaneRollback(rollback) && rollback.change === changeName
      ? { rollback }
      : { rollback: null, reason: "invalid-fast-lane-rollback" }
  } catch {
    return { rollback: null, reason: "invalid-fast-lane-rollback" }
  }
}

function fastLanePolicyFromState(
  state: Record<string, unknown>,
  workspaceRoot?: string,
  changeName?: string,
): { policy: FastLanePolicy | null; rollback?: FastLaneRollback; reason?: string } {
  const policy = Object.prototype.hasOwnProperty.call(state, "fast_lane_policy")
    ? isFastLanePolicy(state.fast_lane_policy) ? state.fast_lane_policy : null
    : null
  if (Object.prototype.hasOwnProperty.call(state, "fast_lane_policy") && !policy) {
    return { policy: null, reason: "invalid-fast-lane-policy" }
  }
  if (!workspaceRoot || !changeName || !policy?.enabled) return { policy }

  const rollback = readFastLaneRollback(workspaceRoot, changeName)
  if (rollback.reason) return { policy: null, reason: rollback.reason }
  if (rollback.rollback) {
    if (policy?.enabled && rollback.rollback.policy_digest !== fastLanePolicyDigest(policy)) {
      return { policy: null, reason: "fast-lane-rollback-policy-mismatch" }
    }
    return { policy: null, rollback: rollback.rollback }
  }
  return { policy }
}

function fastLaneEligibilityFailure(
  workType: WorkType,
  policy: FastLanePolicy | null,
  binding: unknown,
): string | null {
  if (!policy?.enabled) return null
  if (workType !== "small-change") return "fast-lane-work-type-ineligible"
  if (!validateEntryRouteBinding(binding, "small-change")) return "fast-lane-binding-invalid"
  const routeBinding = binding as EntryRouteBinding
  if (typeof routeBinding.candidate_digest !== "string" || !/^[0-9a-f]{64}$/.test(routeBinding.candidate_digest)) {
    return "fast-lane-candidate-unbound"
  }
  if (routeBinding.micro_policy !== "eligible" || routeBinding.missing_facts.length > 0 || routeBinding.blocking_reasons.length > 0) {
    return "fast-lane-binding-ineligible"
  }
  return null
}

function fastLaneCandidateFailure(workspaceRoot: string, changeName: string, binding: unknown): string | null {
  if (!validateEntryRouteBinding(binding, "small-change")) return "fast-lane-binding-invalid"
  const candidateDigest = (binding as EntryRouteBinding).candidate_digest
  if (!candidateDigest) return null
  const currentDigest = candidateDigestOrNull(workspaceRoot, changeName)
  return currentDigest !== null && currentDigest !== candidateDigest ? "fast-lane-binding-stale" : null
}

function fastLaneEvidenceRelativePath(change: string, kind: "targeted" | "full"): string {
  return path.join(".odf", `validation-evidence-${change}-${kind}.json`)
}

export interface ExpectationsVerdict {
  status: "approved" | "missing" | "invalid"
  reason: "approved" | "missing-expectations" | "expectations-not-approved" | "expectations-invalid"
  message: string
  ids: string[]
  approved_by?: string
  approved_at?: string
}

function parseExpectationsArtifact(content: string): Record<string, unknown> | null {
  try {
    const value = parseDocument(content).toJSON()
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/** Pure T9 gate for the selected snapshot; no store or filesystem reads. */
export function evaluateExpectations(snapshot: Pick<SelectedWorkflowSnapshot, "artifacts" | "status">): ExpectationsVerdict {
  const artifact = snapshot.artifacts.find((candidate) => normalizeArtifactKey(candidate.key).type === "expectations")
  if (!artifact) {
    return { status: "missing", reason: "missing-expectations", message: "No human Expectations artifact exists; VERIFY uses legacy REQ-based evaluation.", ids: [] }
  }

  const value = parseExpectationsArtifact(artifact.content)
  const verdict = validateExpectations({
    change: snapshot.status.change,
    artifacts: [{ key: artifact.key, content: artifact.content }],
  })
  if (verdict.status !== "approved") {
    const ids = verdict.ids
    const reason = value?.approved === false ? "expectations-not-approved" : "expectations-invalid"
    return {
      status: "invalid",
      reason,
      message: reason === "expectations-not-approved"
        ? "Human Expectations are not approved; approve them before VERIFY."
        : "The Expectations artifact is invalid or tampered; restore the approved human artifact before VERIFY.",
      ids,
    }
  }
  return {
    status: "approved",
    reason: "approved",
    message: `Approved human Expectations: ${verdict.ids.join(", ")}.`,
    ids: verdict.ids,
    approved_by: typeof value?.approved_by === "string" ? value.approved_by : undefined,
    approved_at: typeof value?.approved_at === "string" ? value.approved_at : undefined,
  }
}

interface OcaGovernanceEvidence {
  target: "oca"
  status: GovernanceCheckResult["status"]
  machine_status: GovernanceCheckResult["status"]
  checked_at: string
  check: {
    status: GovernanceCheckResult["status"]
    source: string
    diff: GovernanceCheckResult["diff"]
    provenance: GovernanceCheckResult["provenance"]
    trailers: GovernanceCheckResult["trailers"]
    warnings: string[]
  }
}

interface OcaGovernanceGate {
  active: boolean
  target?: "oca"
  evidence?: OcaGovernanceEvidence
  failure?: { reason: string; message: string }
}

function normalizedWorkflowTarget(value: unknown): "oca" | null {
  return typeof value === "string" && value.trim().toLowerCase() === "oca" ? "oca" : null
}

const GOVERNANCE_IDENTITY_SECRET = /(?:password|passwd|secret|token|credential|api[_-]?key|private[_-]?key)/i
const GOVERNANCE_AI_IDENTITY = /\b(?:ai|bot|copilot|claude|chatgpt|gpt(?:-[0-9.]+)?|openai|cursor|gemini|anthropic|llama|mistral|codex)\b/i

function safeHumanIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !GOVERNANCE_IDENTITY_SECRET.test(value) &&
    !GOVERNANCE_AI_IDENTITY.test(value)
}

function governanceAcknowledgmentFailure(
  workspaceRoot: string,
  changeName: string,
  acknowledgment?: GovernanceAcknowledgment,
): string | null {
  if (!acknowledgment) return "oca-human-acknowledgment-missing"
  const keys = Object.keys(acknowledgment).sort()
  if (keys.join("\0") !== ["acknowledged_at", "acknowledged_by", "candidate_digest", "target"].join("\0") ||
    acknowledgment.target !== "oca" ||
    !safeHumanIdentity(acknowledgment.acknowledged_by) ||
    !validDate(acknowledgment.acknowledged_at) ||
    !CANDIDATE_DIGEST_PATTERN.test(acknowledgment.candidate_digest)) {
    return "oca-human-acknowledgment-invalid"
  }
  const currentDigest = candidateDigestOrNull(workspaceRoot, changeName)
  if (currentDigest === null) return "oca-candidate-digest-unavailable"
  if (acknowledgment.candidate_digest !== currentDigest) return "oca-candidate-digest-mismatch"
  return null
}

function evaluateOcaGovernanceGate(
  workspaceRoot: string,
  snapshot: SelectedWorkflowSnapshot,
  requestedTarget?: string,
  acknowledgment?: GovernanceAcknowledgment,
): OcaGovernanceGate {
  const persistedTarget = snapshot.state.target
  const persistedOca = normalizedWorkflowTarget(persistedTarget)
  const explicitTarget = typeof requestedTarget === "string" && requestedTarget.trim()
    ? requestedTarget.trim().toLowerCase()
    : null
  const acknowledgmentTarget = acknowledgment?.target === "oca" ? "oca" : null
  if (persistedTarget !== undefined && persistedOca === null) {
    return { active: false, failure: { reason: "workflow-target-invalid", message: "Persisted workflow target is invalid." } }
  }
  if (persistedOca === "oca" && explicitTarget && explicitTarget !== "oca") {
    return { active: false, failure: { reason: "workflow-target-mismatch", message: "The requested target conflicts with persisted target=oca." } }
  }
  if ((explicitTarget === "oca" || acknowledgmentTarget === "oca") && persistedOca === null) {
    return { active: true, target: "oca", failure: { reason: "oca-target-unbound", message: "OCA delivery was requested, but the workflow target is not persistently bound to target=oca." } }
  }
  const active = explicitTarget === "oca" || acknowledgmentTarget === "oca" || persistedOca === "oca"
  if (!active) return { active: false }

  const acknowledgmentFailure = governanceAcknowledgmentFailure(workspaceRoot, snapshot.status.change, acknowledgment)
  if (acknowledgmentFailure) {
    return {
      active: true,
      target: "oca",
      failure: {
        reason: acknowledgmentFailure,
        message: acknowledgmentFailure === "oca-human-acknowledgment-missing"
          ? "OCA delivery requires an explicit final human governance_acknowledgment proof."
          : acknowledgmentFailure === "oca-candidate-digest-mismatch"
            ? "The final OCA acknowledgment is bound to a different candidate digest than the current workspace."
            : "The final OCA governance acknowledgment is malformed or cannot be bound to the current workspace.",
      },
    }
  }

  const check = inspectOcaGovernance(workspaceRoot)
  const machineFailure = ocaGovernanceFailure(check)
  if (machineFailure) {
    return { active: true, target: "oca", failure: { reason: "oca-governance-failed", message: machineFailure } }
  }

  const machineWarnings = check.warnings.filter(warning => !warning.startsWith("Human acknowledgment is unresolved"))
  const machineStatus: GovernanceCheckResult["status"] = check.trailers.recommendations.length || machineWarnings.length ? "warning" : "ok"
  return {
    active: true,
    target: "oca",
    evidence: {
      target: "oca",
      // Preserve the public check's honest status; it remains blocked until
      // its human action is completed outside the machine-only check.
      status: check.status,
      machine_status: machineStatus,
      checked_at: new Date().toISOString(),
      check: {
        status: check.status,
        source: check.source,
        diff: check.diff,
        provenance: check.provenance,
        trailers: check.trailers,
        warnings: check.warnings,
      },
    },
  }
}

interface SelectedWorkflowRead {
  snapshot: SelectedWorkflowSnapshot | null
  error: string | null
}

interface TransitionInspection {
  ok: boolean
  alreadyCommitted: boolean
  reason: string
  message: string
  snapshot: SelectedWorkflowSnapshot
  route: WorkflowRoute
  completed: CanonicalStage[]
}

export interface WorkflowCommitResult {
  status: "committed" | "already-committed" | "blocked"
  reason: string
  message: string
  store: ArtifactStore
  state_ref: string
  canonical_stage: WorkflowStage | null
  completed_stages: CanonicalStage[]
  validation: ValidationVerdict | null
  workflow_result: ReturnType<typeof advanceWorkflow> | null
}

interface LegacyWorkflowMaterialization {
  status: "committed" | "already-committed" | "blocked"
  reason: string
  message: string
  store: ArtifactStore
  state_ref: string
  canonical_stage: WorkflowStage | null
  completed_stages: CanonicalStage[]
  /** P2 adapter diagnostics: what the harness saw when a phase boundary blocked. */
  artifacts_seen?: string[]
}

const LEGACY_CANONICAL_BOUNDARIES: Partial<Record<"ASSESS" | "DESIGN", CanonicalStage>> = {
  ASSESS: "DECIDE",
  DESIGN: "PLAN",
}

const WORKFLOW_LOCK_SUFFIX = ".workflow.lock"

function parseStateDocument(content: string): { state: Record<string, unknown>; document: ReturnType<typeof parseDocument> } | null {
  try {
    const document = parseDocument(content)
    if (document.errors.length > 0 || !isMap(document.contents)) return null
    const value = document.toJSON()
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return { state: value as Record<string, unknown>, document }
  } catch {
    return null
  }
}

function serializeOpenSpecState(document: ReturnType<typeof parseDocument>): string {
  return document.toString({ collectionStyle: "block" })
}

function selectedWorkflowArtifacts(changeName: string, observations: EngramObservation[]): StatusArtifact[] {
  const prefix = `odf/${changeName}/`
  const latest = new Map<string, EngramObservation>()
  for (const observation of observations) {
    if (!observation.topic_key?.startsWith(prefix) || observation.topic_key === `${prefix}state`) continue
    latest.set(observation.topic_key, observation)
  }
  return Array.from(latest.entries()).map(([key, observation]) => ({
    key,
    content: observation.content,
    created: observation.created_at || null,
    source: "engram",
  }))
}

async function readSelectedWorkflowState(
  workspaceRoot: string,
  changeName: string,
  store: ArtifactStore,
): Promise<SelectedWorkflowRead> {
  const receiptRead = readReceiptFile(workspaceRoot, changeName)
  if (receiptRead.malformed) return { snapshot: null, error: "workflow-receipt-malformed" }

  if (store === "openspec" || store === "hybrid") {
    const openSpec = await loadOpenSpecStatus(workspaceRoot, changeName)
    if (openSpec?.state) {
      const parsed = parseStateDocument(openSpec.state.content)
      if (!parsed) return { snapshot: null, error: "workflow-state-malformed" }
      const status = deriveWorkflowStatus({
        change: changeName,
        state: openSpec.state.content,
        artifacts: openSpec.artifacts,
        receipt: receiptRead.receipt,
        source: { state: "openspec", artifacts: [openSpec.state.key, ...openSpec.artifacts.map(artifact => artifact.key)] },
        warnings: openSpec.warnings,
      })
      return {
        snapshot: { store, state: parsed.state, stateContent: openSpec.state.content, artifacts: openSpec.artifacts, status },
        error: null,
      }
    }
    if (store === "openspec") return { snapshot: null, error: "workflow-state-not-found" }
  }

  const observations = await readEngramObservations(workspaceRoot)
  if (!observations) return { snapshot: null, error: "engram-state-unavailable" }
  const stateKey = `odf/${changeName}/state`
  const stateObservation = observations.filter(observation => observation.topic_key === stateKey).at(-1)
  if (!stateObservation) return { snapshot: null, error: "workflow-state-not-found" }
  const parsed = parseStateDocument(stateObservation.content)
  if (!parsed) return { snapshot: null, error: "workflow-state-malformed" }
  const artifacts = selectedWorkflowArtifacts(changeName, observations)
  const status = deriveWorkflowStatus({
    change: changeName,
    state: stateObservation.content,
    artifacts,
    receipt: receiptRead.receipt,
    source: { state: "engram", artifacts: [stateKey, ...artifacts.map(artifact => artifact.key)] },
  })
  return {
    snapshot: { store, state: parsed.state, stateContent: stateObservation.content, artifacts, status },
    error: null,
  }
}

function artifactStoreValue(value: unknown): ArtifactStore | null {
  return value === "openspec" || value === "engram" || value === "hybrid" ? value : null
}

async function resolveBoundArtifactStore(
  workspaceRoot: string,
  changeName: string,
  requested?: ArtifactStore,
): Promise<ArtifactStore | null> {
  if (requested) return requested

  try {
    const openSpec = await loadOpenSpecStatus(workspaceRoot, changeName)
    if (openSpec?.state) {
      const parsed = parseStateDocument(openSpec.state.content)
      return artifactStoreValue(parsed?.state.artifact_store) || "openspec"
    }
  } catch {
    // Fall through to the bound Engram state.
  }

  const read = readEngramObservationsWithError(workspaceRoot)
  const state = read.observations?.filter(observation => observation.topic_key === `odf/${changeName}/state`).at(-1)
  if (!state) return null
  try {
    const parsed = parseStateDocument(state.content)
    return artifactStoreValue(parsed?.state.artifact_store) || "engram"
  } catch {
    return null
  }
}

function writeWorkflowState(
  store: ArtifactStore,
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  canonicalStage: WorkflowStage,
  completedStages: CanonicalStage[],
): string | null {
  if (store === "openspec") {
    return writeOpenSpecWorkflowState(workspaceRoot, changeName, stateContent, workType, canonicalStage, completedStages)
  }
  if (store === "engram") {
    return writeEngramWorkflowState(workspaceRoot, changeName, stateContent, workType, canonicalStage, completedStages)
  }

  const openSpecError = writeOpenSpecWorkflowState(workspaceRoot, changeName, stateContent, workType, canonicalStage, completedStages)
  if (openSpecError) return openSpecError
  return writeEngramWorkflowState(workspaceRoot, changeName, stateContent, workType, canonicalStage, completedStages)
}

async function materializeLegacyCanonicalBoundary(opts: {
  workspaceRoot: string
  changeName: string
  phase: "ASSESS" | "DESIGN"
  artifactStore?: ArtifactStore
}): Promise<LegacyWorkflowMaterialization | null> {
  const target = LEGACY_CANONICAL_BOUNDARIES[opts.phase]
  if (!target) return null

  const store = await resolveBoundArtifactStore(opts.workspaceRoot, opts.changeName, opts.artifactStore)
  if (!store) return null
  const stateRef = workflowStateReference(store, opts.changeName)

  const locked = await withWorkflowLock(opts.workspaceRoot, opts.changeName, async (): Promise<LegacyWorkflowMaterialization | null> => {
    const read = await readSelectedWorkflowState(opts.workspaceRoot, opts.changeName, store)
    if (!read.snapshot) {
      return {
        status: "blocked",
        reason: read.error || "workflow-state-unavailable",
        message: "The bound workflow state could not be read before materializing the legacy phase boundary.",
        store,
        state_ref: stateRef,
        canonical_stage: null,
        completed_stages: [],
      }
    }

    const workType = read.snapshot.status.work_type || read.snapshot.state.work_type
    if (!workType || !WORK_TYPES.includes(workType as WorkType)) {
      return {
        status: "blocked",
        reason: "workflow-work-type-missing",
        message: "The bound workflow state has no valid work_type; the legacy boundary cannot be materialized safely.",
        store,
        state_ref: stateRef,
        canonical_stage: null,
        completed_stages: [],
      }
    }

    const route = resolveWorkflowRoute(workType as WorkType)
    const targetIndex = route.stages.indexOf(target)
    if (targetIndex < 0) return null

    const expectedPrefix = route.stages.slice(0, targetIndex + 1)
    const artifactStatus = deriveWorkflowStatus({
      change: opts.changeName,
      artifacts: read.snapshot.artifacts,
      source: store,
    })
    if (!expectedPrefix.every(stage => artifactStatus.completed_canonical_stages.includes(stage))) {
      // Adapter diagnostics (P2): show what the harness saw so a naming
      // mismatch (e.g. assessment.md vs assess.md) is visible at the block.
      const artifactsSeen = read.snapshot.artifacts.map((artifact) => {
        const normalized = normalizeArtifactKey(artifact.key)
        return normalized.group
          ? `${normalized.original} (${normalized.type} → ${normalized.group})`
          : `${normalized.original} (unrecognized phase artifact)`
      }).slice(0, 12)
      return {
        status: "blocked",
        reason: `workflow-${opts.phase.toLowerCase()}-artifact-not-terminal`,
        message: `${opts.phase} requires terminal artifacts for ${expectedPrefix.join(" and ")}; persist and complete the phase artifacts before continuing. Artifacts seen: ${artifactsSeen.length ? artifactsSeen.join("; ") : "none"}`,
        store,
        state_ref: stateRef,
        canonical_stage: read.snapshot.status.canonical_stage,
        completed_stages: persistedCompletedStages(read.snapshot, route),
        artifacts_seen: artifactsSeen,
      }
    }

    const persisted = persistedCompletedStages(read.snapshot, route)
    const currentIndex = route.stages.indexOf(read.snapshot.status.canonical_stage as CanonicalStage)
    const newStageIndex = Math.max(targetIndex, currentIndex)
    const newStage = route.stages[newStageIndex]
    const newCompleted = route.stages.slice(0, newStageIndex + 1)
    const stateStage = typeof read.snapshot.state.canonical_stage === "string"
      ? read.snapshot.state.canonical_stage.toUpperCase()
      : ""
    const statePhase = typeof read.snapshot.state.phase === "string"
      ? read.snapshot.state.phase.toUpperCase()
      : ""
    if (sameStages(persisted, newCompleted) && stateStage === newStage && statePhase === opts.phase) {
      return {
        status: "already-committed",
        reason: "already-committed",
        message: `The ${opts.phase} boundary is already materialized.`,
        store,
        state_ref: stateRef,
        canonical_stage: newStage,
        completed_stages: newCompleted,
      }
    }

    const parsed = parseStateDocument(read.snapshot.stateContent)
    if (!parsed) {
      return {
        status: "blocked",
        reason: "malformed-state",
        message: "The bound workflow state is malformed and could not be materialized safely.",
        store,
        state_ref: stateRef,
        canonical_stage: read.snapshot.status.canonical_stage,
        completed_stages: persisted,
      }
    }
    parsed.document.set("work_type", workType)
    parsed.document.set("canonical_stage", newStage)
    parsed.document.set("completed_canonical_stages", newCompleted)
    if (newStageIndex === targetIndex) parsed.document.set("phase", opts.phase)
    parsed.document.set("last_updated", new Date().toISOString())
    const writeError = writeWorkflowState(store, opts.workspaceRoot, opts.changeName, serializeOpenSpecState(parsed.document), workType as WorkType, newStage, newCompleted)
    if (writeError) {
      return {
        status: "blocked",
        reason: writeError,
        message: "The canonical legacy phase boundary could not be persisted.",
        store,
        state_ref: stateRef,
        canonical_stage: read.snapshot.status.canonical_stage,
        completed_stages: persisted,
      }
    }
    return {
      status: "committed",
      reason: "committed",
      message: `Materialized ${opts.phase} as ${newStage} in ${store}.`,
      store,
      state_ref: stateRef,
      canonical_stage: newStage,
      completed_stages: newCompleted,
    }
  })

  return locked.locked
    ? locked.value || null
    : {
      status: "blocked",
      reason: locked.error,
      message: "The legacy workflow boundary could not acquire the workflow lock.",
      store,
      state_ref: stateRef,
      canonical_stage: null,
      completed_stages: [],
    }
}

function explicitCompletedStages(state: Record<string, unknown>, route: WorkflowRoute): CanonicalStage[] | null {
  const raw = state.completed_canonical_stages ?? state.completed_stages
  if (!Array.isArray(raw)) return null
  const values = raw.filter((value): value is string => typeof value === "string").map(value => value.toUpperCase())
  if (values.length !== raw.length || values.some(value => !route.stages.includes(value as CanonicalStage))) return null
  return route.stages.filter(stage => values.includes(stage))
}

function persistedCompletedStages(snapshot: SelectedWorkflowSnapshot, route: WorkflowRoute): CanonicalStage[] {
  return explicitCompletedStages(snapshot.state, route) || route.stages.filter(stage => snapshot.status.completed_canonical_stages.includes(stage))
}

function sameStages(left: CanonicalStage[], right: CanonicalStage[]): boolean {
  return left.length === right.length && left.every((stage, index) => stage === right[index])
}

function sameWorkflowAdvanceResult(
  left: ReturnType<typeof advanceWorkflow> | null | undefined,
  right: ReturnType<typeof advanceWorkflow>,
): boolean {
  return Boolean(left) && left!.status === right.status &&
    sameStages(left!.completed_stages, right.completed_stages) &&
    left!.next_stage === right.next_stage && left!.reason === right.reason
}

function workflowStateSignals(snapshot: SelectedWorkflowSnapshot): {
  archived: boolean
  resumable: boolean
  receiptState: WorkflowReceiptState
} {
  const archived = snapshot.status.canonical_stage === "ARCHIVED" || snapshot.state.archived === true ||
    String(snapshot.state.canonical_stage || "").toUpperCase() === "ARCHIVED"
  const abandoned = snapshot.state.abandoned === true || String(snapshot.state.status || "").toLowerCase() === "abandoned"
  const receiptAction = snapshot.status.receipt.action
  const orchestratorDisposition = receiptAction !== null && receiptAction !== "retry"
  return {
    archived,
    resumable: !archived && !abandoned && !orchestratorDisposition && snapshot.state.resumable !== false && snapshot.status.receipt.state !== "pending",
    receiptState: snapshot.status.receipt.state,
  }
}

function canonicalizeWorkflowAdvance(
  snapshot: SelectedWorkflowSnapshot,
  proof: ODFDelegateWorkflowAdvance,
  expectedStage: "BUILD" | "VERIFY",
): { proof: ODFDelegateWorkflowAdvance } | { reason: string; message: string } {
  const receiptAction = snapshot.status.receipt.action
  if (snapshot.status.receipt.state === "pending") {
    return { reason: "workflow-receipt-pending", message: "A receipt is pending user disposition." }
  }
  if (receiptAction && receiptAction !== "retry") {
    return {
      reason: "workflow-receipt-action-unhandled",
      message: `The committed receipt action ${receiptAction} requires orchestrator handling before continuation.`,
    }
  }

  const route = resolveWorkflowRoute(proof.work_type)
  const persistedWorkType = snapshot.status.work_type || snapshot.state.work_type
  if (persistedWorkType && persistedWorkType !== proof.work_type) {
    return {
      reason: "workflow-work-type-mismatch",
      message: `Persisted work_type ${persistedWorkType} does not match ${proof.work_type}.`,
    }
  }
  const signals = workflowStateSignals(snapshot)
  const expectedIndex = route.stages.indexOf(expectedStage)
  const candidateIndex = proof.candidate_stage === null ? -1 : route.stages.indexOf(proof.candidate_stage)
  const persisted = persistedCompletedStages(snapshot, route)
  return {
    proof: {
      ...proof,
      completed_stages: candidateIndex >= 0
        ? route.stages.slice(0, candidateIndex).filter(stage => persisted.includes(stage))
        : expectedIndex < 0 ? persisted : route.stages.slice(0, expectedIndex).filter(stage => persisted.includes(stage)),
      receipt_state: signals.receiptState,
      resumable_state: signals.resumable,
      archived_state: signals.archived,
    },
  }
}

function inspectPersistedTransition(opts: {
  snapshot: SelectedWorkflowSnapshot
  proof: ODFDelegateWorkflowAdvance
  expectedStage: "BUILD" | "VERIFY"
  callerResult: ReturnType<typeof advanceWorkflow>
}): TransitionInspection {
  const route = resolveWorkflowRoute(opts.proof.work_type)
  const signals = workflowStateSignals(opts.snapshot)
  const completed = persistedCompletedStages(opts.snapshot, route)
  const workType = opts.snapshot.status.work_type || opts.snapshot.state.work_type
  const fail = (reason: string, message: string): TransitionInspection => ({
    ok: false,
    alreadyCommitted: false,
    reason,
    message,
    snapshot: opts.snapshot,
    route,
    completed,
  })

  const locallyRecomputedProof = advanceWorkflow({
    route,
    completed_stages: opts.proof.completed_stages,
    candidate_stage: opts.proof.candidate_stage,
    phase_result_status: opts.proof.phase_result_status,
    validation_status: opts.proof.validation_status,
    receipt_state: opts.proof.receipt_state,
    resumable_state: opts.proof.resumable_state,
    archived_state: opts.proof.archived_state,
  })
  if (!sameWorkflowAdvanceResult(opts.callerResult, locallyRecomputedProof)) {
    return fail("workflow-proof-mismatch", "The supplied workflow proof is not the local advanceWorkflow result.")
  }

  if (workType !== opts.proof.work_type) {
    return fail(
      "workflow-work-type-mismatch",
      `Persisted work_type ${workType || "none"} does not match ${opts.proof.work_type}.`,
    )
  }
  if (signals.archived) return fail("workflow-archived", "Archived workflow state cannot enter BUILD or VERIFY.")
  if (signals.receiptState === "pending") return fail("workflow-receipt-pending", "A receipt is pending user disposition.")
  if (opts.snapshot.status.receipt.action && opts.snapshot.status.receipt.action !== "retry") {
    return fail("workflow-receipt-action-unhandled", "The committed receipt action requires orchestrator handling before continuation.")
  }
  if (!signals.resumable) return fail("workflow-not-resumable", "Persisted workflow state is not resumable.")

  const expectedIndex = route.stages.indexOf(opts.expectedStage)
  const expectedPrefix = expectedIndex < 0 ? [] : route.stages.slice(0, expectedIndex)
  const desiredAlreadyCommitted = expectedIndex >= 0 && completed.includes(opts.expectedStage) &&
    sameStages(completed, route.stages.slice(0, route.stages.indexOf(opts.expectedStage) + 1)) &&
    (opts.snapshot.status.canonical_stage === opts.expectedStage ||
      opts.snapshot.status.canonical_stage === "VERIFY" && opts.expectedStage === "BUILD")
  if (desiredAlreadyCommitted) {
    return {
      ok: true,
      alreadyCommitted: true,
      reason: "already-committed",
      message: `Workflow state already includes ${opts.expectedStage}.`,
      snapshot: opts.snapshot,
      route,
      completed,
    }
  }
  if (expectedIndex < 0) return fail("workflow-phase-mismatch", `${opts.expectedStage} is not part of the selected route.`)
  if (!sameStages(completed, expectedPrefix)) {
    return fail("workflow-state-stale", "Persisted completed stages do not match the requested route prefix.")
  }
  if (!sameStages(opts.callerResult.completed_stages, expectedPrefix)) {
    return fail("workflow-proof-stale", "The recomputed workflow proof does not identify the persisted route prefix.")
  }
  const pendingStage = route.stages.find(stage => !completed.includes(stage)) || null
  if (pendingStage !== opts.expectedStage) {
    return fail(
      "workflow-pending-stage-mismatch",
      `Persisted pending stage ${pendingStage || "none"} does not match ${opts.expectedStage}.`,
    )
  }
  const currentStage = opts.snapshot.status.canonical_stage
  const previousStage = expectedPrefix.at(-1) || null
  if (currentStage !== opts.expectedStage && currentStage !== previousStage) {
    return fail("workflow-state-stale", `Persisted canonical_stage ${currentStage} is not compatible with ${opts.expectedStage}.`)
  }
  if (opts.callerResult.status !== "advanced" || opts.callerResult.next_stage !== opts.expectedStage) {
    return fail("workflow-advance-blocked", opts.callerResult.reason)
  }
  return { ok: true, alreadyCommitted: false, reason: "ready", message: "Persisted workflow transition is ready.", snapshot: opts.snapshot, route, completed }
}

function workflowArtifactGate(snapshot: SelectedWorkflowSnapshot, expectedStage: "BUILD" | "VERIFY"): { reason: string; message: string } | null {
  const requiredType = expectedStage === "BUILD" ? "implement-progress" : "verify-report"
  const allowedTypes = expectedStage === "BUILD"
    ? new Set(["build", "implement-progress", "implement", "apply-progress", "tasks"])
    : new Set(["verify-report"])
  const refs = snapshot.status.artifact_refs[expectedStage]
  const declared = refs.some((ref) => allowedTypes.has(normalizeArtifactKey(ref).type))
  if (!declared) {
    return {
      reason: `workflow-${requiredType}-missing`,
      message: `${expectedStage} requires a terminal ${requiredType} artifact; persist it in ${snapshot.store} and continue the phase.`,
    }
  }

  const artifactStatus = deriveWorkflowStatus({
    change: snapshot.status.change,
    artifacts: snapshot.artifacts,
    source: snapshot.store,
  })
  if (!artifactStatus.completed_canonical_stages.includes(expectedStage)) {
    return {
      reason: `workflow-${requiredType}-not-terminal`,
      message: `${expectedStage} requires ${requiredType} to be terminal and successful; complete the artifact and continue the phase.`,
    }
  }
  return null
}

/**
 * VERIFY commit gate: re-validate the persisted validation-evidence file with
 * the blind artifact rules. The policy gate carries the authoritative risk tier
 * and frozen ref; without a persisted gate there is nothing to bind the
 * transition to, so the transition stays blocked.
 */
function verifyEvidenceVerdict(
  workspaceRoot: string,
  changeName: string,
  expectationsIds?: string[],
  fastLane: boolean = false,
): ValidationVerdict {
  let gate: Partial<PolicyGateDecision> | null = null
  const gatePath = safeWorkspaceStatePath(workspaceRoot, path.join(workspaceRoot, ".odf", `policy-gate-${changeName}.json`))
  try {
    if (gatePath) gate = JSON.parse(fsSync.readFileSync(gatePath, "utf8")) as Partial<PolicyGateDecision>
  } catch {
    gate = null
  }
  if (!gate) {
    return { status: "missing", reason: "verification-evidence-missing: no policy gate persisted for this change — run the policy gate before verifying", commands_validated: 0 }
  }
  return validateValidationEvidence({
    workspaceDir: workspaceRoot,
    change: changeName,
    tier: gate.risk_tier ?? "MEDIUM",
    frozenDiffRef: gate.frozen_diff_ref ?? null,
    ...(fastLane ? {
      evidencePath: fastLaneEvidenceRelativePath(changeName, "full"),
      expectedPhase: "VERIFY" as const,
      requiredCommandKind: "full" as const,
    } : {}),
    expectationsIds,
  })
}

function workflowLockPath(workspaceRoot: string, changeName: string): string {
  return path.join(workspaceRoot, ".odf", `workflow-${changeName}${WORKFLOW_LOCK_SUFFIX}`)
}

function workflowStateReference(store: ArtifactStore, changeName: string): string {
  return store === "openspec"
    ? `openspec/changes/${changeName}/state.yaml`
    : store === "engram" ? `odf/${changeName}/state` : `openspec/changes/${changeName}/state.yaml + odf/${changeName}/state`
}

async function withWorkflowLock<T>(
  workspaceRoot: string,
  changeName: string,
  operation: () => Promise<T>,
): Promise<{ locked: true; value: T } | { locked: false; error: string }> {
  let lockPath = ""
  let lockFd: number | null = null
  try {
    const realWorkspace = await fs.realpath(workspaceRoot)
    const lockDirectory = path.join(realWorkspace, ".odf")
    if (!await safeDirectoryPath(realWorkspace, lockDirectory, true)) {
      return { locked: false, error: "workflow-lock-unsafe-path" }
    }
    lockPath = workflowLockPath(realWorkspace, changeName)
    try {
      lockFd = fsSync.openSync(lockPath, "wx")
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return { locked: false, error: code === "EEXIST" ? "workflow-state-locked" : "workflow-lock-failed" }
    }
    return { locked: true, value: await operation() }
  } catch {
    return { locked: false, error: "workflow-lock-failed" }
  } finally {
    if (lockFd !== null) {
      try { fsSync.closeSync(lockFd) } catch { /* best-effort */ }
      try { fsSync.unlinkSync(lockPath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[odf-delegation] Failed to clean up workflow lock: ${lockPath}`)
      }
    }
  }
}

function applyGovernanceState(
  document: ReturnType<typeof parseDocument>,
  target?: WorkflowTarget,
  governance?: OcaGovernanceEvidence,
  acknowledgment?: GovernanceAcknowledgment,
): void {
  if (target) document.set("target", target)
  if (governance) document.set("governance", governance)
  if (acknowledgment) document.set("governance_acknowledgment", acknowledgment)
}

function writeOpenSpecWorkflowState(
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  canonicalStage: WorkflowStage,
  completedStages: CanonicalStage[],
  target?: WorkflowTarget,
  governance?: OcaGovernanceEvidence,
  acknowledgment?: GovernanceAcknowledgment,
): string | null {
  const statePath = path.resolve(workspaceRoot, "openspec", "changes", changeName, "state.yaml")
  if (!isWithinRoot(statePath, path.resolve(workspaceRoot))) return "unsafe-state-path"
  const parsed = parseStateDocument(stateContent)
  if (!parsed) return "malformed-state"
  parsed.document.set("work_type", workType)
  parsed.document.set("canonical_stage", canonicalStage)
  parsed.document.set("completed_canonical_stages", completedStages)
  applyGovernanceState(parsed.document, target, governance, acknowledgment)
  if (canonicalStage === "ARCHIVED") {
    parsed.document.set("phase", "archived")
    parsed.document.set("status", "archived")
    parsed.document.set("archived", true)
  }
  const tempPath = `${statePath}.${process.pid}.${nodeCrypto.randomUUID()}.tmp`
  try {
    const root = fsSync.realpathSync(path.resolve(workspaceRoot))
    const realStatePath = fsSync.realpathSync(statePath)
    if (!isWithinRoot(realStatePath, root)) return "unsafe-state-path"
    const serialized = serializeOpenSpecState(parsed.document)
    fsSync.writeFileSync(tempPath, serialized, { encoding: "utf8", flag: "wx" })
    fsSync.renameSync(tempPath, statePath)
    return null
  } catch {
    try { fsSync.unlinkSync(tempPath) } catch { /* best-effort */ }
    return "state-write-failed"
  }
}

function writeEngramWorkflowState(
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  canonicalStage: WorkflowStage,
  completedStages: CanonicalStage[],
  target?: WorkflowTarget,
  governance?: OcaGovernanceEvidence,
  acknowledgment?: GovernanceAcknowledgment,
): string | null {
  const parsed = parseStateDocument(stateContent)
  if (!parsed) return "malformed-state"
  parsed.document.set("work_type", workType)
  parsed.document.set("canonical_stage", canonicalStage)
  parsed.document.set("completed_canonical_stages", completedStages)
  applyGovernanceState(parsed.document, target, governance, acknowledgment)
  if (canonicalStage === "ARCHIVED") {
    parsed.document.set("phase", "archived")
    parsed.document.set("status", "archived")
    parsed.document.set("archived", true)
  }
  const topicKey = `odf/${changeName}/state`
  const project = workspaceProjectName(resolveWorkspaceRoot(workspaceRoot))
  const content = JSON.stringify(parsed.document.toJSON())
  try {
    execFileSync("engram", [
      "save", topicKey, content,
      "--type", "architecture",
      "--project", project,
      "--scope", "project",
      "--topic", topicKey,
    ], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    })
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "ENOENT" ? "engram-cli-unavailable" : code === "ETIMEDOUT" ? "engram-save-timeout" : "engram-save-failed"
  }
}

function archiveReport(changeName: string, workType: WorkType, completedStages: CanonicalStage[]): string {
  return stringify({
    change: changeName,
    status: "archived",
    work_type: workType,
    completed_canonical_stages: completedStages,
    archived_at: new Date().toISOString(),
  })
}

function writeOpenSpecArchive(
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  completedStages: CanonicalStage[],
  target?: WorkflowTarget,
  governance?: OcaGovernanceEvidence,
  acknowledgment?: GovernanceAcknowledgment,
): string | null {
  const reportPath = path.resolve(workspaceRoot, "openspec", "changes", changeName, "archive-report.yaml")
  const root = path.resolve(workspaceRoot)
  if (!isWithinRoot(reportPath, root)) return "unsafe-archive-report-path"
  const reportTemp = `${reportPath}.${process.pid}.${nodeCrypto.randomUUID()}.tmp`
  try {
    fsSync.writeFileSync(reportTemp, archiveReport(changeName, workType, completedStages), { encoding: "utf8", flag: "wx" })
    fsSync.renameSync(reportTemp, reportPath)
  } catch {
    try { fsSync.unlinkSync(reportTemp) } catch { /* best-effort */ }
    return "archive-report-write-failed"
  }
  return writeOpenSpecWorkflowState(workspaceRoot, changeName, stateContent, workType, "ARCHIVED", completedStages, target, governance, acknowledgment)
}

function writeEngramArchive(
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  completedStages: CanonicalStage[],
  target?: WorkflowTarget,
  governance?: OcaGovernanceEvidence,
  acknowledgment?: GovernanceAcknowledgment,
): string | null {
  const stateError = writeEngramWorkflowState(workspaceRoot, changeName, stateContent, workType, "ARCHIVED", completedStages, target, governance, acknowledgment)
  if (stateError) return stateError
  const topicKey = `odf/${changeName}/archive-report`
  const project = workspaceProjectName(resolveWorkspaceRoot(workspaceRoot))
  try {
    execFileSync("engram", [
      "save", topicKey, archiveReport(changeName, workType, completedStages),
      "--type", "architecture", "--project", project, "--scope", "project", "--topic", topicKey,
    ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000, maxBuffer: 64 * 1024 })
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "ENOENT" ? "engram-cli-unavailable" : code === "ETIMEDOUT" ? "engram-save-timeout" : "archive-report-save-failed"
  }
}

function writeArchiveWorkflow(
  store: ArtifactStore,
  workspaceRoot: string,
  changeName: string,
  stateContent: string,
  workType: WorkType,
  completedStages: CanonicalStage[],
  target?: WorkflowTarget,
  governance?: OcaGovernanceEvidence,
  acknowledgment?: GovernanceAcknowledgment,
): string | null {
  if (store === "openspec") return writeOpenSpecArchive(workspaceRoot, changeName, stateContent, workType, completedStages, target, governance, acknowledgment)
  if (store === "engram") return writeEngramArchive(workspaceRoot, changeName, stateContent, workType, completedStages, target, governance, acknowledgment)
  // OpenSpec is the hybrid authority; Engram is an idempotent recovery mirror.
  const openSpecError = writeOpenSpecArchive(workspaceRoot, changeName, stateContent, workType, completedStages, target, governance, acknowledgment)
  if (openSpecError) return openSpecError
  return writeEngramArchive(workspaceRoot, changeName, stateContent, workType, completedStages, target, governance, acknowledgment)
}

/**
 * Block reason when any persisted content-bound artifact (policy gate, validation
 * evidence, receipt) is bound to a candidate digest that no longer matches the
 * workspace. Returns null when git is unavailable or no artifact carries a
 * digest (legacy flows stay unblocked; T3 makes the digest mandatory).
 */
function candidateDigestMismatchReason(workspaceRoot: string, changeName: string): string | null {
  const fresh = candidateDigestOrNull(workspaceRoot, changeName)
  if (fresh === null) return null

  const bindings: Array<{ label: string; digest: string }> = []
  try {
    const gate = JSON.parse(
      fsSync.readFileSync(path.join(workspaceRoot, ".odf", `policy-gate-${changeName}.json`), "utf8")
    ) as Partial<PolicyGateDecision>
    if (typeof gate.candidate_digest === "string") bindings.push({ label: "policy gate", digest: gate.candidate_digest })
  } catch { /* no persisted gate */ }
  try {
    const evidence = JSON.parse(
      fsSync.readFileSync(path.join(workspaceRoot, ".odf", `validation-evidence-${changeName}.json`), "utf8")
    ) as Partial<ValidationEvidenceFile>
    if (typeof evidence.candidate_digest === "string") bindings.push({ label: "validation evidence", digest: evidence.candidate_digest })
  } catch { /* no persisted evidence */ }
  const receiptRead = readReceiptFile(workspaceRoot, changeName)
  const receiptDigest = receiptRead.receipt?.candidate_digest
  if (typeof receiptDigest === "string") bindings.push({ label: "receipt", digest: receiptDigest })

  for (const binding of bindings) {
    if (binding.digest !== fresh) {
      return `candidate-digest-mismatch: the ${binding.label} is bound to candidate ${binding.digest}, workspace candidate is ${fresh}`
    }
  }
  return null
}

export async function commitWorkflowTransition(opts: {
  workspaceRoot: string
  changeName: string
  artifactStore: ArtifactStore
  proof: ODFDelegateWorkflowAdvance
  expectedStage: "BUILD" | "VERIFY" | "ARCHIVE"
  callerResult: ReturnType<typeof advanceWorkflow>
  phaseResultStatus: WorkflowPhaseResultStatus
  validationStatus: WorkflowValidationStatus
  validation: ValidationVerdict | null
  target?: string
  governance_acknowledgment?: GovernanceAcknowledgment
  expectationsIds?: string[]
  parallel?: boolean
}): Promise<WorkflowCommitResult> {
  const stateRef = workflowStateReference(opts.artifactStore, opts.changeName)
  const makeResult = (
    status: WorkflowCommitResult["status"],
    reason: string,
    message: string,
    snapshot: SelectedWorkflowSnapshot | null,
    completedStages: CanonicalStage[],
    validation: ValidationVerdict | null,
    workflowResult: ReturnType<typeof advanceWorkflow> | null,
    canonicalStage: WorkflowStage | null = snapshot?.status.canonical_stage || null,
  ): WorkflowCommitResult => ({
    status,
    reason,
    message,
    store: opts.artifactStore,
    state_ref: stateRef,
    canonical_stage: canonicalStage,
    completed_stages: completedStages,
    validation,
    workflow_result: workflowResult,
  })

  if (opts.expectedStage !== "BUILD" && opts.expectedStage !== "VERIFY" && opts.expectedStage !== "ARCHIVE") {
    return makeResult(
      "blocked",
      "workflow-stage-unsupported",
      "Workflow commits may only target BUILD, VERIFY, or ARCHIVE.",
      null,
      [],
      opts.validation,
      null,
    )
  }

  const locked = await withWorkflowLock(opts.workspaceRoot, opts.changeName, async () => {
    const read = await readSelectedWorkflowState(opts.workspaceRoot, opts.changeName, opts.artifactStore)
    if (!read.snapshot) {
      return makeResult(
        "blocked",
        read.error || "workflow-state-unavailable",
        "The selected workflow state could not be read safely.",
        null,
        [],
        opts.validation,
        null,
      )
    }
    let governanceEvidence: OcaGovernanceEvidence | undefined
    let governanceTarget: WorkflowTarget | undefined
    if (opts.expectedStage === "ARCHIVE") {
      const route = resolveWorkflowRoute(opts.proof.work_type)
      const completed = persistedCompletedStages(read.snapshot, route)
      const alreadyArchived = read.snapshot.status.canonical_stage === "ARCHIVED" &&
        read.snapshot.artifacts.some(artifact => normalizeArtifactKey(artifact.key).type === "archive-report")
      if (alreadyArchived) {
        return makeResult("already-committed", "already-committed", "Workflow is already archived.", read.snapshot, completed, opts.validation, null, "ARCHIVED")
      }
      const governance = evaluateOcaGovernanceGate(
        opts.workspaceRoot,
        read.snapshot,
        opts.target || opts.proof.target,
        opts.governance_acknowledgment || opts.proof.governance_acknowledgment,
      )
      if (governance.failure) {
        return makeResult("blocked", governance.failure.reason, governance.failure.message, read.snapshot, completed, opts.validation, null)
      }
      governanceEvidence = governance.evidence
      governanceTarget = governance.target
      if (read.snapshot.status.canonical_stage !== "VERIFY" || !completed.includes("VERIFY")) {
        return makeResult("blocked", "workflow-verify-not-terminal", "ARCHIVE requires a terminal VERIFY state.", read.snapshot, completed, opts.validation, null)
      }
      if (governance.active) {
        const artifactFailure = workflowArtifactGate(read.snapshot, "VERIFY")
        if (artifactFailure) {
          return makeResult("blocked", artifactFailure.reason, artifactFailure.message, read.snapshot, completed, opts.validation, null)
        }
      }
      if (opts.phaseResultStatus !== "ok" && opts.phaseResultStatus !== "warning") {
        return makeResult("blocked", "workflow-result-invalid", "The VERIFY result must have status ok or warning before archiving.", read.snapshot, completed, opts.validation, null)
      }
      const fastLaneState: { policy: FastLanePolicy | null; reason?: string } = governance.active
        ? fastLanePolicyFromState(read.snapshot.state, opts.workspaceRoot, opts.changeName)
        : { policy: null }
      if (fastLaneState.reason) {
        return makeResult("blocked", fastLaneState.reason, "The persisted fast-lane policy is malformed and cannot authorize archive.", read.snapshot, completed, opts.validation, null)
      }
      const archiveValidation = governance.active
        ? verifyEvidenceVerdict(opts.workspaceRoot, opts.changeName, opts.expectationsIds, fastLaneState.policy?.enabled === true)
        : opts.validation
      if (governance.active && archiveValidation?.status !== "verified") {
        const reason = archiveValidation?.status === "missing" ? "verification-evidence-missing" : "verification-evidence-invalid"
        return makeResult("blocked", reason, archiveValidation?.reason || "Valid VERIFY evidence is required before archiving.", read.snapshot, completed, archiveValidation, null)
      }
      const writeError = writeArchiveWorkflow(
        opts.artifactStore,
        opts.workspaceRoot,
        opts.changeName,
        read.snapshot.stateContent,
        opts.proof.work_type,
        route.stages,
        governanceTarget,
        governanceEvidence,
        opts.governance_acknowledgment || opts.proof.governance_acknowledgment,
      )
      if (writeError) {
        return makeResult("blocked", writeError, "The archive state and report could not be synchronized.", read.snapshot, completed, archiveValidation, null)
      }
      return makeResult("committed", "committed", `Archived workflow state to ${opts.artifactStore}.`, read.snapshot, route.stages, archiveValidation, null, "ARCHIVED")
    }
    const inspection = inspectPersistedTransition({
      snapshot: read.snapshot,
      proof: opts.proof,
      expectedStage: opts.expectedStage,
      callerResult: opts.callerResult,
    })
    if (!inspection.ok || inspection.alreadyCommitted) {
      return makeResult(
        inspection.alreadyCommitted ? "already-committed" : "blocked",
        inspection.reason,
        inspection.message,
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }

    const governance = evaluateOcaGovernanceGate(
      opts.workspaceRoot,
      read.snapshot,
      opts.target || opts.proof.target,
      opts.governance_acknowledgment || opts.proof.governance_acknowledgment,
    )
    if (governance.failure) {
      return makeResult("blocked", governance.failure.reason, governance.failure.message, read.snapshot, inspection.completed, opts.validation, null)
    }
    governanceEvidence = governance.evidence
    governanceTarget = governance.target

    const fastLaneState = fastLanePolicyFromState(read.snapshot.state, opts.workspaceRoot, opts.changeName)
    if (fastLaneState.reason) {
      return makeResult(
        "blocked",
        fastLaneState.reason,
        "The persisted fast-lane policy is malformed and cannot authorize this transition.",
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }
    const fastLanePolicy = fastLaneState.policy
    // Fast-lane BUILD evidence binds the post-task candidate; the entry digest
    // is intentionally checked only before delegation.
    const digestMismatch = fastLanePolicy?.enabled && opts.expectedStage === "BUILD"
      ? null
      : candidateDigestMismatchReason(opts.workspaceRoot, opts.changeName)
    if (digestMismatch) {
      return makeResult(
        "blocked",
        "candidate-digest-mismatch",
        digestMismatch,
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }

    if (opts.phaseResultStatus !== "ok" && opts.phaseResultStatus !== "warning") {
      return makeResult(
        "blocked",
        "workflow-result-invalid",
        "The actual phase result must have status ok or warning before workflow state can advance.",
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }

    const fastLaneBindingFailure = fastLaneEligibilityFailure(
      opts.proof.work_type,
      fastLanePolicy,
      read.snapshot.state.entry_route_binding,
    )
    if (fastLaneBindingFailure) {
      return makeResult(
        "blocked",
        fastLaneBindingFailure,
        "The persisted fast-lane binding is not eligible for the canonical small-change route.",
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }

    const artifactFailure = workflowArtifactGate(read.snapshot, opts.expectedStage)
    if (artifactFailure) {
      return makeResult(
        "blocked",
        artifactFailure.reason,
        artifactFailure.message,
        read.snapshot,
        inspection.completed,
        opts.validation,
        null,
      )
    }

    let validation = opts.validation
    if (fastLanePolicy?.enabled && opts.expectedStage === "BUILD") {
      const gatePath = safeWorkspaceStatePath(opts.workspaceRoot, path.join(opts.workspaceRoot, ".odf", `policy-gate-${opts.changeName}.json`))
      let gate: Partial<PolicyGateDecision> | null = null
      try {
        if (gatePath) gate = JSON.parse(fsSync.readFileSync(gatePath, "utf8")) as Partial<PolicyGateDecision>
      } catch {
        gate = null
      }
      validation = gate
        ? validateValidationEvidence({
          workspaceDir: opts.workspaceRoot,
          change: opts.changeName,
          tier: gate.risk_tier ?? "MEDIUM",
          frozenDiffRef: gate.frozen_diff_ref ?? null,
          evidencePath: fastLaneEvidenceRelativePath(opts.changeName, "targeted"),
          expectedPhase: "IMPLEMENT",
          requiredCommandKind: "targeted",
          expectationsIds: opts.expectationsIds,
        })
        : { status: "missing", reason: "implementation-evidence-missing: no policy gate persisted for this change", commands_validated: 0 }
    }
    if (opts.expectedStage === "VERIFY") validation = verifyEvidenceVerdict(opts.workspaceRoot, opts.changeName, opts.expectationsIds, fastLanePolicy?.enabled === true)
    if (validation?.status !== "verified") {
      const reason = validation?.status === "missing" ? "verification-evidence-missing" : "verification-evidence-invalid"
      return makeResult(
        "blocked",
        reason,
        validation?.reason || "Valid transition evidence is required.",
        read.snapshot,
        inspection.completed,
        validation,
        null,
      )
    }

    const postResult = advanceWorkflow({
      route: inspection.route,
      completed_stages: inspection.completed,
      candidate_stage: opts.expectedStage,
      phase_result_status: opts.phaseResultStatus,
      validation_status: opts.validationStatus,
      receipt_state: read.snapshot.status.receipt.state,
      resumable_state: workflowStateSignals(read.snapshot).resumable,
      archived_state: workflowStateSignals(read.snapshot).archived,
    })
    if (postResult.status !== "advanced" && postResult.status !== "complete") {
      return makeResult(
        "blocked",
        "workflow-advance-blocked",
        postResult.reason,
        read.snapshot,
        inspection.completed,
        validation,
        postResult,
      )
    }

    // OpenSpec is the hybrid authority; Engram is an idempotent recovery mirror.
    // Both stores must be written for hybrid, matching writeArchiveWorkflow.
    const writeError = opts.artifactStore === "openspec"
      ? writeOpenSpecWorkflowState(opts.workspaceRoot, opts.changeName, read.snapshot.stateContent, opts.proof.work_type, opts.expectedStage, postResult.completed_stages, governanceTarget, governanceEvidence, opts.governance_acknowledgment || opts.proof.governance_acknowledgment)
      : opts.artifactStore === "engram"
        ? writeEngramWorkflowState(opts.workspaceRoot, opts.changeName, read.snapshot.stateContent, opts.proof.work_type, opts.expectedStage, postResult.completed_stages, governanceTarget, governanceEvidence, opts.governance_acknowledgment || opts.proof.governance_acknowledgment)
        : writeOpenSpecWorkflowState(opts.workspaceRoot, opts.changeName, read.snapshot.stateContent, opts.proof.work_type, opts.expectedStage, postResult.completed_stages, governanceTarget, governanceEvidence, opts.governance_acknowledgment || opts.proof.governance_acknowledgment)
          ?? writeEngramWorkflowState(opts.workspaceRoot, opts.changeName, read.snapshot.stateContent, opts.proof.work_type, opts.expectedStage, postResult.completed_stages, governanceTarget, governanceEvidence, opts.governance_acknowledgment || opts.proof.governance_acknowledgment)
    if (writeError) {
      return makeResult(
        "blocked",
        writeError,
        "The selected workflow state could not be committed.",
        read.snapshot,
        inspection.completed,
        validation,
        postResult,
      )
    }
    return makeResult(
      "committed",
      "committed",
      `Committed ${opts.expectedStage} workflow state to ${opts.artifactStore}.`,
      read.snapshot,
      postResult.completed_stages,
      validation,
      postResult,
      opts.expectedStage,
    )
  })
  if (!locked.locked) {
    return makeResult(
      "blocked",
      locked.error,
      "The selected workflow state could not be locked safely.",
      null,
      [],
      opts.validation,
      null,
    )
  }
  return locked.value
}

export interface ProofBackedLifecycleInput {
  workspaceRoot: string
  changeName: string
  artifactStore: ArtifactStore
  proof: ODFDelegateWorkflowAdvance
  expectedStage: "BUILD" | "VERIFY"
  callerResult: ReturnType<typeof advanceWorkflow>
  innerResultStatus: WorkflowPhaseResultStatus | null
  validationStatus: WorkflowValidationStatus
  validation: ValidationVerdict | null
  target?: string
  governance_acknowledgment?: GovernanceAcknowledgment
  expectationsIds?: string[]
  parallel?: boolean
}

/**
 * Orchestrate only the proof-backed lifecycle boundary. Callers retain
 * ownership of receipts, attempts, metrics, and public response envelopes.
 */
export async function resolveProofBackedLifecycle(opts: ProofBackedLifecycleInput): Promise<WorkflowCommitResult> {
  const stateRef = workflowStateReference(opts.artifactStore, opts.changeName)
  const blocked = (reason: string, message: string): WorkflowCommitResult => ({
    status: "blocked",
    reason,
    message,
    store: opts.artifactStore,
    state_ref: stateRef,
    canonical_stage: null,
    completed_stages: [],
    validation: opts.validation,
    workflow_result: opts.callerResult,
  })

  if (opts.innerResultStatus !== "ok" && opts.innerResultStatus !== "warning") {
    return blocked(
      opts.innerResultStatus === "blocked" ? "inner-result-status-blocked" : "inner-result-status-invalid",
      opts.innerResultStatus === "blocked"
        ? "The inner phase result is blocked."
        : opts.innerResultStatus === "failed"
          ? "The inner phase result failed."
          : "The inner phase result is missing or has an invalid status.",
    )
  }

  if (opts.expectedStage === "BUILD" && opts.validation?.status !== "verified") {
    return blocked(
      "workflow-evidence-invalid",
      opts.validation?.reason || "IMPLEMENT evidence is not verified.",
    )
  }

  return commitWorkflowTransition({
    workspaceRoot: opts.workspaceRoot,
    changeName: opts.changeName,
    artifactStore: opts.artifactStore,
    proof: opts.proof,
    expectedStage: opts.expectedStage,
    callerResult: opts.callerResult,
    phaseResultStatus: opts.innerResultStatus,
    validationStatus: opts.validationStatus,
    validation: opts.validation,
    target: opts.target,
    governance_acknowledgment: opts.governance_acknowledgment,
    expectationsIds: opts.expectationsIds,
    parallel: opts.parallel,
  })
}

function persistWorkflowFailureReceipt(
  workspaceRoot: string,
  changeName: string,
  phase: ODFReceipt["phase"],
  summary: string,
  policyGate: PolicyGateDecision | null,
  refs: string[] = [],
  status: ODFReceipt["status"] = "blocked",
  cause: ODFReceipt["cause"] = "validation-failed",
  expectationsIds: string[] = [],
): ODFReceipt {
  const frozenDiffRef = policyGate?.frozen_diff_ref || gitHead(workspaceRoot)
  return mergeReceipt(workspaceRoot, {
    change: changeName,
    phase,
    status,
    cause,
    evidence: {
      summary,
      frozen_diff_ref: frozenDiffRef,
      failing: [summary],
      refs: Array.from(new Set([
        ...refs,
        ...(policyGate ? [path.join(".odf", `policy-gate-${changeName}.json`)] : []),
      ])),
    },
    action: null,
    review_gate: null,
    frozen_diff_ref: frozenDiffRef,
    ...(expectationsIds.length ? { expectations_ids: expectationsIds } : {}),
    resolved_at: new Date().toISOString(),
  })
}

function buildEngramStatus(
  workspaceRoot: string,
  snapshot: EngramSnapshot,
  warnings: string[] = []
): Omit<ODFChangeStatus, "observability"> {
  const { change: bestChange, artifacts } = snapshot

  const status = {
    change: bestChange,
    phase: "init",
    artifacts: {},
    applyProgress: { completed: 0, total: 0 },
    lastUpdated: null,
  } as Omit<ODFChangeStatus, "observability">

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
  const expectationWarnings = validateExpectations({ change: bestChange, artifacts: workflowArtifacts }).status === "missing"
    ? ["missing-expectations"]
    : []
  const expectationsOnly = artifacts.size > 0 && Array.from(artifacts.keys()).every(type => normalizeArtifactKey(type).type === "expectations")
  status.workflowStatus = deriveWorkflowStatus({
    change: bestChange,
    artifacts: workflowArtifacts,
    receipt: readReceiptJson(workspaceRoot, bestChange),
    source: {
      state: artifacts.has("state") || !expectationsOnly ? "engram" : "none",
      artifacts: workflowArtifacts.map((artifact) => artifact.key),
    },
    warnings: [...warnings, ...expectationWarnings],
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
  return snapshot ? attachRuntimeStatus(buildEngramStatus(workspaceRoot, snapshot), workspaceRoot) : null
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
): Omit<ODFChangeStatus, "observability"> {
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
  const expectationWarnings = validateExpectations({ change: openSpec.change, artifacts: mergedArtifacts }).status === "missing"
    ? ["missing-expectations"]
    : []
  const workflowStatus = deriveWorkflowStatus({
    change: openSpec.change,
    state: openSpec.state?.content || null,
    artifacts: mergedArtifacts,
    receipt: readReceiptJson(workspaceRoot, openSpec.change),
    source: { state: openSpec.state ? "openspec" : "none", artifacts: Array.from(new Set(sourceRefs)) },
    warnings: Array.from(new Set([...warnings, ...expectationWarnings])),
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

function attachRuntimeStatus(status: Omit<ODFChangeStatus, "observability">, workspaceRoot: string): ODFChangeStatus {
  const loaded = readParallelJoinArtifact(workspaceRoot, status.change)
  if (loaded.warning) {
    status.workflowStatus.warnings = Array.from(new Set([...status.workflowStatus.warnings, loaded.warning]))
  } else if (loaded.artifact) {
    status.workflowStatus.parallel_join = loaded.artifact
  }
  const ledger = readAttemptLedger(workspaceRoot, attemptLedgerPath(workspaceRoot, status.change))
  const observability = buildObservabilityTimeline({
    change: status.change,
    workflow: status.workflowStatus,
    telemetry: readTelemetry(status.change),
    attempts: ledger.records,
    attempt_error: ledger.error,
    parallel_join: loaded.artifact,
    parallel_join_warning: loaded.warning,
  })
  return { ...status, observability }
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
    if (engram) return attachRuntimeStatus(buildEngramStatus(workspaceRoot, engram, openSpec?.warnings || []), workspaceRoot)
    return openSpec?.artifacts.length
      ? attachRuntimeStatus(buildMergedStatus(workspaceRoot, openSpec, null), workspaceRoot)
      : null
  }
  return attachRuntimeStatus(buildMergedStatus(workspaceRoot, openSpec, engram), workspaceRoot)
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
        observability: status.observability,
      }, null, 2)
    },
  })
}

function isCanonicalWorkType(value: unknown): value is WorkType {
  return typeof value === "string" && WORK_TYPES.includes(value as WorkType)
}

interface WorkflowBindExpectations {
  change: string
  intent: string
  expectations: ExpectationsEntry[]
  constraints?: string[]
  success_scenarios?: ExpectationsEntry[]
  failure_scenarios?: ExpectationsEntry[]
  connections?: ExpectationsConnection[]
  approved: boolean
  approved_by: string
  approved_at: string
  immutable_since: string
}

const workflowExpectationEntrySchema = tool.schema.object({
  id: tool.schema.string(),
  statement: tool.schema.string(),
  testable: tool.schema.boolean(),
  owned_by: tool.schema.enum(["human"]),
})

const workflowExpectationExtensionSchema = {
  constraints: tool.schema.array(tool.schema.string()).optional(),
  success_scenarios: tool.schema.array(workflowExpectationEntrySchema).optional(),
  failure_scenarios: tool.schema.array(workflowExpectationEntrySchema).optional(),
  connections: tool.schema.array(tool.schema.object({
    id: tool.schema.string(),
    relation: tool.schema.string(),
    reference: tool.schema.string(),
  })).optional(),
}

const workflowEntryRouteBindingSchema = tool.schema.object({
  version: tool.schema.literal(1),
  source: tool.schema.literal("odf_entry_triage"),
  mode: tool.schema.literal("shadow"),
  advisory: tool.schema.literal(true),
  execution_unchanged: tool.schema.literal(true),
  predicted_route: tool.schema.enum([
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
  ]),
  predicted_stages: tool.schema.array(tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"])).max(6),
  micro_policy: tool.schema.enum(["eligible", "ineligible", "unknown", "not-applicable"]),
  required_checks: tool.schema.array(tool.schema.string().max(128)).max(32),
  missing_facts: tool.schema.array(tool.schema.string().max(128)).max(32),
  blocking_reasons: tool.schema.array(tool.schema.string().max(128)).max(32),
  candidate_digest: tool.schema.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  shadow_digest: tool.schema.string().regex(/^[0-9a-f]{64}$/),
}).strict()

const workflowFastLanePolicySchema = tool.schema.object({
  version: tool.schema.literal(1),
  enabled: tool.schema.boolean(),
  executor: tool.schema.literal(FAST_LANE_EXECUTOR),
  validation: tool.schema.literal(FAST_LANE_VALIDATION),
}).strict()

const governanceAcknowledgmentSchema = tool.schema.object({
  target: tool.schema.literal("oca"),
  acknowledged_by: tool.schema.string(),
  acknowledged_at: tool.schema.string(),
  candidate_digest: tool.schema.string().regex(CANDIDATE_DIGEST_PATTERN),
}).strict()

interface WorkflowBindArgs {
  change_name?: string
  work_type?: unknown
  target?: "oca"
  workspace_dir?: string
  artifact_store?: "openspec" | "engram"
  preflight?: Record<string, unknown>
  expectations?: WorkflowBindExpectations
  entry_route_binding?: EntryRouteBinding
  fast_lane_policy?: FastLanePolicy
  terminal_stage?: "DECIDE" | "FIX"
  intent?: string
  expectations_approved?: boolean
  root_cause?: string
  regression?: string
}

function canonicalWorkflowValue(value: unknown): string {
  return JSON.stringify(canonicalLoopGuardValue(value))
}

function saveEngramTopic(workspaceRoot: string, project: string, topicKey: string, content: string): string | null {
  try {
    execFileSync("engram", [
      "save", topicKey, content,
      "--type", "architecture",
      "--project", project,
      "--scope", "project",
      "--topic", topicKey,
    ], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    })
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "ENOENT" ? "engram-cli-unavailable" : code === "ETIMEDOUT" ? "engram-save-timeout" : "engram-save-failed"
  }
}

async function writeAtomicFile(filePath: string, content: string): Promise<boolean> {
  const tempPath = `${filePath}.${process.pid}.${nodeCrypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" })
    await fs.rename(tempPath, filePath)
    return true
  } catch {
    try { await fs.unlink(tempPath) } catch { /* best-effort */ }
    return false
  }
}

async function safeDirectoryPath(workspaceRoot: string, directory: string, create: boolean): Promise<boolean> {
  const realRoot = await fs.realpath(workspaceRoot)
  const relative = path.relative(realRoot, directory)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return relative === ""
  let current = realRoot
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) return false
      if (!isWithinRoot(await fs.realpath(current), realRoot)) return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false
      if (!create) return true
      try {
        await fs.mkdir(current)
        const created = await fs.lstat(current)
        if (created.isSymbolicLink() || !created.isDirectory() || !isWithinRoot(await fs.realpath(current), realRoot)) return false
      } catch {
        return false
      }
    }
  }
  return true
}

async function safeOptionalPath(workspaceRoot: string, filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath)
    return !stat.isSymbolicLink() && isWithinRoot(await fs.realpath(filePath), await fs.realpath(workspaceRoot))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
  }
}

function createODFWorkflowBind(
  entryAuthorizations: ODFEntryAuthorizations = new Map(),
  entryGenerations: ODFEntryGenerations = new Map(),
): ReturnType<typeof tool> {
  return tool({
    description: `Start or bind a canonical ODF workflow in the selected artifact store.

With preflight, the operation initializes missing state and persists approved Expectations
only after canonical state exists. Existing state and Expectations are reused only when identical.`,
    args: {
      change_name: tool.schema
        .string()
        .describe("Safe ODF change name"),
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
        .describe("Canonical work type to persist"),
      target: tool.schema.enum(["oca"]).optional().describe("Explicit governance target to persist"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Project directory (defaults to cwd)"),
      artifact_store: tool.schema
        .enum(["openspec", "engram"])
        .optional()
        .describe("Artifact store for the binding (defaults to openspec)"),
      preflight: tool.schema.object({
        change: tool.schema.string(),
        execution_mode: tool.schema.enum(["interactive", "batch", "auto"]),
        artifact_store: tool.schema.enum(["openspec", "engram", "hybrid"]),
        delivery_strategy: tool.schema.enum(["ask-always", "ask-on-risk", "auto-chain", "single-pr"]),
        review_budget_lines: tool.schema.number(),
        odoo_version: tool.schema.number(),
        tdd_mode: tool.schema.boolean(),
        solution_strategy: tool.schema.enum(["standard", "custom", "pending"]),
        chain_strategy: tool.schema.enum(["none", "chained", "feature-branch"]),
        validation_mode: tool.schema.enum(["automated", "manual-acceptance"]).optional().describe("Validation preference: automated (default) or manual-acceptance (user-run evidence; risk/EXP gates still apply)"),
        persisted_at: tool.schema.string().optional(),
      }).optional().describe("Complete preflight used to initialize a missing workflow state"),
      expectations: tool.schema.object({
        change: tool.schema.string(),
        intent: tool.schema.string(),
        expectations: tool.schema.array(workflowExpectationEntrySchema),
        ...workflowExpectationExtensionSchema,
        approved: tool.schema.boolean(),
        approved_by: tool.schema.string(),
        approved_at: tool.schema.string(),
        immutable_since: tool.schema.string(),
      }).optional().describe("Approved human Expectations to persist after canonical state"),
      entry_route_binding: workflowEntryRouteBindingSchema.optional().describe("Validated advisory entry-route metadata; it cannot authorize fast execution without fast_lane_policy"),
      fast_lane_policy: workflowFastLanePolicySchema.optional().describe("Explicit opt-in bounded BUILD policy; omitted means the fast lane is disabled"),
      terminal_stage: tool.schema
        .enum(["DECIDE", "FIX"])
        .optional()
        .describe("Materialize the terminal micro prefix before BUILD"),
      intent: tool.schema.string().optional().describe("User intent for a terminal DECIDE"),
      expectations_approved: tool.schema.boolean().optional().describe("Whether the user's Expectations were approved"),
      root_cause: tool.schema.string().optional().describe("Root-cause analysis for a terminal FIX"),
      regression: tool.schema.string().optional().describe("Minimal regression for a terminal FIX"),
    },
    async execute(args: WorkflowBindArgs, toolCtx: ToolContext): Promise<string> {
      const blocked = (reason: string, message: string): string => JSON.stringify({ status: "blocked", reason, message }, null, 2)
      const changeName = canonicalChangeName(args.change_name)
      if (!changeName) {
        return blocked("unsafe-change-path", "The change name is not a safe OpenSpec path segment.")
      }
      if (!isCanonicalWorkType(args.work_type)) {
        return blocked("invalid-work-type", "The work_type is not a canonical ODF work type.")
      }
      if (args.entry_route_binding !== undefined && !validateEntryRouteBinding(args.entry_route_binding, args.work_type)) {
        return blocked("invalid-entry-route-binding", "The supplied entry_route_binding is invalid for the requested work type.")
      }
      if (args.fast_lane_policy !== undefined && !isFastLanePolicy(args.fast_lane_policy)) {
        return blocked("invalid-fast-lane-policy", "The supplied fast_lane_policy is malformed or uses an unsupported bounded executor/validation contract.")
      }
      if (args.artifact_store !== undefined && args.artifact_store !== "openspec" && args.artifact_store !== "engram") {
        return blocked("invalid-artifact-store", "The artifact_store must be openspec or engram.")
      }

      let workspaceRoot: string
      try {
        workspaceRoot = canonicalWorkspaceRoot(
          typeof args.workspace_dir === "string" && args.workspace_dir.trim()
            ? args.workspace_dir
            : process.cwd(),
        )
      } catch {
        return blocked("unsafe-workspace-path", "The workspace directory does not resolve to a safe existing root.")
      }
      const artifactStore = args.artifact_store || "openspec"
      const terminalStage = args.terminal_stage
      const validTerminal = (args.work_type === "small-change" || args.work_type === "standard-config") && terminalStage === "DECIDE" ||
        args.work_type === "bugfix" && terminalStage === "FIX"
      if (terminalStage !== undefined && !validTerminal) return blocked("invalid-terminal-stage", "The terminal stage is not valid for this work type.")
      const expectationsIntent = args.expectations?.intent.trim()
      if (terminalStage === "DECIDE" && (!(args.intent?.trim() || expectationsIntent) || args.expectations_approved !== true && !args.expectations)) {
        return blocked("expectations-not-approved", "A terminal DECIDE requires user intent and approved Expectations.")
      }
      if (terminalStage === "FIX" && (!args.root_cause?.trim() || !args.regression?.trim())) {
        return blocked("fix-evidence-missing", "A terminal FIX requires root-cause analysis and a minimal regression.")
      }
      if (args.intent?.trim() && expectationsIntent && args.intent.trim() !== expectationsIntent) {
        return blocked("expectations-intent-mismatch", "The terminal intent does not match the approved Expectations artifact.")
      }

      let preflight: PreflightRecord | null = null
      if (args.preflight) {
        const validation = validatePreflight(args.preflight)
        if (!validation.valid) return blocked("invalid-preflight", "The preflight record is incomplete or invalid.")
        preflight = {
          ...validation.normalized,
          persisted_at: validDate(args.preflight.persisted_at)
            ? args.preflight.persisted_at as string
            : validation.normalized.persisted_at,
        }
        if (preflight.change !== changeName) return blocked("preflight-change-mismatch", "Preflight change does not match change_name.")
        if (preflight.artifact_store !== artifactStore && !(preflight.artifact_store === "hybrid" && artifactStore === "openspec")) {
          return blocked("preflight-store-mismatch", "Preflight artifact_store must match the selected binding store; hybrid starts in its OpenSpec authority.")
        }
      }

      const expectations = args.expectations
      if (expectations) {
        const verdict = validateExpectations({
          change: changeName,
          artifacts: [{ key: `odf/${changeName}/expectations`, content: expectations }],
        })
        if (verdict.status !== "approved") {
          return blocked("expectations-invalid", "The supplied Expectations artifact is not a valid approved human contract.")
        }
      }

      const route = resolveWorkflowRoute(args.work_type)
      const stateArtifactStore = preflight?.artifact_store || artifactStore
      const sessionID = toolCtx?.sessionID
      const authorization = sessionID ? entryAuthorizations.get(sessionID) : null
      // The capability is scoped to session + change + workspace only. It is intentionally
      // tolerant of message/generation drift so a rate-limit abort, an intervening user message,
      // or a retried bind in the same session does not dead-end a legitimate /odf-new flow.
      const capabilityMatches = Boolean(authorization && !authorization.claimed &&
        authorization.sessionID === sessionID && authorization.changeName === changeName &&
        authorization.workspaceRoot === workspaceRoot)
      if (authorization && !capabilityMatches) {
        return blocked("workflow-start-unauthorized", "Workflow initialization authorization does not match this session, change, or workspace. Recovery: re-run the clean slash command `/odf-new <change>` in this workspace and let odf_health run first, then retry the bind.")
      }
      if (capabilityMatches) authorization!.claimed = true
      const claimedCapability = capabilityMatches ? authorization! : null
      const prepareState = (content: string, existed: boolean, expectationsPending: boolean): {
        document?: ReturnType<typeof parseDocument>
        action?: "created" | "updated" | "reused"
        preflightMirrored?: boolean
        error?: string
      } => {
        let document: ReturnType<typeof parseDocument>
        try {
          document = parseDocument(content)
        } catch {
          return { error: "malformed-state" }
        }
        if (document.errors.length > 0 || !isMap(document.contents)) return { error: "malformed-state" }
        const current = document.toJSON() as Record<string, unknown>
        if (current.work_type !== undefined && current.work_type !== args.work_type) return { error: "work-type-conflict" }
        if (current.change !== undefined && current.change !== changeName) return { error: "state-change-conflict" }
        const currentTarget = current.target === undefined ? null : normalizedWorkflowTarget(current.target)
        const requestedTarget = args.target === undefined ? null : normalizedWorkflowTarget(args.target)
        if (current.target !== undefined && currentTarget === null) return { error: "invalid-workflow-target" }
        if (args.target !== undefined && requestedTarget === null) return { error: "invalid-workflow-target" }
        if (currentTarget && requestedTarget && currentTarget !== requestedTarget) return { error: "workflow-target-conflict" }
        if (preflight && current.artifact_store !== undefined && current.artifact_store !== stateArtifactStore) return { error: "artifact-store-conflict" }
        if (preflight && current.route !== undefined && canonicalWorkflowValue(current.route) !== canonicalWorkflowValue(route)) {
          return { error: "route-conflict" }
        }
        const hasStoredEntryRouteBinding = Object.prototype.hasOwnProperty.call(current, "entry_route_binding")
        if (hasStoredEntryRouteBinding && !validateEntryRouteBinding(current.entry_route_binding, args.work_type as WorkType)) {
          return { error: "invalid-entry-route-binding" }
        }
        if (hasStoredEntryRouteBinding && args.entry_route_binding &&
          (current.entry_route_binding as EntryRouteBinding).shadow_digest !== args.entry_route_binding.shadow_digest) {
          return { error: "entry-route-binding-conflict" }
        }
        const storedFastLane = fastLanePolicyFromState(current, workspaceRoot, changeName)
        if (storedFastLane.reason) return { error: storedFastLane.reason }
        if (storedFastLane.policy && args.fast_lane_policy &&
          canonicalWorkflowValue(storedFastLane.policy) !== canonicalWorkflowValue(args.fast_lane_policy)) {
          return { error: "fast-lane-policy-conflict" }
        }
        const effectiveFastLane = args.fast_lane_policy || storedFastLane.policy
        const effectiveBinding = args.entry_route_binding || current.entry_route_binding
        const fastLaneFailure = fastLaneEligibilityFailure(args.work_type as WorkType, effectiveFastLane || null, effectiveBinding)
        if (fastLaneFailure) return { error: fastLaneFailure }
        const explicitStage = typeof current.canonical_stage === "string" ? current.canonical_stage.toUpperCase() : null
        if (terminalStage && explicitStage && explicitStage !== terminalStage) return { error: "active-state-conflict" }

        let persistedPreflight: Record<string, unknown> | null = null
        const currentPreflight = current.preflight && typeof current.preflight === "object" && !Array.isArray(current.preflight)
          ? current.preflight as Record<string, unknown>
          : null
        if (preflight) {
          if (currentPreflight?.work_type !== undefined && currentPreflight.work_type !== args.work_type) return { error: "work-type-conflict" }
          if (currentPreflight) {
            const comparableKeys = Object.keys(preflight).filter(key => key !== "persisted_at")
            if (comparableKeys.some(key => canonicalWorkflowValue(currentPreflight[key]) !== canonicalWorkflowValue(preflight![key]))) {
              return { error: "preflight-conflict" }
            }
          }
          persistedPreflight = {
            ...(currentPreflight || {}),
            ...preflight,
            persisted_at: validDate(currentPreflight?.persisted_at) ? currentPreflight!.persisted_at : preflight.persisted_at,
            work_type: args.work_type,
          }
        }

        const before = canonicalWorkflowValue(current)
        document.set("work_type", args.work_type)
        if (current.target === undefined && args.target) document.set("target", args.target)
        if (!hasStoredEntryRouteBinding && args.entry_route_binding) {
          document.set("entry_route_binding", args.entry_route_binding)
        }
        if (!Object.prototype.hasOwnProperty.call(current, "fast_lane_policy") && args.fast_lane_policy) {
          document.set("fast_lane_policy", args.fast_lane_policy)
        }
        const existingPreflightNode = document.get("preflight", true)
        if (persistedPreflight) {
          document.set("change", changeName)
          document.set("artifact_store", stateArtifactStore)
          document.set("preflight", persistedPreflight)
          document.set("route", route)
        } else if (isMap(existingPreflightNode)) {
          existingPreflightNode.set("work_type", args.work_type)
        }
        if (!existed) {
          if (preflight) document.set("phase", "preflight")
          if (preflight) document.set("canonical_stage", route.entry)
          if (preflight) document.set("completed_canonical_stages", [])
        }
        if (expectationsPending) {
          // The state lands before the Expectations artifact; mark the binding
          // pending so status/continuation are not resumable until they persist.
          document.set("binding_pending", true)
        }
        if (terminalStage) {
          document.set("canonical_stage", terminalStage)
          document.set("completed_canonical_stages", [terminalStage])
        }
        let action: "created" | "updated" | "reused" = existed ? "reused" : "created"
        if (before !== canonicalWorkflowValue(document.toJSON())) {
          action = existed ? "updated" : "created"
          if (preflight) document.set("last_updated", new Date().toISOString())
        }
        return { document, action, preflightMirrored: isMap(document.get("preflight", true)) }
      }

      const compareExpectations = (existingContent: string | null, stateExists: boolean): "none" | "persisted" | "reused" | string => {
        if (!existingContent) return expectations ? "persisted" : "none"
        const verdict = validateExpectations({
          change: changeName,
          artifacts: [{ key: `odf/${changeName}/expectations`, content: existingContent }],
        })
        if (verdict.status !== "approved") return "expectations-tampered"
        if (!expectations) return stateExists ? "none" : "expectations-reuse-required"
        try {
          const existing = parseDocument(existingContent).toJSON()
          return canonicalWorkflowValue(existing) === canonicalWorkflowValue(expectations)
            ? "reused"
            : "expectations-conflict"
        } catch {
          return "expectations-tampered"
        }
      }

      const compareTerminalArtifact = (existingContent: string | null): "none" | "persisted" | "reused" | "terminal-artifact-conflict" => {
        if (!terminalStage) return "none"
        if (!existingContent) return "persisted"
        try {
          const existing = parseDocument(existingContent).toJSON() as Record<string, unknown>
          const matches = terminalStage === "DECIDE"
            ? existing.status === "passed" && existing.intent === (args.intent?.trim() || expectationsIntent) && existing.expectations_approved === true
            : existing.status === "passed" && existing.root_cause === args.root_cause!.trim() && existing.regression === args.regression!.trim()
          return matches ? "reused" : "terminal-artifact-conflict"
        } catch {
          return "terminal-artifact-conflict"
        }
      }

      let locked: Awaited<ReturnType<typeof withWorkflowLock<string>>>
      try {
        locked = await withWorkflowLock(workspaceRoot, changeName, async (): Promise<string> => {
        if (artifactStore === "engram") {
          const read = readEngramObservationsWithError(workspaceRoot)
          if (!read.observations) return blocked(read.error || "engram-export-failed", "Existing Engram workflow state could not be inspected safely.")
          const stateKey = `odf/${changeName}/state`
          const expectationsKey = `odf/${changeName}/expectations`
          const stateObservation = read.observations.filter(observation => observation.topic_key === stateKey).at(-1)
          const expectationsObservation = read.observations.filter(observation => observation.topic_key === expectationsKey).at(-1)
          if (!stateObservation && !preflight) {
            return blocked("workflow-start-preflight-required", "An ordinary Engram bind can only update existing state; initialization requires complete preflight.")
          }
          if (!stateObservation && !claimedCapability) {
            return blocked("workflow-start-unauthorized", "Engram state initialization requires a same-session /odf-new entry plus a successful odf_health for this change. Recovery: re-run the clean slash command `/odf-new <change>`, let odf_health run first, then retry the bind.")
          }
          const terminalKey = terminalStage ? `odf/${changeName}/${terminalStage === "DECIDE" ? "decision" : "fix"}` : null
          const terminalObservation = terminalKey
            ? read.observations.filter(observation => observation.topic_key === terminalKey).at(-1)
            : null
          const expectationsAction = compareExpectations(expectationsObservation?.content || null, Boolean(stateObservation))
          if (expectationsAction.startsWith("expectations-")) {
            return blocked(expectationsAction, "Existing Expectations are missing from the retry input, different, invalid, or tampered.")
          }
          const terminalAction = compareTerminalArtifact(terminalObservation?.content || null)
          if (terminalAction === "terminal-artifact-conflict") {
            return blocked(terminalAction, "The existing terminal artifact conflicts with this idempotent binding.")
          }
          const prepared = prepareState(stateObservation?.content || "{}", Boolean(stateObservation), expectationsAction === "persisted")
          if (!prepared.document || prepared.error) return blocked(prepared.error || "malformed-state", "Engram workflow state is malformed or conflicts with this binding.")
          const project = workspaceProjectName(workspaceRoot)
          if (prepared.action !== "reused") {
            const stateError = saveEngramTopic(workspaceRoot, project, stateKey, JSON.stringify(prepared.document.toJSON()))
            if (stateError) return blocked(stateError, "The Engram state binding could not be persisted.")
          }
          if (expectationsAction === "persisted") {
            const expectationsError = saveEngramTopic(workspaceRoot, project, expectationsKey, JSON.stringify(expectations))
            if (expectationsError) return blocked(expectationsError, "State exists, but approved Expectations could not be persisted.")
            // Expectations landed; clear the binding-pending marker.
            const cleared = parseStateDocument(JSON.stringify(prepared.document.toJSON()))
            if (cleared) {
              cleared.document.delete("binding_pending")
              saveEngramTopic(workspaceRoot, project, stateKey, JSON.stringify(cleared.document.toJSON()))
            }
          }
          if (terminalStage && terminalAction === "persisted") {
            const artifactType = terminalStage === "DECIDE" ? "decision" : "fix"
            const artifact = terminalStage === "DECIDE"
              ? { status: "passed", intent: (args.intent?.trim() || expectationsIntent)!, expectations_approved: true, resolved_at: new Date().toISOString() }
              : { status: "passed", root_cause: args.root_cause!.trim(), regression: args.regression!.trim(), resolved_at: new Date().toISOString() }
            const artifactError = saveEngramTopic(workspaceRoot, project, `odf/${changeName}/${artifactType}`, JSON.stringify(artifact))
            if (artifactError) return blocked(artifactError, "Canonical state exists, but the terminal artifact could not be persisted.")
          }
          recordTerminalFlowMarkers(sessionID, workspaceRoot, changeName, args.work_type as WorkType, terminalStage)
          return JSON.stringify({
            status: "bound",
            change_name: changeName,
            work_type: args.work_type,
            artifact_store: "engram",
            topic_key: stateKey,
            project,
            state_action: prepared.action,
            expectations_action: expectationsAction,
            terminal_action: terminalAction,
            route,
            ...(terminalStage ? { terminal_stage: terminalStage } : {}),
          }, null, 2)
        }

        const realWorkspace = await fs.realpath(workspaceRoot)
        const changeDir = path.resolve(realWorkspace, "openspec", "changes", changeName)
        const statePath = path.join(changeDir, "state.yaml")
        const expectationsPath = path.join(changeDir, "expectations.yaml")
        if (!isWithinRoot(statePath, realWorkspace) || !await safeDirectoryPath(realWorkspace, changeDir, false)) {
          return blocked("unsafe-change-path", "The OpenSpec change path contains a symlink or escapes the workspace.")
        }
        const terminalPath = path.join(changeDir, terminalStage === "DECIDE" ? "decision.yaml" : "fix.yaml")
        if (!await safeOptionalPath(realWorkspace, statePath) ||
          !await safeOptionalPath(realWorkspace, expectationsPath) ||
          terminalStage && !await safeOptionalPath(realWorkspace, terminalPath)) {
          return blocked("unsafe-change-path", "An OpenSpec artifact path is unsafe or resolves outside the workspace.")
        }
        const snapshot = await loadOpenSpecStatus(realWorkspace, changeName)
        const existingExpectations = snapshot?.artifacts.find(artifact => normalizeArtifactKey(artifact.key).type === "expectations")
        const existingTerminal = terminalStage
          ? snapshot?.artifacts.find(artifact => normalizeArtifactKey(artifact.key).type === (terminalStage === "DECIDE" ? "decision" : "fix"))
          : null
        let stateContent = "{}\n"
        let stateExists = false
        try {
          const stateStat = await fs.lstat(statePath)
          if (stateStat.isSymbolicLink() || !stateStat.isFile()) return blocked("unsafe-change-path", "OpenSpec state.yaml is not a safe regular file.")
          stateContent = await fs.readFile(statePath, "utf8")
          stateExists = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return blocked("state-unreadable", "Existing OpenSpec state.yaml could not be read.")
          if (!preflight) return blocked("workflow-start-preflight-required", "An ordinary OpenSpec bind can only update existing state; initialization requires complete preflight.")
          if (!claimedCapability) return blocked("workflow-start-unauthorized", "OpenSpec state initialization requires a same-session /odf-new entry plus a successful odf_health for this change. Recovery: re-run the clean slash command `/odf-new <change>`, let odf_health run first, then retry the bind.")
        }
        const expectationsAction = compareExpectations(existingExpectations?.content || null, stateExists)
        if (expectationsAction.startsWith("expectations-")) {
          return blocked(expectationsAction, "Existing Expectations are missing from the retry input, different, invalid, or tampered.")
        }
        const terminalAction = compareTerminalArtifact(existingTerminal?.content || null)
        if (terminalAction === "terminal-artifact-conflict") {
          return blocked(terminalAction, "The existing terminal artifact conflicts with this idempotent binding.")
        }
        const prepared = prepareState(stateContent, stateExists, expectationsAction === "persisted")
        if (!prepared.document || prepared.error) return blocked(prepared.error || "malformed-state", "OpenSpec workflow state is malformed or conflicts with this binding.")
        if (!await safeDirectoryPath(realWorkspace, changeDir, true)) return blocked("unsafe-change-path", "The OpenSpec change path could not be created safely.")
        if (prepared.action !== "reused") {
          if (!await writeAtomicFile(statePath, serializeOpenSpecState(prepared.document))) {
            return blocked("state-write-failed", "OpenSpec workflow state could not be persisted.")
          }
        }
        if (expectationsAction === "persisted" && !await writeAtomicFile(expectationsPath, stringify(expectations))) {
          return blocked("expectations-write-failed", "Canonical state exists, but approved Expectations could not be persisted.")
        }
        if (expectationsAction === "persisted") {
          // Expectations landed; clear the binding-pending marker.
          const cleared = parseStateDocument(await fs.readFile(statePath, "utf8"))
          if (cleared) {
            cleared.document.delete("binding_pending")
            await writeAtomicFile(statePath, serializeOpenSpecState(cleared.document))
          }
        }
        if (terminalStage && terminalAction === "persisted") {
          const artifact = terminalStage === "DECIDE" ? {
            status: "passed",
            intent: (args.intent?.trim() || expectationsIntent)!,
            expectations_approved: true,
            resolved_at: new Date().toISOString(),
          } : {
            status: "passed",
            root_cause: args.root_cause!.trim(),
            regression: args.regression!.trim(),
            resolved_at: new Date().toISOString(),
          }
          const artifactPath = path.join(changeDir, terminalStage === "DECIDE" ? "decision.yaml" : "fix.yaml")
          if (!await writeAtomicFile(artifactPath, JSON.stringify(artifact, null, 2))) {
            return blocked("terminal-artifact-write-failed", "Canonical state exists, but the terminal artifact could not be persisted.")
          }
        }
        recordTerminalFlowMarkers(sessionID, workspaceRoot, changeName, args.work_type as WorkType, terminalStage)
        return JSON.stringify({
          status: "bound",
          change_name: changeName,
          work_type: args.work_type,
          artifact_store: "openspec",
          state_path: statePath,
          state_action: prepared.action,
          expectations_action: expectationsAction,
          terminal_action: terminalAction,
          preflight_mirrored: prepared.preflightMirrored,
          route,
          ...(terminalStage ? { terminal_stage: terminalStage } : {}),
        }, null, 2)
        })
      } finally {
        if (claimedCapability && sessionID && entryAuthorizations.get(sessionID)?.nonce === claimedCapability.nonce) {
          entryAuthorizations.delete(sessionID)
        }
      }
      return locked.locked
        ? locked.value
        : blocked(locked.error, "The workflow start is already locked or the lock could not be acquired.")
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

/**
 * Audited phase override: skip (DECIDE/PLAN only), re-enter, or re-plan (with
 * an approved Expectations revision). Requires an explicit human-approved
 * reason; BUILD/VERIFY can never be skipped and keep their evidence gates.
 * Every override is appended to `<worktree>/.odf/override-{change}.jsonl`.
 */
function createODFWorkflowOverride(): ReturnType<typeof tool> {
  return tool({
    description: `Audited phase override for an existing ODF change.

Actions:
- skip: mark the pending DECIDE/PLAN stage completed (BUILD/VERIFY can never be skipped; they keep validation and evidence gates).
- re-enter: move back to a completed stage; later completed stages are invalidated and must be re-run.
     - re-plan: like re-enter, plus persist a human-approved Expectations revision (revision > current, supersedes = digest of the previous artifact).
     - disable-fast-lane: disable an existing fast_lane_policy through a separate audited marker without rewriting workflow state or artifacts.

     Requires a human-approved reason (>=20 chars). Fast-lane disable additionally requires approved_by and a live session.`,
    args: {
      change_name: tool.schema.string().describe("Change name (kebab-case)"),
      artifact_store: tool.schema.enum(["openspec", "engram", "hybrid"]).describe("Authoritative workflow store"),
      action: tool.schema.enum(["skip", "re-enter", "re-plan", "disable-fast-lane"]).describe("Override action"),
      target_stage: tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY"]).optional().describe("Canonical stage to skip/re-enter/re-plan from"),
      reason: tool.schema.string().describe("Human-approved reason (>=20 chars)"),
      approved_by: tool.schema.string().optional().describe("Human approver for disabling the fast lane"),
      expectations_revision: tool.schema.object({
        change: tool.schema.string(),
        intent: tool.schema.string(),
        expectations: tool.schema.array(workflowExpectationEntrySchema),
        ...workflowExpectationExtensionSchema,
        approved: tool.schema.boolean(),
        approved_by: tool.schema.string(),
        approved_at: tool.schema.string(),
        immutable_since: tool.schema.string(),
        revision: tool.schema.number(),
        supersedes: tool.schema.string(),
        replan_from: tool.schema.string(),
      }).optional().describe("Approved Expectations revision (required for re-plan)"),
      workspace_dir: tool.schema.string().optional().describe("Project directory (defaults to cwd)"),
    },
    async execute(args: {
      change_name: string
      artifact_store: "openspec" | "engram" | "hybrid"
      action: "skip" | "re-enter" | "re-plan" | "disable-fast-lane"
      target_stage?: "DECIDE" | "PLAN" | "BUILD" | "VERIFY"
      reason: string
      approved_by?: string
      expectations_revision?: Record<string, unknown>
      workspace_dir?: string
    }, toolCtx: ToolContext): Promise<string> {
      const blocked = (reason: string, message: string): string => JSON.stringify({ status: "blocked", reason, message }, null, 2)
      const changeName = canonicalChangeName(args.change_name)
      if (!changeName) return blocked("unsafe-change-path", "The change name is not a safe OpenSpec path segment.")
      let workspaceRoot: string
      try {
        workspaceRoot = canonicalWorkspaceRoot(args.workspace_dir || process.cwd())
      } catch {
        return blocked("unsafe-workspace-path", "The workspace directory does not resolve to a safe existing root.")
      }
      const reason = (args.reason || "").trim()
      if (reason.length < 20) return blocked("override-reason-required", "A human-approved reason of at least 20 characters is required for any override.")
      const approvedBy = (args.approved_by || "").trim()
      if (args.action === "disable-fast-lane" &&
        (approvedBy.length === 0 || approvedBy.length > 256 || /[\r\n]/.test(approvedBy) || !toolCtx?.sessionID)) {
        return blocked("fast-lane-rollback-authorization-required", "Disabling the fast lane requires a named human approver and an active OpenCode session.")
      }

      const locked = await withWorkflowLock(workspaceRoot, changeName, async (): Promise<string> => {
        const read = await readSelectedWorkflowState(workspaceRoot, changeName, args.artifact_store)
        if (!read.snapshot) return blocked(read.error || "workflow-state-unavailable", "The selected workflow state could not be read safely.")
        if (args.action === "disable-fast-lane") {
          const rawPolicy = read.snapshot.state.fast_lane_policy
          if (!isFastLanePolicy(rawPolicy)) {
            return blocked("invalid-fast-lane-policy", "The persisted fast-lane policy is malformed and cannot be disabled safely.")
          }
          if (!rawPolicy.enabled) return blocked("fast-lane-policy-not-enabled", "The persisted fast-lane policy is already disabled.")
          const existingRollback = readFastLaneRollback(workspaceRoot, changeName)
          if (existingRollback.reason) return blocked(existingRollback.reason, "The persisted fast-lane rollback marker is malformed or unsafe.")
          const policyDigest = fastLanePolicyDigest(rawPolicy)
          if (existingRollback.rollback) {
            if (existingRollback.rollback.policy_digest !== policyDigest) {
              return blocked("fast-lane-rollback-policy-mismatch", "The existing rollback marker does not match the persisted fast-lane policy.")
            }
            return JSON.stringify({
              status: "already-disabled",
              change_name: changeName,
              action: args.action,
              store: args.artifact_store,
              rollback_ref: `.odf/fast-lane-rollback-${changeName}.json`,
              state_unchanged: true,
            }, null, 2)
          }
          if (!ensureSafeOdfDirectory(workspaceRoot)) return blocked("fast-lane-rollback-unsafe-path", "The workspace .odf directory is unsafe.")
          const rollback = {
            version: FAST_LANE_ROLLBACK_VERSION,
            change: changeName,
            artifact_store: args.artifact_store,
            policy_digest: policyDigest,
            disabled_at: new Date().toISOString(),
            approved_by: approvedBy,
            reason,
          } satisfies FastLaneRollback
          const rollbackPath = fastLaneRollbackPath(workspaceRoot, changeName)
          if (!await writeAtomicFile(rollbackPath, `${JSON.stringify(rollback, null, 2)}\n`)) {
            return blocked("fast-lane-rollback-write-failed", "The fast-lane rollback marker could not be persisted.")
          }
          return JSON.stringify({
            status: "disabled",
            change_name: changeName,
            action: args.action,
            store: args.artifact_store,
            rollback_ref: `.odf/fast-lane-rollback-${changeName}.json`,
            state_unchanged: true,
          }, null, 2)
        }
        if (!args.target_stage) return blocked("override-target-required", "skip, re-enter, and re-plan require a target_stage.")
        const workType = read.snapshot.status.work_type || read.snapshot.state.work_type
        if (!workType || !WORK_TYPES.includes(workType as WorkType)) {
          return blocked("override-work-type-missing", "The persisted state has no valid work_type; resolve it first (bind with --work-type).")
        }
        const route = resolveWorkflowRoute(workType as WorkType)
        const target = args.target_stage.toUpperCase() as CanonicalStage
        if (!route.stages.includes(target)) return blocked("override-target-invalid", `${target} is not part of the ${route.work_type} route.`)
        const completed = persistedCompletedStages(read.snapshot, route)
        const pending = route.stages.find(stage => !completed.includes(stage)) || null

        let newCompleted: CanonicalStage[]
        let newStage: CanonicalStage
        if (args.action === "skip") {
          if (target === "BUILD" || target === "VERIFY") {
            return blocked("override-skip-gated", "BUILD and VERIFY cannot be skipped; they keep validation and evidence gates.")
          }
          if (target !== pending) {
            return blocked("override-skip-not-pending", `Only the pending stage can be skipped; ${target} is not pending (${pending || "none"}).`)
          }
          newCompleted = [...completed, target]
          newStage = target
        } else {
          // re-enter / re-plan: target must be a completed stage (or the entry)
          if (target !== route.stages[0] && !completed.includes(target)) {
            return blocked("override-target-not-completed", `${target} is not completed; only completed stages can be re-entered/re-planned.`)
          }
          newCompleted = route.stages.filter(stage => route.stages.indexOf(stage) < route.stages.indexOf(target))
          newStage = target
        }

        // Expectations revision for re-plan
        let expectationsRevision = args.expectations_revision
        if (args.action === "re-plan") {
          if (!expectationsRevision) return blocked("override-revision-required", "re-plan requires an approved expectations_revision document.")
          const verdict = validateExpectations({
            change: changeName,
            artifacts: [{ key: `odf/${changeName}/expectations`, content: expectationsRevision }],
          })
          if (verdict.status !== "approved") return blocked("override-revision-invalid", "The expectations_revision is not a valid approved human contract.")
          const currentArtifact = read.snapshot.artifacts.find(a => normalizeArtifactKey(a.key).type === "expectations")
          if (currentArtifact) {
            const currentDigest = nodeCrypto.createHash("sha256").update(currentArtifact.content).digest("hex")
            if (expectationsRevision.supersedes !== currentDigest) {
              return blocked("override-revision-supersedes-mismatch", "expectations_revision.supersedes must equal the digest of the current Expectations artifact.")
            }
          }
        }

        // Write the state
        const parsed = parseStateDocument(read.snapshot.stateContent)
        if (!parsed) return blocked("malformed-state", "The persisted workflow state is malformed.")
        parsed.document.set("canonical_stage", newStage)
        parsed.document.set("completed_canonical_stages", newCompleted)
        const newStateContent = args.artifact_store === "engram"
          ? parsed.document.toString()
          : serializeOpenSpecState(parsed.document)
        // Write the overridden state directly (the commit helpers force their own
        // canonical_stage; the override sets it explicitly).
        const writeState = async (content: string): Promise<string | null> => {
          const statePath = path.join(workspaceRoot, "openspec", "changes", changeName, "state.yaml")
          if (!isWithinRoot(statePath, path.resolve(workspaceRoot))) return "unsafe-state-path"
          if (args.artifact_store === "openspec") return await writeAtomicFile(statePath, content) ? null : "state-write-failed"
          if (args.artifact_store === "engram") {
            return saveEngramTopic(workspaceRoot, workspaceProjectName(workspaceRoot), `odf/${changeName}/state`, content)
          }
          const openSpecError = await writeAtomicFile(statePath, content) ? null : "state-write-failed"
          if (openSpecError) return openSpecError
          return saveEngramTopic(workspaceRoot, workspaceProjectName(workspaceRoot), `odf/${changeName}/state`, content)
        }
        const writeError = await writeState(newStateContent)
        if (writeError) return blocked(writeError, "The overridden state could not be persisted.")

        // Persist the Expectations revision (re-plan)
        if (args.action === "re-plan" && expectationsRevision) {
          const project = workspaceProjectName(workspaceRoot)
          if (args.artifact_store === "engram") {
            const err = saveEngramTopic(workspaceRoot, project, `odf/${changeName}/expectations`, JSON.stringify(expectationsRevision))
            if (err) return blocked(err, "The Expectations revision could not be persisted to Engram.")
          } else {
            const expectationsPath = path.join(workspaceRoot, "openspec", "changes", changeName, "expectations.yaml")
            if (!isWithinRoot(expectationsPath, path.resolve(workspaceRoot))) return blocked("unsafe-change-path", "The Expectations path is unsafe.")
            if (!await writeAtomicFile(expectationsPath, JSON.stringify(expectationsRevision, null, 2))) {
              return blocked("expectations-write-failed", "The Expectations revision could not be persisted.")
            }
          }
        }

        // Audit log
        const audit = {
          at: new Date().toISOString(),
          action: args.action,
          target_stage: target,
          reason,
          work_type: workType,
          completed_before: completed,
          completed_after: newCompleted,
          expectations_revision: args.action === "re-plan" ? Number(expectationsRevision?.revision) || null : null,
        }
        try {
          fsSync.appendFileSync(path.join(workspaceRoot, ".odf", `override-${changeName}.jsonl`), JSON.stringify(audit) + "\n")
        } catch { /* audit is best-effort */ }

        return JSON.stringify({
          status: "overridden",
          change_name: changeName,
          action: args.action,
          target_stage: target,
          canonical_stage: newStage,
          completed_stages: newCompleted,
          store: args.artifact_store,
          audit_ref: `.odf/override-${changeName}.jsonl`,
        }, null, 2)
      })
      return locked.locked
        ? locked.value
        : blocked(locked.error || "workflow-lock-failed", "The workflow override could not acquire the lock.")
    },
  })
}

function createODFWorkflowAdvance(): ReturnType<typeof tool> {  return tool({
    description: "Advance a canonical ODF workflow without writing state, receipts, artifacts, or files.",
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
      completed_stages: tool.schema
        .array(tool.schema.enum(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"]))
        .describe("Canonical stages already completed"),
      candidate_stage: tool.schema
        .enum(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"])
        .optional()
        .describe("Canonical stage that just completed"),
      phase_result_status: tool.schema
        .enum(["ok", "warning", "blocked", "failed"])
        .describe("Result-contract status for the completed phase"),
      validation_status: tool.schema
        .enum(["verified", "missing", "invalid", "not-required"])
        .describe("Validation seal status"),
      receipt_state: tool.schema
        .enum(["none", "pending", "resolved"])
        .describe("Current receipt state"),
      resumable_state: tool.schema
        .boolean()
        .describe("Whether the workflow can resume"),
      archived_state: tool.schema
        .boolean()
        .describe("Whether the workflow is archived"),
    },
    async execute(args: {
      work_type: WorkType
      completed_stages: CanonicalStage[]
      candidate_stage?: CanonicalStage
      phase_result_status: WorkflowPhaseResultStatus
      validation_status: WorkflowValidationStatus
      receipt_state: WorkflowReceiptState
      resumable_state: boolean
      archived_state: boolean
    }): Promise<string> {
      const route = resolveWorkflowRoute(args.work_type)
      const input: WorkflowAdvanceInput = {
        route,
        completed_stages: args.completed_stages,
        candidate_stage: args.candidate_stage || null,
        phase_result_status: args.phase_result_status,
        validation_status: args.validation_status,
        receipt_state: args.receipt_state,
        resumable_state: args.resumable_state,
        archived_state: args.archived_state,
      }
      return JSON.stringify(advanceWorkflow(input), null, 2)
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
- \`odf_parallel_delegate\`: bounded cross-domain IMPLEMENT BUILD with branch-aware join
- \`odf_workflow_route\`: read-only canonical route selection by work type
- \`odf_workflow_advance\`: read-only canonical transition validation and next-stage calculation
- \`odf_workflow_bind\`: store-aware start/bind; complete preflight initializes canonical state before approved Expectations
- \`odf_entry_triage\`: read-only deterministic micro/standard/full entry classification and work-type selection for \`/odf-new\`
- Proof-backed BUILD/VERIFY delegation requires an explicit \`artifact_store\`; the selected store is the single workflow-state authority.
- Workflow state commits happen after successful inner results and evidence; ARCHIVED remains an explicit archive transition.
- \`odf_skill_inject\`, \`odf_skill_resolve\`, \`odf_registry_read\`: standards and routing inspection
- \`odf_policy_gate\`, \`odf_receipt\`: policy and failure persistence
- \`odf_status\`, \`odf_workflow_status\`, \`odf_profile_select\`, \`odf_notebooklm_lookup\`: state, canonical progress, profile, and research lookup
- \`odf_health\`: read-only installed/runtime health; it does not probe task usability or execute task/Odoo/PostgreSQL/Engram export
- \`odf_community_tool_detect\`, \`odf_community_tool_install\`: optional community tooling

## Non-negotiable invariants

- For exact \`/odf-new\`, call \`odf_health\` as the first ODF operation. Missing, malformed, failed, or blocked health stops before questions, writes, artifact creation, and delegation.
- Start through one \`odf_workflow_bind\`: missing-state creation requires complete preflight plus same-session exact-command health authorization; persist state before Expectations, reuse identical approved content, and block divergence/tampering.
- Use \`odf_delegate\` for ODF phase work; inject at most five matching compact skill blocks.
- Resolve and persist the authoritative Policy Gate before IMPLEMENT/VERIFY; never recompute it.
- IMPLEMENT closes only when the plugin seal has \`validation.status === "verified"\` from fresh bound evidence; prose never counts.
- VERIFY uses evidence-based risk tier, frozen ref, and one correction budget; an inconclusive frozen-byte inspection does not consume the attempt and there is no auto-loop.
- On VERIFY FAIL, persist the receipt before the single user disposition question; \`/odf-continue\` re-discovers pending receipts.
- Metrics remain bounded, session-hashed, and canonical JSONL data for the metrics command. Content signals may escalate risk to HIGH, never downgrade it.
- Cross-domain joins persist to bounded \`.odf/parallel-join-{change}.json\`; continuation uses \`resume_from_join: true\`, reuses completed branches, and retries only incomplete branches with fresh attempt IDs.
- The outer plugin envelope and inner agent \`## ODF Result\` are separate; preserve the agent result and inspect both layers.
</odf-system>`

export function createODFRuntimeHooks(
  client: OpencodeClient,
  entryAuthorizations: ODFEntryAuthorizations = new Map(),
  entryGenerations: ODFEntryGenerations = new Map(),
  workspaceDir = process.cwd(),
): LoopGuardHooks & Pick<Hooks, "experimental.chat.system.transform"> {
  const { consumeContextPressureNotice, ...guardHooks } = createStableDiscoveryGuard(client, entryAuthorizations, entryGenerations, workspaceDir)
  return {
    ...guardHooks,
    "experimental.chat.system.transform": async (input, output) => {
      const parts = [...output.system, ODF_SYSTEM_RULES]
      const pressureNotice = input.sessionID ? consumeContextPressureNotice(input.sessionID) : null
      if (pressureNotice) parts.push(pressureNotice)
      output.system = [parts.join("\n\n---\n\n")]
    },
  }
}

// ==========================================
// PLUGIN EXPORT
// ==========================================

export const OdfDelegationPlugin: Plugin = async (ctx) => {
  const { directory, client } = ctx
  const entryAuthorizations: ODFEntryAuthorizations = new Map()
  const entryGenerations: ODFEntryGenerations = new Map()
  const runtimeHooks = createODFRuntimeHooks(client, entryAuthorizations, entryGenerations, directory)

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
    debugLog(`[odf-delegation] Skills changed since last refresh. Invalidating registry cache.`)
    resetRegistryCache()
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
      debugLog(`[odf-delegation] Learning: top skills by success rate — ${top.map(i => `${i.skill}(${i.success_rate}%)`).join(", ")}`)
    }

    // Quick health check
    const healthChecks: string[] = []
    healthChecks.push(`skills=${registry.skills.length}`)
    healthChecks.push(`agents=${registry.agents?.length || 0}`)
    healthChecks.push(`profiles=${registry.profiles?.length || 0}`)
    debugLog(`[odf-delegation] Health: ${healthChecks.join(", ")}`)
  }

  debugLog(`[odf-delegation] Plugin loaded. Tools: ${ODF_REGISTERED_TOOLS.join(", ")}`)

  return {
    ...runtimeHooks,
    tool: {
      odf_delegate: createODFDelegate(client, directory),
      odf_parallel_delegate: createODFParallelDelegate(client, directory),
      odf_workflow_route: createODFWorkflowRoute(),
      odf_workflow_advance: createODFWorkflowAdvance(),
      odf_workflow_override: createODFWorkflowOverride(),
      odf_workflow_bind: createODFWorkflowBind(entryAuthorizations, entryGenerations),
      odf_entry_triage: createODFEntryTriage(),
      odf_context_manifest: createODFContextManifest(),
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
      odf_health: createODFHealth(client),
      odf_governance_provenance: createODFGovernanceProvenance(),
      odf_governance_check: createODFGovernanceCheck(),
    },
  }
}

export default {
  id: "odf-delegation",
  server: OdfDelegationPlugin,
}

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
  createODFParallelDelegate,
  createODFWorkflowRoute,
  createODFWorkflowAdvance,
  createODFWorkflowOverride,
  createODFWorkflowBind,
  createODFStatus,
  createODFWorkflowStatus,
  createODFHealth,
  createODFGovernanceCheck,
  createODFGovernanceProvenance,
  getProfileByPhase,
  flushMetricsSync,
  getMetricsBufferCap,
  recordMetrics,
  resolveFlowStage,
  ALLOWED_PHASES,
  createODFPolicyGate,
  classifyRiskTier,
  classifyRiskTierWithContent,
  computePolicyGate,
  gitHead,
  savePolicyGateJson,
  createStableDiscoveryGuard,
  contextPressureThreshold,
  contextPressureNotice,
  CONTEXT_PRESSURE_DEFAULT_TOKENS,
  type PolicyGateDecision,
  ODF_REGISTERED_TOOLS,
  type ODFRegistry,
  type ODFSkill,
  type ODFAgent,
  type ODFCommunityTool,
  type WorkType,
  type WorkflowRoute,
}

export function getMetricsBuffer(): DelegationMetrics[] {
  return metricsBuffer
}

export function clearMetricsBuffer(): void {
  metricsBuffer.length = 0
}
