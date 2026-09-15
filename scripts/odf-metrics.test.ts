import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { readDelegationFile, collectDelegations, buildDashboard, renderDashboard, learningProgress, entryToFinalGate } from "./odf-metrics.js"

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
    const records: any[] = [
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
    expect(d.baseline.sample_count).toBe(0)
    expect(d.baseline.duration.p50_ms).toBeNull()
    expect(d.baseline.duration.p95_ms).toBeNull()
    expect(d.baseline.outcomes.rates.ok).toBeNull()
    expect(d.baseline.coverage.validation.task_calls.coverage).toBeNull()
    const out = renderDashboard(d)
    expect(out).not.toContain("100%")
    expect(out).not.toContain("0%")
    expect(out).toContain("Skill resolution rate: N/A injected")
    expect(out).toContain("Errors: 0 (N/A)")
  })

  it("dashboard-partial: legacy lines without the O1 proof expose partial + coverage", () => {
    const d = buildDashboard([
      { agent: "backend", status: "ok", event: "run", lifecycle: "finished", schema_version: 1, run_id: "run-1", change: "change-1", trace_id: "trace-1", span_id: "span-1", model_available: false },
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

  it("excludes spans from delegation totals and measures event-specific coverage", () => {
    const d = buildDashboard([
      { event: "run", lifecycle: "finished", schema_version: 1, run_id: "run-1", change: "change-1", trace_id: "trace-1", span_id: "span-1", agent: "backend", status: "ok" },
      { event: "span", span_kind: "branch", lifecycle: "started", schema_version: 1, trace_id: "trace-1", span_id: "span-task", parent_span_id: "span-1", agent: "branch", branch_id: "backend", attempt_id: "attempt-1" },
      { event: "span", span_kind: "branch", lifecycle: "finished", schema_version: 1, trace_id: "trace-1", span_id: "span-task", parent_span_id: "span-1", agent: "branch", branch_id: "backend", attempt_id: "attempt-1" },
      { event: "span", span_kind: "branch", lifecycle: "finished", schema_version: 1, trace_id: "trace-1", span_id: "span-invalid", parent_span_id: "bad parent", agent: "branch", branch_id: "backend" },
    ], 1)

    expect(d.total).toBe(1)
    expect(d.records_with_telemetry).toBe(1)
    expect(d.span_records).toBe(3)
    expect(d.records_with_span_telemetry).toBe(2)
    expect(d.span_coverage).toBeCloseTo(2 / 3)
    expect(d.branch_records).toBe(3)
    expect(d.records_with_branch_telemetry).toBe(2)
    expect(d.branch_coverage).toBeCloseTo(2 / 3)
    expect(d.telemetry_coverage.runs.coverage).toBe(1)
    expect(d.telemetry_coverage.spans.coverage).toBeCloseTo(2 / 3)
    expect(d.telemetry_coverage.branch.coverage).toBeCloseTo(2 / 3)
  })

  it("accepts an attempt-only sequential task span", () => {
    const d = buildDashboard([
      { event: "span", span_kind: "task", lifecycle: "finished", schema_version: 1, trace_id: "trace-1", span_id: "span-task", parent_span_id: "span-run", agent: "odoo_backend_engineer", attempt_id: "attempt-1" },
    ], 1)

    expect(d.records_with_span_telemetry).toBe(1)
    expect(d.span_coverage).toBe(1)
    expect(d.branch_records).toBe(0)
    expect(d.branch_coverage).toBeNull()
  })

  it("reports honest baseline percentiles and coverage without counting starts or spans", () => {
    const d = buildDashboard([
      { event: "run", lifecycle: "started", run_id: "run-1", agent: "backend", phase: "BUILD", duration_ms: 0 },
      { event: "run", lifecycle: "finished", run_id: "run-1", agent: "backend", phase: "BUILD", duration_ms: 100, status: "ok", work_type: "small-change", model_available: false },
      { event: "run", lifecycle: "finished", run_id: "run-2", agent: "backend", phase: "BUILD", duration_ms: 200, status: "blocked", model_available: false },
      { event: "run", lifecycle: "finished", run_id: "run-3", agent: "backend", phase: "VERIFY", duration_ms: 1000, status: "timeout", model_available: false, receipt_ref: "receipt-1" },
      { event: "span", span_kind: "task", lifecycle: "finished", schema_version: 1, trace_id: "trace-1", span_id: "span-1", parent_span_id: "run-1", duration_ms: 999, status: "ok" },
    ], 1)

    expect(d.baseline.sample_count).toBe(3)
    expect(d.baseline.duration.sample_count).toBe(3)
    expect(d.baseline.duration.p50_ms).toBe(200)
    expect(d.baseline.duration.p95_ms).toBeCloseTo(920)
    expect(d.baseline.outcomes.counts).toMatchObject({ ok: 1, blocked: 1, timeout: 1, error: 0, unknown: 0 })
    expect(d.baseline.outcomes.rates.ok).toBeCloseTo(1 / 3)
    expect(d.baseline.by_phase.BUILD.duration.p50_ms).toBe(150)
    expect(d.baseline.by_phase.VERIFY.duration.p95_ms).toBe(1000)
    expect(d.baseline.coverage.work_type).toMatchObject({ records: 3, reported: 1, unknown: 2 })
    expect(d.baseline.coverage.model).toMatchObject({ records: 3, reported: 3, available: 0, unavailable: 3 })
    expect(d.baseline.coverage.validation.task_calls.coverage).toBe(0)
    expect(d.baseline.coverage.receipt.reported).toBe(1)
    expect(d.baseline.coverage.escalation.coverage).toBe(0)
    expect(d.baseline.coverage.escalation.rate).toBeNull()
    expect(d.baseline.coverage_gaps).toEqual(expect.arrayContaining(["validation_evidence", "escalation", "entry_to_final_gate"]))
  })

  it("computes the complete entry-to-final-gate sequence and boolean escalation coverage", () => {
    const flow = (change: string, base: number, workspace: string, sourceAuthority: boolean, version: number): any[] => [
      { event: "run", lifecycle: "started", run_id: `${change}-propose`, change, flow_stage: "entry_started", timestamp: new Date(base).toISOString(), workspace, source_authority: sourceAuthority, odoo_version: version, status: "ok" },
      { event: "run", lifecycle: "finished", run_id: `${change}-propose`, change, flow_stage: "intent_approved", timestamp: new Date(base + 100).toISOString(), workspace, source_authority: sourceAuthority, odoo_version: version, status: "ok" },
      { event: "run", lifecycle: "started", run_id: `${change}-assess`, change, timestamp: new Date(base + 200).toISOString(), workspace, source_authority: sourceAuthority, odoo_version: version, status: "ok" },
      { event: "run", lifecycle: "finished", run_id: `${change}-assess`, change, flow_stage: "policy_selected", timestamp: new Date(base + 300).toISOString(), workspace, source_authority: sourceAuthority, odoo_version: version, status: "ok", validation_ratio: change === "c1" ? 1 : undefined },
      { event: "run", lifecycle: "started", run_id: `${change}-build`, change, flow_stage: "build_started", timestamp: new Date(base + 400).toISOString(), workspace, source_authority: sourceAuthority, odoo_version: version, status: "ok" },
      { event: "run", lifecycle: "finished", run_id: `${change}-build`, change, timestamp: new Date(base + 500).toISOString(), workspace, source_authority: sourceAuthority, odoo_version: version, status: "ok" },
      { event: "run", lifecycle: "started", run_id: `${change}-verify`, change, flow_stage: "verify_started", timestamp: new Date(base + 600).toISOString(), workspace, source_authority: sourceAuthority, odoo_version: version, status: "ok" },
      { event: "run", lifecycle: "finished", run_id: `${change}-verify`, change, flow_stage: "verified_completed", timestamp: new Date(base + 3_600_000).toISOString(), workspace, source_authority: sourceAuthority, odoo_version: version, status: "ok", receipt_ref: change === "c2" ? "receipt-1" : undefined, escalated: change === "c2" },
    ]
    const d = buildDashboard([
      ...flow("c1", Date.parse("2026-01-01T00:00:00Z"), "repo-a", true, 18),
      ...flow("c2", Date.parse("2026-01-02T00:00:00Z"), "repo-b", false, 19).map(record => ({ ...record, timestamp: new Date(Date.parse(record.timestamp) + 3_600_000).toISOString() })),
    ], 1)
    const gate = d.baseline.entry_to_final_gate
    expect(gate).toMatchObject({ status: "available", sample_count: 2, changes: 2, calls_per_change: 4, verified_completions: 2 })
    expect(gate.p50_ms).toBe(3_600_000)
    expect(gate.p95_ms).toBe(3_600_000)
    expect(gate.verified_completions_per_hour).toBeCloseTo(2 / 24)
    expect(gate.outcomes.counts.ok).toBe(8)
    expect(gate.receipts.reported).toBe(1)
    expect(gate.escalations).toMatchObject({ records: 8, reported: 2, coverage: 0.25, unknown: 6 })
    expect(gate.escalations.rate).toBe(0.5)
    expect(gate.validation.reported).toBe(1)
    expect(gate.by_workspace).toEqual({ "repo-a": 1, "repo-b": 1 })
    expect(gate.by_source_authority).toEqual({ with_source_authority: 1, without_source_authority: 1, unknown: 0 })
    expect(gate.by_odoo_version).toEqual({ "18": 1, "19": 1 })
    expect(gate.cohorts.workspace["repo-a"].p50_ms).toBe(3_600_000)
  })

  it("keeps old JSONL data parseable and unavailable without a complete sequence", () => {
    const d = buildDashboard([
      { agent: "legacy", phase: "VERIFY", status: "ok", duration_ms: 10 },
      { event: "run", lifecycle: "started", run_id: "partial", change: "old", flow_stage: "entry_started", timestamp: "2026-01-01T00:00:00Z", status: "ok" },
    ], 1)
    expect(d.baseline.entry_to_final_gate).toMatchObject({ status: "unavailable", sample_count: 0, p50_ms: null, p95_ms: null })
  })

  it("keeps only the latest complete retry sequence for a change", () => {
    const stages = ["entry_started", "intent_approved", "policy_selected", "build_started", "verify_started", "verified_completed"]
    const sequence = (base: number, retry: string, event: "run" | "span"): any[] => stages.map((stage, index) => ({
      event,
      ...(event === "span" ? { span_kind: "task" } : {}),
      lifecycle: "finished",
      flow_stage: stage,
      change: "retry-change",
      workspace: retry,
      trace_id: `trace-${retry}`,
      span_id: `span-${retry}-${index}`,
      parent_span_id: `parent-${retry}`,
      timestamp: new Date(base + index * 100).toISOString(),
      status: "ok",
    }))

    const gate = entryToFinalGate(([
      ...sequence(Date.parse("2026-01-01T00:00:00Z"), "old", "run"),
      ...sequence(Date.parse("2026-01-01T01:00:00Z"), "latest", "span"),
    ]) as any)

    expect(gate).toMatchObject({ status: "available", sample_count: 1, changes: 1, p50_ms: 500, p95_ms: 500, by_workspace: { latest: 1 } })
  })

  it("discards a candidate when interleaved retries duplicate a bounded stage", () => {
    const stages = ["entry_started", "intent_approved", "policy_selected", "build_started", "verify_started", "verified_completed"]
    const base = Date.parse("2026-01-01T00:00:00Z")
    const record = (flowStage: string, retry: string, index: number): any => ({
      event: "run",
      lifecycle: "finished",
      run_id: `${retry}-${flowStage}-${index}`,
      change: "interleaved-retry",
      flow_stage: flowStage,
      timestamp: new Date(base + index * 100).toISOString(),
      status: "ok",
    })
    const records = [
      record(stages[0], "retry-a", 0),
      record(stages[1], "retry-a", 1),
      record(stages[1], "retry-b", 2),
      ...stages.slice(2).map((stage, index) => record(stage, "retry-a", index + 3)),
    ]

    expect(entryToFinalGate(records)).toMatchObject({ status: "unavailable", sample_count: 0, changes: 0 })
  })

  it("rejects a duplicate entry stage instead of treating it as a new sequence", () => {
    const stages = ["entry_started", "intent_approved", "policy_selected", "build_started", "verify_started", "verified_completed"]
    const base = Date.parse("2026-01-01T00:00:00Z")
    const records: any[] = [
      ...[stages[0], stages[0], ...stages.slice(1)].map((flowStage, index) => ({
        event: "run",
        lifecycle: "finished",
        run_id: `duplicate-entry-${index}`,
        change: "duplicate-entry",
        flow_stage: flowStage,
        timestamp: new Date(base + index * 100).toISOString(),
        status: "ok",
      })),
    ]

    expect(entryToFinalGate(records)).toMatchObject({ status: "unavailable", sample_count: 0, changes: 0 })
  })

  it("uses bounded non-stage records inside the selected window for cohorts", () => {
    const stages = ["entry_started", "intent_approved", "policy_selected", "build_started", "verify_started", "verified_completed"]
    const base = Date.parse("2026-01-01T00:00:00Z")
    const records: any[] = stages.map((flowStage, index) => ({
      event: "span",
      span_kind: "task",
      lifecycle: "finished",
      flow_stage: flowStage,
      change: "bounded-cohort",
      timestamp: new Date(base + index * 100).toISOString(),
      workspace: index === 0 ? "not a workspace" : undefined,
      odoo_version: index === 0 ? 99 : undefined,
      source_authority: false,
      status: "ok",
    }))
    records.push(
      {
        event: "run",
        lifecycle: "finished",
        run_id: "design-in-window",
        change: "bounded-cohort",
        phase: "DESIGN",
        timestamp: new Date(base + 250).toISOString(),
        workspace: "design-repo",
        odoo_version: 18,
        source_authority: true,
        status: "ok",
      },
      {
        event: "run",
        lifecycle: "finished",
        run_id: "outside-before",
        change: "bounded-cohort",
        timestamp: new Date(base - 1).toISOString(),
        workspace: "outside-before",
        odoo_version: 14,
        source_authority: false,
        status: "ok",
      },
      {
        event: "run",
        lifecycle: "finished",
        run_id: "outside-after",
        change: "bounded-cohort",
        timestamp: new Date(base + 501).toISOString(),
        workspace: "outside-after",
        odoo_version: 19,
        source_authority: false,
        status: "ok",
      },
    )

    const gate = entryToFinalGate(records)
    expect(gate.by_workspace).toEqual({ "design-repo": 1 })
    expect(gate.by_odoo_version).toEqual({ "18": 1 })
    expect(gate.by_source_authority).toEqual({ with_source_authority: 1, without_source_authority: 0, unknown: 0 })
    expect(gate.cohorts.workspace).not.toHaveProperty("outside-before")
    expect(gate.cohorts.workspace).not.toHaveProperty("outside-after")
  })

  it("aggregates source-authority cohort values across every stage", () => {
    const stages = ["entry_started", "intent_approved", "policy_selected", "build_started", "verify_started", "verified_completed"]
    const records: any[] = stages.map((stage, index) => ({
      event: "span",
      span_kind: "task",
      lifecycle: "finished",
      flow_stage: stage,
      change: "authority-cohort",
      timestamp: new Date(Date.parse("2026-01-01T00:00:00Z") + index * 100).toISOString(),
      source_authority: index === 0 ? false : index === 3 ? true : undefined,
      status: "ok",
    }))

    const gate = entryToFinalGate(records as any)

    expect(gate.by_source_authority).toEqual({ with_source_authority: 1, without_source_authority: 0, unknown: 0 })
    expect(gate.cohorts.source_authority.true.sample_count).toBe(1)
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
