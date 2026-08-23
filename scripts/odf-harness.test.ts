import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { execFileSync, spawnSync } from "node:child_process"
import YAML from "yaml"
import { classifyEntryTriage } from "../odf-plugin/entry-triage.js"
import { advanceWorkflow, resolveWorkflowRoute } from "../odf-plugin/odf-workflow.js"
import { deriveWorkflowStatus } from "../odf-plugin/odf-workflow-status.js"
import { validateExpectations } from "../odf-plugin/odf-expectations.js"
import { resolveAgent } from "./lib/agent-resolve.js"
import { buildConfig } from "./odf-project-scan.js"
import { inspectToolArgs } from "./odf-safety.js"

const REPO = path.resolve(__dirname, "..")
const TOOLKIT = path.join(REPO, "scripts", "odf-toolkit.js")
const SCAN = path.join(REPO, "scripts", "odf-project-scan.js")

function runCli(script: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; allowExitOne?: boolean } = {}) {
  const result = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    cwd: opts.cwd || REPO,
    env: { ...process.env as Record<string, string>, ...(opts.env || {}) },
  })
  const expected = opts.allowExitOne ? [0, 1] : [0]
  expect(expected.includes(result.status ?? -1), `cli ${script} ${args.join(" ")} failed: ${result.stderr}`).toBe(true)
  return result.stdout
}

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const file = path.join(dir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, "utf8")
}

describe("harness smoke: core determinism", () => {
  it("registry: the real registry loads with agents, skills, and commands", () => {
    const registry = JSON.parse(fsSyncRead(path.join(REPO, "odf-registry.json")))
    expect(registry.agents.some((a: any) => a.name === "odoo_backend_engineer")).toBe(true)
    expect(registry.skills.length).toBeGreaterThan(20)
    expect(registry.commands.some((c: any) => c.name === "odf-new")).toBe(true)
  })

  it("triage: risk escalates, micro stays micro, standard-config routes cheap, vague asks ICE", () => {
    const risky = classifyEntryTriage({ change: "c", description: "Expose a public API webhook endpoint" })
    expect(risky).toMatchObject({ level: "full", work_type: "feature" })
    const micro = classifyEntryTriage({ change: "c", description: "Add a computed discount field to sale.order.", module: "sale", domain: "sales", expected_files: 2, expectations_clear: true })
    expect(micro).toMatchObject({ level: "micro", work_type: "small-change" })
    const config = classifyEntryTriage({ change: "c", description: "Install and configure l10n_mx_edi on the instance." })
    expect(config).toMatchObject({ level: "micro", work_type: "standard-config" })
    const vague = classifyEntryTriage({ change: "c", description: "Make it better" })
    expect(vague.needs_question).toBe(true)
    expect(vague.clarity).toBe("unclear")
  })

  it("workflow: feature route advances strictly and blocks skipping BUILD", () => {
    const route = resolveWorkflowRoute("feature")
    const entry = advanceWorkflow({ route, completed_stages: [], candidate_stage: null, phase_result_status: "ok", validation_status: "verified", receipt_state: "none", resumable_state: true, archived_state: false })
    expect(entry.next_stage).toBe("DECIDE")
    const build = advanceWorkflow({ route, completed_stages: ["DECIDE", "PLAN"], candidate_stage: "BUILD", phase_result_status: "ok", validation_status: "verified", receipt_state: "none", resumable_state: true, archived_state: false })
    expect(build.status).toBe("advanced")
    expect(build.next_stage).toBe("VERIFY")
    const skipped = advanceWorkflow({ route, completed_stages: ["DECIDE"], candidate_stage: "VERIFY", phase_result_status: "ok", validation_status: "verified", receipt_state: "none", resumable_state: true, archived_state: false })
    expect(skipped.status).toBe("blocked")
  })

  it("status: canonical, recovery-required, and binding-pending derive correctly", () => {
    const ok = deriveWorkflowStatus({ change: "c", state: "work_type: feature\ncanonical_stage: PLAN\ncompleted_canonical_stages: [DECIDE]\n" })
    expect(ok.state_kind).toBe("canonical")
    expect(ok.recovery_work_type_required).toBe(false)
    const recovery = deriveWorkflowStatus({ change: "c", state: "canonical_stage: PLAN\ncompleted_canonical_stages: [DECIDE]\n" })
    expect(recovery.recovery_work_type_required).toBe(true)
    const pending = deriveWorkflowStatus({ change: "c", state: "work_type: feature\nbinding_pending: true\ncanonical_stage: PLAN\n" })
    expect(pending.resumable).toBe(false)
  })

  it("expectations: approved docs validate, revisions validate, tampering rejects", () => {
    const approved = {
      change: "c", intent: "i", expectations: [{ id: "EXP-01", statement: "s", testable: true, owned_by: "human" }],
      approved: true, approved_by: "user", approved_at: "2026-08-22T00:00:00.000Z", immutable_since: "2026-08-22T00:00:00.000Z",
    }
    expect(validateExpectations({ change: "c", artifacts: [{ key: "x/expectations", content: approved }] }).status).toBe("approved")
    expect(validateExpectations({ change: "c", artifacts: [{ key: "x/expectations", content: { ...approved, revision: 2, supersedes: "abc", replan_from: "DECIDE" } }] }).status).toBe("approved")
    expect(validateExpectations({ change: "c", artifacts: [{ key: "x/expectations", content: { ...approved, approved: false } }] }).status).toBe("invalid")
  })

  it("agent resolution: backend prompts stay backend; frontend goes frontend; default on generic", () => {
    const registry = JSON.parse(fsSyncRead(path.join(REPO, "odf-registry.json")))
    expect(resolveAgent(registry, "DESIGN", ["Odoo", "18", "Python", "ORM", "model"])).toBe("odoo_backend_engineer")
    expect(resolveAgent(registry, "DESIGN", ["frontend", "OWL", "assets"])).toBe("odoo_frontend_engineer")
    expect(resolveAgent(registry, "DESIGN", [])).toBe("odoo_backend_engineer")
  })
})

