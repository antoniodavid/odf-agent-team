import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as os from "node:os"
import { execSync } from "node:child_process"

// These pure functions do not depend on the registry file path, so they can be
// imported normally. createODFDelegate is imported dynamically in its own tests
// so we can control $HOME and therefore REGISTRY_PATH.
import {
  resolvePath,
  resolveWorkspaceRoot,
  matchSkills,
  resolveAgent,
  formatCompactRules,
  invokeTask,
  findTaskApi,
  getProfileByPhase,
  recordMetrics,
  getMetricsBuffer,
  clearMetricsBuffer,
  ALLOWED_PHASES,
  classifyRiskTier,
  classifyRiskTierWithContent,
  computePolicyGate,
  savePolicyGateJson,
  validateValidationEvidence,
  mergeReceipt,
  type PolicyGateDecision,
  type ODFRegistry,
  type ODFSkill,
  type ODFAgent,
} from "./odf-delegation.js"

const baseRegistry: ODFRegistry = {
  version: 1,
  last_updated: new Date().toISOString(),
  skills: [
    {
      name: "oca-python-style",
      title: "OCA Python Style",
      category: "style",
      triggers: [".py", "python", "models/", "controller/", "wizard/"],
      compact_rules: "Python style rules",
      path: "/tmp/oca-python-style.md",
      odoo_versions: [16, 17, 18, 19],
      sdd_phase: "IMPLEMENT",
    },
    {
      name: "odf-design",
      title: "Design Odoo Module",
      category: "odf",
      triggers: ["design", "architecture", "task breakdown"],
      compact_rules: "Design rules",
      path: "/tmp/odf-design.md",
      odoo_versions: [14, 15, 16, 17, 18, 19],
      sdd_phase: "DESIGN",
    },
    {
      name: "owl-components",
      title: "OWL Component Patterns",
      category: "patterns/frontend",
      triggers: ["OWL", "component", "JavaScript", "JS", "widget", "static/src"],
      compact_rules: "OWL rules",
      path: "/tmp/owl-components.md",
      odoo_versions: [15, 16, 17, 18, 19],
      sdd_phase: "DESIGN",
    },
  ] as unknown as ODFSkill[],
  agents: [
    {
      name: "odoo_backend_engineer",
      mode: "subagent",
      description: "Python models, views, security, tests, OCA compliance",
      phases: ["DESIGN", "IMPLEMENT"],
      model: null,
      path: "/tmp/odoo_backend_engineer.md",
      installed: true,
    },
    {
      name: "odoo_frontend_engineer",
      mode: "subagent",
      description: "OWL, JS/TS, SCSS, QWeb, all view types",
      phases: ["DESIGN", "IMPLEMENT"],
      model: null,
      path: "/tmp/odoo_frontend_engineer.md",
      installed: true,
    },
    {
      name: "odoo_stock_lot_specialist",
      mode: "subagent",
      description: "Odoo Stock Lot/Serial Specialist",
      phases: ["DESIGN", "IMPLEMENT"],
      model: null,
      path: "/tmp/odoo_stock_lot_specialist.md",
      installed: true,
    },
    {
      name: "odoo_functional_consultant",
      mode: "subagent",
      description: "Standard vs custom assessment, functional analysis",
      phases: ["ASSESS"],
      model: null,
      path: "/tmp/odoo_functional_consultant.md",
      installed: true,
    },
  ] as unknown as ODFAgent[],
}

describe("resolvePath", () => {
  const registryDir = "/home/user/.config/opencode"

  it("returns empty string for missing entry", () => {
    expect(resolvePath(registryDir, "")).toBe("")
  })

  it("resolves relative paths against the registry directory", () => {
    expect(resolvePath(registryDir, "skills/odf-assess/SKILL.md")).toBe(
      path.resolve(registryDir, "skills/odf-assess/SKILL.md")
    )
  })

  it("normalizes ./ prefixes", () => {
    expect(resolvePath(registryDir, "./skills/odf-assess/SKILL.md")).toBe(
      path.resolve(registryDir, "./skills/odf-assess/SKILL.md")
    )
  })

  it("expands ~/ paths that stay within the ODF config directory", () => {
    const configDir = process.env.ODF_CONFIG_DIR && path.isAbsolute(process.env.ODF_CONFIG_DIR)
      ? process.env.ODF_CONFIG_DIR
      : path.join(os.homedir(), ".config/opencode")
    const entry = process.env.ODF_CONFIG_DIR
      ? path.join(configDir, "skills/odf-assess/SKILL.md")
      : "~/.config/opencode/skills/odf-assess/SKILL.md"
    expect(resolvePath(registryDir, entry)).toBe(
      path.join(configDir, "skills/odf-assess/SKILL.md")
    )
  })

  it("allows absolute paths inside the allowed roots", () => {
    expect(resolvePath(registryDir, "/home/user/.config/opencode/skills/x/SKILL.md")).toBe(
      "/home/user/.config/opencode/skills/x/SKILL.md"
    )
  })

  it("rejects paths containing .. segments", () => {
    expect(resolvePath(registryDir, "../skills/odf-assess/SKILL.md")).toBe("")
    expect(resolvePath(registryDir, "skills/../odf-assess/SKILL.md")).toBe("")
  })

  it("rejects absolute paths outside allowed roots", () => {
    expect(resolvePath(registryDir, "/etc/passwd")).toBe("")
    expect(resolvePath(registryDir, "/tmp/secret.md")).toBe("")
  })

  it("rejects ~/ paths outside allowed roots", () => {
    expect(resolvePath(registryDir, "~/Workspace/skill.md")).toBe("")
    expect(resolvePath(registryDir, "~/.ssh/id_rsa")).toBe("")
  })
})

