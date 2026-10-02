import { describe, expect, it } from "vitest"
import { inspectNativePretoolSafetyBlock } from "./odf-native-attempt-recovery.js"

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
