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
