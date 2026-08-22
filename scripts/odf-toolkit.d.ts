export type InnerStatus = "ok" | "warning" | "blocked" | "failed" | "error"

export interface NormalizedArtifactRef {
  name?: string
  store?: string
  ref?: string
  verified: boolean | "engram-topic" | null
}

export interface NormalizedResult {
  status: InnerStatus
  design_closed: boolean
  executive_summary: string | null
  artifacts_saved: NormalizedArtifactRef[]
  warnings: string[]
}

export interface ResolvePreview {
  status: "ok" | "error"
  agent: string | null
  skills: string[]
  profile: Record<string, unknown> | null
  warnings?: string[]
}

export interface StateArtifactFile {
  name: string
  size: number
  mtime: string
}

export interface StateBundle {
  change: string
  state: string | null
  artifacts: StateArtifactFile[]
  receipt: Record<string, unknown> | null
  policy_gate: Record<string, unknown> | null
  validation_evidence: Record<string, unknown> | null
  parallel_join: Record<string, unknown> | null
}

export interface EvidencePack {
  head: string | null
  branch: string | null
  dirty: boolean
  changed: Array<{ added: number; deleted: number; path: string }>
  diff_check: boolean
}

export interface ContextPack {
  status: "ok" | "unavailable" | "unindexed" | "error"
  context?: string
  hint?: string
}

export interface MetricsSummary {
  days: number
  records: number
  by_phase: Record<string, {
    calls: number
    ok: number
    blocked: number
    error: number
    timeout: number
    total_duration_ms: number
    avg_duration_ms: number
  }>
}

export function asBoolean(value: unknown): boolean
export function normalizeResult(raw: unknown, opts?: { root?: string; phase?: string }): NormalizedResult
export function resolveAgent(registry: { agents?: unknown[] }, phase: string, taskKeywords: string[]): string | null
export function matchSkills(registry: { skills?: unknown[] }, phase: string | null, context: { task?: string; files?: string[]; odooVersion?: number | null }): string[]
export function loadRegistry(): Record<string, unknown> | null
export function stateBundle(root: string, change: string): StateBundle
export function evidencePack(repoDir: string): EvidencePack
export function contextPack(repoDir: string, task: string, maxFiles?: number): ContextPack
export function metricsSummary(days?: number): MetricsSummary
