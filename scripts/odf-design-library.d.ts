export const LIBRARY_SCHEMA_VERSION = 1

export interface DesignMeta {
  change?: string | null
  work_type?: string
  risk?: string
  module_type?: string
  odoo_version?: number | null
  models?: number
  fields?: number
  views?: number
  tasks?: number
  exp_count?: number
  manifest_depends?: string[]
  module_destination?: string | null
  closed?: boolean
}

export interface LibraryEntry {
  change: string | null
  design_meta: Partial<DesignMeta>
  rounds_real: number | null
  design_ref: string | null
  retrospective_ref: string | null
  archived_at: string | null
}

export type DataStatus = "no_data" | "partial" | "complete"

/** Valid index: { schema_version, designs }. Missing/corrupt: { data_status: "no_data", designs: [] }. */
export interface LibraryRead {
  schema_version?: number
  designs: LibraryEntry[]
  data_status?: "no_data"
}

export interface Library {
  schema_version: number
  designs: LibraryEntry[]
}

export interface SearchResult {
  change: string | null
  score: number
  rounds_real: number | null
  archived_at: string | null
}

export interface SearchResultSet {
  data_status: DataStatus
  results: SearchResult[]
}

export interface CollectResult {
  rounds_real: number | null
  data_status: "no_data" | "complete"
  duration_ms: number
  record_count: number
}

export interface CalibrationBucket {
  work_type: string
  risk: string
  module_type: string
  n: number
  rounds_per_model: number
  rounds_per_task: number
  sigma: number
}

export interface CalibrationResult {
  schema_version: number
  buckets: CalibrationBucket[]
  data_status: "no_data" | "complete"
}

export interface AppendOptions {
  rounds_real?: number
  design_ref?: string
  retrospective_ref?: string
  archived_at?: string
}

export function appendDesign(design_meta: Partial<DesignMeta>, opts?: AppendOptions): LibraryEntry

export function readLibrary(filePath: string): LibraryRead

export function writeLibrary(filePath: string, library: Library): void

export function searchDesigns(query: string, library: Library | null, opts?: { top_n?: number }): SearchResultSet

export function appendAndWrite(filePath: string, design_meta: Partial<DesignMeta>, opts?: AppendOptions): LibraryEntry

export function collectImplementationRounds(
  records: unknown[],
  opts?: { minutes_per_round?: number }
): CollectResult

export function calibrateFromHistory(library: Library | null): CalibrationResult

export function resolveLibraryPath(opts?: { repo?: boolean }): string

export function main(argv?: string[]): Record<string, unknown>
