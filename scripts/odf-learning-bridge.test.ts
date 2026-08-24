import { describe, expect, it } from "vitest"
import { LEARNING_SCHEMA_VERSION, buildVerifiedRunFromChange, proposeFromArchivedChange } from "./odf-learning-bridge.js"

const DIGEST = "a".repeat(64)

const EXPECTATIONS = { expectations: [{ id: "EXP-01", statement: "El descuento se aplica sobre el total al confirmar" }], approved: true }

const DESIGN_META = { change: "sale-discount-field", work_type: "feature", risk: "low", module_type: "inherit", candidate_digest: DIGEST }

// IMPLEMENT telemetry: 180000ms (3 min) per record = 1 round each under the
// estimator default (minutes_per_round = 3). No `tool` field → derived source.
function implRecords(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    phase: "IMPLEMENT",
    status: "ok",
    duration_ms: 180000,
    agent: "odoo_backend_engineer",
    span_id: `span-${i}`,
  }))
}

function toolRecords(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    phase: "IMPLEMENT",
    status: "ok",
    tool: "odf_delegate",
    span_id: `span-${i}`,
  }))
}

const GOLDENS = [
  { id: "golden-feature-success", work_type: "feature", risk: "low", expectation: "EXP-01", trajectory: [{ step: "IMPLEMENT", tool: "odf_delegate", ok: true }, { step: "VERIFY", tool: "odf_delegate", ok: true }], outcome: "pass", golden: true, protects: "Una feature correcta atraviesa DECIDE->BUILD->VERIFY con todas las delegaciones ok" },
]

describe("odf learning bridge buildVerifiedRunFromChange", () => {
  it("build-run-verified: full input → verified run with derived tool_call_count and tool_call_source", () => {
    const built = buildVerifiedRunFromChange({
      design_meta: DESIGN_META,
      expectations: EXPECTATIONS,
      records: implRecords(6),
      outcome: "pass",
      receipt: { status: "success", candidate_digest: DIGEST, receipt_id: "R-1" },
    })
    expect(built.data_status).toBe("complete")
    expect(built.run).not.toBeNull()
    const run = built.run!
    expect(run.candidate_digest).toBe(DIGEST)
    expect(run.receipt_ref).toMatchObject({ status: "success", candidate_digest: DIGEST, receipt_id: "R-1" })
    expect(run.expectations).toEqual([{ id: "EXP-01", statement: EXPECTATIONS.expectations[0].statement, approved: true }])
    expect(run.outcome).toBe("pass")
    expect(run.work_type).toBe("feature")
    expect(run.topic).toBe("sale-discount-field")
    expect(run.tool_call_count).toBe(6)
    expect(run.tool_call_source).toBe("derived")
    expect(run.design_meta?.change).toBe("sale-discount-field")
  })

  it("tool-calls-actual-from-tool-spans: per-tool records are counted as actual, not derived", () => {
    const built = buildVerifiedRunFromChange({
      design_meta: DESIGN_META,
      expectations: EXPECTATIONS,
      records: toolRecords(7),
      outcome: "pass",
      receipt: { status: "verified", candidate_digest: DIGEST },
    })
    expect(built.run).not.toBeNull()
    const run = built.run!
    expect(run.tool_call_count).toBe(7)
    expect(run.tool_call_source).toBe("actual")
  })

  it("build-run-missing-digest-no-data: no 64-hex digest → run null, no_data, reason", () => {
    const built = buildVerifiedRunFromChange({
      design_meta: { change: "x", work_type: "feature" },
      expectations: EXPECTATIONS,
      records: implRecords(6),
      outcome: "pass",
      receipt: { status: "success" },
    })
    expect(built.run).toBeNull()
    expect(built.data_status).toBe("no_data")
    expect(built.reason).toMatch(/digest/i)
  })

  it("build-run-missing-expectations-no-data: no approved expectations → no_data", () => {
    const built = buildVerifiedRunFromChange({
      design_meta: DESIGN_META,
      expectations: { expectations: [{ id: "EXP-01" }], approved: false },
      records: implRecords(6),
      outcome: "pass",
      receipt: { status: "success", candidate_digest: DIGEST },
    })
    expect(built.run).toBeNull()
    expect(built.data_status).toBe("no_data")
    expect(built.reason).toMatch(/expectations/i)
  })

  it("honest-no-tool-calls: no records → tool_call_source null, never invents a count", () => {
    const built = buildVerifiedRunFromChange({
      design_meta: DESIGN_META,
      expectations: EXPECTATIONS,
      records: null,
      outcome: "pass",
      receipt: { status: "success", candidate_digest: DIGEST },
    })
    expect(built.data_status).toBe("complete")
    expect(built.run).not.toBeNull()
    const run = built.run!
    expect(run.tool_call_count).toBeNull()
    expect(run.tool_call_source).toBeNull()
  })

  it("admission-requires-explicit-success-receipt-status", () => {
    for (const status of [undefined, "", "failed", "blocked", "pending", "arbitrary"]) {
      const built = buildVerifiedRunFromChange({
        design_meta: DESIGN_META,
        expectations: EXPECTATIONS,
        records: implRecords(1),
        outcome: "pass",
        receipt: status === undefined ? undefined : { status, candidate_digest: DIGEST },
      })
      expect(built.run, `status=${status ?? "missing"}`).toBeNull()
      expect(built.data_status).toBe("no_data")
    }

    for (const status of ["success", "verified"]) {
      const built = buildVerifiedRunFromChange({
        design_meta: DESIGN_META,
        expectations: EXPECTATIONS,
        records: [],
        outcome: "pass",
        receipt: { status, candidate_digest: DIGEST },
      })
      expect(built.run, `status=${status}`).not.toBeNull()
      expect(built.data_status).toBe("complete")
    }
  })
})

