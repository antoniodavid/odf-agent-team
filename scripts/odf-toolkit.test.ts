import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { execFileSync } from "node:child_process"
import { asBoolean, buildManualEvidence, evidencePack, loadRegistry, matchSkills, metricsSummary, normalizeResult, resolveAgent, stateBundle } from "./odf-toolkit.js"

describe("odf-toolkit result", () => {
  it("normalizes design_closed as string or boolean and flags missing on DESIGN/PLAN", () => {
    expect(normalizeResult({ status: "ok", design_closed: "true" }, { phase: "DESIGN" })).toMatchObject({ status: "ok", design_closed: true })
    expect(normalizeResult({ status: "ok", design_closed: true }, { phase: "PLAN" })).toMatchObject({ status: "ok", design_closed: true })
    const missing = normalizeResult({ status: "ok" }, { phase: "DESIGN" })
    expect(missing.design_closed).toBe(false)
    expect(missing.warnings.some(w => w.includes("design_closed"))).toBe(true)
    expect(normalizeResult({ status: "ok" }, { phase: "ASSESS" }).warnings).toEqual([])
  })

  it("maps unknown status to error and validates openspec artifact refs on disk", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-result-"))
    try {
      await fs.mkdir(path.join(root, "openspec", "changes", "chg"), { recursive: true })
      await fs.writeFile(path.join(root, "openspec", "changes", "chg", "design.md"), "# d", "utf8")
      const ok = normalizeResult({
        status: "ok",
        artifacts_saved: [{ name: "design", artifact_ref: { store: "openspec", ref: "openspec/changes/chg/design.md" } }],
      }, { root })
      expect(ok.artifacts_saved[0].verified).toBe(true)
      const bad = normalizeResult({ status: "nope", artifacts_saved: ["openspec/changes/chg/missing.md"] }, { root })
      expect(bad.status).toBe("error")
      expect(bad.artifacts_saved[0].verified).toBe(false)
      expect(bad.warnings.some(w => w.includes("not found"))).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("coerces booleans only from true/\"true\"", () => {
    expect(asBoolean(true)).toBe(true)
    expect(asBoolean("True")).toBe(true)
    expect(asBoolean("false")).toBe(false)
    expect(asBoolean(undefined)).toBe(false)
    expect(asBoolean(1)).toBe(false)
  })
})

describe("odf-toolkit resolve", () => {
  it("scores agent resolution and does not route backend prompts to frontend via 'odoo'", () => {
    const registry = {
      agents: [
        { name: "odoo_backend_engineer", installed: true, phases: ["DESIGN", "IMPLEMENT"], description: "Python models, views, security, tests, OCA compliance" },
        { name: "odoo_frontend_engineer", installed: true, phases: ["DESIGN", "IMPLEMENT"], description: "OWL, JS/TS, SCSS, QWeb, all view types" },
      ],
      skills: [],
    }
    expect(resolveAgent(registry, "DESIGN", ["Odoo", "18", "Python", "ORM", "model"])).toBe("odoo_backend_engineer")
    expect(resolveAgent(registry, "DESIGN", ["frontend", "OWL", "assets"])).toBe("odoo_frontend_engineer")
    expect(resolveAgent(registry, "DESIGN", [])).toBe("odoo_backend_engineer")
  })

  it("matchSkills ranks by trigger hits", () => {
    const registry = {
      skills: [
        { name: "owl", triggers: ["OWL", "component", "static/src"] },
        { name: "py", triggers: [".py", "models/"] },
      ],
    }
    expect(matchSkills(registry, "DESIGN", { task: "Design the OWL component", files: ["static/src/x.js"] })).toEqual(["owl"])
  })

  it("loadRegistry reads the configured registry or returns null", () => {
    const registry = loadRegistry()
    expect(registry === null || Array.isArray(registry.agents)).toBe(true)
  })
})

describe("odf-toolkit state", () => {
  it("bundles state, artifacts, and runtime seals read-only", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-state-"))
    try {
      const changeDir = path.join(root, "openspec", "changes", "chg")
      const odfDir = path.join(root, ".odf")
      await fs.mkdir(changeDir, { recursive: true })
      await fs.mkdir(odfDir, { recursive: true })
      await fs.writeFile(path.join(changeDir, "state.yaml"), "work_type: feature\ncanonical_stage: PLAN\n", "utf8")
      await fs.writeFile(path.join(changeDir, "design.md"), "# d", "utf8")
      await fs.writeFile(path.join(odfDir, "receipt-chg.json"), JSON.stringify({ status: "blocked", action: null }))
      const bundle = stateBundle(root, "chg")
      expect(bundle.state).toContain('"canonical_stage":"PLAN"')
      expect(bundle.artifacts.map(a => a.name)).toEqual(["design.md", "state.yaml"])
      expect(bundle.receipt).toMatchObject({ status: "blocked", action: null })
      expect(bundle.policy_gate).toBeNull()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe("odf-toolkit metrics", () => {
  it("aggregates delegation records by phase and status", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "odf-metrics-"))
    const previous = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = configDir
    try {
      await fs.mkdir(path.join(configDir, "metrics"), { recursive: true })
      await fs.writeFile(path.join(configDir, "metrics", "delegations-2026-08-22.jsonl"), [
        JSON.stringify({ phase: "DESIGN", status: "ok", duration_ms: 120_000 }),
        JSON.stringify({ phase: "DESIGN", status: "timeout", duration_ms: 300_000 }),
        JSON.stringify({ phase: "VERIFY", status: "ok", duration_ms: 60_000 }),
      ].join("\n"), "utf8")
      const summary = metricsSummary(1)
      expect(summary.records).toBe(3)
      expect(summary.by_phase.DESIGN).toMatchObject({ calls: 2, ok: 1, timeout: 1 })
      expect(summary.by_phase.DESIGN.avg_duration_ms).toBe(210_000)
      expect(summary.by_phase.VERIFY).toMatchObject({ calls: 1, ok: 1 })
    } finally {
      if (previous === undefined) delete process.env.ODF_CONFIG_DIR
      else process.env.ODF_CONFIG_DIR = previous
      await fs.rm(configDir, { recursive: true, force: true })
    }
  })
})

describe("odf-toolkit manual-evidence", () => {
  it("builds valid VERIFY evidence from a user-run test and reads the policy gate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-manual-"))
    try {
      await fs.mkdir(path.join(root, ".odf"), { recursive: true })
      await fs.writeFile(path.join(root, ".odf", "policy-gate-chg.json"), JSON.stringify({
        risk_tier: "MEDIUM", frozen_diff_ref: "abc123", candidate_digest: "d" + "0".repeat(63),
      }))
      const built = buildManualEvidence({
        change: "chg", command: "odoo-bin -d devel_test -i mod --test-enable --stop-after-init", database: "devel_test",
        output: "12 passed, 0 failed", root,
      })
      expect(built.problems).toEqual([])
      expect(built.evidence.executor).toBe("user-manual")
      expect(built.evidence.candidate_digest).toBe("d" + "0".repeat(63))
      expect(built.evidence.frozen_diff_ref).toBe("abc123")
      expect(built.evidence.commands[0]).toMatchObject({ name: "odoo-tests", database: "devel_test", exit_code: 0 })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("rejects evidence without an explicit -d, a passing pattern, or exit code 0", () => {
    const base = { change: "chg", command: "odoo-bin --test-enable", database: "devel_test", output: "0 failed" }
    expect(buildManualEvidence(base).problems.some(p => p.includes("-d"))).toBe(true)
    expect(buildManualEvidence({ ...base, command: "odoo-bin -d devel_test --test-enable", output: "3 failed" }).problems.some(p => p.includes("0 failed"))).toBe(true)
    expect(buildManualEvidence({ ...base, command: "odoo-bin -d devel_test --test-enable", exitCode: 1 }).problems.some(p => p.includes("exit code"))).toBe(true)
    expect(buildManualEvidence({ ...base, command: "odoo-bin -d devel_test --test-enable" }).problems).toEqual([])
  })
})

describe("odf-toolkit evidence", () => {
  it("packs git head, branch, dirtiness, changed files, and diff check", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "odf-evidence-"))
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" })
      await fs.writeFile(path.join(repo, "a.py"), "x = 1\n", "utf8")
      execFileSync("git", ["add", "a.py"], { cwd: repo, stdio: "ignore" })
      execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-m", "init"], { cwd: repo, stdio: "ignore" })
      await fs.writeFile(path.join(repo, "a.py"), "x = 1\ny = 2\n", "utf8")
      const pack = evidencePack(repo)
      expect(pack.branch).toBe("main")
      expect(pack.head).toMatch(/^[0-9a-f]{40}$/)
      expect(pack.dirty).toBe(true)
      expect(pack.changed.some(c => c.path === "a.py" && c.added === 1)).toBe(true)
      expect(pack.diff_check).toBe(true)
    } finally {
      await fs.rm(repo, { recursive: true, force: true })
    }
  })
})
