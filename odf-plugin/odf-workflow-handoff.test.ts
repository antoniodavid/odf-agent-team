import { describe, expect, it } from "vitest"
import { deriveWorkflowStatus } from "./odf-workflow-status.js"
import { validateCanonicalWorkflowHandoff } from "./odf-artifact-contract.js"

const state = {
  work_type: "feature",
  artifact_store: "openspec",
  canonical_stage: "PLAN",
  completed_canonical_stages: ["DECIDE"],
}

describe("canonical workflow handoff", () => {
  it("projects a validated handoff from persisted state and actual artifact refs", () => {
    const status = deriveWorkflowStatus({
      change: "typed-handoff",
      state,
      artifacts: { "decision.md": { status: "success" } },
      source: { state: "openspec", artifacts: ["state.yaml", "decision.md"] },
    })

    expect(status.next_handoff).toEqual({
      schema_version: 1,
      change: "typed-handoff",
      work_type: "feature",
      artifact_store: "openspec",
      from_stage: "DECIDE",
      to_stage: "PLAN",
      artifacts: [{
        stage: "DECIDE",
        name: "decision",
        artifact_ref: { store: "openspec", ref: "decision.md" },
      }],
      shared_artifacts: [],
      required_gates: ["safety", "receipt-clear"],
    })
    expect(validateCanonicalWorkflowHandoff(status.next_handoff)).toBe(true)
  })

  it("does not synthesize a handoff when the completed stage has no persisted artifact", () => {
    const status = deriveWorkflowStatus({
      change: "typed-handoff",
      state,
      artifacts: {},
      source: { state: "openspec", artifacts: ["state.yaml"] },
    })

    expect(status.next_handoff).toBeNull()
    expect(status.warnings).toContain(
      "Canonical handoff to PLAN is unavailable: the selected store or required previous-stage artifact references could not be validated.",
    )
  })

  it("does not hand off invalidated artifacts from before a re-entry boundary", () => {
    const status = deriveWorkflowStatus({
      change: "typed-handoff",
      state: {
        ...state,
        artifact_invalidation: { version: 1, from_stage: "DECIDE", invalidated_at: "2026-10-01T00:00:00.000Z" },
      },
      artifacts: { "decision.md": { status: "success", created_at: "2026-09-30T23:59:59.000Z" } },
      source: { state: "openspec", artifacts: ["state.yaml", "decision.md"] },
    })

    expect(status.artifact_refs.DECIDE).toEqual([])
    expect(status.next_handoff).toBeNull()
  })

  it("rejects mismatched store, route order, and artifact stage references", () => {
    const status = deriveWorkflowStatus({
      change: "typed-handoff",
      state,
      artifacts: { "decision.md": { status: "success" } },
      source: { state: "openspec", artifacts: ["state.yaml", "decision.md"] },
    })
    const handoff = status.next_handoff!

    expect(validateCanonicalWorkflowHandoff({ ...handoff, artifact_store: "engram" })).toBe(false)
    expect(validateCanonicalWorkflowHandoff({ ...handoff, to_stage: "BUILD" })).toBe(false)
    expect(validateCanonicalWorkflowHandoff({ ...handoff, work_type: "question" })).toBe(false)
    expect(validateCanonicalWorkflowHandoff({ ...handoff, required_gates: ["safety"] })).toBe(false)
    expect(validateCanonicalWorkflowHandoff({
      ...handoff,
      artifacts: [{ ...handoff.artifacts[0]!, stage: "PLAN" }],
    })).toBe(false)
  })

  it("does not produce a handoff while a receipt is pending", () => {
    const status = deriveWorkflowStatus({
      change: "typed-handoff",
      state,
      artifacts: { "decision.md": { status: "success" } },
      receipt: { status: "pending" },
      source: { state: "openspec", artifacts: ["state.yaml", "decision.md"] },
    })

    expect(status.resumable).toBe(false)
    expect(status.next_handoff).toBeNull()
  })

  it("carries approved Expectations refs as shared context without reclassifying them as a stage artifact", () => {
    const status = deriveWorkflowStatus({
      change: "typed-handoff",
      state,
      artifacts: {
        "decision.md": { status: "success" },
        "expectations.yaml": { status: "approved" },
      },
      source: { state: "openspec", artifacts: ["state.yaml", "decision.md", "expectations.yaml"] },
    })

    expect(status.next_handoff?.shared_artifacts).toEqual([{
      stage: "SHARED",
      name: "expectations",
      artifact_ref: { store: "openspec", ref: "expectations.yaml" },
    }])
    expect(status.next_handoff?.artifacts).toHaveLength(1)
  })

  it("always carries policy and validation gates into BUILD and VERIFY handoffs", () => {
    const status = deriveWorkflowStatus({
      change: "typed-handoff",
      state: {
        ...state,
        canonical_stage: "BUILD",
        completed_canonical_stages: ["DECIDE", "PLAN"],
      },
      artifacts: {
        "decision.md": { status: "success" },
        "plan.md": { status: "success" },
      },
      source: { state: "openspec", artifacts: ["state.yaml", "decision.md", "plan.md"] },
    })

    expect(status.next_handoff?.to_stage).toBe("BUILD")
    expect(status.next_handoff?.required_gates).toEqual([
      "safety", "receipt-clear", "policy-gate", "validation-evidence",
    ])
  })
})
