import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { createV2SessionTaskApi, type V2SessionApi } from "../odf-plugin/odf-delegation-health.js"
import { detectNaturalWorkflowEntry } from "../odf-plugin/opencode-v2-adapter.js"
import { advanceWorkflow, resolveWorkflowRoute, type CanonicalStage } from "../odf-plugin/odf-workflow.js"
import { selectActiveChange } from "./lib/orchestrator.js"

describe("issue #122 offline workflow journeys", () => {
  it("carries an explicit exploration follow-up into the gated feature route", () => {
    const intent = detectNaturalWorkflowEntry("Implement the discount approval flow based on our exploration")
    expect(intent).toBe("new")
    expect(resolveWorkflowRoute("feature").stages).toEqual(["DECIDE", "PLAN", "BUILD", "VERIFY"])
  })

  it("routes a bug report through FIX, verified BUILD, and VERIFY", () => {
    expect(detectNaturalWorkflowEntry("Fix the tax rounding bug")).toBe("bugfix")
    const route = resolveWorkflowRoute("bugfix")
    let completed: CanonicalStage[] = []
    const advance = (candidate: CanonicalStage | null, validation: "verified" | "not-required" = "not-required") =>
      advanceWorkflow({
        route,
        completed_stages: completed,
        candidate_stage: candidate,
        phase_result_status: "ok",
        validation_status: validation,
        receipt_state: "none",
        resumable_state: true,
        archived_state: false,
      })

    expect(advance(null).next_stage).toBe("FIX")
    const fix = advance("FIX")
    expect(fix.next_stage).toBe("BUILD")
    completed = fix.completed_stages
    const build = advance("BUILD", "verified")
    expect(build.next_stage).toBe("VERIFY")
    completed = build.completed_stages
    expect(advance("VERIFY", "verified").status).toBe("complete")
  })

  it("resumes a sole active change and refuses a recency tie-break", () => {
    const sole = [{ change: "discount-flow", state: { last_updated: "2026-10-01T10:00:00Z" } }]
    expect(selectActiveChange(sole)).toMatchObject({ change: "discount-flow" })
    const ambiguous = selectActiveChange([
      ...sole,
      { change: "tax-fix", state: { last_updated: "2026-10-02T10:00:00Z" } },
    ])
    expect(ambiguous).toMatchObject({ ambiguous: true })
    expect(ambiguous.candidates).toEqual(expect.arrayContaining(["discount-flow", "tax-fix"]))
  })

  it("keeps ambiguous natural language read-only", () => {
    expect(detectNaturalWorkflowEntry("Maybe improve that after looking around?")).toBeNull()
    expect(detectNaturalWorkflowEntry("continue")).toBeNull()
  })

  it("does not create a replacement child when the active child's wait fails", async () => {
    const session = {
      create: vi.fn(async () => ({ id: "child-1" })),
      get: vi.fn(async () => ({ id: "parent-1" })),
      prompt: vi.fn(async () => undefined),
      wait: vi.fn(async () => { throw new Error("wait timed out") }),
      context: vi.fn(async () => []),
      interrupt: vi.fn(async () => undefined),
    } as unknown as V2SessionApi
    const task = createV2SessionTaskApi({ sessionID: "parent-1", directory: "/workspace" } as never, session)

    await expect(task({ agent: "odoo_backend_engineer", prompt: "run the approved phase" })).rejects.toThrow("session-prompt-error")
    expect(session.create).toHaveBeenCalledTimes(1)
    expect(session.wait).toHaveBeenCalledTimes(1)
  })

  it("stops for user disposition before recovery changes scope", () => {
    const orchestrator = readFileSync(new URL("../agent/odoo_orchestrator.md", import.meta.url), "utf8")
    expect(orchestrator).toContain("When scope, Expectations, work type, or a business decision changes, stop for user disposition.")
    expect(orchestrator).toContain("Require explicit consent for destructive actions; auto-run only verified safe, idempotent recovery.")
  })
})
