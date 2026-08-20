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
  await fs.writeFile(cli, "#!/bin/sh\nprintf '%s' \"$ODF_TEST_ENGRAM_EXPORT\" > \"$2\"\n", "utf8")
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

function expectationsContent(change: string): string {
  return JSON.stringify({
    change,
    intent: "Retain the approved behavior",
    expectations: [{ id: "EXP-01", statement: "The approved behavior remains observable.", testable: true, owned_by: "human" }],
    approved: true,
    approved_by: "user",
    approved_at: "2026-08-19T00:00:00.000Z",
    immutable_since: "2026-08-19T00:00:00.000Z",
  })
}

function parallelJoin(change: string, status: "complete" | "blocked" = "complete"): Record<string, unknown> {
  const branches = ["backend", "frontend"].map((branch, index) => ({
    branch_id: branch,
    attempt_id: `${branch}-attempt`,
    descriptor: { prompt: `Implement ${branch}`, context_files: [`${branch}.py`] },
    outcome: {
      status: "delegated",
      result_status: "ok",
      successful: status === "complete" || index === 0,
      validation: { status: status === "complete" || index === 0 ? "verified" : "missing", reason: "test", commands_validated: status === "complete" || index === 0 ? 2 : 0 },
      validation_verified: status === "complete" || index === 0,
      validation_evidence_ref: `.odf/validation-evidence-${change}-${branch}.json`,
      attempt_ledger_ref: `.odf/attempt-ledger-${change}.jsonl`,
      summary: `${branch} result`,
    },
  }))
  return {
    schema_version: 1,
    change,
    work_type: "cross-domain",
    phase: "IMPLEMENT",
    timestamp: "2026-08-06T12:00:00.000Z",
    join: {
      status,
      expected: 2,
      completed: status === "complete" ? 2 : 1,
      failed: status === "complete" ? 0 : 1,
      validation_verified: status === "complete",
    },
    branches,
    evidence_refs: branches.map(branch => branch.outcome.validation_evidence_ref),
    attempt_ledger_refs: [`.odf/attempt-ledger-${change}.jsonl`],
    receipt_ref: status === "complete" ? null : `.odf/receipt-${change}.json`,
  }
}

