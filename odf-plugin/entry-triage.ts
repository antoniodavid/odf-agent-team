/**
 * entry-triage
 * Deterministic ODF change-entry classification (micro / standard / full).
 *
 * Pure module: no disk, registry, or environment access. Maps an entry to an
 * existing canonical work type from ./odf-workflow.js; never invents work types.
 *
 * ICE-aware (Intent, Context, Expectations): vague entries ask a grouped
 * question instead of silently burning a full pipeline, and the decision
 * carries signals + clarity for auditability.
 */

import { WORK_TYPES, type WorkType } from "./odf-workflow.js"

export type EntryLevel = "micro" | "standard" | "full"
export type EntryClarity = "clear" | "unclear"

export interface EntryTriageInput {
  command?: string
  change: string
  description: string
  explicit_work_type?: WorkType
  module?: string
  domain?: string
  expected_files?: number
  expectations_clear?: boolean
  risk_signals?: string[]
  /** Project module names from odf-init/{project}; used to flag unknown modules. */
  known_modules?: string[]
}

export interface EntryTriageResult {
  level: EntryLevel
  work_type: WorkType
  reason: string
  needs_question: boolean
  question?: string
  /** Detected risk signals (audit trail). */
  signals: string[]
  /** Intent clarity of the description. */
  clarity: EntryClarity
  warnings?: string[]
}

export type RiskSignal = "security" | "migration" | "payment" | "public-api" | "data-loss" | "pii"

const RISK_SIGNAL_PATTERNS: Array<{ signal: RiskSignal; pattern: RegExp }> = [
  { signal: "security", pattern: /\b(security|acl|access rights?|ir\.model\.access|roles|permissions)\b|groups\s*=/i },
  { signal: "migration", pattern: /\b(migrations?|migrating|upgrade|downgrade)\b/i },
  { signal: "payment", pattern: /\b(payment|money|billing|stripe|paypal|checkout|charge)\b/i },
  { signal: "public-api", pattern: /\b(public\s+api|external\s+api|api\s+endpoint|webhook|rest\s+api|json-?rpc)\b/i },
  { signal: "data-loss", pattern: /\b(unlink|purge|irreversible|wipe|data\s+loss)\b|\bdelete\s+(?:records?|data|rows?|partners?)/i },
  { signal: "pii", pattern: /\b(pii|personal\s+data|privacy|gdpr|curp|nss)\b/i },
]

/** Conservative context signals from the affected module/domain names. */
const CONTEXT_SIGNAL_PATTERNS: Array<{ signal: RiskSignal; pattern: RegExp }> = [
  { signal: "security", pattern: /\b(security|access)\b/i },
  { signal: "payment", pattern: /\b(payment|money|billing|pos)\b/i },
  { signal: "migration", pattern: /\b(migration|upgrade)\b/i },
]

const STANDARD_CONFIG_PATTERN = /\b(standard\s*config(?:uration)?|configuration|configure|setup|enable|activate|instal(?:l|laci[oó]n))\b/i

const ACTION_VERBS = /\b(add|implement|fix|create|extend|show|display|allow|remove|change|update|import|export|configure|enable|disable|validate|compute|route|track|split|merge|filter|search|sort|print|send|approve|cancel|confirm)\b/i
const OBJECT_NOUNS = /\b(field|model|view|button|report|screen|form|wizard|module|setting|rule|constraint|domain|method|function|service|endpoint|flow|process|list|tree|kanban|widget|component|template|asset|test|data|record|partner|product|order|invoice|picking|lot|serial|stock|sale|purchase|account|payment|tax|barcode|scanner)\b/i

export function detectRiskSignals(description: string): string[] {
  return RISK_SIGNAL_PATTERNS
    .filter(entry => entry.pattern.test(description))
    .map(entry => entry.signal)
}

/** Risk signals derived from the affected module/domain names (conservative). */
export function contextRiskSignals(module?: string, domain?: string): string[] {
  const haystack = `${module || ""} ${domain || ""}`.replace(/_/g, " ").trim()
  if (!haystack) return []
  return CONTEXT_SIGNAL_PATTERNS
    .filter(entry => entry.pattern.test(haystack))
    .map(entry => entry.signal)
}

/** ICE: is the description concrete enough to act on without a question? */
export function descriptionClarity(description: string): EntryClarity {
  const words = (description || "").split(/\s+/).filter(w => w.length >= 3)
  if (words.length < 4) return "unclear"
  return ACTION_VERBS.test(description) || OBJECT_NOUNS.test(description) ? "clear" : "unclear"
}

function normalizeRiskSignals(riskSignals: string[] | undefined): string[] {
  if (!Array.isArray(riskSignals)) return []
  return RISK_SIGNAL_PATTERNS
    .map(entry => entry.signal)
    .filter(signal => riskSignals.includes(signal))
}

function explicitLevel(workType: WorkType): EntryLevel {
  switch (workType) {
    case "bugfix":
    case "small-change":
    case "standard-config":
      return "micro"
    case "feature":
      return "standard"
    case "cross-domain":
    case "migration":
    case "security":
      return "full"
    default:
      return "standard"
  }
}

