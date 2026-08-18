export const JUDGE_SCHEMA_VERSION: 1

export interface RubricCriterion {
  id: string
  weight: number
  prompt: string
}

export interface JudgeRubric {
  schema_version: number
  criteria: RubricCriterion[]
  verdict_policy: string
}

export type JudgeVerdict = "pass" | "fail" | "unavailable" | null

export interface ShadowInput {
  expectations?: Array<string | { id?: string }>
  candidate_digest?: string | null
  trace_ref?: string | null
  evidence?: unknown
  golden?: unknown
}

export interface ShadowResult {
  mode: "shadow"
  schema_version: number
  judge_version: { rubric_version: number; model: string | null; provider: string | null }
  verdict: JudgeVerdict
  verdict_label: string | null
  rationale: string | null
  bound_to: { expectation_ids: string[]; candidate_digest: string | null; trace_ref: string | null }
  data_status: "complete" | "no_data"
}

export interface HumanJudgeCompare {
  agreement: boolean | null
  false_pass: boolean
  false_block: boolean
  unavailable: boolean
}

export function defaultJudgeRubric(): JudgeRubric

export function compareHumanJudge(input: { human: "pass" | "fail"; judge: "pass" | "fail" | "unavailable" }): HumanJudgeCompare

export function evaluateShadow(input?: ShadowInput): ShadowResult

export function recordShadowJudgment(entry: Record<string, unknown>): Record<string, unknown>

export function appendShadowJudgment(filePath: string, entry: Record<string, unknown>): string

export function main(argv?: string[]): Record<string, unknown>
