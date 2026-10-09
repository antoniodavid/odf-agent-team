import { describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  buildObservabilityTimeline,
  readTelemetry,
  type ObservabilityAttemptRecord,
} from "./odf-observability.js"
import type { DelegationTokenDiagnostic } from "./odf-delegation-tokens.js"
import { readParallelJoinArtifact, writeParallelJoinArtifact } from "./odf-parallel-join.js"
import { deriveWorkflowStatus } from "./odf-workflow-status.js"

function workflow(change: string, warnings: string[] = [], receipt?: Record<string, unknown>) {
  return deriveWorkflowStatus({
    change,
    state: "canonical_stage: BUILD\nwork_type: feature\n",
    receipt,
    warnings,
  })
}

function telemetryRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    timestamp: "2026-08-24T10:00:00.000Z",
    event: "run",
    lifecycle: "finished",
    schema_version: 1,
    change: "target-change",
    run_id: "run-default",
    phase: "IMPLEMENT",
    agent: "odoo_backend_engineer",
    status: "ok",
    task: "Do not expose this prompt",
    session_id: "raw-session-id",
    ...overrides,
  }
}

function attempt(overrides: Partial<ObservabilityAttemptRecord> = {}): ObservabilityAttemptRecord {
  return {
    attempt_id: "attempt-default",
    branch_id: "backend",
    change: "target-change",
    phase: "IMPLEMENT",
    next_stage: "BUILD",
    status: "completed",
    started_at: "2026-08-24T10:00:00.000Z",
    updated_at: "2026-08-24T10:01:00.000Z",
    settled_at: "2026-08-24T10:01:00.000Z",
    reason: "task-completed",
    result_status: "delegated",
    ...overrides,
  }
}

function joinArtifact(change: string): Parameters<typeof writeParallelJoinArtifact>[1] {
  const branches = ["backend", "frontend"].map(branch => ({
    status: "complete" as const,
    branch_id: branch,
    attempt_id: `${branch}-attempt`,
    descriptor: { prompt: `Implement ${branch}`, context_files: [`${branch}.ts`] },
    outcome: {
      status: "delegated",
      result_status: "ok",
      successful: true,
      validation: { status: "verified" as const, reason: "tests passed", commands_validated: 2 },
      validation_verified: true,
      validation_evidence_ref: `.odf/validation-evidence-${change}-${branch}.json`,
      attempt_ledger_ref: `.odf/attempt-ledger-${change}.jsonl`,
      summary: `${branch} complete`,
    },
  }))
  return {
    schema_version: 1,
    change,
    work_type: "cross-domain",
    phase: "IMPLEMENT",
    timestamp: "2026-08-24T10:03:00.000Z",
    join: { status: "complete", expected: 2, completed: 2, failed: 0, running: 0, validation_verified: true },
    branches,
    evidence_refs: branches.map(branch => branch.outcome.validation_evidence_ref),
    attempt_ledger_refs: [`.odf/attempt-ledger-${change}.jsonl`],
    receipt_ref: null,
  }
}

