import { describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  deriveReceiptState,
  deriveWorkflowStatus,
  normalizeArtifactKey,
  parseProgress,
} from "./odf-workflow-status.js"
import { createODFWorkflowStatus } from "./odf-delegation.js"

async function configureEngramExport(observations: Array<Record<string, unknown>>): Promise<() => Promise<void>> {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-tool-"))
  const cli = path.join(bin, "engram")
  const previousPath = process.env.PATH
  const previousExport = process.env.ODF_TEST_ENGRAM_EXPORT
  await fs.writeFile(cli, "#!/bin/sh\nprintf '%s' \"$ODF_TEST_ENGRAM_EXPORT\" > \"$5\"\n", "utf8")
  await fs.chmod(cli, 0o755)
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ""}`
  process.env.ODF_TEST_ENGRAM_EXPORT = JSON.stringify(observations)
  return async () => {
    process.env.PATH = previousPath
    if (previousExport === undefined) delete process.env.ODF_TEST_ENGRAM_EXPORT
    else process.env.ODF_TEST_ENGRAM_EXPORT = previousExport
    await fs.rm(bin, { recursive: true, force: true })
  }
}

async function writeOpenSpec(
  workspace: string,
  change: string,
  state: string,
  artifacts: Record<string, string>,
): Promise<void> {
  const directory = path.join(workspace, "openspec", "changes", change)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, "state.yaml"), state, "utf8")
  for (const [name, content] of Object.entries(artifacts)) {
    await fs.writeFile(path.join(directory, name), content, "utf8")
  }
}

describe("workflow status adapter", () => {
  it("normalizes aliases while retaining the original ref", () => {
    expect(normalizeArtifactKey("odf/change/apply-progress")).toEqual({
      original: "odf/change/apply-progress",
      group: "BUILD",
      type: "apply-progress",
    })
    expect(normalizeArtifactKey("odf/change/qa-review")).toEqual({
      original: "odf/change/qa-review",
      group: null,
      type: "qa-review",
    })
    expect(normalizeArtifactKey("openspec/changes/change/proposal.yaml")).toMatchObject({ group: "DECIDE", type: "propose" })
    expect(normalizeArtifactKey("openspec/changes/change/spec.yaml")).toMatchObject({ group: "DECIDE", type: "assess" })
    expect(normalizeArtifactKey("openspec/changes/change/verify-report-slice1.yaml")).toMatchObject({ group: "VERIFY", type: "verify-report" })
  })

  it("derives a partial and complete legacy-only workflow", () => {
    const partial = deriveWorkflowStatus({
      change: "partial",
      artifacts: { propose: "proposal" },
    })
    expect(partial).toMatchObject({
      canonical_stage: "DECIDE",
      legacy_phase: "PROPOSE",
      completed_canonical_stages: [],
      pending_stage: "DECIDE",
      resumable: true,
    })

    const complete = deriveWorkflowStatus({
      change: "complete",
      artifacts: {
        propose: "proposal",
        assess: "assessment",
        design: "design",
        tasks: "- [x] one\n- [x] two",
        "verify-report": "status: passed",
      },
    })
    expect(complete.completed_canonical_stages).toEqual(["DECIDE", "PLAN", "BUILD", "VERIFY"])
    expect(complete.canonical_stage).toBe("VERIFY")
    expect(complete.pending_stage).toBeNull()
    expect(complete.legacy_phase).toBe("VERIFY")
  })

  it("lets canonical artifacts win over legacy aliases", () => {
    const status = deriveWorkflowStatus({
      change: "canonical-first",
      artifacts: {
        propose: "proposal",
        assess: "assessment",
        design: "legacy design",
        plan: { content: "canonical plan", status: "pending" },
        "apply-progress": "- [x] legacy\n- [x] complete",
        "implement-progress": "- [x] first\n- [ ] second",
      },
    })
    expect(status.completed_canonical_stages).toEqual(["DECIDE"])
    expect(status.pending_stage).toBe("PLAN")
    expect(status.progress).toEqual({ completed: 1, total: 2, known: true, source: "implement-progress" })
    expect(status.artifact_refs.PLAN).toContain("plan")
    expect(status.artifact_refs.BUILD).toEqual(["apply-progress", "implement-progress"])
  })

  it("keeps QA-PLAN optional and outside canonical completion", () => {
    const status = deriveWorkflowStatus({
      change: "qa-plan",
      artifacts: { propose: "proposal", assess: "assessment", "qa-plan": "test plan" },
    })
    expect(status.completed_canonical_stages).toEqual(["DECIDE"])
    expect(status.canonical_stage).toBe("PLAN")
    expect(status.legacy_phase).toBe("QA-PLAN")
    expect(status.pending_stage).toBe("PLAN")
  })

  it("uses apply-progress and then tasks as legacy progress fallbacks", () => {
    const apply = deriveWorkflowStatus({
      change: "apply",
      artifacts: {
        propose: "proposal",
        assess: "assessment",
        design: "design",
        "apply-progress": "- [x] one\n- [ ] two",
      },
    })
    expect(apply.progress).toEqual({ completed: 1, total: 2, known: true, source: "apply-progress" })

    const tasks = deriveWorkflowStatus({
      change: "tasks",
      artifacts: {
        propose: "proposal",
        assess: "assessment",
        design: "design",
        tasks: "- [x] one",
      },
    })
    expect(tasks.progress.source).toBe("tasks")
    expect(tasks.completed_canonical_stages).toContain("BUILD")
  })

  it("prefers explicit state flags over artifacts", () => {
    const status = deriveWorkflowStatus({
      change: "explicit",
      state: {
        canonical_stage: "BUILD",
        decide_completed: true,
        plan_completed: true,
        build_completed: false,
      },
      artifacts: {
        verify: { content: "verified", status: "passed" },
      },
    })
    expect(status.canonical_stage).toBe("BUILD")
    expect(status.completed_canonical_stages).toEqual(["DECIDE", "PLAN"])
    expect(status.pending_stage).toBe("BUILD")
  })

  it("preserves snake_case state keys from manual YAML parsing", () => {
    const status = deriveWorkflowStatus({
      change: "yaml-state",
      state: [
        "canonical_stage: BUILD",
        "completed_canonical_stages:",
        "  - DECIDE",
        "  - PLAN",
        "verify_completed: false",
      ].join("\n"),
      artifacts: { verify: { content: "verified", status: "passed" } },
    })

    expect(status.canonical_stage).toBe("BUILD")
    expect(status.completed_canonical_stages).toEqual(["DECIDE", "PLAN"])
    expect(status.pending_stage).toBe("BUILD")
  })

  it("exposes valid route bindings and warns on invalid declarations", () => {
    expect(deriveWorkflowStatus({
      change: "json-route",
      state: JSON.stringify({ work_type: "feature" }),
    }).work_type).toBe("feature")
    expect(deriveWorkflowStatus({
      change: "yaml-route",
      state: "work_type: bugfix\n",
    }).work_type).toBe("bugfix")

    const invalid = deriveWorkflowStatus({ change: "invalid-route", state: "work_type: not-a-route\n" })
    expect(invalid.work_type).toBeNull()
    expect(invalid.warnings.some((warning) => warning.includes("Invalid declared work_type"))).toBe(true)
  })

  it("derives pending, resolved, and abandoned receipt states", () => {
    expect(deriveReceiptState()).toEqual({ state: "none", status: null, action: null, ref: null })
    expect(deriveReceiptState({ status: "blocked", ref: "verify" })).toEqual({
      state: "pending",
      status: "blocked",
      action: null,
      ref: "verify",
    })
    expect(deriveReceiptState({ status: "failed", action: { committed: "retry" } })).toMatchObject({ state: "resolved", action: "retry" })
    expect(deriveReceiptState({ status: "failed", action: { committed: "abandon" } })).toMatchObject({ state: "resolved", action: "abandon" })

    const pending = deriveWorkflowStatus({ change: "receipt", artifacts: { propose: "proposal" }, receipt: { status: "failed" } })
    expect(pending.resumable).toBe(false)
    const retry = deriveWorkflowStatus({ change: "retry", artifacts: { propose: "proposal" }, receipt: { status: "failed", action: "retry" } })
    expect(retry.resumable).toBe(true)
    const abandoned = deriveWorkflowStatus({ change: "abandoned", artifacts: { propose: "proposal" }, receipt: { status: "failed", action: "abandon" } })
    expect(abandoned.resumable).toBe(false)
  })

  it("archives only from explicit state or a successful archive report", () => {
    expect(deriveWorkflowStatus({ change: "directory", artifacts: { archive: "archive directory" } }).canonical_stage).not.toBe("ARCHIVED")
    expect(deriveWorkflowStatus({ change: "state", state: { archived: true } }).canonical_stage).toBe("ARCHIVED")
    expect(deriveWorkflowStatus({ change: "report", artifacts: { "archive-report": "status: archived" } }).canonical_stage).toBe("ARCHIVED")

    for (const state of [{ canonical_stage: "ARCHIVED" }, { phase: "archived" }, { status: "archived" }]) {
      expect(deriveWorkflowStatus({ change: "explicit-archive", state, receipt: { status: "blocked" } })).toMatchObject({
        canonical_stage: "ARCHIVED",
        legacy_phase: "ARCHIVED",
        completed_canonical_stages: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
        pending_stage: null,
        resumable: false,
      })
    }
  })

  it("handles missing checklists and invalid timestamps or sources safely", () => {
    expect(parseProgress()).toEqual({ completed: 0, total: 0, known: false, source: null })
    const status = deriveWorkflowStatus({
      change: "warnings",
      source: "filesystem",
      artifacts: {
        "implement-progress": { content: "No checklist here", created_at: "not-a-timestamp" },
      },
    })
    expect(status.progress).toEqual({ completed: 0, total: 0, known: false, source: "implement-progress" })
    expect(status.source.state).toBe("inferred")
    expect(status.warnings.some((warning) => warning.includes("Invalid artifact timestamp"))).toBe(true)
    expect(status.warnings.some((warning) => warning.includes("Invalid source state"))).toBe(true)
  })
})

describe("odf_workflow_status tool", () => {
  it("reads OpenSpec state and artifacts as the primary source", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-openspec-tool-"))
    const cleanup = await configureEngramExport([])
    await writeOpenSpec(root, "openspec-change", "canonical_stage: PLAN\ndecide_completed: true\nplan_completed: false\n", {
      "decision.yaml": "status: passed\n",
      "plan.yaml": "status: pending\n",
    })

    try {
      const output = await createODFWorkflowStatus().execute({ change_name: "openspec-change", workspace_dir: root }, {} as any)
      const result = JSON.parse(output as string)
      expect(result.source.state).toBe("openspec")
      expect(result.canonical_stage).toBe("PLAN")
      expect(result.pending_stage).toBe("PLAN")
      expect(result.artifact_refs.PLAN).toEqual([expect.stringContaining("openspec/changes/openspec-change/plan.yaml")])
      expect(result.source.artifacts).toEqual(expect.arrayContaining([
        expect.stringContaining("openspec/changes/openspec-change/state.yaml"),
      ]))
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("lets valid OpenSpec state win over conflicting Engram state and artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-openspec-conflict-"))
    const cleanup = await configureEngramExport([
      { topic_key: "odf/conflict/state", content: "canonical_stage: BUILD\nplan_completed: true\nbuild_completed: true\n", created_at: "2026-01-01T00:00:00Z" },
      { topic_key: "odf/conflict/plan", content: "status: passed\n", created_at: "2026-01-01T00:00:00Z" },
    ])
    await writeOpenSpec(root, "conflict", "canonical_stage: PLAN\ndecide_completed: true\nplan_completed: false\n", {
      "plan.yaml": "status: pending\n",
    })

    try {
      const output = await createODFWorkflowStatus().execute({ change_name: "conflict", workspace_dir: root }, {} as any)
      const result = JSON.parse(output as string)
      expect(result.source.state).toBe("openspec")
      expect(result.canonical_stage).toBe("PLAN")
      expect(result.pending_stage).toBe("PLAN")
      expect(result.warnings.some((warning: string) => warning.includes("Conflicting state content"))).toBe(true)
      expect(result.warnings.some((warning: string) => warning.includes("Conflicting artifact PLAN content"))).toBe(true)
      expect(result.source.artifacts).toEqual(expect.arrayContaining([
        expect.stringContaining("openspec/changes/conflict/plan.yaml"),
        expect.stringContaining("odf/conflict/plan"),
      ]))
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("prefers a canonical OpenSpec artifact over an Engram legacy alias", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-openspec-canonical-"))
    const cleanup = await configureEngramExport([
      { topic_key: "odf/canonical-first/propose", content: "status: failed\n", created_at: "2026-01-01T00:00:00Z" },
    ])
    await writeOpenSpec(root, "canonical-first", "canonical_stage: DECIDE\n", {
      "decision.yaml": "status: passed\n",
    })

    try {
      const output = await createODFWorkflowStatus().execute({ change_name: "canonical-first", workspace_dir: root }, {} as any)
      const result = JSON.parse(output as string)
      expect(result.completed_canonical_stages).toContain("DECIDE")
      expect(result.artifact_refs.DECIDE).toEqual([expect.stringContaining("openspec/changes/canonical-first/decision.yaml")])
      expect(result.warnings.some((warning: string) => warning.includes("Conflicting artifact DECIDE status"))).toBe(true)
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("blocks resumable status when the receipt has no committed action", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-openspec-receipt-"))
    const cleanup = await configureEngramExport([])
    await writeOpenSpec(root, "pending-receipt", "canonical_stage: BUILD\n", {
      "build.yaml": "status: pending\n",
    })
    await fs.mkdir(path.join(root, ".odf"), { recursive: true })
    await fs.writeFile(path.join(root, ".odf", "receipt-pending-receipt.json"), JSON.stringify({ status: "blocked", action: null }), "utf8")

    try {
      const output = await createODFWorkflowStatus().execute({ change_name: "pending-receipt", workspace_dir: root }, {} as any)
      const result = JSON.parse(output as string)
      expect(result.receipt.state).toBe("pending")
      expect(result.resumable).toBe(false)
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("does not substitute another change for an explicit name", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-explicit-change-"))
    const cleanup = await configureEngramExport([
      { topic_key: "odf/other-change/propose", content: "proposal", created_at: "2026-07-31T11:00:00Z" },
    ])

    try {
      const output = await createODFWorkflowStatus().execute({ change_name: "missing-change", workspace_dir: root }, {} as any)
      const result = JSON.parse(output as string)
      expect(result.status).toBe("not-found")
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("returns canonical fields and preserves legacy status fields", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-workflow-tool-"))
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-tool-"))
    const cli = path.join(bin, "engram")
    const previousPath = process.env.PATH
    const previousExport = process.env.ODF_TEST_ENGRAM_EXPORT
    const observations = [
      { topic_key: "odf/tool-change/propose", content: "proposal", created_at: "2026-07-31T11:00:00Z" },
      { topic_key: "odf/tool-change/assess", content: "assessment", created_at: "2026-07-31T11:01:00Z" },
      { topic_key: "odf/tool-change/design", content: "design", created_at: "2026-07-31T11:01:30Z" },
      { topic_key: "odf/tool-change/implement-progress", content: "- [x] one\n- [ ] two", created_at: "2026-07-31T11:02:00Z" },
    ]
    await fs.writeFile(cli, "#!/bin/sh\nprintf '%s' \"$ODF_TEST_ENGRAM_EXPORT\" > \"$5\"\n", "utf8")
    await fs.chmod(cli, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath || ""}`
    process.env.ODF_TEST_ENGRAM_EXPORT = JSON.stringify(observations)

    try {
      const output = await createODFWorkflowStatus().execute({ change_name: "tool-change", workspace_dir: root }, {} as any)
      const result = JSON.parse(output as string)
      expect(result.canonical_stage).toBe("BUILD")
      expect(result.pending_stage).toBe("BUILD")
      expect(result.phase).toBe("implement")
      expect(result.applyProgress).toEqual({ completed: 1, total: 2 })
      expect(result.artifacts["implement-progress"]).toBe("done")
      expect(result.source.state).toBe("engram")
      expect(result.warnings).toContain("OpenSpec state was not read; status is derived from Engram artifacts.")
      expect(result.status).toBe("found")
      expect(fsSync.existsSync(path.join(root, ".odf"))).toBe(false)
    } finally {
      process.env.PATH = previousPath
      if (previousExport === undefined) delete process.env.ODF_TEST_ENGRAM_EXPORT
      else process.env.ODF_TEST_ENGRAM_EXPORT = previousExport
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(bin, { recursive: true, force: true })
    }
  })
})
