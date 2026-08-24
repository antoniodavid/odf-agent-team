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

export function main(argv?: string[]): Record<string, unknown>
