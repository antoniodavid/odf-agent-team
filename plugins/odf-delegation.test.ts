import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as os from "node:os"
import { execSync } from "node:child_process"
import YAML from "yaml"

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
  loadEngramStatus,
  validateValidationEvidence,
  mergeReceipt,
  createODFWorkflowAdvance,
  createODFWorkflowBind,
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

describe("createODFWorkflowAdvance", () => {
  it("registers a read-only tool that resolves and advances a route", async () => {
    const output = await createODFWorkflowAdvance().execute({
      work_type: "feature",
      completed_stages: ["DECIDE"],
      candidate_stage: "PLAN",
      phase_result_status: "ok",
      validation_status: "not-required",
      receipt_state: "none",
      resumable_state: true,
      archived_state: false,
    }, {} as any)

    expect(JSON.parse(output as string)).toEqual({
      status: "advanced",
      completed_stages: ["DECIDE", "PLAN"],
      next_stage: "BUILD",
      reason: "Advanced to BUILD.",
    })
  })

  it("returns a blocked result without invoking persistence for invalid transitions", async () => {
    const output = await createODFWorkflowAdvance().execute({
      work_type: "bugfix",
      completed_stages: [],
      candidate_stage: "BUILD",
      phase_result_status: "ok",
      validation_status: "missing",
      receipt_state: "pending",
      resumable_state: true,
      archived_state: false,
    }, {} as any)

    expect(JSON.parse(output as string)).toMatchObject({
      status: "blocked",
      reason: "A receipt is pending user disposition.",
    })
  })
})

