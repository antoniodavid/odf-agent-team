export interface DelegationRecord {
  timestamp?: string
  session_hash?: string
  phase?: string
  agent?: string
  skills_injected?: string[]
  skill_resolution?: string
  duration_ms?: number
  token_estimate?: number
  status?: string
  task_api_source?: string
  work_type?: string
  branch_id?: string
  join_status?: "running" | "complete" | "blocked"
  join_expected?: number
  join_completed?: number
  join_failed?: number
  join_running?: number
  validation_ratio?: number
  error?: string
  event?: string
  lifecycle?: "started" | "finished"
  span_kind?: "branch" | "task"
  schema_version?: number
  change?: string
  run_id?: string
  attempt_id?: string
  model_available?: boolean
  model?: string | null
  provider?: string | null
  tokens?: { input?: number | null; output?: number | null; estimated?: number | null }
  candidate_digest?: string
  trace_id?: string
  span_id?: string
  parent_span_id?: string
  receipt_ref?: string
  escalated?: boolean
  flow_stage?: "entry_started" | "intent_approved" | "policy_selected" | "build_started" | "verify_started" | "verified_completed"
  odoo_version?: number
  workspace?: string
  source_authority?: boolean
}

export type DataStatus = "no_data" | "partial" | "complete"

export interface DesignLibraryEntry {
  change?: string | null
  design_meta?: Record<string, unknown>
  rounds_real?: number | null
  design_ref?: string | null
  retrospective_ref?: string | null
  archived_at?: string | null
}

export interface DesignLibrary {
  schema_version?: number
  data_status?: DataStatus
  designs?: DesignLibraryEntry[]
}

export interface LearningBucket {
  work_type: string
  risk: string
  module_type: string
  n: number
  avg_rounds_real: number | null
}

export interface LearningMape {
  value: number | null
  n: number
  sigma: number | null
  label: string
}

export interface LearningProgress {
  data_status: DataStatus
  design_count: number
  by_bucket: LearningBucket[]
  mape: LearningMape
  reuse_proxy: number
}

export interface BaselineDuration {
  sample_count: number
  avg_ms: number | null
  p50_ms: number | null
  p95_ms: number | null
}

export interface BaselineOutcomes {
  sample_count: number
  counts: Record<"ok" | "blocked" | "error" | "timeout" | "unknown", number>
  rates: Record<"ok" | "blocked" | "error" | "timeout" | "unknown", number | null>
}

export interface BaselineCoverage {
  records: number
  reported: number
  coverage: number | null
  unknown: number
}

export interface EntryToFinalGate {
  status: "available" | "unavailable"
  sample_count: number
  p50_ms: number | null
  p95_ms: number | null
  changes: number
  calls_per_change: number | null
  verified_completions: number
  verified_completions_per_hour: number | null
  outcomes: BaselineOutcomes
  receipts: BaselineCoverage
  escalations: BaselineCoverage & { rate: number | null }
  validation: BaselineCoverage
  by_workspace: Record<string, number>
  by_source_authority: {
    with_source_authority: number
    without_source_authority: number
    unknown: number
  }
  by_odoo_version: Record<string, number>
  cohorts: {
    workspace: Record<string, EntryToFinalGateCohort>
    source_authority: Record<string, EntryToFinalGateCohort>
    odoo_version: Record<string, EntryToFinalGateCohort>
  }
}

export interface EntryToFinalGateCohort {
  sample_count: number
  p50_ms: number | null
  p95_ms: number | null
  verified_completions: number
}

export interface BaselineSummary {
  sample_count: number
  duration: BaselineDuration
  outcomes: BaselineOutcomes
  by_phase: Record<string, {
    calls: number
    duration: BaselineDuration
    outcomes: BaselineOutcomes
  }>
  coverage: {
    work_type: BaselineCoverage & { values: Record<string, number> }
    model: BaselineCoverage & { available: number; unavailable: number }
    validation: {
      task_calls: BaselineCoverage
      scheduler_joins: BaselineCoverage
    }
    receipt: BaselineCoverage
     escalation: BaselineCoverage & { rate: number | null }
  }
  coverage_gaps: string[]
  entry_to_final_gate: EntryToFinalGate
}

export interface DashboardData {
  total: number
  data_status: DataStatus
  coverage: number | null
  records_with_telemetry: number
  span_coverage: number | null
  span_records: number
  records_with_span_telemetry: number
  branch_coverage: number | null
  branch_records: number
  records_with_branch_telemetry: number
  telemetry_coverage: {
    runs: { records: number; available: number; coverage: number | null }
    spans: { records: number; available: number; coverage: number | null }
    branch: { records: number; available: number; coverage: number | null }
    model: { records: number; available: number; coverage: number | null }
    provider: { records: number; available: number; coverage: number | null }
    real_tokens: { records: number; available: number; coverage: number | null }
  }
  avgDurationMs: number
  avgTokens: number
  selfDiscoveredPct: number | null
  selfDiscoveredPctLabel: string
  skillInjectionPct: number | null
  skillInjectionPctLabel: string
  errorsCount: number
  errorPct: number | null
  errorPctLabel: string
  agentRows: string[]
  workTypeRows: string[]
  branchRows: string[]
  joinRows: string[]
  validationRatio: number | null
  skillRows: string[]
  errorRows: string[]
  days: number
  learning: LearningProgress
  baseline: BaselineSummary
  startedCount: number
  unfinishedCount: number
  unfinishedRunIds: string[]
}

export function resolveMetricsDir(): string
export function readDelegationFile(filePath: string): DelegationRecord[]
export function collectDelegations(metricsDir: string, days: number): DelegationRecord[]
export function learningProgress(library: DesignLibrary | null | undefined): LearningProgress
export function entryToFinalGate(records: DelegationRecord[], days?: number): EntryToFinalGate
export function baselineSummary(records: DelegationRecord[], days?: number): BaselineSummary
export function buildDashboard(records: DelegationRecord[], days: number, library?: DesignLibrary | null): DashboardData
export function renderDashboard(d: DashboardData): string
export function main(argv?: string[]): string
