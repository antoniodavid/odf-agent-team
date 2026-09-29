import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import YAML from "yaml"
import { ODF_V2_SESSION } from "./odf-delegation-health.js"
import {
  createDelegationTokenRecord,
  delegationPromptDigest,
  readDelegationToken,
  writeDelegationToken,
} from "./odf-delegation-tokens.js"

// The pack resolver is env-driven, and this repository ships a registry of its
// own, so tests that need their own pack must set ODF_CONFIG_DIR explicitly.
const ORIGINAL_CONFIG_DIR = process.env.ODF_CONFIG_DIR
function isolateConfigDir(tempHome: string): void {
  process.env.ODF_CONFIG_DIR = path.join(tempHome, ".config", "opencode")
}
function restoreConfigDir(): void {
  if (ORIGINAL_CONFIG_DIR === undefined) delete process.env.ODF_CONFIG_DIR
  else process.env.ODF_CONFIG_DIR = ORIGINAL_CONFIG_DIR
}

function fakeChildSession(opts: { agent: string; prompt: string; resultText: string }) {
  return {
    create: vi.fn(),
    get: vi.fn().mockResolvedValue({ id: "ses_child", agent: opts.agent }),
    prompt: vi.fn(),
    wait: vi.fn(),
    context: vi.fn().mockResolvedValue([
      { info: { type: "user" }, content: [{ type: "text", text: opts.prompt }] },
      { info: { type: "assistant" }, content: [{ type: "text", text: opts.resultText }] },
    ]),
    interrupt: vi.fn(),
  }
}

