import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { readDelegationFile, collectDelegations, buildDashboard, renderDashboard, learningProgress } from "./odf-metrics.js"

const now = new Date()

describe("readDelegationFile", () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-metrics-"))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("parses valid JSONL lines", async () => {
    const file = path.join(tmp, "delegations-2026-07-31.jsonl")
    await fs.writeFile(file, '{"agent":"odoo_backend_engineer","status":"ok"}\n{"agent":"odoo_qa_engineer","status":"ok"}\n')
    expect(readDelegationFile(file)).toHaveLength(2)
  })

  it("skips malformed lines without failing", async () => {
    const file = path.join(tmp, "delegations-2026-07-31.jsonl")
    await fs.writeFile(file, '{"agent":"ok"}\nnot-json\n{"agent":"also-ok"}\n')
    const rows = readDelegationFile(file)
    expect(rows).toHaveLength(2)
  })

  it("returns empty for a missing file", () => {
    expect(readDelegationFile(path.join(tmp, "nope.jsonl"))).toEqual([])
  })
})

describe("collectDelegations", () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-metrics-"))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("filters files outside the days window by UTC date", async () => {
    const oldDay = new Date(now.getTime() - 10 * 24 * 3600 * 1000).toISOString().split("T")[0]
    const today = now.toISOString().split("T")[0]
    await fs.writeFile(path.join(tmp, `delegations-${oldDay}.jsonl`), '{"agent":"old"}\n')
    await fs.writeFile(path.join(tmp, `delegations-${today}.jsonl`), '{"agent":"new"}\n')
    const rows = collectDelegations(tmp, 1)
    expect(rows).toEqual([{ agent: "new" }])
  })

  it("returns empty when the metrics dir does not exist", () => {
    expect(collectDelegations(path.join(tmp, "missing"), 1)).toEqual([])
  })
})

