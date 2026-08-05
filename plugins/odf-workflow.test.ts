import { describe, expect, it } from "vitest"
import { createODFWorkflowRoute } from "./odf-delegation.js"
import {
  advanceWorkflow,
  resolveWorkflowRoute,
  type CanonicalStage,
  type WorkType,
  type WorkflowAdvanceInput,
} from "./odf-workflow.js"

const expectedRoutes: Record<WorkType, ReturnType<typeof resolveWorkflowRoute>> = {
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
    parallel_build: false,
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

describe("resolveWorkflowRoute", () => {
  for (const [workType, expected] of Object.entries(expectedRoutes) as [WorkType, ReturnType<typeof resolveWorkflowRoute>][]) {
    it(`resolves ${workType}`, () => {
      expect(resolveWorkflowRoute(workType)).toEqual(expected)
    })
  }

  it("returns independent stage arrays", () => {
    const route = resolveWorkflowRoute("feature")
    route.stages.push("EXPLORE")

    expect(resolveWorkflowRoute("feature").stages).toEqual(["DECIDE", "PLAN", "BUILD", "VERIFY"])
  })

  it("keeps the thin-spine depth invariants", () => {
    expect(resolveWorkflowRoute("standard-config").stages).toEqual(["DECIDE"])
    expect(resolveWorkflowRoute("small-change").plan).toBe("inline")
    expect(resolveWorkflowRoute("feature").stages).toContain("PLAN")
    expect(resolveWorkflowRoute("cross-domain").stages).toContain("PLAN")
    expect(resolveWorkflowRoute("migration").risk).toBe("high")
    expect(resolveWorkflowRoute("security").risk).toBe("high")
    expect(resolveWorkflowRoute("bugfix").entry).toBe("FIX")
    expect(resolveWorkflowRoute("verify-only")).toMatchObject({ entry: "VERIFY", stages: ["VERIFY"] })
  })

  it("fails clearly for an unknown runtime value", () => {
    expect(() => resolveWorkflowRoute("unknown" as WorkType)).toThrow("Unsupported work type: unknown")
  })
})

describe("createODFWorkflowRoute", () => {
  it("returns the route with a compact description", async () => {
    const output = await createODFWorkflowRoute().execute({ work_type: "feature" }, {} as any)
    const result = JSON.parse(output as string)

    expect(result.work_type).toBe("feature")
    expect(result.stages).toEqual(["DECIDE", "PLAN", "BUILD", "VERIFY"])
    expect(result.description).toContain("DECIDE -> PLAN -> BUILD -> VERIFY")
  })
})

describe("advanceWorkflow", () => {
  const input = (overrides: Partial<WorkflowAdvanceInput> = {}): WorkflowAdvanceInput => ({
    route: resolveWorkflowRoute("feature"),
    completed_stages: ["DECIDE"],
    candidate_stage: "PLAN",
    phase_result_status: "ok",
    validation_status: "not-required",
    receipt_state: "none",
    resumable_state: true,
    archived_state: false,
    ...overrides,
  })

  it("advances in route order without mutating completed stages", () => {
    const completed = ["PLAN", "DECIDE", "DECIDE"] as const
    const result = advanceWorkflow(input({
      completed_stages: [...completed],
      candidate_stage: "BUILD",
      validation_status: "verified",
    }))

    expect(result).toEqual({
      status: "advanced",
      completed_stages: ["DECIDE", "PLAN", "BUILD"],
      next_stage: "VERIFY",
      reason: "Advanced to VERIFY.",
    })
    expect(completed).toEqual(["PLAN", "DECIDE", "DECIDE"])
  })

  it("returns complete when the candidate finishes the route", () => {
    expect(advanceWorkflow(input({ completed_stages: ["DECIDE", "PLAN", "BUILD"], candidate_stage: "VERIFY", validation_status: "verified" }))).toEqual({
      status: "complete",
      completed_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
      next_stage: null,
      reason: "All route stages are complete.",
    })

    expect(advanceWorkflow(input({ completed_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"], candidate_stage: null }))).toMatchObject({
      status: "complete",
      next_stage: null,
    })
  })

  it("allows verify-only to start at its route entry", () => {
    expect(advanceWorkflow(input({
      route: resolveWorkflowRoute("verify-only"),
      completed_stages: [],
      candidate_stage: null,
    }))).toEqual({
      status: "advanced",
      completed_stages: [],
      next_stage: "VERIFY",
      reason: "Advanced to VERIFY.",
    })
  })

  const terminalBlockingCases: Array<[string, Partial<WorkflowAdvanceInput>, string]> = [
    ["pending receipt", { receipt_state: "pending" }, "A receipt is pending user disposition."],
    ["non-resumable state", { resumable_state: false }, "Workflow state is not resumable."],
    ["failed phase", { phase_result_status: "failed" }, "The phase result failed."],
    ["blocked phase", { phase_result_status: "blocked" }, "The phase result is blocked."],
  ]

  it.each(terminalBlockingCases)("applies %s before terminal completion", (_label, gate, reason) => {
    const terminalStates: Partial<WorkflowAdvanceInput>[] = [
      { archived_state: true, candidate_stage: null },
      { completed_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"], candidate_stage: null },
    ]

    for (const terminal of terminalStates) {
      const result = advanceWorkflow(input({ ...terminal, ...gate }))

      expect(result.status).toBe("blocked")
      expect(result.reason).toBe(reason)
    }
  })

  it("rejects completed stages outside the selected route", () => {
    const completed = ["DECIDE", "EXPLORE"] as CanonicalStage[]
    const result = advanceWorkflow(input({ completed_stages: completed, candidate_stage: "PLAN" }))

    expect(result).toEqual({
      status: "blocked",
      completed_stages: ["DECIDE"],
      next_stage: null,
      reason: "Completed stages must belong to the selected route.",
    })
    expect(completed).toEqual(["DECIDE", "EXPLORE"])
  })

  const blockedCases: Array<[string, Partial<WorkflowAdvanceInput>, string]> = [
    ["out-of-order stage", { candidate_stage: "BUILD" as const }, "Candidate stage must be the next route stage: PLAN."],
    ["stage not in route", { candidate_stage: "EXPLORE" as const }, "Candidate stage is not part of the selected route."],
    ["pending receipt", { receipt_state: "pending" as const }, "A receipt is pending user disposition."],
    ["failed phase", { phase_result_status: "failed" as const }, "The phase result failed."],
    ["blocked phase", { phase_result_status: "blocked" as const }, "The phase result is blocked."],
    ["BUILD without verified validation", { completed_stages: ["DECIDE", "PLAN"], candidate_stage: "BUILD" as const }, "BUILD requires verified validation."],
    ["non-resumable state", { resumable_state: false }, "Workflow state is not resumable."],
  ]

  it.each(blockedCases)("blocks %s", (_label, overrides, reason) => {
    const result = advanceWorkflow(input(overrides))

    expect(result.status).toBe("blocked")
    expect(result.reason).toBe(reason)
  })

  it("supports EXPLORE and FIX routes", () => {
    expect(advanceWorkflow(input({
      route: resolveWorkflowRoute("question"),
      completed_stages: [],
      candidate_stage: "EXPLORE",
    }))).toMatchObject({ status: "complete", next_stage: null })

    expect(advanceWorkflow(input({
      route: resolveWorkflowRoute("bugfix"),
      completed_stages: [],
      candidate_stage: "FIX",
    })).next_stage).toBe("BUILD")
  })

  it("treats archived state as complete", () => {
    expect(advanceWorkflow(input({ archived_state: true, candidate_stage: null }))).toMatchObject({
      status: "complete",
      completed_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
      next_stage: null,
    })
  })
})