describe("matchSkills", () => {
  it("returns up to 5 matching skills sorted by score", () => {
    const skills = matchSkills(baseRegistry, {
      task: "Design a new model with python",
      files: ["models/sale_order.py"],
    })
    expect(skills.length).toBeGreaterThan(0)
    expect(skills.length).toBeLessThanOrEqual(5)
    // File match for .py gives python style the highest score.
    expect(skills[0].name).toBe("oca-python-style")
  })

  it("filters by Odoo version", () => {
    const skills = matchSkills(baseRegistry, {
      task: "Design a model",
      files: [],
      odooVersion: 14,
    })
    // odf-design supports v14, owl-components does not.
    expect(skills.map((s: ODFSkill) => s.name)).toContain("odf-design")
    expect(skills.map((s: ODFSkill) => s.name)).not.toContain("owl-components")
  })

  it("returns no skills when nothing matches", () => {
    const skills = matchSkills(baseRegistry, {
      task: "deploy to kubernetes",
      files: [],
    })
    expect(skills).toEqual([])
  })
})

describe("ALLOWED_PHASES", () => {
  it("includes PROPOSE as the first workflow delegation phase", () => {
    expect(ALLOWED_PHASES).toContain("PROPOSE")
  })

  it("includes EXPLORE as a valid delegation phase", () => {
    expect(ALLOWED_PHASES).toContain("EXPLORE")
  })
})

describe("resolveAgent", () => {
  it("returns default agents when keywords are empty", () => {
    expect(resolveAgent(baseRegistry, "PROPOSE", [])).toBe("odoo_functional_consultant")
    expect(resolveAgent(baseRegistry, "ASSESS", [])).toBe("odoo_functional_consultant")
    expect(resolveAgent(baseRegistry, "DESIGN", [])).toBe("odoo_backend_engineer")
    expect(resolveAgent(baseRegistry, "IMPLEMENT", [])).toBe("odoo_backend_engineer")
    expect(resolveAgent(baseRegistry, "VERIFY", [])).toBe("odoo_qa_engineer")
    expect(resolveAgent(baseRegistry, "EXPLORE", [])).toBe("odoo_functional_consultant")
  })

  it("matches custom agents by description keywords", () => {
    expect(resolveAgent(baseRegistry, "DESIGN", ["OWL", "component", "JavaScript"])).toBe("odoo_frontend_engineer")
    expect(resolveAgent(baseRegistry, "DESIGN", ["lot", "serial", "stock", "tracking"])).toBe("odoo_stock_lot_specialist")
  })

  it("falls back to phase default when no custom agent matches", () => {
    expect(resolveAgent(baseRegistry, "ASSESS", ["model", "python", "security"])).toBe("odoo_functional_consultant")
  })

  it("does not route unknown phases to an implementation agent", () => {
    expect(resolveAgent(baseRegistry, "UNKNOWN", ["model", "python"])).toBeNull()
  })

  it("is deterministic for the same inputs", () => {
    const keywords = ["OWL", "component"]
    const a = resolveAgent(baseRegistry, "DESIGN", keywords)
    const b = resolveAgent(baseRegistry, "DESIGN", keywords)
    expect(a).toBe(b)
  })
})

describe("formatCompactRules", () => {
  it("always includes precision guardrails header", () => {
    const output = formatCompactRules([])
    expect(output).toContain("## Project Standards (auto-resolved)")
    expect(output).toContain("### Precision Guardrails")
  })

  it("includes skill sections in order", () => {
    const skills = baseRegistry.skills.slice(0, 2)
    const output = formatCompactRules(skills)
    expect(output).toContain("OCA Python Style")
    expect(output).toContain("Design Odoo Module")
    expect(output.indexOf("OCA Python Style")).toBeLessThan(output.indexOf("Design Odoo Module"))
  })
})

describe("invokeTask", () => {
  it("calls the task API and returns the delegated result", async () => {
    const taskApi = vi.fn().mockResolvedValue({ summary: "done" })
    const result = await invokeTask(taskApi, "odoo_backend_engineer", "build a model", ["models/x.py"])
    expect(result.status).toBe("delegated")
    expect(result.result).toEqual({ summary: "done" })
    expect(taskApi).toHaveBeenCalledWith({
      agent: "odoo_backend_engineer",
      prompt: "build a model",
      context_files: ["models/x.py"],
    })
  })
})

describe("getProfileByPhase", () => {
  const profileRegistry: ODFRegistry = {
    ...baseRegistry,
    profiles: [
      {
        name: "default",
        active: true,
        phases: {
          ASSESS: { model: "opencode-go/deepseek-r1", temperature: 0.3, reasoning: true },
          DESIGN: { model: "opencode-go/kimi-k2.6", temperature: 0.25, reasoning: false },
        },
      },
      {
        name: "cheap",
        active: false,
        phases: {
          ASSESS: { model: "opencode-go/kimi-k2.6", temperature: 0.3, reasoning: false },
          DESIGN: { model: "opencode-go/kimi-k2.6", temperature: 0.25, reasoning: false },
        },
      },
    ],
  } as unknown as ODFRegistry

  it("returns the active profile for a phase", async () => {
    const profile = await getProfileByPhase(profileRegistry, "DESIGN")
    expect(profile).not.toBeNull()
    expect(profile!.model).toBe("opencode-go/kimi-k2.6")
    expect(profile!.temperature).toBe(0.25)
    expect(profile!.name).toBe("default")
  })

  it("returns the default profile when none is active", async () => {
    const inactiveRegistry = {
      ...profileRegistry,
      profiles: profileRegistry.profiles?.map(p => ({ ...p, active: false })),
    } as unknown as ODFRegistry
    const profile = await getProfileByPhase(inactiveRegistry, "ASSESS")
    expect(profile).not.toBeNull()
    expect(profile!.name).toBe("default")
  })

  it("allows profile override by name", async () => {
    const profile = await getProfileByPhase(profileRegistry, "ASSESS", "cheap")
    expect(profile).not.toBeNull()
    expect(profile!.name).toBe("cheap")
    expect(profile!.model).toBe("opencode-go/kimi-k2.6")
  })

  it("returns null when no profiles exist", async () => {
    const noProfileRegistry = { ...baseRegistry, profiles: undefined }
    const profile = await getProfileByPhase(noProfileRegistry, "DESIGN")
    expect(profile).toBeNull()
  })
})

