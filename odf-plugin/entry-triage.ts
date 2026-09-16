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

const MAX_ICE_CONTEXT_REFERENCES = 8
const MAX_ICE_CONTEXT_REFERENCE_LENGTH = 256
const MAX_ICE_CONTEXT_TOKEN_LENGTH = 96
const MAX_ICE_CONTEXT_MODULES = 128
const MAX_ICE_CONTEXT_RISK_SIGNALS = 6
const MAX_ICE_CONTEXT_FILES = 1000

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

export function classifyEntryTriage(input: EntryTriageInput): EntryTriageResult {
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
    },
    async execute(args: Omit<EntryTriageInput, "change"> & { change?: string }): Promise<string> {
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
        ice_context: args.ice_context,
      })
      return JSON.stringify(result, null, 2)
    },
  })
}
