import {
  resolveWorkflowRoute,
  WORK_TYPES,
  type CanonicalStage as RouteCanonicalStage,
  type LegacyPhase as RouteLegacyPhase,
  type WorkType,
} from "./odf-workflow.js"
import type { ParallelJoinArtifact } from "./odf-parallel-join.js"

export type CanonicalStage = RouteCanonicalStage | "ARCHIVED"
export type WorkflowStage = "INIT" | CanonicalStage
export type LegacyPhase = RouteLegacyPhase | "ARCHIVED"
export type ReceiptState = "none" | "pending" | "resolved"
export interface NormalizedArtifactKey { original: string; group: WorkflowStage | null; type: string }
export interface WorkflowArtifact { key?: string; content?: unknown; status?: unknown; created_at?: unknown; createdAt?: unknown; ref?: unknown }
export type WorkflowArtifacts = Record<string, WorkflowArtifact | string | boolean | null | undefined> | WorkflowArtifact[]
export interface WorkflowState {
  canonical_stage?: unknown; canonicalStage?: unknown; current_stage?: unknown; currentStage?: unknown; stage?: unknown
  phase?: unknown; status?: unknown; archived?: unknown; abandoned?: unknown; completed_canonical_stages?: unknown
  completed_stages?: unknown; work_type?: unknown; artifacts?: unknown; [key: string]: unknown
}
export interface WorkflowReceipt {
  status?: unknown; action?: unknown; ref?: unknown; receipt_ref?: unknown; frozen_diff_ref?: unknown; evidence?: unknown; candidate_digest?: unknown; expectations_ids?: unknown; [key: string]: unknown
}
export interface WorkflowStatusInput {
  change: string; artifacts?: WorkflowArtifacts; state?: WorkflowState | string | null; receipt?: WorkflowReceipt | null
  source?: { state?: unknown; artifacts?: string[] } | string
  warnings?: string[]
}
export interface ProgressState { completed: number; total: number; known: boolean; source: string | null }
export interface ReceiptStatus { state: ReceiptState; status: string | null; action: string | null; ref: string | null }
export interface WorkflowStatus {
  change: string; canonical_stage: WorkflowStage; legacy_phase: LegacyPhase | null; completed_canonical_stages: CanonicalStage[]
  pending_stage: Exclude<CanonicalStage, "ARCHIVED"> | null
  artifact_refs: Record<Exclude<CanonicalStage, "ARCHIVED">, string[]>
  progress: ProgressState; receipt: ReceiptStatus; resumable: boolean; work_type: WorkType | null
  parallel_join?: ParallelJoinArtifact
  source: { state: "openspec" | "engram" | "inferred" | "none"; artifacts: string[] }; warnings: string[]
}
type ActiveCanonicalStage = Exclude<CanonicalStage, "ARCHIVED">
const STAGES: ActiveCanonicalStage[] = ["DECIDE", "PLAN", "BUILD", "VERIFY"]
const ALL_STAGES: ActiveCanonicalStage[] = [...STAGES, "EXPLORE", "FIX"]
const DEFAULT_LEGACY_PHASES: LegacyPhase[] = ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY"]
const LEGACY_PHASES = new Set<LegacyPhase>([
  ...DEFAULT_LEGACY_PHASES, "EXPLORE", "FIX", "ARCHIVED",
])
const ARTIFACT_GROUPS: Record<string, WorkflowStage> = {
  decision: "DECIDE", propose: "DECIDE", assess: "DECIDE",
  plan: "PLAN", design: "PLAN", "qa-plan": "PLAN",
  build: "BUILD", "implement-progress": "BUILD", implement: "BUILD", "apply-progress": "BUILD", tasks: "BUILD",
  verify: "VERIFY", "verify-report": "VERIFY",
  explore: "EXPLORE", "explore-progress": "EXPLORE",
  fix: "FIX", "fix-progress": "FIX",
  archive: "ARCHIVED", "archive-report": "ARCHIVED", retrospective: "ARCHIVED",
}
const CANONICAL_TYPES: Record<ActiveCanonicalStage, Set<string>> = {
  DECIDE: new Set(["decision"]),
  PLAN: new Set(["plan"]),
  BUILD: new Set(["build", "implement-progress"]),
  VERIFY: new Set(["verify"]),
  EXPLORE: new Set(["explore"]),
  FIX: new Set(["fix"]),
}
const STAGE_LEGACY: Record<WorkflowStage, LegacyPhase | null> = {
  INIT: null, DECIDE: "ASSESS", PLAN: "DESIGN", BUILD: "IMPLEMENT", VERIFY: "VERIFY", EXPLORE: "EXPLORE", FIX: "FIX", ARCHIVED: "ARCHIVED",
}
const LEGACY_STAGE: Record<LegacyPhase, CanonicalStage | null> = {
  PROPOSE: "DECIDE", ASSESS: "DECIDE", "QA-PLAN": "PLAN", DESIGN: "PLAN",
  IMPLEMENT: "BUILD", VERIFY: "VERIFY", EXPLORE: "EXPLORE", FIX: "FIX", ARCHIVED: "ARCHIVED",
}
const LEGACY_ARTIFACT_PHASES: Array<[LegacyPhase, Set<string>]> = [
  ["VERIFY", new Set(["verify", "verify-report"])],
  ["IMPLEMENT", new Set(["build", "implement-progress", "implement", "apply-progress", "tasks"])],
  ["FIX", new Set(["fix", "fix-progress"])],
  ["EXPLORE", new Set(["explore", "explore-progress"])],
  ["DESIGN", new Set(["plan", "design"])],
  ["QA-PLAN", new Set(["qa-plan"])],
  ["ASSESS", new Set(["decision", "assess"])],
  ["PROPOSE", new Set(["propose"])],
]
const TYPE_PRIORITY = new Map([
  "decision", "plan", "build", "verify", "implement-progress", "propose", "assess", "design", "qa-plan",
  "implement", "apply-progress", "tasks", "verify-report", "explore", "explore-progress", "fix", "fix-progress",
].map((type, index) => [type, index]))
const SUCCESS_STATUSES = new Set(["ok", "pass", "passed", "success", "successful", "verified", "complete", "completed", "archived"])
const PENDING_STATUSES = new Set(["failed", "blocked", "pending", "timeout", "validation-failed"])
const RECEIPT_ACTIONS = new Set(["scope-change", "re-plan", "abandon", "retry", "none"])
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null }
function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-")
}
function artifactType(key: string): string {
  const raw = key.trim().split(/[\\/]/).filter(Boolean).pop() || ""
  const type = normalizeName(raw.replace(/\.(json|ya?ml|md)$/i, ""))
  if (type === "proposal") return "propose"
  if (type === "spec") return "assess"
  if (type.startsWith("verify-report-")) return "verify-report"
  return type
}
function isQaLens(key: string, type: string): boolean {
  const parts = key.trim().toLowerCase().split(/[\\/]/).filter(Boolean)
  const prefix = parts.at(-2) || ""
  return ["qa-review", "qa-aggregate", "qa-report"].includes(type) ||
    (prefix === "qa" && ["review", "aggregate", "report"].includes(type))
}
export function normalizeArtifactKey(key: string): NormalizedArtifactKey {
  const type = artifactType(key)
  return { original: key, group: isQaLens(key, type) ? null : ARTIFACT_GROUPS[type] || null, type }
}
export function parseProgress(content?: string | null): ProgressState {
  if (typeof content !== "string" || !content) return { completed: 0, total: 0, known: false, source: null }
  let total = 0
  let completed = 0
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s|$)/)
    if (match) {
      total++
      if (match[1].toLowerCase() === "x") completed++
    }
  }
  return { completed, total, known: total > 0, source: total > 0 ? "checklist" : null }
}
function receiptAction(receipt: WorkflowReceipt): { valid: boolean; action: string | null } {
  if (receipt.action === undefined || receipt.action === null) return { valid: true, action: null }
  const raw = typeof receipt.action === "string"
    ? receipt.action
    : asString(asRecord(receipt.action)?.committed)
  const action = raw?.toLowerCase() || null
  return {
    valid: action !== null && RECEIPT_ACTIONS.has(action),
    action: action === "none" ? null : action,
  }
}
function receiptRef(receipt: WorkflowReceipt): string | null {
  const direct = [receipt.ref, receipt.receipt_ref, receipt.frozen_diff_ref].map(asString).find(Boolean)
  if (direct) return direct
  const evidence = asRecord(receipt.evidence)
  return asString(evidence?.frozen_diff_ref) ||
    (Array.isArray(evidence?.refs) ? evidence.refs.map(asString).find(Boolean) || null : null)
}
export function deriveReceiptState(receipt?: WorkflowReceipt | null): ReceiptStatus {
  if (!receipt) return { state: "none", status: null, action: null, ref: null }
  const status = asString(receipt.status)?.toLowerCase() || null
  const disposition = receiptAction(receipt)
  const action = disposition.valid ? disposition.action : null
  const resolvedStatus = status !== null && (SUCCESS_STATUSES.has(status) || status === "resolved")
  const pending = !disposition.valid || (!action && (!resolvedStatus || Boolean(status && PENDING_STATUSES.has(status))))
  return {
    state: pending ? "pending" : "resolved",
    status,
    action,
    ref: receiptRef(receipt),
  }
}
const STATE_SCALAR_KEYS = new Set([
  "canonical_stage", "canonicalStage", "current_stage", "currentStage", "stage", "phase", "status", "archived", "abandoned",
  "work_type",
  "decide_completed", "decision_completed", "decide_done", "decision_done", "plan_completed", "plan_done",
  "build_completed", "build_done", "implement_completed", "implement_done", "implement_progress", "verify_completed", "verify_done",
  "explore_completed", "explore_done", "fix_completed", "fix_done",
  "completed_canonical_stages", "completed_stages",
])
const STATE_SECTIONS = new Set(["artifacts", "timestamps"])
export interface ParsedWorkflowState {
  state: WorkflowState | null
  warnings: string[]
}
function stripYamlComment(value: string): string {
  let quote: string | null = null
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if ((char === "'" || char === '"') && value[i - 1] !== "\\") quote = quote === char ? null : quote || char
    if (char === "#" && !quote && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trim()
  }
  return value.trim()
}
function parseScalar(value: string): { ok: boolean; value: unknown } {
  const trimmed = stripYamlComment(value)
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const items = trimmed.slice(1, -1).trim()
    if (!items) return { ok: true, value: [] }
    const parsed = items.split(",").map(parseScalar)
    return parsed.every((item) => item.ok) ? { ok: true, value: parsed.map((item) => item.value) } : { ok: false, value: undefined }
  }
  if (!trimmed || /^[{}]|^[|>]&?/.test(trimmed)) return { ok: false, value: undefined }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return { ok: true, value: trimmed.slice(1, -1) }
  }
  if (trimmed === "true") return { ok: true, value: true }
  if (trimmed === "false") return { ok: true, value: false }
  if (trimmed === "null" || trimmed === "~") return { ok: true, value: null }
  return /^[A-Za-z0-9_./:+-]+$/.test(trimmed) ? { ok: true, value: trimmed } : { ok: false, value: undefined }
}
function parseStateContent(content: string): ParsedWorkflowState {
  const warnings: string[] = []
  try {
    const parsed = asRecord(JSON.parse(content))
    return parsed ? { state: parsed as WorkflowState, warnings } : { state: null, warnings: ["State JSON is not an object."] }
  } catch {
    // ponytail: scalar-only YAML parsing keeps this adapter dependency-free; complex state yields warnings.
  }

  const result: WorkflowState = {}
  let section: { name: string; indent: number } | null = null
  let listKey: "completed_canonical_stages" | "completed_stages" | null = null
  const warned = new Set<string>()
  const warn = (message: string): void => {
    if (!warned.has(message)) {
      warned.add(message)
      warnings.push(message)
    }
  }
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue
    const match = line.match(/^(\s*)([A-Za-z0-9_-]+):(?:\s*(.*))?$/)
    if (!match) {
      if (!/^\s*-\s+/.test(line)) warn(`Malformed YAML state line ignored: ${line.trim()}`)
      continue
    }
    const indent = match[1].length
    const key = match[2]
    const value = match[3] || ""
    if (indent === 0) {
      section = null
      listKey = null
      if (!value && STATE_SECTIONS.has(key)) {
        result[key] = {}
        section = { name: key, indent }
      } else if (!STATE_SCALAR_KEYS.has(key)) {
        if (value && (value.startsWith("[") || value.startsWith("{"))) warn(`Complex YAML state value ignored: ${key}`)
        continue
      } else if (!value && (key === "completed_canonical_stages" || key === "completed_stages")) {
        result[key] = []
        listKey = key
      } else if (!value) {
        warn(`Complex YAML state value ignored: ${key}`)
      } else {
        const scalar = parseScalar(value)
        if (scalar.ok) result[key] = scalar.value
        else warn(`Complex YAML state value ignored: ${key}`)
      }
      continue
    }
    if (listKey && indent > 0) {
      const itemMatch = line.match(/^\s*-\s+(.*)$/)
      if (!itemMatch) continue
      const scalar = parseScalar(itemMatch[1])
      if (scalar.ok) (result[listKey] as unknown[]).push(scalar.value)
      else warn(`Complex YAML state value ignored: ${listKey}`)
      continue
    }
    if (!section || indent <= section.indent || !STATE_SECTIONS.has(section.name)) continue
    const scalar = parseScalar(value)
    if (scalar.ok) {
      const nested = asRecord(result[section.name]) || {}
      nested[key] = scalar.value
      result[section.name] = nested
    } else if (value) {
      warn(`Complex YAML state value ignored: ${section.name}.${key}`)
    }
  }
  return { state: Object.keys(result).length ? result : null, warnings }
}
export function parseWorkflowState(content: string): ParsedWorkflowState {
  return parseStateContent(content)
}

