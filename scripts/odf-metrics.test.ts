import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { readDelegationFile, collectDelegations, buildDashboard, renderDashboard } from "./odf-metrics.js"

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
})
