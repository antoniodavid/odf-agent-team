import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/**
 * ODF Preflight Gate — deterministic validation and persistence of ODF choices.
 *
 * The orchestrator agent calls these helpers to collect, validate, and store
 * the preflight record before delegating any workflow phase.
 */

export const PREFLIGHT_VERSION = '1.0.0';

export const PREFLIGHT_FIELDS = {
  change: {
    type: 'string',
    required: true,
    question: 'Nombre del cambio (kebab-case):',
    validate: (v) => /^[a-z0-9_-]+$/.test(String(v)),
  },
  execution_mode: {
    type: 'enum',
    values: ['interactive', 'batch'],
    default: 'interactive',
    question: 'Modo de ejecución (interactive | batch):',
  },
  artifact_store: {
    type: 'enum',
    values: ['openspec', 'engram', 'hybrid'],
    default: 'openspec',
    question: 'Almacén de artefactos (openspec | engram | hybrid):',
  },
  delivery_strategy: {
    type: 'enum',
    values: ['ask-always', 'ask-on-risk', 'auto-chain', 'single-pr'],
    default: 'ask-on-risk',
    question: 'Estrategia de entrega (ask-always | ask-on-risk | auto-chain | single-pr):',
  },
  review_budget_lines: {
    type: 'integer',
    default: 400,
    min: 100,
    max: 5000,
    question: 'Presupuesto de líneas por revisión (100-5000):',
  },
  odoo_version: {
    type: 'enum',
    values: [16, 17, 18, 19],
    default: 18,
    question: 'Versión de Odoo (16 | 17 | 18 | 19):',
  },
  tdd_mode: {
    type: 'boolean',
    default: false,
    question: '¿Activar modo TDD estricto? (true | false):',
  },
  solution_strategy: {
    type: 'enum',
    values: ['standard', 'custom', 'pending'],
    default: 'pending',
    question: 'Estrategia de solución (standard | custom | pending):',
  },
  chain_strategy: {
    type: 'enum',
    values: ['none', 'chained', 'feature-branch'],
    default: 'none',
    question: 'Estrategia de encadenamiento de PRs (none | chained | feature-branch):',
  },
  persisted_at: {
    type: 'string',
    required: false,
    question: null,
  },
};

export const REQUIRED_FIELDS = Object.entries(PREFLIGHT_FIELDS)
  .filter(([, meta]) => meta.required !== false)
  .map(([key]) => key);

/**
 * Sanitize a raw change name into kebab-case allowing underscores.
 */
export function sanitizeChangeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Try to detect Odoo major version from a __manifest__.py in the current directory.
 */
