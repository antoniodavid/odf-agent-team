import { describe, expect, it } from "vitest"
import {
  inspectNativePretoolSafetyBlock,
  inspectNativeChildBindFailure,
  inspectNativeSubagentLaunchNotExecuted,
} from "./odf-native-attempt-recovery.js"

const attempt = {
  parentSessionId: "parent-session",
  attemptId: "attempt-123",
  change: "barcode-fix",
  phase: "IMPLEMENT" as const,
  startedAt: "2026-10-02T16:03:33.911Z",
}

const blocked = {
  status: "blocked",
  reason: "pre-tool-safety",
  phase: "IMPLEMENT",
  agent: null,
  token: null,
  task_api_source: "subagent",
  result: null,
  classes: ["destructive"],
  matched_rules: ["destructive-dropdb"],
}

function parentContext(input: Record<string, unknown> = {}, output: unknown = blocked): any[] {
  return [{
    id: "msg-parent-tool",
    type: "assistant",
    time: { created: Date.parse(attempt.startedAt) - 5_000, completed: Date.parse(attempt.startedAt) + 1_000 },
    content: [{
      type: "tool",
      id: "call-prepare",
      name: "odf_delegation_prepare",
      state: {
        status: "completed",
        input: { ...attempt, attempt_id: attempt.attemptId, change: attempt.change, ...input },
        content: [{ type: "text", text: JSON.stringify(output) }],
      },
    }],
  }]
}

const prepared = {
  status: "prepared",
  change: attempt.change,
  phase: attempt.phase,
  attempt_id: attempt.attemptId,
  agent: "odoo_batch_implementer",
  token: "odf-tok-123456",
  task_api_source: "subagent",
  delegation: {
    agent: "odoo_batch_implementer",
    prompt: `<!-- ODF-DELEGATION {"change":"${attempt.change}","phase":"${attempt.phase}","agent":"odoo_batch_implementer","token":"odf-tok-123456"} -->\nTask body`,
  },
}

function failedLaunchContext(
  prepareOutput: unknown = prepared,
  launch: Record<string, unknown> = {
    type: "tool",
    id: "call-subagent",
    name: "subagent",
    executed: false,
    state: {
      status: "error",
      input: {},
      error: { type: "aborted", message: "Tool execution interrupted" },
    },
  },
): any[] {
  const startedMs = Date.parse(attempt.startedAt)
  return [
    {
      id: "msg-parent-prepare",
      type: "assistant",
      time: { created: startedMs - 5_000, completed: startedMs + 1_000 },
      content: [{
        type: "tool",
        id: "call-prepare",
        name: "execute",
        state: {
          status: "completed",
          input: {
            code: `const result = await tools.odf_delegation_prepare({ phase: "${attempt.phase}", change: "${attempt.change}", attempt_id: "${attempt.attemptId}" });\nreturn result;`,
          },
          content: [{ type: "text", text: JSON.stringify(prepareOutput) }],
        },
      }],
    },
    {
      id: "msg-parent-launch",
      type: "assistant",
      time: { created: startedMs + 2_000, completed: startedMs + 3_000 },
      content: [launch],
    },
  ]
}

