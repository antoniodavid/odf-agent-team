import { describe, expect, it } from "vitest"
import { createODFWorkflowRoute } from "./odf-delegation.js"
import { resolveWorkflowRoute, type WorkType } from "./odf-workflow.js"

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