describe("O2 observability timeline", () => {
  it("returns explicit no_data for empty sources and partial for malformed or unreadable daily files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-observability-empty-"))
    const metrics = path.join(root, "metrics")
    try {
      const empty = buildObservabilityTimeline({
        change: "target-change",
        workflow: workflow("target-change"),
        telemetry: readTelemetry("target-change", metrics),
        attempts: [],
      })
      expect(empty.data_status).toBe("no_data")
      expect(empty.events).toEqual([])

      await fs.mkdir(metrics, { recursive: true })
      const day = new Date().toISOString().slice(0, 10)
      await fs.writeFile(path.join(metrics, `delegations-${day}.jsonl`), `${JSON.stringify(telemetryRow({ change: "other-change" }))}\n`, "utf8")
      const unmatched = buildObservabilityTimeline({
        change: "target-change",
        workflow: workflow("target-change"),
        telemetry: readTelemetry("target-change", metrics),
        attempts: [],
      })
      expect(unmatched.source_coverage.telemetry.status).toBe("no_data")
      expect(unmatched.data_status).toBe("no_data")

      await fs.writeFile(path.join(metrics, `delegations-${day}.jsonl`), "not-json\n", "utf8")
      const malformed = buildObservabilityTimeline({
        change: "target-change",
        workflow: workflow("target-change"),
        telemetry: readTelemetry("target-change", metrics),
        attempts: [],
      })
      expect(malformed.data_status).toBe("partial")
      expect(malformed.warnings).toContain("telemetry-malformed-record")

      await fs.rm(path.join(metrics, `delegations-${day}.jsonl`))
      await fs.mkdir(path.join(metrics, `delegations-${day}.jsonl`))
      const unreadable = readTelemetry("target-change", metrics)
      expect(unreadable.warnings).toContain("telemetry-file-limit")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("filters other changes and sorts lifecycle events deterministically", async () => {
    const metrics = await fs.mkdtemp(path.join(os.tmpdir(), "odf-observability-order-"))
    const day = new Date().toISOString().slice(0, 10)
    try {
      await fs.writeFile(path.join(metrics, `delegations-${day}.jsonl`), [
        JSON.stringify(telemetryRow({ run_id: "run-finished", timestamp: "2026-08-24T10:02:00.000Z" })),
        JSON.stringify(telemetryRow({ run_id: "other-run", change: "other-change", timestamp: "2026-08-24T09:00:00.000Z" })),
        JSON.stringify(telemetryRow({ run_id: "run-finished", lifecycle: "started", timestamp: "2026-08-24T10:01:00.000Z" })),
      ].join("\n") + "\n", "utf8")

      const timeline = buildObservabilityTimeline({
        change: "target-change",
        workflow: workflow("target-change"),
        telemetry: readTelemetry("target-change", metrics),
        attempts: [],
      })
      expect(timeline.events.map(event => [event.run_id, event.lifecycle])).toEqual([
        ["run-finished", "started"],
        ["run-finished", "finished"],
      ])
      expect(timeline.change).toBe("target-change")
      expect(JSON.stringify(timeline)).not.toContain("other-run")
      expect(timeline.data_status).toBe("complete")
    } finally {
      await fs.rm(metrics, { recursive: true, force: true })
    }
  })

  it("accepts valid span telemetry, preserves its identity, and keeps spans out of O2 events", async () => {
    const metrics = await fs.mkdtemp(path.join(os.tmpdir(), "odf-observability-spans-"))
    const day = new Date().toISOString().slice(0, 10)
    try {
      await fs.writeFile(path.join(metrics, `delegations-${day}.jsonl`), [
        JSON.stringify(telemetryRow({ event: "run", lifecycle: "started", trace_id: "trace-1", span_id: "span-root" })),
        JSON.stringify(telemetryRow({ event: "span", span_kind: "task", lifecycle: "started", run_id: undefined, trace_id: "trace-1", span_id: "span-task", parent_span_id: "span-root" })),
        JSON.stringify(telemetryRow({ event: "span", span_kind: "branch", lifecycle: "finished", trace_id: "trace-1", span_id: "span-invalid", parent_span_id: "bad parent", branch_id: "backend" })),
      ].join("\n") + "\n", "utf8")

      const read = readTelemetry("target-change", metrics)
      expect(read.records).toHaveLength(2)
      expect(read.records[1]).toMatchObject({
        event: "span",
        trace_id: "trace-1",
        span_id: "span-task",
        parent_span_id: "span-root",
        span_kind: "task",
      })
      const timeline = buildObservabilityTimeline({
        change: "target-change",
        workflow: workflow("target-change"),
        telemetry: read,
        attempts: [],
      })
      expect(timeline.events).toHaveLength(1)
      expect(timeline.events[0]).toMatchObject({ source: "telemetry", kind: "delegation", lifecycle: "started", run_id: "run-default" })
      expect(timeline.events.some(event => event.kind === "delegation" && event.run_id === "span-task")).toBe(false)
    } finally {
      await fs.rm(metrics, { recursive: true, force: true })
    }
  })

  it("reports unfinished runs and derives active attempts from the latest ledger state", () => {
    const timeline = buildObservabilityTimeline({
      change: "target-change",
      workflow: workflow("target-change"),
      telemetry: {
        records: [
          telemetryRow({ run_id: "run-finished", lifecycle: "started" }) as any,
          telemetryRow({ run_id: "run-finished", lifecycle: "finished" }) as any,
          telemetryRow({ run_id: "run-active", lifecycle: "started" }) as any,
        ],
        warnings: [],
        files_read: 1,
        records_read: 3,
      },
      attempts: [
        attempt({ attempt_id: "attempt-done", status: "running", updated_at: "2026-08-24T10:01:00.000Z" }),
        attempt({ attempt_id: "attempt-done", status: "completed", updated_at: "2026-08-24T10:02:00.000Z" }),
        attempt({ attempt_id: "attempt-live", status: "running", updated_at: "2026-08-24T10:03:00.000Z", settled_at: null }),
      ],
    })
    expect(timeline.active_run_ids).toEqual(["run-active"])
    expect(timeline.active_attempts.map(item => item.attempt_id)).toEqual(["attempt-live"])
    expect(timeline.warnings).toEqual(expect.arrayContaining(["telemetry-unfinished-runs", "active-attempts"]))
    expect(timeline.data_status).toBe("partial")
  })

  it("includes only validated parallel join summary evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-observability-join-"))
    const change = "target-change"
    try {
      const writeError = writeParallelJoinArtifact(root, joinArtifact(change))
      expect(writeError).toBeNull()
      const loaded = readParallelJoinArtifact(root, change)
      expect(loaded.warning).toBeNull()
      expect(loaded.artifact).not.toBeNull()

      const timeline = buildObservabilityTimeline({
        change,
        workflow: workflow(change),
        telemetry: { records: [], warnings: [], files_read: 0, records_read: 0 },
        attempts: [],
        parallel_join: loaded.artifact,
      })
      expect(timeline.parallel_join).toMatchObject({ status: "complete", expected: 2, completed: 2, validation_verified: true })
      expect(timeline.events).toEqual([expect.objectContaining({ source: "parallel-join", kind: "join", stage: "BUILD" })])
      expect(JSON.stringify(timeline)).not.toContain("Implement backend")
      expect(JSON.stringify(timeline)).not.toContain("validation-evidence-")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("marks receipt and workflow warnings partial without exposing refs", () => {
    const timeline = buildObservabilityTimeline({
      change: "target-change",
      workflow: workflow("target-change", ["Conflicting artifact content at /home/user/project/secret"], {
        status: "blocked",
        action: null,
      }),
      telemetry: { records: [], warnings: [], files_read: 0, records_read: 0 },
      attempts: [],
    })
    expect(timeline.data_status).toBe("partial")
    expect(timeline.events).toEqual([expect.objectContaining({ source: "receipt", status: "blocked" })])
    expect(timeline.warnings.join(" ")).not.toContain("/home/user/project")
    expect(timeline.warnings.join(" ")).toContain("[path]")
  })

  it("does not treat a receipt as runtime execution evidence", () => {
    const timeline = buildObservabilityTimeline({
      change: "target-change",
      workflow: workflow("target-change", [], { status: "ok", action: null }),
      telemetry: { records: [], warnings: [], files_read: 0, records_read: 0 },
      attempts: [],
    })
    expect(timeline.events).toEqual([expect.objectContaining({ source: "receipt", kind: "receipt" })])
    expect(timeline.source_coverage.telemetry.status).toBe("no_data")
    expect(timeline.source_coverage["attempt-ledger"].status).toBe("no_data")
    expect(timeline.source_coverage["parallel-join"].status).toBe("no_data")
    expect(timeline.data_status).toBe("partial")
    expect(timeline.warnings).toContain("runtime-evidence-missing")
  })

  it("builds an ordered causal sequence from sanitized token evidence and names missing timestamps", () => {
    const delegation: DelegationTokenDiagnostic = {
      change: "target-change",
      phase: "IMPLEMENT",
      agent: "odoo_backend_engineer",
      attempt_id: "attempt-causal",
      created_at: "2026-08-24T10:00:00.000Z",
      expires_at: "2026-08-24T12:00:00.000Z",
      status: "sealed",
      prepared_prompt_digest_prefix: "0123456789ab",
      prepared_prompt_byte_length: 128,
      parent_session_id: "parent-session",
      launch: {
        state: "submitted",
        parent_session_id: "parent-session",
        child_session_id: "child-session",
        dispatch_started_at: "2026-08-24T10:00:30.000Z",
        dispatch_finished_at: "2026-08-24T10:00:35.000Z",
        dispatched_prompt_digest_prefix: "0123456789ab",
        dispatched_prompt_byte_length: 128,
      },
      child_session_id: "child-session",
      seal_started_at: "2026-08-24T10:03:00.000Z",
      child_result_observed_at: "2026-08-24T10:04:00.000Z",
      prompt_verified_at: "2026-08-24T10:04:05.000Z",
      workflow_commit_observed_at: "2026-08-24T10:04:59.000Z",
      sealed_at: "2026-08-24T10:05:00.000Z",
      seal_result: { status: "delegated", reason: null },
      workflow_commit: { status: "committed", reason: null, canonical_stage: "VERIFY" },
      prompt_check: {
        expected_sha256_prefix: "0123456789ab",
        actual_sha256_prefix: "0123456789ab",
        expected_utf8_bytes: 128,
        actual_utf8_bytes: 128,
        transcript_text_exact: true,
      },
    }
    const laterPreparedOnly: DelegationTokenDiagnostic = {
      ...delegation,
      attempt_id: undefined,
      created_at: "2026-08-24T11:00:00.000Z",
      launch: undefined,
      child_session_id: undefined,
      seal_started_at: undefined,
      child_result_observed_at: undefined,
      prompt_verified_at: undefined,
      workflow_commit_observed_at: undefined,
      sealed_at: undefined,
      seal_result: undefined,
      workflow_commit: undefined,
      prompt_check: undefined,
    }
    const timeline = buildObservabilityTimeline({
      change: "target-change",
      workflow: workflow("target-change"),
      telemetry: { records: [], warnings: [], files_read: 0, records_read: 0 },
      attempts: [],
      delegation_tokens: { records: [delegation, laterPreparedOnly], warnings: [], records_read: 2 },
    })

    expect(timeline.causal_sequence.map(event => event.milestone)).toEqual([
      "prepared", "host-dispatch", "seal-start", "child-result", "workflow-commit", "seal-result", "prepared",
    ])
    expect(timeline.causal_sequence[0]).toMatchObject({
      timestamp: "2026-08-24T10:00:00.000Z",
      attempt_id: "attempt-causal",
      parent_session_id: "parent-session",
    })
    expect(timeline.causal_sequence[3]).toMatchObject({
      timestamp: "2026-08-24T10:04:00.000Z",
      change: "target-change",
      child_session_id: "child-session",
      artifact_refs: [],
      prompt_check: { expected_sha256_prefix: "0123456789ab", actual_sha256_prefix: "0123456789ab" },
      handoff_digest_check: {
        prepared_dispatched_match: true,
        prepared_received_match: true,
        difference_summary: "match",
      },
    })
    expect(timeline.causal_sequence[4]).toMatchObject({ stage: "VERIFY", status: "committed", timestamp: "2026-08-24T10:04:59.000Z" })
    expect(timeline.delegation_status[0]).toMatchObject({
      phase: "IMPLEMENT",
      child_session: { liveness: "unknown", result: "recorded-with-seal" },
      handoff_integrity: "verified",
      seal_status: "accepted",
      canonical_commit: { status: "committed", stage: "VERIFY" },
      blocker: null,
    })
    expect(timeline.causal_gaps).toEqual(["host-dispatch-not-recorded"])
    expect(timeline.data_status).toBe("partial")
    expect(timeline.source_coverage["delegation-tokens"]).toEqual({ status: "partial", records_read: 2 })
  })

  it("does not equate a build artifact with a sealed phase while its child remains active", () => {
    const baseWorkflow = workflow("target-change")
    const delegation: DelegationTokenDiagnostic = {
      change: "target-change",
      phase: "IMPLEMENT",
      agent: "odoo_backend_engineer",
      attempt_id: "attempt-running",
      created_at: "2026-08-24T10:00:00.000Z",
      expires_at: "2026-08-24T12:00:00.000Z",
      status: "prepared",
      prepared_prompt_digest_prefix: "0123456789ab",
      launch: { state: "submitted", parent_session_id: "parent-session", child_session_id: "child-session" },
      child_session_id: "child-session",
      child_session_status: { state: "busy", observed_at: "2026-08-24T10:04:00.000Z" },
    }
    const timeline = buildObservabilityTimeline({
      change: "target-change",
      workflow: {
        ...baseWorkflow,
        artifact_refs: {
          ...baseWorkflow.artifact_refs,
          BUILD: ["openspec/changes/target-change/build.md", "/home/private/build.md"],
        },
      },
      telemetry: { records: [], warnings: [], files_read: 0, records_read: 0 },
      attempts: [],
      delegation_tokens: { records: [delegation], warnings: [], records_read: 1 },
    })

    expect(timeline.delegation_status[0]).toMatchObject({
      stage: "BUILD",
      stage_artifacts: ["openspec/changes/target-change/build.md"],
      child_session: {
        id: "child-session",
        liveness: "busy",
        observed_at: "2026-08-24T10:04:00.000Z",
        result: "not-recorded",
      },
      seal_status: "not-recorded",
      canonical_commit: { status: "pending" },
      blocker: "child-session-running",
      next_safe_action: "wait-for-child",
    })
  })

  it("reports bounded prepared/dispatched/received prompt differences without prompt text", () => {
    const delegation: DelegationTokenDiagnostic = {
      change: "target-change",
      phase: "IMPLEMENT",
      agent: "odoo_backend_engineer",
      created_at: "2026-08-24T10:00:00.000Z",
      expires_at: "2026-08-24T12:00:00.000Z",
      status: "sealed",
      prepared_prompt_digest_prefix: "0123456789ab",
      prepared_prompt_byte_length: 128,
      launch: {
        state: "submitted",
        child_session_id: "child-session",
        dispatched_prompt_digest_prefix: "fedcba987654",
        dispatched_prompt_byte_length: 129,
      },
      child_session_id: "child-session",
      child_result_observed_at: "2026-08-24T10:03:00.000Z",
      seal_result: { status: "blocked", reason: "delegation-prompt-mismatch" },
      prompt_check: {
        expected_sha256_prefix: "0123456789ab",
        actual_sha256_prefix: "abcdef012345",
        expected_utf8_bytes: 128,
        actual_utf8_bytes: 130,
        transcript_text_exact: false,
      },
    }
    const timeline = buildObservabilityTimeline({
      change: "target-change",
      workflow: workflow("target-change"),
      telemetry: { records: [], warnings: [], files_read: 0, records_read: 0 },
      attempts: [],
      delegation_tokens: { records: [delegation], warnings: [], records_read: 1 },
    })
    const childResult = timeline.causal_sequence.find(event => event.milestone === "child-result")
    expect(childResult?.handoff_digest_check).toMatchObject({
      prepared_dispatched_match: false,
      prepared_received_match: false,
      difference_summary: "dispatch-and-receipt-mismatch",
    })
    expect(JSON.stringify(timeline)).not.toContain("PRIVATE PROMPT")
  })

  it("keeps the bounded output private and capped", async () => {
    const metrics = await fs.mkdtemp(path.join(os.tmpdir(), "odf-observability-private-"))
    const day = new Date().toISOString().slice(0, 10)
    try {
      const rows = Array.from({ length: 1_100 }, (_, index) => JSON.stringify(telemetryRow({
        run_id: `run-${index}`,
        lifecycle: "started",
        task: "PRIVATE PROMPT /home/user/project",
        error: "failed /home/user/project SECRET_TOKEN=secret-value",
      })))
      await fs.writeFile(path.join(metrics, `delegations-${day}.jsonl`), `${rows.join("\n")}\n`, "utf8")
      const timeline = buildObservabilityTimeline({
        change: "target-change",
        workflow: workflow("target-change"),
        telemetry: readTelemetry("target-change", metrics),
        attempts: [],
      })
      const serialized = JSON.stringify(timeline)
      expect(timeline.events.length).toBeLessThanOrEqual(1_000)
      expect(timeline.active_run_ids.length).toBeLessThanOrEqual(100)
      expect(serialized).not.toContain("PRIVATE PROMPT")
      expect(serialized).not.toContain("/home/user/project")
      expect(serialized).not.toContain("raw-session-id")
      expect(serialized).not.toContain("session_hash")
      expect(serialized).not.toContain("SECRET_TOKEN")
    } finally {
      await fs.rm(metrics, { recursive: true, force: true })
    }
  })
})
