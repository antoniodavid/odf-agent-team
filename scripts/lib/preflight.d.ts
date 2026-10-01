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
  execution_mode: 'interactive' | 'batch' | 'auto';
  artifact_store: 'openspec' | 'engram' | 'hybrid';
  delivery_strategy: 'ask-always' | 'ask-on-risk' | 'auto-chain' | 'single-pr';
  review_budget_lines: number;
  odoo_version: number;
  tdd_mode: boolean;
  solution_strategy: 'standard' | 'custom' | 'pending';
  chain_strategy: 'none' | 'chained' | 'feature-branch';
  validation_mode?: 'automated' | 'manual-acceptance';
  persisted_at?: string;
  [key: string]: unknown;
}

export type PreflightDefaults = Omit<PreflightRecord, 'persisted_at'>;

export interface NormalizedPreflightRecord extends PreflightRecord {
  persisted_at: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  normalized: NormalizedPreflightRecord;
}

export const PREFLIGHT_VERSION: string;
export const PREFLIGHT_FIELDS: Record<string, PreflightFieldMeta>;
export const REQUIRED_FIELDS: string[];

export function sanitizeChangeName(name: string | null | undefined): string;
export function detectOdooVersionFromManifest(cwd?: string): number | null;
export function inferDefaults(changeName: string, projectConfig?: Record<string, unknown> | null, registryFlags?: Record<string, unknown> | null): PreflightDefaults;
export function validatePreflight(record: unknown): ValidationResult;
export function getMissingFields(record: unknown): string[];
export function renderPreflightPrompt(record: Record<string, unknown>, missingFields: string[]): string;
export function getStatePath(changeName: string, baseDir?: string): string;
export function loadPreflight(changeName: string, baseDir?: string): PreflightRecord | null;
export function savePreflight(changeName: string, record: PreflightRecord, baseDir?: string): string;
export function renderPreflightSummary(record: PreflightRecord): string;
