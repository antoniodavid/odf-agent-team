import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getStatePath, validatePreflight } from './preflight.js';

/**
 * ODF Orchestrator state-machine helpers.
 *
 * Pure functions used by the orchestrator agent markdown and by the test suite
 * to determine the next phase, resume active changes, and render status.
 */

export const PHASE_ORDER = ['init', 'preflight', 'assess', 'qa-plan', 'design', 'implement', 'verify', 'archived'];

export const ARTIFACT_FIELDS = {
  assess: 'assess',
  qa_plan: 'qa-plan',
  design: 'design',
  implement: 'implement',
  qa_review: 'qa-review',
  qa_aggregate: 'qa-aggregate',
  verify: 'verify',
};

/**
 * Return true if the state has a complete and valid preflight record.
 */
export function isPreflightComplete(state) {
  const preflight = state?.preflight;
  if (!preflight) return false;
  const result = validatePreflight(preflight);
  return result.valid;
}

/**
 * Determine the next pending phase from a state object.
 */
export function getNextPhase(state) {
  if (!isPreflightComplete(state)) return 'preflight';

  const artifacts = state?.artifacts || {};
  if (!artifacts.assess) return 'assess';
  if (state?.preflight?.solution_strategy === 'custom' && artifacts.assess && !artifacts.design) {
    // QA-PLAN is optional between assess and design; treat its absence as skippable.
    if (artifacts.qa_plan === false) return 'qa-plan';
  }
  if (!artifacts.design) return 'design';
  if (!artifacts.implement) return 'implement';
  if (!artifacts.verify) return 'verify';
  return 'archived';
}

/**
 * Return true if the change has any completed artifact (i.e., is active).
 */
export function isActive(state) {
  if (!state) return false;
  if (state.phase === 'archived') return false;
  const artifacts = state.artifacts || {};
  return Object.values(artifacts).some(Boolean);
}

/**
 * Load all active changes from OpenSpec under a base directory.
 */
export function loadActiveChanges(baseDir = process.cwd()) {
  const changesDir = path.join(baseDir, 'openspec', 'changes');
  if (!fs.existsSync(changesDir)) return [];

  const active = [];
  for (const entry of fs.readdirSync(changesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statePath = path.join(changesDir, entry.name, 'state.yaml');
    if (!fs.existsSync(statePath)) continue;
    try {
      const state = YAML.parse(fs.readFileSync(statePath, 'utf8')) || {};
      if (isActive(state)) {
        active.push({ change: entry.name, state, last_updated: state.last_updated || state.timestamps?.started_at });
      }
    } catch {
      // skip malformed state files
    }
  }

  return active.sort((a, b) => {
    const ta = a.last_updated ? new Date(a.last_updated).getTime() : 0;
    const tb = b.last_updated ? new Date(b.last_updated).getTime() : 0;
    return tb - ta;
  });
}

/**
 * Select the change to resume.
 *
 * Returns:
 *   { change: string, state: object } when unambiguous
 *   { ambiguous: true, candidates: string[] } when a name is needed
 */
export function selectActiveChange(states, name = null) {
  if (name) {
    const found = states.find((s) => s.change === name);
    if (!found) return { error: `No se encontró un cambio activo llamado "${name}".` };
    return { change: found.change, state: found.state };
  }

  if (states.length === 0) {
    return { error: 'No hay cambios activos. Empezá con /odf-new <nombre>.' };
  }

  const sorted = [...states].sort((a, b) => {
    const ta = a.last_updated ? new Date(a.last_updated).getTime() : a.state?.last_updated ? new Date(a.state.last_updated).getTime() : 0;
    const tb = b.last_updated ? new Date(b.last_updated).getTime() : b.state?.last_updated ? new Date(b.state.last_updated).getTime() : 0;
    return tb - ta;
  });
  return { change: sorted[0].change, state: sorted[0].state };
}

/**
 * Build an updated state object after a phase completes successfully.
 */
export function updateStateAfterPhase(state, phase, result = {}) {
  const next = structuredClone(state);
  next.phase = phase;
  next.last_updated = new Date().toISOString();

  const artifactKey = Object.keys(ARTIFACT_FIELDS).find((k) => ARTIFACT_FIELDS[k] === phase);
  if (artifactKey) {
    next.artifacts = next.artifacts || {};
    next.artifacts[artifactKey] = true;
  }

  if (next.timestamps) {
    next.timestamps[`${phase}_completed`] = new Date().toISOString();
  }

  if (result.strategy) {
    next.strategy = result.strategy;
    if (next.preflight) next.preflight.solution_strategy = result.strategy;
  }

  if (result.modules_affected) {
    next.modules = (result.modules_affected || []).map((name) => ({ name, status: 'done' }));
  }

  return next;
}

/**
 * Render a short status table in Spanish.
 */
export function renderStatusTable(states) {
  if (states.length === 0) {
    return 'No hay cambios ODF activos. Usá /odf-new para empezar.';
  }

  const lines = [
    '| Cambio | Fase | Siguiente | Versión | Estrategia |',
    '|--------|------|-----------|---------|------------|',
  ];

  for (const { change, state } of states) {
    const next = getNextPhase(state);
    const version = state.preflight?.odoo_version ?? state.odoo_version ?? '—';
    const strategy = state.preflight?.solution_strategy ?? state.strategy ?? 'pending';
    lines.push(`| ${change} | ${state.phase || 'init'} | ${next} | ${version} | ${strategy} |`);
  }

  return lines.join('\n');
}

/**
 * Render detail for a single active change in Spanish.
 */
export function renderStatusDetail(change, state) {
  const next = getNextPhase(state);
  const version = state.preflight?.odoo_version ?? state.odoo_version ?? '—';
  const strategy = state.preflight?.solution_strategy ?? state.strategy ?? 'pending';
  const lines = [
    `## Estado ODF: ${change}`,
    '',
    `- **Cambio**: ${change}`,
    `- **Versión Odoo**: ${version}`,
    `- **Estrategia**: ${strategy}`,
    `- **Fase actual**: ${state.phase || 'init'}`,
    `- **Siguiente fase**: ${next}`,
    `- **Última actualización**: ${state.last_updated || '—'}`,
    '',
    '**Artefactos**:',
  ];

  const artifacts = state.artifacts || {};
  for (const [key, label] of Object.entries(ARTIFACT_FIELDS)) {
    lines.push(`- [${artifacts[key] ? 'x' : ' '}] ${label}`);
  }

  lines.push('');
  if (next !== 'archived') {
    lines.push(`Continuar: /odf-continue ${change}`);
  }
  return lines.join('\n');
}