describe("findTaskApi", () => {
  it("prefers toolCtx.task", () => {
    const taskFn = vi.fn()
    const toolCtx = { task: taskFn, sessionID: "s1" } as any
    const api = findTaskApi(toolCtx, undefined)
    expect(api?.source).toBe("toolCtx.task")
    expect(api?.taskApi).toBe(taskFn)
  })

  it("falls back to client.task", () => {
    const taskFn = vi.fn()
    const client = { task: taskFn } as any
    const api = findTaskApi({ sessionID: "s1" } as any, client)
    expect(api?.source).toBe("ctx.task")
    expect(api?.taskApi).toBe(taskFn)
  })

  it("returns null when no task API is available", () => {
    expect(findTaskApi({ sessionID: "s1" } as any, undefined)).toBeNull()
    expect(findTaskApi({ sessionID: "s1" } as any, {} as any)).toBeNull()
  })
})

describe("recordMetrics", () => {
  const originalHome = process.env.HOME
  let tempHome: string

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "odf-metrics-"))
    process.env.HOME = tempHome
    process.env.ODF_CONFIG_DIR = ""
    clearMetricsBuffer()
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    delete process.env.ODF_CONFIG_DIR
    delete process.env.ODF_METRICS_BUFFER_CAP
    clearMetricsBuffer()
    await fs.rm(tempHome, { recursive: true, force: true })
  })

  const makeMetric = (overrides: Partial<Parameters<typeof recordMetrics>[0]> = {}) => ({
    timestamp: new Date().toISOString(),
    session_id: "session-abc-123",
    phase: "DESIGN",
    agent: "odoo_backend_engineer",
    skills_injected: ["odf-design"],
    skill_resolution: "injected" as const,
    duration_ms: 100,
    token_estimate: 50,
    status: "ok" as const,
    task_api_source: "toolCtx.task" as const,
    ...overrides,
  })

  it("hashes session_id instead of storing it raw", () => {
    recordMetrics(makeMetric())
    const buffered = getMetricsBuffer()
    expect(buffered.length).toBe(1)
    expect(buffered[0].session_hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it("sanitizes and truncates error messages", () => {
    const longError = "x".repeat(300)
    recordMetrics(makeMetric({ status: "error", error: longError }))
    const buffered = getMetricsBuffer()
    expect(buffered[0].error).toHaveLength(203)
    expect(buffered[0].error).toMatch(/\.\.\.$/)
  })

  it("flushes synchronously when the buffer cap is reached", () => {
    process.env.ODF_METRICS_BUFFER_CAP = "2"
    recordMetrics(makeMetric())
    recordMetrics(makeMetric())
    // Two entries hit the cap, so a synchronous flush fires and empties the buffer.
    expect(getMetricsBuffer().length).toBe(0)

    const metricsDir = path.join(tempHome, ".config", "opencode", "metrics")
    const files = fsSync.readdirSync(metricsDir)
    expect(files.length).toBe(1)
    const logFile = path.join(metricsDir, files[0])
    const lines = fsSync.readFileSync(logFile, "utf8").trim().split("\n")
    expect(lines.length).toBe(2)
    const first = JSON.parse(lines[0])
    expect(first.session_hash).toMatch(/^[0-9a-f]{8}$/)
    expect(first.session_id).toBeUndefined()
  })

  it("never stores the raw session_id in the JSONL log", () => {
    process.env.ODF_METRICS_BUFFER_CAP = "1"
    recordMetrics(makeMetric({ session_id: "super-secret-session" }))
    const metricsDir = path.join(tempHome, ".config", "opencode", "metrics")
    const files = fsSync.readdirSync(metricsDir)
    const content = fsSync.readFileSync(path.join(metricsDir, files[0]), "utf8")
    expect(content).not.toContain("super-secret-session")
  })
})

describe("classifyRiskTier", () => {
  it("returns HIGH for security files", () => {
    expect(classifyRiskTier(["security/ir.model.access.csv"])).toBe("HIGH")
    expect(classifyRiskTier(["security/account.csv"])).toBe("HIGH")
    expect(classifyRiskTier(["data/access_control.csv"])).toBe("HIGH")
    expect(classifyRiskTier(["models/res_partner_security.py"])).toBe("HIGH")
  })

  it("returns LOW for passive view/docs files", () => {
    expect(classifyRiskTier(["views/sale_form.xml"])).toBe("LOW")
    expect(classifyRiskTier(["data/demo.yml"])).toBe("LOW")
    expect(classifyRiskTier(["README.md"])).toBe("LOW")
    expect(classifyRiskTier(["i18n/en.po"])).toBe("LOW")
    expect(classifyRiskTier(["__manifest__.py"])).toBe("LOW")
  })

  it("returns MEDIUM for model code", () => {
    expect(classifyRiskTier(["models/sale_order.py"])).toBe("MEDIUM")
    expect(classifyRiskTier(["controllers/payment.py"])).toBe("MEDIUM")
  })

  it("returns MEDIUM for empty or mixed paths", () => {
    expect(classifyRiskTier([])).toBe("MEDIUM")
    expect(classifyRiskTier(["models/sale_order.py", "views/sale_form.xml"])).toBe("MEDIUM")
  })
})

describe("classifyRiskTierWithContent", () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-tier-"))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const write = async (rel: string, content: string) => {
    const abs = path.join(tmp, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content)
  }

  it("escalates MEDIUM file to HIGH on raw SQL with interpolation", async () => {
    await write("models/sale_order.py", "def x():\n    self.env.cr.execute('SELECT * FROM res_partner WHERE id = %s' % partner_id)\n")
    expect(classifyRiskTierWithContent(["models/sale_order.py"], tmp)).toBe("HIGH")
  })

  it("escalates MEDIUM file to HIGH on eval/subprocess", async () => {
    await write("models/sale_order.py", "import subprocess\nsubprocess.run(cmd, shell=True)\n")
    expect(classifyRiskTierWithContent(["models/sale_order.py"], tmp)).toBe("HIGH")
    await write("models/sale_order.py", "result = eval(expr)\n")
    expect(classifyRiskTierWithContent(["models/sale_order.py"], tmp)).toBe("HIGH")
  })

  it("escalates data XML to HIGH on record rule model", async () => {
    await write("data/partner_rules.xml", '<record id="partner_rule" model="ir.rule">\n  <field name="domain_force">[...]</field>\n</record>')
    expect(classifyRiskTierWithContent(["data/partner_rules.xml"], tmp)).toBe("HIGH")
  })

  it("keeps MEDIUM when content is clean", async () => {
    await write("models/sale_order.py", "from odoo import models, fields\n\nclass SaleOrder(models.Model):\n    _inherit = 'sale.order'\n")
    expect(classifyRiskTierWithContent(["models/sale_order.py"], tmp)).toBe("MEDIUM")
  })

  it("keeps LOW for passive files even with content scan", async () => {
    await write("views/sale_form.xml", "<odoo><record id='v' model='ir.ui.view'><field name='arch' type='xml'>x</field></record></odoo>")
    expect(classifyRiskTierWithContent(["views/sale_form.xml"], tmp)).toBe("LOW")
  })

  it("does not crash on missing files (filename tier stands)", () => {
    expect(classifyRiskTierWithContent(["models/ghost.py"], tmp)).toBe("MEDIUM")
  })

  it("stays HIGH from filename alone without reading", async () => {
    expect(classifyRiskTierWithContent(["security/ir.model.access.csv"], tmp)).toBe("HIGH")
  })
})

