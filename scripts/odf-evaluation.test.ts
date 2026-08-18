import { describe, expect, it, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { evaluateOffline, evaluateOnline, evaluateGoldens, validateGolden, main } from "./odf-evaluation.js"

let temporaryFiles: string[] = []

afterEach(async () => {
  await Promise.all(temporaryFiles.map(file => fs.rm(file, { recursive: true, force: true })))
  temporaryFiles = []
})

describe("odf evaluation", () => {
  it("evaluates reproducible fixtures without a provider", () => {
    const result = evaluateOffline([
      { name: "ok", record: { status: "ok", agent: "backend" }, expect: { status: "ok", agent: "backend" } },
      { name: "bad", record: { status: "error" }, expect: { status: "ok" } },
    ])
    expect(result).toMatchObject({ mode: "offline", total: 2, passed: 1, failed: 1, score: 0.5 })
  })

  it("evaluates observed metric records using the existing dashboard aggregation", () => {
    expect(evaluateOnline([
      { agent: "backend", status: "ok", duration_ms: 1, token_estimate: 1 },
      { agent: "backend", status: "error", duration_ms: 1, token_estimate: 1 },
    ])).toMatchObject({ mode: "online", total: 2, errors: 1, error_rate: 0.5, score: 0.5 })
  })

  it("loads the CLI module path and evaluates a fixture file", async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "odf-eval-")), "fixture.json")
    temporaryFiles.push(path.dirname(file))
    await fs.writeFile(file, JSON.stringify([{ record: { status: "ok" }, expect: { status: "ok" } }]))
    expect(main(["offline", file])).toMatchObject({ mode: "offline", passed: 1, score: 1, data_status: "complete" })
  })

  it("offline-empty-no-data: empty fixtures yield score null + N/A, never 1", () => {
    const result = evaluateOffline([])
    expect(result).toEqual({
      mode: "offline",
      data_status: "no_data",
      total: 0,
      passed: 0,
      failed: 0,
      score: null,
      score_label: "N/A",
      results: [],
    })
  })

  it("offline-empty-no-data: non-array fixtures also yield no_data", () => {
    const result = evaluateOffline(null as never)
    expect(result).toMatchObject({ data_status: "no_data", score: null, score_label: "N/A", total: 0 })
  })

  it("offline-complete: full fixtures give a normal score and explicit label", () => {
    const result = evaluateOffline([
      { name: "ok", record: { status: "ok" }, expect: { status: "ok" } },
      { name: "ok2", record: { status: "ok" }, expect: { status: "ok" } },
      { name: "bad", record: { status: "error" }, expect: { status: "ok" } },
    ])
    expect(result).toMatchObject({ data_status: "complete", score: 2 / 3, score_label: "2/3" })
  })

  it("online-empty-no-data: no records yield score null + error_rate null + N/A", () => {
    const result = evaluateOnline([], 7)
    expect(result).toEqual({
      mode: "online",
      data_status: "no_data",
      total: 0,
      errors: 0,
      error_rate: null,
      score: null,
      score_label: "N/A",
    })
  })

  it("online-complete: full telemetry records give a normal score", () => {
    const result = evaluateOnline([
      { agent: "backend", status: "ok", event: "complete", schema_version: 2, model_available: true, candidate_digest: "abc" },
      { agent: "backend", status: "ok", event: "complete", schema_version: 2, model_available: true, candidate_digest: "def" },
      { agent: "backend", status: "error", event: "complete", schema_version: 2, model_available: true, candidate_digest: "ghi" },
    ], 1)
    expect(result).toMatchObject({ mode: "online", data_status: "complete", total: 3, errors: 1 })
    expect(result.error_rate).toBeCloseTo(1 / 3)
    expect(result.score).toBeCloseTo(2 / 3)
  })

  it("online-partial-coverage: mixed T7 + legacy records are partial with coverage, score not 1", () => {
    const result = evaluateOnline([
      { agent: "backend", status: "ok", event: "complete", schema_version: 2, model_available: true, candidate_digest: "abc" },
      { agent: "backend", status: "ok" },
      { agent: "backend", status: "error" },
    ], 1)
    expect(result).toMatchObject({
      mode: "online",
      data_status: "partial",
      total: 3,
      errors: 1,
      records_with_telemetry: 1,
    })
    expect(result.error_rate).toBeCloseTo(1 / 3)
    expect(result.score).toBeCloseTo(2 / 3)
    expect(result.coverage).toBeCloseTo(1 / 3)
    expect(result.score).not.toBe(1)
  })
})