describe("harness smoke: CLI subcommands end-to-end", () => {
  let tmp: string
  let previousConfigDir: string | undefined

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-harness-"))
    previousConfigDir = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = REPO
  })

  afterEach(async () => {
    if (previousConfigDir === undefined) delete process.env.ODF_CONFIG_DIR
    else process.env.ODF_CONFIG_DIR = previousConfigDir
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("result: normalizes a string design_closed", () => {
    const out = JSON.parse(runCli(TOOLKIT, ["result", "--result", JSON.stringify({ status: "ok", design_closed: "true" }), "--phase", "DESIGN"]))
    expect(out).toMatchObject({ status: "ok", design_closed: true })
  })

  it("resolve: real registry picks an agent", () => {
    const out = JSON.parse(runCli(TOOLKIT, ["resolve", "--phase", "DESIGN", "--task", "Design the OWL frontend component"]))
    expect(out.status).toBe("ok")
    expect(typeof out.agent).toBe("string")
  })

  it("evidence: packs git head, branch, and diff check on a real repo", async () => {
    const repo = path.join(tmp, "repo")
    await fs.mkdir(repo, { recursive: true })
    execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" })
    await writeFile(repo, "a.py", "x = 1\n")
    execFileSync("git", ["add", "a.py"], { cwd: repo, stdio: "ignore" })
    execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-m", "init"], { cwd: repo, stdio: "ignore" })
    const out = JSON.parse(runCli(TOOLKIT, ["evidence", "--repo", repo]))
    expect(out.branch).toBe("main")
    expect(out.head).toMatch(/^[0-9a-f]{40}$/)
    expect(out.diff_check).toBe(true)
  })

  it("redundancy: finds an existing implementation in the repo", async () => {
    await writeFile(tmp, "models/stock_picking.py", "# purchase origin field\n")
    const out = JSON.parse(runCli(TOOLKIT, ["redundancy", "--repo", tmp, "--terms", "purchase origin"]))
    expect(out.matches.some((m: any) => m.file === "models/stock_picking.py")).toBe(true)
  })

  it("manual-evidence: writes validated user evidence bound to the gate", async () => {
    await writeFile(tmp, ".odf/policy-gate-chg.json", JSON.stringify({ risk_tier: "MEDIUM", frozen_diff_ref: "abc", candidate_digest: "d".repeat(64) }))
    await writeFile(tmp, "out.txt", "12 passed, 0 failed\n")
    const out = JSON.parse(runCli(TOOLKIT, ["manual-evidence", "--change", "chg", "--command", "odoo-bin -d devel_test -i mod --test-enable --stop-after-init", "--database", "devel_test", "--output-file", "out.txt", "--root", tmp]))
    expect(out.status).toBe("written")
    const evidence = JSON.parse(await fs.readFile(path.join(tmp, ".odf", "validation-evidence-chg.json"), "utf8"))
    expect(evidence.executor).toBe("user-manual")
    expect(evidence.commands[0].database).toBe("devel_test")
  })

  it("scan: builds the Doodba environment config and matrix", async () => {
    await writeFile(tmp, "odoo/custom/src/addons.yaml", "repo-a:\n  - \"*\"\n")
    await writeFile(tmp, "odoo/custom/src/repo-a/mod_a1/__manifest__.py", "{'name': 'Mod A1', 'version': '18.0.1.0.0', 'license': 'AGPL-3', 'depends': ['base']}\n")
    await writeFile(tmp, "myrepo/mod_p1/__manifest__.py", "{'name': 'Mod P1', 'version': '18.0.1.0.0', 'license': 'AGPL-3', 'depends': ['mod_a1', 'web']}\n")
    const config = buildConfig(tmp, path.join(tmp, "myrepo"))
    expect(config.odoo_version).toBe(18)
    expect(config.modules.map((m: any) => m.name)).toEqual(["mod_p1"])
    expect(config.dependency_matrix.resolved).toEqual([{ module: "mod_p1", dep: "mod_a1", in_repo: "repo-a" }])
    expect(config.dependency_matrix.unresolved_in_sources).toEqual([{ module: "mod_p1", dep: "web" }])
  })
})