function signalToWorkType(signal: string): WorkType {
  if (signal === "security") return "security"
  if (signal === "migration") return "migration"
  return "feature"
}

function missingFacts(input: EntryTriageInput): string[] {
  const facts: string[] = []
  if (!input.module || !input.domain) facts.push("affected module and functional domain")
  if (input.expected_files === undefined) facts.push("expected file count (<=3 for a micro change)")
  if (input.expectations_clear === undefined) facts.push("whether expectations are clear")
  return facts
}

function unknownModuleWarnings(input: EntryTriageInput): string[] {
  const warnings: string[] = []
  if (input.module && Array.isArray(input.known_modules) && input.known_modules.length > 0
    && !input.known_modules.includes(input.module)) {
    warnings.push(`module '${input.module}' is not present in the project sources (odf-init/{project}); verify the module name.`)
  }
  return warnings
}

function iceQuestion(input: EntryTriageInput, missing: string[], unclear: boolean): string {
  const parts: string[] = []
  if (missing.length > 0) parts.push(`Datos: ${missing.join("; ")}`)
  if (unclear) {
    parts.push("Intent y contexto: ¿qué resultado esperás, qué comportamiento actual se ve afectado, y cómo se verificará (Expectations)?")
  }
  return parts.length > 0
    ? `Para clasificar este cambio necesito: ${parts.join("; ")}. Responde brevemente cada punto.`
    : "Para clasificar este cambio, describe el resultado esperado, el comportamiento actual afectado y cómo se verifica."
}

export function classifyEntryTriage(input: EntryTriageInput): EntryTriageResult {
  const signals = [...new Set([
    ...normalizeRiskSignals(input.risk_signals),
    ...detectRiskSignals(input.description || ""),
    ...contextRiskSignals(input.module, input.domain),
  ])]
  const clarity = descriptionClarity(input.description || "")
  const warnings = unknownModuleWarnings(input)

  const explicit = input.explicit_work_type
  if (explicit && WORK_TYPES.includes(explicit)) {
    const level = explicitLevel(explicit)
    if (level === "micro" && signals.length > 0) {
      return {
        level: "full",
        work_type: signalToWorkType(signals[0]),
        reason: `Explicit work type ${explicit} would be micro but risk signal(s) (${signals.join(", ")}) force the full pipeline.`,
        needs_question: false,
        signals,
        clarity,
        ...(warnings.length ? { warnings } : {}),
      }
    }
    return {
      level,
      work_type: explicit,
      reason: "Explicit work type honored.",
      needs_question: false,
      signals,
      clarity,
      ...(warnings.length ? { warnings } : {}),
    }
  }

  if (signals.length > 0) {
    return {
      level: "full",
      work_type: signalToWorkType(signals[0]),
      reason: `Risk signal(s) detected: ${signals.join(", ")}. Full pipeline required; never micro.`,
      needs_question: false,
      signals,
      clarity,
      ...(warnings.length ? { warnings } : {}),
    }
  }

  if (input.command === "odf-fix") {
    return {
      level: "micro",
      work_type: "bugfix",
      reason: "Origin is /odf-fix, a lightweight diagnose -> fix -> verify flow.",
      needs_question: false,
      signals,
      clarity,
      ...(warnings.length ? { warnings } : {}),
    }
  }

  // G2: a clear standard-config wording is a cheap DECIDE-only route even
  // without micro facts; the config wording is itself the clarity signal.
  if (STANDARD_CONFIG_PATTERN.test(input.description || "")) {
    return {
      level: "micro",
      work_type: "standard-config",
      reason: "Standard-config wording detected; DECIDE-only route, no build or verify required.",
      needs_question: false,
      signals,
      clarity: "clear",
      ...(warnings.length ? { warnings } : {}),
    }
  }

  if (
    input.module &&
    input.domain &&
    input.expected_files !== undefined &&
    input.expected_files <= 3 &&
    input.expectations_clear === true
  ) {
    return {
      level: "micro",
      work_type: "small-change",
      reason: "Single module, single domain, <=3 files, and clear expectations.",
      needs_question: false,
      signals,
      clarity,
      ...(warnings.length ? { warnings } : {}),
    }
  }

  const missing = missingFacts(input)
  const unclear = clarity === "unclear"
  if (missing.length > 0 || unclear) {
    return {
      level: "standard",
      work_type: "feature",
      reason: unclear
        ? "Intent/context is not concrete enough to classify safely."
        : "Insufficient facts to classify as a micro change.",
      needs_question: true,
      question: iceQuestion(input, missing, unclear),
      signals,
      clarity,
      ...(warnings.length ? { warnings } : {}),
    }
  }

  return {
    level: "standard",
    work_type: "feature",
    reason: "No risk signals and the change does not qualify as micro; classified as a standard feature.",
    needs_question: false,
    signals,
    clarity,
    ...(warnings.length ? { warnings } : {}),
  }
}
