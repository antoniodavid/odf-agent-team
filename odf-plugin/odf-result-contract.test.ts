import { describe, expect, it } from "vitest"
import {
  ODF_RESULT_CONTRACT_PROMPT,
  ODF_RESULT_REQUIRED_FIELDS,
  ODF_RESULT_SCHEMA,
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
  })
})