describe("createODFWorkflowBind", () => {
  it("writes only the explicit route fields and preserves existing state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-workflow-bind-"))
    const changeDir = path.join(root, "openspec", "changes", "bound-change")
    await fs.mkdir(changeDir, { recursive: true })
    const before = [
      "# keep this comment",
      "canonical_stage: PLAN",
      "preflight:",
      "  solution_strategy: custom",
      "artifacts:",
      "  plan: done",
      "",
    ].join("\n")
    const statePath = path.join(changeDir, "state.yaml")
    await fs.writeFile(statePath, before, "utf8")

    try {
      const output = await createODFWorkflowBind().execute({
        change_name: "bound-change",
        work_type: "feature",
        workspace_dir: root,
      }, {} as any)
      expect(JSON.parse(output as string)).toMatchObject({
        status: "bound",
        change_name: "bound-change",
        work_type: "feature",
        preflight_mirrored: true,
      })

      const after = YAML.parse(await fs.readFile(statePath, "utf8"))
      const original = YAML.parse(before)
      expect(after.work_type).toBe("feature")
      expect(after.preflight.work_type).toBe("feature")
      delete after.work_type
      delete after.preflight.work_type
      expect(after).toEqual(original)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("blocks missing, malformed, unsafe, and invalid binding inputs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-workflow-bind-blocked-"))
    const changeDir = path.join(root, "openspec", "changes", "broken-change")
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), "canonical_stage: [PLAN\n", "utf8")

    try {
      const bind = createODFWorkflowBind()
      await expect(bind.execute({ change_name: "missing-change", work_type: "feature", workspace_dir: root }, {} as any))
        .resolves.toMatch(/state-not-found/)
      await expect(bind.execute({ change_name: "broken-change", work_type: "feature", workspace_dir: root }, {} as any))
        .resolves.toMatch(/malformed-state/)
      await expect(bind.execute({ change_name: "../outside", work_type: "feature", workspace_dir: root }, {} as any))
        .resolves.toMatch(/unsafe-change-path/)
      await expect(bind.execute({ change_name: "broken-change", work_type: "not-a-route", workspace_dir: root }, {} as any))
        .resolves.toMatch(/invalid-work-type/)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

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

  it.each([null, undefined, "   ", {}])("rejects unusable task results: %j", async result => {
    const taskApi = vi.fn().mockResolvedValue(result)
    await expect(invokeTask(taskApi, "odoo_backend_engineer", "build a model")).rejects.toThrow("empty-task-result")
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("treats cancellation as terminal without retrying", async () => {
    const taskApi = vi.fn().mockResolvedValue({ status: "cancelled" })
    await expect(invokeTask(taskApi, "odoo_backend_engineer", "build a model")).rejects.toThrow("task-cancelled")
    expect(taskApi).toHaveBeenCalledTimes(1)
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

async function configureEngramExport(observations: Array<Record<string, unknown>>): Promise<() => Promise<void>> {
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-cli-"))
  const cliPath = path.join(binDir, "engram")
  await fs.writeFile(
    cliPath,
    "#!/bin/sh\nif [ \"$1\" = \"export\" ]; then\n  printf '%s' \"$ODF_TEST_ENGRAM_EXPORT\" > \"$5\"\nfi\n",
    "utf8"
  )
  await fs.chmod(cliPath, 0o755)

  const originalPath = process.env.PATH
  const originalExport = process.env.ODF_TEST_ENGRAM_EXPORT
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ""}`
  process.env.ODF_TEST_ENGRAM_EXPORT = JSON.stringify(observations)

  return async () => {
    process.env.PATH = originalPath
    if (originalExport === undefined) delete process.env.ODF_TEST_ENGRAM_EXPORT
    else process.env.ODF_TEST_ENGRAM_EXPORT = originalExport
    await fs.rm(binDir, { recursive: true, force: true })
  }
}

describe("loadEngramStatus", () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-status-"))
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("selects the change with the newest artifact timestamp and recognizes propose", async () => {
    const workspace = path.join(tmp, "repo")
    initGitRepo(workspace)
    commitFile(workspace, "README.md", 1)
    const cleanup = await configureEngramExport([
      { topic_key: "odf/older/assess", content: "", created_at: "2026-07-31T10:00:00Z" },
      { topic_key: "odf/older/design", content: "", created_at: "2026-07-31T10:01:00Z" },
      { topic_key: "odf/older/verify-report", content: "", created_at: "2026-07-31T10:02:00Z" },
      { topic_key: "odf/newer/propose", content: "", created_at: "2026-07-31T11:00:00Z" },
    ])

    try {
      const status = await loadEngramStatus(workspace)
      expect(status?.change).toBe("newer")
      expect(status?.phase).toBe("propose")
      expect(status?.lastUpdated).toBe("2026-07-31T11:00:00Z")
    } finally {
      await cleanup()
    }
  })

  it("uses canonical implement-progress and falls back to apply-progress", async () => {
    const workspace = path.join(tmp, "repo")
    initGitRepo(workspace)
    commitFile(workspace, "README.md", 1)
    const cleanup = await configureEngramExport([
      { topic_key: "odf/canonical/implement-progress", content: "- [x] first\n- [ ] second", created_at: "2026-07-31T11:00:00Z" },
      { topic_key: "odf/canonical/apply-progress", content: "- [x] legacy\n- [x] ignored", created_at: "2026-07-31T11:01:00Z" },
      { topic_key: "odf/legacy/apply-progress", content: "- [x] first\n- [ ] second", created_at: "2026-07-31T11:02:00Z" },
    ])

    try {
      const canonical = await loadEngramStatus(workspace, "canonical")
      expect(canonical?.applyProgress).toEqual({ completed: 1, total: 2 })

      const legacy = await loadEngramStatus(workspace, "legacy")
      expect(legacy?.applyProgress).toEqual({ completed: 1, total: 2 })
    } finally {
      await cleanup()
    }
  })
})

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

  const workflowAdvance = (phase: "IMPLEMENT" | "VERIFY") => phase === "IMPLEMENT"
    ? {
        work_type: "feature" as const,
        completed_stages: ["DECIDE" as const],
        candidate_stage: "PLAN" as const,
        phase_result_status: "ok" as const,
        validation_status: "not-required" as const,
        receipt_state: "none" as const,
        resumable_state: true,
        archived_state: false,
      }
    : {
        work_type: "feature" as const,
        completed_stages: ["DECIDE" as const, "PLAN" as const],
        candidate_stage: "BUILD" as const,
        phase_result_status: "ok" as const,
        validation_status: "verified" as const,
        receipt_state: "none" as const,
        resumable_state: true,
        archived_state: false,
      }

  const parallelWorkflowAdvance = () => ({
    work_type: "cross-domain" as const,
    completed_stages: ["DECIDE" as const],
    candidate_stage: "PLAN" as const,
    phase_result_status: "ok" as const,
    validation_status: "not-required" as const,
    receipt_state: "none" as const,
    resumable_state: true,
    archived_state: false,
  })

  const writeEvidenceFile = async (change: string, fileName: string) => {
    await fs.mkdir(path.join(tempHome, ".odf"), { recursive: true })
    await fs.writeFile(
      path.join(tempHome, ".odf", fileName),
      JSON.stringify({
        change,
        phase: "IMPLEMENT",
        batch: 1,
        risk_tier: "MEDIUM",
        frozen_diff_ref: null,
        resolved_at: new Date().toISOString(),
        commands: [
          { name: "git-diff-check", command: "git diff --check", exit_code: 0, output_tail: "" },
          { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "2 passed, 0 failed" },
        ],
      }),
      "utf8",
    )
  }

  const writeValidationEvidence = (change: string) =>
    writeEvidenceFile(change, `validation-evidence-${change}.json`)

  const writeParallelEvidence = (change: string, branchIds: string[]) =>
    Promise.all(branchIds.map(branchId =>
      writeEvidenceFile(change, `validation-evidence-${change}-${branchId}.json`)
    ))

  const parallelBranches = (suffix: string) => [
    { branch_id: `backend-${suffix}`, attempt_id: `backend-attempt-${suffix}`, prompt: "Implement the backend branch", context_files: [`backend-${suffix}.py`] },
    { branch_id: `frontend-${suffix}`, attempt_id: `frontend-attempt-${suffix}`, prompt: "Implement the frontend branch", context_files: [`frontend-${suffix}.js`] },
  ]

  it("returns a delegated result envelope when task() is available without workflow input", async () => {
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
    expect(envelope.workflow_advance).toBeUndefined()

    const metrics = getMetricsBuffer()
    expect(metrics.length).toBe(1)
    expect(metrics[0].status).toBe("ok")
    expect(metrics[0].phase).toBe("ASSESS")
    expect(metrics[0].agent).toBe("odoo_functional_consultant")
    expect(metrics[0].task_api_source).toBe("toolCtx.task")
  })

  it("allows IMPLEMENT when PLAN advances to BUILD", async () => {
    const { createODFDelegate, clearMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "implemented" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute(
      {
        phase: "IMPLEMENT",
        change: "gate-build",
        attempt_id: "build-1",
        prompt: "Implement the planned change",
        context_files: [],
        workflow_advance: {
          work_type: "feature",
          completed_stages: ["DECIDE"],
          candidate_stage: "PLAN",
          phase_result_status: "ok",
          validation_status: "not-required",
          receipt_state: "none",
          resumable_state: true,
          archived_state: false,
        },
      },
      { sessionID: "s1", task: taskApi } as any,
    )

    expect(JSON.parse(output as string).status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("acquires the first attempt and appends a completed settlement", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    await writeValidationEvidence("attempt-first")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "implemented" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "attempt-first",
      attempt_id: "attempt-1",
      prompt: "Do not store this prompt or its secret in the ledger",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)

    const ledgerPath = path.join(tempHome, ".odf", "attempt-ledger-attempt-first.jsonl")
    const records = (await fs.readFile(ledgerPath, "utf8")).trim().split("\n").map(line => JSON.parse(line))
    expect(records.map(record => record.status)).toEqual(["running", "completed"])
    expect(records[0]).toMatchObject({ attempt_id: "attempt-1", change: "attempt-first", phase: "IMPLEMENT", next_stage: "BUILD" })
    expect(records[1].result_status).toBe("delegated")
    expect(await fs.readFile(ledgerPath, "utf8")).not.toContain("secret")
    expect(fsSync.existsSync(`${ledgerPath}.lock`)).toBe(false)
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("blocks a duplicate attempt_id before task()", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const input = {
      phase: "IMPLEMENT",
      change: "attempt-duplicate",
      attempt_id: "duplicate-1",
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }

    expect(JSON.parse(await delegateTool.execute(input, { sessionID: "s1", task: taskApi } as any) as string).status).toBe("delegated")
    const blocked = JSON.parse(await delegateTool.execute(input, { sessionID: "s1", task: taskApi } as any) as string)
    expect(blocked).toMatchObject({ status: "blocked", reason: "attempt-id-reused" })
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("blocks a new attempt after the phase is completed", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const base = { phase: "VERIFY", change: "attempt-complete", prompt: "Verify the change", context_files: [], workflow_advance: workflowAdvance("VERIFY") }

    await delegateTool.execute({ ...base, attempt_id: "verify-1" }, { sessionID: "s1", task: taskApi } as any)
    const blocked = JSON.parse(await delegateTool.execute({ ...base, attempt_id: "verify-2" }, { sessionID: "s1", task: taskApi } as any) as string)
    expect(blocked).toMatchObject({ status: "blocked", reason: "attempt-phase-completed" })
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("blocks a second attempt while the first is running", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    let resolveTask!: (value: unknown) => void
    const taskApi = vi.fn().mockReturnValue(new Promise(resolve => { resolveTask = resolve }))
    const delegateTool = createODFDelegate(undefined, tempHome)
    const first = delegateTool.execute({
      phase: "IMPLEMENT",
      change: "attempt-running",
      attempt_id: "running-1",
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
      timeout_ms: 5_000,
    }, { sessionID: "s1", task: taskApi } as any)
    await vi.waitFor(() => expect(taskApi).toHaveBeenCalledTimes(1))

    const blocked = JSON.parse(await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "attempt-running",
      attempt_id: "running-2",
      prompt: "Implement the change again",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any) as string)
    expect(blocked).toMatchObject({ status: "blocked", reason: "attempt-phase-running" })
    expect(taskApi).toHaveBeenCalledTimes(1)
    resolveTask({ status: "ok" })
    await first
  })

  it("fails closed when another process holds the attempt ledger lock", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const ledgerPath = path.join(tempHome, ".odf", "attempt-ledger-lock-contention.jsonl")
    const lockPath = `${ledgerPath}.lock`
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true })
    await fs.writeFile(lockPath, "held\n")

    const output = await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "lock-contention",
      attempt_id: "lock-1",
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)

    expect(JSON.parse(output as string)).toMatchObject({ status: "blocked", reason: "attempt-ledger-locked" })
    expect(taskApi).not.toHaveBeenCalled()
    expect(await fs.readFile(lockPath, "utf8")).toBe("held\n")
  })

  it("allows a new attempt only after the previous attempt failed", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn()
      .mockRejectedValueOnce(new Error("task service down"))
      .mockResolvedValueOnce({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const base = { phase: "IMPLEMENT", change: "attempt-failed", prompt: "Implement the change", context_files: [], workflow_advance: workflowAdvance("IMPLEMENT") }

    const first = JSON.parse(await delegateTool.execute({ ...base, attempt_id: "failed-1" }, { sessionID: "s1", task: taskApi } as any) as string)
    await writeValidationEvidence("attempt-failed")
    const second = JSON.parse(await delegateTool.execute({ ...base, attempt_id: "failed-2" }, { sessionID: "s1", task: taskApi } as any) as string)
    const ledgerPath = path.join(tempHome, ".odf", "attempt-ledger-attempt-failed.jsonl")
    const records = (await fs.readFile(ledgerPath, "utf8")).trim().split("\n").map(line => JSON.parse(line))
    expect(first.status).toBe("error")
    expect(second.status).toBe("delegated")
    expect(records.map(record => record.status)).toEqual(["running", "failed", "running", "completed"])
    expect(records[1].result_status).toBe("error")
    expect(taskApi).toHaveBeenCalledTimes(2)
  })

  it("settles missing IMPLEMENT validation as failed and allows a fresh retry", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "implemented" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const base = { phase: "IMPLEMENT", change: "validation-retry", prompt: "Implement the change", context_files: [], workflow_advance: workflowAdvance("IMPLEMENT") }

    const first = JSON.parse(await delegateTool.execute({ ...base, attempt_id: "validation-retry-1" }, { sessionID: "s1", task: taskApi } as any) as string)
    expect(first).toMatchObject({ status: "delegated", validation: { status: "missing" } })

    const firstLedger = (await fs.readFile(path.join(tempHome, ".odf", "attempt-ledger-validation-retry.jsonl"), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(firstLedger.at(-1)).toMatchObject({ status: "failed", reason: "validation-failed", result_status: "validation-failed" })

    await writeValidationEvidence("validation-retry")
    const second = JSON.parse(await delegateTool.execute({ ...base, attempt_id: "validation-retry-2" }, { sessionID: "s1", task: taskApi } as any) as string)
    expect(second).toMatchObject({ status: "delegated", validation: { status: "verified" } })
    expect(taskApi).toHaveBeenCalledTimes(2)
  })

  it.each([
    ["bad attempt", "safe-change", "../attempt", "attempt-id-required"],
    ["bad change", "../unsafe", "safe-attempt", "unsafe-change-name"],
  ])("rejects %s tokens before creating the ledger", async (_label, change, attemptId, reason) => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const output = await delegateTool.execute({
      phase: "IMPLEMENT",
      change,
      attempt_id: attemptId,
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)

    expect(JSON.parse(output as string)).toMatchObject({ status: "blocked", reason })
    expect(taskApi).not.toHaveBeenCalled()
    expect(fsSync.existsSync(path.join(tempHome, ".odf"))).toBe(false)
  })

  it("requires attempt_id only for explicit gated workflow delegation", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const gatedOutput = await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "explicit-attempt-required",
      prompt: "Implement the explicitly gated call",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)
    expect(JSON.parse(gatedOutput as string)).toMatchObject({ status: "blocked", reason: "attempt-id-required" })
    expect(taskApi).not.toHaveBeenCalled()

    const output = await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "legacy-compatible",
      prompt: "Implement the legacy call",
      context_files: [],
    }, { sessionID: "s1", task: taskApi } as any)

    expect(JSON.parse(output as string).status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
    expect(fsSync.existsSync(path.join(tempHome, ".odf", "attempt-ledger-legacy-compatible.jsonl"))).toBe(false)
  })

  it("treats legacy ledger records without branch_id as the default branch", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const ledgerPath = path.join(tempHome, ".odf", "attempt-ledger-legacy-record.jsonl")
    const timestamp = new Date().toISOString()
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true })
    await fs.writeFile(ledgerPath, `${JSON.stringify({
      attempt_id: "legacy-attempt",
      change: "legacy-record",
      phase: "IMPLEMENT",
      next_stage: "BUILD",
      status: "completed",
      started_at: timestamp,
      updated_at: timestamp,
      settled_at: timestamp,
      reason: "task-completed",
      result_status: "delegated",
    })}\n`, "utf8")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "legacy-record",
      attempt_id: "new-attempt",
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)

    expect(JSON.parse(output as string)).toMatchObject({ status: "blocked", reason: "attempt-phase-completed" })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("allows VERIFY when BUILD advances to VERIFY", async () => {
    const { createODFDelegate, clearMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "verified" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute(
      {
        phase: "VERIFY",
        change: "gate-verify",
        attempt_id: "verify-1",
        prompt: "Verify the implementation",
        context_files: [],
        workflow_advance: {
          work_type: "feature",
          completed_stages: ["DECIDE", "PLAN"],
          candidate_stage: "BUILD",
          phase_result_status: "ok",
          validation_status: "verified",
          receipt_state: "none",
          resumable_state: true,
          archived_state: false,
        },
      },
      { sessionID: "s1", task: taskApi } as any,
    )

    expect(JSON.parse(output as string).status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("allows the initial VERIFY start for verify-only", async () => {
    const { createODFDelegate, clearMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "verified" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute(
      {
        phase: "VERIFY",
        change: "gate-verify-only",
        attempt_id: "verify-only-1",
        prompt: "Verify the existing implementation",
        context_files: [],
        workflow_advance: {
          work_type: "verify-only",
          completed_stages: [],
          candidate_stage: null,
          phase_result_status: "ok",
          validation_status: "verified",
          receipt_state: "none",
          resumable_state: true,
          archived_state: false,
        },
      },
      { sessionID: "s1", task: taskApi } as any,
    )

    expect(JSON.parse(output as string).status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("blocks an out-of-order workflow transition before task()", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute(
      {
        phase: "IMPLEMENT",
        change: "gate-order",
        attempt_id: "order-1",
        prompt: "Implement the change",
        context_files: [],
        workflow_advance: {
          work_type: "feature",
          completed_stages: ["DECIDE"],
          candidate_stage: "BUILD",
          phase_result_status: "ok",
          validation_status: "verified",
          receipt_state: "none",
          resumable_state: true,
          archived_state: false,
        },
      },
      { sessionID: "s1", task: taskApi } as any,
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("blocked")
    expect(envelope.reason).toBe("workflow-advance-blocked")
    expect(envelope.workflow_advance.status).toBe("blocked")
    expect(taskApi).not.toHaveBeenCalled()
    expect(getMetricsBuffer()).toHaveLength(1)
    expect(getMetricsBuffer()[0].status).toBe("blocked")
    expect(fsSync.existsSync(path.join(tempHome, ".odf"))).toBe(false)
  })

  it("blocks when the validated next stage does not match the delegated phase", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute(
      {
        phase: "VERIFY",
        attempt_id: "mismatch-1",
        prompt: "Verify the implementation",
        context_files: [],
        workflow_advance: {
          work_type: "feature",
          completed_stages: ["DECIDE"],
          candidate_stage: "PLAN",
          phase_result_status: "ok",
          validation_status: "not-required",
          receipt_state: "none",
          resumable_state: true,
          archived_state: false,
        },
      },
      { sessionID: "s1", task: taskApi } as any,
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("blocked")
    expect(envelope.reason).toBe("workflow-phase-mismatch")
    expect(envelope.workflow_advance.next_stage).toBe("BUILD")
    expect(envelope.message).toContain("expected VERIFY")
    expect(taskApi).not.toHaveBeenCalled()
    expect(getMetricsBuffer()[0].status).toBe("blocked")
  })

  it("blocks a supplied workflow gate for composite legacy adapters", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute(
      {
        phase: "DESIGN",
        attempt_id: "design-1",
        prompt: "Design the implementation",
        context_files: [],
        workflow_advance: {
          work_type: "feature",
          completed_stages: ["DECIDE"],
          candidate_stage: "PLAN",
          phase_result_status: "ok",
          validation_status: "not-required",
          receipt_state: "none",
          resumable_state: true,
          archived_state: false,
        },
      },
      { sessionID: "s1", task: taskApi } as any,
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("blocked")
    expect(envelope.reason).toBe("workflow-gate-unsupported-phase")
    expect(envelope.message).toContain("DESIGN is a composite legacy adapter")
    expect(taskApi).not.toHaveBeenCalled()
    expect(getMetricsBuffer()[0].status).toBe("blocked")
  })

  it("delegates FIX through task() with the backend default agent", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "diagnosed" })
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "FIX", prompt: "Diagnose a backend bug", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("delegated")
    expect(envelope.phase).toBe("FIX")
    expect(envelope.agent).toBe("odoo_backend_engineer")
    expect(envelope.policy_gate).toBeNull()
    expect(envelope.task_api_source).toBe("toolCtx.task")
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it.each(["IMPLEMENT", "VERIFY"])("blocks %s when change is missing without invoking task()", async phase => {
    const { createODFDelegate, clearMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase, prompt: "Run the phase without a change identifier", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("error")
    expect(envelope.message).toContain("Missing change name")
    for (const key of [
      "status",
      "phase",
      "agent",
      "skills_injected",
      "profile",
      "policy_gate",
      "validation",
      "receipt",
      "task_api_source",
      "result",
      "message",
    ]) {
      expect(envelope).toHaveProperty(key)
    }
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("continues to delegate non-gated phases without a change", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "planned" })
    const toolCtx = { sessionID: "s1", task: taskApi } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design the implementation", context_files: [] },
      toolCtx
    )

    expect(JSON.parse(output as string).status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("returns a blocked envelope when task() is unavailable", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const toolCtx = { sessionID: "s1" } as any

    const delegateTool = createODFDelegate(undefined)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a new model", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("blocked")
    expect(envelope.reason).toBe("task-api-unavailable")
    expect(envelope.task_api_source).toBe("unavailable")
    expect(envelope.result).toBeNull()
    expect(envelope.message).toContain("Restart OpenCode")

    const metrics = getMetricsBuffer()
    expect(metrics.length).toBe(1)
    expect(metrics[0].status).toBe("blocked")
    expect(metrics[0].task_api_source).toBe("unavailable")
    expect(metrics[0].error).toBe("task-api-unavailable")
  })

  it("appends executor and database boundaries to delegated prompts", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "verified" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    await delegateTool.execute(
      { phase: "VERIFY", change: "boundary-test", prompt: "Verify the implementation", context_files: [] },
      { sessionID: "s1", task: taskApi } as any
    )

    const calledPrompt = taskApi.mock.calls[0][0].prompt
    expect(calledPrompt).toContain("## Executor Boundary (non-negotiable)")
    expect(calledPrompt).toContain("do not delegate")
    expect(calledPrompt).toContain("-d <test_db>")
    expect(calledPrompt).toContain("Never run dropdb")
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

  it("uses an explicit workspace directory for policy and evidence lookup", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const workspace = path.join(tempHome, "isolated-worktree")
    initGitRepo(workspace)
    commitFile(workspace, "README.md", 1)
    await fs.mkdir(path.join(workspace, ".odf"), { recursive: true })
    await fs.writeFile(
      path.join(workspace, ".odf", "validation-evidence-explicit-dir.json"),
      JSON.stringify({
        change: "explicit-dir",
        phase: "IMPLEMENT",
        batch: 1,
        risk_tier: "MEDIUM",
        frozen_diff_ref: null,
        resolved_at: new Date().toISOString(),
        commands: [
          { name: "git-diff-check", command: "git diff --check", exit_code: 0, output_tail: "" },
          { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "1 passed, 0 failed" },
        ],
      }),
      "utf8"
    )

    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "implemented" })
    const delegateTool = createODFDelegate(undefined, workspace)
    const output = await delegateTool.execute(
      { phase: "IMPLEMENT", change: "explicit-dir", prompt: "Implement the task", context_files: [] },
      { sessionID: "s1", task: taskApi } as any
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.policy_gate.change).toBe("explicit-dir")
    expect(envelope.validation.status).toBe("verified")
    expect(fsSync.existsSync(path.join(workspace, ".odf", "policy-gate-explicit-dir.json"))).toBe(true)
    expect(taskApi).toHaveBeenCalledTimes(1)
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

  it("runs two independent cross-domain BUILD branches and completes the join", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const branches = parallelBranches("success")
    await writeParallelEvidence("parallel-success", branches.map(branch => branch.branch_id))
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "branch implemented" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const output = await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-success",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any)

    const result = JSON.parse(output as string)
    expect(result.status).toBe("parallel-delegated")
    expect(result.join).toMatchObject({ status: "complete", expected: 2, completed: 2, failed: 0, validation_verified: true })
    expect(result.branches.map((branch: any) => branch.branch_id)).toEqual(["backend-success", "frontend-success"])
    expect(result.branches.every((branch: any) => branch.validation_verified)).toBe(true)
    expect(result.branches.map((branch: any) => branch.validation_evidence_ref)).toEqual([
      ".odf/validation-evidence-parallel-success-backend-success.json",
      ".odf/validation-evidence-parallel-success-frontend-success.json",
    ])
    expect(result.join.evidence_refs).toEqual(result.branches.map((branch: any) => branch.validation_evidence_ref))
    expect(taskApi).toHaveBeenCalledTimes(2)

    const ledger = (await fs.readFile(path.join(tempHome, ".odf", "attempt-ledger-parallel-success.jsonl"), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(ledger.filter((record: any) => record.status === "running")).toHaveLength(2)
    expect(ledger.map((record: any) => record.branch_id)).toEqual(expect.arrayContaining(["backend-success", "frontend-success"]))
  })

  it("isolates parallel validation evidence by branch and records each ref", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const change = "parallel-evidence-isolation"
    const branches = parallelBranches("evidence-isolation")
    await writeParallelEvidence(change, [branches[0].branch_id])
    await writeValidationEvidence(change)
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "branch implemented" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    const refs = branches.map(branch => `.odf/validation-evidence-${change}-${branch.branch_id}.json`)
    expect(result).toMatchObject({
      status: "blocked",
      reason: "parallel-validation-incomplete",
      join: { status: "blocked", completed: 2, failed: 0, validation_verified: false, evidence_refs: refs },
    })
    expect(result.branches.map((branch: any) => branch.validation_evidence_ref)).toEqual(refs)
    expect(result.branches.map((branch: any) => branch.validation_verified)).toEqual([true, false])
    const prompts = taskApi.mock.calls.map(call => call[0].prompt as string)
    expect(prompts.some(prompt => prompt.includes(refs[0]))).toBe(true)
    expect(prompts.some(prompt => prompt.includes(refs[1]))).toBe(true)

    const receipt = JSON.parse(await fs.readFile(path.join(tempHome, ".odf", `receipt-${change}.json`), "utf8"))
    expect(receipt.parallel.validation_evidence_refs).toEqual(refs)
    expect(receipt.evidence.refs).toEqual(expect.arrayContaining(refs))
  })

  it("rejects more than the fixed three-branch limit before task()", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)
    const branches = ["a", "b", "c", "d"].map(branch_id => ({
      branch_id,
      attempt_id: `${branch_id}-attempt`,
      prompt: "Implement branch",
      context_files: [`${branch_id}.py`],
    }))

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-too-many",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason: "parallel-branch-count" })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it.each([
    ["duplicate branch IDs", [{ branch_id: "same", attempt_id: "a1", prompt: "a" }, { branch_id: "same", attempt_id: "b1", prompt: "b" }], "duplicate-branch-id"],
    ["duplicate attempt IDs", [{ branch_id: "a", attempt_id: "same-attempt", prompt: "a" }, { branch_id: "b", attempt_id: "same-attempt", prompt: "b" }], "duplicate-attempt-id"],
    ["overlapping context paths", [{ branch_id: "a", attempt_id: "a1", prompt: "a", context_files: ["shared.py"] }, { branch_id: "b", attempt_id: "b1", prompt: "b", context_files: ["./shared.py"] }], "overlapping-context-paths"],
  ])("rejects %s before any branch task starts", async (_label, branches, reason) => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-invalid-input",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("keeps distinct branch attempts running concurrently in the ledger", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const branches = parallelBranches("running")
    await writeParallelEvidence("parallel-running", branches.map(branch => branch.branch_id))
    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    const taskApi = vi.fn()
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve }))
    const parallelTool = createODFParallelDelegate(undefined, tempHome)
    const run = parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-running",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any)

    await vi.waitFor(async () => {
      expect(taskApi).toHaveBeenCalledTimes(2)
      const ledger = (await fs.readFile(path.join(tempHome, ".odf", "attempt-ledger-parallel-running.jsonl"), "utf8"))
        .trim().split("\n").map(line => JSON.parse(line))
      expect(ledger.filter((record: any) => record.status === "running").map((record: any) => record.branch_id))
        .toEqual(expect.arrayContaining(["backend-running", "frontend-running"]))
    })
    resolveFirst({ status: "ok" })
    resolveSecond({ status: "ok" })
    expect(JSON.parse(await run as string).join.status).toBe("complete")
  })

  it("blocks a completed branch without blocking a different branch ID", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const branches = parallelBranches("ledger-a")
    await writeParallelEvidence("parallel-branch-ledger", branches.map(branch => branch.branch_id))
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)
    const first = await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-branch-ledger",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any)
    expect(JSON.parse(first as string).status).toBe("parallel-delegated")

    const sameBranch = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-branch-ledger",
      workflow_advance: parallelWorkflowAdvance(),
      branches: [
        { branch_id: "backend-ledger-a", attempt_id: "backend-attempt-new", prompt: "retry backend", context_files: ["new-backend.py"] },
        { branch_id: "frontend-ledger-b", attempt_id: "frontend-attempt-b", prompt: "new frontend", context_files: ["new-frontend.js"] },
      ],
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)
    expect(sameBranch).toMatchObject({ status: "blocked", reason: "attempt-phase-completed" })
    expect(taskApi).toHaveBeenCalledTimes(2)
    expect(JSON.parse(await fs.readFile(path.join(tempHome, ".odf", "receipt-parallel-branch-ledger.json"), "utf8")).parallel.branch_ids)
      .toEqual(expect.arrayContaining(["backend-ledger-a", "frontend-ledger-b"]))
  })

  it("returns one aggregate blocked result and receipt when a branch fails", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const branches = parallelBranches("failure")
    await writeParallelEvidence("parallel-failure", branches.map(branch => branch.branch_id))
    const taskApi = vi.fn().mockImplementation(({ prompt }: { prompt: string }) => {
      if (prompt.includes("backend")) return Promise.reject(new Error("backend branch failed"))
      return Promise.resolve({ status: "ok", executive_summary: "frontend done" })
    })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-failure",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason: "parallel-branch-failed", join: { status: "blocked", expected: 2, completed: 1, failed: 1 } })
    const receiptPath = path.join(tempHome, ".odf", "receipt-parallel-failure.json")
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"))
    expect(receipt.status).toBe("blocked")
    expect(receipt.parallel.branch_ids).toEqual(expect.arrayContaining(["backend-failure", "frontend-failure"]))
    expect(receipt.parallel.attempt_ledger_refs).toContain(".odf/attempt-ledger-parallel-failure.jsonl")
    expect(receipt.parallel.summaries["backend-failure"]).toContain("backend branch failed")
  })

  it("does not complete the join when branch validation is not verified", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "implemented without evidence" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-no-validation",
      workflow_advance: parallelWorkflowAdvance(),
      branches: parallelBranches("no-validation"),
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason: "parallel-validation-incomplete", join: { status: "blocked", expected: 2, completed: 2, failed: 0, validation_verified: false } })
    expect(result.branches.every((branch: any) => branch.status === "delegated")).toBe(true)
  })

  it("does not complete the join when the inner branch result fails", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const branches = parallelBranches("inner-failure")
    await writeParallelEvidence("parallel-inner-failure", branches.map(branch => branch.branch_id))
    const taskApi = vi.fn().mockResolvedValue({ status: "failed", message: "backend checks failed" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-inner-failure",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({
      status: "blocked",
      reason: "parallel-branch-failed",
      join: { status: "blocked", completed: 0, failed: 2, validation_verified: false },
    })
    expect(result.branches.every((branch: any) => branch.status === "delegated" && !branch.successful)).toBe(true)
    expect(JSON.parse(await fs.readFile(path.join(tempHome, ".odf", "receipt-parallel-inner-failure.json"), "utf8")).evidence.failing)
      .toEqual(expect.arrayContaining(["backend-inner-failure", "frontend-inner-failure"]))
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
      { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "12 passed, 0 failed" },
    ],
    ...overrides,
  })

  it("verifies a fresh, bound evidence file with enough passing commands", async () => {
    await writeEvidence(validEvidence())
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(verdict).toEqual({ status: "verified", reason: expect.stringContaining("2 command(s)"), commands_validated: 2 })
  })

  it("rejects Odoo test evidence without an explicit database", async () => {
    await writeEvidence(validEvidence({ commands: [
      { name: "git-diff-check", command: "git diff --check", exit_code: 0, output_tail: "" },
      { name: "odoo-tests", command: "odoo-bin --test-enable", exit_code: 0, output_tail: "12 passed, 0 failed" },
    ] }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("explicit isolated database")
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
      { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 1, output_tail: "2 failed" },
    ] }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("exited with 1")
  })

  it("rejects a known command whose output misses the success pattern", async () => {
    await writeEvidence(validEvidence({ commands: [
      { name: "git-diff-check", command: "git diff --check", exit_code: 0, output_tail: "" },
      { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "3 FAILED" },
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
          { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "12 passed, 0 failed" },
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
