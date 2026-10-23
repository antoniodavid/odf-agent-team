export interface EvaluationFixture {
  name?: string
  record?: Record<string, unknown>
  expect?: Record<string, unknown>
}

export type DataStatus = "no_data" | "partial" | "complete"

export interface OfflineResult {
  mode: "offline"
  data_status: DataStatus
  total: number
  passed: number
  failed: number
  score: number | null
  score_label: string
  results: Array<{ name: string; passed: boolean }>
}

export interface OnlineResult {
  mode: "online"
  data_status: DataStatus
  total: number
  errors: number
  error_rate: number | null
  score: number | null
  score_label: string
  coverage?: number
  records_with_telemetry?: number
  started_count?: number
  unfinished_count?: number
}

export interface GoldenTrajectory {
  id: string
  work_type: string
  risk: string
  expectation: string
  trajectory: Array<{ step: string; tool?: string; ok?: boolean; note?: string }>
  outcome: "pass" | "fail"
  golden: true
  protects: string
}

export interface GoldenValidation {
  valid: boolean
  problems: string[]
}

export interface GoldenResult {
  mode: "golden"
  data_status: DataStatus
  total: number
  passed: number
  failed: number
  score: number | null
  results: Array<{
    id: string
    passed: boolean
    expectation: string | null
    protects: string | null
    problems: string[]
  }>
}

export function evaluateOffline(fixtures: EvaluationFixture[]): OfflineResult

export function evaluateOnline(records: Record<string, unknown>[], days?: number): OnlineResult

export function validateGolden(golden: unknown): GoldenValidation

export function evaluateGoldens(goldens: unknown[]): GoldenResult

export function main(argv?: string[]): Record<string, unknown> | string

export interface DecisionStageActivity {
  calls: number
  ok: number
  blocked: number
  error: number
  duration_ms: number
  avg_duration_ms: number | null
}

export interface DecisionReceipt {
  stage: string | null
  role: string | null
  status: string | null
  cause: string | null
  action: string | null
}

export interface DecisionReview {
  schema_version: 1
  change: string
  route: "correct" | "incorrect"
  risk: "under" | "ok" | "over"
  plan: "under" | "ok" | "over"
  gate: "correct" | "incorrect"
  rating: number
  reviewed_at: string
  source: "local-human-review"
}

export interface DecisionChange {
  change: string
  work_type: string | null
  route: string[]
  terminal_stage: string | null
  canonical_stage: string | null
  completed_stages: string[]
  pending_stage: string | null
  resumable: boolean | null
  archived: boolean
  source: "openspec+metrics" | "openspec-only"
  risk_tier: string | null
  gate_stage: string | null
  plan_mode: string | null
  verification: string | null
  predicted_route: string | null
  predicted_stages: string[] | null
  route_agreement: boolean | null
  review: DecisionReview | null
  review_route_correct: boolean | null
  review_risk_fit: string | null
  review_plan_fit: string | null
  review_gate_correct: boolean | null
  review_rating: number | null
  metrics_count: number
  delegations: number
  stage_activity: Record<string, DecisionStageActivity>
  attempts: number
  failed_attempts: number
  rework_count: number
  first_pass: boolean
  receipts: DecisionReceipt[]
  override_count: number
}

export interface DecisionAggregate {
  changes: number
  route_agreement: { compared: number; agreed: number; rate: number | null }
  risk_tiers: Record<string, number>
  plan_modes: Record<string, number>
  first_pass: { count: number; rate: number | null }
  rework: { changes: number; rate: number | null }
  receipts: { count: number; causes: Record<string, number>; statuses: Record<string, number> }
  overrides: number
  archive: { count: number; rate: number | null }
  reviews: {
    count: number
    coverage: number | null
    route_correct: { count: number; total: number; rate: number | null }
    risk_fit: Record<string, number>
    plan_fit: Record<string, number>
    gate_correct: { count: number; total: number; rate: number | null }
    avg_rating: number | null
  }
  stage_activity: Record<string, DecisionStageActivity>
}

export interface DecisionReport {
  mode: "decisions"
  data_status: DataStatus
  days: number
  total: number
  changes: DecisionChange[]
  aggregate: DecisionAggregate
  warnings: string[]
}

export function evaluateDecisions(opts?: {
  root?: string
  days?: number
  metricsRecords?: Record<string, unknown>[]
}): DecisionReport

export function renderDecisionMarkdown(report: DecisionReport): string

export interface AgreementReport {
  mode: "agreement"
  data_status: DataStatus
  total: number
  compared: number
  agreement: number
  false_pass: number
  false_block: number
  unavailable: number
  rates: {
    agreement: number | null
    false_pass: number | null
    false_block: number | null
    unavailable: number | null
  }
}

export function readDecisionReview(root: string, change: string): DecisionReview | null

export function writeDecisionReview(opts: {
  root?: string
  change: string
  route: "correct" | "incorrect"
  risk: "under" | "ok" | "over"
  plan: "under" | "ok" | "over"
  gate: "correct" | "incorrect"
  rating: number
}): DecisionReview

export function readShadowJudgments(filePath: string): Array<Record<string, unknown>>

export function evaluateAgreement(entries: Array<Record<string, unknown>>): AgreementReport

export function renderAgreementMarkdown(report: AgreementReport): string

export interface ComparisonDelta {
  before: number | null
  after: number | null
  delta: number | null
  direction: "up" | "down" | "flat" | null
  higher_is_better: boolean | null
}

export interface DecisionComparison {
  mode: "comparison"
  data_status: DataStatus
  before: Record<string, number | null> | null
  after: Record<string, number | null> | null
  deltas: Record<string, ComparisonDelta>
  warnings: string[]
}

export interface CadenceReport {
  mode: "cadence"
  data_status: DataStatus
  due: boolean
  days: number
  changes: number
  reviewed_changes: number
  review_count: number
  coverage: number | null
  latest_review_at: string | null
  age_days: number | null
  message: string
}

export interface ImprovementProposal {
  id: string
  kind: string
  severity: "high" | "medium" | "low"
  evidence: Record<string, number | null>
  recommendation: string
  requires_human_approval: true
  auto_apply: false
}

export interface ProposalReport {
  mode: "proposals"
  data_status: DataStatus
  proposals: ImprovementProposal[]
  warnings: string[]
}

export function compareDecisions(before: DecisionReport, after: DecisionReport): DecisionComparison

export function renderComparisonMarkdown(report: DecisionComparison): string

export function evaluateCadence(opts?: { root?: string; days?: number }): CadenceReport

export function renderCadenceMarkdown(report: CadenceReport): string

export function buildProposals(report: DecisionReport): ProposalReport

export function renderProposalsMarkdown(report: ProposalReport): string
