import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import {
  DELEGATION_TOKEN_PATTERN,
  DELEGATION_TOKEN_TTL_MS,
  createDelegationTokenRecord,
  delegationPromptDigest,
  delegationTokenPath,
  deleteDelegationToken,
  isDelegationTokenExpired,
  markDelegationTokenSealed,
  readDelegationToken,
  readDelegationTokenDiagnostics,
  writeDelegationToken,
} from "./odf-delegation-tokens.js"

let workspace: string

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "odf-token-"))
})

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true })
})

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    change: "demo-change",
    phase: "IMPLEMENT" as const,
    agent: "odoo_batch_implementer",
    workspace,
    prompt: "# ODF IMPLEMENT — demo-change\nbody",
    task: "Implement the demo change",
    source_root: "/odoo/src",
    source_repos: "/odoo/custom/src",
    artifact_store: "openspec" as const,
    context_files: ["models/x.py"],
    attempt_id: "impl-r1",
    ...overrides,
  } as Parameters<typeof createDelegationTokenRecord>[0]
}

describe("delegation tokens", () => {
  it("mints an opaque bounded token with digest and TTL", () => {
    const now = new Date("2026-09-28T12:00:00.000Z")
    const record = createDelegationTokenRecord(validInput({ now }))

    expect(record).not.toBeNull()
    expect(record!.token).toMatch(DELEGATION_TOKEN_PATTERN)
    expect(record!.prompt_digest).toBe(delegationPromptDigest("# ODF IMPLEMENT — demo-change\nbody"))
    expect(record!.status).toBe("prepared")
    expect(record!.created_at).toBe(now.toISOString())
    expect(Date.parse(record!.expires_at) - Date.parse(record!.created_at)).toBe(DELEGATION_TOKEN_TTL_MS)
    expect(record!.workspace).toBe(workspace)
    expect(record!.task).toBe("Implement the demo change")
    expect(record!.source_root).toBe("/odoo/src")
    expect(record!.source_repos).toBe("/odoo/custom/src")
  })

  it("preserves multiline phase task text in a validated token", async () => {
    const task = "Implement the demo change\n\nAcceptance criteria:\n- Preserve existing behavior.\n- Add focused tests."
    const record = createDelegationTokenRecord(validInput({ task }))

    expect(record?.task).toBe(task)
    expect(writeDelegationToken(workspace, record!)).toBeNull()
    expect(readDelegationToken(workspace, record!.change, record!.token).record?.task).toBe(task)
  })

  it("rejects unsafe or malformed token input", () => {
    expect(createDelegationTokenRecord(validInput({ change: "../escape" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ agent: "bad agent" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ phase: "NOT-A-PHASE" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ attempt_id: "bad id" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ workspace: path.join(workspace, "missing") }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ task: "" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ task: "x".repeat(9000) }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ task: "unsafe\u0000task" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ source_root: "/bad\nroot" }))).toBeNull()
  })

  it("round-trips a token through the workspace .odf directory", async () => {
    const record = createDelegationTokenRecord(validInput())!
    expect(writeDelegationToken(workspace, record)).toBeNull()

    const filePath = path.join(workspace, ".odf", `delegation-${record.change}-${record.token}.json`)
    await expect(fs.stat(filePath)).resolves.toBeTruthy()

    const read = readDelegationToken(workspace, record.change, record.token)
    expect(read.error).toBeNull()
    expect(read.record).toMatchObject({ token: record.token, change: record.change, phase: "IMPLEMENT" })
  })

  it("fails closed for unknown, mismatched and malformed tokens", async () => {
    const record = createDelegationTokenRecord(validInput())!
    expect(writeDelegationToken(workspace, record)).toBeNull()

    expect(readDelegationToken(workspace, "other-change", record.token)).toMatchObject({ error: "delegation-token-unknown" })
    expect(readDelegationToken(workspace, record.change, "odf-tok-not-hex")).toMatchObject({ error: "delegation-token-invalid" })
    expect(readDelegationToken(workspace, record.change, `odf-tok-${"0".repeat(32)}`)).toMatchObject({ error: "delegation-token-unknown" })

    const filePath = delegationTokenPath(workspace, record.change, record.token)!
    await fs.writeFile(filePath, '{"schema_version":1,"token":"odf-tok-bad"}', "utf8")
    expect(readDelegationToken(workspace, record.change, record.token)).toMatchObject({ error: "delegation-token-malformed" })
  })

  it("detects expiry", () => {
    const record = createDelegationTokenRecord(validInput({ now: new Date("2026-09-28T12:00:00.000Z"), ttl_ms: 60_000 }))!
    expect(isDelegationTokenExpired(record, new Date("2026-09-28T12:00:30.000Z"))).toBe(false)
    expect(isDelegationTokenExpired(record, new Date("2026-09-28T12:02:00.000Z"))).toBe(true)
  })

  it("seals once and refuses a replay", () => {
    const record = createDelegationTokenRecord(validInput())!
    expect(writeDelegationToken(workspace, record)).toBeNull()

    expect(markDelegationTokenSealed(workspace, record, new Date("2026-09-28T12:05:00.000Z"))).toBeNull()
    const sealed = readDelegationToken(workspace, record.change, record.token)
    expect(sealed.record).toMatchObject({ status: "sealed", sealed_at: "2026-09-28T12:05:00.000Z" })

    expect(markDelegationTokenSealed(workspace, sealed.record!)).toBe("delegation-token-already-sealed")
  })

  it("returns bounded token diagnostics without exposing tokens, prompts, seal output, or paths", async () => {
    const record = createDelegationTokenRecord(validInput({
      now: new Date("2026-09-28T12:00:00.000Z"),
      parent_session_id: "parent-session",
    }))!
    const sealed = {
      ...record,
      launch_mode: "programmatic" as const,
      launch: {
        parent_session_id: "parent-session",
        child_session_id: "child-session",
        state: "submitted" as const,
        dispatch_started_at: "2026-09-28T12:01:00.000Z",
        dispatch_finished_at: "2026-09-28T12:01:01.000Z",
        dispatched_prompt_digest_prefix: record.prompt_digest.slice(0, 12),
        dispatched_prompt_byte_length: record.prompt_byte_length,
      },
      status: "sealed" as const,
      seal_started_at: "2026-09-28T12:02:00.000Z",
      child_result_observed_at: "2026-09-28T12:03:00.000Z",
      prompt_verified_at: "2026-09-28T12:03:01.000Z",
      workflow_commit_observed_at: "2026-09-28T12:04:00.000Z",
      sealed_at: "2026-09-28T12:05:00.000Z",
      sealed_session_id: "child-session",
      sealed_result: JSON.stringify({
        status: "blocked",
        reason: "delegation-prompt-mismatch",
        message: "PRIVATE SEAL OUTPUT SECRET_TOKEN=secret-value",
        result: { task: "PRIVATE CHILD PROMPT" },
        prompt_check: {
          expected_utf8_bytes: 42,
          actual_utf8_bytes: 43,
          expected_sha256_prefix: "0123456789ab",
          actual_sha256_prefix: "abcdef012345",
          transcript_text_exact: false,
        },
        workflow_commit: {
          status: "blocked",
          reason: "workflow-state-locked",
          canonical_stage: "BUILD",
          state_ref: "/home/private/project/openspec/changes/demo-change/state.yaml",
        },
      }),
    }
    expect(writeDelegationToken(workspace, sealed)).toBeNull()

    const diagnostics = readDelegationTokenDiagnostics(workspace, record.change)
    expect(diagnostics).toMatchObject({ records_read: 1, warnings: [] })
    expect(diagnostics.records[0]).toMatchObject({
      phase: "IMPLEMENT",
      attempt_id: "impl-r1",
      prepared_prompt_digest_prefix: record.prompt_digest.slice(0, 12),
      parent_session_id: "parent-session",
      child_session_id: "child-session",
      launch: {
        state: "submitted",
        parent_session_id: "parent-session",
        child_session_id: "child-session",
        dispatch_started_at: "2026-09-28T12:01:00.000Z",
        dispatch_finished_at: "2026-09-28T12:01:01.000Z",
        dispatched_prompt_digest_prefix: record.prompt_digest.slice(0, 12),
        dispatched_prompt_byte_length: record.prompt_byte_length,
      },
      seal_started_at: "2026-09-28T12:02:00.000Z",
      child_result_observed_at: "2026-09-28T12:03:00.000Z",
      prompt_verified_at: "2026-09-28T12:03:01.000Z",
      workflow_commit_observed_at: "2026-09-28T12:04:00.000Z",
      seal_result: { status: "blocked", reason: "delegation-prompt-mismatch" },
      workflow_commit: { status: "blocked", reason: "workflow-state-locked", canonical_stage: "BUILD" },
      prompt_check: {
        expected_sha256_prefix: "0123456789ab",
        actual_sha256_prefix: "abcdef012345",
        expected_utf8_bytes: 42,
        actual_utf8_bytes: 43,
        transcript_text_exact: false,
      },
    })
    const serialized = JSON.stringify(diagnostics)
    expect(serialized).not.toContain(record.token)
    expect(serialized).not.toContain(record.task)
    expect(serialized).not.toContain("PRIVATE SEAL OUTPUT")
    expect(serialized).not.toContain("PRIVATE CHILD PROMPT")
    expect(serialized).not.toContain("secret-value")
    expect(serialized).not.toContain("/home/private/project")
  })

  it("omits unsafe session identifiers from diagnostics", () => {
    const record = createDelegationTokenRecord(validInput({ parent_session_id: "/home/private/parent-session" }))!
    const launched = {
      ...record,
      launch: {
        parent_session_id: "/home/private/parent-session",
        child_session_id: "/home/private/child-session",
        state: "submitted" as const,
      },
    }
    expect(writeDelegationToken(workspace, launched)).toBeNull()

    const diagnostics = readDelegationTokenDiagnostics(workspace, record.change)
    expect(diagnostics.records[0].launch).toEqual({ state: "submitted" })
    expect(JSON.stringify(diagnostics)).not.toContain("/home/private")
  })

  it("deletes consumed tokens and keeps paths inside the workspace", async () => {
    const record = createDelegationTokenRecord(validInput())!
    expect(writeDelegationToken(workspace, record)).toBeNull()
    deleteDelegationToken(workspace, record.change, record.token)
    expect(readDelegationToken(workspace, record.change, record.token)).toMatchObject({ error: "delegation-token-unknown" })

    expect(delegationTokenPath(workspace, "../escape", record.token)).toBeNull()
    expect(delegationTokenPath(workspace, record.change, "../escape")).toBeNull()
  })
})
