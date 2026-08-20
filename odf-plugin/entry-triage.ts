/**
 * entry-triage
 * Deterministic ODF change-entry classification (micro / standard / full).
 *
 * Pure module: no disk, registry, or environment access. Maps an entry to an
 * existing canonical work type from ./odf-workflow.js; never invents work types.
 */

import { WORK_TYPES, type WorkType } from "./odf-workflow.js"

export type EntryLevel = "micro" | "standard" | "full"

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
}

export interface EntryTriageResult {
  level: EntryLevel
  work_type: WorkType
  reason: string
  needs_question: boolean
  question?: string
}

export type RiskSignal = "security" | "migration" | "payment" | "public-api" | "data-loss"

const RISK_SIGNAL_PATTERNS: Array<{ signal: RiskSignal; pattern: RegExp }> = [
  { signal: "security", pattern: /\b(security|acl|access rights?|ir\.model\.access|roles|permissions)\b|groups\s*=/i },
  { signal: "migration", pattern: /\b(migrations?|migrating|upgrade|downgrade)\b/i },
  { signal: "payment", pattern: /\b(payment|money|billing|stripe|paypal|checkout|charge)\b/i },
  { signal: "public-api", pattern: /\b(public\s+api|external\s+api|api\s+endpoint|webhook|rest\s+api|json-?rpc)\b/i },
  { signal: "data-loss", pattern: /\b(unlink|purge|irreversible|wipe|data\s+loss)\b|\bdelete\s+(?:records?|data|rows?|partners?)/i },
]

const STANDARD_CONFIG_PATTERN = /\b(standard\s*config(?:uration)?|configuration|configure|setup|enable|activate|instal(?:l|laci[oó]n))\b/i

export function detectRiskSignals(description: string): string[] {
  return RISK_SIGNAL_PATTERNS
    .filter(entry => entry.pattern.test(description))
    .map(entry => entry.signal)
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

export function classifyEntryTriage(input: EntryTriageInput): EntryTriageResult {
  const signals = [...new Set([
    ...normalizeRiskSignals(input.risk_signals),
    ...detectRiskSignals(input.description || ""),
  ])]

  const explicit = input.explicit_work_type
  if (explicit && WORK_TYPES.includes(explicit)) {
    const level = explicitLevel(explicit)
    if (level === "micro" && signals.length > 0) {
      return {
        level: "full",
        work_type: signalToWorkType(signals[0]),
        reason: `Explicit work type ${explicit} would be micro but risk signal(s) (${signals.join(", ")}) force the full pipeline.`,
        needs_question: false,
      }
    }
    return {
      level,
      work_type: explicit,
      reason: "Explicit work type honored.",
      needs_question: false,
    }
  }

  if (signals.length > 0) {
    return {
      level: "full",
      work_type: signalToWorkType(signals[0]),
      reason: `Risk signal(s) detected in description: ${signals.join(", ")}. Full pipeline required; never micro.`,
      needs_question: false,
    }
  }

  if (input.command === "odf-fix") {
    return {
      level: "micro",
      work_type: "bugfix",
      reason: "Origin is /odf-fix, a lightweight diagnose -> fix -> verify flow.",
      needs_question: false,
    }
  }

  if (
    input.module &&
    input.domain &&
    input.expected_files !== undefined &&
    input.expected_files <= 3 &&
    input.expectations_clear === true
  ) {
    const workType: WorkType = STANDARD_CONFIG_PATTERN.test(input.description || "")
      ? "standard-config"
      : "small-change"
    return {
      level: "micro",
      work_type: workType,
      reason: workType === "standard-config"
        ? "Single module, single domain, <=3 files, clear expectations, and standard-config wording."
        : "Single module, single domain, <=3 files, and clear expectations.",
      needs_question: false,
    }
  }

  const missing = missingFacts(input)
  if (missing.length > 0) {
    return {
      level: "standard",
      work_type: "feature",
      reason: "Insufficient facts to classify as a micro change.",
      needs_question: true,
      question: `Para clasificar este cambio necesito: ${missing.join("; ")}. Responde brevemente cada punto.`,
    }
  }

  return {
    level: "standard",
    work_type: "feature",
    reason: "No risk signals and the change does not qualify as micro; classified as a standard feature.",
    needs_question: false,
  }
}
