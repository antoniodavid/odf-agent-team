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
  gitHead,
  getMetricsBufferCap,
  recordMetrics,
  getMetricsBuffer,
  clearMetricsBuffer,
  ALLOWED_PHASES,
  classifyRiskTier,
  classifyRiskTierWithContent,
  computePolicyGate,
  savePolicyGateJson,
  loadEngramStatus,
  createODFWorkflowStatus,
  createODFHealth,
  commitWorkflowTransition,
  resolveProofBackedLifecycle,
  validateValidationEvidence,
  mergeReceipt,
  createODFWorkflowAdvance,
  createODFWorkflowBind,
  createODFEntryTriage,
  createODFRuntimeHooks,
  createStableDiscoveryGuard,
  ODF_REGISTERED_TOOLS,
  type PolicyGateDecision,
  type ODFRegistry,
  type ODFSkill,
  type ODFAgent,
} from "./odf-delegation.js"
import { advanceWorkflow, resolveWorkflowRoute } from "./odf-workflow.js"
import { buildCandidateManifest, computeCandidateDigest } from "./candidate-manifest.js"

// T6: these describes exercise post-gate gated-phase internals that predate the
// strict_workflow default; they run under the sanctioned legacy opt-out flag.
const writeRegistryFlags = async (home: string, flags: Record<string, boolean>): Promise<void> => {
  const registryPath = path.join(home, ".config", "opencode", "odf-registry.json")
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
  registry.flags = { ...registry.flags, ...flags }
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf8")
}

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

async function configureFakeEngram(): Promise<{
  logPath: string
  cleanup: () => Promise<void>
  setFailure: (enabled: boolean) => void
  setFailureTopic: (topic: string | null) => void
  setObservations: (observations: Array<Record<string, unknown>>) => Promise<void>
}> {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "odf-fake-engram-bin-"))
  const cli = path.join(bin, "engram")
  const logPath = path.join(bin, "calls.json")
  const storePath = path.join(bin, "observations.json")
  const previous = {
    PATH: process.env.PATH,
    log: process.env.ODF_TEST_ENGRAM_LOG,
    store: process.env.ODF_TEST_ENGRAM_STORE,
    fail: process.env.ODF_TEST_ENGRAM_FAIL,
  }
  const script = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
