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

import { resolveWorkflowRoute, WORK_TYPES, type CanonicalStage, type WorkType } from "./odf-workflow.js"
import { tool } from "@opencode-ai/plugin"

export type EntryLevel = "micro" | "standard" | "full"
export type EntryClarity = "clear" | "unclear"

export const ICE_CONTEXT_SOURCES = [
  "project",
  "project-scan",
  "odf-init",
  "codegraph",
  "odoo-source",
  "tests",
  "conventions",
  "prior-learning",
] as const

export type ICEContextSource = (typeof ICE_CONTEXT_SOURCES)[number]

export interface ICEContextReference {
  source: ICEContextSource
  reference: string
}

export interface ICEContextMetadata {
  module?: string
  domain?: string
  expected_files?: number
  risk_signals?: string[]
  known_modules?: string[]
  /** Reference-only intent metadata; the user description remains authoritative. */
  intent?: { reference: string }
  /** Reference-only Expectations metadata; content remains in the canonical artifact. */
  expectations?: { approved: boolean; reference: string }
}

/**
 * Bounded, reference-only ICE context. It is constructed once at entry and is
 * never persisted or treated as a replacement for user intent/Expectations.
 */
export interface ICEContextEnvelope {
  version?: 1
  provenance: ICEContextReference
  references?: ICEContextReference[]
  metadata?: ICEContextMetadata
}

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
  /** Optional reference-only context assembled from existing project facts. */
  ice_context?: ICEContextEnvelope
  /** Optional explicit facts used only by the advisory shadow prediction. */
  shadow_context?: EntryTriageShadowContext
}

export interface EntryTriageShadowContext {
  expectations_approved?: boolean
  diagnosis_evidence?: boolean
  root_cause_evidence?: boolean
  regression_evidence?: boolean
  architecture_signals?: string[]
  scope_signals?: string[]
  prior_learning_contradiction?: boolean
  prior_learning?: "consistent" | "contradictory" | "unknown"
  blast_radius?: "low" | "medium" | "high" | "unknown" | number
  reversibility?: "high" | "medium" | "low" | "unknown"
  source_authority?: "complete" | "incomplete" | "unknown"
  protected_signals?: string[]
  protected_domains?: string[]
}

export type ShadowMicroPolicy = "eligible" | "ineligible" | "unknown" | "not-applicable"

export interface EntryRouteShadow {
  version: 1
  mode: "shadow"
  advisory: true
  execution_unchanged: true
  predicted_route: WorkType
  predicted_stages: CanonicalStage[]
  micro_policy: ShadowMicroPolicy
  required_checks: string[]
  missing_facts: string[]
  blocking_reasons: string[]
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
  shadow: EntryRouteShadow
}

type EntryTriageClassification = Omit<EntryTriageResult, "shadow">
type EntryTriageToolInput = Omit<EntryTriageInput, "change" | "ice_context"> & {
  change?: string
  ice_context?: Omit<ICEContextEnvelope, "version"> & { version?: number }
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

const MAX_ICE_CONTEXT_REFERENCES = 8
const MAX_ICE_CONTEXT_REFERENCE_LENGTH = 256
const MAX_ICE_CONTEXT_TOKEN_LENGTH = 96
const MAX_ICE_CONTEXT_MODULES = 128
const MAX_ICE_CONTEXT_RISK_SIGNALS = 6
const MAX_ICE_CONTEXT_FILES = 1000

const ACTION_VERBS = /\b(add|implement|fix|create|extend|show|display|allow|remove|change|update|import|export|configure|enable|disable|validate|compute|route|track|split|merge|filter|search|sort|print|send|approve|cancel|confirm)\b/i
const OBJECT_NOUNS = /\b(field|model|view|button|report|screen|form|wizard|module|setting|rule|constraint|domain|method|function|service|endpoint|flow|process|list|tree|kanban|widget|component|template|asset|test|data|record|partner|product|order|invoice|picking|lot|serial|stock|sale|purchase|account|payment|tax|barcode|scanner)\b/i

const SHADOW_REQUIRED_CHECKS = [
  "approved Expectations",
  "known module",
  "single functional domain",
  "expected files <=3",
  "clear intent",
  "no protected risk or domain",
  "no architecture or scope signal",
  "no contradictory prior learning",
  "low blast radius",
  "high reversibility",
  "complete source authority",
] as const

const SHADOW_CONTEXT_KEYS = [
  "expectations_approved", "diagnosis_evidence", "root_cause_evidence", "regression_evidence",
  "architecture_signals", "scope_signals", "prior_learning_contradiction", "prior_learning",
  "blast_radius", "reversibility", "source_authority", "protected_signals", "protected_domains",
]

const SHADOW_PROTECTED_SIGNALS = new Set([
  "security", "migration", "payment", "public-api", "data-loss", "pii", "schema", "database", "finance", "external-impact",
])

function shadowTokenList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 8 && value.every(token =>
    typeof token === "string" && token.length > 0 && token.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(token)
  )
}