describe("inspectNativePretoolSafetyBlock", () => {
  it("accepts an exact native prepare safety rejection from the parent session", () => {
    expect(inspectNativePretoolSafetyBlock(parentContext(), attempt)).toEqual({
      schema_version: 1,
      evidence_type: "native-pretool-safety-block",
      parent_session_id: attempt.parentSessionId,
      attempt_id: attempt.attemptId,
      parent_message_id: "msg-parent-tool",
      prepare_call_id: "call-prepare",
      prepare_tool: "odf_delegation_prepare",
      blocked_at: "2026-10-02T16:03:34.911Z",
      matched_rules: ["destructive-dropdb"],
    })
  })

  it("accepts the Code Mode execute transcript shape used by the ODF runtime", () => {
    const context = parentContext()
    const message = (context as any[])[0]
    message.content[0].name = "execute"
    message.content[0].state.input = {
      code: `return await tools.odf_delegation_prepare({ phase: "IMPLEMENT", change: "barcode-fix", attempt_id: "attempt-123" })`,
    }
    expect(inspectNativePretoolSafetyBlock(context, attempt)?.prepare_tool).toBe("odf_delegation_prepare")
  })

  it.each([
    ["comment-only call", `// tools.odf_delegation_prepare({ phase: "IMPLEMENT", change: "barcode-fix", attempt_id: "attempt-123" })\nreturn { status: "blocked" }`],
    ["string-only call", `const example = 'tools.odf_delegation_prepare({ phase: "IMPLEMENT", change: "barcode-fix", attempt_id: "attempt-123" })'; return { status: "blocked" }`],
    ["nested attempt fields", `return await tools.odf_delegation_prepare({ args: { phase: "IMPLEMENT", change: "barcode-fix", attempt_id: "attempt-123" } })`],
    ["unreturned call", `await tools.odf_delegation_prepare({ phase: "IMPLEMENT", change: "barcode-fix", attempt_id: "attempt-123" }); return { status: "blocked" }`],
    ["spread-overridden fields", `return await tools.odf_delegation_prepare({ phase: "IMPLEMENT", change: "barcode-fix", attempt_id: "attempt-123", ...other })`],
    ["duplicate calls", `return await tools.odf_delegation_prepare({ phase: "IMPLEMENT", change: "barcode-fix", attempt_id: "attempt-123" }); return await tools.odf_delegation_prepare({ phase: "IMPLEMENT", change: "barcode-fix", attempt_id: "attempt-123" })`],
  ])("rejects Code Mode source with %s", (_label, code) => {
    const context = parentContext()
    const message = (context as any[])[0]
    message.content[0].name = "execute"
    message.content[0].state.input = { code }
    expect(inspectNativePretoolSafetyBlock(context, attempt)).toBeNull()
  })

  it.each([
    ["another attempt", { attempt_id: "different-attempt" }, blocked],
    ["another change", { change: "other-change" }, blocked],
    ["a prepared result", {}, { ...blocked, status: "prepared", reason: "prepared", token: "token-1" }],
    ["a generic failure", {}, { ...blocked, reason: "attempt-phase-running" }],
    ["a child-bearing result", {}, { ...blocked, child_session_id: "child-session" }],
  ])("rejects %s as proof of an unlaunched attempt", (_label, input, output) => {
    expect(inspectNativePretoolSafetyBlock(parentContext(input, output), attempt)).toBeNull()
  })

  it("rejects a prepare call without a terminal tool result", () => {
    const context = parentContext()
    ;(context as any[])[0].content[0].state.status = "running"
    expect(inspectNativePretoolSafetyBlock(context, attempt)).toBeNull()
  })

  it("fails closed when parent history is missing, ambiguous, or outside the attempt interval", () => {
    const context = parentContext()
    const message = (context as any[])[0]
    expect(inspectNativePretoolSafetyBlock([], attempt)).toBeNull()
    expect(inspectNativePretoolSafetyBlock([...context, message], attempt)).toBeNull()
    message.time = { created: Date.parse(attempt.startedAt) + 2_000, completed: Date.parse(attempt.startedAt) + 3_000 }
    expect(inspectNativePretoolSafetyBlock(context, attempt)).toBeNull()
  })
})