function initGitRepo(dir: string): void {
  fsSync.mkdirSync(dir, { recursive: true })
  execSync("git init -q", { cwd: dir })
  execSync('git config user.email "test@example.com"', { cwd: dir })
  execSync('git config user.name "odf-test"', { cwd: dir })
}

function commitFile(dir: string, name: string, lines: number): void {
  const filePath = path.join(dir, name)
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true })
  fsSync.writeFileSync(filePath, Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n") + "\n", "utf8")
  execSync("git add -A", { cwd: dir })
  execSync('git commit -q -m "base"', { cwd: dir })
}

function appendLines(dir: string, name: string, n: number): void {
  fsSync.appendFileSync(path.join(dir, name), Array.from({ length: n }, (_, i) => `extra ${i}`).join("\n") + "\n", "utf8")
}

describe("computePolicyGate", () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-gate-"))
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const registryWithTdd = (strict: boolean): ODFRegistry => ({
    ...baseRegistry,
    flags: { strict_tdd: strict },
  })

  it("resolves TDD on when global is true and no local marker", () => {
    const d = computePolicyGate({ change: "tdd-on", phase: "IMPLEMENT", workspaceDir: tmp, registry: registryWithTdd(true) })
    expect(d.gate).toBe("allow")
    expect(d.tdd.global).toBe(true)
    expect(d.tdd.local_readable).toBe(true)
    expect(d.tdd.local_off).toBe(false)
    expect(d.tdd.effective).toBe("on")
  })

  it("resolves TDD off when the local marker exists", async () => {
    await fs.mkdir(path.join(tmp, ".odf"), { recursive: true })
    await fs.writeFile(path.join(tmp, ".odf", "tdd.off"), "off", "utf8")
    const d = computePolicyGate({ change: "tdd-off", phase: "IMPLEMENT", workspaceDir: tmp, registry: registryWithTdd(true) })
    expect(d.tdd.effective).toBe("off")
    expect(d.tdd.local_off).toBe(true)
  })

  it("resolves TDD off when the global flag is false", () => {
    const d = computePolicyGate({ change: "tdd-global-off", phase: "IMPLEMENT", workspaceDir: tmp, registry: registryWithTdd(false) })
    expect(d.tdd.global).toBe(false)
    expect(d.tdd.effective).toBe("off")
  })

  it("fails closed when the local source is unreadable", async () => {
    await fs.writeFile(path.join(tmp, ".odf"), "not-a-directory", "utf8")
    const d = computePolicyGate({ change: "tdd-failclosed", phase: "IMPLEMENT", workspaceDir: tmp, registry: registryWithTdd(true) })
    expect(d.tdd.local_readable).toBe(false)
    expect(d.tdd.effective).toBe("off")
  })

  it("blocks on a missing change name", () => {
    const d = computePolicyGate({ change: "", phase: "IMPLEMENT", workspaceDir: tmp, registry: registryWithTdd(true) })
    expect(d.gate).toBe("block")
    expect(d.reason).toContain("missing change name")
  })

  it("computes the correction budget at half the changed lines (n=100 → 50)", () => {
    const repo = path.join(tmp, "repo100")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)
    const d = computePolicyGate({ change: "budget-100", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(d.frozen_diff_ref).toBeTruthy()
    expect(d.changed_lines).toBe(100)
    expect(d.correction_budget_lines).toBe(50)
  })

  it("caps the correction budget at 200 lines (n=500 → 200)", () => {
    const repo = path.join(tmp, "repo500")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 500)
    const d = computePolicyGate({ change: "budget-500", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(d.changed_lines).toBe(500)
    expect(d.correction_budget_lines).toBe(200)
  })

  it("reuses a frozen decision for the same ref instead of re-freezing", () => {
    const repo = path.join(tmp, "repo-idem")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)
    const first = computePolicyGate({ change: "idem", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    appendLines(repo, "a.py", 200)
    const second = computePolicyGate({ change: "idem", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(second.frozen_diff_ref).toBe(first.frozen_diff_ref)
    expect(second.changed_lines).toBe(100)
    expect(second.correction_budget_lines).toBe(50)
  })

  it("classifies the risk tier from changed paths for VERIFY", () => {
    const repo = path.join(tmp, "repo-tier")
    initGitRepo(repo)
    commitFile(repo, "security/ir.model.access.csv", 5)
    appendLines(repo, "security/ir.model.access.csv", 5)
    const d = computePolicyGate({ change: "tier-sec", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(d.risk_tier).toBe("HIGH")

    const repoLow = path.join(tmp, "repo-tier-low")
    initGitRepo(repoLow)
    commitFile(repoLow, "views/sale_form.xml", 5)
    appendLines(repoLow, "views/sale_form.xml", 5)
    const low = computePolicyGate({ change: "tier-low", phase: "VERIFY", workspaceDir: repoLow, registry: registryWithTdd(false) })
    expect(low.risk_tier).toBe("LOW")
  })

  it("fails open for VERIFY when git is unavailable", () => {
    const d = computePolicyGate({ change: "no-git", phase: "VERIFY", workspaceDir: tmp, registry: registryWithTdd(true) })
    expect(d.frozen_diff_ref).toBeNull()
    expect(d.changed_lines).toBeNull()
    expect(d.risk_tier).toBe("LOW")
    expect(d.gate).toBe("allow")
  })
})

describe("savePolicyGateJson", () => {
  it("persists a decision to <worktree>/.odf/policy-gate-{change}.json", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-save-"))
    try {
      const decision: PolicyGateDecision = {
        change: "save-test",
        phase: "IMPLEMENT",
        gate: "allow",
        reason: "test",
        tdd: { global: false, local_readable: true, local_off: false, effective: "off" },
        risk_tier: "MEDIUM",
        frozen_diff_ref: null,
        changed_lines: null,
        correction_budget_lines: null,
        changed_paths: [],
        resolved_at: new Date().toISOString(),
      }
      savePolicyGateJson(tmp, decision)
      const saved = JSON.parse(fsSync.readFileSync(path.join(tmp, ".odf", "policy-gate-save-test.json"), "utf8"))
      expect(saved.change).toBe("save-test")
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe("createODFDelegate", () => {
  const originalHome = process.env.HOME
  let tempHome: string

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "odf-test-"))
    process.env.HOME = tempHome
    const configDir = path.join(tempHome, ".config", "opencode")
    await fs.mkdir(configDir, { recursive: true })
    await fs.copyFile(
      path.resolve(process.cwd(), "odf-registry.json"),
      path.join(configDir, "odf-registry.json")
    )
    vi.resetModules()
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await fs.rm(tempHome, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("returns a delegated result envelope when task() is available", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskResult = { status: "ok", executive_summary: "assessed" }
    const taskApi = vi.fn().mockResolvedValue(taskResult)
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "ASSESS", prompt: "Assess a new sales feature", context_files: ["models/sale.py"] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("delegated")
    expect(envelope.phase).toBe("ASSESS")
    expect(envelope.agent).toBe("odoo_functional_consultant")
    expect(envelope.task_api_source).toBe("toolCtx.task")
    expect(envelope.result).toEqual(taskResult)
    expect(envelope.skills_injected.length).toBeGreaterThanOrEqual(0)
    expect(envelope.profile).toBeDefined()
    expect(envelope.profile?.model).toBe("opencode-go/deepseek-r1")

    const metrics = getMetricsBuffer()
    expect(metrics.length).toBe(1)
    expect(metrics[0].status).toBe("ok")
    expect(metrics[0].phase).toBe("ASSESS")
    expect(metrics[0].agent).toBe("odoo_functional_consultant")
    expect(metrics[0].task_api_source).toBe("toolCtx.task")
  })

  it("returns a fallback instruction envelope when task() is unavailable", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const toolCtx = { sessionID: "s1" } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a new model", context_files: [] },
      toolCtx
    )

    expect(typeof output).toBe("string")
    expect(output).toContain("fallback")
    expect(output).toContain("Status: fallback")
    expect(output).toContain("Agent: odoo_backend_engineer")
    expect(output).toContain("---FALLBACK_PROMPT_START---")

    const metrics = getMetricsBuffer()
    expect(metrics.length).toBe(1)
    expect(metrics[0].status).toBe("fallback")
    expect(metrics[0].task_api_source).toBe("unavailable")
  })

  it("returns an error envelope when task() throws", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockRejectedValue(new Error("task service down"))
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a new model", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("error")
    expect(envelope.message).toContain("task service down")

    const metrics = getMetricsBuffer()
    expect(metrics.length).toBe(1)
    expect(metrics[0].status).toBe("error")
    expect(metrics[0].error).toContain("task service down")
  })

  it("rejects invalid phases", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const toolCtx = { sessionID: "s1" } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "INVALID", prompt: "Do something", context_files: [] },
      toolCtx
    )

    expect(output).toContain("Invalid phase")
    expect(output).toContain(ALLOWED_PHASES.join(", "))
  })

  it("rejects context_files that escape the workspace root", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const toolCtx = { sessionID: "s1" } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a model", context_files: ["/etc/passwd"] },
      toolCtx
    )

    expect(output).toContain("context_files")
    expect(output).toContain("escapes workspace root")
  })

  it("rejects context_files containing .. segments", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const toolCtx = { sessionID: "s1" } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a model", context_files: ["models/../../secret.py"] },
      toolCtx
    )

    expect(output).toContain("context_files")
    expect(output).toContain("path traversal")
  })

  it("rejects context directories", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const toolCtx = { sessionID: "s1" } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a model", context_files: ["plugins"] },
      toolCtx
    )

    expect(output).toContain("is not a file")
  })

  it("resolves the Git root from a nested working directory", () => {
    expect(resolveWorkspaceRoot(path.join(process.cwd(), "plugins"))).toBe(process.cwd())
  })

  it("falls back when client.task is provided but toolCtx.task is not", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskResult = { status: "ok", executive_summary: "designed" }
    const taskApi = vi.fn().mockResolvedValue(taskResult)
    const client = { task: taskApi } as any
    const toolCtx = { sessionID: "s1" } as any

    const delegateTool = createODFDelegate(client)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a new model", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("delegated")
    expect(envelope.task_api_source).toBe("ctx.task")
  })

  it("returns timeout status when task() exceeds timeout_ms", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10_000)))
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a new model", context_files: [], timeout_ms: 50 },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("timeout")
    expect(envelope.message).toContain("timed out")

    const metrics = getMetricsBuffer()
    expect(metrics.length).toBe(1)
    expect(metrics[0].status).toBe("timeout")
  })

  it("injects active SDD profile into the delegated prompt", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskResult = { status: "ok", executive_summary: "designed" }
    const taskApi = vi.fn().mockResolvedValue(taskResult)
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a new model", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("delegated")
    expect(envelope.profile).toBeDefined()
    expect(envelope.profile.model).toBe("opencode-go/kimi-k2.6")
    expect(envelope.profile.temperature).toBe(0.25)

    const calledPrompt = taskApi.mock.calls[0][0].prompt
    expect(calledPrompt).toContain("## SDD Profile")
    expect(calledPrompt).toContain("opencode-go/kimi-k2.6")
    expect(calledPrompt).toContain("Temperature: 0.25")
  })

  it("allows profile override via tool args", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskResult = { status: "ok", executive_summary: "assessed" }
    const taskApi = vi.fn().mockResolvedValue(taskResult)
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "ASSESS", prompt: "Assess a new feature", context_files: [], profile: "cheap" },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("delegated")
    expect(envelope.profile).toBeDefined()
    expect(envelope.profile.name).toBe("cheap")
    expect(envelope.profile.model).toBe("opencode-go/kimi-k2.6")
    expect(envelope.profile.reasoning).toBe(false)
  })

  it("accepts EXPLORE phase and delegates to the functional consultant agent", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskResult = { status: "ok", executive_summary: "explored" }
    const taskApi = vi.fn().mockResolvedValue(taskResult)
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "EXPLORE", prompt: "Explore how Odoo computes taxes", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("delegated")
    expect(envelope.phase).toBe("EXPLORE")
    expect(envelope.agent).toBe("odoo_functional_consultant")

    const metrics = getMetricsBuffer()
    expect(metrics.length).toBe(1)
    expect(metrics[0].phase).toBe("EXPLORE")
    expect(metrics[0].agent).toBe("odoo_functional_consultant")
  })

  it("accepts PROPOSE phase and delegates to the proposal agent", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "proposed" })
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "PROPOSE", prompt: "Frame the business proposal", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("delegated")
    expect(envelope.phase).toBe("PROPOSE")
    expect(envelope.agent).toBe("odoo_functional_consultant")
    expect(getMetricsBuffer()[0].phase).toBe("PROPOSE")
  })
})

