export const LEARNING_SCHEMA_VERSION: 1

export interface VerifiedRun {
  candidate_digest: string
  receipt?: { status: string; candidate_digest?: string; receipt_id?: string }
  receipt_ref?: { status: string; candidate_digest?: string; receipt_id?: string }
  expectations: Array<{ id?: string; approved: boolean }>
  outcome: "pass" | "fail" | "verified"
  work_type?: string
  topic?: string
  tool_call_count?: number
  trace_ref?: unknown
}

export type GoldenRegression = "pending" | "passed" | "failed"

export interface MemoryCandidate {
  id: string
  source_runs: string[]
  fact: string
  evidence_refs: string[]
  golden_regression: GoldenRegression
  proposed_for: "human"
  summary?: string
}

export interface SkillCandidate {
  id: string
  title: string
  trajectory_summary: string
  source_run: string
  golden_regression: GoldenRegression
  proposed_for: "human"
  reason: string
}

export interface MemoryConsolidation {
  data_status: "no_data" | "complete"
  candidates: MemoryCandidate[]
}

export interface SkillProposal {
  proposed: boolean
  reason?: string
  id?: string
  title?: string
  trajectory_summary?: string
  source_run?: string
  golden_regression?: GoldenRegression
  proposed_for?: "human"
}

export interface GoldenRegressionResult {
  data_status: "no_data" | "complete"
  results: Array<{ candidate_id: string; status: "passed" | "failed" | "pending"; protects: string[] }>
}

export interface LearningPlan {
  schema_version: number
  data_status: "no_data" | "complete"
  plan: {
    memory: MemoryCandidate[]
    skills: SkillCandidate[]
    golden_regression: GoldenRegressionResult
    candidates: Array<Record<string, unknown>>
  }
  kpi: {
    accepted: number
    regressions_avoided: number
    rolled_back: number
    pending: number
  }
}

export function isVerifiedRun(run: unknown): boolean

export function consolidateMemory(runs: unknown[]): MemoryConsolidation

export function proposeSkillCandidate(run: unknown, options?: { tool_calls_threshold?: number }): SkillProposal

export function runGoldenRegression(candidates: Array<Record<string, unknown>>, goldens: unknown[]): GoldenRegressionResult

export function approveCandidates(candidates: Array<Record<string, unknown>>, options: { approved_ids: string[] }): Array<Record<string, unknown>>

export function rollbackCandidate(candidate: Record<string, unknown>): Record<string, unknown>

export function buildPlan(runs: unknown[], goldens: unknown[], options?: { approved_ids?: string[] }): LearningPlan

export function main(argv?: string[]): LearningPlan
