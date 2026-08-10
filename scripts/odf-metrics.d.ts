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
}

export interface DashboardData {
  total: number
  avgDurationMs: number
  avgTokens: number
  selfDiscoveredPct: number
  errorsCount: number
  errorPct: number
  agentRows: string[]
  workTypeRows: string[]
  branchRows: string[]
  joinRows: string[]
  validationRatio: number | null
  skillRows: string[]
  errorRows: string[]
  days: number
}

export function resolveMetricsDir(): string
export function readDelegationFile(filePath: string): DelegationRecord[]
export function collectDelegations(metricsDir: string, days: number): DelegationRecord[]
export function buildDashboard(records: DelegationRecord[], days: number): DashboardData
export function renderDashboard(d: DashboardData): string
export function main(argv?: string[]): string
