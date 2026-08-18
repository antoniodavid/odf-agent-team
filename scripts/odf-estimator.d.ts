export const ESTIMATOR_SCHEMA_VERSION = 1

export interface DesignMeta {
  change?: string | null
  work_type: string
  risk: "low" | "medium" | "high" | string
  module_type: "new" | "inherit" | string
  odoo_version: number | null
  models: number
  fields: number
  views: number
  tasks: number
  exp_count: number
  manifest_depends: string[]
  module_destination: string | null
  closed: boolean
}

export interface DeriveResult {
  meta: DesignMeta | null
  reason?: string
}

export type DataStatus = "no_data" | "partial" | "complete"

export interface HistoryEntry {
  change?: string
  design_meta?: Partial<DesignMeta>
  rounds_real?: number
  duration_ms?: number
}

export interface MatchEntry {
  change: string | null
  score: number
  rounds_real: number
}

export interface Estimate {
  base_rounds: number
  risk_coef: number
  risk_adjusted_rounds: number
  integration_rounds: number
  total_rounds: number
  wallclock_min: number
  minutes_per_round: number
  confidence: { n: number; sigma: number }
}

export interface EstimateResult {
  data_status: DataStatus
  matching?: MatchEntry[]
  estimate: Estimate | null
  score_label: string
}

export function deriveDesignMeta(document: unknown): DeriveResult

export function similarity(a: Partial<DesignMeta>, b: Partial<DesignMeta>): number

export function estimateFromHistory(
  design_meta: Partial<DesignMeta>,
  history: HistoryEntry[],
  opts?: { minutes_per_round?: number; top_n?: number }
): EstimateResult

export function roundsFromDurationMs(duration_ms: number, minutes_per_round?: number): number

export function main(argv?: string[]): Record<string, unknown>
