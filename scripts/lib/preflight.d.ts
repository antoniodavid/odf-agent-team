export interface PreflightFieldMeta {
  type: 'string' | 'enum' | 'integer' | 'boolean';
  required?: boolean;
  default?: unknown;
  values?: (string | number)[];
  min?: number;
  max?: number;
  question: string | null;
  validate?: (value: unknown) => boolean;
}

export interface PreflightRecord {
  change: string;
  execution_mode: string;
  artifact_store: string;
  delivery_strategy: string;
  review_budget_lines: number;
  odoo_version: number;
  tdd_mode: boolean;
  solution_strategy: string;
  chain_strategy: string;
  persisted_at?: string;
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  normalized: PreflightRecord;
}

export const PREFLIGHT_VERSION: string;
export const PREFLIGHT_FIELDS: Record<string, PreflightFieldMeta>;
export const REQUIRED_FIELDS: string[];

export function sanitizeChangeName(name: string | null | undefined): string;
export function detectOdooVersionFromManifest(cwd?: string): number | null;
export function inferDefaults(changeName: string, projectConfig?: Record<string, unknown> | null): PreflightRecord;
export function validatePreflight(record: Record<string, unknown>): ValidationResult;
export function getMissingFields(record: Record<string, unknown>): string[];
export function renderPreflightPrompt(record: Record<string, unknown>, missingFields: string[]): string;
export function getStatePath(changeName: string, baseDir?: string): string;
export function loadPreflight(changeName: string, baseDir?: string): PreflightRecord | null;
export function savePreflight(changeName: string, record: PreflightRecord, baseDir?: string): string;
export function renderPreflightSummary(record: PreflightRecord): string;
