import { describe, expect, it } from "vitest"
import { validateExpectations } from "./odf-expectations.js"

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
})