describe("harness smoke: safety and install integrity", () => {
  let tmp: string
  let previousConfigDir: string | undefined

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-harness-safety-"))
    previousConfigDir = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = REPO
  })

  afterEach(async () => {
    if (previousConfigDir === undefined) delete process.env.ODF_CONFIG_DIR
    else process.env.ODF_CONFIG_DIR = previousConfigDir
    await fs.rm(tmp, { recursive: true, force: true })
  })
  it("safety: blocks destructive commands but allows the mandatory DB guard", () => {
    expect(inspectToolArgs({ tool: "bash", args: "DROP DATABASE mydb;" }).blocked).toBe(true)
    expect(inspectToolArgs({ tool: "bash", args: "dropdb mydb" }).blocked).toBe(true)
    const guard = "You must NOT drop, truncate, or reset any database. Never run dropdb, DROP DATABASE, TRUNCATE without current explicit user consent."
    expect(inspectToolArgs({ tool: "bash", args: guard }).blocked).toBe(false)
  })

  it("registry: every registered skill and agent path resolves inside the repo", () => {
    const registry = JSON.parse(fsSyncRead(path.join(REPO, "odf-registry.json")))
    for (const skill of registry.skills) {
      const resolved = path.resolve(REPO, skill.path)
      expect(resolved.startsWith(REPO), `skill path escapes: ${skill.path}`).toBe(true)
      expect(fsSyncExists(resolved)).toBe(true)
    }
    for (const agent of registry.agents) {
      const resolved = path.resolve(REPO, agent.path)
      expect(resolved.startsWith(REPO), `agent path escapes: ${agent.path}`).toBe(true)
      expect(fsSyncExists(resolved)).toBe(true)
    }
  })

  it("scan CLI: --repo relative resolves against the Doodba src dir and reports summary", { timeout: 30_000 }, async () => {
    await writeFile(tmp, "odoo/custom/src/addons.yaml", "repo-a:\n  - \"*\"\n")
    await writeFile(tmp, "odoo/custom/src/repo-a/mod_a1/__manifest__.py", "{'name': 'Mod A1', 'version': '18.0.1.0.0', 'license': 'AGPL-3', 'depends': ['base']}\n")
    const out = runCli(SCAN, ["--root", tmp, "--repo", "repo-a", "--format", "summary"], { allowExitOne: true })
    expect(out).toContain("project: repo-a (Odoo 18)")
    expect(out).toContain("modules: 1")
  })
})

function fsSyncRead(p: string): string {
  return require("node:fs").readFileSync(p, "utf8")
}
function fsSyncExists(p: string): boolean {
  try { require("node:fs").statSync(p); return true } catch { return false }
}
