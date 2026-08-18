import { describe, expect, it, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { evaluateShadow, compareHumanJudge, recordShadowJudgment, appendShadowJudgment } from "./odf-judge.js"

let temporaryFiles: string[] = []

afterEach(async () => {
  await Promise.all(temporaryFiles.map(file => fs.rm(file, { recursive: true, force: true })))
  temporaryFiles = []
})

describe("odf shadow judge", () => {
  it("shadow-no-provider-unavailable: no ODF_JUDGE_MODEL -> unavailable, N/A, no verdict synthesized", () => {
    delete process.env.ODF_JUDGE_MODEL
    delete process.env.ODF_JUDGE_PROVIDER
    const result = evaluateShadow({ expectations: [{ id: "EXP-01" }], candidate_digest: "abc" })
    expect(result.verdict).toBe("unavailable")
    expect(result.verdict_label).toBe("N/A")
    expect(result.data_status).toBe("no_data")
    expect(result.rationale).toBeNull()
    expect(["pass", "fail"]).not.toContain(result.verdict)
  })

  it("shadow-versioned: output carries schema_version and judge_version", () => {
    delete process.env.ODF_JUDGE_MODEL
    expect(evaluateShadow({})).toMatchObject({
      mode: "shadow",
      schema_version: 1,
      judge_version: { rubric_version: 1, model: null, provider: null },
    })
  })

  it("shadow-bound: expectations/digest/trace reflected in bound_to", () => {
    delete process.env.ODF_JUDGE_MODEL
    const result = evaluateShadow({
      expectations: [{ id: "EXP-01" }, { id: "EXP-02" }, "EXP-03"],
      candidate_digest: "digest-1",
      trace_ref: "trace-42",
    })
    expect(result.bound_to).toEqual({
      expectation_ids: ["EXP-01", "EXP-02", "EXP-03"],
      candidate_digest: "digest-1",
      trace_ref: "trace-42",
    })
  })
})

describe("odf judge comparison", () => {
  it("compare-human-judge-agreement: pass/pass agreement true, no false pass/block", () => {
    expect(compareHumanJudge({ human: "pass", judge: "pass" })).toEqual({
      agreement: true,
      false_pass: false,
      false_block: false,
      unavailable: false,
    })
  })

  it("compare-false-pass: human fail + judge pass -> false_pass true", () => {
    const c = compareHumanJudge({ human: "fail", judge: "pass" })
    expect(c.agreement).toBe(false)
    expect(c.false_pass).toBe(true)
    expect(c.false_block).toBe(false)
  })

  it("compare-false-block: human pass + judge fail -> false_block true", () => {
    const c = compareHumanJudge({ human: "pass", judge: "fail" })
    expect(c.agreement).toBe(false)
    expect(c.false_block).toBe(true)
    expect(c.false_pass).toBe(false)
  })

  it("compare-unavailable: judge unavailable -> agreement null, unavailable true", () => {
    expect(compareHumanJudge({ human: "pass", judge: "unavailable" })).toEqual({
      agreement: null,
      false_pass: false,
      false_block: false,
      unavailable: true,
    })
  })

  it("compare-disagreement: pass vs fail -> agreement false", () => {
    expect(compareHumanJudge({ human: "pass", judge: "fail" }).agreement).toBe(false)
    expect(compareHumanJudge({ human: "fail", judge: "pass" }).agreement).toBe(false)
  })
})

describe("odf shadow judgment persistence", () => {
  it("append-shadow-judgment: writes a valid JSONL line", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odf-judge-"))
    temporaryFiles.push(dir)
    const file = path.join(dir, "shadow.jsonl")
    appendShadowJudgment(file, { human: "pass", judge: "unavailable", candidate_digest: "abc" })
    const lines = (await fs.readFile(file, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed).toMatchObject({ schema_version: 1, human: "pass", judge: "unavailable" })
    expect(parsed.judge_version.model).toBeNull()
  })

  it("record-shadow-judgment: absent telemetry fields are null (T7 consistency)", () => {
    const entry = recordShadowJudgment({ verdict: "unavailable" })
    expect(entry.judge_version).toEqual({ rubric_version: 1, model: null, provider: null })
  })
})
