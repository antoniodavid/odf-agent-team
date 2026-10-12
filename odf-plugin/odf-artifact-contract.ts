import { resolveWorkflowRoute, WORK_TYPES, type CanonicalStage, type WorkType } from "./odf-workflow.js"
import {
  ARTIFACT_STORES,
  PROPOSAL_ARTIFACT_STORES,
  WORKFLOW_BIND_STORES,
  type ArtifactStore,
  type ProposalArtifactStore,
  type WorkflowBindStore,
} from "./odf-artifact-stores.js"

export {
  ARTIFACT_STORES,
  PROPOSAL_ARTIFACT_STORES,
  WORKFLOW_BIND_STORES,
  type ArtifactStore,
  type ProposalArtifactStore,
  type WorkflowBindStore,
} from "./odf-artifact-stores.js"

export const ARTIFACT_GROUPS: Record<string, CanonicalStage | "ARCHIVED"> = {
  decision: "DECIDE", propose: "DECIDE", assess: "DECIDE",
  plan: "PLAN", design: "PLAN", "qa-plan": "PLAN",
  build: "BUILD", "implement-progress": "BUILD", implement: "BUILD", "apply-progress": "BUILD", tasks: "BUILD",
  verify: "VERIFY", "verify-report": "VERIFY",
  explore: "EXPLORE", "explore-progress": "EXPLORE",
  fix: "FIX", "fix-progress": "FIX",
  archive: "ARCHIVED", "archive-report": "ARCHIVED", retrospective: "ARCHIVED",
}

export const CANONICAL_ARTIFACT_TYPES: Record<CanonicalStage, readonly string[]> = {
  DECIDE: ["decision"],
  PLAN: ["plan"],
  BUILD: ["build", "implement-progress"],
  VERIFY: ["verify"],
  EXPLORE: ["explore"],
  FIX: ["fix"],
}

/** Alternative sets whose members must be present for a stage handoff. */
export const STAGE_ARTIFACT_REQUIREMENTS: Record<CanonicalStage, readonly (readonly string[])[]> = {
  DECIDE: [["decision"], ["propose", "assess"]],
  PLAN: [["plan"], ["design"]],
  BUILD: [["build"], ["implement-progress"], ["implement"], ["apply-progress"], ["tasks"]],
  VERIFY: [["verify"], ["verify-report"]],
  EXPLORE: [["explore"], ["explore-progress"]],
  FIX: [["fix"], ["fix-progress"]],
}

export const LEGACY_ARTIFACT_PHASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["VERIFY", ["verify", "verify-report"]],
  ["IMPLEMENT", ["build", "implement-progress", "implement", "apply-progress", "tasks"]],
  ["FIX", ["fix", "fix-progress"]],
  ["EXPLORE", ["explore", "explore-progress"]],
  ["DESIGN", ["plan", "design"]],
  ["QA-PLAN", ["qa-plan"]],
  ["ASSESS", ["decision", "assess"]],
  ["PROPOSE", ["propose"]],
]

export const ARTIFACT_TYPE_PRIORITY = [
  "decision", "plan", "build", "verify", "implement-progress", "propose", "assess", "design", "qa-plan",
  "implement", "apply-progress", "tasks", "verify-report", "explore", "explore-progress", "fix", "fix-progress",
]

export const BUILD_ARTIFACT_TYPES = ["build", "implement-progress", "implement", "apply-progress", "tasks"] as const
export const VERIFY_ARTIFACT_TYPES = ["verify-report"] as const
export const PROGRESS_ARTIFACT_TYPES = ["implement-progress", "apply-progress", "tasks"] as const

export function artifactTypeFromKey(key: string): string {
  const raw = key.trim().split(/[\\/]/).filter(Boolean).pop() || ""
  const type = raw.replace(/\.(json|ya?ml|md)$/i, "").trim().toLowerCase().replace(/_/g, "-")
  if (type === "proposal") return "propose"
  if (type === "spec" || type === "assessment") return "assess"
  if (type.startsWith("verify-report-")) return "verify-report"
  return type
}

const OPEN_SPEC_ARTIFACT_STEMS = new Set([
  "decision", "plan", "build", "verify", "proposal", "propose", "assess", "assessment", "spec", "qa-plan", "design",
  "tasks", "apply-progress", "implement-progress", "archive-report", "expectations",
])

export function isOpenSpecArtifactName(fileName: string): boolean {
  const stem = fileName.replace(/\.(json|ya?ml|md)$/i, "").toLowerCase()
  return OPEN_SPEC_ARTIFACT_STEMS.has(stem) || /^verify-report(?:-.+)?$/.test(stem)
}

export interface WorkflowHandoffArtifact {
  stage: CanonicalStage | "SHARED"
  name: string
  artifact_ref: { store: ArtifactStore; ref: string }
}

export type WorkflowHandoffGate = "safety" | "receipt-clear" | "policy-gate" | "validation-evidence"

export const HANDOFF_GATES_BY_STAGE: Record<CanonicalStage, readonly WorkflowHandoffGate[]> = {
  DECIDE: ["safety", "receipt-clear"],
  PLAN: ["safety", "receipt-clear"],
  BUILD: ["safety", "receipt-clear", "policy-gate", "validation-evidence"],
  VERIFY: ["safety", "receipt-clear", "policy-gate", "validation-evidence"],
  EXPLORE: ["safety", "receipt-clear"],
  FIX: ["safety", "receipt-clear"],
}

