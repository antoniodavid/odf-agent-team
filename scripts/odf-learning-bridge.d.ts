export const LEARNING_SCHEMA_VERSION: 1

export interface ReceiptInput {
  status?: string
  candidate_digest?: string
  receipt_id?: string
}

export interface ExpectationInput {
  id?: string
  statement?: string
  approved?: boolean
}

/** Canonical odf/{change}/expectations artifact, or a plain array of EXP-XX. */
export type ExpectationsInput =
  | { expectations?: ExpectationInput[]; approved?: boolean; approved_by?: string }
  | ExpectationInput[]

export interface DesignMetaInput {
  change?: string | null
  work_type?: string
  risk?: string
  module_type?: string
  odoo_version?: number | null
  candidate_digest?: string
  models?: number
  fields?: number
  views?: number
  tasks?: number
  exp_count?: number
  manifest_depends?: string[]
  module_destination?: string | null
  closed?: boolean
}

export interface ToolCallSource {
  tool_call_count: number | null
  tool_call_source: "actual" | "derived" | null
}

export interface BuiltRun {
  candidate_digest: string
  receipt_ref: { status: string; candidate_digest: string; receipt_id?: string }
  expectations: Array<{ id?: string; statement?: string; approved: boolean }>
  outcome: "pass" | "fail" | "verified"
  work_type: string | null
  topic: string | null
  tool_call_count: number | null
  tool_call_source: "actual" | "derived" | null
  design_meta: DesignMetaInput | null
}

export interface BuildResult {
  run: BuiltRun | null
  data_status: "complete" | "no_data"
  reason?: string
}

export interface ChangeInput {
  design_meta?: DesignMetaInput
  expectations?: ExpectationsInput
  records?: unknown[] | null
  goldens?: unknown[]
  outcome?: string
  receipt?: ReceiptInput
  tool_calls_threshold?: number
}

export interface GoldenRegressionResult {
  data_status: "no_data" | "complete"
  results: Array<{ candidate_id: string; status: "passed" | "failed" | "pending"; protects: string[] }>
}

export interface ProposalResult {
  schema_version: number
  data_status: "complete" | "no_data"
  run_verified: boolean
  reason?: string
  skill_candidates: Array<Record<string, unknown>>
  memory_candidates: Array<Record<string, unknown>>
  golden_regression: GoldenRegressionResult
  kpi: {
    accepted: number
    regressions_avoided: number
    rolled_back: number
    pending: number
  }
}

export function buildVerifiedRunFromChange(input?: ChangeInput): BuildResult

export function proposeFromArchivedChange(input?: ChangeInput): ProposalResult

export function main(argv?: string[]): ProposalResult