function runningParallelJoin(change: string): Record<string, unknown> {
  const artifact = parallelJoin(change, "blocked")
  const branches = (artifact.branches as Array<Record<string, any>>).map(branch => ({
    ...branch,
    status: "running",
    outcome: {
      ...branch.outcome,
      status: "running",
      result_status: "running",
      successful: false,
      validation: null,
      validation_verified: false,
      summary: `${branch.branch_id} is running`,
    },
  }))
  return {
    ...artifact,
    join: { status: "running", expected: 2, completed: 0, failed: 0, running: 2, validation_verified: false },
    branches,
    receipt_ref: null,
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
      state_present: false,
      state_kind: "legacy-artifacts",
      recovery_work_type_required: true,
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

  it("does not invent resumable state for empty or QA-only evidence", () => {
    for (const status of [
      deriveWorkflowStatus({ change: "empty" }),
      deriveWorkflowStatus({ change: "qa-only", artifacts: { "qa-plan": "test plan" } }),
    ]) {
      expect(status).toMatchObject({
        canonical_stage: "INIT",
        legacy_phase: null,
        pending_stage: null,
        state_present: false,
        state_kind: "none",
        recovery_work_type_required: false,
        resumable: false,
      })
    }
  })

  it("reports Expectations-only evidence without inventing workflow state or a route", () => {
    const status = deriveWorkflowStatus({
      change: "expectations-only",
      artifacts: [{ key: "odf/expectations-only/expectations", content: expectationsContent("expectations-only") }],
      source: { state: "none", artifacts: ["odf/expectations-only/expectations"] },
    })
    expect(status).toMatchObject({
      canonical_stage: "INIT",
      legacy_phase: null,
      completed_canonical_stages: [],
      pending_stage: null,
      state_present: false,
      state_kind: "expectations-only",
      recovery_work_type_required: false,
      resumable: false,
      work_type: null,
      source: { state: "none" },
    })
    expect(status.warnings).toContain("Workflow state is missing; Expectations alone are not resumable.")
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

  it("derives completion and pending stages from the declared route", () => {
    const standardPending = deriveWorkflowStatus({
      change: "standard-pending",
      state: { work_type: "standard-config" },
    })
    expect(standardPending).toMatchObject({
      canonical_stage: "DECIDE",
      completed_canonical_stages: [],
      pending_stage: "DECIDE",
      resumable: true,
      work_type: "standard-config",
    })

    const standardComplete = deriveWorkflowStatus({
      change: "standard-complete",
      state: { work_type: "standard-config" },
      artifacts: {
        decision: { status: "passed" },
        plan: { status: "passed" },
      },
    })
    expect(standardComplete).toMatchObject({
      canonical_stage: "DECIDE",
      completed_canonical_stages: ["DECIDE"],
      pending_stage: null,
      resumable: false,
    })

    const verifyPending = deriveWorkflowStatus({
      change: "verify-pending",
      state: { work_type: "verify-only" },
    })
    expect(verifyPending).toMatchObject({
      canonical_stage: "VERIFY",
      completed_canonical_stages: [],
      pending_stage: "VERIFY",
      work_type: "verify-only",
    })

    const verifyComplete = deriveWorkflowStatus({
      change: "verify-complete",
      state: { work_type: "verify-only" },
      artifacts: { verify: { status: "passed" } },
    })
    expect(verifyComplete).toMatchObject({
      canonical_stage: "VERIFY",
      completed_canonical_stages: ["VERIFY"],
      pending_stage: null,
      resumable: false,
    })
  })

  it("supports non-default EXPLORE and FIX routes without changing legacy defaults", () => {
    const explore = deriveWorkflowStatus({
      change: "explore-route",
      state: { work_type: "question" },
      artifacts: { explore: { status: "passed" } },
    })
    expect(explore).toMatchObject({
      canonical_stage: "EXPLORE",
      completed_canonical_stages: ["EXPLORE"],
      pending_stage: null,
      legacy_phase: "EXPLORE",
      work_type: "question",
    })
    expect(explore.artifact_refs.EXPLORE).toEqual(["explore"])

    const fix = deriveWorkflowStatus({
      change: "fix-route",
      state: { work_type: "bugfix" },
      artifacts: {
        fix: { status: "passed" },
        build: { status: "pending" },
      },
    })
    expect(fix).toMatchObject({
      canonical_stage: "BUILD",
      completed_canonical_stages: ["FIX"],
      pending_stage: "BUILD",
      work_type: "bugfix",
    })

    const legacyDefault = deriveWorkflowStatus({
      change: "legacy-default",
      state: { phase: "IMPLEMENT" },
    })
    expect(legacyDefault).toMatchObject({
      canonical_stage: "VERIFY",
      completed_canonical_stages: ["DECIDE", "PLAN", "BUILD"],
      pending_stage: "VERIFY",
      work_type: null,
    })
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
    expect(deriveReceiptState({ status: "ok", action: { committed: "unknown" } })).toMatchObject({ state: "pending", action: null })
    expect(deriveReceiptState({ status: "mystery" })).toMatchObject({ state: "pending", action: null })
    expect(deriveReceiptState({ status: "failed", action: {} })).toMatchObject({ state: "pending", action: null })

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
  it("finds Engram Expectations-only evidence but marks state missing and non-resumable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-expectations-only-"))
    const cleanup = await configureEngramExport([{
      topic_key: "odf/fecha-factura/expectations",
      content: expectationsContent("fecha-factura"),
      created_at: "2026-08-19T00:00:00.000Z",
    }])

    try {
      const result = JSON.parse(await createODFWorkflowStatus().execute({ change_name: "fecha-factura", workspace_dir: root }, {} as any) as string)
      expect(result).toMatchObject({
        status: "found",
        canonical_stage: "INIT",
        legacy_phase: null,
        pending_stage: null,
        state_present: false,
        state_kind: "expectations-only",
        recovery_work_type_required: false,
        resumable: false,
        work_type: null,
        source: { state: "none" },
        artifacts: { expectations: "done" },
      })
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("finds OpenSpec Expectations-only evidence without fabricating state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-openspec-expectations-only-"))
    const cleanup = await configureEngramExport([])
    const changeDir = path.join(root, "openspec", "changes", "expectations-only")
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "expectations.yaml"), expectationsContent("expectations-only"), "utf8")

    try {
      const result = JSON.parse(await createODFWorkflowStatus().execute({ change_name: "expectations-only", workspace_dir: root }, {} as any) as string)
      expect(result).toMatchObject({
        status: "found",
        canonical_stage: "INIT",
        state_present: false,
        state_kind: "expectations-only",
        recovery_work_type_required: false,
        resumable: false,
        work_type: null,
        source: { state: "none" },
        artifacts: { expectations: "done" },
      })
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

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
      expect(result.state_kind).toBe("canonical")
      expect(result.recovery_work_type_required).toBe(false)
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
    await fs.writeFile(cli, "#!/bin/sh\nprintf '%s' \"$ODF_TEST_ENGRAM_EXPORT\" > \"$2\"\n", "utf8")
    await fs.chmod(cli, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath || ""}`
    process.env.ODF_TEST_ENGRAM_EXPORT = JSON.stringify(observations)

    try {
      const output = await createODFWorkflowStatus().execute({ change_name: "tool-change", workspace_dir: root }, {} as any)
      const result = JSON.parse(output as string)
      expect(result.canonical_stage).toBe("BUILD")
      expect(result.pending_stage).toBe("BUILD")
      expect(result.state_kind).toBe("legacy-artifacts")
      expect(result.recovery_work_type_required).toBe(true)
      expect(result.resumable).toBe(true)
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

  it("exposes a valid branch-aware join as supplemental runtime evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-parallel-status-"))
    const cleanup = await configureEngramExport([])
    await writeOpenSpec(root, "parallel-status", "canonical_stage: PLAN\ndecide_completed: true\nplan_completed: false\n", {
      "plan.yaml": "status: pending\n",
    })
    await fs.mkdir(path.join(root, ".odf"), { recursive: true })
    await fs.writeFile(path.join(root, ".odf", "parallel-join-parallel-status.json"), JSON.stringify(parallelJoin("parallel-status")), "utf8")

    try {
      const output = await createODFWorkflowStatus().execute({ change_name: "parallel-status", workspace_dir: root }, {} as any)
      const result = JSON.parse(output as string)
      expect(result.source.state).toBe("openspec")
      expect(result.pending_stage).toBe("PLAN")
      expect(result.parallel_join).toMatchObject({
        change: "parallel-status",
        work_type: "cross-domain",
        join: { status: "complete", expected: 2, completed: 2, failed: 0, running: 0 },
      })
      expect(result.parallel_join.branches.map((branch: any) => branch.status)).toEqual(["complete", "complete"])
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("exposes a persisted running join after a fresh status read", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-parallel-status-running-"))
    const cleanup = await configureEngramExport([])
    await writeOpenSpec(root, "parallel-status-running", "canonical_stage: PLAN\ndecide_completed: true\nplan_completed: false\n", {
      "plan.yaml": "status: pending\n",
    })
    const joinPath = path.join(root, ".odf", "parallel-join-parallel-status-running.json")
    await fs.mkdir(path.dirname(joinPath), { recursive: true })
    await fs.writeFile(joinPath, JSON.stringify(runningParallelJoin("parallel-status-running")), "utf8")

    try {
      const first = JSON.parse(await createODFWorkflowStatus().execute({ change_name: "parallel-status-running", workspace_dir: root }, {} as any) as string)
      const fresh = JSON.parse(await createODFWorkflowStatus().execute({ change_name: "parallel-status-running", workspace_dir: root }, {} as any) as string)
      for (const result of [first, fresh]) {
        expect(result.parallel_join).toMatchObject({
          join: { status: "running", expected: 2, completed: 0, failed: 0, running: 2 },
          evidence_refs: expect.arrayContaining([expect.stringContaining("parallel-status-running")]),
        })
        expect(result.parallel_join.branches.map((branch: any) => branch.status)).toEqual(["running", "running"])
        expect(result.parallel_join.branches.every((branch: any) => branch.outcome.status === "running")).toBe(true)
      }
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("derives running metadata for legacy blocked schema-v1 joins", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-parallel-status-blocked-"))
    const cleanup = await configureEngramExport([])
    await writeOpenSpec(root, "parallel-status-blocked", "canonical_stage: PLAN\ndecide_completed: true\nplan_completed: false\n", {
      "plan.yaml": "status: pending\n",
    })
    const joinPath = path.join(root, ".odf", "parallel-join-parallel-status-blocked.json")
    await fs.mkdir(path.dirname(joinPath), { recursive: true })
    await fs.writeFile(joinPath, JSON.stringify(parallelJoin("parallel-status-blocked", "blocked")), "utf8")

    try {
      const result = JSON.parse(await createODFWorkflowStatus().execute({ change_name: "parallel-status-blocked", workspace_dir: root }, {} as any) as string)
      expect(result.parallel_join).toMatchObject({ join: { status: "blocked", completed: 1, failed: 1, running: 0 } })
      expect(result.parallel_join.branches.map((branch: any) => branch.status)).toEqual(["complete", "failed"])
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("warns and hides malformed, mismatched, and oversized join artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-parallel-status-invalid-"))
    const cleanup = await configureEngramExport([])
    await writeOpenSpec(root, "parallel-invalid", "canonical_stage: PLAN\ndecide_completed: true\nplan_completed: false\n", {
      "plan.yaml": "status: pending\n",
    })
    const joinPath = path.join(root, ".odf", "parallel-join-parallel-invalid.json")
    await fs.mkdir(path.dirname(joinPath), { recursive: true })

    try {
      await fs.writeFile(joinPath, "{", "utf8")
      const malformed = JSON.parse(await createODFWorkflowStatus().execute({ change_name: "parallel-invalid", workspace_dir: root }, {} as any) as string)
      expect(malformed.parallel_join).toBeUndefined()
      expect(malformed.warnings.some((warning: string) => warning.includes("Malformed parallel join"))).toBe(true)

      await fs.writeFile(joinPath, JSON.stringify({ ...parallelJoin("other-change"), change: "other-change" }), "utf8")
      const mismatched = JSON.parse(await createODFWorkflowStatus().execute({ change_name: "parallel-invalid", workspace_dir: root }, {} as any) as string)
      expect(mismatched.parallel_join).toBeUndefined()
      expect(mismatched.warnings.some((warning: string) => warning.includes("change does not match"))).toBe(true)

      await fs.writeFile(joinPath, "x".repeat(256 * 1024 + 1), "utf8")
      const oversized = JSON.parse(await createODFWorkflowStatus().execute({ change_name: "parallel-invalid", workspace_dir: root }, {} as any) as string)
      expect(oversized.parallel_join).toBeUndefined()
      expect(oversized.warnings.some((warning: string) => warning.includes("oversized"))).toBe(true)
    } finally {
      await cleanup()
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