export interface CanonicalWorkflowHandoff {
  schema_version: 1
  change: string
  work_type: WorkType
  artifact_store: ArtifactStore
  from_stage: CanonicalStage | null
  to_stage: CanonicalStage
  artifacts: WorkflowHandoffArtifact[]
  shared_artifacts: WorkflowHandoffArtifact[]
  required_gates: WorkflowHandoffGate[]
}

export interface WorkflowHandoffInput {
  change: string
  work_type: WorkType
  artifact_store: ArtifactStore
  completed_stages: CanonicalStage[]
  pending_stage: CanonicalStage | null
  artifact_refs: Partial<Record<CanonicalStage, string[]>>
  shared_artifact_refs?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function validateCanonicalWorkflowHandoff(value: unknown): value is CanonicalWorkflowHandoff {
  if (!isRecord(value) || value.schema_version !== 1 || typeof value.change !== "string" || !value.change.trim()) return false
  if (typeof value.work_type !== "string" || !WORK_TYPES.includes(value.work_type as WorkType)) return false
  if (!ARTIFACT_STORES.includes(value.artifact_store as ArtifactStore)) return false
  if (value.from_stage !== null && (typeof value.from_stage !== "string" || !Object.hasOwn(STAGE_ARTIFACT_REQUIREMENTS, value.from_stage))) return false
  if (typeof value.to_stage !== "string" || !Object.hasOwn(STAGE_ARTIFACT_REQUIREMENTS, value.to_stage)) return false
  const requiredGates = HANDOFF_GATES_BY_STAGE[value.to_stage as CanonicalStage]
  const suppliedGates = value.required_gates
  if (!Array.isArray(suppliedGates) || suppliedGates.length !== requiredGates.length ||
    requiredGates.some((gate) => !suppliedGates.includes(gate))) return false
  const route = resolveWorkflowRoute(value.work_type as WorkType)
  const targetIndex = route.stages.indexOf(value.to_stage as CanonicalStage)
  const sourceIndex = value.from_stage === null ? -1 : route.stages.indexOf(value.from_stage as CanonicalStage)
  if (targetIndex < 0 || sourceIndex !== targetIndex - 1 || (sourceIndex === -1 && value.to_stage !== route.entry)) return false
  if (!Array.isArray(value.artifacts) || !Array.isArray(value.shared_artifacts)) return false
  const names = new Set<string>()
  for (const item of value.artifacts) {
    if (!isRecord(item) || item.stage !== value.from_stage || typeof item.name !== "string" || !item.name.trim()) return false
    const ref = item.artifact_ref
    if (!isRecord(ref) || ref.store !== value.artifact_store || typeof ref.ref !== "string" || !ref.ref.trim()) return false
    const group = ARTIFACT_GROUPS[item.name]
    if (group !== value.from_stage || names.has(item.name)) return false
    names.add(item.name)
  }
  const sharedRefs = new Set<string>()
  for (const item of value.shared_artifacts) {
    if (!isRecord(item) || item.stage !== "SHARED" || item.name !== "expectations") return false
    const ref = item.artifact_ref
    if (!isRecord(ref) || ref.store !== value.artifact_store || typeof ref.ref !== "string" || !ref.ref.trim() || sharedRefs.has(ref.ref)) return false
    sharedRefs.add(ref.ref)
  }
  if (value.from_stage === null) return value.artifacts.length === 0
  const alternatives = STAGE_ARTIFACT_REQUIREMENTS[value.from_stage as CanonicalStage]
  return alternatives.some((required) => required.every((name) => names.has(name)))
}

export function createCanonicalWorkflowHandoff(input: WorkflowHandoffInput): CanonicalWorkflowHandoff | null {
  if (!input.pending_stage) return null
  const route = resolveWorkflowRoute(input.work_type)
  const targetIndex = route.stages.indexOf(input.pending_stage)
  if (targetIndex < 0) return null
  const fromStage = targetIndex === 0 ? null : route.stages[targetIndex - 1] ?? null
  if (fromStage && !input.completed_stages.includes(fromStage)) return null
  const artifacts: WorkflowHandoffArtifact[] = fromStage
    ? (input.artifact_refs[fromStage] || []).map((ref) => {
      const name = artifactTypeFromKey(ref)
      return {
        stage: fromStage,
        name: name === "proposal" ? "propose" : name === "assessment" || name === "spec" ? "assess" : name,
        artifact_ref: { store: input.artifact_store, ref },
      }
    })
    : []
  const sharedArtifacts: WorkflowHandoffArtifact[] = Array.from(new Set(input.shared_artifact_refs || [])).map((ref) => ({
    stage: "SHARED",
    name: "expectations",
    artifact_ref: { store: input.artifact_store, ref },
  }))
  const handoff: CanonicalWorkflowHandoff = {
    schema_version: 1,
    change: input.change,
    work_type: input.work_type,
    artifact_store: input.artifact_store,
    from_stage: fromStage,
    to_stage: input.pending_stage,
    artifacts,
    shared_artifacts: sharedArtifacts,
    required_gates: [...HANDOFF_GATES_BY_STAGE[input.pending_stage]],
  }
  return validateCanonicalWorkflowHandoff(handoff) ? handoff : null
}