describe("buildDashboard + render", () => {
  it("aggregates counts, durations, tokens, and errors", () => {
    const records = [
      { agent: "odoo_backend_engineer", duration_ms: 2000, token_estimate: 400, skill_resolution: "injected", skills_injected: ["odf-implement"], status: "ok" },
      { agent: "odoo_backend_engineer", duration_ms: 4000, token_estimate: 600, skill_resolution: "injected", skills_injected: ["odf-implement"], status: "ok" },
      { agent: "odoo_qa_engineer", duration_ms: 1000, token_estimate: 100, skill_resolution: "none", skills_injected: [], status: "error", error: "boom" },
    ]
    const d = buildDashboard(records, 1)
    expect(d.total).toBe(3)
    expect(d.avgDurationMs).toBeCloseTo(2333, -1)
    expect(d.avgTokens).toBeCloseTo(367, -1)
    expect(d.selfDiscoveredPct).toBe(33)
    expect(d.errorsCount).toBe(1)
    expect(d.agentRows).toHaveLength(2)
    expect(d.skillRows[0]).toContain("odf-implement")
    expect(d.errorRows[0]).toContain("boom")
  })

  it("renders an empty state without crashing", () => {
    const d = buildDashboard([], 1)
    const out = renderDashboard(d)
    expect(out).toContain("Total delegations: 0")
    expect(out).toContain("(no delegations)")
  })

  it("renders numbers for the overall block", () => {
    const d = buildDashboard([{ agent: "a", duration_ms: 1000, token_estimate: 250, skill_resolution: "injected", skills_injected: ["s"], status: "ok" }], 1)
    const out = renderDashboard(d)
    expect(out).toContain("Total delegations: 1")
    expect(out).toContain("Avg duration: 1s")
  })

  it("dashboard-no-data: zero lines give N/A percentages, no 100%, data_status no_data", () => {
    const d = buildDashboard([], 1)
    expect(d.total).toBe(0)
    expect(d.data_status).toBe("no_data")
    expect(d.selfDiscoveredPct).toBeNull()
    expect(d.skillInjectionPct).toBeNull()
    expect(d.errorPct).toBeNull()
    expect(d.selfDiscoveredPctLabel).toBe("N/A")
    expect(d.skillInjectionPctLabel).toBe("N/A")
    expect(d.errorPctLabel).toBe("N/A")
    expect(d.coverage).toBeNull()
    const out = renderDashboard(d)
    expect(out).not.toContain("100%")
    expect(out).not.toContain("0%")
    expect(out).toContain("Skill resolution rate: N/A injected")
    expect(out).toContain("Errors: 0 (N/A)")
  })

  it("dashboard-partial: legacy lines without the O1 proof expose partial + coverage", () => {
    const d = buildDashboard([
      { agent: "backend", status: "ok", event: "run", lifecycle: "finished", schema_version: 1, run_id: "run-1", change: "change-1", model_available: false },
      { agent: "backend", status: "ok" },
      { agent: "backend", status: "error" },
    ], 1)
    expect(d.data_status).toBe("partial")
    expect(d.coverage).toBeCloseTo(1 / 3)
    expect(d.records_with_telemetry).toBe(1)
  })

  it("aggregates bounded work, branch, and join fields while reading legacy records", () => {
    const d = buildDashboard([
      { agent: "backend", duration_ms: 1000, token_estimate: 100, skill_resolution: "injected", skills_injected: [], status: "ok", work_type: "cross-domain", branch_id: "backend" },
      { agent: "frontend", duration_ms: 3000, token_estimate: 200, skill_resolution: "injected", skills_injected: [], status: "ok", work_type: "cross-domain", branch_id: "frontend" },
      { agent: "scheduler", duration_ms: 0, token_estimate: 0, skill_resolution: "none", skills_injected: [], status: "blocked", work_type: "cross-domain", join_status: "running", join_expected: 2, join_completed: 0, join_failed: 0, join_running: 2, validation_ratio: 0 },
      { agent: "scheduler", duration_ms: 0, token_estimate: 0, skill_resolution: "none", skills_injected: [], status: "ok", work_type: "cross-domain", join_status: "complete", join_expected: 2, join_completed: 2, join_failed: 0, join_running: 0, validation_ratio: 1 },
      { agent: "legacy", duration_ms: 500, token_estimate: 10, skill_resolution: "injected", skills_injected: ["skill"], status: "ok" },
    ], 1)

    expect(d.total).toBe(3)
    expect(d.workTypeRows).toHaveLength(1)
    expect(d.workTypeRows[0]).toContain("cross-domain")
    expect(d.branchRows).toHaveLength(2)
    expect(d.branchRows[0]).toContain("backend")
    expect(d.branchRows[0]).toContain("1s")
    expect(d.joinRows).toHaveLength(2)
    expect(d.joinRows.join("\n")).toContain("running")
    expect(d.joinRows.join("\n")).toContain("complete")
    expect(d.validationRatio).toBe(0.5)
    expect(renderDashboard(d)).toContain("Scheduler Joins")
  })

  it("counts a lifecycle pair once and excludes its started marker from totals", () => {
    const d = buildDashboard([
      { event: "run", lifecycle: "started", run_id: "run-1", change: "o1", agent: "backend", status: "ok" },
      { event: "run", lifecycle: "finished", run_id: "run-1", change: "o1", agent: "backend", status: "ok" },
      { event: "run", lifecycle: "started", run_id: "run-join", agent: "scheduler", status: "ok", join_status: "running", join_expected: 2, join_completed: 0, join_failed: 0, join_running: 2 },
    ], 1)

    expect(d.total).toBe(1)
    expect(d.agentRows).toHaveLength(1)
    expect(d.startedCount).toBe(1)
    expect(d.unfinishedCount).toBe(0)
  })

  it("reports an unfinished lifecycle start as partial instead of completed data", () => {
    const d = buildDashboard([
      { event: "run", lifecycle: "started", run_id: "run-stale", change: "o1", agent: "backend", status: "ok" },
    ], 1)

    expect(d.total).toBe(0)
    expect(d.data_status).toBe("partial")
    expect(d.unfinishedCount).toBe(1)
    expect(d.unfinishedRunIds).toEqual(["run-stale"])
    expect(renderDashboard(d)).toContain("Unfinished runs: 1")
  })
})

