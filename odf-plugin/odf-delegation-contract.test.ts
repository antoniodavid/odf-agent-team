import { describe, it, expect } from "vitest"
import {
  DELEGATION_STAGES,
  DELEGATION_ROLES,
  STAGE_ROLES,
  PHASE_STAGE,
  resolveDelegationTarget,
  isStageTerminalRole,
} from "./odf-delegation-contract.js"

describe("delegation stage contract", () => {
  it("exposes exactly the six canonical stages", () => {
    expect(DELEGATION_STAGES).toEqual(["DECIDE", "PLAN", "BUILD", "VERIFY", "EXPLORE", "FIX"])
  })

  it("exposes the four roles that belong to composite stages", () => {
    expect(DELEGATION_ROLES).toEqual(["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN"])
    expect(STAGE_ROLES).toEqual({
      DECIDE: ["PROPOSE", "ASSESS"],
      PLAN: ["QA-PLAN", "DESIGN"],
    })
  })

  it("maps every stage and role to its internal phase", () => {
    expect(resolveDelegationTarget("DECIDE", "PROPOSE")).toEqual({ ok: true, stage: "DECIDE", role: "PROPOSE", phase: "PROPOSE" })
    expect(resolveDelegationTarget("DECIDE", "ASSESS")).toEqual({ ok: true, stage: "DECIDE", role: "ASSESS", phase: "ASSESS" })
    expect(resolveDelegationTarget("PLAN", "QA-PLAN")).toEqual({ ok: true, stage: "PLAN", role: "QA-PLAN", phase: "QA-PLAN" })
    expect(resolveDelegationTarget("PLAN", "DESIGN")).toEqual({ ok: true, stage: "PLAN", role: "DESIGN", phase: "DESIGN" })
    expect(resolveDelegationTarget("BUILD")).toEqual({ ok: true, stage: "BUILD", role: null, phase: "IMPLEMENT" })
    expect(resolveDelegationTarget("VERIFY")).toEqual({ ok: true, stage: "VERIFY", role: null, phase: "VERIFY" })
    expect(resolveDelegationTarget("EXPLORE")).toEqual({ ok: true, stage: "EXPLORE", role: null, phase: "EXPLORE" })
    expect(resolveDelegationTarget("FIX")).toEqual({ ok: true, stage: "FIX", role: null, phase: "FIX" })
  })

  it("rejects a stage outside the canonical domain with the allowed list", () => {
    expect(resolveDelegationTarget("IMPLEMENT")).toEqual({
      ok: false,
      reason: "invalid-stage",
      message: 'Invalid stage "IMPLEMENT". Allowed: DECIDE, PLAN, BUILD, VERIFY, EXPLORE, FIX',
    })
    expect(resolveDelegationTarget(undefined)).toMatchObject({ ok: false, reason: "invalid-stage" })
  })

  it("requires a role for DECIDE and PLAN", () => {
    expect(resolveDelegationTarget("DECIDE")).toEqual({
      ok: false,
      reason: "role-required",
      message: "Stage DECIDE requires a role. Allowed roles: PROPOSE, ASSESS",
    })
    expect(resolveDelegationTarget("PLAN")).toEqual({
      ok: false,
      reason: "role-required",
      message: "Stage PLAN requires a role. Allowed roles: QA-PLAN, DESIGN",
    })
  })

  it("rejects a role for a single-role stage", () => {
    expect(resolveDelegationTarget("BUILD", "DESIGN")).toEqual({
      ok: false,
      reason: "role-not-applicable",
      message: "Stage BUILD does not accept a role. Omit role.",
    })
    expect(resolveDelegationTarget("VERIFY", "ASSESS")).toMatchObject({ ok: false, reason: "role-not-applicable" })
    expect(resolveDelegationTarget("EXPLORE", "PROPOSE")).toMatchObject({ ok: false, reason: "role-not-applicable" })
    expect(resolveDelegationTarget("FIX", "QA-PLAN")).toMatchObject({ ok: false, reason: "role-not-applicable" })
  })

  it("rejects a role that does not belong to the stage", () => {
    expect(resolveDelegationTarget("DECIDE", "DESIGN")).toEqual({
      ok: false,
      reason: "invalid-role",
      message: 'Invalid role "DESIGN" for stage DECIDE. Allowed roles: PROPOSE, ASSESS',
    })
    expect(resolveDelegationTarget("PLAN", "ASSESS")).toEqual({
      ok: false,
      reason: "invalid-role",
      message: 'Invalid role "ASSESS" for stage PLAN. Allowed roles: QA-PLAN, DESIGN',
    })
  })

  it("normalizes case and surrounding whitespace", () => {
    expect(resolveDelegationTarget(" decide ", " assess ")).toEqual({ ok: true, stage: "DECIDE", role: "ASSESS", phase: "ASSESS" })
    expect(resolveDelegationTarget("build", "")).toEqual({ ok: true, stage: "BUILD", role: null, phase: "IMPLEMENT" })
  })

  it("treats an empty role as absent", () => {
    expect(resolveDelegationTarget("BUILD", "   ")).toMatchObject({ ok: true, role: null })
    expect(resolveDelegationTarget("DECIDE", "")).toMatchObject({ ok: false, reason: "role-required" })
  })

  it("knows the stage-terminal roles", () => {
    expect(isStageTerminalRole("DECIDE", "ASSESS")).toBe(true)
    expect(isStageTerminalRole("PLAN", "DESIGN")).toBe(true)
    expect(isStageTerminalRole("DECIDE", "PROPOSE")).toBe(false)
    expect(isStageTerminalRole("PLAN", "QA-PLAN")).toBe(false)
    expect(isStageTerminalRole("BUILD", null)).toBe(false)
  })

  it("keeps the phase-to-stage map aligned with the canonical stages", () => {
    for (const role of DELEGATION_ROLES) {
      expect(DELEGATION_STAGES).toContain(PHASE_STAGE[role])
    }
    expect(PHASE_STAGE).toEqual({
      PROPOSE: "DECIDE",
      ASSESS: "DECIDE",
      "QA-PLAN": "PLAN",
      DESIGN: "PLAN",
      IMPLEMENT: "BUILD",
      VERIFY: "VERIFY",
      EXPLORE: "EXPLORE",
      FIX: "FIX",
    })
  })
})
