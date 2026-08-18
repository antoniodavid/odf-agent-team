export const SAFETY_SCHEMA_VERSION: 1
export const SAFETY_RULES: SafetyRule[]

export interface SafetyRule {
  id: string
  class: string
  description: string
  patterns: RegExp[]
}

export interface SafetyInspectionResult {
  schema_version: number
  blocked: boolean
  decision: "allow" | "block"
  classes: string[]
  matched_rules: string[]
  reason?: string
  safe_continuation?: string
  data_status: "no_data" | "partial" | "complete"
}

export function safeContinuation(klass: string): string

export function inspectToolArgs(input: {
  tool: string
  args: unknown
  authorized_roots?: string[]
}): SafetyInspectionResult

export const corpus: Array<{ class: string; arg: string }>
