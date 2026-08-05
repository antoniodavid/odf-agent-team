export const WORK_TYPES = [
  "question",
  "investigation",
  "standard-config",
  "small-change",
  "feature",
  "cross-domain",
  "bugfix",
  "migration",
  "security",
  "verify-only",
] as const

export type WorkType = (typeof WORK_TYPES)[number]

export type CanonicalStage = "DECIDE" | "PLAN" | "BUILD" | "VERIFY" | "EXPLORE" | "FIX"
export type LegacyPhase = "PROPOSE" | "ASSESS" | "QA-PLAN" | "DESIGN" | "IMPLEMENT" | "VERIFY" | "EXPLORE" | "FIX"
export type PlanMode = "none" | "inline" | "required"
export type VerificationMode = "none" | "optional" | "required"
export type RiskLevel = "low" | "standard" | "high"

export interface WorkflowRoute {
  work_type: WorkType
  entry: CanonicalStage
  stages: CanonicalStage[]
  legacy_phases: LegacyPhase[]
  plan: PlanMode
  verification: VerificationMode
  parallel_build: boolean
  risk: RiskLevel
}

export type WorkflowAdvanceStatus = "advanced" | "blocked" | "complete"
export type WorkflowPhaseResultStatus = "ok" | "warning" | "blocked" | "failed"
export type WorkflowValidationStatus = "verified" | "missing" | "invalid" | "not-required"
export type WorkflowReceiptState = "none" | "pending" | "resolved"

export interface WorkflowAdvanceInput {
  route: WorkflowRoute
  completed_stages: CanonicalStage[]
  candidate_stage: CanonicalStage | null
  phase_result_status: WorkflowPhaseResultStatus
  validation_status: WorkflowValidationStatus
  receipt_state: WorkflowReceiptState
  resumable_state: boolean
  archived_state: boolean
}

export interface WorkflowAdvanceResult {
  status: WorkflowAdvanceStatus
  completed_stages: CanonicalStage[]
  next_stage: CanonicalStage | null
  reason: string
}

const ROUTES: Record<WorkType, WorkflowRoute> = {
  question: {
    work_type: "question",
    entry: "EXPLORE",
    stages: ["EXPLORE"],
    legacy_phases: ["EXPLORE"],
    plan: "none",
    verification: "none",
    parallel_build: false,
    risk: "low",
  },
  investigation: {
    work_type: "investigation",
    entry: "EXPLORE",
    stages: ["EXPLORE"],
    legacy_phases: ["EXPLORE"],
    plan: "none",
    verification: "none",
    parallel_build: false,
    risk: "low",
  },
  "standard-config": {
    work_type: "standard-config",
    entry: "DECIDE",
    stages: ["DECIDE"],
    legacy_phases: ["PROPOSE", "ASSESS"],
    plan: "none",
    verification: "optional",
    parallel_build: false,
    risk: "low",
  },
  "small-change": {
    work_type: "small-change",
    entry: "DECIDE",
    stages: ["DECIDE", "BUILD", "VERIFY"],
    legacy_phases: ["PROPOSE", "ASSESS", "IMPLEMENT", "VERIFY"],
    plan: "inline",
    verification: "required",
    parallel_build: false,
    risk: "standard",
  },
  feature: {
    work_type: "feature",
    entry: "DECIDE",
    stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
    legacy_phases: ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY"],
    plan: "required",
    verification: "required",
    parallel_build: false,
    risk: "standard",
  },
  "cross-domain": {
    work_type: "cross-domain",
    entry: "DECIDE",
    stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
    legacy_phases: ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY"],
    plan: "required",
    verification: "required",
    parallel_build: true,
    risk: "standard",
  },
  bugfix: {
    work_type: "bugfix",
    entry: "FIX",
    stages: ["FIX", "BUILD", "VERIFY"],
    legacy_phases: ["FIX", "IMPLEMENT", "VERIFY"],
    plan: "inline",
    verification: "required",
    parallel_build: false,
    risk: "standard",
  },
  migration: {
    work_type: "migration",
    entry: "DECIDE",
    stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
    legacy_phases: ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY"],
    plan: "required",
    verification: "required",
    parallel_build: false,
    risk: "high",
  },
  security: {
    work_type: "security",
    entry: "DECIDE",
    stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
    legacy_phases: ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY"],
    plan: "required",
    verification: "required",
    parallel_build: false,
    risk: "high",
  },
  "verify-only": {
    work_type: "verify-only",
    entry: "VERIFY",
    stages: ["VERIFY"],
    legacy_phases: ["VERIFY"],
    plan: "none",
    verification: "required",
    parallel_build: false,
    risk: "standard",
  },
}

