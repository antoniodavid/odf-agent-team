import { describe, expect, it, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { evaluateOffline, evaluateOnline, evaluateGoldens, validateGolden, evaluateDecisions, renderDecisionMarkdown, main } from "./odf-evaluation.js"

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
      { agent: "backend", status: "ok", event: "run", lifecycle: "finished", schema_version: 1, run_id: "run-1", change: "change-1", trace_id: "trace-1", span_id: "span-1" },
      { agent: "backend", status: "ok", event: "run", lifecycle: "finished", schema_version: 1, run_id: "run-2", change: "change-2", trace_id: "trace-2", span_id: "span-2" },
      { agent: "backend", status: "error", event: "run", lifecycle: "finished", schema_version: 1, run_id: "run-3", change: "change-3", trace_id: "trace-3", span_id: "span-3" },
    ], 1)
    expect(result).toMatchObject({ mode: "online", data_status: "complete", total: 3, errors: 1 })
    expect(result.error_rate).toBeCloseTo(1 / 3)
    expect(result.score).toBeCloseTo(2 / 3)
  })

  it("online-partial-coverage: mixed T7 + legacy records are partial with coverage, score not 1", () => {
    const result = evaluateOnline([
      { agent: "backend", status: "ok", event: "run", lifecycle: "finished", schema_version: 1, run_id: "run-1", change: "change-1", trace_id: "trace-1", span_id: "span-1", model_available: false },
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

  it("online-day-count: a bare day count is parsed as days, not a file path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odf-eval-days-"))
    temporaryFiles.push(dir)
    await fs.mkdir(path.join(dir, "metrics"), { recursive: true })
    const previous = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = dir
    try {
      expect(main(["online", "14"])).toMatchObject({ mode: "online", data_status: "no_data", score: null })
      expect(() => main(["online", "14", "7"])).toThrow("online accepts a metrics file or a day count")
    } finally {
      if (previous === undefined) delete process.env.ODF_CONFIG_DIR
      else process.env.ODF_CONFIG_DIR = previous
    }
  })

  it("online-lifecycle-start-only: unfinished runs are partial with no score", () => {
    const result = evaluateOnline([
      { event: "run", lifecycle: "started", run_id: "run-stale", status: "ok" },
    ], 1)
    expect(result).toMatchObject({
      mode: "online",
      data_status: "partial",
      total: 0,
      errors: 0,
      score: null,
      started_count: 1,
      unfinished_count: 1,
    })
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

  it("golden-route-order: a trajectory must follow the selected route", () => {
    expect(validateGolden({ ...validGolden, trajectory: [{ step: "BUILD" }, { step: "DECIDE" }] }).valid).toBe(false)
    expect(validateGolden({
      ...validGolden,
      trajectory: [
        { step: "DECIDE PROPOSE" },
        { step: "PLAN DESIGN" },
        { step: "BUILD" },
        { step: "VERIFY" },
      ],
    }).valid).toBe(true)
  })

  it("golden-role: a role must belong to its stage", () => {
    expect(validateGolden({ ...validGolden, trajectory: [{ step: "DECIDE DESIGN" }] }).valid).toBe(false)
    expect(validateGolden({ ...validGolden, trajectory: [{ step: "DECIDE ASSESS" }] }).valid).toBe(true)
    expect(validateGolden({ ...validGolden, trajectory: [{ step: "BUILD DESIGN" }] }).valid).toBe(false)
  })

  it("golden-retry: only -retry may repeat a stage", () => {
    expect(validateGolden({
      ...validGolden,
      trajectory: [{ step: "BUILD" }, { step: "BUILD-retry" }, { step: "VERIFY" }],
    }).valid).toBe(true)
    expect(validateGolden({
      ...validGolden,
      trajectory: [{ step: "BUILD" }, { step: "BUILD" }, { step: "VERIFY" }],
    }).valid).toBe(false)
  })

  it("golden-routes: non-feature routes are valid", () => {
    expect(validateGolden({
      ...validGolden,
      work_type: "small-change",
      risk: "standard",
      trajectory: [{ step: "DECIDE" }, { step: "BUILD" }, { step: "VERIFY" }],
    }).valid).toBe(true)
    expect(validateGolden({
      ...validGolden,
      work_type: "standard-config",
      risk: "low",
      trajectory: [{ step: "DECIDE" }],
    }).valid).toBe(true)
    expect(validateGolden({
      ...validGolden,
      work_type: "verify-only",
      risk: "standard",
      trajectory: [{ step: "VERIFY" }],
    }).valid).toBe(true)
  })

  it("golden-risk: route risk uses low|standard|high", () => {
    expect(validateGolden({ ...validGolden, risk: "standard" }).valid).toBe(true)
    expect(validateGolden({ ...validGolden, risk: "medium" }).valid).toBe(false)
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

describe("odf decision evaluation", () => {
  async function decisionWorkspace() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-decisions-"))
    const config = await fs.mkdtemp(path.join(os.tmpdir(), "odf-decisions-config-"))
    temporaryFiles.push(root, config)
    await fs.mkdir(path.join(root, "openspec", "changes", "alpha"), { recursive: true })
    await fs.mkdir(path.join(root, ".odf"), { recursive: true })
    await fs.mkdir(path.join(config, "metrics"), { recursive: true })
    await fs.writeFile(path.join(root, "openspec", "changes", "alpha", "state.yaml"), [
      "work_type: feature",
      "artifact_store: openspec",
      "canonical_stage: PLAN",
      "completed_canonical_stages:",
      "  - DECIDE",
      "  - PLAN",
      "route:",
      "  stages:",
      "    - DECIDE",
      "    - PLAN",
      "    - BUILD",
      "    - VERIFY",
      "  plan: required",
      "  verification: required",
      "entry_route_binding:",
      "  predicted_route: small-change",
      "  predicted_stages:",
      "    - DECIDE",
      "    - BUILD",
      "    - VERIFY",
      "",
    ].join("\n"), "utf8")
    await fs.writeFile(path.join(root, ".odf", "policy-gate-alpha.json"), JSON.stringify({
      stage: "BUILD", risk_tier: "MEDIUM", changed_lines: 120, correction_budget_lines: 60,
    }), "utf8")
    await fs.writeFile(path.join(root, ".odf", "receipt-alpha.json"), JSON.stringify({
      stage: "BUILD", role: null, status: "blocked", cause: "validation-failed", action: null,
    }), "utf8")
    await fs.writeFile(path.join(root, ".odf", "attempt-ledger-alpha.jsonl"), [
      JSON.stringify({ attempt_id: "a1", change: "alpha", stage: "BUILD", status: "failed", result_status: "validation-failed" }),
      JSON.stringify({ attempt_id: "a2", change: "alpha", stage: "BUILD", status: "completed", result_status: "delegated" }),
      "",
    ].join("\n"), "utf8")
    await fs.writeFile(path.join(root, ".odf", "override-alpha.jsonl"), JSON.stringify({ action: "settle-attempt" }) + "\n", "utf8")
    const day = new Date().toISOString().slice(0, 10)
    await fs.writeFile(path.join(config, "metrics", `delegations-${day}.jsonl`), [
      JSON.stringify({ timestamp: new Date().toISOString(), change: "alpha", stage: "BUILD", status: "ok", duration_ms: 1000, event: "run", lifecycle: "finished", agent: "backend" }),
      JSON.stringify({ timestamp: new Date().toISOString(), change: "alpha", stage: "VERIFY", status: "ok", duration_ms: 500, event: "run", lifecycle: "finished", agent: "qa" }),
      "",
    ].join("\n"), "utf8")
    return { root, config }
  }

  it("decisions-empty-no-data: an empty workspace is no_data, never a perfect score", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-decisions-empty-"))
    temporaryFiles.push(root)
    const report = evaluateDecisions({ root })
    expect(report).toMatchObject({ mode: "decisions", data_status: "no_data", total: 0, changes: [] })
    expect(report.warnings.length).toBeGreaterThan(0)
  })

  it("decisions-change: joins state, gate, receipt, ledger, overrides, and metrics", async () => {
    const { root, config } = await decisionWorkspace()
    const previous = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = config
    try {
      const report = evaluateDecisions({ root, days: 30 })
      expect(report).toMatchObject({
        mode: "decisions",
        data_status: "complete",
        total: 1,
      })
      expect(report.changes[0]).toMatchObject({
        change: "alpha",
        work_type: "feature",
        risk_tier: "MEDIUM",
        plan_mode: "required",
        predicted_route: "small-change",
        route_agreement: false,
        failed_attempts: 1,
        rework_count: 1,
        first_pass: false,
        override_count: 1,
        archived: false,
      })
      expect(report.changes[0].receipts).toHaveLength(1)
      expect(report.changes[0].stage_activity.BUILD).toMatchObject({ calls: 1, ok: 1, duration_ms: 1000 })
      expect(report.aggregate).toMatchObject({
        route_agreement: { compared: 1, agreed: 0, rate: 0 },
        first_pass: { count: 0, rate: 0 },
        rework: { changes: 1, rate: 1 },
        receipts: { count: 1 },
        overrides: 1,
        risk_tiers: { MEDIUM: 1 },
        plan_modes: { required: 1 },
      })
    } finally {
      if (previous === undefined) delete process.env.ODF_CONFIG_DIR
      else process.env.ODF_CONFIG_DIR = previous
    }
  })

  it("decisions-markdown: renders aggregate and per-change rows", async () => {
    const { root, config } = await decisionWorkspace()
    const previous = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = config
    try {
      const markdown = renderDecisionMarkdown(evaluateDecisions({ root, days: 30 }))
      expect(markdown).toContain("# Decision evaluation")
      expect(markdown).toContain("| Route agreement | 0/1 (0%) |")
      expect(markdown).toContain("| alpha | feature | MEDIUM | required | no | 1 | no |")
    } finally {
      if (previous === undefined) delete process.env.ODF_CONFIG_DIR
      else process.env.ODF_CONFIG_DIR = previous
    }
  })

  it("decisions-cli: --root and --md are parsed without reading a file named after a flag", async () => {
    const { root, config } = await decisionWorkspace()
    const previous = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = config
    try {
      expect(main(["decisions", "--root", root, "--days", "30"])).toMatchObject({ mode: "decisions", total: 1 })
      expect(main(["decisions", "--root", root, "--md"])).toContain("# Decision evaluation")
    } finally {
      if (previous === undefined) delete process.env.ODF_CONFIG_DIR
      else process.env.ODF_CONFIG_DIR = previous
    }
  })
})
