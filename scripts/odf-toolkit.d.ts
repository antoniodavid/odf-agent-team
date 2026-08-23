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

export interface ManualEvidence {
  change: string
  phase: "VERIFY"
  batch: number
  risk_tier: string
  frozen_diff_ref: string | null
  candidate_digest: string | null
  executor: "user-manual"
  test_identity: string
  resolved_at: string
  commands: Array<{ name: string; command: string; database: string; exit_code: number; output_tail: string; output_evidence: string }>
}

export function buildManualEvidence(opts: {
  change: string
  command: string
  database: string
  output: string
  exitCode?: number
  testIdentity?: string
  root?: string
}): { problems: string[]; evidence: ManualEvidence }

export function asBoolean(value: unknown): boolean
export function normalizeResult(raw: unknown, opts?: { root?: string; phase?: string }): NormalizedResult
export function resolveAgent(registry: { agents?: unknown[] }, phase: string, taskKeywords: string[]): string | null
export function matchSkills(registry: { skills?: unknown[] }, phase: string | null, context: { task?: string; files?: string[]; odooVersion?: number | null }): string[]
export function loadRegistry(): Record<string, unknown> | null
export function stateBundle(root: string, change: string): StateBundle
export function evidencePack(repoDir: string): EvidencePack
export function contextPack(repoDir: string, task: string, maxFiles?: number): ContextPack
export function metricsSummary(days?: number): MetricsSummary
export interface DependencyProbe {
  engram_cli: "available" | "missing"
  codegraph_cli: "available" | "missing"
  git: "available" | "missing"
  node: "available" | "missing"
  docker: "available" | "missing"
  python3: "available" | "missing"
}
export function dependencyProbe(): DependencyProbe
export interface LookupMatch { file: string; line: number; snippet: string; term: string }
export function sourceLookup(opts: { source: string; repos?: string; id?: string; model?: string; field?: string; module?: string }): { query: Record<string, string | undefined>; results: LookupMatch[] }
export function verifyRefs(opts: { repo: string; source: string; repos?: string }): {
  refs_checked: number
  models_checked: number
  missing_refs: Array<{ ref: string; file: string }>
  missing_models: Array<{ model: string }>
  ok: boolean
}
export function redundancyCheck(repoDir: string, terms: string[]): { terms: string[]; matches: Array<{ file: string; term: string; line: number }> }
export function priorLearnings(project: string): Array<{ topic: string; title: string }>
export function buildManualEvidence(opts: {
  change: string
  command: string
  database: string
  output: string
  exitCode?: number
  testIdentity?: string
  root?: string
}): { problems: string[]; evidence: ManualEvidence }