function declaredWorkType(state: WorkflowState | null, warnings: string[]): WorkType | null {
  if (!state || !Object.prototype.hasOwnProperty.call(state, "work_type")) return null
  if (typeof state.work_type === "string" && WORK_TYPES.includes(state.work_type as WorkType)) {
    return state.work_type as WorkType
  }
  warnings.push(`Invalid declared work_type: ${String(state.work_type)}.`)
  return null
}

function stateRecord(state?: WorkflowState | string | null): ParsedWorkflowState {
  if (!state) return { state: null, warnings: [] }
  return typeof state === "string" ? parseStateContent(state) : { state: asRecord(state) as WorkflowState | null, warnings: [] }
}
interface InternalArtifact { normalized: NormalizedArtifactKey; content: string | null; status: string | null; createdAt: unknown; explicitStatus: boolean }
function toArtifact(key: string, value: unknown): InternalArtifact {
  const record = asRecord(value)
  const status = asString(record?.status)?.toLowerCase() || null
  return {
    normalized: normalizeArtifactKey(key),
    content: typeof value === "string" ? value : asString(record?.content),
    status,
    createdAt: record?.created_at ?? record?.createdAt,
    explicitStatus: Boolean(status),
  }
}
function normalizeArtifacts(input?: WorkflowArtifacts): InternalArtifact[] {
  if (!input) return []
  if (Array.isArray(input)) return input.flatMap((item) => {
    const key = asString(asRecord(item)?.key)
    return key ? [toArtifact(key, item)] : []
  })
  return Object.entries(input).map(([key, value]) => toArtifact(key, value))
}
function artifactStatus(artifact: InternalArtifact): string | null {
  if (artifact.status) return artifact.status
  if (!artifact.content) return null
  try {
    const parsed = asRecord(JSON.parse(artifact.content))
    const status = asString(parsed?.status) || asString(parsed?.final_verdict) || asString(asRecord(parsed?.outcome)?.status)
    if (status) return status.toLowerCase()
  } catch { /* fall through to the common YAML scalar */ }
  return artifact.content.match(/(?:^|\n)\s*(?:status|final_verdict):\s*["']?([A-Za-z_-]+)/i)?.[1]?.toLowerCase() || null
}
function successful(artifact: InternalArtifact): boolean {
  const status = artifactStatus(artifact)
  return status ? SUCCESS_STATUSES.has(status) : false
}
function isTerminal(artifact: InternalArtifact): boolean {
  if (artifact.explicitStatus) return Boolean(artifact.status && SUCCESS_STATUSES.has(artifact.status))
  const { type } = artifact.normalized
  if (type === "verify-report" || type === "archive-report") return successful(artifact)
  if (["implement-progress", "apply-progress", "tasks", "explore-progress", "fix-progress"].includes(type)) {
    const progress = parseProgress(artifact.content)
    return progress.known && progress.completed === progress.total
  }
  return true
}
function orderedArtifacts(artifacts: InternalArtifact[], group: ActiveCanonicalStage): InternalArtifact[] {
  return artifacts
    .filter((artifact) => artifact.normalized.group === group)
    .sort((a, b) => (TYPE_PRIORITY.get(a.normalized.type) ?? -1) - (TYPE_PRIORITY.get(b.normalized.type) ?? -1))
}
function stateStage(value: unknown): WorkflowStage | null {
  const normalized = asString(value)?.toUpperCase()
  if (normalized === "ARCHIVE") return "ARCHIVED"
  return normalized === "INIT" || normalized === "ARCHIVED" || ALL_STAGES.includes(normalized as ActiveCanonicalStage)
    ? normalized as WorkflowStage
    : null
}
function legacyPhase(value: unknown): LegacyPhase | null {
  const normalized = asString(value)?.toUpperCase()
  return LEGACY_PHASES.has(normalized as LegacyPhase) ? normalized as LegacyPhase : null
}
interface StateSignals { current: WorkflowStage | null; legacy: LegacyPhase | null; completed: Partial<Record<CanonicalStage, boolean>>; archived: boolean; abandoned: boolean }
const COMPLETION_FLAGS: Record<Exclude<CanonicalStage, "ARCHIVED">, string[]> = {
  DECIDE: ["decide_completed", "decision_completed", "decide_done", "decision_done"],
  PLAN: ["plan_completed", "plan_done"],
  BUILD: ["build_completed", "build_done", "implement_completed", "implement_done"],
  VERIFY: ["verify_completed", "verify_done"],
  EXPLORE: ["explore_completed", "explore_done"],
  FIX: ["fix_completed", "fix_done"],
}
function explicitStateSignals(state: WorkflowState | null): StateSignals {
  const completed: Partial<Record<CanonicalStage, boolean>> = {}
  if (!state) return { current: null, legacy: null, completed, archived: false, abandoned: false }
  const mark = (stage: CanonicalStage, value: unknown): void => {
    if (typeof value === "boolean") completed[stage] = value
  }
  for (const stage of ALL_STAGES) {
    for (const key of COMPLETION_FLAGS[stage]) if (key in state) mark(stage, state[key])
  }
  const completedStages = state.completed_canonical_stages ?? state.completed_stages
  if (Array.isArray(completedStages)) {
    for (const value of completedStages) {
      const stage = stateStage(value)
      if (stage && stage !== "INIT") completed[stage] = true
    }
  }
  const flags = asRecord(state.artifacts)
  if (flags) {
    const artifactFlags = new Map(Object.entries(flags)
      .filter(([, value]) => typeof value === "boolean")
      .map(([key, value]) => [normalizeName(key), value as boolean]))
    if (artifactFlags.has("decision")) mark("DECIDE", artifactFlags.get("decision"))
    else if (artifactFlags.has("propose") || artifactFlags.has("assess")) {
      mark("DECIDE", artifactFlags.get("propose") === true && artifactFlags.get("assess") === true)
    }
    if (artifactFlags.has("plan")) mark("PLAN", artifactFlags.get("plan"))
    else if (artifactFlags.has("design")) mark("PLAN", artifactFlags.get("design"))
    if (artifactFlags.has("build")) mark("BUILD", artifactFlags.get("build"))
    else {
      const key = ["implement-progress", "implement", "apply-progress", "tasks"].find((candidate) => artifactFlags.has(candidate))
      if (key) mark("BUILD", artifactFlags.get(key))
    }
    if (artifactFlags.has("verify")) mark("VERIFY", artifactFlags.get("verify"))
    else if (artifactFlags.has("verify-report")) mark("VERIFY", artifactFlags.get("verify-report"))
    if (artifactFlags.has("explore")) mark("EXPLORE", artifactFlags.get("explore"))
    if (artifactFlags.has("fix")) mark("FIX", artifactFlags.get("fix"))
  }
  const legacy = legacyPhase(state.phase)
  const phaseCompleted: Partial<Record<CanonicalStage, boolean>> = {}
  if (legacy) {
    const phaseStages: Partial<Record<LegacyPhase, ActiveCanonicalStage[]>> = {
      ASSESS: ["DECIDE"], "QA-PLAN": [], DESIGN: ["DECIDE", "PLAN"], IMPLEMENT: ["DECIDE", "PLAN", "BUILD"],
      VERIFY: ["DECIDE", "PLAN", "BUILD", "VERIFY"], ARCHIVED: [...ALL_STAGES], PROPOSE: [], EXPLORE: [], FIX: [],
    }
    for (const stage of phaseStages[legacy] || []) phaseCompleted[stage] = true
  }
  for (const stage of ALL_STAGES) if (!(stage in completed) && stage in phaseCompleted) completed[stage] = phaseCompleted[stage]

  const current = stateStage(state.canonical_stage ?? state.canonicalStage ?? state.current_stage ?? state.currentStage ?? state.stage)
  return {
    current,
    legacy,
    completed,
    archived: current === "ARCHIVED" || state.archived === true || stateStage(state.status) === "ARCHIVED" || stateStage(state.phase) === "ARCHIVED",
    abandoned: state.abandoned === true || asString(state.status)?.toLowerCase() === "abandoned",
  }
}
function sourceState(source: WorkflowStatusInput["source"], hasEvidence: boolean): "openspec" | "engram" | "inferred" | "none" {
  const value = typeof source === "string" ? source : source?.state
  return value === "openspec" || value === "engram" || value === "inferred" || value === "none" ? value : hasEvidence ? "inferred" : "none"
}
function artifactLegacyPhase(artifacts: InternalArtifact[]): LegacyPhase | null {
  for (const [phase, types] of LEGACY_ARTIFACT_PHASES) {
    if (artifacts.some((artifact) => (phase === "IMPLEMENT" ? artifact.normalized.group === "BUILD" : types.has(artifact.normalized.type)))) return phase
  }
  return null
}
const LEGACY_COMPLETION_PHASES = new Set<LegacyPhase>(["ASSESS", "DESIGN", "IMPLEMENT", "VERIFY"])
function legacyCompletedStages(
  routeStages: ActiveCanonicalStage[],
  routeLegacyPhases: readonly LegacyPhase[],
  phase: LegacyPhase | null,
): ActiveCanonicalStage[] {
  if (!phase || !routeLegacyPhases.includes(phase)) return []
  if (phase === "ARCHIVED") return [...routeStages]
  const stage = LEGACY_STAGE[phase]
  if (!stage || stage === "ARCHIVED" || !LEGACY_COMPLETION_PHASES.has(phase)) return []
  const index = routeStages.indexOf(stage)
  return index < 0 ? [] : routeStages.slice(0, index + 1)
}
function canonicalCompletion(stage: ActiveCanonicalStage, artifacts: InternalArtifact[]): boolean {
  const candidates = orderedArtifacts(artifacts, stage)
  const canonical = candidates.filter((artifact) => CANONICAL_TYPES[stage].has(artifact.normalized.type))
  const selected = canonical.length ? canonical : candidates
  if (!canonical.length && stage === "DECIDE") {
    const propose = selected.find((artifact) => artifact.normalized.type === "propose")
    const assess = selected.find((artifact) => artifact.normalized.type === "assess")
    return Boolean(propose && assess && isTerminal(propose) && isTerminal(assess))
  }
  if (!canonical.length && stage === "PLAN") {
    const design = selected.find((artifact) => artifact.normalized.type === "design")
    return Boolean(design && isTerminal(design))
  }
  if (!canonical.length && stage === "VERIFY") {
    const report = selected.find((artifact) => artifact.normalized.type === "verify-report")
    return Boolean(report && successful(report))
  }
  const primary = selected.find((artifact) => artifact.normalized.type !== "qa-plan")
  return Boolean(primary && isTerminal(primary))
}
export function deriveWorkflowStatus(input: WorkflowStatusInput): WorkflowStatus {
  const artifacts = normalizeArtifacts(input.artifacts)
  const stateArtifact = artifacts.find((artifact) => artifact.normalized.type === "state")
  const parsedState = stateRecord(input.state ?? stateArtifact?.content)
  const signals = explicitStateSignals(parsedState.state)
  const warnings = [...(input.warnings || []), ...parsedState.warnings]
  const workType = declaredWorkType(parsedState.state, warnings)
  const route = workType ? resolveWorkflowRoute(workType) : null
  const routeStages = route?.stages || STAGES
  const routeLegacyPhases: readonly LegacyPhase[] = route?.legacy_phases || DEFAULT_LEGACY_PHASES
  const compatibleStateLegacy = signals.legacy && routeLegacyPhases.includes(signals.legacy) ? signals.legacy : null
  const routeCompleted = legacyCompletedStages(routeStages, routeLegacyPhases, compatibleStateLegacy)
  const completionSignals: Partial<Record<CanonicalStage, boolean>> = { ...signals.completed }
  for (const stage of routeCompleted) if (!(stage in signals.completed)) completionSignals[stage] = true
  const routeCurrent = signals.current && signals.current !== "INIT" && signals.current !== "ARCHIVED" && routeStages.includes(signals.current)
    ? signals.current
    : null
  if (routeCurrent) {
    for (const stage of routeStages.slice(0, routeStages.indexOf(routeCurrent))) {
      if (!(stage in signals.completed)) completionSignals[stage] = true
    }
  }

  for (const artifact of artifacts) {
    if (artifact.createdAt !== undefined && artifact.createdAt !== null &&
      (typeof artifact.createdAt !== "string" || !Number.isFinite(Date.parse(artifact.createdAt)))) {
      warnings.push(`Invalid artifact timestamp: ${artifact.normalized.original}`)
    }
  }

  const sourceValue = typeof input.source === "string" ? input.source : input.source?.state
  const source = sourceState(input.source, artifacts.some((artifact) => artifact.normalized.group !== null))
  if (sourceValue !== undefined && source === "inferred") warnings.push(`Invalid source state: ${String(sourceValue)}`)
  if (source === "engram") warnings.push("OpenSpec state was not read; status is derived from Engram artifacts.")
  const artifactRefs = Object.fromEntries(ALL_STAGES.map((stage) => [stage, [] as string[]])) as WorkflowStatus["artifact_refs"]
  for (const artifact of artifacts) {
    const group = artifact.normalized.group
    if (group && group in artifactRefs) artifactRefs[group as ActiveCanonicalStage].push(artifact.normalized.original)
  }
  for (const refs of Object.values(artifactRefs)) refs.splice(0, refs.length, ...Array.from(new Set(refs)))

  const completed = routeStages.filter((stage) => {
    if (stage in completionSignals) return completionSignals[stage]
    const currentIndex = routeCurrent ? routeStages.indexOf(routeCurrent) : -1
    if (currentIndex >= 0 && routeStages.indexOf(stage) > currentIndex) return false
    const stateStageValue = compatibleStateLegacy ? LEGACY_STAGE[compatibleStateLegacy] : null
    if (stateStageValue && stateStageValue !== "ARCHIVED" && routeStages.indexOf(stage) >= routeStages.indexOf(stateStageValue)) return false
    return canonicalCompletion(stage, artifacts)
  })
  const archiveReport = artifacts.find((artifact) => artifact.normalized.type === "archive-report")
  const archived = signals.archived || Boolean(archiveReport && successful(archiveReport))
  if (archived) completed.push(...routeStages.filter((stage) => !completed.includes(stage)))

  const progressArtifact = ["implement-progress", "apply-progress", "tasks"]
    .map((type) => artifacts.find((artifact) => artifact.normalized.type === type)).find(Boolean)
  let progress: ProgressState = { completed: 0, total: 0, known: false, source: null }
  if (progressArtifact) {
    const parsed = parseProgress(progressArtifact.content)
    progress = { ...parsed, source: progressArtifact.normalized.type }
    if (!parsed.known && !progressArtifact.explicitStatus) warnings.push(`Progress is unknown: ${progressArtifact.normalized.original} has no checklist.`)
  }
  const receipt = deriveReceiptState(input.receipt)
  let canonicalStage: WorkflowStage
  if (archived) canonicalStage = "ARCHIVED"
  else if (routeCurrent) canonicalStage = routeCurrent
  else {
    const evidence = routeStages.filter((stage) => orderedArtifacts(artifacts, stage).length > 0)
    const statePending = compatibleStateLegacy && compatibleStateLegacy !== "ARCHIVED" ? routeStages.find((stage) => !completed.includes(stage)) : null
    const active = statePending || [...evidence].reverse().find((stage) => !completed.includes(stage))
    const next = routeStages.find((stage) => !completed.includes(stage))
    const lastCompleted = [...routeStages].reverse().find((stage) => completed.includes(stage))
    const inferred = compatibleStateLegacy ? LEGACY_STAGE[compatibleStateLegacy] : null
    canonicalStage = active || next || evidence.at(-1) || lastCompleted || (inferred && inferred !== "ARCHIVED" ? inferred : null) || "INIT"
  }

  const pendingStage = archived ? null : routeStages.find((stage) => !completed.includes(stage)) || null
  const artifactLegacy = artifactLegacyPhase(artifacts)
  const compatibleArtifactLegacy = artifactLegacy && routeLegacyPhases.includes(artifactLegacy) ? artifactLegacy : null
  let legacy = compatibleStateLegacy || compatibleArtifactLegacy
  if (!legacy && canonicalStage !== "INIT") legacy = STAGE_LEGACY[canonicalStage]
  if (archived) legacy = "ARCHIVED"

  const declaredArtifacts = typeof input.source === "object" && Array.isArray(input.source.artifacts)
    ? input.source.artifacts.filter((artifact): artifact is string => typeof artifact === "string")
    : null
  return {
    change: input.change,
    canonical_stage: canonicalStage,
    legacy_phase: legacy,
    completed_canonical_stages: Array.from(new Set(completed)),
    pending_stage: pendingStage,
    artifact_refs: artifactRefs,
    progress,
    receipt,
    resumable: !archived && !signals.abandoned && receipt.state !== "pending" && (receipt.action === null || receipt.action === "retry") && pendingStage !== null,
    work_type: workType,
    source: { state: source, artifacts: declaredArtifacts || Object.values(artifactRefs).flat() },
    warnings: Array.from(new Set(warnings)),
  }
}
