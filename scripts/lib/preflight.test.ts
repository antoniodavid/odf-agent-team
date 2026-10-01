import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  sanitizeChangeName,
  validatePreflight,
  inferDefaults,
  getMissingFields,
  renderPreflightPrompt,
  savePreflight,
  loadPreflight,
  getStatePath,
} from './preflight.js';

describe('preflight', () => {
  describe('sanitizeChangeName', () => {
    it('lowercases and kebab-cases names', () => {
      expect(sanitizeChangeName('My Feature')).toBe('my-feature');
    });

    it('removes invalid characters', () => {
      expect(sanitizeChangeName('feature@v1.0!')).toBe('featurev10');
    });

    it('preserves underscores', () => {
      expect(sanitizeChangeName('my_feature')).toBe('my_feature');
    });
  });

  describe('validatePreflight', () => {
    it('accepts a complete valid record', () => {
      const record = {
        change: 'my-feature',
        execution_mode: 'interactive',
        artifact_store: 'openspec',
        delivery_strategy: 'ask-on-risk',
        review_budget_lines: 400,
        odoo_version: 18,
        tdd_mode: false,
        solution_strategy: 'custom',
        chain_strategy: 'feature-branch',
      };
      const result = validatePreflight(record);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.normalized.change).toBe('my-feature');
      expect(result.normalized.odoo_version).toBe(18);
    });

    it('accepts a complete valid record with execution_mode auto', () => {
      const result = validatePreflight({ ...validRecord(), execution_mode: 'auto' });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.normalized.execution_mode).toBe('auto');
    });

    it('canonicalizes the change name while validating its primitive type strictly', () => {
      const result = validatePreflight({ ...validRecord(), change: 'Mixed Feature' });

      expect(result.valid).toBe(true);
      expect(result.normalized.change).toBe('mixed-feature');
      expect(validatePreflight({ ...validRecord(), change: 123 }).valid).toBe(false);
    });

    it('applies the optional validation mode default and generates an ISO timestamp', () => {
      const result = validatePreflight(validRecord());

      expect(result.valid).toBe(true);
      expect(result.normalized.validation_mode).toBe('automated');
      expect(result.normalized.persisted_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it('rejects missing required fields', () => {
      const result = validatePreflight({ change: 'x' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects invalid odoo version', () => {
      const result = validatePreflight({ ...validRecord(), odoo_version: 15 });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('odoo_version'))).toBe(true);
    });

    it('rejects review budget out of range', () => {
      const result = validatePreflight({ ...validRecord(), review_budget_lines: 50 });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('review_budget_lines'))).toBe(true);
    });

    it('rejects coercible values instead of silently normalizing them', () => {
      const result = validatePreflight({ ...validRecord(), tdd_mode: 'true' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('tdd_mode debe ser un valor booleano');
    });

    it.each([
      ['execution_mode', 'Interactive'],
      ['review_budget_lines', '400'],
      ['odoo_version', '18'],
    ])('rejects non-exact values for %s', (field, value) => {
      const result = validatePreflight({ ...validRecord(), [field]: value });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.startsWith(`${field} `))).toBe(true);
    });

    it('rejects unknown fields and non-object records', () => {
      const withUnknownField = validatePreflight({ ...validRecord(), unexpected: true });
      const nonObject = validatePreflight([]);

      expect(withUnknownField.valid).toBe(false);
      expect(withUnknownField.errors).toContain('Campo desconocido: unexpected');
      expect(nonObject.valid).toBe(false);
      expect(nonObject.errors).toContain('El preflight debe ser un objeto');
    });

    it.each(['yesterday', '2026-02-31T00:00:00Z'])('rejects malformed supplied persisted_at value %s', (persistedAt) => {
      const result = validatePreflight({ ...validRecord(), persisted_at: persistedAt });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('persisted_at debe ser una fecha ISO8601 válida');
    });
  });

  describe('inferDefaults', () => {
    it('provides defaults for a change name', () => {
      const defaults = inferDefaults('My Feature');
      expect(defaults.change).toBe('my-feature');
      expect(defaults.execution_mode).toBe('interactive');
      expect([16, 17, 18, 19]).toContain(defaults.odoo_version);
    });

    it('uses declared defaults when project configuration is absent', () => {
      const defaults = inferDefaults('x');
      const missing = getMissingFields(defaults);

      expect(defaults.artifact_store).toBe('openspec');
      expect(defaults.validation_mode).toBe('automated');
      expect(missing).toEqual([]);
    });

    it('merges project config values', () => {
      const defaults = inferDefaults('x', { odoo_version: 17, artifact_store: 'hybrid', tdd_mode: true, validation_mode: 'manual-acceptance' });
      expect(defaults.odoo_version).toBe(17);
      expect(defaults.artifact_store).toBe('hybrid');
      expect(defaults.tdd_mode).toBe(true);
      expect(defaults.validation_mode).toBe('manual-acceptance');
    });

    it('uses valid registry budget flags and ignores invalid configured budgets', () => {
      expect(inferDefaults('x', null, { pr_size_budget: 900 }).review_budget_lines).toBe(900);
      expect(inferDefaults('x', { review_budget_lines: 50 }, { pr_size_budget: 900 }).review_budget_lines).toBe(900);
      expect(inferDefaults('x', { review_budget_lines: 1200 }, { pr_size_budget: 900 }).review_budget_lines).toBe(1200);
    });
  });

  describe('getMissingFields', () => {
    it('lists empty required fields', () => {
      const missing = getMissingFields({ change: 'x' });
      expect(missing).toContain('execution_mode');
      expect(missing).toContain('odoo_version');
    });
  });

  describe('renderPreflightPrompt', () => {
    it('renders Spanish prompt with missing fields', () => {
      const prompt = renderPreflightPrompt({}, ['odoo_version', 'execution_mode']);
      expect(prompt).toContain('Preflight ODF');
      expect(prompt).toContain('Versión de Odoo');
      expect(prompt).toContain('¿Querés ajustar algo o continuamos?');
    });
  });

  describe('savePreflight / loadPreflight', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odf-preflight-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('round-trips a preflight record', () => {
      const record = validatePreflight(validRecord()).normalized;
      const statePath = savePreflight('my-feature', record, tmpDir);
      expect(fs.existsSync(statePath)).toBe(true);

      const loaded = loadPreflight('my-feature', tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.change).toBe('my-feature');
      expect(loaded?.odoo_version).toBe(18);
    });

    it('computes deterministic state path', () => {
      expect(getStatePath('my-feature', tmpDir)).toBe(
        path.join(tmpDir, 'openspec', 'changes', 'my-feature', 'state.yaml')
      );
    });
  });
});

function validRecord() {
  return {
    change: 'my-feature',
    execution_mode: 'interactive',
    artifact_store: 'openspec',
    delivery_strategy: 'ask-on-risk',
    review_budget_lines: 400,
    odoo_version: 18,
    tdd_mode: false,
    solution_strategy: 'custom',
    chain_strategy: 'feature-branch',
  };
}
