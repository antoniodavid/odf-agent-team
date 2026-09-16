import { describe, expect, it } from "vitest"
import {
  EXPECTATIONS_MAX_AUX_ENTRIES,
  EXPECTATIONS_MAX_TEXT_LENGTH,
  validateExpectations,
} from "./odf-expectations.js"

const approved = `change: sale-discount-field
intent: Apply a discount
expectations:
  - id: EXP-01
    statement: Discount applies on confirmation
    testable: true
    owned_by: human
approved: true
approved_by: user
approved_at: 2026-08-17T00:00:00Z
immutable_since: 2026-08-17T00:00:00Z
`

const approvedObject = {
  change: "sale-discount-field",
  intent: "Apply a discount",
  expectations: [{ id: "EXP-01", statement: "Discount applies on confirmation", testable: true, owned_by: "human" as const }],
  approved: true,
  approved_by: "user",
  approved_at: "2026-08-17T00:00:00Z",
  immutable_since: "2026-08-17T00:00:00Z",
}

const extension = {
  constraints: ["Do not change invoice totals."],
  success_scenarios: [{ id: "SUC-01", statement: "A valid discount is applied.", testable: true, owned_by: "human" as const }],
  failure_scenarios: [{ id: "FAL-01", statement: "An invalid discount is rejected.", testable: true, owned_by: "human" as const }],
  connections: [{ id: "CON-01", relation: "supports", reference: "EXP-01" }],
}

describe("validateExpectations", () => {
  it("accepts canonical OpenSpec-shaped content", () => {
    expect(validateExpectations({ change: "sale-discount-field", artifacts: [{ key: "openspec/changes/sale-discount-field/expectations.yaml", content: approved }] })).toEqual({ status: "approved", ids: ["EXP-01"] })
  })

  it("reports a missing artifact for legacy changes", () => {
    expect(validateExpectations({ change: "legacy", artifacts: { propose: "old plan" } })).toEqual({ status: "missing", ids: [] })
  })

  it("rejects an unapproved artifact", () => {
    expect(validateExpectations({ change: "sale-discount-field", artifacts: { "odf/sale-discount-field/expectations": approved.replace("approved: true", "approved: false") } }).status).toBe("invalid")
  })

  it("detects a changed approved statement", () => {
    const changed = approved.replace("Discount applies on confirmation", "Discount applies before confirmation")
    expect(validateExpectations({
      change: "sale-discount-field",
      artifacts: { "odf/sale-discount-field/expectations": changed },
      approvedArtifact: { "odf/sale-discount-field/expectations": approved },
    }).status).toBe("tampered")
  })

  it("accepts the bounded optional human-owned extension", () => {
    expect(validateExpectations({
      change: approvedObject.change,
      artifacts: [{ key: "odf/sale-discount-field/expectations", content: { ...approvedObject, ...extension } }],
    })).toEqual({ status: "approved", ids: ["EXP-01"] })
  })

  it("rejects malformed, duplicate, unsafe, and oversized optional content", () => {
    const candidates = [
      { ...approvedObject, constraints: "not-an-array" },
      { ...approvedObject, constraints: ["same", "same"] },
      { ...approvedObject, success_scenarios: [extension.success_scenarios[0], extension.success_scenarios[0]] },
      { ...approvedObject, success_scenarios: [{ ...extension.success_scenarios[0], id: "SUC-../" }] },
      { ...approvedObject, failure_scenarios: [{ ...extension.failure_scenarios[0], statement: "x".repeat(EXPECTATIONS_MAX_TEXT_LENGTH + 1) }] },
      { ...approvedObject, connections: [{ id: "CON-01", relation: "supports", reference: "../EXP-01" }] },
      { ...approvedObject, connections: [extension.connections[0], extension.connections[0]] },
      { ...approvedObject, connections: Array.from({ length: EXPECTATIONS_MAX_AUX_ENTRIES + 1 }, (_, index) => ({
        id: `CON-${index + 1}`,
        relation: "supports",
        reference: "EXP-01",
      })) },
    ]

    for (const candidate of candidates) {
      expect(validateExpectations({
        change: approvedObject.change,
        artifacts: [{ key: "odf/sale-discount-field/expectations", content: candidate }],
      }).status).toBe("tampered")
    }
  })

  it("protects intent and every optional human field from approved-content tampering", () => {
    const original = { ...approvedObject, ...extension }
    const changed = [
      { ...original, intent: "A different intent" },
      { ...original, constraints: ["A different constraint."] },
      { ...original, success_scenarios: [{ ...extension.success_scenarios[0], statement: "A different success." }] },
      { ...original, failure_scenarios: [{ ...extension.failure_scenarios[0], testable: false }] },
      { ...original, connections: [{ ...extension.connections[0], reference: "EXP-99" }] },
    ]

    for (const candidate of changed) {
      expect(validateExpectations({
        change: approvedObject.change,
        artifacts: [{ key: "odf/sale-discount-field/expectations", content: candidate }],
        approvedArtifact: [{ key: "odf/sale-discount-field/expectations", content: original }],
      }).status).toBe("tampered")
    }
  })
})
