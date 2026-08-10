export interface EvaluationFixture {
  name?: string
  record?: Record<string, unknown>
  expect?: Record<string, unknown>
}

export function evaluateOffline(fixtures: EvaluationFixture[]): {
  mode: "offline"
  total: number
  passed: number
  failed: number
  score: number
  results: Array<{ name: string; passed: boolean }>
}

export function evaluateOnline(records: Record<string, unknown>[], days?: number): {
  mode: "online"
  total: number
  errors: number
  error_rate: number
  score: number
}

export function main(argv?: string[]): Record<string, unknown>