describe("odf golden trajectories", () => {
  const validGolden = {
    id: "golden-feature-success",
    work_type: "feature",
    risk: "low",
    expectation: "EXP-01",
    trajectory: [{ step: "VERIFY", tool: "odf_delegate", ok: true }],
    outcome: "pass",
    golden: true,
    protects: "desc",
  }

  it("golden-corpus-present: non-empty corpus yields complete + real score", () => {
    const result = evaluateGoldens([validGolden, validGolden])
    expect(result).toMatchObject({ mode: "golden", data_status: "complete", total: 2, passed: 2, failed: 0, score: 1 })
    expect(result.results).toHaveLength(2)
  })

  it("golden-empty-no-data: empty corpus yields no_data + score null (N/A), never 1", () => {
    const result = evaluateGoldens([])
    expect(result).toEqual({
      mode: "golden",
      data_status: "no_data",
      total: 0,
      passed: 0,
      failed: 0,
      score: null,
      results: [],
    })
  })

  it("golden-empty-no-data: non-array corpus also yields no_data", () => {
    expect(evaluateGoldens(null as never)).toMatchObject({ data_status: "no_data", score: null, total: 0 })
  })

  it("golden-shape-invalid: malformed golden fails with protects/expectation preserved", () => {
    const result = evaluateGoldens([{ id: "bad", work_type: "nope", risk: "ultra", outcome: "maybe" }])
    expect(result).toMatchObject({ mode: "golden", data_status: "complete", total: 1, passed: 0, failed: 1, score: 0 })
    const r = result.results[0]
    expect(r.passed).toBe(false)
    expect(r.problems.some((p: string) => p.includes("work_type"))).toBe(true)
    expect(r.problems.some((p: string) => p.includes("outcome"))).toBe(true)
    expect(r.problems.some((p: string) => p.includes("protects"))).toBe(true)
  })

  it("golden-shape-invariant: outcome must be pass|fail", () => {
    expect(validateGolden({ ...validGolden, outcome: "banana" }).valid).toBe(false)
    expect(validateGolden({ ...validGolden, outcome: "pass" }).valid).toBe(true)
  })

  it("golden-shape-invariant: protects must be non-empty", () => {
    expect(validateGolden({ ...validGolden, protects: "  " }).valid).toBe(false)
    expect(validateGolden({ ...validGolden, protects: "guards multi-company ir.rule" }).valid).toBe(true)
  })

  it("golden-shape-invariant: work_type and risk must be valid", () => {
    expect(validateGolden({ ...validGolden, work_type: "migration", risk: "high" }).valid).toBe(true)
    expect(validateGolden({ ...validGolden, work_type: "not-a-type" }).valid).toBe(false)
    expect(validateGolden({ ...validGolden, risk: "critical" }).valid).toBe(false)
  })

  it("golden-checked-in: the checked-in golden corpus fixture is valid and complete", async () => {
    const file = path.join(process.cwd(), "scripts", "fixtures", "golden-trajectories.json")
    const corpus = JSON.parse(await fs.readFile(file, "utf8"))
    const result = evaluateGoldens(corpus)
    expect(result.data_status).toBe("complete")
    expect(result.total).toBeGreaterThanOrEqual(6)
    expect(result.failed).toBe(0)
  })
})

