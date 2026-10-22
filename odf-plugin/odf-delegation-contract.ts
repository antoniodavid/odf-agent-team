/**
 * Delegation contract: canonical stage + role.
 *
 * The legacy `phase` vocabulary conflated two axes: the canonical stage the
 * workflow advances (DECIDE/PLAN/BUILD/VERIFY/EXPLORE/FIX) and the deliverable
 * role inside a composite stage (PROPOSE/ASSESS for DECIDE, QA-PLAN/DESIGN for
 * PLAN). This module is the single place that resolves the public contract into
 * the internal role identifier the registry and artifact layer still use.
 *
 * Public API: stage is required; role is required only for DECIDE and PLAN and
 * rejected everywhere else.
 */
import type { CanonicalStage, LegacyPhase } from "./odf-workflow.js"

export const DELEGATION_STAGES = ["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"] as const
export type DelegationStage = (typeof DELEGATION_STAGES)[number]

export const DELEGATION_ROLES = ["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN"] as const
export type DelegationRole = (typeof DELEGATION_ROLES)[number]

/** Roles accepted by each composite stage; single-role stages have no entry. */
export const STAGE_ROLES: Partial<Record<DelegationStage, readonly DelegationRole[]>> = {
  DECIDE: ["PROPOSE", "ASSESS"],
  PLAN: ["QA-PLAN", "DESIGN"],
}

/** Internal phase for stages that own exactly one role. */
const STAGE_PHASE: Record<Exclude<DelegationStage, "DECIDE" | "PLAN">, LegacyPhase> = {
  BUILD: "IMPLEMENT",
  VERIFY: "VERIFY",
  EXPLORE: "EXPLORE",
  FIX: "FIX",
}

/** Internal phase for each composite-stage role. */
const ROLE_PHASE: Record<DelegationRole, LegacyPhase> = {
  PROPOSE: "PROPOSE",
  ASSESS: "ASSESS",
  "QA-PLAN": "QA-PLAN",
  DESIGN: "DESIGN",
}

/**
 * Legacy-phase → canonical-stage projection. Kept for historical data (metrics,
 * persisted documents) and as the route's vocabulary bridge, never as a public
 * delegation input.
 */
export const PHASE_STAGE: Record<LegacyPhase, DelegationStage> = {
  PROPOSE: "DECIDE",
  ASSESS: "DECIDE",
  "QA-PLAN": "PLAN",
  DESIGN: "PLAN",
  IMPLEMENT: "BUILD",
  VERIFY: "VERIFY",
  EXPLORE: "EXPLORE",
  FIX: "FIX",
}

export type DelegationTargetErrorReason =
  | "invalid-stage"
  | "role-required"
  | "role-not-applicable"
  | "invalid-role"

export type DelegationTargetError = {
  ok: false
  reason: DelegationTargetErrorReason
  message: string
}

export type DelegationTarget = {
  ok: true
  stage: DelegationStage
  role: DelegationRole | null
  /** Internal role identifier used by the registry, skills, profiles, and artifacts. */
  phase: LegacyPhase
} | DelegationTargetError

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : ""
}

function stageList(): string {
  return DELEGATION_STAGES.join(", ")
}

/**
 * Resolve the public `stage`/`role` pair into a typed delegation target.
 *
 * Case-insensitive, trims surrounding whitespace, and treats an empty role as
 * absent. `DECIDE` and `PLAN` require one of their two roles; every other stage
 * rejects any role.
 */
export function resolveDelegationTarget(stageInput: unknown, roleInput?: unknown): DelegationTarget {
  const stageText = normalize(stageInput)
  if (!(DELEGATION_STAGES as readonly string[]).includes(stageText)) {
    return {
      ok: false,
      reason: "invalid-stage",
      message: stageText
        ? `Invalid stage "${stageText}". Allowed: ${stageList()}`
        : `Missing stage. Allowed: ${stageList()}`,
    }
  }

  const stage = stageText as DelegationStage
  const roleText = normalize(roleInput)
  const allowedRoles = STAGE_ROLES[stage]

  if (!allowedRoles) {
    if (roleText) {
      return {
        ok: false,
        reason: "role-not-applicable",
        message: `Stage ${stage} does not accept a role. Omit role.`,
      }
    }
    // STAGE_ROLES has entries only for DECIDE and PLAN, so reaching this branch
    // proves the stage is one of the single-role stages.
    return { ok: true, stage, role: null, phase: STAGE_PHASE[stage as keyof typeof STAGE_PHASE] }
  }

  if (!roleText) {
    return {
      ok: false,
      reason: "role-required",
      message: `Stage ${stage} requires a role. Allowed roles: ${allowedRoles.join(", ")}`,
    }
  }

  if (!(allowedRoles as readonly string[]).includes(roleText)) {
    return {
      ok: false,
      reason: "invalid-role",
      message: `Invalid role "${roleText}" for stage ${stage}. Allowed roles: ${allowedRoles.join(", ")}`,
    }
  }

  const role = roleText as DelegationRole
  return { ok: true, stage, role, phase: ROLE_PHASE[role] }
}

/**
 * Project an internal phase back onto the public stage/role pair. Used by the
 * native replay paths, which persist the internal phase on their token record
 * but must call the public contract with stages.
 */
export function delegationTargetForPhase(phase: LegacyPhase): { stage: DelegationStage; role: DelegationRole | null } {
  const stage = PHASE_STAGE[phase]
  const roles = STAGE_ROLES[stage]
  return roles
    ? { stage, role: phase as DelegationRole }
    : { stage, role: null }
}

/**
 * True when the role completes its stage and may commit the canonical stage.
 * PROPOSE and QA-PLAN are intermediate roles and never commit on their own.
 */
export function isStageTerminalRole(stageInput: unknown, roleInput: unknown): boolean {
  const stage = normalize(stageInput)
  const role = normalize(roleInput)
  return (stage === "DECIDE" && role === "ASSESS") || (stage === "PLAN" && role === "DESIGN")
}

/** Runtime guard for canonical stage values (used by tool envelopes). */
export function isDelegationStage(value: unknown): value is DelegationStage {
  return typeof value === "string" && (DELEGATION_STAGES as readonly string[]).includes(value)
}

/** Type-level bridge for consumers that only need the stage list. */
export type { CanonicalStage }