describe("inspectNativeSubagentLaunchNotExecuted", () => {
  it("accepts a prepared delegation followed by an exact aborted, unexecuted host launch", () => {
    expect(inspectNativeSubagentLaunchNotExecuted(failedLaunchContext(), attempt)).toMatchObject({
      schema_version: 1,
      evidence_type: "native-subagent-launch-not-executed",
      parent_session_id: attempt.parentSessionId,
      attempt_id: attempt.attemptId,
      prepare_message_id: "msg-parent-prepare",
      prepare_call_id: "call-prepare",
      launch_message_id: "msg-parent-launch",
      launch_call_id: "call-subagent",
      launch_tool: "subagent",
      launch_error_type: "aborted",
    })
    const evidence = inspectNativeSubagentLaunchNotExecuted(failedLaunchContext(), attempt)
    expect(evidence?.prepared_token_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(evidence)).not.toContain(prepared.token)
  })

  it("accepts the multiline Code Mode prepare shape with extra fields and trailing commas", () => {
    const context = failedLaunchContext()
    const prepareTool = (context[0] as any).content[0]
    prepareTool.state.input.code = `const prompt = "bound delegation prompt";

const r = await tools.odf_delegation_prepare({
  phase: "IMPLEMENT",
  change: "barcode-fix",
  prompt,
  artifact_store: "openspec",
  attempt_id: "attempt-123",
  context_files: ["models/example.py", "tests/test_example.py"],
  workspace_dir: "/workspace/project",
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
});
return r;`
    expect(inspectNativeSubagentLaunchNotExecuted(context, attempt)).toMatchObject({
      evidence_type: "native-subagent-launch-not-executed",
      attempt_id: attempt.attemptId,
      prepare_call_id: "call-prepare",
      launch_call_id: "call-subagent",
    })
  })

  it.each([
    ["executed tool", { type: "tool", id: "call-subagent", name: "subagent", executed: true, state: { status: "error", input: {}, error: { type: "aborted", message: "Tool execution interrupted" } } }],
    ["missing execution flag", { type: "tool", id: "call-subagent", name: "subagent", state: { status: "error", input: {}, error: { type: "aborted", message: "Tool execution interrupted" } } }],
    ["non-empty tool input", { type: "tool", id: "call-subagent", name: "subagent", executed: false, state: { status: "error", input: { prompt: "maybe launched" }, error: { type: "aborted", message: "Tool execution interrupted" } } }],
    ["different error", { type: "tool", id: "call-subagent", name: "subagent", executed: false, state: { status: "error", input: {}, error: { type: "permission", message: "denied" } } }],
    ["child identity", { type: "tool", id: "call-subagent", name: "subagent", executed: false, state: { status: "error", input: {}, childSessionId: "child-session", error: { type: "aborted", message: "Tool execution interrupted" } } }],
    ["completed launch", { type: "tool", id: "call-subagent", name: "subagent", executed: true, state: { status: "completed", input: {}, content: [{ type: "text", text: "child-session" }] } }],
  ])("rejects %s as proof that no child was launched", (_label, launch) => {
    expect(inspectNativeSubagentLaunchNotExecuted(failedLaunchContext(prepared, launch as Record<string, unknown>), attempt)).toBeNull()
  })

  it.each([
    ["wrong attempt", { ...prepared, attempt_id: "other-attempt" }],
    ["missing token", { ...prepared, token: null }],
    ["non-prepared result", { ...prepared, status: "blocked" }],
  ])("rejects %s preparation results", (_label, output) => {
    expect(inspectNativeSubagentLaunchNotExecuted(failedLaunchContext(output), attempt)).toBeNull()
  })

  it("rejects multiple possible launch calls and incomplete history", () => {
    const context = failedLaunchContext()
    const second = structuredClone(context[1])
    second.content[0].id = "call-subagent-2"
    context.push(second)
    expect(inspectNativeSubagentLaunchNotExecuted(context, attempt)).toBeNull()
    expect(inspectNativeSubagentLaunchNotExecuted([], attempt)).toBeNull()
  })
})