describe("learningProgress (C2)", () => {
  let seq = 0
  // Same bucket key as the estimator: work_type+risk+module_type. models=1,
  // tasks=2, risk low → the estimator predicts 115 rounds for a 100-round design
  // (100 base + 15% integration), i.e. an APE of 0.15.
  function libDesign(rounds_real: number | null, bucket: Record<string, unknown> = { work_type: "feature", risk: "low", module_type: "new" }) {
    seq += 1
    return {
      change: `c${seq}`,
      design_meta: { models: 1, fields: 10, views: 1, tasks: 2, exp_count: 0, manifest_depends: [], module_destination: "test_module", ...bucket },
      rounds_real,
      archived_at: "2026-01-01",
    }
  }

  it("learning-progress-no-library: null/empty gives no_data and N/A mape", () => {
    for (const lib of [null, undefined, {}, { designs: [] }]) {
      const lp = learningProgress(lib)
      expect(lp.data_status).toBe("no_data")
      expect(lp.design_count).toBe(0)
      expect(lp.by_bucket).toEqual([])
      expect(lp.mape.value).toBeNull()
      expect(lp.mape.n).toBe(0)
      expect(lp.mape.sigma).toBeNull()
      expect(lp.mape.label).toBe("N/A")
      expect(lp.reuse_proxy).toBe(0)
    }
  })

  it("learning-progress-one-design: a single design cannot form a MAPE", () => {
    const lp = learningProgress({ schema_version: 1, designs: [libDesign(50)] })
    expect(lp.data_status).toBe("no_data")
    expect(lp.design_count).toBe(1)
    expect(lp.reuse_proxy).toBe(1)
    expect(lp.mape.value).toBeNull()
    expect(lp.mape.label).toBe("N/A")
    expect(lp.by_bucket).toHaveLength(1)
    expect(lp.by_bucket[0]).toMatchObject({ work_type: "feature", risk: "low", module_type: "new", n: 1, avg_rounds_real: 50 })
  })

  it("learning-progress-mape: leave-one-out MAPE over same-bucket designs", () => {
    const lp = learningProgress({ schema_version: 1, designs: [libDesign(100), libDesign(100), libDesign(100)] })
    expect(lp.data_status).toBe("complete")
    expect(lp.design_count).toBe(3)
    expect(lp.reuse_proxy).toBe(3)
    expect(lp.mape.n).toBe(3)
    expect(lp.mape.value).toBeCloseTo(0.15, 4)
    expect(lp.mape.sigma).toBe(0)
    expect(lp.mape.label).toBe("15%")
    expect(lp.by_bucket).toHaveLength(1)
    expect(lp.by_bucket[0].avg_rounds_real).toBe(100)
  })

  it("learning-progress-mixed-buckets: buckets separate and MAPE uses its own bucket", () => {
    const lp = learningProgress({
      schema_version: 1,
      designs: [
        libDesign(100),
        libDesign(100),
        libDesign(100),
        libDesign(50, { work_type: "feature", risk: "high", module_type: "inherit" }),
      ],
    })
    expect(lp.data_status).toBe("complete")
    expect(lp.by_bucket).toHaveLength(2)
    expect(lp.by_bucket[0]).toMatchObject({ work_type: "feature", risk: "low", module_type: "new", n: 3, avg_rounds_real: 100 })
    expect(lp.by_bucket[1]).toMatchObject({ work_type: "feature", risk: "high", module_type: "inherit", n: 1, avg_rounds_real: 50 })
    expect(lp.mape.n).toBe(3)
    expect(lp.mape.value).toBeCloseTo(0.15, 4)
  })

  it("learning-progress-no-rounds: designs without rounds_real give no_data", () => {
    const lp = learningProgress({ schema_version: 1, designs: [libDesign(null), libDesign(null)] })
    expect(lp.data_status).toBe("no_data")
    expect(lp.design_count).toBe(2)
    expect(lp.mape.value).toBeNull()
    expect(lp.mape.label).toBe("N/A")
    expect(lp.by_bucket[0].avg_rounds_real).toBeNull()
  })

  it("render shows the learning section, N/A when no library, MAPE when complete", () => {
    const empty = renderDashboard(buildDashboard([], 1))
    expect(empty).toContain("=== Learning / estimation progress ===")
    expect(empty).toContain("Design library: 0 indexed")
    expect(empty).toContain("MAPE (leave-one-out): N/A")

    const lib = { schema_version: 1, designs: [libDesign(100), libDesign(100), libDesign(100)] }
    const full = renderDashboard(buildDashboard([{ agent: "a", status: "ok" }], 1, lib))
    expect(full).toContain("Design library: 3 indexed")
    expect(full).toContain("MAPE (leave-one-out): 15%")
    expect(full).toContain("n=3, sigma=0")
  })
})