export function detectOdooVersionFromManifest(cwd = process.cwd()) {
  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(cwd, entry.name, '__manifest__.py');
      if (!fs.existsSync(manifestPath)) continue;
      const content = fs.readFileSync(manifestPath, 'utf8');
      const match = content.match(/['"]version['"]\s*:\s*['"](\d+)\.0\.\d+\.\d+\.0['"]/);
      if (match) {
        const major = parseInt(match[1], 10);
        if ([16, 17, 18, 19].includes(major)) return major;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Build a default preflight record, optionally merging project context.
 */
export function inferDefaults(changeName, projectConfig = null) {
  const detectedVersion = detectOdooVersionFromManifest();
  const record = {
    change: sanitizeChangeName(changeName),
    execution_mode: 'interactive',
    artifact_store: 'openspec',
    delivery_strategy: 'ask-on-risk',
    review_budget_lines: 400,
    odoo_version: detectedVersion ?? 18,
    tdd_mode: false,
    solution_strategy: 'pending',
    chain_strategy: 'none',
  };

  if (projectConfig) {
    if (projectConfig.odoo_version && [16, 17, 18, 19].includes(Number(projectConfig.odoo_version))) {
      record.odoo_version = Number(projectConfig.odoo_version);
    }
    if (['openspec', 'engram', 'hybrid'].includes(projectConfig.artifact_store)) {
      record.artifact_store = projectConfig.artifact_store;
    }
    if (typeof projectConfig.tdd_mode === 'boolean') {
      record.tdd_mode = projectConfig.tdd_mode;
    }
  }

  return record;
}

/**
 * Validate a preflight record and return normalized values plus error list.
 */
export function validatePreflight(record) {
  const normalized = {};
  const errors = [];

  for (const [field, meta] of Object.entries(PREFLIGHT_FIELDS)) {
    let value = record?.[field];

    if (value === undefined || value === null || value === '') {
      if (meta.required === false) {
        continue;
      }
      errors.push(`Falta el campo requerido: ${field}`);
      continue;
    }

    if (field === 'change') {
      value = sanitizeChangeName(value);
    }

    if (meta.type === 'enum') {
      const candidate = String(value).toLowerCase();
      const match = meta.values.find((v) => String(v).toLowerCase() === candidate);
      if (match === undefined) {
        errors.push(`${field} debe ser uno de: ${meta.values.join(', ')}`);
        continue;
      }
      value = match;
    }

    if (meta.type === 'integer') {
      const num = Number(value);
      if (!Number.isInteger(num)) {
        errors.push(`${field} debe ser un número entero`);
        continue;
      }
      if (meta.min !== undefined && num < meta.min) {
        errors.push(`${field} debe ser >= ${meta.min}`);
        continue;
      }
      if (meta.max !== undefined && num > meta.max) {
        errors.push(`${field} debe ser <= ${meta.max}`);
        continue;
      }
      value = num;
    }

    if (meta.type === 'boolean') {
      if (typeof value === 'string') {
        value = value.toLowerCase() === 'true';
      } else {
        value = Boolean(value);
      }
    }

    if (meta.validate && !meta.validate(value)) {
      errors.push(`${field} tiene un valor inválido: ${value}`);
      continue;
    }

    normalized[field] = value;
  }

  normalized.persisted_at = new Date().toISOString();

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  };
}

/**
 * Return a list of field names that are missing or invalid.
 */
export function getMissingFields(record) {
  const { errors } = validatePreflight(record);
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    const value = record?.[field];
    if (value === undefined || value === null || value === '') {
      missing.push(field);
    }
  }
  // Also include fields that failed validation but were present.
  for (const err of errors) {
    const field = err.split(' ')[0];
    if (!missing.includes(field)) missing.push(field);
  }
  return missing;
}

/**
 * Render a Spanish interactive prompt for the missing fields.
 */
export function renderPreflightPrompt(record, missingFields) {
  const lines = [
    '## Preflight ODF',
    '',
    'Antes de delegar cualquier fase, necesito completar la siguiente configuración.',
    '',
  ];

  for (const field of missingFields) {
    const meta = PREFLIGHT_FIELDS[field];
    if (!meta || !meta.question) continue;
    const current = record?.[field];
    const hint = current !== undefined && current !== '' ? ` (actual: ${current})` : ` (default: ${meta.default ?? '—'})`;
    lines.push(`- ${meta.question}${hint}`);
  }

  lines.push('');
  lines.push('¿Querés ajustar algo o continuamos? Respondé campo por campo o confirmá para seguir.');
  return lines.join('\n');
}

/**
 * Build the OpenSpec state path for a change.
 */
export function getStatePath(changeName, baseDir = process.cwd()) {
  return path.join(baseDir, 'openspec', 'changes', sanitizeChangeName(changeName), 'state.yaml');
}

/**
 * Load the preflight record from OpenSpec state.yaml.
 */
export function loadPreflight(changeName, baseDir) {
  const statePath = getStatePath(changeName, baseDir);
  if (!fs.existsSync(statePath)) return null;
  try {
    const parsed = YAML.parse(fs.readFileSync(statePath, 'utf8')) || {};
    return parsed.preflight || null;
  } catch {
    return null;
  }
}

/**
 * Save the preflight record into OpenSpec state.yaml, merging with existing state.
 */
export function savePreflight(changeName, record, baseDir = process.cwd()) {
  const statePath = getStatePath(changeName, baseDir);
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let state = {};
  if (fs.existsSync(statePath)) {
    try {
      state = YAML.parse(fs.readFileSync(statePath, 'utf8')) || {};
    } catch {
      state = {};
    }
  }

  state.change = sanitizeChangeName(changeName);
  state.preflight = record;
  state.last_updated = new Date().toISOString();

  fs.writeFileSync(statePath, YAML.stringify(state, { sortMapEntries: false }), 'utf8');
  return statePath;
}

/**
 * Render a Spanish summary of the preflight record for user confirmation.
 */
export function renderPreflightSummary(record) {
  const lines = [
    '## Resumen del Preflight ODF',
    '',
  ];
  for (const [field, meta] of Object.entries(PREFLIGHT_FIELDS)) {
    if (field === 'persisted_at') continue;
    const value = record[field];
    if (value === undefined) continue;
    lines.push(`- **${field}**: ${value}`);
  }
  lines.push('');
  lines.push('¿Editás alguna respuesta antes de continuar? (sí / no)');
  return lines.join('\n');
}