function normalizeShadowContext(raw: unknown): { context: EntryTriageShadowContext; malformed: boolean } {
  if (raw === undefined) return { context: {}, malformed: false }
  if (!isRecord(raw) || !hasOnlyKeys(raw, SHADOW_CONTEXT_KEYS)) return { context: {}, malformed: true }

  const booleanKeys = ["expectations_approved", "diagnosis_evidence", "root_cause_evidence", "regression_evidence", "prior_learning_contradiction"]
  if (booleanKeys.some(key => raw[key] !== undefined && typeof raw[key] !== "boolean")) return { context: {}, malformed: true }
  if (raw.architecture_signals !== undefined && !shadowTokenList(raw.architecture_signals)) return { context: {}, malformed: true }
  if (raw.scope_signals !== undefined && !shadowTokenList(raw.scope_signals)) return { context: {}, malformed: true }
  if (raw.protected_signals !== undefined && !shadowTokenList(raw.protected_signals)) return { context: {}, malformed: true }
  if (raw.protected_domains !== undefined && !shadowTokenList(raw.protected_domains)) return { context: {}, malformed: true }
  if (raw.prior_learning !== undefined && !["consistent", "contradictory", "unknown"].includes(raw.prior_learning as string)) return { context: {}, malformed: true }
  if (raw.reversibility !== undefined && !["high", "medium", "low", "unknown"].includes(raw.reversibility as string)) return { context: {}, malformed: true }
  if (raw.source_authority !== undefined && !["complete", "incomplete", "unknown"].includes(raw.source_authority as string)) return { context: {}, malformed: true }
  if (raw.blast_radius !== undefined && !(
    (typeof raw.blast_radius === "number" && Number.isInteger(raw.blast_radius) && raw.blast_radius >= 0 && raw.blast_radius <= 1_000) ||
    (typeof raw.blast_radius === "string" && ["low", "medium", "high", "unknown"].includes(raw.blast_radius))
  )) return { context: {}, malformed: true }

  return { context: raw as EntryTriageShadowContext, malformed: false }
}

function approvedExpectations(input: EntryTriageInput, context: EntryTriageShadowContext): boolean | undefined {
  if (context.expectations_approved !== undefined) return context.expectations_approved
  const expectations = input.ice_context?.metadata?.expectations
  return expectations?.approved
}

function addUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value)
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key))
}

function safeContextToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ICE_CONTEXT_TOKEN_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

function safeContextReference(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ICE_CONTEXT_REFERENCE_LENGTH &&
    !/[\0\r\n]/.test(value) && !value.startsWith("/") && !value.startsWith("\\") &&
    !value.split(/[\\/]/).includes("..") && /^[A-Za-z0-9][A-Za-z0-9._:/#@-]*$/.test(value)
}

function parseICEContextReference(value: unknown): ICEContextReference | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["source", "reference"])) return null
  const source = value.source
  const reference = value.reference
  if (typeof source !== "string" || !ICE_CONTEXT_SOURCES.includes(source as ICEContextSource) || !safeContextReference(reference)) {
    return null
  }
  return { source: source as ICEContextSource, reference }
}

