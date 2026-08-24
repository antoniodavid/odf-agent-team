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
  startedCount: number
  unfinishedCount: number
  unfinishedRunIds: string[]
}

export function resolveMetricsDir(): string
export function readDelegationFile(filePath: string): DelegationRecord[]
export function collectDelegations(metricsDir: string, days: number): DelegationRecord[]
export function learningProgress(library: DesignLibrary | null | undefined): LearningProgress
export function buildDashboard(records: DelegationRecord[], days: number, library?: DesignLibrary | null): DashboardData
export function renderDashboard(d: DashboardData): string
export function main(argv?: string[]): string