describe("createODFPolicyGate", () => {
  const originalHome = process.env.HOME
  let tempHome: string

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "odf-policy-tool-"))
    process.env.HOME = tempHome
    const configDir = path.join(tempHome, ".config", "opencode")
    await fs.mkdir(configDir, { recursive: true })
    await fs.copyFile(
      path.resolve(process.cwd(), "odf-registry.json"),
      path.join(configDir, "odf-registry.json")
    )
    vi.resetModules()
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await fs.rm(tempHome, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("persists the decision to <worktree>/.odf/policy-gate-{change}.json", async () => {
    const { createODFPolicyGate } = await import("./odf-delegation.js")
    const workspace = path.join(tempHome, "worktree")
    await fs.mkdir(workspace, { recursive: true })

    const gateTool = createODFPolicyGate()
    const output = await gateTool.execute({ change: "my-change", phase: "IMPLEMENT", workspace_dir: workspace }, {} as any)
    const decision = JSON.parse(output as string)
    expect(decision.gate).toBe("allow")
    expect(decision.change).toBe("my-change")
    expect(decision.phase).toBe("IMPLEMENT")
    expect(decision.tdd.effective).toBe("off")

    const saved = JSON.parse(
      await fs.readFile(path.join(workspace, ".odf", "policy-gate-my-change.json"), "utf8")
    )
    expect(saved.change).toBe("my-change")
    expect(saved.tdd.effective).toBe("off")
  })
})

