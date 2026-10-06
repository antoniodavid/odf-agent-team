import { z } from "zod"

export const ODF_RESULT_STATUSES = ["ok", "warning", "blocked", "failed"] as const
export const ODF_RESULT_STRATEGIES = ["standard", "custom", "migration", "integration"] as const
export const ODF_RESULT_SKILL_RESOLUTIONS = ["injected", "self-discovered", "none"] as const

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

/** Compact, schema-backed instructions appended to every delegated prompt. */
export const ODF_RESULT_CONTRACT_PROMPT = [
  "## Required ODF Result contract",
  "End with one `## ODF Result` section. Include every common field below, even when its value is an empty array; keep phase-specific fields as additional fields.",
  `- **status**: choose exactly one of ${ODF_RESULT_STATUSES.join(" | ")}; never emit the alternatives as a value.`,
  ...ODF_RESULT_REQUIRED_FIELDS.slice(1).map(field => `- **${field}**: required common field from the shared result contract.`),
  "- `artifacts_saved` must be an array; each saved item uses `name` and canonical `artifact_ref: {store, ref}`. Use `[]` when nothing was saved.",
  "- `next_recommended` and `modules_affected` must be arrays; use `[]` when none apply.",
  "- `strategy` is one of standard, custom, migration, or integration; follow any narrower phase/agent restriction.",
  "- `odoo_version` is 16, 17, 18, or 19; `skill_resolution` is injected, self-discovered, or none.",
  "- Structured values must be single-line JSON. Do not copy placeholder text or omit common fields.",
].join("\n")
