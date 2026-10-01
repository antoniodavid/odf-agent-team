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

function isValidIso8601Timestamp(value) {
  if (typeof value !== 'string') return false;
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!parts) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 23 && offsetMinute <= 59
    && Number.isFinite(Date.parse(value));
}

export const PREFLIGHT_FIELDS = {
  change: {
    type: 'string',
    required: true,
    question: 'Nombre del cambio (kebab-case):',
    validate: (v) => /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(v),
  },
  execution_mode: {
    type: 'enum',
    values: ['interactive', 'batch', 'auto'],
    default: 'interactive',
    question: 'Modo de ejecución (interactive | batch | auto):',
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
  validation_mode: {
    type: 'enum',
    values: ['automated', 'manual-acceptance'],
    default: 'automated',
    required: false,
    question: 'Modo de validación (automated | manual-acceptance):',
  },
  persisted_at: {
    type: 'string',
    required: false,
    question: null,
    validate: isValidIso8601Timestamp,
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
export function inferDefaults(changeName, projectConfig = null, registryFlags = null) {
  const detectedVersion = detectOdooVersionFromManifest();
  const record = { change: sanitizeChangeName(changeName) };
  for (const [field, meta] of Object.entries(PREFLIGHT_FIELDS)) {
    if (meta.default !== undefined) record[field] = meta.default;
  }

  record.odoo_version = detectedVersion ?? PREFLIGHT_FIELDS.odoo_version.default;

  const registryBudget = registryFlags?.pr_size_budget;
  if (Number.isInteger(registryBudget)
    && registryBudget >= PREFLIGHT_FIELDS.review_budget_lines.min
    && registryBudget <= PREFLIGHT_FIELDS.review_budget_lines.max) {
    record.review_budget_lines = registryBudget;
  }

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
    if (PREFLIGHT_FIELDS.validation_mode.values.includes(projectConfig.validation_mode)) {
      record.validation_mode = projectConfig.validation_mode;
    }
    const configuredBudget = projectConfig.review_budget_lines ?? projectConfig.pr_size_budget;
    if (Number.isInteger(configuredBudget)
      && configuredBudget >= PREFLIGHT_FIELDS.review_budget_lines.min
      && configuredBudget <= PREFLIGHT_FIELDS.review_budget_lines.max) {
      record.review_budget_lines = configuredBudget;
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

  if (!record || typeof record !== 'object' || Array.isArray(record)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(record))) {
    return {
      valid: false,
      errors: ['El preflight debe ser un objeto'],
      normalized: { persisted_at: new Date().toISOString() },
    };
  }

  for (const field of Object.keys(record)) {
    if (!Object.hasOwn(PREFLIGHT_FIELDS, field)) {
      errors.push(`Campo desconocido: ${field}`);
    }
  }

  for (const [field, meta] of Object.entries(PREFLIGHT_FIELDS)) {
    let value = record?.[field];

    if (value === undefined || value === null || value === '') {
      if (meta.required === false) {
        if (meta.default !== undefined) normalized[field] = meta.default;
        continue;
      }
      errors.push(`Falta el campo requerido: ${field}`);
      continue;
    }

    if (meta.type === 'enum') {
      if (!meta.values.includes(value)) {
        errors.push(`${field} debe ser uno de: ${meta.values.join(', ')}`);
        continue;
      }
    }

    if (meta.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${field} debe ser un número entero`);
        continue;
      }
      if (meta.min !== undefined && value < meta.min) {
        errors.push(`${field} debe ser >= ${meta.min}`);
        continue;
      }
      if (meta.max !== undefined && value > meta.max) {
        errors.push(`${field} debe ser <= ${meta.max}`);
        continue;
      }
    }

    if (meta.type === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push(`${field} debe ser un valor booleano`);
        continue;
      }
    }

    if (meta.type === 'string' && typeof value !== 'string') {
      errors.push(`${field} debe ser texto`);
      continue;
    }

    if (field === 'change') value = sanitizeChangeName(value);

    if (meta.validate && !meta.validate(value)) {
      errors.push(field === 'persisted_at'
        ? 'persisted_at debe ser una fecha ISO8601 válida'
        : `${field} tiene un valor inválido: ${value}`);
      continue;
    }

    normalized[field] = value;
  }

  if (!normalized.persisted_at) normalized.persisted_at = new Date().toISOString();

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
    const field = Object.keys(PREFLIGHT_FIELDS).find((name) =>
      err === `Falta el campo requerido: ${name}` || err.startsWith(`${name} `)
    );
    if (field && !missing.includes(field)) missing.push(field);
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
