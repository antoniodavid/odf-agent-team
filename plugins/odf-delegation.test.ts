import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as os from "node:os"

// These pure functions do not depend on the registry file path, so they can be
// imported normally. createODFDelegate is imported dynamically in its own tests
// so we can control $HOME and therefore REGISTRY_PATH.
import {
  resolvePath,
  matchSkills,
  resolveAgent,
  formatCompactRules,
  invokeTask,
  findTaskApi,
  getProfileByPhase,
  ALLOWED_PHASES,
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

  it("passes absolute paths through unchanged", () => {
    expect(resolvePath(registryDir, "/absolute/path/to/skill.md")).toBe("/absolute/path/to/skill.md")
  })

  it("expands ~/ to the user home directory", () => {
    expect(resolvePath(registryDir, "~/Workspace/skill.md")).toBe(path.join(os.homedir(), "Workspace/skill.md"))
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

describe("resolveAgent", () => {
  it("returns default agents when keywords are empty", () => {
    expect(resolveAgent(baseRegistry, "ASSESS", [])).toBe("odoo_functional_consultant")
    expect(resolveAgent(baseRegistry, "DESIGN", [])).toBe("odoo_backend_engineer")
    expect(resolveAgent(baseRegistry, "IMPLEMENT", [])).toBe("odoo_backend_engineer")
    expect(resolveAgent(baseRegistry, "VERIFY", [])).toBe("odoo_qa_engineer")
  })

  it("matches custom agents by description keywords", () => {
    expect(resolveAgent(baseRegistry, "DESIGN", ["OWL", "component", "JavaScript"])).toBe("odoo_frontend_engineer")
    expect(resolveAgent(baseRegistry, "DESIGN", ["lot", "serial", "stock", "tracking"])).toBe("odoo_stock_lot_specialist")
  })

  it("falls back to phase default when no custom agent matches", () => {
    expect(resolveAgent(baseRegistry, "ASSESS", ["model", "python", "security"])).toBe("odoo_functional_consultant")
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
    expect(output).toContain("---ENCRYPTED_PROMPT_START---")

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
})
