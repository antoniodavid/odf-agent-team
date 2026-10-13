import { z } from "zod"

export const ODF_RESULT_STATUSES = ["ok", "warning", "blocked", "failed"] as const
export const ODF_RESULT_STRATEGIES = ["standard", "custom", "migration", "integration"] as const
export const ODF_RESULT_SKILL_RESOLUTIONS = ["injected", "self-discovered", "none"] as const
export const ODF_STOP_KINDS = ["human-decision", "safety", "repairable", "dependency", "terminal", "unclassified"] as const
export const ODF_STOP_RECOVERIES = ["none", "repair-in-phase", "retry-once", "wait"] as const

const stopDispositionSchema = z.object({
  kind: z.enum(ODF_STOP_KINDS),
  user_action_required: z.boolean(),
  automatic_recovery: z.enum(ODF_STOP_RECOVERIES),
  reason: z.string().trim().min(1).max(500),
  next_action: z.string().trim().min(1).max(500),
}).strict()

export type ODFStopDisposition = z.infer<typeof stopDispositionSchema>

const artifactReferenceSchema = z.object({
  store: z.enum(["openspec", "engram", "hybrid"]),
  ref: z.string().trim().min(1),
}).passthrough()

const savedArtifactSchema = z.object({
  name: z.string().trim().min(1),
  artifact_ref: artifactReferenceSchema,
}).passthrough()

export const ODF_RESULT_REQUIRED_FIELDS = [
  "status",
  "executive_summary",
  "strategy",
  "artifacts_saved",
  "next_recommended",
  "odoo_version",
  "modules_affected",
  "skill_resolution",
] as const

export const ODF_RESULT_SCHEMA = z.object({
  status: z.enum(ODF_RESULT_STATUSES),
  executive_summary: z.string().trim().min(1),
  strategy: z.enum(ODF_RESULT_STRATEGIES),
  artifacts_saved: z.array(savedArtifactSchema),
  next_recommended: z.array(z.unknown()),
  risks: z.array(z.unknown()).optional(),
  odoo_version: z.union([
    z.literal(16),
    z.literal(17),
    z.literal(18),
    z.literal(19),
    z.string().regex(/^1[6-9](?:\.0)?$/),
  ]),
  modules_affected: z.array(z.string()),
  skill_resolution: z.enum(ODF_RESULT_SKILL_RESOLUTIONS),
  stop_disposition: stopDispositionSchema.optional(),
}).passthrough()

export type ODFResult = z.infer<typeof ODF_RESULT_SCHEMA>

export function validateODFResult(result: Record<string, unknown>): Record<string, unknown> {
  if (typeof result.status !== "string" || !ODF_RESULT_STATUSES.includes(result.status as typeof ODF_RESULT_STATUSES[number])) {
    throw new Error("invalid-task-result: ODF Result status must be exactly one of ok, warning, blocked, or failed")
  }

  const parsed = ODF_RESULT_SCHEMA.safeParse(result)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue.path.length > 0 ? `field ${issue.path.join(".")}` : "value"
    throw new Error(`invalid-task-result: ODF Result ${field} ${issue.message}`)
  }
  return result
}

