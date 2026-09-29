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

  it("rejects unsafe or malformed token input", () => {
    expect(createDelegationTokenRecord(validInput({ change: "../escape" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ agent: "bad agent" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ phase: "NOT-A-PHASE" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ attempt_id: "bad id" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ workspace: path.join(workspace, "missing") }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ task: "" }))).toBeNull()
    expect(createDelegationTokenRecord(validInput({ task: "x".repeat(9000) }))).toBeNull()
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

  it("deletes consumed tokens and keeps paths inside the workspace", async () => {
    const record = createDelegationTokenRecord(validInput())!
    expect(writeDelegationToken(workspace, record)).toBeNull()
    deleteDelegationToken(workspace, record.change, record.token)
    expect(readDelegationToken(workspace, record.change, record.token)).toMatchObject({ error: "delegation-token-unknown" })

    expect(delegationTokenPath(workspace, "../escape", record.token)).toBeNull()
    expect(delegationTokenPath(workspace, record.change, "../escape")).toBeNull()
  })
})