describe("odf learning bridge proposeFromArchivedChange", () => {
  it("propose-from-archived-change: verified + difficult run proposes a skill, runs golden regression, reports kpi", () => {
    const result = proposeFromArchivedChange({
      design_meta: DESIGN_META,
      expectations: EXPECTATIONS,
      records: implRecords(8),
      goldens: GOLDENS,
      outcome: "pass",
      receipt: { status: "success", candidate_digest: DIGEST, receipt_id: "R-1" },
    })
    expect(result.data_status).toBe("complete")
    expect(result.run_verified).toBe(true)
    expect(result.skill_candidates).toHaveLength(1)
    expect(result.skill_candidates[0].source_run).toBe(DIGEST)
    expect(result.skill_candidates[0].proposed_for).toBe("human")
    expect(result.skill_candidates[0].golden_regression).toBe("pending")
    expect(result.memory_candidates).toHaveLength(1)
    expect(result.golden_regression.data_status).toBe("complete")
    expect(result.kpi.pending).toBe(2)
    expect(result.kpi.regressions_avoided).toBe(0)
  })

  it("propose-not-verified-no-candidates: run without digest → no candidates, run_verified false", () => {
    const result = proposeFromArchivedChange({
      design_meta: { change: "x", work_type: "feature" },
      expectations: EXPECTATIONS,
      records: implRecords(8),
      outcome: "pass",
      receipt: { status: "success" },
    })
    expect(result.run_verified).toBe(false)
    expect(result.data_status).toBe("no_data")
    expect(result.reason).toMatch(/digest/i)
    expect(result.skill_candidates).toEqual([])
    expect(result.memory_candidates).toEqual([])
    expect(result.golden_regression).toEqual({ data_status: "no_data", results: [] })
    expect(result.kpi).toEqual({ accepted: 0, regressions_avoided: 0, rolled_back: 0, pending: 0 })
  })

  it("propose-low-tool-calls-no-skill: verified but easy → memory candidate only, no skill", () => {
    const result = proposeFromArchivedChange({
      design_meta: DESIGN_META,
      expectations: EXPECTATIONS,
      records: implRecords(2),
      goldens: GOLDENS,
      outcome: "pass",
      receipt: { status: "success", candidate_digest: DIGEST },
    })
    expect(result.run_verified).toBe(true)
    expect(result.data_status).toBe("complete")
    expect(result.skill_candidates).toEqual([])
    expect(result.memory_candidates).toHaveLength(1)
    expect(result.kpi.pending).toBe(1)
  })

  it("honest-no-tool-calls-propose: no records → no skill candidate, no invented difficulty", () => {
    const result = proposeFromArchivedChange({
      design_meta: DESIGN_META,
      expectations: EXPECTATIONS,
      records: [],
      goldens: GOLDENS,
      outcome: "pass",
      receipt: { status: "success", candidate_digest: DIGEST },
    })
    expect(result.run_verified).toBe(true)
    expect(result.skill_candidates).toEqual([])
    expect(result.memory_candidates).toHaveLength(1)
  })

  it("schema-versioned: proposal results carry the learning schema version", () => {
    expect(LEARNING_SCHEMA_VERSION).toBe(1)
    const complete = proposeFromArchivedChange({
      design_meta: DESIGN_META,
      expectations: EXPECTATIONS,
      records: implRecords(8),
      goldens: GOLDENS,
      outcome: "pass",
      receipt: { status: "success", candidate_digest: DIGEST },
    })
    expect(complete.schema_version).toBe(1)
    const noData = proposeFromArchivedChange({ design_meta: {} })
    expect(noData.schema_version).toBe(1)
  })
})