/** Classify known stop reasons; unknown reasons remain explicitly fail-closed. */
export function classifyODFStop(reasonValue: unknown): ODFStopDisposition {
  const reason = typeof reasonValue === "string" && reasonValue.trim() ? reasonValue.trim() : "unknown-stop"
  const disposition = (
    kind: ODFStopDisposition["kind"],
    userActionRequired: boolean,
    automaticRecovery: ODFStopDisposition["automatic_recovery"],
    nextAction: string,
  ): ODFStopDisposition => ({
    kind,
    user_action_required: userActionRequired,
    automatic_recovery: automaticRecovery,
    reason: reason.slice(0, 500),
    next_action: nextAction,
  })

  if (/^(?:unsafe-|pre-tool-safety|policy-gate-|(?:oca-)?candidate-digest-mismatch|validation-evidence-invalid|database-not-authorized|security-boundary)/.test(reason)) {
    return disposition("safety", true, "none", "Preserve the safety gate; report the failed invariant and do not retry around it.")
  }
  if (/^(?:expectations-(?:not-approved|invalid)|(?:workflow-)?receipt-pending|governance-acknowledgment-required|product-decision-required|scope-decision-required|destructive-consent-required|user-disposition-required|multiple-active-changes|artifact-store-required|missing-artifact-store|change-name-required)$/.test(reason)) {
    return disposition("human-decision", true, "none", "Ask the user for the specific approval or disposition named by the gate.")
  }
  if (/^(?:workflow-(?:implement-progress|verify-report)-(?:missing|not-terminal)|invalid-task-result|artifact-not-written|artifact-ref-(?:missing|invalid)|design-closure-(?:missing|incomplete)|design-not-closed)$/.test(reason)) {
    return disposition("repairable", false, "repair-in-phase", "Repair the named artifact or result contract within the approved scope, then re-run the same gate once.")
  }
  if (/^(?:task-timeout|task-transport-unavailable|temporarily-unavailable)$/.test(reason)) {
    return disposition("dependency", false, "retry-once", "Retry the same bounded operation once only if the original child is confirmed idle and no receipt or side effect is pending.")
  }
  if (/^(?:task-api-unavailable|registry-unavailable|active-change-discovery-incomplete|dependency-unavailable)$/.test(reason)) {
    return disposition("dependency", true, "wait", "Restore or select the named dependency, then resume without changing workflow state.")
  }
  if (/^(?:task-cancelled|empty-task-result|attempt-settlement-failed|task-error|task-failed|delegation-seal-error)$/.test(reason)) {
    return disposition("terminal", true, "none", "Report the observed failure and request a user disposition before changing or replaying the workflow.")
  }
  return disposition("unclassified", true, "none", "Do not auto-continue; present the evidence and ask for disposition because the stop could not be classified safely.")
}

/** Accept reported detail only when it cannot weaken the deterministic stop classification. */
export function resultStopDisposition(result: unknown): ODFStopDisposition | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null
  const value = result as Record<string, unknown>
  if (value.status !== "blocked" && value.status !== "failed") return null

  const classified = classifyODFStop(value.reason)
  const parsed = stopDispositionSchema.safeParse(value.stop_disposition)
  if (!parsed.success) return classified

  const reported = parsed.data
  if (classified.user_action_required) return classified
  if (reported.user_action_required || ["human-decision", "safety", "terminal", "unclassified"].includes(reported.kind)) {
    return {
      ...classified,
      kind: reported.kind,
      user_action_required: true,
      automatic_recovery: "none",
      next_action: reported.next_action,
    }
  }
  if (reported.kind !== classified.kind || reported.automatic_recovery !== classified.automatic_recovery) return classified
  return reported
}

/** Compact, schema-backed instructions appended to every delegated prompt. */
export const ODF_RESULT_CONTRACT_PROMPT = [
  "## Required ODF Result contract",
  "End with one `## ODF Result` section. Include every common field below, even when its value is an empty array; keep phase-specific fields as additional fields.",
  `- **status**: choose exactly one of ${ODF_RESULT_STATUSES.join(" | ")}; never emit the alternatives as a value.`,
  ...ODF_RESULT_REQUIRED_FIELDS.slice(1).map(field => `- **${field}**: required common field from the shared result contract.`),
  "- `artifacts_saved` must be an array; each saved item uses `name` and canonical `artifact_ref: {store, ref}`. Use `[]` when nothing was saved.",
  "- `next_recommended` and `modules_affected` must be arrays; use `[]` when none apply.",
  "- `strategy` is one of standard, custom, migration, or integration; follow any narrower phase/agent restriction.",
  `- When status is blocked or failed, include \`stop_disposition\` with kind (${ODF_STOP_KINDS.join(" | ")}), user_action_required, automatic_recovery (${ODF_STOP_RECOVERIES.join(" | ")}), a short kebab-case reason code, and the next safe action. Never label an unknown or safety-related stop as repairable.`,
  "- `odoo_version` is 16, 17, 18, or 19; `skill_resolution` is injected, self-discovered, or none.",
  "- Structured values must be single-line JSON. Do not copy placeholder text or omit common fields.",
].join("\n")
