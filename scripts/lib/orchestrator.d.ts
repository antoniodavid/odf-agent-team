export interface StateArtifactMap {
  assess?: boolean;
  qa_plan?: boolean;
  design?: boolean;
  implement?: boolean;
  qa_review?: boolean;
  qa_aggregate?: boolean;
  verify?: boolean;
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
}

export interface ChangeState {
  change?: string;
  phase?: string;
  preflight?: PreflightRecord;
  artifacts?: StateArtifactMap;
  last_updated?: string;
  odoo_version?: number;
  strategy?: string;
  timestamps?: Record<string, string | null>;
  [key: string]: unknown;
}

export interface ActiveChange {
  change: string;
  state: ChangeState;
  last_updated?: string;
}

export interface PhaseResult {
  status?: string;
  strategy?: string;
  modules_affected?: string[];
  [key: string]: unknown;
}

export const PHASE_ORDER: string[];
export const ARTIFACT_FIELDS: Record<string, string>;

export function isPreflightComplete(state: ChangeState | null | undefined): boolean;
export function getNextPhase(state: ChangeState): string;
export function isActive(state: ChangeState | null | undefined): boolean;
export function loadActiveChanges(baseDir?: string): ActiveChange[];
export function selectActiveChange(states: ActiveChange[], name?: string | null): {
  change?: string;
  state?: ChangeState;
  error?: string;
  ambiguous?: boolean;
  candidates?: string[];
};
export function updateStateAfterPhase(state: ChangeState, phase: string, result?: PhaseResult): ChangeState;
export function renderStatusTable(states: ActiveChange[]): string;
export function renderStatusDetail(change: string, state: ChangeState): string;
