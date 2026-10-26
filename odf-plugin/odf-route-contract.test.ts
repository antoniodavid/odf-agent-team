import { describe, expect, it } from "vitest"
import {
  WORK_TYPES,
  advanceWorkflow,
  resolveWorkflowRoute,
  type CanonicalStage,
  type WorkType,
} from "./odf-workflow.js"
import {
  ARTIFACT_GROUPS,
  CANONICAL_ARTIFACT_TYPES,
  HANDOFF_GATES_BY_STAGE,
  STAGE_ARTIFACT_REQUIREMENTS,
  createCanonicalWorkflowHandoff,
} from "./odf-artifact-contract.js"
import {
  DELEGATION_ROLES,
  DELEGATION_STAGES,
  PHASE_STAGE,
  STAGE_ROLES,
  delegationTargetForPhase,
  isStageTerminalRole,
  resolveDelegationTarget,
} from "./odf-delegation-contract.js"

const ACTIVE_STAGES: CanonicalStage[] = ["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"]

const EXPECTED_TERMINALS: Record<WorkType, CanonicalStage> = {
  question: "EXPLORE",
  investigation: "EXPLORE",
  "standard-config": "DECIDE",
  "small-change": "VERIFY",
  "feature-inline": "VERIFY",
  feature: "VERIFY",
  "cross-domain": "VERIFY",
  bugfix: "VERIFY",
  migration: "VERIFY",
  security: "VERIFY",
  "verify-only": "VERIFY",
}

function refsFor(stage: CanonicalStage): string[] {
  return STAGE_ARTIFACT_REQUIREMENTS[stage][0].map((type) => `openspec/changes/audit/${type}.md`)
}

describe("route and stage contract", () => {
  it("defines every route as an ordered sequence of canonical stages", () => {
    for (const workType of WORK_TYPES) {
      const route = resolveWorkflowRoute(workType)
      expect(route.stages.length).toBeGreaterThan(0)
      expect(new Set(route.stages).size).toBe(route.stages.length)
      expect(route.entry).toBe(route.stages[0])
      for (const stage of route.stages) expect(ACTIVE_STAGES).toContain(stage)
      if (route.plan === "required") expect(route.stages).toContain("PLAN")
      if (route.verification === "required") expect(route.stages).toContain("VERIFY")
      if (route.parallel_build) {
        expect(workType).toBe("cross-domain")
        expect(route.stages).toContain("BUILD")
      }
    }
  })

  it("keeps stage artifacts and gates consistent with the artifact groups", () => {
    for (const stage of ACTIVE_STAGES) {
      expect(CANONICAL_ARTIFACT_TYPES[stage].length).toBeGreaterThan(0)
      expect(STAGE_ARTIFACT_REQUIREMENTS[stage].length).toBeGreaterThan(0)
      expect(HANDOFF_GATES_BY_STAGE[stage].length).toBeGreaterThan(0)

      for (const type of CANONICAL_ARTIFACT_TYPES[stage]) {
        expect(ARTIFACT_GROUPS[type]).toBe(stage)
      }
      for (const alternative of STAGE_ARTIFACT_REQUIREMENTS[stage]) {
        expect(alternative.length).toBeGreaterThan(0)
        for (const type of alternative) expect(ARTIFACT_GROUPS[type]).toBe(stage)
      }

      const gates = HANDOFF_GATES_BY_STAGE[stage]
      if (stage === "BUILD" || stage === "VERIFY") {
        expect(gates).toContain("policy-gate")
        expect(gates).toContain("validation-evidence")
      } else {
        expect(gates).not.toContain("policy-gate")
        expect(gates).not.toContain("validation-evidence")
      }
    }
  })

  it("builds the canonical handoff for every route transition", () => {
    for (const workType of WORK_TYPES) {
      const route = resolveWorkflowRoute(workType)
      const entryHandoff = createCanonicalWorkflowHandoff({
        change: "audit",
        work_type: workType,
        artifact_store: "openspec",
        completed_stages: [],
        pending_stage: route.stages[0],
        artifact_refs: {},
      })
      expect(entryHandoff, `${workType} entry handoff`).not.toBeNull()

      for (let index = 1; index < route.stages.length; index++) {
        const from = route.stages[index - 1]
        const to = route.stages[index]
        const handoff = createCanonicalWorkflowHandoff({
          change: "audit",
          work_type: workType,
          artifact_store: "openspec",
          completed_stages: route.stages.slice(0, index),
          pending_stage: to,
          artifact_refs: { [from]: refsFor(from) },
        })
        expect(handoff, `${workType} ${from} -> ${to} handoff`).not.toBeNull()
      }
    }
  })

  it("advances every route from INIT to complete with legal proofs", () => {
    for (const workType of WORK_TYPES) {
      const route = resolveWorkflowRoute(workType)
      let completed: CanonicalStage[] = []
      for (const [index, stage] of route.stages.entries()) {
        const result = advanceWorkflow({
          route,
          completed_stages: completed,
          candidate_stage: stage,
          phase_result_status: "ok",
          validation_status: stage === "BUILD" ? "verified" : "not-required",
          receipt_state: "none",
          resumable_state: true,
          archived_state: false,
        })
        expect(["advanced", "complete"], `${workType} ${stage}`).toContain(result.status)
        if (result.status === "advanced") {
          expect(result.next_stage, `${workType} ${stage} next`).toBe(route.stages[index + 1] ?? null)
        }
        completed = [...completed, stage]
      }
      const final = advanceWorkflow({
        route,
        completed_stages: completed,
        candidate_stage: null,
        phase_result_status: "ok",
        validation_status: "verified",
        receipt_state: "none",
        resumable_state: true,
        archived_state: false,
      })
      expect(final.status, `${workType} complete`).toBe("complete")
      expect(final.next_stage).toBeNull()
    }
  })

  it("maps every stage and role through the delegation contract", () => {
    expect([...DELEGATION_STAGES].sort()).toEqual([...ACTIVE_STAGES].sort())

    for (const stage of ACTIVE_STAGES) {
      const roles = STAGE_ROLES[stage]
      if (roles) {
        for (const role of roles) {
          const target = resolveDelegationTarget(stage, role)
          expect(target.ok, `${stage} ${role}`).toBe(true)
          if (!target.ok) continue
          expect(target.stage).toBe(stage)
          expect(target.role).toBe(role)
          expect(PHASE_STAGE[target.phase]).toBe(stage)
          expect(delegationTargetForPhase(target.phase)).toEqual({ stage, role })
        }
      } else {
        const target = resolveDelegationTarget(stage)
        expect(target.ok, stage).toBe(true)
        if (!target.ok) continue
        expect(target.role).toBeNull()
        expect(PHASE_STAGE[target.phase]).toBe(stage)
      }
    }

    for (const role of DELEGATION_ROLES) {
      expect(resolveDelegationTarget(PHASE_STAGE[role], role).ok, role).toBe(true)
    }

    expect(isStageTerminalRole("DECIDE", "ASSESS")).toBe(true)
    expect(isStageTerminalRole("PLAN", "DESIGN")).toBe(true)
    expect(isStageTerminalRole("DECIDE", "PROPOSE")).toBe(false)
    expect(isStageTerminalRole("PLAN", "QA-PLAN")).toBe(false)
    expect(isStageTerminalRole("BUILD", null)).toBe(false)
  })

  it("keeps the designed terminal stage for every route", () => {
    for (const workType of WORK_TYPES) {
      const route = resolveWorkflowRoute(workType)
      expect(route.stages.at(-1), workType).toBe(EXPECTED_TERMINALS[workType])
    }
  })
})