describe("odf_delegate policy gate hook", () => {
  const originalHome = process.env.HOME
  let tempHome: string

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "odf-hook-"))
    process.env.HOME = tempHome
    const configDir = path.join(tempHome, ".config", "opencode")
    await fs.mkdir(configDir, { recursive: true })
    await fs.copyFile(
      path.resolve(process.cwd(), "odf-registry.json"),
      path.join(configDir, "odf-registry.json")
    )
    vi.resetModules()
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await fs.rm(tempHome, { recursive: true, force: true })
    vi.restoreAllMocks()
    const odfDir = path.join(process.cwd(), ".odf")
    await fs.rm(path.join(odfDir, "policy-gate-hook-test.json"), { force: true })
    try {
      await fs.rmdir(odfDir)
    } catch {
      // dir not empty or missing — leave it
    }
  })

  it("injects the frozen policy gate into the VERIFY delegation", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskResult = { status: "ok", executive_summary: "verified" }
    const taskApi = vi.fn().mockResolvedValue(taskResult)
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "VERIFY", prompt: "Change name: hook-test\nVerify the implementation", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("delegated")
    expect(envelope.policy_gate).toBeDefined()
    expect(envelope.policy_gate.phase).toBe("VERIFY")
    expect(envelope.policy_gate.frozen_diff_ref).toBeTruthy()

    const calledPrompt = taskApi.mock.calls[0][0].prompt
    expect(calledPrompt).toContain("## Policy Gate Decision (authoritative, do not recompute)")
    expect(calledPrompt).toContain(envelope.policy_gate.frozen_diff_ref)
  })
})

