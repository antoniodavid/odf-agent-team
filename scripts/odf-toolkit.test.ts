import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { execFileSync } from "node:child_process"
async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const file = path.join(dir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, "utf8")
}

import { asBoolean, authorityLookup, buildManualEvidence, evidencePack, loadRegistry, matchSkills, metricsSummary, normalizeResult, redundancyCheck, resolveAgent, sourceLookup, stateBundle, verifyRefs } from "./odf-toolkit.js"

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

  it("fails closed when the default agent is not installed or phase-eligible", () => {
    const registry = {
      agents: [
        { name: "odoo_backend_engineer", installed: false, phases: ["DESIGN"], description: "Python models" },
      ],
      skills: [],
    }
    expect(resolveAgent(registry, "DESIGN", [])).toBeNull()
    expect(resolveAgent({ agents: [{ ...registry.agents[0], installed: true, phases: ["IMPLEMENT"] }] }, "DESIGN", [])).toBeNull()
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
      const utcDay = new Date().toISOString().split("T")[0]
      await fs.writeFile(path.join(configDir, "metrics", `delegations-${utcDay}.jsonl`), [
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

describe("odf-toolkit deps", () => {
  it("executes the deps subcommand through the current CLI dispatch", () => {
    const output = execFileSync(process.execPath, [path.resolve("scripts/odf-toolkit.js"), "deps", "--json"], { encoding: "utf8" })
    expect(JSON.parse(output)).toMatchObject({
      engram_cli: expect.any(String),
      codegraph_cli: expect.any(String),
      git: expect.any(String),
      node: expect.any(String),
      docker: expect.any(String),
      python3: expect.any(String),
    })
  })
})

describe("odf-toolkit manual-evidence", () => {
  it("builds valid VERIFY evidence from a user-run test and reads the policy gate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-manual-"))
    try {
      await fs.mkdir(path.join(root, ".odf"), { recursive: true })
      await fs.writeFile(path.join(root, ".odf", "policy-gate-chg.json"), JSON.stringify({
        phase: "VERIFY", risk_tier: "MEDIUM", frozen_diff_ref: "abc123", candidate_digest: "d" + "0".repeat(63),
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

  it("rejects manual evidence for an IMPLEMENT gate without mutating it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-manual-implement-"))
    const gatePath = path.join(root, ".odf", "policy-gate-chg.json")
    const gateText = JSON.stringify({ phase: "IMPLEMENT", risk_tier: "MEDIUM", frozen_diff_ref: null, candidate_digest: null })
    try {
      await fs.mkdir(path.dirname(gatePath), { recursive: true })
      await fs.writeFile(gatePath, gateText, "utf8")
      const built = buildManualEvidence({
        change: "chg", command: "odoo-bin -d devel_test --test-enable", database: "devel_test",
        output: "12 passed, 0 failed", root,
      })
      expect(built.problems).toContain("manual evidence requires a VERIFY policy gate; the IMPLEMENT gate intentionally has no candidate_digest; create a VERIFY policy gate before recording evidence")
      expect(await fs.readFile(gatePath, "utf8")).toBe(gateText)
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

describe("odf-toolkit redundancy", () => {
  it("finds existing implementations of domain terms in bounded code dirs", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "odf-redundancy-"))
    try {
      await fs.mkdir(path.join(repo, "models"), { recursive: true })
      await fs.mkdir(path.join(repo, "static", "src"), { recursive: true })
      await fs.writeFile(path.join(repo, "models", "stock_picking.py"), "# purchase origin field\norigin = fields.Char()\n", "utf8")
      await fs.writeFile(path.join(repo, "static", "src", "screen.js"), "// barcode screen\n", "utf8")
      const check = redundancyCheck(repo, ["purchase origin", "barcode screen", "nonexistent_thing"])
      expect(check.matches.some(m => m.file === "models/stock_picking.py" && m.term === "purchase origin")).toBe(true)
      expect(check.matches.some(m => m.file === "static/src/screen.js" && m.term === "barcode screen")).toBe(true)
      expect(check.matches.some(m => m.term === "nonexistent_thing")).toBe(false)
    } finally {
      await fs.rm(repo, { recursive: true, force: true })
    }
  })

  it("returns no matches for empty terms or a repo without code dirs", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "odf-redundancy-empty-"))
    try {
      expect(redundancyCheck(repo, ["", "  "]).matches).toEqual([])
      expect(redundancyCheck(repo, ["term"]).matches).toEqual([])
    } finally {
      await fs.rm(repo, { recursive: true, force: true })
    }
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

describe("odf-toolkit source precision", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-source-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it("lookup finds XML ID definitions and refs in the source tree", async () => {
    await writeFile(root, "addons/account/views/account_move_views.xml", `<record id="view_account_move_filter" model="ir.ui.view">\n  <field name="name">filter</field>\n</record>\n`)
    const found = sourceLookup({ source: root, id: "view_account_move_filter" })
    expect(found.results.some(r => r.file.includes("account_move_views.xml") && r.term.includes('id="view_account_move_filter"'))).toBe(true)
    const model = sourceLookup({ source: root, model: "ir.ui.view" })
    expect(model.results.length).toBeGreaterThan(0)
  })

  it("verify-refs flags refs that do not resolve in the source", async () => {
    await writeFile(root, "addons/account/views/views.xml", `<record id="real_view" model="ir.ui.view"/>\n`)
    await writeFile(root, "mymodule/views/v.xml", `<record id="x" model="ir.ui.view"><field name="inherit_id" ref="account.real_view"/></record>\n<record id="y" model="ir.ui.view"><field name="inherit_id" ref="account.ghost_view"/></record>\n`)
    const verdict = verifyRefs({ repo: path.join(root, "mymodule"), source: path.join(root, "addons") })
    expect(verdict.ok).toBe(false)
    expect(verdict.missing_refs.some(m => m.ref === "account.ghost_view")).toBe(true)
    expect(verdict.missing_refs.some(m => m.ref === "account.real_view")).toBe(false)
  })

  it("scans large XML and Python files without the old 128 KiB skip", async () => {
    const xmlFiller = "  <!-- bounded scanner filler -->\n".repeat(5000)
    const pyFiller = "# bounded scanner filler\n".repeat(7000)
    await writeFile(root, "addons/account/views/large.xml", `<odoo>\n${xmlFiller}<record id="large_view" model="ir.ui.view"/>\n</odoo>\n`)
    await writeFile(root, "addons/account/models/large.py", `${pyFiller}_name = "x.large_model"\n`)
    await writeFile(root, "custom/views/large.xml", `<odoo>\n${xmlFiller}<record id="x" model="ir.ui.view"><field name="inherit_id" ref="account.large_view"/></record>\n</odoo>\n`)

    expect((await fs.stat(path.join(root, "addons/account/views/large.xml"))).size).toBeGreaterThan(128 * 1024)
    expect(sourceLookup({ source: path.join(root, "addons"), id: "large_view", module: "account" }).results).toHaveLength(1)
    expect(sourceLookup({ source: path.join(root, "addons"), model: "x.large_model" }).results).toHaveLength(1)
    expect(verifyRefs({ repo: path.join(root, "custom"), source: path.join(root, "addons") })).toMatchObject({ ok: true, missing_refs: [], missing_models: [] })
  })

  it("keeps module-qualified XML IDs out of unrelated modules and unqualified roots", async () => {
    await writeFile(root, "account/views.xml", `<record id="same_view" model="ir.ui.view"/>\n`)
    await writeFile(root, "l10n_es/views.xml", `<record id="same_view" model="ir.ui.view"/>\n`)
    await writeFile(root, "same_view.xml", `<record id="same_view" model="ir.ui.view"/>\n`)

    const strict = sourceLookup({ source: root, id: "same_view", module: "account" })
    expect(strict.results).toHaveLength(1)
    expect(strict.results[0].file).toBe("account/views.xml")
  })

  it("resolves version-specific action relations to the fixture's exact target", async () => {
    const fixtureRoot = path.resolve("scripts/fixtures/source-precision")
    const goldens = JSON.parse(await fs.readFile(path.resolve("scripts/fixtures/source-precision-goldens.json"), "utf8"))
    for (const golden of goldens.fixtures) {
      const result = authorityLookup({
        source: path.join(fixtureRoot, golden.source),
        action: golden.action,
        relation: golden.relation,
      })
      expect(result.ok, `Odoo ${golden.odoo_version}`).toBe(true)
      expect(result.relation?.target_xmlid).toBe(golden.target)
      expect(result.target?.xmlid).toBe(golden.target)
      expect(result.target?.xmlid).not.toContain("generic")
      expect(result.target?.snippet.length).toBeLessThanOrEqual(160)
    }
  })

  it("fails closed when an action relation cannot be proven", () => {
    const result = authorityLookup({
      source: path.resolve("scripts/fixtures/source-precision/odoo-19.0"),
      action: "account.action_account_move",
      relation: "missing_view_id",
    })
    expect(result).toMatchObject({ ok: false, action: expect.any(Object), relation: null, target: null })
  })

  it("resolves an ir.ui.view inherit_id relation without using the action contract", async () => {
    await writeFile(root, "custom/views.xml", `<record id="view_child" model="ir.ui.view">
  <field name="inherit_id" ref="base.view_parent"/>
</record>
`)
    await writeFile(root, "base/views.xml", `<record id="view_parent" model="ir.ui.view"/>
`)

    const result = authorityLookup({ source: root, view: "custom.view_child", relation: "inherit_id" })

    expect(result).toMatchObject({
      ok: true,
      action: null,
      view: { xmlid: "custom.view_child" },
      relation: { name: "inherit_id", target_xmlid: "base.view_parent" },
      target: { xmlid: "base.view_parent" },
    })
  })

  it("fails closed for missing and ambiguous inherit_id relations", async () => {
    await writeFile(root, "custom/views.xml", `<record id="view_missing" model="ir.ui.view"/>
<record id="view_ambiguous" model="ir.ui.view">
  <field name="inherit_id" ref="base.view_parent"/>
  <field name="inherit_id" ref="base.view_parent"/>
</record>
`)
    await writeFile(root, "base/views.xml", `<record id="view_parent" model="ir.ui.view"/>
`)

    expect(authorityLookup({ source: root, view: "custom.view_missing", relation: "inherit_id" })).toMatchObject({
      ok: false,
      reason: "relation definition not proven",
    })
    expect(authorityLookup({ source: root, view: "custom.view_ambiguous", relation: "inherit_id" })).toMatchObject({
      ok: false,
      reason: "relation definition is ambiguous",
    })
  })
})