describe("inspectNativeChildBindFailure", () => {
  const token = "odf-tok-bind-failure-123"
  const childSessionId = "child-session"
  const prompt = `<!-- ODF-DELEGATION {"change":"${attempt.change}","phase":"${attempt.phase}","agent":"odoo_batch_implementer","token":"${token}"} -->\nTask body`
  const preparedResult = {
    status: "prepared",
    change: attempt.change,
    phase: attempt.phase,
    attempt_id: attempt.attemptId,
    agent: "odoo_batch_implementer",
    token,
    delegation: { agent: "odoo_batch_implementer", prompt },
  }

  function bindFailureContext(reasonOrReasons: string | string[] = "delegation-attempt-child-bind-failed"): any[] {
    const startedMs = Date.parse(attempt.startedAt)
    const reasons = Array.isArray(reasonOrReasons) ? reasonOrReasons : [reasonOrReasons]
    return [
      {
        id: "msg-parent-prepare",
        type: "assistant",
        time: { created: startedMs - 1_000, completed: startedMs + 1_000 },
        content: [{
          type: "tool",
          id: "call-prepare",
          name: "execute",
          state: {
            status: "completed",
            input: {
              code: `return await tools.odf_delegation_prepare({ phase: "${attempt.phase}", change: "${attempt.change}", attempt_id: "${attempt.attemptId}" })`,
            },
            content: [{ type: "text", text: JSON.stringify(preparedResult) }],
          },
        }],
      },
      {
        id: "msg-parent-launch",
        type: "assistant",
        time: { created: startedMs + 2_000, completed: startedMs + 3_000 },
        content: [{
          type: "tool",
          id: "call-subagent",
          name: "subagent",
          executed: true,
          state: {
            status: "completed",
            input: { agent: preparedResult.agent, prompt },
            content: [{ type: "text", text: childSessionId }],
          },
        }],
      },
      ...reasons.map((reason, index) => {
        const suffix = index === 0 && reasons.length === 1 ? "" : `-${index + 1}`
        const createdAt = startedMs + 4_000 + index * 2_000
        return {
          id: `msg-parent-seal${suffix}`,
          type: "assistant",
          time: { created: createdAt, completed: createdAt + 1_000 },
          content: [{
            type: "tool",
            id: `call-seal${suffix}`,
            name: "execute",
            state: {
              status: "completed",
              input: {
                code: `return await tools.odf_delegation_seal({ token: "${token}", change: "${attempt.change}", session_id: "${childSessionId}" })`,
              },
              content: [{ type: "text", text: JSON.stringify({ status: "blocked", reason }) }],
            },
          }],
        }
      }),
    ]
  }

  it("proves the exact prepared child and bind-failed seal without retaining prompt or token", () => {
    const evidence = inspectNativeChildBindFailure(bindFailureContext(), attempt, childSessionId)
    expect(evidence).toMatchObject({
      schema_version: 1,
      evidence_type: "native-child-bind-failure",
      parent_session_id: attempt.parentSessionId,
      attempt_id: attempt.attemptId,
      prepare_message_id: "msg-parent-prepare",
      prepare_call_id: "call-prepare",
      launch_message_id: "msg-parent-launch",
      launch_call_id: "call-subagent",
      child_session_id: childSessionId,
      seal_message_id: "msg-parent-seal",
      seal_call_id: "call-seal",
      seal_reason: "delegation-attempt-child-bind-failed",
    })
    expect(evidence?.prepared_token_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(evidence?.prepared_prompt_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(evidence)).not.toContain(token)
    expect(JSON.stringify(evidence)).not.toContain(prompt)
  })

  it("preserves the first exact bind-failed proof across retries and a later unknown token", () => {
    const context = bindFailureContext([
      "delegation-attempt-child-bind-failed",
      "delegation-attempt-child-bind-failed",
      "delegation-attempt-child-bind-failed",
      "delegation-attempt-child-bind-failed",
      "delegation-token-unknown",
    ])
    const startedMs = Date.parse(attempt.startedAt)
    context.push({
      id: "msg-parent-later-prepare",
      type: "assistant",
      time: { created: startedMs + 20_000, completed: startedMs + 21_000 },
      content: [{
        type: "tool",
        id: "call-later-prepare",
        name: "execute",
        state: {
          status: "completed",
          input: { code: `return await tools.odf_delegation_prepare({ phase: "IMPLEMENT", change: "${attempt.change}", attempt_id: "different-attempt" })` },
          content: [{ type: "text", text: JSON.stringify({ status: "prepared", attempt_id: "different-attempt" }) }],
        },
      }],
    })

    expect(inspectNativeChildBindFailure(context, attempt, childSessionId)).toMatchObject({
      evidence_type: "native-child-bind-failure",
      seal_message_id: "msg-parent-seal-1",
      seal_call_id: "call-seal-1",
      seal_reason: "delegation-attempt-child-bind-failed",
    })
  })

  it("does not treat an unknown-token seal as child-bind-failure evidence", () => {
    expect(inspectNativeChildBindFailure(
      bindFailureContext("delegation-token-unknown"),
      attempt,
      childSessionId,
    )).toBeNull()
  })

  it("fails closed when an unknown-token seal precedes the bind-failed proof", () => {
    expect(inspectNativeChildBindFailure(
      bindFailureContext(["delegation-token-unknown", "delegation-attempt-child-bind-failed"]),
      attempt,
      childSessionId,
    )).toBeNull()
  })

  it.each([
    ["a changed launched prompt", (context: any[]) => { context[1].content[0].state.input.prompt += " changed" }],
    ["a seal for another child", (context: any[]) => { context[2].content[0].state.input.code = `return await tools.odf_delegation_seal({ token: "${token}", change: "${attempt.change}", session_id: "sibling-session" })` }],
    ["a different seal failure", (context: any[]) => { context[2].content[0].state.content[0].text = JSON.stringify({ status: "blocked", reason: "delegation-prompt-mismatch" }) }],
    ["an ambiguous second launch", (context: any[]) => { context.splice(2, 0, structuredClone(context[1])) }],
    ["an incomplete transcript", (context: any[]) => { context.pop() }],
  ])("fails closed for %s", (_label, mutate) => {
    const context = bindFailureContext()
    mutate(context)
    expect(inspectNativeChildBindFailure(context, attempt, childSessionId)).toBeNull()
  })
})