const logPath = process.env.ODF_TEST_ENGRAM_LOG
const storePath = process.env.ODF_TEST_ENGRAM_STORE
const calls = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, "utf8")) : []
calls.push(args)
fs.writeFileSync(logPath, JSON.stringify(calls))
const flag = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
if (args[0] === "save") {
  const topic = flag("--topic")
  if (process.env.ODF_TEST_ENGRAM_FAIL === "1" || process.env.ODF_TEST_ENGRAM_FAIL === topic) process.exit(17)
  const observations = fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, "utf8")) : []
  fs.writeFileSync(storePath, JSON.stringify([...observations.filter(item => item.topic_key !== topic), {
    topic_key: topic,
    content: args[2],
    created_at: "2026-08-07T00:00:00.000Z"
  }]))
  process.exit(0)
}
if (args[0] === "export") {
  const observations = fs.existsSync(storePath) ? fs.readFileSync(storePath, "utf8") : "[]"
  fs.writeFileSync(args[1], JSON.stringify({ version: "test", exported_at: "2026-08-20T00:00:00.000Z", sessions: [], observations: JSON.parse(observations), prompts: [] }))
  process.exit(0)
}
process.exit(2)
`
  await fs.writeFile(cli, script, "utf8")
  await fs.chmod(cli, 0o755)
  process.env.PATH = `${bin}${path.delimiter}${previous.PATH || ""}`
  process.env.ODF_TEST_ENGRAM_LOG = logPath
  process.env.ODF_TEST_ENGRAM_STORE = storePath
  delete process.env.ODF_TEST_ENGRAM_FAIL

  return {
    logPath,
    setFailure: (enabled: boolean): void => {
      if (enabled) process.env.ODF_TEST_ENGRAM_FAIL = "1"
      else delete process.env.ODF_TEST_ENGRAM_FAIL
    },
    setFailureTopic: (topic: string | null): void => {
      if (topic) process.env.ODF_TEST_ENGRAM_FAIL = topic
      else delete process.env.ODF_TEST_ENGRAM_FAIL
    },
    setObservations: async (observations): Promise<void> => {
      await fs.writeFile(storePath, JSON.stringify(observations), "utf8")
    },
    cleanup: async (): Promise<void> => {
      process.env.PATH = previous.PATH
      if (previous.log === undefined) delete process.env.ODF_TEST_ENGRAM_LOG
      else process.env.ODF_TEST_ENGRAM_LOG = previous.log
      if (previous.store === undefined) delete process.env.ODF_TEST_ENGRAM_STORE
      else process.env.ODF_TEST_ENGRAM_STORE = previous.store
      if (previous.fail === undefined) delete process.env.ODF_TEST_ENGRAM_FAIL
      else process.env.ODF_TEST_ENGRAM_FAIL = previous.fail
      await fs.rm(bin, { recursive: true, force: true })
    },
  }
}

function completePreflight(change: string, artifactStore: "openspec" | "engram" | "hybrid" = "openspec") {
  return {
    change,
    execution_mode: "interactive",
    artifact_store: artifactStore,
    delivery_strategy: "ask-on-risk",
    review_budget_lines: 400,
    odoo_version: 18,
    tdd_mode: false,
    solution_strategy: "custom",
    chain_strategy: "none",
    persisted_at: "2026-08-19T00:00:00.000Z",
  }
}

function approvedExpectations(change: string, statement = "The requested behavior is observable and verified.") {
  return {
    change,
    intent: "Implement the requested behavior",
    expectations: [{ id: "EXP-01", statement, testable: true, owned_by: "human" as const }],
    approved: true,
    approved_by: "user",
    approved_at: "2026-08-19T00:01:00.000Z",
    immutable_since: "2026-08-19T00:01:00.000Z",
  }
}

function authorizedWorkflowBind(changeName: string, workspaceRoot: string) {
  const context = { sessionID: "odf-new-session", messageID: "odf-new-message" } as any
  const generation = 1
  return {
    bind: createODFWorkflowBind(new Map([[context.sessionID, {
      nonce: "test-capability",
      sessionID: context.sessionID,
      messageID: context.messageID,
      generation,
      changeName,
      workspaceRoot: fsSync.realpathSync(workspaceRoot),
      claimed: false,
    }]]), new Map([[context.sessionID, generation]])),
    context,
  }
}

function successfulHealthOutput(): string {
  return JSON.stringify({
    schema_version: 1,
    status: "warning",
    registry: { status: "valid", skills: { missing: [] }, agents: { missing: [] } },
    plugin: { loaded: true, file_status: "readable" },
    command: { status: "readable" },
    task_api: { function_present: true },
  })
}

function sdkPromptResult(result: Record<string, unknown>): Record<string, unknown> {
  return {
    data: {
      info: { role: "assistant" },
      parts: [{ type: "text", text: JSON.stringify(result) }],
    },
    request: {},
    response: {},
  }
}

// Mirrors the SDK client's default "fields" responseStyle envelope.
function sdkCreateResult(id: string): Record<string, unknown> {
  return { data: { id }, request: {}, response: {} }
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

  it("materializes a terminal DECIDE prefix for a complete small change", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-micro-bind-"))
    const changeDir = path.join(root, "openspec", "changes", "micro-change")
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), "preflight:\n  solution_strategy: standard\n", "utf8")

    try {
      const output = JSON.parse(await createODFWorkflowBind().execute({
        change_name: "micro-change",
        work_type: "small-change",
        terminal_stage: "DECIDE",
        intent: "Add the discount field",
        expectations_approved: true,
        workspace_dir: root,
      }, {} as any) as string)
      expect(output).toMatchObject({ status: "bound", terminal_stage: "DECIDE" })
      expect(YAML.parse(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8"))).toMatchObject({
        work_type: "small-change",
        canonical_stage: "DECIDE",
        completed_canonical_stages: ["DECIDE"],
      })
      expect(YAML.parse(await fs.readFile(path.join(changeDir, "decision.yaml"), "utf8"))).toMatchObject({
        status: "passed",
        intent: "Add the discount field",
        expectations_approved: true,
      })
      const advance = JSON.parse(await createODFWorkflowAdvance().execute({
        work_type: "small-change",
        completed_stages: [],
        candidate_stage: "DECIDE",
        phase_result_status: "ok",
        validation_status: "verified",
        receipt_state: "none",
        resumable_state: true,
        archived_state: false,
      }, {} as any) as string)
      expect(advance).toMatchObject({ status: "advanced", next_stage: "BUILD" })
      const retry = JSON.parse(await createODFWorkflowBind().execute({
        change_name: "micro-change",
        work_type: "small-change",
        terminal_stage: "DECIDE",
        intent: "Add the discount field",
        expectations_approved: true,
        workspace_dir: root,
      }, {} as any) as string)
      expect(retry).toMatchObject({ status: "bound", state_action: "reused", terminal_action: "reused" })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("creates and materializes terminal FIX only through an authorized start", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-fix-bind-"))
    const changeDir = path.join(root, "openspec", "changes", "fix-change")
    const { bind, context } = authorizedWorkflowBind("fix-change", root)

    try {
      const output = JSON.parse(await bind.execute({
        change_name: "fix-change",
        work_type: "bugfix",
        preflight: completePreflight("fix-change"),
        terminal_stage: "FIX",
        root_cause: "The quantity guard ran after rounding",
        regression: "Add a zero-quantity regression test",
        workspace_dir: root,
      }, context) as string)
      expect(output).toMatchObject({ status: "bound", terminal_stage: "FIX" })
      expect(YAML.parse(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8"))).toMatchObject({
        work_type: "bugfix",
        canonical_stage: "FIX",
        completed_canonical_stages: ["FIX"],
      })
      expect(YAML.parse(await fs.readFile(path.join(changeDir, "fix.yaml"), "utf8"))).toMatchObject({
        status: "passed",
        root_cause: "The quantity guard ran after rounding",
        regression: "Add a zero-quantity regression test",
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("blocks BUILD without state and offers a safe continuation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-missing-state-"))
    try {
      const { createODFDelegate } = await import("./odf-delegation.js")
      const output = JSON.parse(await createODFDelegate(undefined, root).execute({
        phase: "IMPLEMENT",
        change: "missing-state",
        artifact_store: "openspec",
        attempt_id: "missing-state-attempt",
        prompt: "Build the change",
        context_files: [],
        workflow_advance: {
          work_type: "small-change",
          completed_stages: [],
          candidate_stage: "DECIDE",
          phase_result_status: "ok",
          validation_status: "verified",
          receipt_state: "none",
          resumable_state: true,
          archived_state: false,
        },
      }, { sessionID: "missing-state", task: vi.fn() } as any) as string)
      expect(output).toMatchObject({ status: "blocked", reason: "workflow-state-not-found", safe_continuation: "/odf-continue missing-state" })
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
        .resolves.toMatch(/workflow-start-preflight-required/)
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

  it("requires complete preflight and same-session /odf-new authorization to create any missing state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-start-authorization-"))
    const fake = await configureFakeEngram()
    const context = { sessionID: "continue-session", messageID: "continue-message" } as any

    try {
      const bind = createODFWorkflowBind()
      const noPreflight = JSON.parse(await bind.execute({
        change_name: "unauthorized-engram", work_type: "feature", artifact_store: "engram", workspace_dir: root,
      }, context) as string)
      expect(noPreflight).toMatchObject({ status: "blocked", reason: "workflow-start-preflight-required" })

      const noAuthorization = JSON.parse(await bind.execute({
        change_name: "unauthorized-engram", work_type: "feature", artifact_store: "engram", workspace_dir: root,
        preflight: completePreflight("unauthorized-engram", "engram"),
      }, context) as string)
      expect(noAuthorization).toMatchObject({ status: "blocked", reason: "workflow-start-unauthorized" })

      const openSpec = JSON.parse(await bind.execute({
        change_name: "unauthorized-openspec", work_type: "feature", artifact_store: "openspec", workspace_dir: root,
        preflight: completePreflight("unauthorized-openspec"),
      }, context) as string)
      expect(openSpec).toMatchObject({ status: "blocked", reason: "workflow-start-unauthorized" })
      expect(fsSync.existsSync(path.join(root, "openspec"))).toBe(false)
      const calls = JSON.parse(await fs.readFile(fake.logPath, "utf8")) as string[][]
      expect(calls.some(call => call[0] === "save")).toBe(false)
    } finally {
      await fake.cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("updates an existing Engram-only state with exact convention arguments and rediscovers it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-bind-"))
    const fake = await configureFakeEngram()
    const changeName = "engram-only"
    const topicKey = `odf/${changeName}/state`
    await fake.setObservations([{
      topic_key: topicKey,
      content: JSON.stringify({ canonical_stage: "DECIDE" }),
      created_at: "2026-08-19T00:00:00.000Z",
    }])

    try {
      const output = await createODFWorkflowBind().execute({
        change_name: changeName,
        work_type: "feature",
        artifact_store: "engram",
        workspace_dir: root,
      }, {} as any)
      expect(JSON.parse(output as string)).toMatchObject({
        status: "bound",
        change_name: changeName,
        work_type: "feature",
        artifact_store: "engram",
        topic_key: topicKey,
        project: path.basename(root),
        state_action: "updated",
        expectations_action: "none",
      })

      const calls = JSON.parse(await fs.readFile(fake.logPath, "utf8"))
      const saveCalls = calls.filter((call: string[]) => call[0] === "save")
      expect(saveCalls[0].slice(0, 2)).toEqual(["save", topicKey])
      expect(JSON.parse(saveCalls[0][2])).toEqual({ canonical_stage: "DECIDE", work_type: "feature" })
      expect(saveCalls[0].slice(3)).toEqual([
        "--type", "architecture", "--project", path.basename(root), "--scope", "project", "--topic", topicKey,
      ])
      expect(fsSync.existsSync(path.join(root, "openspec", "changes", changeName, "state.yaml"))).toBe(false)

      const statusOutput = await createODFWorkflowStatus().execute({ change_name: changeName, workspace_dir: root }, {} as any)
      const status = JSON.parse(statusOutput as string)
      expect(status.work_type).toBe("feature")
      expect(status.source.state).toBe("engram")
      expect(status.source.artifacts).toContain(topicKey)
    } finally {
      await fake.cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("fails closed when the Engram CLI is unavailable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-missing-"))
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "odf-no-engram-bin-"))
    const previousPath = process.env.PATH
    process.env.PATH = bin

    try {
      const output = await createODFWorkflowBind().execute({
        change_name: "missing-cli",
        work_type: "feature",
        artifact_store: "engram",
        workspace_dir: root,
      }, {} as any)
      expect(JSON.parse(output as string)).toMatchObject({ status: "blocked", reason: "engram-cli-unavailable" })
    } finally {
      process.env.PATH = previousPath
      await fs.rm(bin, { recursive: true, force: true })
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("fails closed when the Engram save command fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-save-failure-"))
    const fake = await configureFakeEngram()
    await fake.setObservations([{
      topic_key: "odf/save-failure/state",
      content: JSON.stringify({ canonical_stage: "DECIDE" }),
      created_at: "2026-08-19T00:00:00.000Z",
    }])
    fake.setFailure(true)

    try {
      const output = await createODFWorkflowBind().execute({
        change_name: "save-failure",
        work_type: "feature",
        artifact_store: "engram",
        workspace_dir: root,
      }, {} as any)
      expect(JSON.parse(output as string)).toMatchObject({ status: "blocked", reason: "engram-save-failed" })
    } finally {
      await fake.cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("starts an OpenSpec feature with canonical state before approved Expectations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-openspec-start-"))
    const change = "new-feature"
    const expectations = approvedExpectations(change)
    const { bind, context } = authorizedWorkflowBind(change, root)

    try {
      const output = JSON.parse(await bind.execute({
        change_name: change,
        work_type: "feature",
        artifact_store: "openspec",
        workspace_dir: root,
        preflight: completePreflight(change),
        expectations,
      }, context) as string)
      expect(output).toMatchObject({ status: "bound", state_action: "created", expectations_action: "persisted" })

      const changeDir = path.join(root, "openspec", "changes", change)
      const state = YAML.parse(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8"))
      expect(state).toMatchObject({
        change,
        artifact_store: "openspec",
        work_type: "feature",
        canonical_stage: "DECIDE",
        completed_canonical_stages: [],
        preflight: { change, artifact_store: "openspec", work_type: "feature" },
        route: { work_type: "feature", stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"] },
      })
      expect(YAML.parse(await fs.readFile(path.join(changeDir, "expectations.yaml"), "utf8"))).toEqual(expectations)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("starts hybrid workflows in OpenSpec authority without Engram-only artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-hybrid-start-"))
    const fake = await configureFakeEngram()
    const change = "hybrid-feature"
    const expectations = approvedExpectations(change)
    const { bind, context } = authorizedWorkflowBind(change, root)

    try {
      const output = JSON.parse(await bind.execute({
        change_name: change,
        work_type: "feature",
        artifact_store: "openspec",
        workspace_dir: root,
        preflight: completePreflight(change, "hybrid"),
        expectations,
      }, context) as string)
      expect(output).toMatchObject({ status: "bound", artifact_store: "openspec", state_action: "created" })
      const changeDir = path.join(root, "openspec", "changes", change)
      expect(YAML.parse(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8"))).toMatchObject({ artifact_store: "hybrid" })
      expect(YAML.parse(await fs.readFile(path.join(changeDir, "expectations.yaml"), "utf8"))).toEqual(expectations)
      expect(fsSync.existsSync(fake.logPath)).toBe(false)
    } finally {
      await fake.cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("reuses identical OpenSpec Expectations and leaves an active state byte-identical", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-openspec-retry-"))
    const change = "retry-feature"
    const args = {
      change_name: change,
      work_type: "feature" as const,
      artifact_store: "openspec" as const,
      workspace_dir: root,
      preflight: completePreflight(change),
      expectations: approvedExpectations(change),
    }
    const { bind, context } = authorizedWorkflowBind(change, root)

    try {
      await bind.execute(args, context)
      const statePath = path.join(root, "openspec", "changes", change, "state.yaml")
      const expectationsPath = path.join(root, "openspec", "changes", change, "expectations.yaml")
      const before = [await fs.readFile(statePath, "utf8"), await fs.readFile(expectationsPath, "utf8")]
      const retry = JSON.parse(await bind.execute(args, context) as string)
      expect(retry).toMatchObject({ status: "bound", state_action: "reused", expectations_action: "reused" })
      expect([await fs.readFile(statePath, "utf8"), await fs.readFile(expectationsPath, "utf8")]).toEqual(before)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("recovers identical orphan OpenSpec Expectations without rewriting them", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-openspec-recover-"))
    const change = "fecha-factura"
    const changeDir = path.join(root, "openspec", "changes", change)
    const expectations = approvedExpectations(change, "The invoice date is retained when the invoice is posted.")
    await fs.mkdir(changeDir, { recursive: true })
    const expectationsPath = path.join(changeDir, "expectations.yaml")
    await fs.writeFile(expectationsPath, YAML.stringify(expectations), "utf8")
    const before = await fs.readFile(expectationsPath, "utf8")
    const { bind, context } = authorizedWorkflowBind(change, root)

    try {
      const output = JSON.parse(await bind.execute({
        change_name: change,
        work_type: "feature",
        artifact_store: "openspec",
        workspace_dir: root,
        preflight: completePreflight(change),
        expectations,
      }, context) as string)
      expect(output).toMatchObject({ status: "bound", state_action: "created", expectations_action: "reused" })
      expect(await fs.readFile(expectationsPath, "utf8")).toBe(before)
      expect(fsSync.existsSync(path.join(changeDir, "state.yaml"))).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("blocks divergent or tampered Expectations without changing canonical state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-expectations-conflict-"))
    const change = "protected-expectations"
    const baseArgs = {
      change_name: change,
      work_type: "feature" as const,
      artifact_store: "openspec" as const,
      workspace_dir: root,
      preflight: completePreflight(change),
      expectations: approvedExpectations(change),
    }
    const { bind, context } = authorizedWorkflowBind(change, root)

    try {
      await bind.execute(baseArgs, context)
      const statePath = path.join(root, "openspec", "changes", change, "state.yaml")
      const expectationsPath = path.join(root, "openspec", "changes", change, "expectations.yaml")
      const stateBefore = await fs.readFile(statePath, "utf8")
      const conflict = JSON.parse(await bind.execute({
        ...baseArgs,
        expectations: approvedExpectations(change, "A different approved statement."),
      }, context) as string)
      expect(conflict).toMatchObject({ status: "blocked", reason: "expectations-conflict" })
      expect(await fs.readFile(statePath, "utf8")).toBe(stateBefore)

      await fs.writeFile(expectationsPath, "change: protected-expectations\napproved: true\nexpectations: []\n", "utf8")
      const tampered = JSON.parse(await bind.execute(baseArgs, context) as string)
      expect(tampered).toMatchObject({ status: "blocked", reason: "expectations-tampered" })
      expect(await fs.readFile(statePath, "utf8")).toBe(stateBefore)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("leaves no orphan Expectations across OpenSpec state and Expectations write failures", async () => {
    const change = "write-failure"
    const expectations = approvedExpectations(change)
    const stateFailureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "odf-state-failure-"))
    const expectationFailureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "odf-expectation-failure-"))
    const { bind, context } = authorizedWorkflowBind(change, stateFailureRoot)

    try {
      const brokenChangeDir = path.join(stateFailureRoot, "openspec", "changes", change)
      await fs.mkdir(path.join(brokenChangeDir, "state.yaml"), { recursive: true })
      const stateFailure = JSON.parse(await bind.execute({
        change_name: change, work_type: "feature", workspace_dir: stateFailureRoot,
        preflight: completePreflight(change), expectations,
      }, context) as string)
      expect(stateFailure).toMatchObject({ status: "blocked", reason: "unsafe-change-path" })
      expect(fsSync.existsSync(path.join(brokenChangeDir, "expectations.yaml"))).toBe(false)

      const expectationChangeDir = path.join(expectationFailureRoot, "openspec", "changes", change)
      await fs.mkdir(path.join(expectationChangeDir, "expectations.yaml"), { recursive: true })
      const expectationStart = authorizedWorkflowBind(change, expectationFailureRoot)
      const expectationFailure = JSON.parse(await expectationStart.bind.execute({
        change_name: change, work_type: "feature", workspace_dir: expectationFailureRoot,
        preflight: completePreflight(change), expectations,
      }, expectationStart.context) as string)
      expect(expectationFailure).toMatchObject({ status: "blocked", reason: "expectations-write-failed" })
      const statePath = path.join(expectationChangeDir, "state.yaml")
      expect(YAML.parse(await fs.readFile(statePath, "utf8"))).toMatchObject({ work_type: "feature", artifact_store: "openspec" })
      expect(fsSync.statSync(path.join(expectationChangeDir, "expectations.yaml")).isDirectory()).toBe(true)
      expect((await fs.readdir(expectationChangeDir)).some(file => file.endsWith(".tmp"))).toBe(false)

      await fs.rm(path.join(expectationChangeDir, "expectations.yaml"), { recursive: true })
      const retry = JSON.parse(await expectationStart.bind.execute({
        change_name: change, work_type: "feature", workspace_dir: expectationFailureRoot,
        preflight: completePreflight(change), expectations,
      }, expectationStart.context) as string)
      expect(retry).toMatchObject({ status: "bound", state_action: "reused", expectations_action: "persisted" })
      expect(YAML.parse(await fs.readFile(path.join(expectationChangeDir, "expectations.yaml"), "utf8"))).toEqual(expectations)
      expect((await fs.readdir(expectationChangeDir)).some(file => file.endsWith(".tmp"))).toBe(false)
    } finally {
      await fs.rm(stateFailureRoot, { recursive: true, force: true })
      await fs.rm(expectationFailureRoot, { recursive: true, force: true })
    }
  })

  it("rejects an OpenSpec parent symlink before creating any external directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-symlink-root-"))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "odf-symlink-outside-"))
    const change = "escaped-change"
    const { bind, context } = authorizedWorkflowBind(change, root)
    await fs.symlink(outside, path.join(root, "openspec"), "dir")

    try {
      const output = JSON.parse(await bind.execute({
        change_name: change,
        work_type: "feature",
        artifact_store: "openspec",
        workspace_dir: root,
        preflight: completePreflight(change),
        expectations: approvedExpectations(change),
      }, context) as string)
      expect(output).toMatchObject({ status: "blocked", reason: "unsafe-change-path" })
      expect(await fs.readdir(outside)).toEqual([])
      expect(fsSync.existsSync(path.join(outside, "changes"))).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it("rejects a .odf symlink before the workflow lock emits external events", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-lock-symlink-root-"))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "odf-lock-symlink-outside-"))
    const change = "lock-escape"
    const { bind, context } = authorizedWorkflowBind(change, root)
    await fs.symlink(outside, path.join(root, ".odf"), "dir")
    const events: string[] = []
    const watcher = fsSync.watch(outside, (event, filename) => events.push(`${event}:${filename || ""}`))

    try {
      const output = JSON.parse(await bind.execute({
        change_name: change,
        work_type: "feature",
        workspace_dir: root,
        preflight: completePreflight(change),
      }, context) as string)
      await new Promise(resolve => setTimeout(resolve, 25))
      expect(output).toMatchObject({ status: "blocked", reason: "workflow-lock-unsafe-path" })
      expect(events).toEqual([])
      expect(await fs.readdir(outside)).toEqual([])
    } finally {
      watcher.close()
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it("starts and retries Engram state plus Expectations without OpenSpec mixing or duplicate saves", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-start-"))
    const fake = await configureFakeEngram()
    const change = "engram-feature"
    const args = {
      change_name: change,
      work_type: "feature" as const,
      artifact_store: "engram" as const,
      workspace_dir: root,
      preflight: completePreflight(change, "engram"),
      expectations: approvedExpectations(change),
    }
    const { bind, context } = authorizedWorkflowBind(change, root)

    try {
      const first = JSON.parse(await bind.execute(args, context) as string)
      expect(first).toMatchObject({ status: "bound", state_action: "created", expectations_action: "persisted" })
      let calls = JSON.parse(await fs.readFile(fake.logPath, "utf8")) as string[][]
      expect(calls.filter(call => call[0] === "save").map(call => call[1])).toEqual([
        `odf/${change}/state`,
        `odf/${change}/expectations`,
      ])
      expect(fsSync.existsSync(path.join(root, "openspec"))).toBe(false)

      const retry = JSON.parse(await bind.execute(args, context) as string)
      expect(retry).toMatchObject({ status: "bound", state_action: "reused", expectations_action: "reused" })
      calls = JSON.parse(await fs.readFile(fake.logPath, "utf8")) as string[][]
      expect(calls.filter(call => call[0] === "save")).toHaveLength(2)

      const status = JSON.parse(await createODFWorkflowStatus().execute({ change_name: change, workspace_dir: root }, {} as any) as string)
      expect(status).toMatchObject({ status: "found", state_present: true, work_type: "feature", resumable: true })
      expect(status.source.state).toBe("engram")
    } finally {
      await fake.cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("recovers identical Engram-only orphan Expectations and blocks divergent recovery", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-recovery-"))
    const fake = await configureFakeEngram()
    const change = "fecha-factura"
    const expectations = approvedExpectations(change, "The invoice date is retained when the invoice is posted.")
    await fake.setObservations([{
      topic_key: `odf/${change}/expectations`,
      content: JSON.stringify(expectations),
      created_at: "2026-08-19T00:01:00.000Z",
    }])
    const { bind, context } = authorizedWorkflowBind(change, root)

    try {
      const divergent = JSON.parse(await bind.execute({
        change_name: change,
        work_type: "feature",
        artifact_store: "engram",
        workspace_dir: root,
        preflight: completePreflight(change, "engram"),
        expectations: approvedExpectations(change, "A different invoice date contract."),
      }, context) as string)
      expect(divergent).toMatchObject({ status: "blocked", reason: "expectations-conflict" })

      const recoveryStart = authorizedWorkflowBind(change, root)
      const recovered = JSON.parse(await recoveryStart.bind.execute({
        change_name: change,
        work_type: "feature",
        artifact_store: "engram",
        workspace_dir: root,
        preflight: completePreflight(change, "engram"),
        expectations,
      }, recoveryStart.context) as string)
      expect(recovered).toMatchObject({ status: "bound", state_action: "created", expectations_action: "reused" })
      const calls = JSON.parse(await fs.readFile(fake.logPath, "utf8")) as string[][]
      expect(calls.filter(call => call[0] === "save").map(call => call[1])).toEqual([`odf/${change}/state`])
    } finally {
      await fake.cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("keeps Engram state without orphan Expectations when the second save fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-expectations-failure-"))
    const fake = await configureFakeEngram()
    const change = "engram-partial"
    fake.setFailureTopic(`odf/${change}/expectations`)
    const expectations = approvedExpectations(change)
    const args = {
      change_name: change,
      work_type: "feature" as const,
      artifact_store: "engram" as const,
      workspace_dir: root,
      preflight: completePreflight(change, "engram"),
      expectations,
    }
    const { bind, context } = authorizedWorkflowBind(change, root)

    try {
      const output = JSON.parse(await bind.execute(args, context) as string)
      expect(output).toMatchObject({ status: "blocked", reason: "engram-save-failed" })
      fake.setFailureTopic(null)
      const partialStatus = JSON.parse(await createODFWorkflowStatus().execute({ change_name: change, workspace_dir: root }, {} as any) as string)
      expect(partialStatus).toMatchObject({ status: "found", state_present: true, work_type: "feature" })
      expect(partialStatus.artifacts.expectations).toBeUndefined()

      const retry = JSON.parse(await bind.execute(args, context) as string)
      expect(retry).toMatchObject({ status: "bound", state_action: "reused", expectations_action: "persisted" })
      const calls = JSON.parse(await fs.readFile(fake.logPath, "utf8")) as string[][]
      expect(calls.filter(call => call[0] === "save" && call[1] === `odf/${change}/state`)).toHaveLength(1)
      const completeStatus = JSON.parse(await createODFWorkflowStatus().execute({ change_name: change, workspace_dir: root }, {} as any) as string)
      expect(completeStatus).toMatchObject({ state_present: true, work_type: "feature", artifacts: { expectations: "done" } })
    } finally {
      await fake.cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe("createODFEntryTriage", () => {
  it("registers odf_entry_triage in the plugin tool list", () => {
    expect(ODF_REGISTERED_TOOLS).toContain("odf_entry_triage")
  })

  it("returns classification JSON with level, work_type, reason, and needs_question", async () => {
    const output = await createODFEntryTriage().execute({
      description: "Add a computed discount field to sale.order.",
      module: "sale",
      domain: "sales",
      expected_files: 2,
      expectations_clear: true,
    }, {} as any)
    const result = JSON.parse(output as string)
    expect(result.level).toBe("micro")
    expect(result.work_type).toBe("small-change")
    expect(result.reason).toBeTruthy()
    expect(result.needs_question).toBe(false)
  })

  it("flags needs_question for ambiguous entries", async () => {
    const output = await createODFEntryTriage().execute({ description: "Add a field." }, {} as any)
    const result = JSON.parse(output as string)
    expect(result.needs_question).toBe(true)
    expect(result.question).toBeTruthy()
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
    const skills = matchSkills(baseRegistry, "DESIGN", {
      task: "Design a new model with python",
      files: ["models/sale_order.py"],
    })
    expect(skills.length).toBeGreaterThan(0)
    expect(skills.length).toBeLessThanOrEqual(5)
    expect(skills[0].name).toBe("odf-design")
  })

  it("filters by Odoo version", () => {
    const skills = matchSkills(baseRegistry, "DESIGN", {
      task: "Design a model",
      files: [],
      odooVersion: 14,
    })
    // odf-design supports v14, owl-components does not.
    expect(skills.map((s: ODFSkill) => s.name)).toContain("odf-design")
    expect(skills.map((s: ODFSkill) => s.name)).not.toContain("owl-components")
  })

  it("returns no skills when nothing matches", () => {
    const skills = matchSkills(baseRegistry, null, {
      task: "deploy to kubernetes",
      files: [],
    })
    expect(skills).toEqual([])
  })

  it("selects the canonical skill for the requested phase", () => {
    const skills = matchSkills(baseRegistry, "DESIGN", {
      task: "unrelated task",
      files: [],
    })
    expect(skills[0].name).toBe("odf-design")
  })

  it("does not select an ODF skill with an incompatible phase", () => {
    const skills = matchSkills({
      ...baseRegistry,
      skills: [...baseRegistry.skills, {
        name: "odf-implement",
        title: "Implement",
        category: "odf",
        triggers: ["implement", "python"],
        compact_rules: "Implement rules",
        path: "/tmp/odf-implement.md",
        odoo_versions: [16],
        sdd_phase: "IMPLEMENT",
      } as ODFSkill],
    }, "DESIGN", {
      task: "implement python code",
      files: [],
    })
    expect(skills.map((skill) => skill.name)).not.toContain("odf-implement")
    expect(skills.map((skill) => skill.name)).toContain("oca-python-style")
  })

  it("falls back to contextual skills when no canonical skill exists", () => {
    const skills = matchSkills(baseRegistry, "VERIFY", {
      task: "python model",
      files: ["models/sale_order.py"],
    })
    expect(skills.map((skill) => skill.name)).toContain("oca-python-style")
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
    const session = { create: vi.fn(), prompt: vi.fn(), abort: vi.fn() }
    const toolCtx = { task: taskFn, sessionID: "s1" } as any
    const api = findTaskApi(toolCtx, { session } as any)
    expect(api?.source).toBe("toolCtx.task")
    expect(api?.taskApi).toBe(taskFn)
  })

  it("detects sdk.session without toolCtx.task or client.task", () => {
    const client = {
      task: vi.fn(),
      session: { create: vi.fn(), prompt: vi.fn(), abort: vi.fn() },
    } as any
    const api = findTaskApi({ sessionID: "s1", directory: "/workspace" } as any, client)
    expect(api?.source).toBe("sdk.session")
    expect(api?.taskApi).not.toBe(client.task)
  })

  it("returns null when no task API is available", () => {
    expect(findTaskApi({ sessionID: "s1" } as any, undefined)).toBeNull()
    expect(findTaskApi({ sessionID: "s1" } as any, {} as any)).toBeNull()
    expect(findTaskApi({ sessionID: "s1" } as any, {
      session: { create: vi.fn(), prompt: vi.fn() },
    } as any)).toBeNull()
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

  it("bounds and sanitizes optional observability fields", () => {
    recordMetrics(makeMetric({
      work_type: "cross-domain",
      branch_id: "branch-a",
      join_status: "blocked",
      join_expected: 2,
      join_completed: 1,
      join_failed: 1,
      join_running: 0,
      validation_ratio: 0.5,
    }))
    expect(getMetricsBuffer()[0]).toMatchObject({
      work_type: "cross-domain",
      branch_id: "branch-a",
      join_status: "blocked",
      join_expected: 2,
      join_completed: 1,
      join_failed: 1,
      join_running: 0,
      validation_ratio: 0.5,
    })

    recordMetrics(makeMetric({
      work_type: "prompt-leak" as any,
      branch_id: "../secret" as any,
      join_expected: 99 as any,
      validation_ratio: 2 as any,
    }))
    expect(getMetricsBuffer()[1]).not.toHaveProperty("work_type")
    expect(getMetricsBuffer()[1]).not.toHaveProperty("branch_id")
    expect(getMetricsBuffer()[1]).not.toHaveProperty("join_expected")
    expect(getMetricsBuffer()[1]).not.toHaveProperty("validation_ratio")
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

  it("drops a failed flush without growing the bounded buffer", () => {
    const configFile = path.join(tempHome, "not-a-directory")
    fsSync.writeFileSync(configFile, "file")
    process.env.ODF_CONFIG_DIR = configFile
    process.env.ODF_METRICS_BUFFER_CAP = "1"
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    recordMetrics(makeMetric())
    expect(getMetricsBuffer()).toEqual([])
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Metrics flush failed"))
    warning.mockRestore()
  })

  it("falls back to the default cap for malformed or non-positive values", () => {
    process.env.ODF_METRICS_BUFFER_CAP = "not-a-number"
    expect(getMetricsBufferCap()).toBe(1000)
    process.env.ODF_METRICS_BUFFER_CAP = "0"
    expect(getMetricsBufferCap()).toBe(1000)
  })

  it("telemetry-schema-versioned: emits schema_version, trace/span ids and serializes optional fields", () => {
    recordMetrics(makeMetric({
      event: "run" as const,
      trace_id: "trace-abc",
      span_id: "span-run-1",
      task: "Assess a new sales feature for partners",
      tool: "odf_delegate",
      retry_count: 2,
    }))
    const m = getMetricsBuffer()[0]
    expect(m.event).toBe("run")
    expect(m.schema_version).toBe(1)
    expect(m.trace_id).toBe("trace-abc")
    expect(m.span_id).toBe("span-run-1")
    expect(m.task).toBe("Assess a new sales feature for partners")
    expect(m.tool).toBe("odf_delegate")
    expect(m.retry_count).toBe(2)
    expect(m.parent_span_id).toBeUndefined()
    expect(m.tokens).toMatchObject({ input: null, output: null, estimated: 50 })
  })

  it("telemetry-parent-child-correlate: a span carries its run's span_id as parent and shares trace_id", () => {
    recordMetrics(makeMetric({ event: "run" as const, trace_id: "t1", span_id: "s-root" }))
    recordMetrics(makeMetric({ event: "span" as const, trace_id: "t1", span_id: "s-tool", parent_span_id: "s-root" }))
    const [run, span] = getMetricsBuffer()
    expect(run.event).toBe("run")
    expect(span.event).toBe("span")
    expect(span.trace_id).toBe(run.trace_id)
    expect(span.parent_span_id).toBe(run.span_id)
    expect(span.span_id).toBe("s-tool")
    expect(run.parent_span_id).toBeUndefined()
  })

  it("telemetry-tokens-honest: null input/output and flagged estimated when host hides tokens; real counts when exposed", () => {
    // Host exposes nothing → input/output null, estimated flagged.
    recordMetrics(makeMetric({}))
    expect(getMetricsBuffer()[0].tokens).toMatchObject({ input: null, output: null, estimated: 50 })

    // Host exposes real counts → used verbatim, still flagged estimated.
    recordMetrics(makeMetric({ tokens: { input: 120, output: 45 } }))
    expect(getMetricsBuffer()[1].tokens).toMatchObject({ input: 120, output: 45 })
  })

  it("telemetry-no-secrets: prompt paths, absolute user paths and env values never appear in JSONL", () => {
    process.env.ODF_METRICS_BUFFER_CAP = "1"
    recordMetrics(makeMetric({
      task: "handle /home/usuario/project and SECRET=topsecret123 details",
      error: "failed reading /home/usuario/secret SECRET=topsecret123",
      session_id: "super-secret-session",
    }))
    const metricsDir = path.join(tempHome, ".config", "opencode", "metrics")
    const files = fsSync.readdirSync(metricsDir)
    const content = fsSync.readFileSync(path.join(metricsDir, files[0]), "utf8")
    expect(content).not.toContain("/home/usuario")
    expect(content).not.toContain("topsecret123")
    expect(content).not.toContain("super-secret-session")
  })

  it("telemetry-buffer-bounded: cap and flush stay bounded with the new fields present", () => {
    process.env.ODF_METRICS_BUFFER_CAP = "2"
    recordMetrics(makeMetric({ event: "run" as const }))
    recordMetrics(makeMetric({ event: "span" as const }))
    expect(getMetricsBuffer().length).toBe(0)
    const metricsDir = path.join(tempHome, ".config", "opencode", "metrics")
    const files = fsSync.readdirSync(metricsDir)
    const lines = fsSync.readFileSync(path.join(metricsDir, files[0]), "utf8").trim().split("\n")
    expect(lines.length).toBe(2)
    for (const line of lines) {
      const parsed = JSON.parse(line)
      expect(parsed.schema_version).toBe(1)
      expect(parsed.trace_id).toBeTruthy()
      expect(parsed.span_id).toBeTruthy()
    }
  })

  it("telemetry-model-available-flag: model unavailable is represented explicitly, not dropped", () => {
    recordMetrics(makeMetric({}))
    expect(getMetricsBuffer()[0].model).toBeNull()
    expect(getMetricsBuffer()[0].provider).toBeNull()
    expect(getMetricsBuffer()[0].model_version).toBeNull()
    expect(getMetricsBuffer()[0].model_available).toBe(false)

    recordMetrics(makeMetric({ model: "opencode-go/deepseek-r1", provider: "opencode", model_version: "1.0" }))
    expect(getMetricsBuffer()[1].model).toBe("opencode-go/deepseek-r1")
    expect(getMetricsBuffer()[1].provider).toBe("opencode")
    expect(getMetricsBuffer()[1].model_version).toBe("1.0")
    expect(getMetricsBuffer()[1].model_available).toBe(true)
  })
})

describe("gitHead", () => {
  it("returns null quietly for a non-Git workspace", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "odf-no-git-"))
    expect(gitHead(workspace)).toBeNull()
    await fs.rm(workspace, { recursive: true, force: true })
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
     "#!/bin/sh\nif [ \"$1\" = \"export\" ]; then\n  printf '{\"observations\":%s}' \"$ODF_TEST_ENGRAM_EXPORT\" > \"$2\"\nfi\n",
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

  it("uses positional export paths, filters the requested change, and avoids workspace artifacts", async () => {
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
      expect(canonical?.change).toBe("canonical")
      expect(canonical?.applyProgress).toEqual({ completed: 1, total: 2 })

      const legacy = await loadEngramStatus(workspace, "legacy")
      expect(legacy?.change).toBe("legacy")
      expect(legacy?.applyProgress).toEqual({ completed: 1, total: 2 })
      expect(fsSync.existsSync(path.join(process.cwd(), "--project"))).toBe(false)
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

  it("reuses a frozen decision only when the candidate digest matches", () => {
    const repo = path.join(tmp, "repo-idem")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)
    const first = computePolicyGate({ change: "idem", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(first.candidate_digest).toBeTruthy()

    const reused = computePolicyGate({ change: "idem", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(reused.frozen_diff_ref).toBe(first.frozen_diff_ref)
    expect(reused.candidate_digest).toBe(first.candidate_digest)
    expect(reused.changed_lines).toBe(100)
    expect(reused.correction_budget_lines).toBe(50)

    appendLines(repo, "a.py", 200)
    const recomputed = computePolicyGate({ change: "idem", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(recomputed.candidate_digest).not.toBe(first.candidate_digest)
    expect(recomputed.changed_lines).toBe(300)
  })

  it("mutation-after-gate: mutating a file invalidates the frozen VERIFY gate decision", () => {
    const repo = path.join(tmp, "repo-mutation-gate")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)
    const first = computePolicyGate({ change: "mutation-gate", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(first.candidate_digest).toBeTruthy()

    const reused = computePolicyGate({ change: "mutation-gate", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(reused.candidate_digest).toBe(first.candidate_digest)

    appendLines(repo, "a.py", 1)
    const recomputed = computePolicyGate({ change: "mutation-gate", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(recomputed.candidate_digest).not.toBe(first.candidate_digest)
    expect(recomputed.resolved_at).not.toBe(first.resolved_at)
    expect(recomputed.changed_lines).toBe(first.changed_lines! + 1)
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

  it("fail-closed: blocks VERIFY without git instead of failing open to LOW", () => {
    const d = computePolicyGate({ change: "no-git", phase: "VERIFY", workspaceDir: tmp, registry: registryWithTdd(true) })
    expect(d.frozen_diff_ref).toBeNull()
    expect(d.changed_lines).toBeNull()
    expect(d.candidate_digest).toBeNull()
    expect(d.gate).toBe("block")
    expect(d.reason).toContain("verification-unavailable")
    expect(d.risk_tier).toBe("MEDIUM")
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
        candidate_digest: null,
        base_head: null,
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

  const archiveProof = {
    work_type: "feature" as const,
    completed_stages: ["DECIDE" as const, "PLAN" as const, "BUILD" as const, "VERIFY" as const],
    candidate_stage: null,
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

  const writeEvidenceAt = async (workspace: string, change: string) => {
    await fs.mkdir(path.join(workspace, ".odf"), { recursive: true })
    await fs.writeFile(path.join(workspace, ".odf", `validation-evidence-${change}.json`), JSON.stringify({
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
    }), "utf8")
  }

  const writeValidationEvidence = (change: string) =>
    writeEvidenceFile(change, `validation-evidence-${change}.json`)

  const writeParallelEvidence = (change: string, branchIds: string[]) =>
    Promise.all(branchIds.map(branchId =>
      writeEvidenceFile(change, `validation-evidence-${change}-${branchId}.json`)
    ))

  const prepareWorkflowState = async (change: string, phase: "IMPLEMENT" | "VERIFY", workType = "feature") => {
    const completed = workType === "verify-only" ? [] : phase === "IMPLEMENT" ? ["DECIDE", "PLAN"] : ["DECIDE", "PLAN", "BUILD"]
    const canonicalStage = phase === "IMPLEMENT" ? "BUILD" : "VERIFY"
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), [
      `work_type: ${workType}`,
      `canonical_stage: ${canonicalStage}`,
      `completed_canonical_stages: [${completed.join(", ")}]`,
      "resumable: true",
      "",
    ].join("\n"), "utf8")
    if (phase === "IMPLEMENT") {
      await fs.writeFile(path.join(changeDir, "implement-progress.md"), "- [x] implementation\n", "utf8")
    }
    if (phase === "VERIFY") {
      await fs.writeFile(path.join(changeDir, "verify.yaml"), "status: passed\n", "utf8")
      await fs.writeFile(path.join(changeDir, "verify-report.yaml"), "status: passed\n", "utf8")
    }
  }

  // T3: a runnable VERIFY delegation needs a git workspace plus a persisted
  // policy gate and a valid validation-evidence receipt (status-only evidence
  // no longer advances the workflow).
  const verifyEvidenceFor = async (change: string, workType = "feature") => {
    initGitRepo(tempHome)
    commitFile(tempHome, "README.md", 1)
    await prepareWorkflowState(change, "VERIFY", workType)
    const head = gitHead(tempHome)!
    const digest = computeCandidateDigest(buildCandidateManifest(tempHome))
    await fs.mkdir(path.join(tempHome, ".odf"), { recursive: true })
    await fs.writeFile(path.join(tempHome, ".odf", `policy-gate-${change}.json`), JSON.stringify({
      change, phase: "VERIFY", gate: "allow", reason: "test gate",
      tdd: { global: false, local_readable: true, local_off: false, effective: "off" },
      risk_tier: "MEDIUM", frozen_diff_ref: head, candidate_digest: digest, base_head: head,
      changed_lines: 1, correction_budget_lines: 1, changed_paths: ["README.md"],
      resolved_at: new Date().toISOString(),
    }))
    await fs.writeFile(path.join(tempHome, ".odf", `validation-evidence-${change}.json`), JSON.stringify({
      change, phase: "VERIFY", batch: 1, risk_tier: "MEDIUM", frozen_diff_ref: head,
      candidate_digest: digest, executor: "odoo_qa_engineer", test_identity: "test_module test suite",
      resolved_at: new Date().toISOString(),
      commands: [
        { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "12 passed, 0 failed" },
        { name: "git-diff-check", command: "git diff --check", database: "odf_test_db", exit_code: 0, output_tail: "no whitespace errors" },
       ],
      }))
    }

  const writeExpectations = async (change: string, overrides = "") => {
    const content = `change: ${change}