describe("native prepare/seal delegation", () => {
  const originalHome = process.env.HOME
  let tempHome: string

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "odf-native-"))
    process.env.HOME = tempHome
    isolateConfigDir(tempHome)
    const configDir = path.join(tempHome, ".config", "opencode")
    await fs.mkdir(configDir, { recursive: true })
    await fs.copyFile(path.resolve(process.cwd(), "odf-registry.json"), path.join(configDir, "odf-registry.json"))
    vi.resetModules()
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    restoreConfigDir()
    await fs.rm(tempHome, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const tools = async () => {
    const { createODFRegisteredTools } = await import("./odf-delegation.js")
    return createODFRegisteredTools(undefined, tempHome)
  }

  const prepareDesign = async (change = "native-design") => {
    const { odf_delegation_prepare } = await tools()
    return JSON.parse(await odf_delegation_prepare.execute({
      phase: "DESIGN",
      change,
      prompt: "Design the requested feature",
      context_files: [],
    }, { sessionID: "prepare-session" } as any) as string)
  }

  const writeDesignBoundaryFixture = async (change: string) => {
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), [
      "work_type: feature",
      "artifact_store: openspec",
      "phase: preflight",
      "canonical_stage: DECIDE",
      "completed_canonical_stages: []",
      "resumable: true",
      "",
    ].join("\n"), "utf8")
    await fs.writeFile(path.join(changeDir, "propose.yaml"), "status: passed\n", "utf8")
    await fs.writeFile(path.join(changeDir, "assess.yaml"), "status: passed\n", "utf8")
    await fs.writeFile(path.join(changeDir, "design.yaml"), "status: passed\n", "utf8")
    return changeDir
  }

  const writeImplementState = async (change: string) => {
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), YAML.stringify({
      work_type: "feature",
      canonical_stage: "BUILD",
      completed_canonical_stages: ["DECIDE", "PLAN"],
      resumable: true,
    }), "utf8")
    await fs.writeFile(path.join(changeDir, "implement-progress.md"), "- [x] implementation\n", "utf8")
  }

  const writeValidationEvidence = async (change: string) => {
    await fs.mkdir(path.join(tempHome, ".odf"), { recursive: true })
    await fs.writeFile(path.join(tempHome, ".odf", `validation-evidence-${change}.json`), JSON.stringify({
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

  const implementProof = () => ({
    work_type: "feature",
    completed_stages: ["DECIDE"],
    candidate_stage: "PLAN",
    phase_result_status: "ok",
    validation_status: "not-required",
    receipt_state: "none",
    resumable_state: true,
    archived_state: false,
  })

  it("prepares a composite delegation with a bounded token and no session launch", async () => {
    const output = await prepareDesign()

    expect(output).toMatchObject({ status: "prepared", change: "native-design", phase: "DESIGN" })
    expect(output.token).toMatch(/^odf-tok-[a-f0-9]{32}$/)
    expect(output.delegation.agent).toBe(output.agent)
    expect(output.delegation.description).toContain("ODF DESIGN →")
    expect(output.delegation.description).toContain("native-design")
    expect(output.delegation.prompt).toContain("<!-- ODF-DELEGATION ")
    expect(output.delegation.prompt).toContain("Design the requested feature")
    expect(output.delegation.prompt).toContain("## Skill Resolution Status")

    const read = readDelegationToken(tempHome, "native-design", output.token)
    expect(read.error).toBeNull()
    expect(read.record).toMatchObject({ status: "prepared", agent: output.agent, change: "native-design" })
    expect(read.record?.prompt_digest).toBe(delegationPromptDigest(output.delegation.prompt))
  })

  it("blocks a proof-backed prepare without store, proof or attempt", async () => {
    const { odf_delegation_prepare } = await tools()
    const base = {
      phase: "IMPLEMENT",
      change: "native-implement",
      prompt: "Implement the requested feature",
      context_files: [],
    }
    const noStore = JSON.parse(await odf_delegation_prepare.execute({ ...base }, { sessionID: "prepare-implement" } as any) as string)
    expect(noStore).toMatchObject({ status: "blocked", reason: "artifact-store-required" })

    const noProof = JSON.parse(await odf_delegation_prepare.execute({ ...base, artifact_store: "openspec" }, { sessionID: "prepare-implement" } as any) as string)
    expect(noProof).toMatchObject({ status: "blocked", reason: "proof-required" })

    const noAttempt = JSON.parse(await odf_delegation_prepare.execute({
      ...base, artifact_store: "openspec", workflow_advance: implementProof(),
    }, { sessionID: "prepare-implement" } as any) as string)
    expect(noAttempt).toMatchObject({ status: "blocked", reason: "attempt-id-required" })
  })

  it("prepares and seals a proof-backed IMPLEMENT delegation end to end", async () => {
    const { odf_delegation_prepare, odf_delegation_seal } = await tools()
    const change = "native-implement"
    await writeImplementState(change)

    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "IMPLEMENT",
      change,
      prompt: "Implement the planned change",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: "native-impl-1",
      workflow_advance: implementProof(),
    }, { sessionID: "prepare-session" } as any) as string)

    expect(prepared).toMatchObject({ status: "prepared", change, phase: "IMPLEMENT", attempt_id: "native-impl-1" })
    expect(prepared.policy_gate).toMatchObject({ gate: "allow" })

    await writeValidationEvidence(change)
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: prepared.delegation.prompt,
      resultText: "## ODF Result\n- **status**: ok\n- **executive_summary**: implemented",
    })

    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change,
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({
      status: "delegated",
      validation: { status: "verified" },
      workflow_commit: { status: "committed" },
      task_api_source: "subagent",
      task_session_id: "ses_child",
    })
    expect(YAML.parse(await fs.readFile(path.join(tempHome, "openspec", "changes", change, "state.yaml"), "utf8"))).toMatchObject({
      canonical_stage: "BUILD",
      completed_canonical_stages: ["DECIDE", "PLAN", "BUILD"],
    })
    const ledger = await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8")
    const records = ledger.trim().split("\n").map(line => JSON.parse(line))
    const latest = records.filter((record: { attempt_id: string }) => record.attempt_id === "native-impl-1").at(-1)
    expect(latest).toMatchObject({ status: "completed", next_stage: "BUILD" })
  })

  it("fails the proof-backed seal when IMPLEMENT validation evidence is missing", async () => {
    const { odf_delegation_prepare, odf_delegation_seal } = await tools()
    const change = "native-implement-missing-evidence"
    await writeImplementState(change)

    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "IMPLEMENT",
      change,
      prompt: "Implement the planned change",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: "native-impl-2",
      workflow_advance: implementProof(),
    }, { sessionID: "prepare-session" } as any) as string)

    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: prepared.delegation.prompt,
      resultText: "## ODF Result\n- **status**: ok\n- **executive_summary**: implemented without evidence",
    })
    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change,
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({ status: "blocked", validation: { status: "missing" }, workflow_commit: null })
    const ledger = await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8")
    const records = ledger.trim().split("\n").map(line => JSON.parse(line))
    const latest = records.filter((record: { attempt_id: string }) => record.attempt_id === "native-impl-2").at(-1)
    expect(latest).toMatchObject({ status: "failed" })
  })

  it("seals a DESIGN delegation, materializes PLAN and consumes the token", async () => {
    const changeDir = await writeDesignBoundaryFixture("native-design")
    const prepared = await prepareDesign()
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: prepared.delegation.prompt,
      resultText: "## ODF Result\n- **status**: ok\n- **design_closed**: true\n- **executive_summary**: closed",
    })
    const { odf_delegation_seal } = await tools()

    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change: "native-design",
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({
      status: "delegated",
      phase: "DESIGN",
      agent: prepared.agent,
      task_api_source: "subagent",
      task_session_id: "ses_child",
      workflow_materialization: { status: "committed", canonical_stage: "PLAN", completed_stages: ["DECIDE", "PLAN"] },
      result: { status: "ok", design_closed: true },
    })
    expect(YAML.parse(await fs.readFile(path.join(changeDir, "state.yaml"), "utf8"))).toMatchObject({
      canonical_stage: "PLAN",
      completed_canonical_stages: ["DECIDE", "PLAN"],
    })
    expect(readDelegationToken(tempHome, "native-design", prepared.token)).toMatchObject({ error: "delegation-token-unknown" })
  })

  it("fails closed when the child prompt was modified", async () => {
    const prepared = await prepareDesign()
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: `${prepared.delegation.prompt}\n(edited by the orchestrator)`,
      resultText: "## ODF Result\n- **status**: ok\n- **design_closed**: true",
    })
    const { odf_delegation_seal } = await tools()

    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change: "native-design",
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "delegation-prompt-mismatch" })
    // A binding failure does not consume the token: the delegation can be retried.
    expect(readDelegationToken(tempHome, "native-design", prepared.token).error).toBeNull()
  })

  it("fails closed when the child agent does not match the prepared agent", async () => {
    const prepared = await prepareDesign()
    const session = fakeChildSession({
      agent: "odoo_code_reviewer",
      prompt: prepared.delegation.prompt,
      resultText: "## ODF Result\n- **status**: ok\n- **design_closed**: true",
    })
    const { odf_delegation_seal } = await tools()

    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change: "native-design",
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "delegation-child-mismatch" })
  })

  it("fails closed without the V2 session API and for expired tokens", async () => {
    const prepared = await prepareDesign()
    const { odf_delegation_seal } = await tools()

    const noApi = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change: "native-design",
      session_id: "ses_child",
    }, { sessionID: "parent-session" } as any) as string)
    expect(noApi).toMatchObject({ status: "blocked", reason: "delegation-session-api-unavailable" })

    const expired = createDelegationTokenRecord({
      change: "native-design",
      phase: "DESIGN",
      agent: prepared.agent,
      workspace: tempHome,
      prompt: prepared.delegation.prompt,
      task: "Design the requested feature",
      now: new Date(Date.now() - 10_000),
      ttl_ms: 1_000,
    })!
    expect(writeDelegationToken(tempHome, expired)).toBeNull()
    const expiredOutput = JSON.parse(await odf_delegation_seal.execute({
      token: expired.token,
      change: "native-design",
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: fakeChildSession({ agent: prepared.agent, prompt: prepared.delegation.prompt, resultText: "## ODF Result\n- **status**: ok" }) } as any) as string)
    expect(expiredOutput).toMatchObject({ status: "blocked", reason: "delegation-token-expired" })
  })
})