interface NormalizedICEContext {
  fields: Partial<Pick<EntryTriageInput, "module" | "domain" | "expected_files" | "risk_signals" | "known_modules" | "expectations_clear">>
  warnings: string[]
}

function normalizeICEContext(raw: unknown): NormalizedICEContext {
  if (raw === undefined) return { fields: {}, warnings: [] }

  const invalid = (detail: string): NormalizedICEContext => ({
    fields: {},
    warnings: [`ICE context ignored: ${detail}`],
  })

  if (!isRecord(raw) || !hasOnlyKeys(raw, ["version", "provenance", "references", "metadata"])) {
    return invalid("the envelope is malformed or contains unsupported fields.")
  }
  if (raw.version !== undefined && raw.version !== 1) return invalid("the envelope version is unsupported.")
  if (!parseICEContextReference(raw.provenance)) return invalid("provenance is missing or unsafe.")

  const references = raw.references
  if (references !== undefined) {
    if (!Array.isArray(references) || references.length > MAX_ICE_CONTEXT_REFERENCES ||
      references.some(reference => !parseICEContextReference(reference))) {
      return invalid("one or more references are malformed, unsafe, or exceed the bounds.")
    }
  }

  const metadata = raw.metadata
  if (metadata !== undefined && (!isRecord(metadata) || !hasOnlyKeys(metadata, [
    "module", "domain", "expected_files", "risk_signals", "known_modules", "intent", "expectations",
  ]))) {
    return invalid("metadata is malformed or contains unsupported fields.")
  }
  if (!isRecord(metadata)) {
    return {
      fields: {},
      warnings: ["ICE context contains no classifier metadata; missing facts remain unknown."],
    }
  }

  const moduleName = metadata.module
  const domainName = metadata.domain
  const expectedFiles = metadata.expected_files
  const riskSignals = metadata.risk_signals
  const knownModules = metadata.known_modules
  const intent = metadata.intent
  const expectations = metadata.expectations

  if ((moduleName !== undefined && !safeContextToken(moduleName)) ||
    (domainName !== undefined && !safeContextToken(domainName))) {
    return invalid("module and domain metadata must be bounded tokens.")
  }

  if (expectedFiles !== undefined &&
    (typeof expectedFiles !== "number" || !Number.isInteger(expectedFiles) || expectedFiles < 0 || expectedFiles > MAX_ICE_CONTEXT_FILES)) {
    return invalid("expected_files metadata is outside the safe bounds.")
  }

  if (riskSignals !== undefined &&
    (!Array.isArray(riskSignals) || riskSignals.length > MAX_ICE_CONTEXT_RISK_SIGNALS ||
      riskSignals.some(signal => typeof signal !== "string" || !RISK_SIGNAL_PATTERNS.some(entry => entry.signal === signal)))) {
    return invalid("risk signal metadata is malformed or unsupported.")
  }

  if (knownModules !== undefined &&
    (!Array.isArray(knownModules) || knownModules.length > MAX_ICE_CONTEXT_MODULES ||
      knownModules.some(module => !safeContextToken(module)))) {
    return invalid("known module metadata is malformed or exceeds the bounds.")
  }

  if (intent !== undefined &&
    (!isRecord(intent) || !hasOnlyKeys(intent, ["reference"]) || !safeContextReference(intent.reference))) {
    return invalid("intent metadata must contain a safe reference only.")
  }

  if (expectations !== undefined &&
    (!isRecord(expectations) || !hasOnlyKeys(expectations, ["approved", "reference"]) ||
      typeof expectations.approved !== "boolean" || !safeContextReference(expectations.reference))) {
    return invalid("Expectations metadata must contain an approval flag and safe reference only.")
  }

  const fields: NormalizedICEContext["fields"] = {}
  if (moduleName !== undefined) fields.module = moduleName
  if (domainName !== undefined) fields.domain = domainName
  if (expectedFiles !== undefined) fields.expected_files = expectedFiles
  if (riskSignals !== undefined) fields.risk_signals = riskSignals
  if (knownModules !== undefined) fields.known_modules = knownModules
  if (expectations?.approved === true) fields.expectations_clear = true

  const warnings: string[] = []
  if (Object.keys(fields).length === 0) {
    warnings.push("ICE context contains no usable classifier facts; missing facts remain unknown.")
  }
  if (expectations && expectations.approved !== true) {
    warnings.push("ICE context does not reference approved Expectations; Expectations remain unknown.")
  }
  return { fields, warnings }
}