intent: Verify the implementation
expectations:
  - id: EXP-01
    statement: The implementation passes verification
    testable: true
    owned_by: human
approved: true
approved_by: user
approved_at: 2026-08-17T00:00:00Z
immutable_since: 2026-08-17T00:00:00Z
${overrides}`
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "expectations.yaml"), content, "utf8")
  }

  const setRegistryFlags = async (flags: Record<string, boolean>) => {
    const registryPath = path.join(tempHome, ".config", "opencode", "odf-registry.json")
    const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
    registry.flags = { ...registry.flags, ...flags }
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf8")
  }

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

  it("delegates through an isolated SDK child session and propagates the ODF result", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const session = {
      create: vi.fn().mockResolvedValue(sdkCreateResult("child-1")),
      prompt: vi.fn().mockResolvedValue(sdkPromptResult({ status: "ok", executive_summary: "assessed" })),
      abort: vi.fn().mockResolvedValue(true),
    }
    const delegateTool = createODFDelegate({ session } as any, tempHome)
    const output = await delegateTool.execute(
      { phase: "ASSESS", prompt: "Assess a sales feature", context_files: ["models/sale.py"] },
      { sessionID: "parent-1", directory: tempHome, abort: new AbortController().signal } as any,
    )

    const envelope = JSON.parse(output as string)
    expect(envelope).toMatchObject({
      status: "delegated",
      task_api_source: "sdk.session",
      result: { status: "ok", executive_summary: "assessed" },
    })
    expect(session.create).toHaveBeenCalledWith({
      body: { parentID: "parent-1", title: "ODF delegation: odoo_functional_consultant" },
      query: { directory: tempHome },
    })
    expect(session.prompt).toHaveBeenCalledWith({
      path: { id: "child-1" },
      query: { directory: tempHome },
      body: {
        agent: "odoo_functional_consultant",
        parts: [{ type: "text", text: expect.stringContaining(path.join(tempHome, "models/sale.py")) }],
      },
    })
    expect(session.prompt.mock.calls[0][0].body).not.toHaveProperty("context_files")
  })

  it.each([
    ["empty", { data: { info: { role: "assistant" }, parts: [] }, request: {}, response: {} }, "blocked", "empty-task-result"],
    ["cancelled", { data: { info: { error: { name: "MessageAbortedError", data: { message: "cancelled" } } }, parts: [] }, request: {}, response: {} }, "blocked", "task-cancelled"],
    ["error", { data: { info: { error: { name: "UnknownError", data: { message: "provider failed" } } }, parts: [] }, request: {}, response: {} }, "error", "session-prompt-error"],
    ["api-error", { error: { name: "UnknownError", data: { message: "provider failed" } }, request: {}, response: {} }, "error", "session-prompt-error"],
  ])("blocks unusable SDK result: %s", async (_label, response, status, reason) => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const session = {
      create: vi.fn().mockResolvedValue(sdkCreateResult("child-result")),
      prompt: vi.fn().mockResolvedValue(response),
      abort: vi.fn().mockResolvedValue(true),
    }
    const output = await createODFDelegate({ session } as any, tempHome).execute(
      { phase: "ASSESS", prompt: "Assess a sales feature", context_files: [] },
      { sessionID: "parent-result", directory: tempHome, abort: new AbortController().signal } as any,
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe(status)
    expect(envelope.message).toContain(reason)
    if (status === "blocked") expect(session.abort).toHaveBeenCalledTimes(1 - Number(_label === "empty"))
  })

  it("aborts the child session on timeout", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const session = {
      create: vi.fn().mockResolvedValue(sdkCreateResult("child-timeout")),
      prompt: vi.fn().mockReturnValue(new Promise(() => {})),
      abort: vi.fn().mockResolvedValue(true),
    }
    const output = await createODFDelegate({ session } as any, tempHome).execute(
      { phase: "ASSESS", prompt: "Assess a sales feature", context_files: [], timeout_ms: 10 },
      { sessionID: "parent-timeout", directory: tempHome, abort: new AbortController().signal } as any,
    )

    expect(JSON.parse(output as string)).toMatchObject({ status: "timeout" })
    expect(session.abort).toHaveBeenCalledWith({ path: { id: "child-timeout" }, query: { directory: tempHome } })
  })

  it("aborts the child session when the tool is cancelled", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const controller = new AbortController()
    const session = {
      create: vi.fn().mockResolvedValue(sdkCreateResult("child-cancelled")),
      prompt: vi.fn().mockReturnValue(new Promise(() => {})),
      abort: vi.fn().mockResolvedValue(true),
    }
    const pending = createODFDelegate({ session } as any, tempHome).execute(
      { phase: "ASSESS", prompt: "Assess a sales feature", context_files: [] },
      { sessionID: "parent-cancelled", directory: tempHome, abort: controller.signal } as any,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort()
    const envelope = JSON.parse(await pending as string)

    expect(envelope).toMatchObject({ status: "blocked", reason: "task-cancelled" })
    expect(session.abort).toHaveBeenCalledWith({ path: { id: "child-cancelled" }, query: { directory: tempHome } })
  })

  it("keeps concurrent SDK child sessions isolated", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const session = {
      // Map by parent so assertions hold regardless of Promise.all call order.
      create: vi.fn().mockImplementation(({ body }: { body: { parentID: string } }) =>
        Promise.resolve(sdkCreateResult(body.parentID === "parent-a" ? "child-a" : "child-b"))),
      prompt: vi.fn().mockImplementation(({ path: promptPath }: { path: { id: string } }) =>
        Promise.resolve(sdkPromptResult({ status: "ok", executive_summary: promptPath.id }))),
      abort: vi.fn().mockResolvedValue(true),
    }
    const delegateTool = createODFDelegate({ session } as any, tempHome)
    const [first, second] = await Promise.all([
      delegateTool.execute(
        { phase: "ASSESS", prompt: "Assess one", context_files: [] },
        { sessionID: "parent-a", directory: tempHome, abort: new AbortController().signal } as any,
      ),
      delegateTool.execute(
        { phase: "ASSESS", prompt: "Assess two", context_files: [] },
        { sessionID: "parent-b", directory: tempHome, abort: new AbortController().signal } as any,
      ),
    ])

    expect([JSON.parse(first as string).result.executive_summary, JSON.parse(second as string).result.executive_summary].sort()).toEqual(["child-a", "child-b"])
    expect(session.create.mock.calls.map(call => call[0].body.parentID).sort()).toEqual(["parent-a", "parent-b"])
    expect(session.prompt.mock.calls.map(call => call[0].path.id).sort()).toEqual(["child-a", "child-b"])
  })

  it("allows IMPLEMENT when PLAN advances to BUILD", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "implemented" })
    await prepareWorkflowState("gate-build", "IMPLEMENT")
    await writeValidationEvidence("gate-build")
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute(
      {
        phase: "IMPLEMENT",
        change: "gate-build",
        artifact_store: "openspec",
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
    const committed = YAML.parse(await fs.readFile(path.join(tempHome, "openspec", "changes", "gate-build", "state.yaml"), "utf8"))
    expect(committed).toMatchObject({ canonical_stage: "BUILD", completed_canonical_stages: ["DECIDE", "PLAN", "BUILD"] })
    expect(getMetricsBuffer()[0]).toMatchObject({ work_type: "feature" })
    expect(getMetricsBuffer()[0].branch_id).toBeUndefined()
  })

  it.each([
    ["ok", { status: "ok", executive_summary: "implemented" }, "ok", "delegated", "delegated"],
    ["warning", { status: "warning", executive_summary: "implemented with warnings" }, "ok", "delegated", "delegated"],
    ["blocked", { status: "blocked", message: "blocked by a check" }, "blocked", "error", "blocked"],
    ["failed", { status: "failed", message: "checks failed" }, "error", "error", "blocked"],
    ["missing", { message: "no result status" }, "error", "error", "blocked"],
    ["invalid", { status: "unexpected" }, "error", "error", "blocked"],
  ])("classifies inner %s results for metrics, settlement, and receipts", async (label, taskResult, metricStatus, ledgerResultStatus, envelopeStatus) => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const change = `inner-${label}`
    await prepareWorkflowState(change, "IMPLEMENT")
    if (label === "ok" || label === "warning") await writeValidationEvidence(change)
    const taskApi = vi.fn().mockResolvedValue(taskResult)
    const output = await createODFDelegate(undefined, tempHome).execute({
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      attempt_id: `${change}-attempt`,
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: `session-${label}`, task: taskApi } as any)

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe(envelopeStatus)
    expect(getMetricsBuffer().at(-1)).toMatchObject({ status: metricStatus })
    const ledger = (await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(ledger.at(-1)).toMatchObject({
      status: label === "ok" || label === "warning" ? "completed" : "failed",
      result_status: ledgerResultStatus,
    })
    const receiptPath = path.join(tempHome, ".odf", `receipt-${change}.json`)
    if (label === "ok" || label === "warning") {
      expect(fsSync.existsSync(receiptPath)).toBe(false)
    } else {
      expect(JSON.parse(await fs.readFile(receiptPath, "utf8"))).toMatchObject({
        status: label === "blocked" ? "blocked" : "failed",
        cause: "error",
      })
    }
  })

  it("keeps proof-less legacy invocation compatible while recording an invalid inner result", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "failed", message: "legacy failure" })
    const output = await createODFDelegate(undefined, tempHome).execute({
      phase: "DESIGN",
      prompt: "Design the change",
      context_files: [],
    }, { sessionID: "legacy-invalid-inner", task: taskApi } as any)

    expect(JSON.parse(output as string).status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
    expect(getMetricsBuffer()[0]).toMatchObject({ status: "error" })
  })

  it("blocks a destructive prompt pre-tool and never delegates (T11)", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
     const taskApi = vi.fn().mockResolvedValue({ status: "ok", design_closed: true })
    const output = await createODFDelegate(undefined, tempHome).execute({
      phase: "DESIGN",
      prompt: "Run DROP DATABASE mydb; and start over",
      context_files: [],
    }, { sessionID: "t11-destructive", task: taskApi } as any)

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("blocked")
    expect(envelope.reason).toBe("pre-tool-safety")
    expect(envelope.classes).toContain("destructive")
    expect(String(envelope.safe_continuation || "").length).toBeGreaterThan(0)
    expect(taskApi).not.toHaveBeenCalled()
    expect(getMetricsBuffer().at(-1)).toMatchObject({ status: "blocked" })
  })

  it("still delegates a benign prompt (T11 no false positive)", async () => {
    const { createODFDelegate, clearMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", design_closed: true })
    const output = await createODFDelegate(undefined, tempHome).execute({
      phase: "DESIGN",
      prompt: "Design a new res.partner extension with a computed field",
      context_files: [],
    }, { sessionID: "t11-benign", task: taskApi } as any)

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("uses a persisted pending receipt instead of caller receipt_state none", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const change = "persisted-pending-receipt"
    await prepareWorkflowState(change, "IMPLEMENT")
    await fs.mkdir(path.join(tempHome, ".odf"), { recursive: true })
    await fs.writeFile(path.join(tempHome, ".odf", `receipt-${change}.json`), JSON.stringify({ status: "failed", action: null }), "utf8")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })

    const output = JSON.parse(await createODFDelegate(undefined, tempHome).execute({
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      attempt_id: "pending-receipt-attempt",
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "pending-receipt-session", task: taskApi } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "workflow-receipt-pending" })
    expect(taskApi).not.toHaveBeenCalled()
    expect(fsSync.existsSync(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`))).toBe(false)
  })

  it("uses a persisted retry receipt instead of stale caller receipt_state pending", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const change = "persisted-retry-receipt"
    await prepareWorkflowState(change, "IMPLEMENT")
    await writeValidationEvidence(change)
    await fs.mkdir(path.join(tempHome, ".odf"), { recursive: true })
    await fs.writeFile(path.join(tempHome, ".odf", `receipt-${change}.json`), JSON.stringify({ status: "failed", action: { committed: "retry" } }), "utf8")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "retried" })
    const proof = { ...workflowAdvance("IMPLEMENT"), receipt_state: "pending" as const }

    const output = JSON.parse(await createODFDelegate(undefined, tempHome).execute({
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      attempt_id: "retry-receipt-attempt",
      prompt: "Retry the implementation",
      context_files: [],
      workflow_advance: proof,
    }, { sessionID: "retry-receipt-session", task: taskApi } as any) as string)

    expect(output.status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it.each(["abandon", "re-plan", "scope-change"])("blocks committed %s receipts before continuation", async action => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const change = `committed-${action}`
    await prepareWorkflowState(change, "IMPLEMENT")
    await fs.mkdir(path.join(tempHome, ".odf"), { recursive: true })
    await fs.writeFile(path.join(tempHome, ".odf", `receipt-${change}.json`), JSON.stringify({ status: "failed", action: { committed: action } }), "utf8")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })

    const output = JSON.parse(await createODFDelegate(undefined, tempHome).execute({
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      attempt_id: `${change}-attempt`,
      prompt: "Continue the implementation",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: `session-${action}`, task: taskApi } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "workflow-receipt-action-unhandled" })
    expect(taskApi).not.toHaveBeenCalled()
    expect(fsSync.existsSync(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`))).toBe(false)
  })

  it("fails closed on malformed persisted receipt JSON", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const change = "malformed-receipt"
    await prepareWorkflowState(change, "IMPLEMENT")
    await fs.mkdir(path.join(tempHome, ".odf"), { recursive: true })
    await fs.writeFile(path.join(tempHome, ".odf", `receipt-${change}.json`), "{not-json", "utf8")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })

    const output = JSON.parse(await createODFDelegate(undefined, tempHome).execute({
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      attempt_id: "malformed-receipt-attempt",
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "malformed-receipt-session", task: taskApi } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "workflow-receipt-malformed" })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("acquires the first attempt and appends a completed settlement", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    await writeValidationEvidence("attempt-first")
    await prepareWorkflowState("attempt-first", "IMPLEMENT")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "implemented" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "attempt-first",
      artifact_store: "openspec",
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
    await prepareWorkflowState("attempt-duplicate", "IMPLEMENT")
    await writeValidationEvidence("attempt-duplicate")
    const delegateTool = createODFDelegate(undefined, tempHome)
    const input = {
      phase: "IMPLEMENT",
      change: "attempt-duplicate",
      artifact_store: "openspec",
      attempt_id: "duplicate-1",
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }

    expect(JSON.parse(await delegateTool.execute(input, { sessionID: "s1", task: taskApi } as any) as string).status).toBe("delegated")
    const blocked = JSON.parse(await delegateTool.execute(input, { sessionID: "s1", task: taskApi } as any) as string)
    expect(blocked).toMatchObject({ status: "delegated", workflow_commit: { status: "already-committed" } })
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("blocks a new attempt after the phase is completed", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    await verifyEvidenceFor("attempt-complete")
    const delegateTool = createODFDelegate(undefined, tempHome)
    const base = { phase: "VERIFY", change: "attempt-complete", artifact_store: "openspec" as const, prompt: "Verify the change", context_files: [], workflow_advance: workflowAdvance("VERIFY") }

    await delegateTool.execute({ ...base, attempt_id: "verify-1" }, { sessionID: "s1", task: taskApi } as any)
    const blocked = JSON.parse(await delegateTool.execute({ ...base, attempt_id: "verify-2" }, { sessionID: "s1", task: taskApi } as any) as string)
    expect(blocked).toMatchObject({ status: "delegated", workflow_commit: { status: "already-committed" } })
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("blocks a second attempt while the first is running", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    let resolveTask!: (value: unknown) => void
    const taskApi = vi.fn().mockReturnValue(new Promise(resolve => { resolveTask = resolve }))
    await prepareWorkflowState("attempt-running", "IMPLEMENT")
    await writeValidationEvidence("attempt-running")
    const delegateTool = createODFDelegate(undefined, tempHome)
    const first = delegateTool.execute({
      phase: "IMPLEMENT",
      change: "attempt-running",
      artifact_store: "openspec",
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
      artifact_store: "openspec",
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
    await prepareWorkflowState("lock-contention", "IMPLEMENT")
    await writeValidationEvidence("lock-contention")
    const delegateTool = createODFDelegate(undefined, tempHome)
    const ledgerPath = path.join(tempHome, ".odf", "attempt-ledger-lock-contention.jsonl")
    const lockPath = `${ledgerPath}.lock`
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true })
    await fs.writeFile(lockPath, "held\n")

    const output = await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "lock-contention",
      artifact_store: "openspec",
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
    await prepareWorkflowState("attempt-failed", "IMPLEMENT")
    const delegateTool = createODFDelegate(undefined, tempHome)
    const base = { phase: "IMPLEMENT", change: "attempt-failed", artifact_store: "openspec" as const, prompt: "Implement the change", context_files: [], workflow_advance: workflowAdvance("IMPLEMENT") }

    const first = JSON.parse(await delegateTool.execute({ ...base, attempt_id: "failed-1" }, { sessionID: "s1", task: taskApi } as any) as string)
    await fs.rm(path.join(tempHome, ".odf", "receipt-attempt-failed.json"), { force: true })
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
    await prepareWorkflowState("validation-retry", "IMPLEMENT")
    const stateBeforeValidationFailure = await fs.readFile(path.join(tempHome, "openspec", "changes", "validation-retry", "state.yaml"), "utf8")
    const delegateTool = createODFDelegate(undefined, tempHome)
    const base = { phase: "IMPLEMENT", change: "validation-retry", artifact_store: "openspec" as const, prompt: "Implement the change", context_files: [], workflow_advance: workflowAdvance("IMPLEMENT") }

    const first = JSON.parse(await delegateTool.execute({ ...base, attempt_id: "validation-retry-1" }, { sessionID: "s1", task: taskApi } as any) as string)
    expect(first).toMatchObject({ status: "blocked", reason: "workflow-evidence-invalid", validation: { status: "missing" } })
    expect(await fs.readFile(path.join(tempHome, "openspec", "changes", "validation-retry", "state.yaml"), "utf8")).toBe(stateBeforeValidationFailure)

    const firstLedger = (await fs.readFile(path.join(tempHome, ".odf", "attempt-ledger-validation-retry.jsonl"), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(firstLedger.at(-1)).toMatchObject({ status: "failed", reason: "validation-failed", result_status: "validation-failed" })

    await fs.rm(path.join(tempHome, ".odf", "receipt-validation-retry.json"), { force: true })
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
      artifact_store: "openspec",
      attempt_id: attemptId,
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)

    expect(JSON.parse(output as string)).toMatchObject({ status: "blocked", reason })
    expect(taskApi).not.toHaveBeenCalled()
    expect(fsSync.existsSync(path.join(tempHome, ".odf"))).toBe(false)
  })

  it("requires attempt_id for explicit workflow delegation and reports strict_workflow default true", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const gatedOutput = await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "explicit-attempt-required",
      artifact_store: "openspec",
      prompt: "Implement the explicitly gated call",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)
    expect(JSON.parse(gatedOutput as string)).toMatchObject({ status: "blocked", reason: "attempt-id-required" })
    expect(taskApi).not.toHaveBeenCalled()

    const installedRegistry = JSON.parse(await fs.readFile(path.join(tempHome, ".config", "opencode", "odf-registry.json"), "utf8"))
    expect(installedRegistry.flags.strict_workflow).toBe(true)
  })

  it.each(["IMPLEMENT", "VERIFY"] as const)("strict mode blocks %s without proof before task, ledger, or policy gate", async phase => {
    await setRegistryFlags({ strict_workflow: true })
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const change = `strict-missing-${phase.toLowerCase()}`

    const output = await delegateTool.execute({
      phase,
      change,
      artifact_store: "openspec",
      prompt: `Run strict ${phase}`,
      context_files: [],
    }, { sessionID: "s1", task: taskApi } as any)

    const envelope = JSON.parse(output as string)
    expect(envelope).toMatchObject({
      status: "blocked",
      reason: "strict-workflow-proof-required",
      message: "Strict workflow mode requires workflow_advance for IMPLEMENT/VERIFY; legacy omissions are allowed only when flags.strict_workflow is false.",
      workflow_advance: null,
      policy_gate: null,
      receipt: null,
    })
    expect(taskApi).not.toHaveBeenCalled()
    expect(fsSync.existsSync(path.join(tempHome, ".odf"))).toBe(false)
    expect(fsSync.existsSync(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`))).toBe(false)
    expect(fsSync.existsSync(path.join(tempHome, ".odf", `policy-gate-${change}.json`))).toBe(false)
  })

  it("strict-default-blocks-legacy-omission: default registry blocks IMPLEMENT/VERIFY without proof before task()", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    for (const phase of ["IMPLEMENT", "VERIFY"] as const) {
      const change = `strict-default-${phase.toLowerCase()}`
      const output = await delegateTool.execute({
        phase,
        change,
        prompt: `Run ${phase} without proof`,
        context_files: [],
      }, { sessionID: "s1", task: taskApi } as any)
      const envelope = JSON.parse(output as string)
      expect(envelope).toMatchObject({
        status: "blocked",
        reason: "strict-workflow-proof-required",
        message: "Strict workflow mode requires workflow_advance for IMPLEMENT/VERIFY; legacy omissions are allowed only when flags.strict_workflow is false.",
        workflow_advance: null,
        policy_gate: null,
        receipt: null,
      })
      expect(taskApi).not.toHaveBeenCalled()
      expect(fsSync.existsSync(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`))).toBe(false)
    }
  })

  it("strict-opt-out-allows-legacy: strict_workflow false preserves the legacy omission self-service exit", async () => {
    await setRegistryFlags({ strict_workflow: false })
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const output = await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "strict-opt-out",
      prompt: "Implement the legacy call under opt-out",
      context_files: [],
    }, { sessionID: "s1", task: taskApi } as any)
    expect(JSON.parse(output as string).status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
    expect(fsSync.existsSync(path.join(tempHome, ".odf", "attempt-ledger-strict-opt-out.jsonl"))).toBe(false)
  })

  it("strict-parallel-delegate-blocks-without-shared-proof: parallel BUILD blocks without the shared workflow_advance proof", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)
    const output = await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-strict-missing-proof",
      artifact_store: "openspec",
      branches: parallelBranches("strict"),
    }, { sessionID: "s1", task: taskApi } as any)
    const envelope = JSON.parse(output as string)
    expect(envelope).toMatchObject({
      status: "blocked",
      reason: "parallel-workflow-proof-mismatch",
    })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it.each(["IMPLEMENT", "VERIFY"] as const)("strict-happy-path: strict mode delegates valid %s with workflow_advance, artifact_store, and attempt_id", async phase => {
    await setRegistryFlags({ strict_workflow: true })
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "completed" })
    const delegateTool = createODFDelegate(undefined, tempHome)
    const change = `strict-valid-${phase.toLowerCase()}`
    if (phase === "IMPLEMENT") {
      await writeValidationEvidence(change)
      await prepareWorkflowState(change, phase)
    } else {
      await verifyEvidenceFor(change)
    }

    const output = await delegateTool.execute({
      phase,
      change,
      artifact_store: "openspec",
      attempt_id: `strict-${phase.toLowerCase()}-1`,
      prompt: `Run strict ${phase}`,
      context_files: [],
      workflow_advance: workflowAdvance(phase),
    }, { sessionID: "s1", task: taskApi } as any)

    expect(JSON.parse(output as string).status).toBe("delegated")
    expect(taskApi).toHaveBeenCalledTimes(1)
    const ledgerPath = path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`)
    const records = (await fs.readFile(ledgerPath, "utf8")).trim().split("\n").map(line => JSON.parse(line))
    expect(records.map(record => record.status)).toEqual(["running", "completed"])
    expect(records[0]).toMatchObject({ phase, change, attempt_id: `strict-${phase.toLowerCase()}-1` })
  })

  it.each([
    ["invalid", "approved: false\n"],
    ["tampered", "change: another-change\n"],
  ])("blocks VERIFY when Expectations are %s before task()", async (_status, override) => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const change = `expectations-${_status}`
    await writeExpectations(change, override)
    await verifyEvidenceFor(change)
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const output = await createODFDelegate(undefined, tempHome).execute({
      phase: "VERIFY", change, artifact_store: "openspec", attempt_id: `${change}-1`,
      prompt: "Verify the change", context_files: [], workflow_advance: workflowAdvance("VERIFY"),
    }, { sessionID: "s1", task: taskApi } as any)
    expect(JSON.parse(output as string)).toMatchObject({
      status: "blocked",
      reason: _status === "invalid" ? "expectations-not-approved" : "expectations-invalid",
      safe_continuation: `/odf-continue ${change}`,
    })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("delegates VERIFY with approved Expectations", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const change = "expectations-approved"
    await writeExpectations(change)
    await verifyEvidenceFor(change)
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const output = await createODFDelegate(undefined, tempHome).execute({
      phase: "VERIFY", change, artifact_store: "openspec", attempt_id: `${change}-1`,
      prompt: "Verify the change", context_files: [], workflow_advance: workflowAdvance("VERIFY"),
    }, { sessionID: "s1", task: taskApi } as any)
    expect(JSON.parse(output as string)).toMatchObject({
      status: "delegated",
      validation: { status: "verified", expectations_ids: ["EXP-01"] },
    })
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("keeps legacy VERIFY delegation when Expectations are missing", async () => {
    const { createODFDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    const change = "expectations-missing"
    await verifyEvidenceFor(change)
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const output = await createODFDelegate(undefined, tempHome).execute({
      phase: "VERIFY", change, artifact_store: "openspec", attempt_id: `${change}-1`,
      prompt: "Verify the change", context_files: [], workflow_advance: workflowAdvance("VERIFY"),
    }, { sessionID: "s1", task: taskApi } as any)
    expect(JSON.parse(output as string)).toMatchObject({ status: "delegated", warnings: ["missing-expectations"] })
    expect(getMetricsBuffer().at(-1)?.warnings).toEqual(["missing-expectations"])
    const status = JSON.parse(await createODFWorkflowStatus().execute({ change_name: change, workspace_dir: tempHome }, {} as any) as string)
    expect(status.warnings).toContain("missing-expectations")
    expect(taskApi).toHaveBeenCalledTimes(1)
  })

  it("verify-fail-closed-without-git: blocks VERIFY delegation when no git repo exists", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    await prepareWorkflowState("verify-no-git", "VERIFY")
    const delegateTool = createODFDelegate(undefined, tempHome)
    const output = await delegateTool.execute({
      phase: "VERIFY",
      change: "verify-no-git",
      artifact_store: "openspec",
      attempt_id: "verify-no-git-1",
      prompt: "Verify the change",
      context_files: [],
      workflow_advance: workflowAdvance("VERIFY"),
    }, { sessionID: "s1", task: taskApi } as any)

    const envelope = JSON.parse(output as string)
    expect(envelope).toMatchObject({ status: "blocked" })
    expect(envelope.reason).toContain("verification-unavailable")
    expect(envelope.reason).toContain("initialize a git repository")
    expect(taskApi).not.toHaveBeenCalled()
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
    await prepareWorkflowState("legacy-record", "IMPLEMENT")
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute({
      phase: "IMPLEMENT",
      change: "legacy-record",
      artifact_store: "openspec",
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
    await verifyEvidenceFor("gate-verify")
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute(
      {
        phase: "VERIFY",
        change: "gate-verify",
        artifact_store: "openspec",
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
    const committed = YAML.parse(await fs.readFile(path.join(tempHome, "openspec", "changes", "gate-verify", "state.yaml"), "utf8"))
    expect(committed).toMatchObject({ canonical_stage: "VERIFY", completed_canonical_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"] })
    const status = JSON.parse(await createODFWorkflowStatus().execute({ change_name: "gate-verify", workspace_dir: tempHome }, {} as any) as string)
    expect(status).toMatchObject({ canonical_stage: "VERIFY", pending_stage: null, completed_canonical_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"] })
  })

  it("allows the initial VERIFY start for verify-only", async () => {
    const { createODFDelegate, clearMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "verified" })
    await verifyEvidenceFor("gate-verify-only", "verify-only")
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute(
      {
        phase: "VERIFY",
        change: "gate-verify-only",
        artifact_store: "openspec",
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

  it.each([
    ["BUILD", "workflow-implement-progress-missing"],
    ["VERIFY", "workflow-verify-report-missing"],
  ] as const)("blocks %s when its terminal artifact is missing", async (stage, reason) => {
    const change = `missing-${stage.toLowerCase()}-artifact`
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    const proof = workflowAdvance(stage === "BUILD" ? "IMPLEMENT" : "VERIFY")
    await fs.writeFile(path.join(changeDir, "state.yaml"), [
      "work_type: feature",
      `canonical_stage: ${stage}`,
      `completed_canonical_stages: [DECIDE, PLAN${stage === "VERIFY" ? ", BUILD" : ""}]`,
      "resumable: true",
      "",
    ].join("\n"), "utf8")
    const result = await commitWorkflowTransition({
      workspaceRoot: tempHome,
      changeName: change,
      artifactStore: "openspec",
      proof,
      expectedStage: stage === "BUILD" ? "BUILD" : "VERIFY",
      callerResult: advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof }),
      phaseResultStatus: "ok",
      validationStatus: stage === "BUILD" ? "verified" : "verified",
      validation: { status: "verified", reason: "focused test evidence", commands_validated: 2 },
    })
    expect(result).toMatchObject({ status: "blocked", reason })
  })

  it.each([undefined, false])("blocks DESIGN when design_closed is %s", async designClosed => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", ...(designClosed === undefined ? {} : { design_closed: designClosed }) })
    const output = JSON.parse(await createODFDelegate(undefined, tempHome).execute({
      phase: "DESIGN",
      prompt: "Close the technical design",
      context_files: [],
    }, { sessionID: `design-open-${String(designClosed)}`, task: taskApi } as any) as string)
    expect(output).toMatchObject({ status: "blocked", reason: "design-not-closed" })
    expect(output.message).toContain("continue DESIGN")
  })

  it("delegates DESIGN when design_closed is true", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", design_closed: true, executive_summary: "closed" })
    const output = JSON.parse(await createODFDelegate(undefined, tempHome).execute({
      phase: "DESIGN",
      prompt: "Close the technical design",
      context_files: [],
    }, { sessionID: "design-closed", task: taskApi } as any) as string)
    expect(output.status).toBe("delegated")
  })

  it("commits an atomic OpenSpec BUILD, preserves unrelated YAML, and is idempotent", async () => {
    const change = "direct-build-commit"
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    const before = [
      "# keep this comment",
      "work_type: feature",
      "canonical_stage: BUILD",
      "completed_canonical_stages: [DECIDE, PLAN]",
      "resumable: true",
      "preflight:",
      "  solution_strategy: custom",
      "unrelated: keep-me",
      "",
    ].join("\n")
    const statePath = path.join(changeDir, "state.yaml")
    await fs.writeFile(statePath, before, "utf8")
    await fs.writeFile(path.join(changeDir, "implement-progress.md"), "- [x] implementation\n", "utf8")
    const proof = workflowAdvance("IMPLEMENT")
    const recomputed = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })
    const input = {
      workspaceRoot: tempHome,
      changeName: change,
      artifactStore: "openspec" as const,
      proof,
      expectedStage: "BUILD" as const,
      callerResult: recomputed,
      phaseResultStatus: "warning" as const,
      validationStatus: "verified" as const,
      validation: { status: "verified" as const, reason: "focused test evidence", commands_validated: 2 },
    }

    const first = await commitWorkflowTransition(input)
    expect(first).toMatchObject({
      status: "committed",
      store: "openspec",
      state_ref: `openspec/changes/${change}/state.yaml`,
      canonical_stage: "BUILD",
      completed_stages: ["DECIDE", "PLAN", "BUILD"],
    })
    const committed = await fs.readFile(statePath, "utf8")
    expect(YAML.parse(committed)).toMatchObject({
      work_type: "feature",
      canonical_stage: "BUILD",
      completed_canonical_stages: ["DECIDE", "PLAN", "BUILD"],
      preflight: { solution_strategy: "custom" },
      unrelated: "keep-me",
    })
    expect(committed).toContain("# keep this comment")
    expect((await fs.readdir(changeDir)).filter(name => name.includes(".tmp"))).toEqual([])

    const second = await commitWorkflowTransition(input)
    expect(second).toMatchObject({
      status: "already-committed",
      state_ref: `openspec/changes/${change}/state.yaml`,
      canonical_stage: "BUILD",
      completed_stages: ["DECIDE", "PLAN", "BUILD"],
    })
    expect(await fs.readFile(statePath, "utf8")).toBe(committed)
  })

  it("commits VERIFY only when the validation-evidence receipt passes the blind artifact rules", async () => {
    const change = "direct-verify-commit"
    const repo = path.join(tempHome, "repo-verify-commit")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)

    const changeDir = path.join(repo, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), [
      "work_type: feature",
      "canonical_stage: VERIFY",
      "completed_canonical_stages: [DECIDE, PLAN, BUILD]",
      "resumable: true",
      "",
    ].join("\n"), "utf8")
    await fs.writeFile(path.join(changeDir, "verify-report.yaml"), "status: passed\n", "utf8")
    const head = gitHead(repo)!
    const digest = computeCandidateDigest(buildCandidateManifest(repo))

    await fs.mkdir(path.join(repo, ".odf"), { recursive: true })
    await fs.writeFile(path.join(repo, ".odf", `policy-gate-${change}.json`), JSON.stringify({
      change, phase: "VERIFY", gate: "allow", reason: "test gate",
      tdd: { global: false, local_readable: true, local_off: false, effective: "off" },
      risk_tier: "MEDIUM", frozen_diff_ref: head, candidate_digest: digest, base_head: head,
      changed_lines: 100, correction_budget_lines: 50, changed_paths: ["a.py"],
      resolved_at: new Date().toISOString(),
    }))
    await fs.writeFile(path.join(repo, ".odf", `validation-evidence-${change}.json`), JSON.stringify({
      change, phase: "VERIFY", batch: 1, risk_tier: "MEDIUM", frozen_diff_ref: head,
      candidate_digest: digest, executor: "odoo_qa_engineer", test_identity: "a.py test suite",
      resolved_at: new Date().toISOString(),
      commands: [
        { name: "git-diff-check", command: "git diff --check", database: "odf_test_db", exit_code: 0, output_tail: "no whitespace errors" },
        { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "12 passed, 0 failed" },
      ],
    }), "utf8")
    const proof = workflowAdvance("VERIFY")
    const recomputed = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })

    const result = await commitWorkflowTransition({
      workspaceRoot: repo,
      changeName: change,
      artifactStore: "openspec",
      proof,
      expectedStage: "VERIFY",
      callerResult: recomputed,
      phaseResultStatus: "ok",
      validationStatus: "verified",
      validation: null,
    })

    expect(result).toMatchObject({
      status: "committed",
      state_ref: `openspec/changes/${change}/state.yaml`,
      canonical_stage: "VERIFY",
      completed_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
      validation: { status: "verified" },
    })
    expect(YAML.parse(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8"))).toMatchObject({
      canonical_stage: "VERIFY",
      completed_canonical_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
    })
  })

  it("returns typed lifecycle outcomes without recording cross-boundary side effects", async () => {
    const { clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const change = "lifecycle-seam"
    await prepareWorkflowState(change, "IMPLEMENT")
    const proof = workflowAdvance("IMPLEMENT")
    const callerResult = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })
    const input = {
      workspaceRoot: tempHome,
      changeName: change,
      artifactStore: "openspec" as const,
      proof,
      expectedStage: "BUILD" as const,
      callerResult,
      innerResultStatus: "ok" as const,
      validationStatus: "verified" as const,
      validation: { status: "verified" as const, reason: "focused test evidence", commands_validated: 2 },
    }

    const committed = await resolveProofBackedLifecycle(input)
    expect(committed).toMatchObject({
      status: "committed",
      reason: "committed",
      state_ref: `openspec/changes/${change}/state.yaml`,
    })
    expect(committed).not.toHaveProperty("receipt")
    expect(committed).not.toHaveProperty("result")
    expect(committed).not.toHaveProperty("task_api_source")
    expect(getMetricsBuffer()).toEqual([])
    expect(fsSync.existsSync(path.join(tempHome, ".odf", `receipt-${change}.json`))).toBe(false)
    expect(fsSync.existsSync(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`))).toBe(false)

    const alreadyCommitted = await resolveProofBackedLifecycle(input)
    expect(alreadyCommitted).toMatchObject({
      status: "already-committed",
      reason: "already-committed",
      state_ref: `openspec/changes/${change}/state.yaml`,
    })
    expect(getMetricsBuffer()).toEqual([])
  })

  it("digest-mismatch: blocks a VERIFY transition bound to a stale candidate receipt without consuming an attempt", async () => {
    const change = "digest-mismatch-verify"
    const repo = path.join(tempHome, "repo-digest")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)
    const digestA = computeCandidateDigest(buildCandidateManifest(repo))

    const changeDir = path.join(repo, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), [
      "work_type: feature",
      "canonical_stage: VERIFY",
      "completed_canonical_stages: [DECIDE, PLAN, BUILD]",
      "resumable: true",
      "",
    ].join("\n"), "utf8")
    await fs.writeFile(path.join(changeDir, "verify-report.yaml"), "status: passed\n", "utf8")
    await fs.writeFile(path.join(changeDir, "verify.yaml"), "status: passed\n", "utf8")
    await fs.mkdir(path.join(repo, ".odf"), { recursive: true })
    await fs.writeFile(path.join(repo, ".odf", `receipt-${change}.json`), JSON.stringify({
      change,
      phase: "VERIFY",
      status: "failed",
      cause: "validation-failed",
      evidence: { summary: "old candidate failed", frozen_diff_ref: null, failing: [], refs: [] },
      action: { committed: "retry" },
      review_gate: null,
      frozen_diff_ref: null,
      candidate_digest: digestA,
      resolved_at: new Date().toISOString(),
    }), "utf8")

    appendLines(repo, "a.py", 1)
    const proof = workflowAdvance("VERIFY")
    const recomputed = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })
    const result = await commitWorkflowTransition({
      workspaceRoot: repo,
      changeName: change,
      artifactStore: "openspec",
      proof,
      expectedStage: "VERIFY",
      callerResult: recomputed,
      phaseResultStatus: "ok",
      validationStatus: "verified",
      validation: null,
    })

    expect(result).toMatchObject({ status: "blocked", reason: "candidate-digest-mismatch", canonical_stage: "VERIFY" })
    expect(result.message).toContain("candidate-digest-mismatch: the receipt is bound to candidate")
    expect(fsSync.existsSync(path.join(repo, ".odf", `attempt-ledger-${change}.jsonl`))).toBe(false)
    expect(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8")).toContain("canonical_stage: VERIFY")
  })

  it("compatibility: transitions with no candidate digests are not blocked by digest", async () => {
    const change = "legacy-digest-free"
    const repo = path.join(tempHome, "repo-legacy-transition")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)
    const changeDir = path.join(repo, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), [
      "work_type: feature",
      "canonical_stage: BUILD",
      "completed_canonical_stages: [DECIDE, PLAN]",
      "resumable: true",
      "",
    ].join("\n"), "utf8")
    await fs.writeFile(path.join(changeDir, "implement-progress.md"), "- [x] implementation\n", "utf8")

    const proof = workflowAdvance("IMPLEMENT")
    const recomputed = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })
    const result = await commitWorkflowTransition({
      workspaceRoot: repo,
      changeName: change,
      artifactStore: "openspec",
      proof,
      expectedStage: "BUILD",
      callerResult: recomputed,
      phaseResultStatus: "ok",
      validationStatus: "verified",
      validation: { status: "verified", reason: "focused test evidence", commands_validated: 2 },
    })
    expect(result).toMatchObject({ status: "committed", reason: "committed" })
  })

  it("fail-closed: blocks a VERIFY transition when the validation-evidence receipt is missing", async () => {
    const change = "verify-no-evidence"
    const repo = path.join(tempHome, "repo-verify-no-evidence")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)

    const changeDir = path.join(repo, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), [
      "work_type: feature",
      "canonical_stage: VERIFY",
      "completed_canonical_stages: [DECIDE, PLAN, BUILD]",
      "resumable: true",
      "",
    ].join("\n"), "utf8")
    await fs.writeFile(path.join(changeDir, "verify-report.yaml"), "status: passed\n", "utf8")
    const head = gitHead(repo)!
    const digest = computeCandidateDigest(buildCandidateManifest(repo))

    await fs.mkdir(path.join(repo, ".odf"), { recursive: true })
    await fs.writeFile(path.join(repo, ".odf", `policy-gate-${change}.json`), JSON.stringify({
      change, phase: "VERIFY", gate: "allow", reason: "test gate",
      tdd: { global: false, local_readable: true, local_off: false, effective: "off" },
      risk_tier: "MEDIUM", frozen_diff_ref: head, candidate_digest: digest, base_head: head,
      changed_lines: 100, correction_budget_lines: 50, changed_paths: ["a.py"],
      resolved_at: new Date().toISOString(),
    }))

    const proof = workflowAdvance("VERIFY")
    const recomputed = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })
    const result = await commitWorkflowTransition({
      workspaceRoot: repo,
      changeName: change,
      artifactStore: "openspec",
      proof,
      expectedStage: "VERIFY",
      callerResult: recomputed,
      phaseResultStatus: "ok",
      validationStatus: "verified",
      validation: null,
    })

    expect(result).toMatchObject({ status: "blocked", reason: "verification-evidence-missing", validation: { status: "missing" } })
    expect(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8")).toContain("canonical_stage: VERIFY")
  })

  it("fail-closed: blocks a VERIFY transition when the receipt is invalid (missing executor)", async () => {
    const change = "verify-invalid-evidence"
    const repo = path.join(tempHome, "repo-verify-invalid-evidence")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)

    const changeDir = path.join(repo, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), [
      "work_type: feature",
      "canonical_stage: VERIFY",
      "completed_canonical_stages: [DECIDE, PLAN, BUILD]",
      "resumable: true",
      "",
    ].join("\n"), "utf8")
    await fs.writeFile(path.join(changeDir, "verify-report.yaml"), "status: passed\n", "utf8")
    const head = gitHead(repo)!
    const digest = computeCandidateDigest(buildCandidateManifest(repo))

    await fs.mkdir(path.join(repo, ".odf"), { recursive: true })
    await fs.writeFile(path.join(repo, ".odf", `policy-gate-${change}.json`), JSON.stringify({
      change, phase: "VERIFY", gate: "allow", reason: "test gate",
      tdd: { global: false, local_readable: true, local_off: false, effective: "off" },
      risk_tier: "MEDIUM", frozen_diff_ref: head, candidate_digest: digest, base_head: head,
      changed_lines: 100, correction_budget_lines: 50, changed_paths: ["a.py"],
      resolved_at: new Date().toISOString(),
    }))
    await fs.writeFile(path.join(repo, ".odf", `validation-evidence-${change}.json`), JSON.stringify({
      change, phase: "VERIFY", batch: 1, risk_tier: "MEDIUM", frozen_diff_ref: head,
      candidate_digest: digest, test_identity: "a.py test suite",
      resolved_at: new Date().toISOString(),
      commands: [
        { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "12 passed, 0 failed" },
        { name: "git-diff-check", command: "git diff --check", database: "odf_test_db", exit_code: 0, output_tail: "no whitespace errors" },
      ],
    }), "utf8")

    const proof = workflowAdvance("VERIFY")
    const recomputed = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })
    const result = await commitWorkflowTransition({
      workspaceRoot: repo,
      changeName: change,
      artifactStore: "openspec",
      proof,
      expectedStage: "VERIFY",
      callerResult: recomputed,
      phaseResultStatus: "ok",
      validationStatus: "verified",
      validation: null,
    })

    expect(result).toMatchObject({ status: "blocked", reason: "verification-evidence-invalid", validation: { status: "invalid" } })
    expect(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8")).toContain("canonical_stage: VERIFY")
  })

  it("acquireAttempt records the candidate digest and settleAttempt preserves it", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    initGitRepo(tempHome)
    commitFile(tempHome, "README.md", 1)
    const change = "attempt-digest"
    await prepareWorkflowState(change, "IMPLEMENT")
    await writeValidationEvidence(change)
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "implemented" })
    const delegateTool = createODFDelegate(undefined, tempHome)

    const output = await delegateTool.execute({
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      attempt_id: "attempt-digest-1",
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)

    expect(JSON.parse(output as string).status).toBe("delegated")
    const ledgerPath = path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`)
    const records = (await fs.readFile(ledgerPath, "utf8")).trim().split("\n").map(line => JSON.parse(line))
    expect(records.map(record => record.status)).toEqual(["running", "completed"])
    expect(records[0].candidate_digest).toMatch(/^[0-9a-f]{64}$/)
    expect(records[1].candidate_digest).toBe(records[0].candidate_digest)
  })

  it("blocks invalid inner results and evidence without advancing state or owning receipts", async () => {
    const { clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const innerChange = "lifecycle-invalid-inner"
    const evidenceChange = "lifecycle-invalid-evidence"
    await prepareWorkflowState(innerChange, "IMPLEMENT")
    await prepareWorkflowState(evidenceChange, "IMPLEMENT")
    const proof = workflowAdvance("IMPLEMENT")
    const callerResult = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })
    const base = {
      workspaceRoot: tempHome,
      artifactStore: "openspec" as const,
      proof,
      expectedStage: "BUILD" as const,
      callerResult,
      validationStatus: "verified" as const,
    }
    const beforeInner = await fs.readFile(path.join(tempHome, "openspec", "changes", innerChange, "state.yaml"), "utf8")
    const beforeEvidence = await fs.readFile(path.join(tempHome, "openspec", "changes", evidenceChange, "state.yaml"), "utf8")

    const invalidInner = await resolveProofBackedLifecycle({
      ...base,
      changeName: innerChange,
      innerResultStatus: "failed",
      validation: { status: "verified", reason: "not reached", commands_validated: 2 },
    })
    const invalidEvidence = await resolveProofBackedLifecycle({
      ...base,
      changeName: evidenceChange,
      innerResultStatus: "ok",
      validation: { status: "missing", reason: "evidence missing", commands_validated: 0 },
    })

    expect(invalidInner).toMatchObject({ status: "blocked", reason: "inner-result-status-invalid", state_ref: `openspec/changes/${innerChange}/state.yaml` })
    expect(invalidEvidence).toMatchObject({ status: "blocked", reason: "workflow-evidence-invalid", state_ref: `openspec/changes/${evidenceChange}/state.yaml` })
    expect(await fs.readFile(path.join(tempHome, "openspec", "changes", innerChange, "state.yaml"), "utf8")).toBe(beforeInner)
    expect(await fs.readFile(path.join(tempHome, "openspec", "changes", evidenceChange, "state.yaml"), "utf8")).toBe(beforeEvidence)
    expect(getMetricsBuffer()).toEqual([])
    for (const change of [innerChange, evidenceChange]) {
      expect(fsSync.existsSync(path.join(tempHome, ".odf", `receipt-${change}.json`))).toBe(false)
      expect(fsSync.existsSync(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`))).toBe(false)
    }
  })

  it("blocks a stale route-prefix mismatch without changing OpenSpec", async () => {
    const change = "direct-stale-commit"
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    const before = "work_type: feature\ncanonical_stage: BUILD\ncompleted_canonical_stages: [DECIDE]\nresumable: true\n"
    const statePath = path.join(changeDir, "state.yaml")
    await fs.writeFile(statePath, before, "utf8")
    const proof = workflowAdvance("IMPLEMENT")
    const recomputed = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })

    const result = await commitWorkflowTransition({
      workspaceRoot: tempHome,
      changeName: change,
      artifactStore: "openspec",
      proof,
      expectedStage: "BUILD",
      callerResult: recomputed,
      phaseResultStatus: "ok",
      validationStatus: "verified",
      validation: { status: "verified", reason: "focused test evidence", commands_validated: 2 },
    })

    expect(result).toMatchObject({
      status: "blocked",
      reason: "workflow-state-stale",
      state_ref: `openspec/changes/${change}/state.yaml`,
      canonical_stage: "BUILD",
      completed_stages: ["DECIDE"],
    })
    expect(await fs.readFile(statePath, "utf8")).toBe(before)
  })

  it("fails closed when the selected Engram state save fails", async () => {
    const change = "direct-engram-failure"
    const fake = await configureFakeEngram()
    const state = {
      work_type: "feature",
      canonical_stage: "BUILD",
      completed_canonical_stages: ["DECIDE", "PLAN"],
      resumable: true,
    }
    await fake.setObservations([{
      topic_key: `odf/${change}/state`,
      content: JSON.stringify(state),
      created_at: new Date().toISOString(),
    }, {
      topic_key: `odf/${change}/implement-progress`,
      content: "- [x] implementation\n",
      created_at: new Date().toISOString(),
    }])
    fake.setFailure(true)

    try {
      const proof = workflowAdvance("IMPLEMENT")
      const recomputed = advanceWorkflow({ route: resolveWorkflowRoute(proof.work_type), ...proof })
      const result = await commitWorkflowTransition({
        workspaceRoot: tempHome,
        changeName: change,
        artifactStore: "engram",
        proof,
        expectedStage: "BUILD",
        callerResult: recomputed,
        phaseResultStatus: "ok",
        validationStatus: "verified",
        validation: { status: "verified", reason: "focused test evidence", commands_validated: 2 },
      })

      expect(result).toMatchObject({
        status: "blocked",
        reason: "engram-save-failed",
        store: "engram",
        state_ref: `odf/${change}/state`,
        canonical_stage: "BUILD",
        completed_stages: ["DECIDE", "PLAN"],
      })
      expect(fsSync.existsSync(path.join(tempHome, "openspec"))).toBe(false)
    } finally {
      await fake.cleanup()
    }
  })

  it("blocks a stale persisted work type before task()", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const change = "stale-persisted-state"
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), "work_type: bugfix\ncanonical_stage: BUILD\ncompleted_canonical_stages: [FIX]\n", "utf8")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const output = await createODFDelegate(undefined, tempHome).execute({
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      attempt_id: "stale-state-1",
      prompt: "Implement the feature",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)

    expect(JSON.parse(output as string)).toMatchObject({ status: "blocked", reason: "workflow-work-type-mismatch" })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("requires an explicit artifact store for proof-backed delegation", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const output = await createODFDelegate(undefined, tempHome).execute({
      phase: "IMPLEMENT",
      change: "missing-artifact-store",
      attempt_id: "missing-store-1",
      prompt: "Implement the change",
      context_files: [],
      workflow_advance: workflowAdvance("IMPLEMENT"),
    }, { sessionID: "s1", task: taskApi } as any)

    expect(JSON.parse(output as string)).toMatchObject({ status: "blocked", reason: "artifact-store-required" })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("uses only the selected OpenSpec or Engram store for a BUILD commit", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const openSpecRoot = await fs.mkdtemp(path.join(os.tmpdir(), "odf-selected-openspec-"))
    const engramRoot = await fs.mkdtemp(path.join(os.tmpdir(), "odf-selected-engram-"))
    const fake = await configureFakeEngram()
    const change = "selected-store-build"
    try {
      const openSpecDir = path.join(openSpecRoot, "openspec", "changes", change)
      await fs.mkdir(openSpecDir, { recursive: true })
      await fs.writeFile(path.join(openSpecDir, "state.yaml"), "work_type: feature\ncanonical_stage: BUILD\ncompleted_canonical_stages: [DECIDE, PLAN]\n", "utf8")
      await fs.writeFile(path.join(openSpecDir, "implement-progress.md"), "- [x] implementation\n", "utf8")
      await writeEvidenceAt(openSpecRoot, change)
      const openOutput = JSON.parse(await createODFDelegate(undefined, openSpecRoot).execute({
        phase: "IMPLEMENT", change, artifact_store: "openspec", attempt_id: "openspec-build-1", prompt: "Build", context_files: [], workflow_advance: workflowAdvance("IMPLEMENT"),
      }, { sessionID: "open", task: vi.fn().mockResolvedValue({ status: "ok" }) } as any) as string)
      expect(openOutput.workflow_commit).toMatchObject({ status: "committed", store: "openspec" })
      expect(fsSync.existsSync(path.join(openSpecRoot, "openspec", "changes", change, "state.yaml"))).toBe(true)
      const openCalls = fsSync.existsSync(fake.logPath) ? JSON.parse(await fs.readFile(fake.logPath, "utf8")) : []
      expect(openCalls.filter((call: string[]) => call[0] === "save")).toHaveLength(0)

      const engramChange = "selected-store-engram"
       await fake.setObservations([{
         topic_key: `odf/${engramChange}/state`,
         content: JSON.stringify({ work_type: "feature", canonical_stage: "BUILD", completed_canonical_stages: ["DECIDE", "PLAN"] }),
         created_at: new Date().toISOString(),
       }, {
         topic_key: `odf/${engramChange}/implement-progress`,
         content: "- [x] implementation\n",
         created_at: new Date().toISOString(),
       }])
      await writeEvidenceAt(engramRoot, engramChange)
      const engramOutput = JSON.parse(await createODFDelegate(undefined, engramRoot).execute({
        phase: "IMPLEMENT", change: engramChange, artifact_store: "engram", attempt_id: "engram-build-1", prompt: "Build", context_files: [], workflow_advance: workflowAdvance("IMPLEMENT"),
      }, { sessionID: "engram", task: vi.fn().mockResolvedValue({ status: "ok" }) } as any) as string)
      expect(engramOutput.workflow_commit).toMatchObject({ status: "committed", store: "engram" })
      expect(fsSync.existsSync(path.join(engramRoot, "openspec"))).toBe(false)
      const calls = JSON.parse(await fs.readFile(fake.logPath, "utf8"))
      expect(calls.filter((call: string[]) => call[0] === "save")).toHaveLength(1)
      expect(calls.find((call: string[]) => call[0] === "save")[1]).toBe(`odf/${engramChange}/state`)
    } finally {
      await fake.cleanup()
      await fs.rm(openSpecRoot, { recursive: true, force: true })
      await fs.rm(engramRoot, { recursive: true, force: true })
    }
  })

  it("archives OpenSpec only after terminal VERIFY and preserves binding", async () => {
    const change = "archive-openspec"
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), "work_type: feature\ncanonical_stage: VERIFY\ncompleted_canonical_stages: [DECIDE, PLAN, BUILD, VERIFY]\n", "utf8")
    await fs.writeFile(path.join(changeDir, "verify-report.yaml"), "status: passed\n", "utf8")
    const input = {
      workspaceRoot: tempHome, changeName: change, artifactStore: "openspec" as const,
      proof: archiveProof, expectedStage: "ARCHIVE" as const, callerResult: advanceWorkflow({ route: resolveWorkflowRoute("feature"), ...archiveProof }),
      phaseResultStatus: "ok" as const, validationStatus: "verified" as const, validation: null,
    }

    const first = await commitWorkflowTransition(input)
    expect(first).toMatchObject({ status: "committed", canonical_stage: "ARCHIVED", completed_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"] })
    expect(YAML.parse(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8"))).toMatchObject({
      work_type: "feature", canonical_stage: "ARCHIVED", completed_canonical_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"], archived: true,
    })
    expect(YAML.parse(await fs.readFile(path.join(changeDir, "archive-report.yaml"), "utf8"))).toMatchObject({ status: "archived", work_type: "feature" })
    const second = await commitWorkflowTransition(input)
    expect(second).toMatchObject({ status: "already-committed", canonical_stage: "ARCHIVED" })
  })

  it("preserves the Engram binding while archiving", async () => {
    const change = "archive-engram"
    const fake = await configureFakeEngram()
    await fake.setObservations([
      { topic_key: `odf/${change}/state`, content: JSON.stringify({ work_type: "feature", canonical_stage: "VERIFY", completed_canonical_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"] }), created_at: new Date().toISOString() },
      { topic_key: `odf/${change}/verify-report`, content: "status: passed\n", created_at: new Date().toISOString() },
    ])
    try {
      const result = await commitWorkflowTransition({
        workspaceRoot: tempHome, changeName: change, artifactStore: "engram", proof: archiveProof,
        expectedStage: "ARCHIVE", callerResult: advanceWorkflow({ route: resolveWorkflowRoute("feature"), ...archiveProof }),
        phaseResultStatus: "ok", validationStatus: "verified", validation: null,
      })
      expect(result).toMatchObject({ status: "committed", store: "engram", canonical_stage: "ARCHIVED", state_ref: `odf/${change}/state` })
      const calls = JSON.parse(await fs.readFile(fake.logPath, "utf8"))
      expect(calls.filter((call: string[]) => call[0] === "save").map((call: string[]) => call[1])).toEqual([
        `odf/${change}/state`, `odf/${change}/archive-report`,
      ])
      const saves = calls.filter((call: string[]) => call[0] === "save")
      expect(saves[0][2]).toContain('"work_type":"feature"')
    } finally {
      await fake.cleanup()
    }
  })

  it("archives hybrid with OpenSpec authority and does not leave it in VERIFY", async () => {
    const change = "archive-hybrid"
    const fake = await configureFakeEngram()
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), "work_type: feature\ncanonical_stage: VERIFY\ncompleted_canonical_stages: [DECIDE, PLAN, BUILD, VERIFY]\n", "utf8")
    await fs.writeFile(path.join(changeDir, "verify-report.yaml"), "status: passed\n", "utf8")
    try {
      const input = {
        workspaceRoot: tempHome, changeName: change, artifactStore: "hybrid" as const, proof: archiveProof,
        expectedStage: "ARCHIVE" as const, callerResult: advanceWorkflow({ route: resolveWorkflowRoute("feature"), ...archiveProof }),
        phaseResultStatus: "ok" as const, validationStatus: "verified" as const, validation: null,
      }
      const first = await commitWorkflowTransition(input)
      expect(first).toMatchObject({ status: "committed", store: "hybrid", canonical_stage: "ARCHIVED" })
      expect(YAML.parse(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8")).canonical_stage).toBe("ARCHIVED")
      const second = await commitWorkflowTransition(input)
      expect(second.status).toBe("already-committed")
      const calls = JSON.parse(await fs.readFile(fake.logPath, "utf8"))
      expect(calls.filter((call: string[]) => call[0] === "save").map((call: string[]) => call[1])).toEqual([
        `odf/${change}/state`, `odf/${change}/archive-report`,
      ])
    } finally {
      await fake.cleanup()
    }
  })

  it("blocks ARCHIVE when VERIFY is incomplete", async () => {
    const change = "archive-incomplete-verify"
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), "work_type: feature\ncanonical_stage: VERIFY\ncompleted_canonical_stages: [DECIDE, PLAN, BUILD]\n", "utf8")
    const result = await commitWorkflowTransition({
      workspaceRoot: tempHome, changeName: change, artifactStore: "openspec", proof: archiveProof,
      expectedStage: "ARCHIVE", callerResult: advanceWorkflow({ route: resolveWorkflowRoute("feature"), ...archiveProof }),
      phaseResultStatus: "ok", validationStatus: "verified", validation: null,
    })
    expect(result).toMatchObject({ status: "blocked", reason: "workflow-verify-not-terminal" })
    expect(fsSync.existsSync(path.join(changeDir, "archive-report.yaml"))).toBe(false)
  })

  it("fails closed when the workflow state write fails and leaves the attempt incomplete", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const change = "state-write-failure"
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    const statePath = path.join(changeDir, "state.yaml")
    const before = "work_type: feature\ncanonical_stage: BUILD\ncompleted_canonical_stages: [DECIDE, PLAN]\nresumable: true\n"
    await fs.writeFile(statePath, before, "utf8")
    await fs.writeFile(path.join(changeDir, "implement-progress.md"), "- [x] implementation\n", "utf8")
    await writeEvidenceAt(tempHome, change)
    await fs.chmod(changeDir, 0o555)

    try {
      const output = JSON.parse(await createODFDelegate(undefined, tempHome).execute({
        phase: "IMPLEMENT",
        change,
        artifact_store: "openspec",
        attempt_id: "state-write-failure-1",
        prompt: "Build",
        context_files: [],
        workflow_advance: workflowAdvance("IMPLEMENT"),
      }, { sessionID: "state-write-failure", task: vi.fn().mockResolvedValue({ status: "ok" }) } as any) as string)

      expect(output).toMatchObject({
        status: "blocked",
        reason: "state-write-failed",
        workflow_commit: { status: "blocked", reason: "state-write-failed" },
        receipt: { status: "blocked" },
      })
      expect(await fs.readFile(statePath, "utf8")).toBe(before)
      const ledger = (await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
        .trim().split("\n").map(line => JSON.parse(line))
      expect(ledger.at(-1)).toMatchObject({ attempt_id: "state-write-failure-1", status: "failed" })
    } finally {
      await fs.chmod(changeDir, 0o755)
    }
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
        artifact_store: "openspec",
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
        artifact_store: "openspec",
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
        artifact_store: "openspec",
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
      { phase, prompt: "Run the phase without a change identifier", context_files: [], artifact_store: "openspec", workflow_advance: workflowAdvance(phase as "IMPLEMENT" | "VERIFY") },
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
     const taskApi = vi.fn().mockResolvedValue({ status: "ok", design_closed: true, executive_summary: "planned" })
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
    await verifyEvidenceFor("boundary-test")
    const delegateTool = createODFDelegate(undefined, tempHome)

    await delegateTool.execute(
      { phase: "VERIFY", change: "boundary-test", artifact_store: "openspec", attempt_id: "boundary-verify-1", workflow_advance: workflowAdvance("VERIFY"), prompt: "Verify the implementation", context_files: [] },
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

  it("does not invent a runtime client.task fallback", async () => {
    const { createODFDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn()
    const client = { task: taskApi } as any
    const toolCtx = { sessionID: "s1" } as any

    const delegateTool = createODFDelegate(client)
    const output = await delegateTool.execute(
      { phase: "DESIGN", prompt: "Design a new model", context_files: [] },
      toolCtx
    )

    const envelope = JSON.parse(output as string)
    expect(envelope.status).toBe("blocked")
    expect(envelope.reason).toBe("task-api-unavailable")
    expect(envelope.task_api_source).toBe("unavailable")
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("uses an explicit workspace directory for policy and evidence lookup", async () => {
    await setRegistryFlags({ strict_workflow: false })
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
     const taskResult = { status: "ok", design_closed: true, executive_summary: "designed" }
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
    const { createODFParallelDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const branches = parallelBranches("success")
    await prepareWorkflowState("parallel-success", "IMPLEMENT", "cross-domain")
    await writeParallelEvidence("parallel-success", branches.map(branch => branch.branch_id))
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "branch implemented" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const output = await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-success",
      artifact_store: "openspec",
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
    const metrics = getMetricsBuffer()
    expect(metrics.filter(metric => metric.branch_id).map(metric => metric.branch_id)).toEqual(expect.arrayContaining([
      "backend-success",
      "frontend-success",
    ]))
    expect(metrics.filter(metric => metric.branch_id).every(metric => metric.work_type === "cross-domain")).toBe(true)
    expect(metrics.filter(metric => metric.join_status).map(metric => metric.join_status)).toEqual(["running", "complete"])
    expect(metrics.filter(metric => metric.join_status).map(metric => metric.validation_ratio)).toEqual([0, 1])
    expect(JSON.stringify(metrics.filter(metric => metric.join_status))).not.toContain("Implement the backend branch")
    const joinArtifact = JSON.parse(await fs.readFile(path.join(tempHome, ".odf", "parallel-join-parallel-success.json"), "utf8"))
    expect(joinArtifact).toMatchObject({
      schema_version: 1,
      change: "parallel-success",
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      join: { status: "complete", expected: 2, completed: 2, failed: 0 },
    })
    expect(joinArtifact.branches[0].descriptor.prompt).toContain("backend")
    expect(joinArtifact.branches[0].descriptor.context_files).toEqual(["backend-success.py"])
    expect(joinArtifact.branches[0].outcome.validation_evidence_ref).toContain("parallel-success-backend-success")
    expect(joinArtifact.branches[0].outcome.attempt_ledger_ref).toBe(".odf/attempt-ledger-parallel-success.jsonl")
    expect(taskApi).toHaveBeenCalledTimes(2)
    const committed = YAML.parse(await fs.readFile(path.join(tempHome, "openspec", "changes", "parallel-success", "state.yaml"), "utf8"))
    expect(committed).toMatchObject({ canonical_stage: "BUILD", completed_canonical_stages: ["DECIDE", "PLAN", "BUILD"] })

    const ledger = (await fs.readFile(path.join(tempHome, ".odf", "attempt-ledger-parallel-success.jsonl"), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(ledger.filter((record: any) => record.status === "completed")).toHaveLength(2)
    expect(ledger.map((record: any) => record.branch_id)).toEqual(expect.arrayContaining(["backend-success", "frontend-success"]))
  })

  it("isolates parallel validation evidence by branch and records each ref", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const change = "parallel-evidence-isolation"
    const branches = parallelBranches("evidence-isolation")
    await prepareWorkflowState(change, "IMPLEMENT", "cross-domain")
    await writeParallelEvidence(change, [branches[0].branch_id])
    await writeValidationEvidence(change)
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "branch implemented" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
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
    await prepareWorkflowState("parallel-invalid-input", "IMPLEMENT", "cross-domain")
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
      artifact_store: "openspec",
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
    await prepareWorkflowState("parallel-invalid-input", "IMPLEMENT", "cross-domain")
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-invalid-input",
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("keeps distinct branch attempts running concurrently in the ledger", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const branches = parallelBranches("running")
    await prepareWorkflowState("parallel-running", "IMPLEMENT", "cross-domain")
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
      artifact_store: "openspec",
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

  it("persists running branches before task() and blocks restart-style resume", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const change = "parallel-running-persisted"
    const branches = parallelBranches("running-persisted")
    await prepareWorkflowState(change, "IMPLEMENT", "cross-domain")
    await writeParallelEvidence(change, branches.map(branch => branch.branch_id))
    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    const taskApi = vi.fn()
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve }))
    const parallelTool = createODFParallelDelegate(undefined, tempHome)
    const run = parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "running-session", task: taskApi } as any)

    await vi.waitFor(async () => {
      expect(taskApi).toHaveBeenCalledTimes(2)
      const persisted = JSON.parse(await fs.readFile(path.join(tempHome, ".odf", `parallel-join-${change}.json`), "utf8"))
      expect(persisted.join).toMatchObject({ status: "running", expected: 2, completed: 0, failed: 0, running: 2 })
      expect(persisted.branches.map((branch: any) => branch.status)).toEqual(["running", "running"])
    })

    const resumed = JSON.parse(await createODFParallelDelegate(undefined, tempHome).execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      resume_from_join: true,
    }, { sessionID: "fresh-process-session", task: taskApi } as any) as string)
    expect(resumed).toMatchObject({
      status: "blocked",
      reason: "parallel-join-running",
      join: { status: "running", expected: 2, completed: 0, failed: 0, running: 2 },
    })
    expect(taskApi).toHaveBeenCalledTimes(2)

    resolveFirst({ status: "ok" })
    await vi.waitFor(async () => {
      const persisted = JSON.parse(await fs.readFile(path.join(tempHome, ".odf", `parallel-join-${change}.json`), "utf8"))
      expect(persisted.join).toMatchObject({ status: "running", expected: 2, completed: 1, failed: 0, running: 1 })
      expect(persisted.branches.filter((branch: any) => branch.status === "complete")).toHaveLength(1)
      expect(persisted.branches.filter((branch: any) => branch.status === "running")).toHaveLength(1)
    })
    resolveSecond({ status: "ok" })
    expect(JSON.parse(await run as string).join).toMatchObject({ status: "complete", running: 0 })
  })

  it("settles acquired attempts when running-join persistence fails before task()", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const change = "parallel-running-persist-failure"
    const branches = parallelBranches("running-persist-failure")
    await prepareWorkflowState(change, "IMPLEMENT", "cross-domain")
    await fs.mkdir(path.join(tempHome, ".odf", `parallel-join-${change}.json`), { recursive: true })
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })

    const result = JSON.parse(await createODFParallelDelegate(undefined, tempHome).execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "persist-failure-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({
      status: "blocked",
      reason: "parallel-join-persist-failed",
      join: { status: "blocked", completed: 0, failed: 2, running: 0 },
    })
    expect(taskApi).not.toHaveBeenCalled()
    const ledger = (await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(ledger.filter((record: any) => record.status === "running")).toHaveLength(2)
    expect(ledger.filter((record: any) => record.status === "failed")).toHaveLength(2)
  })

  it("blocks a completed branch without blocking a different branch ID", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const branches = parallelBranches("ledger-a")
    await prepareWorkflowState("parallel-branch-ledger", "IMPLEMENT", "cross-domain")
    await writeParallelEvidence("parallel-branch-ledger", branches.map(branch => branch.branch_id))
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)
    const first = await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-branch-ledger",
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any)
    expect(JSON.parse(first as string).status).toBe("parallel-delegated")

    const sameBranch = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-branch-ledger",
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches: [
        { branch_id: "backend-ledger-a", attempt_id: "backend-attempt-new", prompt: "retry backend", context_files: ["new-backend.py"] },
        { branch_id: "frontend-ledger-b", attempt_id: "frontend-attempt-b", prompt: "new frontend", context_files: ["new-frontend.js"] },
      ],
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)
    expect(sameBranch).toMatchObject({ status: "parallel-delegated", workflow_commit: { status: "already-committed" } })
    expect(taskApi).toHaveBeenCalledTimes(2)
  })

  it("returns one aggregate blocked result and receipt when a branch fails", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const branches = parallelBranches("failure")
    await prepareWorkflowState("parallel-failure", "IMPLEMENT", "cross-domain")
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
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason: "parallel-branch-failed", join: { status: "blocked", expected: 2, completed: 1, failed: 1 } })
    const receiptPath = path.join(tempHome, ".odf", "receipt-parallel-failure.json")
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"))
    expect(result.receipt).toEqual(receipt)
    expect(receipt.status).toBe("blocked")
    expect(receipt.parallel.branch_ids).toEqual(expect.arrayContaining(["backend-failure", "frontend-failure"]))
    expect(receipt.parallel.attempt_ledger_refs).toContain(".odf/attempt-ledger-parallel-failure.jsonl")
    expect(receipt.parallel.summaries["backend-failure"]).toContain("backend branch failed")
    const joinArtifact = JSON.parse(await fs.readFile(path.join(tempHome, ".odf", "parallel-join-parallel-failure.json"), "utf8"))
    expect(joinArtifact.join).toMatchObject({ status: "blocked", expected: 2, completed: 1, failed: 1 })
    expect(joinArtifact.receipt_ref).toBe(".odf/receipt-parallel-failure.json")
    expect(joinArtifact.branches).toHaveLength(2)
  })

  it("does not complete the join when branch validation is not verified", async () => {
    const { createODFParallelDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "implemented without evidence" })
    await prepareWorkflowState("parallel-no-validation", "IMPLEMENT", "cross-domain")
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-no-validation",
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches: parallelBranches("no-validation"),
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason: "parallel-validation-incomplete", join: { status: "blocked", expected: 2, completed: 2, failed: 0, validation_verified: false } })
    expect(result.branches.every((branch: any) => branch.status === "delegated")).toBe(true)
    const joinMetrics = getMetricsBuffer().filter(metric => metric.join_status)
    expect(joinMetrics.map(metric => metric.join_status)).toEqual(["running", "blocked"])
    expect(joinMetrics.at(-1)).toMatchObject({
      join_status: "blocked",
      join_expected: 2,
      join_completed: 2,
      join_failed: 0,
      join_running: 0,
      validation_ratio: 0,
    })
  })

  it("does not complete the join when the inner branch result fails", async () => {
    const { createODFParallelDelegate, clearMetricsBuffer, getMetricsBuffer } = await import("./odf-delegation.js")
    clearMetricsBuffer()
    const branches = parallelBranches("inner-failure")
    await prepareWorkflowState("parallel-inner-failure", "IMPLEMENT", "cross-domain")
    await writeParallelEvidence("parallel-inner-failure", branches.map(branch => branch.branch_id))
    const taskApi = vi.fn().mockResolvedValue({ status: "failed", message: "backend checks failed" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-inner-failure",
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({
      status: "blocked",
      reason: "parallel-branch-failed",
      join: { status: "blocked", completed: 0, failed: 2, validation_verified: false },
    })
    expect(result.branches.every((branch: any) => branch.status === "delegated" && !branch.successful)).toBe(true)
    expect(getMetricsBuffer().filter(metric => metric.branch_id).map(metric => metric.status)).toEqual(["error", "error"])
    const ledger = (await fs.readFile(path.join(tempHome, ".odf", "attempt-ledger-parallel-inner-failure.jsonl"), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(ledger.filter((record: any) => record.status === "failed")).toHaveLength(2)
    expect(JSON.parse(await fs.readFile(path.join(tempHome, ".odf", "receipt-parallel-inner-failure.json"), "utf8")).evidence.failing)
      .toEqual(expect.arrayContaining(["backend-inner-failure", "frontend-inner-failure"]))
  })

  it("reconstructs a blocked join without conversation and retries only the incomplete branch", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const change = "parallel-resume"
    const branches = parallelBranches("resume")
    await prepareWorkflowState(change, "IMPLEMENT", "cross-domain")
    await writeParallelEvidence(change, branches.map(branch => branch.branch_id))
    let failBackend = true
    const taskApi = vi.fn().mockImplementation(({ prompt }: { prompt: string }) => {
      if (failBackend && prompt.includes("backend")) return Promise.reject(new Error("backend branch failed"))
      return Promise.resolve({ status: "ok", executive_summary: "branch done" })
    })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)

    const first = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)
    const persisted = JSON.parse(await fs.readFile(path.join(tempHome, ".odf", `parallel-join-${change}.json`), "utf8"))
    failBackend = false
    await fs.writeFile(
      path.join(tempHome, ".odf", `receipt-${change}.json`),
      JSON.stringify({ status: "failed", action: { committed: "retry" } }),
      "utf8",
    )

    const resumed = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      resume_from_join: true,
    }, { sessionID: "new-session-with-no-history", task: taskApi } as any) as string)

    expect(first.join).toMatchObject({ status: "blocked", expected: 2, completed: 1, failed: 1 })
    expect(resumed).toMatchObject({ status: "parallel-delegated", resumed: true, join: { status: "complete", expected: 2, completed: 2, failed: 0 } })
    expect(taskApi).toHaveBeenCalledTimes(3)
    expect(resumed.branches.find((branch: any) => branch.branch_id === "frontend-resume").attempt_id)
      .toBe(persisted.branches.find((branch: any) => branch.branch_id === "frontend-resume").attempt_id)
    expect(resumed.branches.find((branch: any) => branch.branch_id === "backend-resume").attempt_id)
      .not.toBe(persisted.branches.find((branch: any) => branch.branch_id === "backend-resume").attempt_id)
  })

  it("does not relaunch completed branches when resuming a complete join", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const change = "parallel-resume-complete"
    const branches = parallelBranches("resume-complete")
    await prepareWorkflowState(change, "IMPLEMENT", "cross-domain")
    await writeParallelEvidence(change, branches.map(branch => branch.branch_id))
    const taskApi = vi.fn().mockResolvedValue({ status: "ok", executive_summary: "branch done" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)
    await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "parallel-session", task: taskApi } as any)
    taskApi.mockClear()

    const resumed = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      resume_from_join: true,
    }, { sessionID: "new-session", task: taskApi } as any) as string)

    expect(resumed.join).toMatchObject({ status: "complete", expected: 2, completed: 2, failed: 0 })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("requires two fresh branches while allowing one persisted retry branch", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)
    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-one-fresh",
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches: [{ branch_id: "only", attempt_id: "only-attempt", prompt: "only" }],
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason: "parallel-branch-count", join: { expected: 1 } })
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("fails closed when a persisted join is malformed or mismatched", async () => {
    const { createODFParallelDelegate } = await import("./odf-delegation.js")
    await fs.mkdir(path.join(tempHome, ".odf"), { recursive: true })
    await fs.writeFile(
      path.join(tempHome, ".odf", "parallel-join-parallel-join-invalid.json"),
      JSON.stringify({ change: "other-change", work_type: "cross-domain", phase: "IMPLEMENT" }),
      "utf8",
    )
    const taskApi = vi.fn().mockResolvedValue({ status: "ok" })
    const parallelTool = createODFParallelDelegate(undefined, tempHome)
    const result = JSON.parse(await parallelTool.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "parallel-join-invalid",
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      resume_from_join: true,
    }, { sessionID: "parallel-session", task: taskApi } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason: "parallel-join-invalid" })
    expect(taskApi).not.toHaveBeenCalled()
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
    await writeRegistryFlags(tempHome, { strict_workflow: false })
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

  it("mutation-after-build: evidence bound to a candidate is invalid after the candidate mutates", async () => {
    const repo = path.join(tmp, "repo-ev")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)
    const digestA = computeCandidateDigest(buildCandidateManifest(repo))
    await fs.mkdir(path.join(repo, ".odf"), { recursive: true })
    await fs.writeFile(path.join(repo, ".odf", "validation-evidence-ev-change.json"), JSON.stringify(validEvidence({ candidate_digest: digestA })))

    const bound = validateValidationEvidence({ workspaceDir: repo, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(bound.status).toBe("verified")

    appendLines(repo, "a.py", 1)
    const verdict = validateValidationEvidence({ workspaceDir: repo, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("candidate digest mismatch")
  })

  it("compatibility: legacy evidence without candidate_digest still verifies even with git present", async () => {
    const repo = path.join(tmp, "repo-legacy-ev")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)
    await fs.mkdir(path.join(repo, ".odf"), { recursive: true })
    await fs.writeFile(path.join(repo, ".odf", "validation-evidence-ev-change.json"), JSON.stringify(validEvidence()))
    const verdict = validateValidationEvidence({ workspaceDir: repo, change: "ev-change", tier: "MEDIUM", frozenDiffRef: null, now })
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

  const validVerifyEvidence = (overrides: Record<string, unknown> = {}) => ({
    change: "ev-change",
    phase: "VERIFY",
    batch: 1,
    risk_tier: "LOW",
    frozen_diff_ref: null,
    candidate_digest: null,
    executor: "odoo_qa_engineer",
    test_identity: "test_module test suite",
    resolved_at: "2026-07-31T11:30:00Z",
    commands: [
      { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "12 passed, 0 failed" },
    ],
    ...overrides,
  })

  it("verify-rejects-status-only-evidence: rejects VERIFY evidence with no commands", async () => {
    await writeEvidence({ change: "ev-change", phase: "VERIFY", status: "passed", resolved_at: "2026-07-31T11:30:00Z" })
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("requires at least one command")
  })

  it("verify-rejects-missing-required-fields: rejects a VERIFY command without database or output", async () => {
    await writeEvidence(validVerifyEvidence({ commands: [
      { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", exit_code: 0, output_tail: "12 passed, 0 failed" },
    ] }))
    const noDb = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(noDb.status).toBe("invalid")
    expect(noDb.reason).toContain("missing the database context")

    await writeEvidence(validVerifyEvidence({ commands: [
      { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 0, output_tail: "", output_evidence: "" },
    ] }))
    const noOutput = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(noOutput.status).toBe("invalid")
    expect(noOutput.reason).toContain("missing output evidence")
  })

  it("verify-rejects-nonzero-exit: any non-zero exit invalidates the VERIFY receipt", async () => {
    await writeEvidence(validVerifyEvidence({ commands: [
      { name: "odoo-tests", command: "odoo-bin -d odf_test_db -i test_module --test-enable --stop-after-init", database: "odf_test_db", exit_code: 1, output_tail: "2 failed, 0 passed" },
    ] }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("exited with 1")
  })

  it("verify-rejects-stale-evidence: VERIFY receipt outside the freshness window is invalid", async () => {
    await writeEvidence(validVerifyEvidence({ resolved_at: "2026-07-31T10:30:00Z" }))
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(verdict.status).toBe("invalid")
    expect(verdict.reason).toContain("stale")
  })

  it("verify-rejects-missing-executor-or-test-identity: the receipt must name who ran and which suite", async () => {
    await writeEvidence(validVerifyEvidence({ executor: undefined }))
    const noExecutor = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(noExecutor.status).toBe("invalid")
    expect(noExecutor.reason).toContain("missing executor")

    await writeEvidence(validVerifyEvidence({ test_identity: undefined }))
    const noIdentity = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(noIdentity.status).toBe("invalid")
    expect(noIdentity.reason).toContain("missing test_identity")
  })

  it("verify-accepts-complete-fresh-evidence: a complete, fresh VERIFY receipt verifies", async () => {
    await writeEvidence(validVerifyEvidence())
    const verdict = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(verdict.status).toBe("verified")
  })

  it("links optional expectation IDs while keeping legacy evidence valid", async () => {
    await writeEvidence(validVerifyEvidence({ expectations_ids: ["EXP-01", "EXP-02"] }))
    const linked = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(linked).toMatchObject({ status: "verified", expectations_ids: ["EXP-01", "EXP-02"] })

    await writeEvidence(validVerifyEvidence())
    const legacy = validateValidationEvidence({ workspaceDir: tmp, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(legacy).toMatchObject({ status: "verified" })
    expect(legacy).not.toHaveProperty("expectations_ids")
  })

  it("verify-digest-required: VERIFY receipt must carry the candidate_digest when git is present", async () => {
    const repo = path.join(tmp, "repo-verify-digest")
    initGitRepo(repo)
    commitFile(repo, "a.py", 10)
    appendLines(repo, "a.py", 100)
    await fs.mkdir(path.join(repo, ".odf"), { recursive: true })
    await fs.writeFile(path.join(repo, ".odf", "validation-evidence-ev-change.json"), JSON.stringify(validVerifyEvidence()))
    const noDigest = validateValidationEvidence({ workspaceDir: repo, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(noDigest.status).toBe("invalid")
    expect(noDigest.reason).toContain("candidate_digest required")

    const digest = computeCandidateDigest(buildCandidateManifest(repo))
    await fs.writeFile(path.join(repo, ".odf", "validation-evidence-ev-change.json"), JSON.stringify(validVerifyEvidence({ candidate_digest: digest })))
    const bound = validateValidationEvidence({ workspaceDir: repo, change: "ev-change", tier: "LOW", frozenDiffRef: null, now })
    expect(bound.status).toBe("verified")
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
    await writeRegistryFlags(tempHome, { strict_workflow: false })
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
     const taskApi = vi.fn().mockResolvedValue({ status: "ok", design_closed: true, executive_summary: "planned" })
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

  it("links approved expectation IDs without requiring them on legacy receipts", () => {
    const legacy = receipt({ change: "legacy-receipt" }) as any
    expect(mergeReceipt(tmp, legacy)).not.toHaveProperty("expectations_ids")

    const linked = receipt({ change: "linked-receipt", expectations_ids: ["EXP-01"] }) as any
    expect(mergeReceipt(tmp, linked).expectations_ids).toEqual(["EXP-01"])
    expect(JSON.parse(fsSync.readFileSync(path.join(tmp, ".odf", "receipt-linked-receipt.json"), "utf8")).expectations_ids)
      .toEqual(["EXP-01"])
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
    await writeRegistryFlags(tempHome, { strict_workflow: false })
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

describe("odf_health", () => {
  const originalHome = process.env.HOME
  const originalConfigDir = process.env.ODF_CONFIG_DIR
  let tempHome: string
  let configDir: string
  let pluginPath: string
  let commandPath: string

  const registry = {
    version: 1,
    last_updated: "2026-08-07T00:00:00Z",
    skills: [{ name: "health-skill", path: "skills/health/SKILL.md" }],
    agents: [{ name: "health-agent", path: "agent/health-agent.md" }],
    profiles: [{ phase: "ASSESS", model: "test", temperature: 0.2, description: "test" }],
  }

  const noEngramIo = () => ({
    readFile: (filePath: string) => fs.readFile(filePath, "utf8"),
    stat: (filePath: string) => fs.stat(filePath),
    access: (filePath: string) => fs.access(filePath),
    locateExecutable: () => {
      const error = Object.assign(new Error("engram not found"), { code: "ENOENT" })
      throw error
    },
    readVersion: () => "",
  })

  const runHealth = async (toolCtx: Record<string, unknown>, io = noEngramIo(), client?: unknown) => {
    const output = await createODFHealth(client as any, io).execute({}, toolCtx as any)
    return JSON.parse(output as string)
  }

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "odf-health-"))
    process.env.HOME = tempHome
    configDir = path.join(tempHome, ".config", "opencode")
    process.env.ODF_CONFIG_DIR = configDir
    pluginPath = path.join(configDir, "plugins", "odf-delegation.ts")
    commandPath = path.join(configDir, "command", "odf-health.md")
    await fs.mkdir(path.join(configDir, "skills", "health"), { recursive: true })
    await fs.mkdir(path.join(configDir, "agent"), { recursive: true })
    await fs.mkdir(path.dirname(pluginPath), { recursive: true })
    await fs.mkdir(path.dirname(commandPath), { recursive: true })
    await fs.writeFile(path.join(configDir, "odf-registry.json"), JSON.stringify(registry), "utf8")
    await fs.writeFile(path.join(configDir, "skills", "health", "SKILL.md"), "health", "utf8")
    await fs.writeFile(path.join(configDir, "agent", "health-agent.md"), "agent", "utf8")
    await fs.writeFile(pluginPath, "plugin", "utf8")
    await fs.writeFile(commandPath, "command", "utf8")
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    if (originalConfigDir === undefined) delete process.env.ODF_CONFIG_DIR
    else process.env.ODF_CONFIG_DIR = originalConfigDir
    await fs.rm(tempHome, { recursive: true, force: true })
  })

  it("returns a warning for a valid installation without probing task()", async () => {
    const taskApi = vi.fn()
    const result = await runHealth({ task: taskApi })

    expect(result).toMatchObject({
      schema_version: 1,
      status: "warning",
      config_dir: configDir,
      registry: {
        status: "valid",
        path: path.join(configDir, "odf-registry.json"),
        skills: { registered: 1, readable: 1, missing: [] },
        agents: { registered: 1, readable: 1, missing: [] },
        profiles: 1,
      },
      plugin: { file_status: "readable", loaded: true },
      command: { command: "/odf-health", path: commandPath, status: "readable" },
      task_api: { source: "toolCtx.task", function_present: true, usability: "unverified", probe: "not-run" },
      engram: { cli: "unavailable", export_probe: "not-run" },
    })
    expect(result.plugin.registered_tools).toContain("odf_health")
    expect(result.warnings).toEqual(expect.arrayContaining(["task-api-unverified: task usability was not probed because probing executes a task", "engram-cli-unavailable"]))
    expect(taskApi).not.toHaveBeenCalled()
    expect(Number.isNaN(Date.parse(result.checked_at))).toBe(false)
  })

  it("detects sdk.session without toolCtx.task", async () => {
    const client = {
      session: { create: vi.fn(), prompt: vi.fn(), abort: vi.fn() },
    }
    const result = await runHealth({ sessionID: "parent", directory: configDir }, noEngramIo(), client)

    expect(result.task_api).toMatchObject({
      source: "sdk.session",
      function_present: true,
      usability: "unverified",
      probe: "not-run",
    })
    expect(result.status).toBe("warning")
    expect(result.warnings).toContain("task-api-unverified: task usability was not probed because probing executes a task")
  })

  it("fails for a malformed registry", async () => {
    await fs.writeFile(path.join(configDir, "odf-registry.json"), "{not-json", "utf8")
    const taskApi = vi.fn()
    const result = await runHealth({ task: taskApi })

    expect(result.status).toBe("failed")
    expect(result.registry.status).toBe("malformed")
    expect(result.warnings).toContain("registry-malformed: odf-registry.json is not valid JSON")
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("fails when required installed files are missing", async () => {
    await fs.rm(path.join(configDir, "skills", "health", "SKILL.md"))
    await fs.rm(commandPath)
    const result = await runHealth({ task: vi.fn() })

    expect(result.status).toBe("failed")
    expect(result.registry.skills).toMatchObject({ registered: 1, readable: 0, missing: ["health-skill"] })
    expect(result.plugin.file_status).toBe("readable")
    expect(result.command.status).toBe("missing")
  })

  it("blocks permission errors without probing task()", async () => {
    const permissionError = Object.assign(new Error("permission denied"), { code: "EACCES" })
    const baseIo = noEngramIo()
    const permissionIo = {
      ...baseIo,
      access: (filePath: string) => filePath === pluginPath ? Promise.reject(permissionError) : fs.access(filePath),
    }
    const taskApi = vi.fn()
    const result = await runHealth({ task: taskApi }, permissionIo)

    expect(result.status).toBe("blocked")
    expect(result.plugin.file_status).toBe("permission-denied")
    expect(result.warnings).toContain(`plugin-file-permission-denied: ${pluginPath}`)
    expect(taskApi).not.toHaveBeenCalled()
  })

  it("blocks when the task API is absent", async () => {
    const result = await runHealth({})

    expect(result.status).toBe("blocked")
    expect(result.task_api).toEqual({ source: "unavailable", function_present: false, usability: "unavailable", probe: "not-run" })
    expect(result.warnings).toContain("task-api-unavailable")
  })

  it("blocks a bounded Engram metadata timeout without exporting observations", async () => {
    const baseIo = noEngramIo()
    const timeoutIo = {
      ...baseIo,
      locateExecutable: () => {
        const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })
        throw error
      },
    }
    const taskApi = vi.fn()
    const result = await runHealth({ task: taskApi }, timeoutIo)

    expect(result.status).toBe("blocked")
    expect(result.engram).toEqual({ cli: "unavailable", export_probe: "not-run" })
    expect(result.warnings).toContain("runtime-timeout: Engram CLI discovery timed out")
    expect(taskApi).not.toHaveBeenCalled()
  })
})

describe("stable discovery runtime guard", () => {
  const readTool = "engram_mem_context"

  function setup(workspaceDir = process.cwd()) {
    const abort = vi.fn().mockResolvedValue({ data: true })
    const authorizations = new Map()
    const generations = new Map()
    const hooks = createStableDiscoveryGuard({ session: { abort } } as any, authorizations, generations, workspaceDir)
    const activate = async (sessionID: string, messageID: string, agent = "odoo_orchestrator", text = "continue") => {
      await hooks["chat.message"]?.(
        { sessionID, messageID, agent },
        {
          message: { id: messageID, sessionID, agent } as any,
          parts: [{ type: "text", text } as any],
        },
      )
    }
    const activateCommand = async (sessionID: string, messageID: string, command: string, args: string, text: string) => {
      const parts = [{ type: "text", text } as any]
      await hooks["command.execute.before"]?.({ command, sessionID, arguments: args }, { parts })
      await hooks["chat.message"]?.(
        { sessionID, messageID, agent: "odoo_orchestrator" },
        { message: { id: messageID, sessionID, agent: "odoo_orchestrator" } as any, parts },
      )
    }
    const before = (sessionID: string, callID: string, args: unknown, tool = readTool) =>
      hooks["tool.execute.before"]?.({ tool, sessionID, callID }, { args })
    const after = async (sessionID: string, callID: string, args: unknown, result: string, tool = readTool) => {
      const output = { title: "result", output: result, metadata: {} }
      await hooks["tool.execute.after"]?.({ tool, sessionID, callID, args }, output)
      return output
    }
    return { abort, authorizations, generations, hooks, activate, activateCommand, before, after }
  }

  it("allows the initial read and stops after the first stable repetition", async () => {
    const { abort, activate, before, after } = setup()
    await activate("s1", "m1")
    await before("s1", "c1", { project: "odf-agent-team", scope: "project" })
    await after("s1", "c1", { project: "odf-agent-team", scope: "project" }, "stable")
    expect(abort).not.toHaveBeenCalled()

    await before("s1", "c2", { scope: "project", project: "odf-agent-team" })
    const stopped = await after("s1", "c2", { scope: "project", project: "odf-agent-team" }, "stable")
    expect(stopped.output).toContain("stable discovery call returned the same result twice")
    expect(abort).toHaveBeenCalledWith({ path: { id: "s1" } })
    await expect(before("s1", "c3", { project: "odf-agent-team", scope: "project" })).rejects.toThrow("runtime loop guard stopped")
  })

  it("blocks every gated /odf-new operation before health", async () => {
    for (const tool of ["odf_workflow_status", "question", "engram_mem_save", "odf_workflow_bind", "odf_delegate"]) {
      const { abort, activateCommand, before } = setup()
      await activateCommand("s1", `m-${tool}`, "odf-new", "health-gated", "expanded odf-new command")
      await expect(before("s1", `c-${tool}`, {}, tool)).rejects.toThrow("requires a successful odf_health call")
      expect(abort).toHaveBeenCalledWith({ path: { id: "s1" } })
    }
  })

  it("allows only conservatively classified read-only Engram operations before health", async () => {
    const allowed: Array<[string, Record<string, unknown>]> = [
      ["engram_mem_context", { project: "odf-agent-team" }],
      ["engram_mem_search", { query: "state" }],
      ["engram_mem_get_observation", { id: 1 }],
      ["engram_mem_current_project", {}],
      ["engram_mem_doctor", {}],
      ["engram_mem_review", { action: "list" }],
    ]
    for (const [tool, args] of allowed) {
      const { activateCommand, before } = setup()
      await activateCommand("s1", `m-${tool}`, "odf-new", "read-only", "expanded odf-new command")
      await expect(before("s1", `c-${tool}`, args, tool)).resolves.toBeUndefined()
    }
  })

  it("blocks mutating and unknown Engram operations before health", async () => {
    const blocked: Array<[string, Record<string, unknown>]> = [
      ["engram_mem_capture_passive", { content: "candidate" }],
      ["engram_mem_review", { action: "mark_reviewed", observation_id: 1 }],
      ["engram_mem_pin", { id: 1 }],
      ["engram_mem_unpin", { id: 1 }],
      ["engram_mem_future_unknown", {}],
    ]
    for (const [tool, args] of blocked) {
      const { abort, activateCommand, before } = setup()
      await activateCommand("s1", `m-${tool}`, "odf-new", "mutating", "expanded odf-new command")
      await expect(before("s1", `c-${tool}`, args, tool)).rejects.toThrow("requires a successful odf_health call")
      expect(abort).toHaveBeenCalledTimes(1)
    }
  })

  it("keeps /odf-new blocked after failed or malformed health", async () => {
    for (const result of [JSON.stringify({ status: "blocked" }), JSON.stringify({ status: "warning" }), "not-json"]) {
      const { abort, activateCommand, before, after } = setup()
      await activateCommand("s1", `m-${result}`, "odf-new", "failed-health", "expanded odf-new command")
      await before("s1", "health", {}, "odf_health")
      await after("s1", "health", {}, result, "odf_health")
      await expect(before("s1", "question", {}, "question")).rejects.toThrow("requires a successful odf_health call")
      expect(abort).toHaveBeenCalledTimes(1)
    }
  })

  it("allows /odf-new questions and binding only after warning health", async () => {
    const { abort, authorizations, activateCommand, before, after } = setup()
    await activateCommand("s1", "m-health", "odf-new", "healthy", "expanded odf-new command")
    await before("s1", "health", {}, "odf_health")
    await after("s1", "health", {}, successfulHealthOutput(), "odf_health")
    await expect(before("s1", "question", {}, "question")).resolves.toBeUndefined()
    await expect(before("s1", "bind", {}, "odf_workflow_bind")).resolves.toBeUndefined()
    expect(authorizations.get("s1")).toMatchObject({
      sessionID: "s1",
      messageID: "m-health",
      generation: 1,
      changeName: "healthy",
      workspaceRoot: fsSync.realpathSync(process.cwd()),
      claimed: false,
    })
    expect(authorizations.get("s1")?.nonce).toMatch(/^[0-9a-f-]{36}$/)
    expect(abort).not.toHaveBeenCalled()
  })

  it("keeps start authorization across intervening messages and idle; revokes only on delete or supersede", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-runtime-start-auth-"))
    const { authorizations, generations, hooks, activate, activateCommand, before, after } = setup(root)
    await activateCommand("s1", "m-start", "odf-new", "authorized-start", "expanded odf-new command")
    await before("s1", "health", {}, "odf_health")
    await after("s1", "health", {}, successfulHealthOutput(), "odf_health")
    expect(authorizations.has("s1")).toBe(true)

    // A follow-up user message must not revoke the still-unclaimed authorization.
    await activate("s1", "m-followup", "odoo_orchestrator", "different user intent")
    expect(authorizations.has("s1")).toBe(true)

    // Session idle must preserve it too, so a paused-then-resumed session can still bind.
    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    expect(authorizations.has("s1")).toBe(true)

    const bind = createODFWorkflowBind(authorizations, generations)
    try {
      const bound = JSON.parse(await bind.execute({
        change_name: "authorized-start",
        work_type: "feature",
        artifact_store: "openspec",
        workspace_dir: root,
        preflight: completePreflight("authorized-start"),
      }, { sessionID: "s1", messageID: "m-followup" } as any) as string)
      expect(bound).toMatchObject({ status: "bound" })

      // A fresh /odf-new supersedes and re-arms a new capability.
      await activateCommand("s1", "m-retry", "odf-new", "authorized-start", "expanded retry command")
      await before("s1", "retry-health", {}, "odf_health")
      await after("s1", "retry-health", {}, successfulHealthOutput(), "odf_health")
      expect(authorizations.has("s1")).toBe(true)

      // session.deleted still revokes.
      await hooks.event?.({ event: { type: "session.deleted", properties: { info: { id: "s1" } } } as any })
      expect(authorizations.has("s1")).toBe(false)
      expect(generations.has("s1")).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("does not let stale health completion reauthorize a superseded command", async () => {
    const { authorizations, activateCommand, before, after } = setup()
    await activateCommand("s1", "m-start", "odf-new", "stale-health", "expanded odf-new command")
    await before("s1", "health", {}, "odf_health")
    await activateCommand("s1", "m-continue", "odf-continue", "stale-health --work-type feature", "expanded continue command")
    await after("s1", "health", {}, successfulHealthOutput(), "odf_health")
    expect(authorizations.has("s1")).toBe(false)
  })

  it("claims one capability synchronously across concurrent and cross-workspace starts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-concurrent-start-"))
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "odf-cross-workspace-start-"))
    const runtime = setup(root)
    const authorize = async (messageID: string, change: string) => {
      await runtime.activateCommand("s1", messageID, "odf-new", change, `expanded ${change}`)
      await runtime.before("s1", `health-${messageID}`, {}, "odf_health")
      await runtime.after("s1", `health-${messageID}`, {}, successfulHealthOutput(), "odf_health")
    }

    try {
      await authorize("m-concurrent", "concurrent-start")
      const bind = createODFWorkflowBind(runtime.authorizations, runtime.generations)
      const args = {
        change_name: "concurrent-start",
        work_type: "feature" as const,
        workspace_dir: root,
        preflight: completePreflight("concurrent-start"),
      }
      const concurrent = await Promise.all([
        bind.execute(args, { sessionID: "s1", messageID: "m-concurrent" } as any),
        bind.execute(args, { sessionID: "s1", messageID: "m-concurrent" } as any),
      ])
      expect(concurrent.map(result => JSON.parse(result as string).status).sort()).toEqual(["blocked", "bound"])
      expect(concurrent.map(result => JSON.parse(result as string).state_action).filter(Boolean)).toEqual(["created"])

      await authorize("m-cross", "cross-start")
      const crossBind = createODFWorkflowBind(runtime.authorizations, runtime.generations)
      const [created, blocked] = await Promise.all([
        crossBind.execute({ ...args, change_name: "cross-start", preflight: completePreflight("cross-start") }, { sessionID: "s1", messageID: "m-cross" } as any),
        crossBind.execute({ ...args, change_name: "cross-start", workspace_dir: otherRoot, preflight: completePreflight("cross-start") }, { sessionID: "s1", messageID: "m-cross" } as any),
      ])
      expect(JSON.parse(created as string)).toMatchObject({ status: "bound", state_action: "created" })
      expect(JSON.parse(blocked as string)).toMatchObject({ status: "blocked", reason: "workflow-start-unauthorized" })
      expect(await fs.readdir(otherRoot)).toEqual([])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(otherRoot, { recursive: true, force: true })
    }
  })

  it("matches capability canonical change and workspace, tolerant of message and generation drift", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-capability-scope-"))
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "odf-capability-other-"))
    const cases = [
      { messageID: "drifted-message", change: "scoped-start", workspace: root, mutateGeneration: true },
      { messageID: "m-scope", change: "wrong-change", workspace: root, mutateGeneration: false },
      { messageID: "m-scope", change: "scoped-start", workspace: otherRoot, mutateGeneration: false },
    ]

    try {
      for (const [index, testCase] of cases.entries()) {
        const runtime = setup(root)
        await runtime.activateCommand("s1", "m-scope", "odf-new", "Scoped-Start", "expanded scoped start")
        await runtime.before("s1", `health-${index}`, {}, "odf_health")
        await runtime.after("s1", `health-${index}`, {}, successfulHealthOutput(), "odf_health")
        if (testCase.mutateGeneration) runtime.generations.set("s1", (runtime.generations.get("s1") || 0) + 1)
        const output = JSON.parse(await createODFWorkflowBind(runtime.authorizations, runtime.generations).execute({
          change_name: testCase.change,
          work_type: "feature",
          workspace_dir: testCase.workspace,
          preflight: completePreflight(testCase.change),
        }, { sessionID: "s1", messageID: testCase.messageID } as any) as string)
        expect(output).toMatchObject(index === 0
          ? { status: "bound", change_name: "scoped-start" }
          : { status: "blocked", reason: "workflow-start-unauthorized" })
      }

      const runtime = setup(root)
      await runtime.activateCommand("mixed", "m-mixed", "odf-new", "Mixed-CASE", "expanded mixed case")
      await runtime.before("mixed", "health-mixed", {}, "odf_health")
      await runtime.after("mixed", "health-mixed", {}, successfulHealthOutput(), "odf_health")
      const normalized = JSON.parse(await createODFWorkflowBind(runtime.authorizations, runtime.generations).execute({
        change_name: "Mixed-CASE",
        work_type: "feature",
        workspace_dir: root,
        preflight: completePreflight("Mixed-CASE"),
      }, { sessionID: "mixed", messageID: "m-mixed" } as any) as string)
      expect(normalized).toMatchObject({ status: "bound", change_name: "mixed-case", state_action: "created" })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(otherRoot, { recursive: true, force: true })
    }
  })

  it("bounds pending commands and capabilities and cleans session state", async () => {
    const pendingRuntime = setup()
    for (let index = 0; index <= 128; index++) {
      await pendingRuntime.hooks["command.execute.before"]?.(
        { command: "odf-new", sessionID: `pending-${index}`, arguments: `change-${index}` },
        { parts: [{ type: "text", text: `expanded-${index}` } as any] },
      )
    }
    await pendingRuntime.activate("pending-0", "m-evicted", "odoo_orchestrator", "expanded-0")
    await expect(pendingRuntime.before("pending-0", "read", {}, "odf_workflow_status")).resolves.toBeUndefined()

    const runtime = setup()
    for (let index = 0; index <= 128; index++) {
      const sessionID = `session-${index}`
      await runtime.activateCommand(sessionID, `m-${index}`, "odf-new", `change-${index}`, `expanded-${index}`)
      await runtime.before(sessionID, `health-${index}`, {}, "odf_health")
      await runtime.after(sessionID, `health-${index}`, {}, successfulHealthOutput(), "odf_health")
    }
    expect(runtime.authorizations.size).toBe(128)
    expect(runtime.generations.size).toBe(128)
    await runtime.hooks.event?.({ event: { type: "session.deleted", properties: { info: { id: "session-128" } } } as any })
    expect(runtime.authorizations.has("session-128")).toBe(false)
    expect(runtime.generations.has("session-128")).toBe(false)
  })

  it("does not activate health or start authorization from mentions, expanded mismatches, or /odf-continue", async () => {
    const conversational = setup()
    await conversational.activate("mentions", "m1", "odoo_orchestrator", "Please explain /odf-new demo")
    await expect(conversational.before("mentions", "c1", {}, "odf_workflow_status")).resolves.toBeUndefined()
    expect(conversational.authorizations.size).toBe(0)

    const continuation = setup()
    await continuation.activateCommand("continue", "m2", "odf-continue", "legacy --work-type feature", "expanded continue command")
    await expect(continuation.before("continue", "c2", {}, "odf_workflow_status")).resolves.toBeUndefined()
    expect(continuation.authorizations.size).toBe(0)

    const mismatched = setup()
    const commandParts = [{ type: "text", text: "expected expanded command" } as any]
    await mismatched.hooks["command.execute.before"]?.({ command: "odf-new", sessionID: "mismatch", arguments: "demo" }, { parts: commandParts })
    await mismatched.activate("mismatch", "m3", "odoo_orchestrator", "different expanded command")
    await expect(mismatched.before("mismatch", "c3", {}, "odf_workflow_status")).resolves.toBeUndefined()
    expect(mismatched.authorizations.size).toBe(0)

    const unsafe = setup()
    await unsafe.activateCommand("unsafe", "m4", "odf-new", "../Unsafe", "expanded unsafe command")
    await expect(unsafe.before("unsafe", "c4", {}, "odf_workflow_status")).resolves.toBeUndefined()
    expect(unsafe.authorizations.size).toBe(0)
  })

  it("keeps command contracts health-first while preserving explicit legacy recovery", async () => {
    const root = process.cwd()
    const command = await fs.readFile(path.join(root, "command", "odf-new.md"), "utf8")
    const orchestrator = await fs.readFile(path.join(root, "agent", "odoo_orchestrator.md"), "utf8")
    const continuation = await fs.readFile(path.join(root, "command", "odf-continue.md"), "utf8")
    expect(command).toMatch(/1\. \*\*Run `odf_health` first\*\*/)
    expect(command.indexOf("Run `odf_health` first")).toBeLessThan(command.indexOf("`question`"))
    expect(orchestrator).toContain("A missing tool, thrown/malformed result, `failed`, or `blocked` result stops the command immediately")
    expect(continuation).toContain("`expectations-only` bloquea")
    expect(continuation).toContain("`legacy-artifacts` conserva `resumable: true`")
    expect(continuation).toContain("exige `--work-type <type>`")
    expect(continuation).toContain("nunca crea workflows")
  })

  it("resets when arguments change", async () => {
    const { abort, activate, before, after } = setup()
    await activate("s1", "m1")
    await before("s1", "c1", { query: "one" })
    await after("s1", "c1", { query: "one" }, "stable")
    await before("s1", "c2", { query: "two" })
    await after("s1", "c2", { query: "two" }, "stable")
    expect(abort).not.toHaveBeenCalled()
  })

  it("resets when the result changes and catches the next stable repetition", async () => {
    const { abort, activate, before, after } = setup()
    const args = { task: "poll" }
    await activate("s1", "m1")
    await before("s1", "c1", args)
    await after("s1", "c1", args, "running")
    await before("s1", "c2", args)
    await after("s1", "c2", args, "complete")
    expect(abort).not.toHaveBeenCalled()
    await before("s1", "c3", args)
    await after("s1", "c3", args, "complete")
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it("resets for a new human intention", async () => {
    const { abort, activate, before, after } = setup()
    const args = { project: "odf-agent-team" }
    await activate("s1", "m1")
    await before("s1", "c1", args)
    await after("s1", "c1", args, "stable")
    await before("s1", "c2", args)
    await after("s1", "c2", args, "stable")
    expect(abort).toHaveBeenCalledTimes(1)

    await activate("s1", "m2")
    await before("s1", "c3", args)
    await after("s1", "c3", args, "stable")
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it("isolates sessions", async () => {
    const { abort, activate, before, after } = setup()
    const args = { project: "odf-agent-team" }
    await activate("s1", "m1")
    await activate("s2", "m2")
    await before("s1", "c1", args)
    await after("s1", "c1", args, "stable")
    await before("s1", "c2", args)
    await after("s1", "c2", args, "stable")
    await before("s2", "c3", args)
    await after("s2", "c3", args, "stable")
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it("blocks duplicate write-capable and unclassified calls before re-execution", async () => {
    const args = { change_name: "sale-fix", approval: "do-not-log-this" }
    for (const tool of ["odf_workflow_bind", "custom_tool"]) {
      const { abort, activate, before, after } = setup()
      let executions = 0
      const execute = async (callID: string) => {
        await before("s1", callID, args, tool)
        executions++
        await after("s1", callID, args, "saved", tool)
      }
      await activate("s1", "m1")
      await execute("c1")
      let error: Error | undefined
      try {
        await execute("c2")
      } catch (cause) {
        error = cause as Error
      }
      expect(error?.message).toContain("duplicate write-capable or unclassified tool call")
      expect(error?.message).not.toContain(args.approval)
      expect(executions).toBe(1)
      expect(abort).toHaveBeenCalledTimes(1)
    }
  })

  it("ignores other agents and clears state when a session becomes idle", async () => {
    const { abort, hooks, activate, before, after } = setup()
    const args = { project: "odf-agent-team" }
    await activate("other", "m1", "build")
    await before("other", "c1", args)
    await after("other", "c1", args, "stable")
    await before("other", "c2", args)
    await after("other", "c2", args, "stable")

    await activate("s1", "m2")
    await before("s1", "c3", args)
    await after("s1", "c3", args, "stable")
    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    await before("s1", "c4", args)
    await after("s1", "c4", args, "stable")
    expect(abort).not.toHaveBeenCalled()
  })

  it("composes the guard with the existing system prompt hook", async () => {
    const hooks = createODFRuntimeHooks({ session: { abort: vi.fn() } } as any)
    expect(hooks["chat.message"]).toBeTypeOf("function")
    expect(hooks["tool.execute.before"]).toBeTypeOf("function")
    expect(hooks["tool.execute.after"]).toBeTypeOf("function")
    const output = { system: ["base"] }
    await hooks["experimental.chat.system.transform"]?.({} as any, output)
    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain("base")
    expect(output.system[0]).toContain("<odf-system>")
  })
})
