import { describe, expect, it } from "vitest"
import {
  LEARNING_SCHEMA_VERSION,
  isVerifiedRun,
  consolidateMemory,
  proposeSkillCandidate,
  runGoldenRegression,
  approveCandidates,
  rollbackCandidate,
  buildPlan,
} from "./odf-learning.js"

const DIGEST = "a".repeat(64)
const OTHER_DIGEST = "b".repeat(64)

function verifiedRun(overrides = {}) {
  return {
    candidate_digest: DIGEST,
    receipt_ref: { status: "success", candidate_digest: DIGEST, receipt_id: "R-1" },
    expectations: [{ id: "EXP-01", approved: true }],
    outcome: "pass",
    work_type: "feature",
    tool_call_count: 8,
    ...overrides,
  }
}

const GOLDENS = [
  { id: "golden-stale-evidence", work_type: "feature", risk: "high", expectation: "EXP-02", trajectory: [{ step: "IMPLEMENT", tool: "odf_delegate", ok: true }, { step: "VERIFY", tool: "receipt_stale", ok: false }], outcome: "fail", golden: true, protects: "VERIFY con receipt/evidencia vieja debe fallar" },
]

describe("odf learning loop", () => {
  it("admits-only-verified-runs", () => {
    expect(isVerifiedRun(verifiedRun())).toBe(true)
    expect(isVerifiedRun(verifiedRun({ receipt_ref: null }))).toBe(false)
    expect(isVerifiedRun(verifiedRun({ candidate_digest: undefined }))).toBe(false)
    expect(isVerifiedRun(verifiedRun({ candidate_digest: "not-a-digest" }))).toBe(false)
    expect(isVerifiedRun(verifiedRun({ expectations: [{ id: "EXP-01", approved: false }] }))).toBe(false)
    expect(isVerifiedRun(verifiedRun({ expectations: [] }))).toBe(false)
    expect(isVerifiedRun(verifiedRun({ outcome: "unknown" }))).toBe(false)
    expect(isVerifiedRun(verifiedRun({ receipt_ref: { status: "failed" } }))).toBe(false)
    expect(isVerifiedRun(null)).toBe(false)
  })

  it("no-verified-runs-no-data", () => {
    const empty = consolidateMemory([])
    expect(empty.data_status).toBe("no_data")
    expect(empty.candidates).toEqual([])
    const onlyUnverified = consolidateMemory([{ candidate_digest: "x" }])
    expect(onlyUnverified.data_status).toBe("no_data")
    expect(onlyUnverified.candidates).toEqual([])
  })

  it("consolidates-episodic-to-memory", () => {
    const runs = [
      verifiedRun({ topic: "ir.rule", work_type: "feature", candidate_digest: DIGEST }),
      verifiedRun({ topic: "ir.rule", work_type: "feature", candidate_digest: OTHER_DIGEST, receipt_ref: { status: "success", candidate_digest: OTHER_DIGEST, receipt_id: "R-2" }, outcome: "fail" }),
    ]
    const mem = consolidateMemory(runs)
    expect(mem.data_status).toBe("complete")
    expect(mem.candidates).toHaveLength(1)
    expect(mem.candidates[0].source_runs).toEqual([DIGEST, OTHER_DIGEST])
    expect(mem.candidates[0].golden_regression).toBe("pending")
    expect(mem.candidates[0].proposed_for).toBe("human")
    expect(mem.candidates[0].summary).toContain("ir.rule")
    expect(mem.candidates[0].source_runs[0]).toBe(DIGEST)
  })

  it("skill-only-from-difficult-verified-success", () => {
    const hard = proposeSkillCandidate(verifiedRun({ tool_call_count: 8 }))
    expect(hard.proposed).toBe(true)
    expect(hard.golden_regression).toBe("pending")
    expect(hard.proposed_for).toBe("human")

    const easy = proposeSkillCandidate(verifiedRun({ tool_call_count: 2 }))
    expect(easy.proposed).toBe(false)
    expect(easy.reason).toBe("trajectory-not-difficult")

    const hardButFail = proposeSkillCandidate(verifiedRun({ tool_call_count: 8, outcome: "fail" }))
    expect(hardButFail.proposed).toBe(false)
    expect(hardButFail.reason).toBe("outcome-not-success")

    const hardButUnverified = proposeSkillCandidate({ tool_call_count: 8, outcome: "pass" })
    expect(hardButUnverified.proposed).toBe(false)
    expect(hardButUnverified.reason).toBe("run-not-verified")
  })

  it("golden-regression-blocks-conflicting", () => {
    const candidate = { id: "memory-x-abc", source_runs: ["x"], fact: "candidate claims success on guarded defect", evidence_refs: ["e"], golden_regression: "pending", proposed_for: "human", outcome: "pass", golden_refs: ["golden-stale-evidence"] }
    const good = { id: "memory-y-abc", source_runs: ["y"], fact: "candidate feature ok", evidence_refs: ["e"], golden_regression: "pending", proposed_for: "human", outcome: "pass", golden_refs: [] }
    const reg = runGoldenRegression([candidate, good], GOLDENS)
    const byId = Object.fromEntries(reg.results.map((r) => [r.candidate_id, r]))
    expect(byId["memory-x-abc"].status).toBe("failed")
    expect(byId["memory-x-abc"].protects).toEqual([])
    expect(byId["memory-y-abc"].status).toBe("passed")
  })

  it("approval-required", () => {
    const candidates = [
      { id: "a", golden_regression: "passed" },
      { id: "b", golden_regression: "passed" },
    ]
    const approved = approveCandidates(candidates, { approved_ids: ["a"] })
    expect(approved.find((c) => c.id === "a")).toMatchObject({ approved: true, approved_by: "human" })
    expect(approved.find((c) => c.id === "b")).toMatchObject({ approved: false, approved_by: null })
    const none = approveCandidates(candidates, { approved_ids: [] })
    expect(none.every((c) => c.approved === false)).toBe(true)
  })

  it("rollback-preserves-evidence", () => {
    const candidate = {
      id: "a",
      source_runs: [DIGEST],
      evidence_refs: ["R-1"],
      fact: "fact",
      golden_regression: "passed",
      proposed_for: "human",
    }
    const rolled = rollbackCandidate(candidate) as {
      rolled_back: boolean
      rolled_back_at: string
      source_runs: string[]
      evidence_refs: string[]
      preserves_evidence: { source_runs: string[]; evidence_refs: string[] }
    }
    expect(rolled.rolled_back).toBe(true)
    expect(rolled.rolled_back_at).toBeTruthy()
    expect(rolled.source_runs).toEqual([DIGEST])
    expect(rolled.evidence_refs).toEqual(["R-1"])
    expect(rolled.preserves_evidence.source_runs).toEqual([DIGEST])
    expect(rolled.preserves_evidence.evidence_refs).toEqual(["R-1"])
    expect((candidate as { rolled_back?: boolean }).rolled_back).toBeUndefined()
  })

  it("kpi-report", () => {
    const plan = buildPlan([verifiedRun({ tool_call_count: 8 })], GOLDENS)
    expect(plan.kpi).toEqual({
      accepted: 0,
      regressions_avoided: 0,
      rolled_back: 0,
      pending: 2,
    })
  })

  it("schema-versioned", () => {
    expect(LEARNING_SCHEMA_VERSION).toBe(1)
    const plan = buildPlan([], GOLDENS)
    expect(plan.schema_version).toBe(1)
    expect(plan.data_status).toBe("no_data")
  })
})