describe("validateValidationEvidence", () => {
  let tmp: string
  const now = new Date("2026-07-31T12:00:00Z")

  const writeEvidence = async (data: Record<string, unknown>, change = "ev-change") => {
    const dir = path.join(tmp, ".odf")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `validation-evidence-${change}.json`), JSON.stringify(data))
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-evidence-"))
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const validEvidence = (overrides: Record<string, unknown> = {}) => ({
    change: "ev-change",
    phase: "IMPLEMENT",
    batch: 1,
    risk_tier: "MEDIUM",
    frozen_diff_ref: null,
    resolved_at: "2026-07-31T11:30:00Z",
    commands: [
      { name: "git-diff-check", command: "git diff --check", exit_code: 0, output_tail: "" },
      { name: "odoo-tests", command: "odoo-bin --test-enable", exit_code: 0, output_tail: "12 passed, 0 failed" },
    ],
    ...overrides,
  })

  it("verifies a fresh, bound evidence file with enough passing commands", async () => {
    await writeEvidence(validEvidence())
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(verdict).toEqual({ status: "verified", reason: expect.stringContaining("2 command(s)"), commands_validated: 2 })
  })

  it("returns missing when the evidence file does not exist", () => {
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "nope", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(verdict.status).toBe("missing")
  })

  it("returns invalid for unparsable JSON", async () => {
    await writeEvidence({ not: "json", change: "ev-change" } as any)
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
  })

  it("rejects a change mismatch", async () => {
    await writeEvidence(validEvidence({ change: "other-change" }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("does not match")
  })

  it("rejects when frozen_diff_ref does not match the policy gate ref", async () => {
    await writeEvidence(validEvidence({ frozen_diff_ref: "abc123" }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: "def456", now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("frozen_diff_ref")
  })

  it("allows a null frozen ref (IMPLEMENT gates have no frozen ref)", async () => {
    await writeEvidence(validEvidence({ frozen_diff_ref: null }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(verdict.status).toBe("verified")
  })

  it("rejects stale evidence beyond the freshness window", async () => {
    await writeEvidence(validEvidence({ resolved_at: "2026-07-31T10:30:00Z" })) // 90 min old
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("stale")
  })

  it("rejects evidence with too few commands for the tier", async () => {
    await writeEvidence(validEvidence({ commands: [{ name: "git-diff-check", command: "git diff --check", exit_code: 0, output_tail: "" }] }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("tier MEDIUM requires at least 2")
  })

  it("rejects a command with a non-zero exit code", async () => {
    await writeEvidence(validEvidence({ commands: [
      { name: "git-diff-check", command: "git diff --check", exit_code: 0, output_tail: "" },
      { name: "odoo-tests", command: "odoo-bin --test-enable", exit_code: 1, output_tail: "2 failed" },
    ] }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("exited with 1")
  })

  it("rejects a known command whose output misses the success pattern", async () => {
    await writeEvidence(validEvidence({ commands: [
      { name: "git-diff-check", command: "git diff --check", exit_code: 0, output_tail: "" },
      { name: "odoo-tests", command: "odoo-bin --test-enable", exit_code: 0, output_tail: "3 FAILED" },
    ] }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("success pattern")
  })

  it("requires HIGH tier to have 3+ commands", async () => {
    await writeEvidence(validEvidence())
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "HIGH", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("tier HIGH requires at least 3")
  })
})

describe("odf_delegate stop-validation seal", () => {
  const originalHome = process.env.HOME
  let tempHome: string
  const odfDir = path.join(process.cwd(), ".odf")

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "odf-seal-"))
    process.env.HOME = tempHome
    const configDir = path.join(tempHome, ".config", "opencode")
    await fs.mkdir(configDir, { recursive: true })
    await fs.copyFile(
      path.resolve(process.cwd(), "odf-registry.json"),
      path.join(configDir, "odf-registry.json")
    )
    vi.resetModules()
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await fs.rm(tempHome, { recursive: true, force: true })
    await fs.rm(path.join(odfDir, "policy-gate-seal-test.json"), { force: true })
    await fs.rm(path.join(odfDir, "validation-evidence-seal-test.json"), { force: true })
    vi.restoreAllMocks()
  })

  it("stamps validation=missing on IMPLEMENT when no evidence file exists", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "done" })
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "IMPLEMENT", prompt: "Change name: seal-test\nImplement tasks", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.validation).toBeDefined()
    expect(envelope.validation.status).toBe("missing")
  })

  it("stamps validation=verified on IMPLEMENT when evidence passes", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    await fs.mkdir(odfDir, { recursive: true })
    await fs.writeFile(
      path.join(odfDir, "validation-evidence-seal-test.json"),
      JSON.stringify({
        change: "seal-test",
        phase: "IMPLEMENT",
        batch: 1,
        risk_tier: "MEDIUM",
        frozen_diff_ref: null,
        resolved_at: new Date().toISOString(),
        commands: [
          { name: "git-diff-check", command: "git diff --check", exit_code: 0, output_tail: "" },
          { name: "odoo-tests", command: "odoo-bin --test-enable", exit_code: 0, output_tail: "12 passed, 0 failed" },
        ],
      })
    )
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "done" })
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "IMPLEMENT", prompt: "Change name: seal-test\nImplement tasks", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.validation).toBeDefined()
    expect(envelope.validation.status).toBe("verified")
  })

  it("does not stamp validation on non-IMPLEMENT phases", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "planned" })
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design the change", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.validation).toBeNull()
  })
})