export function resolveWorkflowRoute(workType: WorkType): WorkflowRoute {
  const route = ROUTES[workType]
  if (!route) {
    throw new Error(`Unsupported work type: ${String(workType)}`)
  }

  return {
    ...route,
    stages: [...route.stages],
    legacy_phases: [...route.legacy_phases],
  }
}

function normalizeCompletedStages(route: WorkflowRoute, completedStages: CanonicalStage[]): CanonicalStage[] {
  const completed = new Set(completedStages)
  return route.stages.filter((stage, index, stages) => stages.indexOf(stage) === index && completed.has(stage))
}

export function advanceWorkflow(input: WorkflowAdvanceInput): WorkflowAdvanceResult {
  const normalizedCompleted = normalizeCompletedStages(input.route, input.completed_stages)
  const routeStages = [...input.route.stages]
  const nextStage = routeStages.find(stage => !normalizedCompleted.includes(stage)) || null
  const blocked = (reason: string, next_stage: CanonicalStage | null = null): WorkflowAdvanceResult => ({
    status: "blocked",
    completed_stages: normalizedCompleted,
    next_stage,
    reason,
  })

  if (input.completed_stages.some(stage => !routeStages.includes(stage))) {
    return blocked("Completed stages must belong to the selected route.")
  }

  if (input.receipt_state === "pending") {
    return blocked("A receipt is pending user disposition.")
  }

  if (!input.resumable_state) {
    return blocked("Workflow state is not resumable.")
  }

  if (input.phase_result_status === "failed") {
    return blocked("The phase result failed.")
  }

  if (input.phase_result_status === "blocked") {
    return blocked("The phase result is blocked.")
  }

  if (input.candidate_stage !== null && !routeStages.includes(input.candidate_stage)) {
    return blocked("Candidate stage is not part of the selected route.", nextStage)
  }

  if (input.archived_state || normalizedCompleted.length === routeStages.length) {
    if (input.candidate_stage !== null) {
      return blocked(`Candidate stage must be the next route stage: ${nextStage}.`, nextStage)
    }

    return {
      status: "complete",
      completed_stages: routeStages,
      next_stage: null,
      reason: input.archived_state ? "Workflow is archived." : "All route stages are complete.",
    }
  }

  if (input.candidate_stage === null) {
    return blocked("Candidate stage is not part of the selected route.", nextStage)
  }

  if (input.candidate_stage !== nextStage) {
    return blocked(`Candidate stage must be the next route stage: ${nextStage}.`, nextStage)
  }

  if (input.candidate_stage === "BUILD" && input.validation_status !== "verified") {
    return blocked("BUILD requires verified validation.", nextStage)
  }

  const completedStages = routeStages.filter(stage => stage === input.candidate_stage || normalizedCompleted.includes(stage))
  const followingStage = routeStages.find(stage => !completedStages.includes(stage)) || null
  if (!followingStage) {
    return {
      status: "complete",
      completed_stages: completedStages,
      next_stage: null,
      reason: "All route stages are complete.",
    }
  }

  return {
    status: "advanced",
    completed_stages: completedStages,
    next_stage: followingStage,
    reason: `Advanced to ${followingStage}.`,
  }
}
