import { describe, expect, it } from "vitest"
import {
  ODF_RESULT_CONTRACT_PROMPT,
  ODF_RESULT_REQUIRED_FIELDS,
  ODF_RESULT_SCHEMA,
  classifyODFStop,
  resultStopDisposition,
  validateODFResult,
} from "./odf-result-contract.js"

const validResult = {
  status: "ok",
  executive_summary: "Phase completed",
  strategy: "custom",
  artifacts_saved: [],
  next_recommended: [],
  odoo_version: 18,
  modules_affected: [],
  skill_resolution: "injected",
}

describe("shared ODF Result contract", () => {
  it("keeps required fields aligned with the runtime schema and delegated prompt", () => {
    const schemaFields = Object.keys(ODF_RESULT_SCHEMA.shape)
    for (const field of ODF_RESULT_REQUIRED_FIELDS) {
      expect(schemaFields).toContain(field)
      expect(ODF_RESULT_CONTRACT_PROMPT).toContain(`**${field}**`)
    }
    expect(ODF_RESULT_CONTRACT_PROMPT).toContain("ok | warning | blocked | failed")
    expect(ODF_RESULT_CONTRACT_PROMPT).toContain("stop_disposition")
    expect(ODF_RESULT_CONTRACT_PROMPT).toContain("unclassified")
    expect(ODF_RESULT_CONTRACT_PROMPT).toContain("`reason` (a non-empty string up to 500 characters; short kebab-case code identifying the stop)")
    expect(ODF_RESULT_CONTRACT_PROMPT).toContain("`next_action` (a non-empty string up to 500 characters describing the next safe action)")
  })

  it("accepts valid phase extensions and rejects malformed common fields", () => {
    expect(validateODFResult({ ...validResult, design_closed: true })).toMatchObject({
      ...validResult,
      design_closed: true,
    })
    expect(() => validateODFResult({ ...validResult, skill_resolution: "unknown" })).toThrow(/skill_resolution/)
    expect(() => validateODFResult({
      ...validResult,
      artifacts_saved: [{ name: "design" }],
    })).toThrow(/artifact_ref/)
    expect(() => validateODFResult({
      ...validResult,
      status: "blocked",
      stop_disposition: { kind: "repairable" },
    })).toThrow(/stop_disposition/)
  })

  it("classifies repairable, human, dependency, safety, terminal, and unknown stops conservatively", () => {
    expect(classifyODFStop("workflow-implement-progress-not-terminal")).toMatchObject({
      kind: "repairable",
      user_action_required: false,
      automatic_recovery: "repair-in-phase",
    })
    expect(classifyODFStop("workflow-receipt-pending")).toMatchObject({
      kind: "human-decision",
      user_action_required: true,
      automatic_recovery: "none",
    })
    expect(classifyODFStop("task-api-unavailable")).toMatchObject({
      kind: "dependency",
      user_action_required: true,
      automatic_recovery: "wait",
    })
    expect(classifyODFStop("unsafe-workspace-path")).toMatchObject({
      kind: "safety",
      user_action_required: true,
      automatic_recovery: "none",
    })
    expect(classifyODFStop("task-error")).toMatchObject({
      kind: "terminal",
      user_action_required: true,
      automatic_recovery: "none",
    })
    expect(classifyODFStop("future-reason")).toMatchObject({
      kind: "unclassified",
      user_action_required: true,
      automatic_recovery: "none",
    })
  })

  it("rejects malformed and unsafe recovery claims from an inner result", () => {
    expect(resultStopDisposition({ status: "blocked", reason: "future-reason" })).toMatchObject({
      kind: "unclassified",
      user_action_required: true,
      automatic_recovery: "none",
    })
    expect(resultStopDisposition({
      status: "blocked",
      reason: "unsafe-workspace-path",
      stop_disposition: {
        kind: "repairable",
        user_action_required: false,
        automatic_recovery: "repair-in-phase",
        reason: "retry anyway",
        next_action: "Retry without asking",
      },
    })).toMatchObject({
      kind: "safety",
      user_action_required: true,
      automatic_recovery: "none",
    })
    expect(resultStopDisposition({
      status: "blocked",
      reason: "workflow-implement-progress-not-terminal",
      stop_disposition: {
        kind: "human-decision",
        user_action_required: true,
        automatic_recovery: "none",
        reason: "Scope may have changed",
        next_action: "Confirm scope",
      },
    })).toMatchObject({
      kind: "human-decision",
      user_action_required: true,
      automatic_recovery: "none",
    })
    expect(resultStopDisposition({
      status: "blocked",
      reason: "workflow-implement-progress-not-terminal",
      stop_disposition: { kind: "repairable" },
    })).toMatchObject({
      kind: "repairable",
      user_action_required: false,
      automatic_recovery: "repair-in-phase",
    })
    expect(resultStopDisposition({ status: "ok", reason: "unsafe-workspace-path" })).toBeNull()
  })
})