describe("mergeReceipt", () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-receipt-"))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const receipt = (overrides: Record<string, unknown> = {}) => ({
    change: "rc-test",
    phase: "VERIFY",
    status: "failed",
    cause: "validation-failed",
    evidence: { summary: "compliance failed", frozen_diff_ref: "abc123", failing: ["odoo-tests"], refs: ["odf/rc-test/verify-report"] },
    action: null,
    review_gate: { attempts_used: 1, budget_lines: 12, verdict: "FAIL" },
    frozen_diff_ref: "abc123",
    resolved_at: "2026-07-31T12:00:00Z",
    ...overrides,
  })

  it("writes a new receipt to <worktree>/.odf/receipt-{change}.json", () => {
    const saved = mergeReceipt(tmp, receipt() as any)
    expect(saved.status).toBe("failed")
    const onDisk = JSON.parse(fsSync.readFileSync(path.join(tmp, ".odf", "receipt-rc-test.json"), "utf8"))
    expect(onDisk.cause).toBe("validation-failed")
  })

  it("does not clobber an existing action with an action-less update", () => {
    mergeReceipt(tmp, receipt({ action: { committed: "re-plan", user_decision: "re-plan the batch" } }) as any)
    const incoming = receipt({ status: "blocked", cause: "scope-change" }) as any
    const result = mergeReceipt(tmp, incoming)
    expect(result.action?.committed).toBe("re-plan")
    const onDisk = JSON.parse(fsSync.readFileSync(path.join(tmp, ".odf", "receipt-rc-test.json"), "utf8"))
    expect(onDisk.action.committed).toBe("re-plan")
    expect(onDisk.status).toBe("failed") // original retained
  })

  it("allows a retry to refresh the receipt", () => {
    mergeReceipt(tmp, receipt({ action: { committed: "re-plan" } }) as any)
    const incoming = receipt({ action: { committed: "retry" } }) as any
    const result = mergeReceipt(tmp, incoming)
    expect(result.action?.committed).toBe("retry")
  })

  it("returns the incoming receipt when no prior receipt exists", () => {
    const incoming = receipt({ change: "rc-new" }) as any
    const result = mergeReceipt(tmp, incoming)
    expect(result.change).toBe("rc-new")
    expect(result.status).toBe("failed")
  })
})

describe("odf_delegate receipt auto-seal on error", () => {
  const originalHome = process.env.HOME
  let tempHome: string
  const odfDir = path.join(process.cwd(), ".odf")

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "odf-rseal-"))
    process.env.HOME = tempHome
    const configDir = path.join(tempHome, ".config", "opencode")
    await fs.mkdir(configDir, { recursive: true })
    await fs.copyFile(
      path.resolve(process.cwd(), "odf-registry.json"),
      path.join(configDir, "odf-registry.json")
    )
    vi.resetModules()
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await fs.rm(tempHome, { recursive: true, force: true })
    await fs.rm(path.join(odfDir, "policy-gate-rseal.json"), { force: true })
    await fs.rm(path.join(odfDir, "receipt-rseal.json"), { force: true })
    vi.restoreAllMocks()
  })

  it("writes a failed receipt when the task API rejects", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockRejectedValue(new Error("task() timed out after 120000ms"))
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "IMPLEMENT", prompt: "Change name: rseal\nImplement tasks", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("timeout")

    const receiptFile = path.join(odfDir, "receipt-rseal.json")
    expect(fsSync.existsSync(receiptFile)).toBe(true)
    const receipt = JSON.parse(fsSync.readFileSync(receiptFile, "utf8"))
    expect(receipt.status).toBe("failed")
    expect(receipt.cause).toBe("timeout")
    expect(receipt.action).toBeNull()
    expect(receipt.change).toBe("rseal")
  })
})

describe("createODFReceipt tool", () => {
  const originalHome = process.env.HOME
  let tempHome: string

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "odf-rtool-"))
    process.env.HOME = tempHome
    const configDir = path.join(tempHome, ".config", "opencode")
    await fs.mkdir(configDir, { recursive: true })
    await fs.copyFile(
      path.resolve(process.cwd(), "odf-registry.json"),
      path.join(configDir, "odf-registry.json")
    )
    vi.resetModules()
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await fs.rm(tempHome, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("persists a receipt via the tool", async () => {
    const { createODFReceipt } = await import("./odf-delegation.js")
    const workspace = path.join(tempHome, "worktree")
    await fs.mkdir(workspace, { recursive: true })

    const receiptTool = createODFReceipt()
    const output = await receiptTool.execute(
      { change: "my-change", phase: "VERIFY", status: "failed", cause: "validation-failed", evidence_summary: "compliance failed", failing: ["odoo-tests"], refs: ["odf/my-change/verify-report"], workspace_dir: workspace },
      {} as any
    )
    const receipt = JSON.parse(output as string)
    expect(receipt.status).toBe("failed")
    expect(receipt.cause).toBe("validation-failed")
    expect(receipt.review_gate?.verdict).toBe("FAIL")

    const saved = JSON.parse(
      await fs.readFile(path.join(workspace, ".odf", "receipt-my-change.json"), "utf8")
    )
    expect(saved.evidence.failing).toContain("odoo-tests")
    expect(saved.action).toBeNull()
  })
})