function normalizeEntryInput(input: EntryTriageInput): { input: EntryTriageInput; warnings: string[] } {
  const context = normalizeICEContext(input.ice_context)
  const normalized: EntryTriageInput = { ...input }
  const warnings = [...context.warnings]

  // Current/user-provided flat values win. Context can only fill omissions;
  // risk signals remain monotonic and may add a safe escalation.
  if (normalized.module === undefined) normalized.module = context.fields.module
  if (normalized.domain === undefined) normalized.domain = context.fields.domain
  if (normalized.expected_files === undefined) normalized.expected_files = context.fields.expected_files
  if (normalized.expectations_clear === undefined) normalized.expectations_clear = context.fields.expectations_clear
  if (normalized.known_modules === undefined) normalized.known_modules = context.fields.known_modules
  if (context.fields.risk_signals) {
    normalized.risk_signals = [...new Set([...(normalized.risk_signals || []), ...context.fields.risk_signals])]
  }
  if (input.ice_context !== undefined && input.expectations_clear === undefined && context.fields.expectations_clear === undefined &&
    !warnings.some(warning => warning.includes("Expectations remain unknown"))) {
    warnings.push("ICE context does not reference approved Expectations; Expectations remain unknown.")
  }

  return { input: normalized, warnings }
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

function classifyEntryTriageBase(input: EntryTriageInput): EntryTriageClassification {
  const normalized = normalizeEntryInput(input)
  input = normalized.input
  const signals = [...new Set([
    ...normalizeRiskSignals(input.risk_signals),
    ...detectRiskSignals(input.description || ""),
    ...contextRiskSignals(input.module, input.domain),
  ])]
  const clarity = descriptionClarity(input.description || "")
  const warnings = [...normalized.warnings, ...unknownModuleWarnings(input)]

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

export function predictEntryRouteShadow(input: EntryTriageInput): EntryRouteShadow {
  const triage = classifyEntryTriage(input, false)
  const route = resolveWorkflowRoute(triage.work_type)
  const normalizedShadow = normalizeShadowContext(input.shadow_context)
  const context = normalizedShadow.context
  const iceMalformed = Boolean(triage.warnings?.some(warning => warning.startsWith("ICE context ignored:")))
  const malformed = normalizedShadow.malformed || iceMalformed
  const missingFacts: string[] = []
  const blockingReasons: string[] = []
  const missing = (fact: string): void => addUnique(missingFacts, fact)
  const block = (reason: string): void => addUnique(blockingReasons, reason)

  if (iceMalformed) block("malformed context")
  if (normalizedShadow.malformed) block("malformed shadow context")
  if (triage.signals.length > 0) block("protected risk signal")

  const requiredChecks: string[] = [...SHADOW_REQUIRED_CHECKS]
  if (triage.work_type === "bugfix") {
    requiredChecks.push("diagnosis evidence", "root-cause evidence", "regression evidence")
  }
  const finish = (micro_policy: ShadowMicroPolicy): EntryRouteShadow => ({
    version: 1,
    mode: "shadow",
    advisory: true,
    execution_unchanged: true,
    predicted_route: route.work_type,
    predicted_stages: [...route.stages],
    micro_policy,
    required_checks: requiredChecks,
    missing_facts: missingFacts,
    blocking_reasons: blockingReasons,
  })

  if (triage.work_type === "standard-config") {
    block("standard-config is a DECIDE-only route")
    return finish("not-applicable")
  }

  if (triage.work_type === "bugfix") {
    if (context.diagnosis_evidence !== true) missing("diagnosis evidence")
    if (context.root_cause_evidence !== true) missing("root-cause evidence")
    if (context.regression_evidence !== true) missing("regression evidence")
    if (missingFacts.length > 0) block("diagnosis, root-cause, and regression evidence are required before predicting a bugfix route")
    else block("FAST is restricted to the existing small-change route")
    return finish(malformed || missingFacts.length > 0 ? "unknown" : "ineligible")
  }

  if (typeof input.expected_files === "number" && input.expected_files > 3) {
    block("blast radius exceeds the <=3 file boundary")
  }
  if (triage.work_type !== "small-change") {
    if (triage.needs_question) missing("complete entry facts")
    block("predicted route is not the existing small-change route")
    return finish(malformed || missingFacts.length > 0 ? "unknown" : "ineligible")
  }

  if (typeof input.module !== "string" || !input.module.trim()) missing("affected module")
  if (typeof input.domain !== "string" || !input.domain.trim()) missing("functional domain")
  if (typeof input.expected_files !== "number" || !Number.isInteger(input.expected_files)) missing("expected file count")
  else if (input.expected_files < 0) missing("valid expected file count")
  if (!Array.isArray(input.known_modules) || input.known_modules.length === 0) missing("known module membership")
  else if (!input.known_modules.includes(input.module || "")) block("unknown module")
  const expectationsApproved = approvedExpectations(input, context)
  if (expectationsApproved !== true) {
    if (expectationsApproved === false) block("approved Expectations are not approved")
    else missing("approved Expectations")
  }
  if (triage.clarity !== "clear") missing("clear intent")

  const rawSignals = (Array.isArray(input.risk_signals) ? input.risk_signals : [])
    .filter((signal): signal is string => typeof signal === "string").map(signal => signal.toLowerCase())
  if (triage.signals.length > 0 || rawSignals.some(signal => SHADOW_PROTECTED_SIGNALS.has(signal))) {
    block("protected risk signal")
  }
  if (context.protected_signals?.length) block("protected risk signal")
  if (context.protected_domains?.length) block("protected domain")
  if ((typeof input.domain === "string" && /[,;|/]\s*\S+/.test(input.domain)) ||
    (typeof input.domain === "string" && /\s+(?:and|&)\s+/i.test(input.domain))) {
    block("multiple functional domains")
  }
  if (context.architecture_signals?.length) block("architecture signal")
  if (context.scope_signals?.length) block("scope signal")
  if (context.prior_learning_contradiction === true || context.prior_learning === "contradictory") {
    block("contradictory prior learning")
  } else if (context.prior_learning !== "consistent") {
    missing("prior learning")
    block("prior learning is missing or uncertain")
  }
  if (context.blast_radius === "high" || context.blast_radius === "medium" ||
    (typeof context.blast_radius === "number" && context.blast_radius > 3)) {
    block("high blast radius")
  } else if (context.blast_radius === undefined || context.blast_radius === "unknown") {
    missing("blast radius")
  }
  if (context.reversibility === "low") block("low reversibility")
  else if (context.reversibility !== "high") missing("high reversibility")
  if (context.source_authority === "incomplete") block("incomplete source authority")
  else if (context.source_authority !== "complete") missing("complete source authority")

  const microPolicy: ShadowMicroPolicy = malformed || missingFacts.length > 0
    ? "unknown"
    : blockingReasons.length > 0
      ? "ineligible"
      : "eligible"
  return finish(microPolicy)
}

export function classifyEntryTriage(input: EntryTriageInput): EntryTriageResult
export function classifyEntryTriage(input: EntryTriageInput, includeShadow: false): EntryTriageClassification
export function classifyEntryTriage(input: EntryTriageInput, includeShadow = true): EntryTriageResult | EntryTriageClassification {
  const result = classifyEntryTriageBase(input)
  return includeShadow ? { ...result, shadow: predictEntryRouteShadow(input) } : result
}


export function createODFEntryTriage(): ReturnType<typeof tool> {
  return tool({
    description: `Classify an ODF change entry as micro, standard, or full and select an existing canonical work type.

Pure and read-only: no disk, registry, delegation, or side effects. If needs_question
is true, ask one grouped question for the missing facts and re-run.`,
    args: {
      command: tool.schema
        .string()
        .optional()
        .describe("Origin command (odf-new or odf-fix)"),
      change: tool.schema
        .string()
        .optional()
        .describe("Change name in kebab-case"),
      description: tool.schema
        .string()
        .describe("User description of the change"),
      explicit_work_type: tool.schema
        .enum([...WORK_TYPES])
        .optional()
        .describe("Explicit canonical work type to honor"),
      module: tool.schema
        .string()
        .optional()
        .describe("Primary Odoo module (micro eligibility)"),
      domain: tool.schema
        .string()
        .optional()
        .describe("Functional domain (micro eligibility)"),
      expected_files: tool.schema
        .number()
        .optional()
        .describe("Forecast number of files to change (micro eligibility)"),
      expectations_clear: tool.schema
        .boolean()
        .optional()
        .describe("Whether expectations are clear (micro eligibility)"),
      risk_signals: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Risk signals detected by the caller (security, migration, payment, public-api, data-loss, pii)"),
      known_modules: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Project module names from odf-init/{project}; unknown modules are flagged as warnings"),
      ice_context: tool.schema.object({
        version: tool.schema.number().optional().describe("ICE context envelope version; currently 1"),
        provenance: tool.schema.object({
          source: tool.schema.enum([...ICE_CONTEXT_SOURCES]),
          reference: tool.schema.string(),
        }),
        references: tool.schema.array(tool.schema.object({
          source: tool.schema.enum([...ICE_CONTEXT_SOURCES]),
          reference: tool.schema.string(),
        })).optional(),
        metadata: tool.schema.object({
          module: tool.schema.string().optional(),
          domain: tool.schema.string().optional(),
          expected_files: tool.schema.number().optional(),
          risk_signals: tool.schema.array(tool.schema.string()).optional(),
          known_modules: tool.schema.array(tool.schema.string()).optional(),
          intent: tool.schema.object({ reference: tool.schema.string() }).optional(),
          expectations: tool.schema.object({
            approved: tool.schema.boolean(),
            reference: tool.schema.string(),
          }).optional(),
        }).optional(),
      }).optional().describe("Bounded reference-only ICE context; malformed context is ignored with a warning"),
      shadow_context: tool.schema.object({
        expectations_approved: tool.schema.boolean().optional(),
        diagnosis_evidence: tool.schema.boolean().optional(),
        root_cause_evidence: tool.schema.boolean().optional(),
        regression_evidence: tool.schema.boolean().optional(),
        architecture_signals: tool.schema.array(tool.schema.string()).optional(),
        scope_signals: tool.schema.array(tool.schema.string()).optional(),
        prior_learning_contradiction: tool.schema.boolean().optional(),
        prior_learning: tool.schema.enum(["consistent", "contradictory", "unknown"]).optional(),
        blast_radius: tool.schema.enum(["low", "medium", "high", "unknown"]).optional(),
        reversibility: tool.schema.enum(["high", "medium", "low", "unknown"]).optional(),
        source_authority: tool.schema.enum(["complete", "incomplete", "unknown"]).optional(),
        protected_signals: tool.schema.array(tool.schema.string()).optional(),
        protected_domains: tool.schema.array(tool.schema.string()).optional(),
      }).optional().describe("Explicit bounded facts for the advisory shadow prediction only"),
    },
    async execute(args: EntryTriageToolInput): Promise<string> {
      const result = classifyEntryTriage({
        command: args.command,
        change: args.change || "",
        description: args.description || "",
        explicit_work_type: args.explicit_work_type,
        module: args.module,
        domain: args.domain,
        expected_files: args.expected_files,
        expectations_clear: args.expectations_clear,
        risk_signals: args.risk_signals,
        known_modules: args.known_modules,
        ice_context: args.ice_context as ICEContextEnvelope | undefined,
        shadow_context: args.shadow_context,
      })
      return JSON.stringify(result, null, 2)
    },
  })
}
