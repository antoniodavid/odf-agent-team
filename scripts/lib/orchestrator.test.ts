import { describe, it, expect } from 'vitest';
import {
  PHASE_ORDER,
  isPreflightComplete,
  getNextPhase,
  selectActiveChange,
  renderStatusTable,
  renderStatusDetail,
  updateStateAfterPhase,
} from './orchestrator.js';

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    change: 'test-change',
    phase: 'init',
    preflight: {
      change: 'test-change',
      execution_mode: 'interactive',
      artifact_store: 'openspec',
      delivery_strategy: 'ask-on-risk',
      review_budget_lines: 400,
      odoo_version: 18,
      tdd_mode: false,
      solution_strategy: 'custom',
      chain_strategy: 'none',
      persisted_at: '2026-06-18T00:00:00Z',
    },
    artifacts: {
      assess: false,
      qa_plan: false,
      design: false,
      implement: false,
      qa_review: false,
      qa_aggregate: false,
      verify: false,
    },
    timestamps: {
      started_at: '2026-06-18T00:00:00Z',
      assess_completed: null as string | null,
      design_completed: null as string | null,
      implement_completed: null as string | null,
      verify_completed: null as string | null,
    },
    last_updated: '2026-06-18T00:00:00Z',
    ...overrides,
  };
}

describe('orchestrator state machine', () => {
  it('defines expected phase order', () => {
    expect(PHASE_ORDER).toEqual(['init', 'preflight', 'assess', 'qa-plan', 'design', 'implement', 'verify', 'archived']);
  });

  describe('isPreflightComplete', () => {
    it('returns false when preflight is missing', () => {
      expect(isPreflightComplete({})).toBe(false);
    });

    it('returns false when preflight is invalid', () => {
      expect(isPreflightComplete({ preflight: { change: 'x' } as any })).toBe(false);
    });

    it('returns true for complete preflight', () => {
      expect(isPreflightComplete(makeState())).toBe(true);
    });
  });

  describe('getNextPhase', () => {
    it('returns preflight when preflight is incomplete', () => {
      expect(getNextPhase({})).toBe('preflight');
    });

    it('returns assess after preflight', () => {
      expect(getNextPhase(makeState())).toBe('assess');
    });

    it('returns design after assess is done', () => {
      const state = makeState({
        phase: 'assess',
        artifacts: { ...makeState().artifacts, assess: true },
      });
      expect(getNextPhase(state)).toBe('design');
    });

    it('returns implement after design is done', () => {
      const state = makeState({
        phase: 'design',
        artifacts: { ...makeState().artifacts, assess: true, design: true },
      });
      expect(getNextPhase(state)).toBe('implement');
    });

    it('returns verify after implement is done', () => {
      const state = makeState({
        phase: 'implement',
        artifacts: { ...makeState().artifacts, assess: true, design: true, implement: true },
      });
      expect(getNextPhase(state)).toBe('verify');
    });

    it('returns archived when all artifacts are done', () => {
      const state = makeState({
        phase: 'verify',
        artifacts: { assess: true, qa_plan: true, design: true, implement: true, qa_review: true, qa_aggregate: true, verify: true },
      });
      expect(getNextPhase(state)).toBe('archived');
    });
  });

  describe('selectActiveChange', () => {
    const states = [
      { change: 'older', state: makeState({ last_updated: '2026-06-18T00:00:00Z' }) },
      { change: 'newer', state: makeState({ last_updated: '2026-06-18T01:00:00Z' }) },
    ];

    it('selects named change', () => {
      const result = selectActiveChange(states, 'newer');
      expect(result.change).toBe('newer');
    });

    it('selects latest when no name provided', () => {
      const result = selectActiveChange(states);
      expect(result.change).toBe('newer');
    });

    it('reports ambiguity with multiple active changes', () => {
      const result = selectActiveChange(states);
      expect(result.change).toBe('newer');
    });

    it('errors when named change not found', () => {
      const result = selectActiveChange(states, 'missing');
      expect(result.error).toContain('No se encontró');
    });
  });

  describe('renderStatusTable', () => {
    it('renders empty message when no active changes', () => {
      expect(renderStatusTable([])).toContain('No hay cambios ODF activos');
    });

    it('renders table with active change', () => {
      const table = renderStatusTable([{ change: 'my-change', state: makeState() }]);
      expect(table).toContain('| Cambio ');
      expect(table).toContain('my-change');
      expect(table).toContain('assess');
    });
  });

  describe('renderStatusDetail', () => {
    it('renders detail for a change', () => {
      const detail = renderStatusDetail('my-change', makeState());
      expect(detail).toContain('Estado ODF: my-change');
      expect(detail).toContain('Fase actual: init');
      expect(detail).toContain('Siguiente fase: assess');
    });
  });

  describe('updateStateAfterPhase', () => {
    it('marks artifact complete and updates timestamp', () => {
      const state = makeState({ phase: 'preflight' });
      const updated = updateStateAfterPhase(state, 'assess', { strategy: 'custom' });
      expect(updated.artifacts!.assess).toBe(true);
      expect(updated.phase).toBe('assess');
      expect(updated.preflight!.solution_strategy).toBe('custom');
      expect(updated.last_updated).not.toBe(state.last_updated);
    });
  });
});
