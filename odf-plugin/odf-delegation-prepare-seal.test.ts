import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import YAML from "yaml"
import { ODF_V2_SESSION } from "./odf-delegation-health.js"
import {
  createDelegationTokenRecord,
  delegationPromptByteLength,
  delegationPromptDigest,
  readDelegationToken,
  writeDelegationToken,
} from "./odf-delegation-tokens.js"

// The pack resolver is env-driven, and this repository ships a registry of its
// own, so tests that need their own pack must set ODF_CONFIG_DIR explicitly.
const ORIGINAL_CONFIG_DIR = process.env.ODF_CONFIG_DIR
const OPENCODE_SUBAGENT_USER_PREFIX = "You are a subagent spawned by another session.\n"
function isolateConfigDir(tempHome: string): void {
  process.env.ODF_CONFIG_DIR = path.join(tempHome, ".config", "opencode")
}
function restoreConfigDir(): void {
  if (ORIGINAL_CONFIG_DIR === undefined) delete process.env.ODF_CONFIG_DIR
  else process.env.ODF_CONFIG_DIR = ORIGINAL_CONFIG_DIR
}

function fakeChildSession(opts: {
  agent: string
  prompt: string
  resultText: string
  parentSessionId?: string
  childSessionId?: string
}) {
  const parentSessionId = opts.parentSessionId || "parent-session"
  const childSessionId = opts.childSessionId || "ses_child"
  return {
    create: vi.fn(),
    get: vi.fn().mockResolvedValue({ id: childSessionId, agent: opts.agent, parentID: parentSessionId }),
    prompt: vi.fn(),
    wait: vi.fn(),
    context: vi.fn().mockResolvedValue([
      // Match OpenCode V2 Session.Message.User / Assistant context records.
      { id: "msg_user", type: "user", text: `${OPENCODE_SUBAGENT_USER_PREFIX}${opts.prompt}` },
      { id: "msg_assistant", type: "assistant", content: [{ type: "text", text: opts.resultText }] },
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

  const tools = async (root: string = tempHome) => {
    const { createODFRegisteredTools } = await import("./odf-delegation.js")
    return createODFRegisteredTools(undefined, root)
  }

  const markTokenLegacy = async (root: string, change: string, token: string) => {
    const read = readDelegationToken(root, change, token)
    if (!read.record) throw new Error(`test setup could not read token: ${read.error}`)
    const legacy = { ...read.record } as Record<string, any>
    delete legacy.prompt_byte_length
    delete legacy.launch_mode
    delete legacy.parent_session_id
    delete legacy.launch
    if (Array.isArray(legacy.branches)) {
      legacy.branches = legacy.branches.map((branch: Record<string, any>) => {
        const legacyBranch = { ...branch }
        delete legacyBranch.prompt_byte_length
        delete legacyBranch.launch
        return legacyBranch
      })
    }
    const error = writeDelegationToken(root, legacy as any)
    if (error) throw new Error(`test setup could not write legacy token: ${error}`)
  }

  const legacyTools = async (root: string = tempHome) => {
    const registered = await tools(root)
    const downgrade = async (definition: any, args: Record<string, any>, context: any) => {
      const raw = await definition.execute(args, context) as string
      const output = JSON.parse(raw)
      if (output.status === "prepared" && typeof output.token === "string" && typeof args.change === "string") {
        await markTokenLegacy(root, args.change, output.token)
      }
      return raw
    }
    return {
      ...registered,
      odf_delegation_prepare: {
        ...registered.odf_delegation_prepare,
        execute: (args: Record<string, any>, context: any) => downgrade(registered.odf_delegation_prepare, args, context),
      },
      odf_parallel_prepare: {
        ...registered.odf_parallel_prepare,
        execute: (args: Record<string, any>, context: any) => downgrade(registered.odf_parallel_prepare, args, context),
      },
    }
  }

  const prepareDesignLegacy = async (change = "native-design") => {
    const prepared = await prepareDesign(change)
    await markTokenLegacy(tempHome, change, prepared.token)
    return prepared
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

  const writeDesignBoundaryFixture = async (root: string, change: string) => {
    const changeDir = path.join(root, "openspec", "changes", change)
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

  const writeProposalState = async (root: string, change: string) => {
    const changeDir = path.join(root, "openspec", "changes", change)
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
    return changeDir
  }

  const writeImplementState = async (root: string, change: string) => {
    const changeDir = path.join(root, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), YAML.stringify({
      work_type: "feature",
      canonical_stage: "BUILD",
      completed_canonical_stages: ["DECIDE", "PLAN"],
      resumable: true,
    }), "utf8")
    await fs.writeFile(path.join(changeDir, "implement-progress.md"), "- [x] implementation\n", "utf8")
  }

  const writeValidationEvidence = async (root: string, change: string) => {
    await fs.mkdir(path.join(root, ".odf"), { recursive: true })
    await fs.writeFile(path.join(root, ".odf", `validation-evidence-${change}.json`), JSON.stringify({
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
    expect(read.record?.prompt_byte_length).toBe(delegationPromptByteLength(output.delegation.prompt))
    expect(read.record?.launch_mode).toBe("programmatic")
  }, 10_000)

  it("submits the exact prepared prompt through the V2 session API", async () => {
    await writeDesignBoundaryFixture(tempHome, "native-design")
    const prepared = await prepareDesign()
    const session = {
      create: vi.fn().mockResolvedValue({ id: "ses_programmatic", agent: prepared.agent }),
      prompt: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({
        id: "ses_programmatic",
        agent: prepared.agent,
        parentID: "prepare-session",
        location: { directory: tempHome },
      }),
      wait: vi.fn().mockResolvedValue(undefined),
      context: vi.fn().mockResolvedValue([
        { type: "user", text: prepared.delegation.prompt },
        { type: "assistant", content: [{ type: "text", text: "## ODF Result\n- **status**: ok\n- **design_closed**: true" }] },
      ]),
      interrupt: vi.fn().mockResolvedValue(undefined),
    }
    const { odf_delegation_launch, odf_delegation_seal } = await tools()

    const unlaunched = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change: prepared.change,
      session_id: "ses_programmatic",
    }, { sessionID: "prepare-session", [ODF_V2_SESSION]: session } as any) as string)
    expect(unlaunched).toMatchObject({ status: "blocked", reason: "delegation-launch-not-submitted" })
    expect(session.get).not.toHaveBeenCalled()

    const output = JSON.parse(await odf_delegation_launch.execute({
      token: prepared.token,
      change: prepared.change,
      prompt: prepared.delegation.prompt,
    }, {
      sessionID: "prepare-session",
      abort: new AbortController().signal,
      [ODF_V2_SESSION]: session,
    } as any) as string)

    expect(output).toMatchObject({ status: "launched", task_api_source: "sdk.v2", sessions: [{ session_id: "ses_programmatic", status: "submitted" }] })
    expect(session.create).toHaveBeenCalledWith(expect.objectContaining({ agent: prepared.agent, location: { directory: tempHome } }))
    expect(session.prompt).toHaveBeenCalledTimes(1)
    expect(session.prompt).toHaveBeenCalledWith({ sessionID: "ses_programmatic", text: prepared.delegation.prompt })
    expect(readDelegationToken(tempHome, prepared.change, prepared.token).record?.launch).toMatchObject({
      parent_session_id: "prepare-session",
      child_session_id: "ses_programmatic",
      state: "submitted",
    })

    const sealed = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change: prepared.change,
      session_id: "ses_programmatic",
    }, { sessionID: "prepare-session", [ODF_V2_SESSION]: session } as any) as string)
    expect(sealed).toMatchObject({ status: "delegated", task_api_source: "sdk.v2", task_session_id: "ses_programmatic" })
    expect(session.wait).toHaveBeenCalledWith({ sessionID: "ses_programmatic" })
  })

  it("rejects byte-different prompts before creating a child and does not leak prompt text", async () => {
    const prepared = await prepareDesign()
    const alteredPrompt = prepared.delegation.prompt.replace("→", "->")
    expect(alteredPrompt).not.toBe(prepared.delegation.prompt)
    const session = { create: vi.fn(), prompt: vi.fn(), interrupt: vi.fn() }
    const { odf_delegation_launch } = await tools()

    const outputText = await odf_delegation_launch.execute({
      token: prepared.token,
      change: prepared.change,
      prompt: alteredPrompt,
    }, { sessionID: "prepare-session", [ODF_V2_SESSION]: session } as any) as string
    const output = JSON.parse(outputText)

    expect(output).toMatchObject({ status: "blocked", reason: "delegation-prompt-mismatch" })
    expect(output.prompt_check).toMatchObject({
      expected_utf8_bytes: delegationPromptByteLength(prepared.delegation.prompt),
      actual_utf8_bytes: delegationPromptByteLength(alteredPrompt),
      expected_sha256_prefix: delegationPromptDigest(prepared.delegation.prompt).slice(0, 12),
      actual_sha256_prefix: delegationPromptDigest(alteredPrompt).slice(0, 12),
      transcript_text_exact: true,
    })
    expect(outputText).not.toContain(prepared.delegation.prompt)
    expect(outputText).not.toContain(alteredPrompt)
    expect(session.create).not.toHaveBeenCalled()
    expect(session.prompt).not.toHaveBeenCalled()
  })

  it("does not resubmit an interrupted prompt or create a duplicate child on retry", async () => {
    const prepared = await prepareDesign()
    const controller = new AbortController()
    const session = {
      create: vi.fn().mockResolvedValue({ id: "ses_interrupted", agent: prepared.agent }),
      prompt: vi.fn().mockImplementation(async () => { controller.abort() }),
      interrupt: vi.fn().mockResolvedValue(undefined),
    }
    const { odf_delegation_launch } = await tools()
    const args = { token: prepared.token, change: prepared.change, prompt: prepared.delegation.prompt }

    const first = JSON.parse(await odf_delegation_launch.execute(args, {
      sessionID: "prepare-session", abort: controller.signal, [ODF_V2_SESSION]: session,
    } as any) as string)
    const retry = JSON.parse(await odf_delegation_launch.execute(args, {
      sessionID: "prepare-session", abort: new AbortController().signal, [ODF_V2_SESSION]: session,
    } as any) as string)

    expect(first).toMatchObject({ status: "launch-pending", sessions: [{ session_id: "ses_interrupted", status: "interrupted", prompt_resent: false }] })
    expect(retry).toMatchObject({ status: "launch-pending", sessions: [{ session_id: "ses_interrupted", status: "interrupted", prompt_resent: false }] })
    expect(session.create).toHaveBeenCalledTimes(1)
    expect(session.prompt).toHaveBeenCalledTimes(1)
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "ses_interrupted" })
  })

  it("serializes concurrent launch calls so one token creates and submits only once", async () => {
    const prepared = await prepareDesign()
    let finishCreate!: (value: { id: string }) => void
    const session = {
      create: vi.fn(() => new Promise<{ id: string }>(resolve => { finishCreate = resolve })),
      prompt: vi.fn().mockResolvedValue(undefined),
      interrupt: vi.fn().mockResolvedValue(undefined),
    }
    const { odf_delegation_launch } = await tools()
    const args = { token: prepared.token, change: prepared.change, prompt: prepared.delegation.prompt }
    const context = { sessionID: "prepare-session", abort: new AbortController().signal, [ODF_V2_SESSION]: session } as any

    const firstPromise = odf_delegation_launch.execute(args, context) as Promise<string>
    await vi.waitFor(() => expect(session.create).toHaveBeenCalledTimes(1))
    const concurrent = JSON.parse(await odf_delegation_launch.execute(args, context) as string)
    finishCreate({ id: "ses_concurrent" })
    const first = JSON.parse(await firstPromise)

    expect(concurrent).toMatchObject({ status: "blocked", reason: "delegation-launch-in-progress" })
    expect(first.status).toBe("launched")
    expect(first.sessions.map(({ session_id, status }: Record<string, unknown>) => ({ session_id, status })))
      .toEqual([{ session_id: "ses_concurrent", status: "submitted" }])
    expect(session.create).toHaveBeenCalledTimes(1)
    expect(session.prompt).toHaveBeenCalledTimes(1)
  })

  it("requires the selected store for native PROPOSE", async () => {
    const { odf_delegation_prepare } = await tools()
    const result = JSON.parse(await odf_delegation_prepare.execute({
      phase: "PROPOSE",
      change: "native-propose-no-store",
      prompt: "Draft the proposal",
    }, { sessionID: "prepare-propose" } as any) as string)

    expect(result).toMatchObject({ status: "blocked", reason: "artifact-store-required" })
  })

  it("returns a bounded blocked envelope when an explicit agent is ineligible", async () => {
    const { odf_delegation_prepare } = await tools()
    const result = JSON.parse(await odf_delegation_prepare.execute({
      phase: "PROPOSE",
      change: "native-propose-ineligible-agent",
      prompt: "Draft the proposal",
      agent: "odoo_backend_engineer",
      artifact_store: "openspec",
    }, { sessionID: "prepare-propose" } as any) as string)

    expect(result).toMatchObject({
      status: "blocked",
      reason: "agent-phase-ineligible",
      phase: "PROPOSE",
      agent: null,
      task_api_source: "subagent",
    })
  })

  it("writes a token-bound OpenSpec proposal and requires the seal to verify its persisted bytes", async () => {
    const change = "native-propose"
    const changeDir = await writeProposalState(tempHome, change)
    const { odf_delegation_prepare, odf_proposal_write, odf_delegation_seal } = await legacyTools()
    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "PROPOSE",
      change,
      prompt: "Draft the approved proposal",
      artifact_store: "openspec",
    }, { sessionID: "parent-session" } as any) as string)
    expect(prepared.status).toBe("prepared")

    const content = "## Proposal: native-propose\n\n### Intent\nPersist the approved scope before ASSESS.\n"
    const toolContext = { sessionID: "ses_child", agent: prepared.agent, directory: tempHome } as any
    const invalidToken = JSON.parse(await odf_proposal_write.execute({
      token: "not-a-valid-token", change, artifact_store: "openspec", content,
    }, toolContext) as string)
    expect(invalidToken).toMatchObject({ status: "blocked", reason: "delegation-token-invalid" })

    const wrongAgent = JSON.parse(await odf_proposal_write.execute({
      token: prepared.token, change, artifact_store: "openspec", content,
    }, { ...toolContext, agent: "odoo_backend_engineer" }) as string)
    expect(wrongAgent).toMatchObject({ status: "blocked", reason: "proposal-writer-agent-mismatch" })

    const otherWorkspace = path.join(tempHome, "other-workspace")
    await fs.mkdir(otherWorkspace)
    const wrongWorkspace = JSON.parse(await odf_proposal_write.execute({
      token: prepared.token, change, artifact_store: "openspec", content,
    }, { ...toolContext, directory: otherWorkspace }) as string)
    expect(wrongWorkspace).toMatchObject({ status: "blocked", reason: "delegation-token-unknown" })

    const wrongStore = JSON.parse(await odf_proposal_write.execute({
      token: prepared.token, change, artifact_store: "hybrid", content,
    }, toolContext) as string)
    expect(wrongStore).toMatchObject({ status: "blocked", reason: "proposal-writer-store-mismatch" })

    const written = JSON.parse(await odf_proposal_write.execute({
      token: prepared.token, change, artifact_store: "openspec", content,
    }, toolContext) as string)
    expect(written).toMatchObject({
      status: "ok",
      artifact_ref: { store: "openspec", ref: `openspec/changes/${change}/proposal.md` },
    })
    expect(await fs.readFile(path.join(changeDir, "proposal.md"), "utf8")).toBe(content)
    expect(readDelegationToken(tempHome, change, prepared.token).record).toMatchObject({
      proposal_artifact_ref: `openspec/changes/${change}/proposal.md`,
      proposal_session_id: "ses_child",
    })

    const rewrite = JSON.parse(await odf_proposal_write.execute({
      token: prepared.token, change, artifact_store: "openspec", content: `${content}\nChanged`,
    }, toolContext) as string)
    expect(rewrite).toMatchObject({ status: "blocked", reason: "proposal-already-written" })

    const resultText = `## ODF Result\n- **status**: ok\n- **artifacts_saved**: ${JSON.stringify([{ name: "proposal", artifact_ref: written.artifact_ref }])}`
    const session = fakeChildSession({ agent: prepared.agent, prompt: prepared.delegation.prompt, resultText })
    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change,
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({ status: "delegated", phase: "PROPOSE" })
    expect(readDelegationToken(tempHome, change, prepared.token)).toMatchObject({ error: "delegation-token-unknown" })
  })

  it("keeps expired proposal tokens fail-closed", async () => {
    const change = "native-propose-expired"
    const changeDir = await writeProposalState(tempHome, change)
    const expired = createDelegationTokenRecord({
      change,
      phase: "PROPOSE",
      agent: "odoo_proposer",
      artifact_store: "openspec",
      workspace: tempHome,
      prompt: "Draft the approved proposal",
      task: "Draft the approved proposal",
      now: new Date(Date.now() - 10_000),
      ttl_ms: 1_000,
    })!
    expect(writeDelegationToken(tempHome, expired)).toBeNull()

    const { odf_proposal_write } = await tools()
    const output = JSON.parse(await odf_proposal_write.execute({
      token: expired.token,
      change,
      artifact_store: "openspec",
      content: "## Proposal: native-propose-expired\n",
    }, { sessionID: "ses_child", agent: "odoo_proposer", directory: tempHome } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "delegation-token-expired" })
    await expect(fs.readFile(path.join(changeDir, "proposal.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("blocks a successful PROPOSE result that claims an OpenSpec ref without using the writer", async () => {
    const change = "native-propose-unwritten"
    await writeProposalState(tempHome, change)
    const { odf_delegation_prepare, odf_delegation_seal } = await legacyTools()
    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "PROPOSE",
      change,
      prompt: "Draft the approved proposal",
      artifact_store: "openspec",
    }, { sessionID: "parent-session" } as any) as string)
    const artifactRef = { store: "openspec", ref: `openspec/changes/${change}/proposal.md` }
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: prepared.delegation.prompt,
      resultText: `## ODF Result\n- **status**: ok\n- **artifacts_saved**: ${JSON.stringify([{ name: "proposal", artifact_ref: artifactRef }])}`,
    })

    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change,
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "proposal-artifact-not-written" })
    expect(readDelegationToken(tempHome, change, prepared.token)).toMatchObject({ error: "delegation-token-unknown" })
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

  it("does not acquire a native attempt when pre-tool safety blocks the prompt", async () => {
    const { odf_delegation_prepare } = await tools()
    const change = "native-implement-safety-blocked"
    await writeImplementState(tempHome, change)

    const output = JSON.parse(await odf_delegation_prepare.execute({
      phase: "IMPLEMENT",
      change,
      prompt: "Run DROP DATABASE odf_test_db;",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: "native-safety-blocked-1",
      workflow_advance: implementProof(),
    }, { sessionID: "parent-session" } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "pre-tool-safety" })
    await expect(fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("seals a proof-backed IMPLEMENT with maximum-length native session IDs", async () => {
    const { odf_delegation_prepare, odf_delegation_seal } = await legacyTools()
    const change = "native-implement"
    const attemptId = "a".repeat(64)
    const parentSessionId = "p".repeat(128)
    const childSessionId = "c".repeat(128)
    await writeImplementState(tempHome, change)

    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "IMPLEMENT",
      change,
      prompt: "Implement the planned change\n\nAcceptance criteria:\n- Preserve approved scope.\n- Add focused tests.",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: attemptId,
      workflow_advance: implementProof(),
    }, { sessionID: parentSessionId } as any) as string)

    expect(prepared).toMatchObject({ status: "prepared", change, phase: "IMPLEMENT", attempt_id: attemptId })
    expect(prepared.policy_gate).toMatchObject({ gate: "allow" })

    await writeValidationEvidence(tempHome, change)
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: prepared.delegation.prompt,
      resultText: "## ODF Result\n- **status**: ok\n- **executive_summary**: implemented",
      parentSessionId,
      childSessionId,
    })

    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change,
      session_id: childSessionId,
    }, { sessionID: parentSessionId, [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({
      status: "delegated",
      validation: { status: "verified" },
      workflow_commit: { status: "committed" },
      task_api_source: "subagent",
      task_session_id: childSessionId,
    })
    expect(YAML.parse(await fs.readFile(path.join(tempHome, "openspec", "changes", change, "state.yaml"), "utf8"))).toMatchObject({
      canonical_stage: "BUILD",
      completed_canonical_stages: ["DECIDE", "PLAN", "BUILD"],
    })
    const ledger = await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8")
    const records = ledger.trim().split("\n").map(line => JSON.parse(line))
    const latest = records.filter((record: { attempt_id: string }) => record.attempt_id === attemptId).at(-1)
    expect(latest).toMatchObject({
      status: "completed",
      next_stage: "BUILD",
      native_parent_session_id: parentSessionId,
      native_child_session_id: childSessionId,
    })
    expect(latest.native_child_idle_at).toBeTruthy()
    expect(Buffer.byteLength(JSON.stringify(latest))).toBeGreaterThan(512)
    expect(Buffer.byteLength(JSON.stringify(latest)) + 1).toBeLessThanOrEqual(1024)
  })

  it("keeps a native attempt running until session.wait confirms the child is idle, then makes recovery actionable", async () => {
    const { odf_delegation_prepare, odf_delegation_seal } = await legacyTools()
    const change = "native-implement-idle-recovery"
    await writeImplementState(tempHome, change)
    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "IMPLEMENT",
      change,
      prompt: "Implement the planned change",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: "native-idle-1",
      workflow_advance: implementProof(),
    }, { sessionID: "parent-session" } as any) as string)
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: prepared.delegation.prompt,
      resultText: "## ODF Result\n- **status**: ok\n- **executive_summary**: implemented",
    })
    session.wait.mockRejectedValueOnce(new Error("still busy"))
    const sealArgs = { token: prepared.token, change, session_id: "ses_child" }
    const context = { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any

    const waiting = JSON.parse(await odf_delegation_seal.execute(sealArgs, context) as string)

    expect(waiting).toMatchObject({ status: "blocked", reason: "delegation-child-not-idle" })
    expect(waiting.next_step).toContain("Keep the prepared token and running attempt")
    expect(session.context).not.toHaveBeenCalled()
    expect(readDelegationToken(tempHome, change, prepared.token).record).toMatchObject({ status: "prepared" })
    let ledger = (await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(ledger.at(-1)).toMatchObject({ status: "running", native_parent_session_id: "parent-session" })

    await writeValidationEvidence(tempHome, change)
    session.wait.mockResolvedValueOnce(undefined)
    const sealed = JSON.parse(await odf_delegation_seal.execute(sealArgs, context) as string)

    expect(sealed).toMatchObject({ status: "delegated", task_session_id: "ses_child" })
    expect(session.wait).toHaveBeenCalledTimes(2)
    ledger = (await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(ledger.at(-1)).toMatchObject({
      status: "completed",
      native_parent_session_id: "parent-session",
      native_child_session_id: "ses_child",
    })
    expect(ledger.at(-1).native_child_idle_at).toBeTruthy()
  })

  it("seals from the wrapped V2 session.context history shape", async () => {
    const { odf_delegation_prepare, odf_delegation_seal } = await legacyTools()
    const change = "native-implement-wrapped-context"
    const attemptId = "native-wrapped-context-1"
    await writeImplementState(tempHome, change)
    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "IMPLEMENT",
      change,
      prompt: "Implement the planned change",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: attemptId,
      workflow_advance: implementProof(),
    }, { sessionID: "parent-session" } as any) as string)
    await writeValidationEvidence(tempHome, change)
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: prepared.delegation.prompt,
      resultText: "## ODF Result\n- **status**: ok\n- **executive_summary**: implemented",
    })
    session.context.mockResolvedValue({
      data: [
        {
          info: { id: "msg_user", type: "user", text: `${OPENCODE_SUBAGENT_USER_PREFIX}${prepared.delegation.prompt}` },
          parts: [],
        },
        {
          info: { id: "msg_assistant", type: "assistant" },
          parts: [{ type: "text", text: "## ODF Result\n- **status**: ok\n- **executive_summary**: implemented" }],
        },
      ],
    })

    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change,
      session_id: "ses_child",
    }, {
      sessionID: "parent-session",
      [ODF_V2_SESSION]: session,
    } as any) as string)

    expect(output).toMatchObject({ status: "delegated", task_session_id: "ses_child", validation: { status: "verified" } })
    expect(session.context).toHaveBeenCalledWith({ sessionID: "ses_child" })
    const ledger = (await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    const latest = ledger.filter((entry: { attempt_id: string }) => entry.attempt_id === attemptId).at(-1)
    expect(latest).toMatchObject({
      status: "completed",
      native_child_observed_session_id: "ses_child",
      native_child_session_id: "ses_child",
    })
    expect(latest.native_child_observed_at).toBeTruthy()
  })

  it("persists an observed child ID but does not bind it when session.context fails", async () => {
    const { odf_delegation_prepare, odf_delegation_seal } = await legacyTools()
    const change = "native-implement-unreadable-child"
    const attemptId = "native-unreadable-child-1"
    await writeImplementState(tempHome, change)
    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "IMPLEMENT",
      change,
      prompt: "Implement the planned change",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: attemptId,
      workflow_advance: implementProof(),
    }, { sessionID: "parent-session" } as any) as string)
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: prepared.delegation.prompt,
      resultText: "## ODF Result\n- **status**: ok",
    })
    session.context.mockRejectedValue(new Error("do not expose this context error"))
    const output = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change,
      session_id: "ses_child",
    }, {
      sessionID: "parent-session",
      [ODF_V2_SESSION]: session,
    } as any) as string)

    expect(output).toMatchObject({
      status: "blocked",
      reason: "delegation-child-unreadable",
      conversation_read: {
        context: { status: "request-failed", error_type: "Error" },
      },
    })
    expect(JSON.stringify(output)).not.toContain("do not expose")
    const ledger = (await fs.readFile(path.join(tempHome, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    const latest = ledger.filter((entry: { attempt_id: string }) => entry.attempt_id === attemptId).at(-1)
    expect(latest).toMatchObject({ status: "running", native_child_observed_session_id: "ses_child" })
    expect(latest.native_child_observed_at).toBeTruthy()
    expect(latest.native_child_session_id).toBeUndefined()
    expect(latest.native_child_idle_at).toBeUndefined()
    expect(readDelegationToken(tempHome, change, prepared.token).record).toMatchObject({ status: "prepared" })
  })

  it("fails the proof-backed seal when IMPLEMENT validation evidence is missing", async () => {
    const { odf_delegation_prepare, odf_delegation_seal } = await legacyTools()
    const change = "native-implement-missing-evidence"
    await writeImplementState(tempHome, change)

    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "IMPLEMENT",
      change,
      prompt: "Implement the planned change",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: "native-impl-2",
      workflow_advance: implementProof(),
    }, { sessionID: "parent-session" } as any) as string)

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
    const changeDir = await writeDesignBoundaryFixture(tempHome, "native-design")
    const prepared = await prepareDesignLegacy()
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
    const prepared = await prepareDesignLegacy()
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

  it("keeps DECIDE pending when fresh artifacts remain after a failed ASSESS seal", async () => {
    const change = "native-unsealed-assessment"
    const changeDir = path.join(tempHome, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), [
      "work_type: feature",
      "artifact_store: openspec",
      "canonical_stage: DECIDE",
      "completed_canonical_stages: []",
      "artifact_invalidation:",
      "  version: 1",
      "  from_stage: DECIDE",
      "  invalidated_at: '2000-01-01T00:00:00.000Z'",
      "",
    ].join("\n"), "utf8")

    const { odf_delegation_prepare, odf_delegation_seal, odf_workflow_status } = await legacyTools()
    const prepared = JSON.parse(await odf_delegation_prepare.execute({
      phase: "ASSESS",
      change,
      prompt: "Assess the approved requirements",
      context_files: [],
      artifact_store: "openspec",
    }, { sessionID: "parent-session" } as any) as string)
    // Model the child writing its artifacts before the parent attempts to seal;
    // a failed seal must not let those bytes masquerade as committed workflow state.
    await fs.writeFile(path.join(changeDir, "proposal.md"), "# Fresh proposal\n", "utf8")
    await fs.writeFile(path.join(changeDir, "assessment.md"), "# Fresh but unsealed assessment\n", "utf8")
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: `${prepared.delegation.prompt}\n(edited before launch)`,
      resultText: "## ODF Result\n- **status**: ok\n- **executive_summary**: assessment saved",
    })

    const seal = JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change,
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any) as string)
    const status = JSON.parse(await odf_workflow_status.execute({
      change_name: change,
      workspace_dir: tempHome,
    }, { sessionID: "parent-session", directory: tempHome } as any) as string)

    expect(seal).toMatchObject({ status: "blocked", reason: "delegation-prompt-mismatch" })
    expect(status).toMatchObject({
      completed_canonical_stages: [],
      pending_stage: "DECIDE",
      artifact_refs: { DECIDE: expect.arrayContaining([
        `openspec/changes/${change}/proposal.md`,
        `openspec/changes/${change}/assessment.md`,
      ]) },
    })
  })

  it("fails closed when the child agent does not match the prepared agent", async () => {
    const prepared = await prepareDesignLegacy()
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
    const prepared = await prepareDesignLegacy()
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

  // ------------------------------------------------------------------
  // Parity matrix: the native path must produce the same envelope as the
  // legacy delegate for identical inputs and child results.
  // ------------------------------------------------------------------

  const odfResultText = (fields: Record<string, unknown>): string =>
    ["## ODF Result", ...Object.entries(fields).map(([key, value]) => `- **${key}**: ${String(value)}`)].join("\n")

  const stripPathFields = (envelope: Record<string, any>): Record<string, any> => {
    const copy = { ...envelope }
    delete copy.task_api_source
    delete copy.task_session_id
    delete copy.token
    delete copy.change
    return copy
  }

  const parityRoots = async (setup: (root: string, change: string) => Promise<unknown>) => {
    const delegateRoot = path.join(tempHome, "parity-delegate")
    const sealRoot = path.join(tempHome, "parity-seal")
    await fs.mkdir(delegateRoot, { recursive: true })
    await fs.mkdir(sealRoot, { recursive: true })
    await setup(delegateRoot, "parity-change")
    await setup(sealRoot, "parity-change")
    return { delegateRoot, sealRoot }
  }

  const runDelegate = async (root: string, args: Record<string, unknown>, childResult: unknown) => {
    const { odf_delegate } = await tools(root)
    const taskApi = vi.fn().mockResolvedValue(childResult)
    return JSON.parse(await odf_delegate.execute(
      { ...args, workspace_dir: root } as any,
      { sessionID: "delegate-session", task: taskApi } as any,
    ) as string)
  }

  const runSeal = async (root: string, args: Record<string, unknown>, childResult: Record<string, unknown>) => {
    const { odf_delegation_prepare, odf_delegation_seal } = await legacyTools(root)
    const prepared = JSON.parse(await odf_delegation_prepare.execute(
      { ...args, workspace_dir: root } as any,
      { sessionID: "parent-session" } as any,
    ) as string)
    if (prepared.status !== "prepared") return prepared
    const session = fakeChildSession({
      agent: prepared.agent,
      prompt: prepared.delegation.prompt,
      resultText: odfResultText(childResult),
    })
    return JSON.parse(await odf_delegation_seal.execute({
      token: prepared.token,
      change: prepared.change,
      session_id: "ses_child",
    }, { sessionID: "parent-session", [ODF_V2_SESSION]: session } as any) as string)
  }

  it("keeps full envelope parity with odf_delegate for a DESIGN success", async () => {
    const { delegateRoot, sealRoot } = await parityRoots(writeDesignBoundaryFixture)
    const args = { phase: "DESIGN", change: "parity-change", prompt: "Design the requested feature", context_files: [] }
    const childResult = { status: "ok", design_closed: true, executive_summary: "closed" }

    const delegateEnv = await runDelegate(delegateRoot, args, childResult)
    const sealEnv = await runSeal(sealRoot, args, childResult)

    expect(sealEnv.status).toBe("delegated")
    expect(stripPathFields(sealEnv)).toEqual(stripPathFields(delegateEnv))
  })

  it("keeps reason and result parity when DESIGN is not closed", async () => {
    const { delegateRoot, sealRoot } = await parityRoots(writeDesignBoundaryFixture)
    const args = { phase: "DESIGN", change: "parity-change", prompt: "Design the requested feature", context_files: [] }
    const childResult = { status: "ok", design_closed: false }

    const delegateEnv = await runDelegate(delegateRoot, args, childResult)
    const sealEnv = await runSeal(sealRoot, args, childResult)

    expect(delegateEnv).toMatchObject({ status: "blocked", reason: "design-not-closed" })
    expect(sealEnv).toMatchObject({ status: "blocked", reason: "design-not-closed" })
    expect(stripPathFields(sealEnv)).toEqual(stripPathFields(delegateEnv))
  })

  it("keeps reason parity when source-authority evidence is missing", async () => {
    const { delegateRoot, sealRoot } = await parityRoots(writeDesignBoundaryFixture)
    const args = {
      phase: "DESIGN",
      change: "parity-change",
      prompt: "Design view inheritance with inherit_id for the target view",
      context_files: [],
      odoo_source_root: path.resolve("scripts/fixtures/source-precision/odoo-19.0"),
    }
    const childResult = { status: "ok", design_closed: true }

    const delegateEnv = await runDelegate(delegateRoot, args, childResult)
    const sealEnv = await runSeal(sealRoot, args, childResult)

    expect(delegateEnv).toMatchObject({ status: "blocked", reason: "source-authority-invalid" })
    expect(sealEnv).toMatchObject({ status: "blocked", reason: "source-authority-invalid" })
    expect(sealEnv.result?.source_authority).toEqual(delegateEnv.result?.source_authority)
  })

  it("keeps envelope parity with odf_delegate for a proof-backed IMPLEMENT success", async () => {
    const { delegateRoot, sealRoot } = await parityRoots(async (root, change) => {
      await writeImplementState(root, change)
      await writeValidationEvidence(root, change)
    })
    const args = {
      phase: "IMPLEMENT",
      change: "parity-change",
      prompt: "Implement the planned change",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: "parity-attempt-1",
      workflow_advance: implementProof(),
    }
    const childResult = { status: "ok", executive_summary: "implemented" }

    const delegateEnv = await runDelegate(delegateRoot, args, childResult)
    const sealEnv = await runSeal(sealRoot, args, childResult)

    expect(delegateEnv).toMatchObject({
      status: "delegated",
      validation: { status: "verified" },
      workflow_commit: { status: "committed" },
    })
    expect(sealEnv).toMatchObject({
      status: "delegated",
      agent: delegateEnv.agent,
      validation: { status: delegateEnv.validation.status },
      workflow_commit: { status: delegateEnv.workflow_commit.status },
      result: delegateEnv.result,
    })
    const delegateState = YAML.parse(await fs.readFile(path.join(delegateRoot, "openspec", "changes", "parity-change", "state.yaml"), "utf8"))
    const sealState = YAML.parse(await fs.readFile(path.join(sealRoot, "openspec", "changes", "parity-change", "state.yaml"), "utf8"))
    expect(sealState).toEqual(delegateState)
  })

  it("keeps reason parity when the IMPLEMENT validation evidence is missing", async () => {
    const { delegateRoot, sealRoot } = await parityRoots(writeImplementState)
    const args = {
      phase: "IMPLEMENT",
      change: "parity-change",
      prompt: "Implement the planned change",
      context_files: [],
      artifact_store: "openspec",
      attempt_id: "parity-attempt-2",
      workflow_advance: implementProof(),
    }
    const childResult = { status: "ok", executive_summary: "implemented without evidence" }

    const delegateEnv = await runDelegate(delegateRoot, args, childResult)
    const sealEnv = await runSeal(sealRoot, args, childResult)

    expect(delegateEnv).toMatchObject({ status: "blocked", validation: { status: "missing" }, workflow_commit: null })
    expect(sealEnv).toMatchObject({
      status: "blocked",
      reason: delegateEnv.reason,
      validation: { status: "missing" },
      workflow_commit: null,
    })
  })

  it("keeps envelope parity when the inner phase result failed", async () => {
    const { delegateRoot, sealRoot } = await parityRoots(writeDesignBoundaryFixture)
    const args = { phase: "DESIGN", change: "parity-change", prompt: "Design the requested feature", context_files: [] }
    const childResult = { status: "failed", executive_summary: "could not close" }

    const delegateEnv = await runDelegate(delegateRoot, args, childResult)
    const sealEnv = await runSeal(sealRoot, args, childResult)

    expect(delegateEnv).toMatchObject({ status: "delegated", result: { status: "failed" } })
    expect(sealEnv).toMatchObject({ status: "delegated", result: { status: "failed" } })
    expect(sealEnv.workflow_materialization).toBeUndefined()
  })

  // ------------------------------------------------------------------
  // Native parallel BUILD (cross-domain): prepare → N subagents → seal.
  // ------------------------------------------------------------------

  const parallelWorkflowAdvance = () => ({
    work_type: "cross-domain" as const,
    completed_stages: ["DECIDE"] as const,
    candidate_stage: "PLAN" as const,
    phase_result_status: "ok" as const,
    validation_status: "not-required" as const,
    receipt_state: "none" as const,
    resumable_state: true,
    archived_state: false,
  })

  const writeParallelState = async (root: string, change: string) => {
    const changeDir = path.join(root, "openspec", "changes", change)
    await fs.mkdir(changeDir, { recursive: true })
    await fs.writeFile(path.join(changeDir, "state.yaml"), YAML.stringify({
      work_type: "cross-domain",
      canonical_stage: "BUILD",
      completed_canonical_stages: ["DECIDE", "PLAN"],
      resumable: true,
    }), "utf8")
    await fs.writeFile(path.join(changeDir, "implement-progress.md"), "- [x] parallel implementation\n", "utf8")
  }

  const writeParallelEvidence = async (root: string, change: string, branchIds: string[]) => {
    await fs.mkdir(path.join(root, ".odf"), { recursive: true })
    for (const branchId of branchIds) {
      await fs.writeFile(path.join(root, ".odf", `validation-evidence-${change}-${branchId}.json`), JSON.stringify({
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
  }

  const parallelSessionApi = (
    branches: Array<{ branch_id: string; agent: string; prompt: string }>,
    resultTextFor: (branchId: string) => string,
  ) => {
    const byId = new Map(branches.map(branch => [`ses_${branch.branch_id}`, branch]))
    return {
      create: vi.fn(),
      get: vi.fn().mockImplementation(({ sessionID }: { sessionID: string }) => {
        const entry = byId.get(sessionID)
        if (!entry) return Promise.reject(new Error("unknown session"))
        return Promise.resolve({ id: sessionID, agent: entry.agent, parentID: "prepare-session" })
      }),
      prompt: vi.fn(),
      wait: vi.fn(),
      context: vi.fn().mockImplementation(({ sessionID }: { sessionID: string }) => {
        const entry = byId.get(sessionID)
        if (!entry) return Promise.reject(new Error("unknown session"))
        return Promise.resolve([
          { info: { type: "user" }, content: [{ type: "text", text: entry.prompt }] },
          { info: { type: "assistant" }, content: [{ type: "text", text: resultTextFor(entry.branch_id) }] },
        ])
      }),
      interrupt: vi.fn(),
    }
  }

  it("prepares and seals a native parallel BUILD end to end", async () => {
    const change = "native-parallel"
    const root = path.join(tempHome, "parallel-root")
    await fs.mkdir(root, { recursive: true })
    await writeParallelState(root, change)
    const branches = [
      { branch_id: "backend-native", attempt_id: "backend-native-attempt", prompt: "Implement the backend branch", context_files: ["backend-native.py"] },
      { branch_id: "frontend-native", attempt_id: "frontend-native-attempt", prompt: "Implement the frontend branch", context_files: ["frontend-native.py"] },
    ]
    const { odf_parallel_prepare, odf_parallel_seal } = await tools(root)

    const prepared = JSON.parse(await odf_parallel_prepare.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "prepare-session" } as any) as string)

    expect(prepared).toMatchObject({ status: "prepared", change, token: expect.stringMatching(/^odf-tok-/) })
    expect(prepared.branches.map((branch: any) => branch.branch_id)).toEqual(["backend-native", "frontend-native"])
    expect(prepared.branches.every((branch: any) => branch.prompt.includes("<!-- ODF-DELEGATION "))).toBe(true)
    expect(prepared.branches.every((branch: any) => branch.prompt.includes(`validation-evidence-${change}-`))).toBe(true)

    await writeParallelEvidence(root, change, branches.map(branch => branch.branch_id))
    const session = parallelSessionApi(
      prepared.branches.map((branch: any) => ({ branch_id: branch.branch_id, agent: branch.agent, prompt: branch.prompt })),
      () => "## ODF Result\n- **status**: ok\n- **executive_summary**: branch implemented",
    )
    const output = JSON.parse(await odf_parallel_seal.execute({
      token: prepared.token,
      change,
      branches: prepared.branches.map((branch: any) => ({ branch_id: branch.branch_id, session_id: `ses_${branch.branch_id}` })),
    }, { sessionID: "prepare-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({
      status: "parallel-delegated",
      task_api_source: "subagent",
      join: { status: "complete", expected: 2, completed: 2, failed: 0, validation_verified: true },
    })
    expect(output.branches.every((branch: any) => branch.task_session_id?.startsWith("ses_"))).toBe(true)
    expect(session.wait).toHaveBeenCalledTimes(2)

    const state = YAML.parse(await fs.readFile(path.join(root, "openspec", "changes", change, "state.yaml"), "utf8"))
    expect(state).toMatchObject({ canonical_stage: "BUILD", completed_canonical_stages: ["DECIDE", "PLAN", "BUILD"] })
    const ledger = (await fs.readFile(path.join(root, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    const completed = ledger.filter((entry: { status: string }) => entry.status === "completed")
    expect(completed).toHaveLength(2)
    expect(completed.every((entry: any) => entry.native_parent_session_id === "prepare-session" &&
      typeof entry.native_child_session_id === "string" && typeof entry.native_child_idle_at === "string")).toBe(true)
    expect(readDelegationToken(root, change, prepared.token)).toMatchObject({ error: "delegation-token-unknown" })
  })

  it("keeps native parallel attempts running when a child has not reached idle", async () => {
    const change = "native-parallel-not-idle"
    const root = path.join(tempHome, "parallel-not-idle-root")
    await fs.mkdir(root, { recursive: true })
    await writeParallelState(root, change)
    const branches = [
      { branch_id: "backend-idle", attempt_id: "backend-idle-attempt", prompt: "Implement the backend branch", context_files: ["backend-idle.py"] },
      { branch_id: "frontend-idle", attempt_id: "frontend-idle-attempt", prompt: "Implement the frontend branch", context_files: ["frontend-idle.py"] },
    ]
    const { odf_parallel_prepare, odf_parallel_seal } = await legacyTools(root)
    const prepared = JSON.parse(await odf_parallel_prepare.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "prepare-session" } as any) as string)
    const session = parallelSessionApi(
      prepared.branches.map((branch: any) => ({ branch_id: branch.branch_id, agent: branch.agent, prompt: branch.prompt })),
      () => "## ODF Result\n- **status**: ok\n- **executive_summary**: branch implemented",
    )
    session.wait.mockRejectedValueOnce(new Error("still running"))

    const output = JSON.parse(await odf_parallel_seal.execute({
      token: prepared.token,
      change,
      branches: prepared.branches.map((branch: any) => ({ branch_id: branch.branch_id, session_id: `ses_${branch.branch_id}` })),
    }, { sessionID: "prepare-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "delegation-child-not-idle" })
    expect(output.next_step).toContain("Keep the prepared token and running branch attempts")
    expect(output.retry_branches).toEqual([
      { branch_id: "backend-idle", session_id: "ses_backend-idle" },
      { branch_id: "frontend-idle", session_id: "ses_frontend-idle" },
    ])
    expect(session.context).not.toHaveBeenCalled()
    expect(readDelegationToken(root, change, prepared.token).record).toMatchObject({ status: "prepared" })
    const ledger = (await fs.readFile(path.join(root, ".odf", `attempt-ledger-${change}.jsonl`), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line))
    expect(ledger).toHaveLength(3)
    expect(ledger.every((entry: any) => entry.status === "running" && entry.native_parent_session_id === "prepare-session")).toBe(true)
    expect(ledger.at(-1)).toMatchObject({
      branch_id: "backend-idle",
      native_child_observed_session_id: "ses_backend-idle",
    })
    expect(ledger.at(-1).native_child_observed_at).toBeTruthy()
    expect(ledger.at(-1).native_child_session_id).toBeUndefined()
  })

  it("fails closed when a parallel child agent does not match its branch", async () => {
    const change = "native-parallel-mismatch"
    const root = path.join(tempHome, "parallel-mismatch-root")
    await fs.mkdir(root, { recursive: true })
    await writeParallelState(root, change)
    const branches = [
      { branch_id: "backend-a", attempt_id: "backend-a-attempt", prompt: "Implement the backend branch", context_files: ["backend-a.py"] },
      { branch_id: "frontend-a", attempt_id: "frontend-a-attempt", prompt: "Implement the frontend branch", context_files: ["frontend-a.py"] },
    ]
    const { odf_parallel_prepare, odf_parallel_seal } = await legacyTools(root)
    const prepared = JSON.parse(await odf_parallel_prepare.execute({
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change,
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
      branches,
    }, { sessionID: "prepare-session" } as any) as string)

    const session = parallelSessionApi(
      prepared.branches.map((branch: any) => ({ branch_id: branch.branch_id, agent: branch.branch_id === "frontend-a" ? "odoo_qa_engineer" : branch.agent, prompt: branch.prompt })),
      () => "## ODF Result\n- **status**: ok",
    )
    const output = JSON.parse(await odf_parallel_seal.execute({
      token: prepared.token,
      change,
      branches: prepared.branches.map((branch: any) => ({ branch_id: branch.branch_id, session_id: `ses_${branch.branch_id}` })),
    }, { sessionID: "prepare-session", [ODF_V2_SESSION]: session } as any) as string)

    expect(output).toMatchObject({ status: "blocked", reason: "delegation-child-mismatch" })
    // A binding failure keeps the token for a retry.
    expect(readDelegationToken(root, change, prepared.token).error).toBeNull()
  })

  it("validates parallel prepare inputs before acquiring attempts", async () => {
    const { odf_parallel_prepare } = await tools()
    const base = {
      work_type: "cross-domain",
      phase: "IMPLEMENT",
      change: "native-parallel-validation",
      artifact_store: "openspec",
      workflow_advance: parallelWorkflowAdvance(),
    }
    const oneBranch = JSON.parse(await odf_parallel_prepare.execute({
      ...base,
      branches: [{ branch_id: "solo", attempt_id: "solo-attempt", prompt: "Implement the branch" }],
    }, { sessionID: "prepare-session" } as any) as string)
    expect(oneBranch).toMatchObject({ status: "blocked", reason: "parallel-branch-count" })

    const duplicated = JSON.parse(await odf_parallel_prepare.execute({
      ...base,
      branches: [
        { branch_id: "dup", attempt_id: "dup-a", prompt: "Implement one branch" },
        { branch_id: "dup", attempt_id: "dup-b", prompt: "Implement another branch" },
      ],
    }, { sessionID: "prepare-session" } as any) as string)
    expect(duplicated).toMatchObject({ status: "blocked", reason: "duplicate-branch-id" })
  })
})
