import { createHash } from "node:crypto"

export interface NativePretoolSafetyEvidence {
  schema_version: 1
  evidence_type: "native-pretool-safety-block"
  parent_session_id: string
  attempt_id: string
  parent_message_id: string
  prepare_call_id: string
  prepare_tool: "odf_delegation_prepare"
  blocked_at: string
  matched_rules: string[]
}

export interface NativeSubagentLaunchNotExecutedEvidence {
  schema_version: 1
  evidence_type: "native-subagent-launch-not-executed"
  parent_session_id: string
  attempt_id: string
  prepare_message_id: string
  prepare_call_id: string
  prepared_token_sha256: string
  prepared_at: string
  launch_message_id: string
  launch_call_id: string
  launch_tool: "subagent"
  launch_error_type: "aborted"
  launch_failed_at: string
}

export interface NativeChildBindFailureEvidence {
  schema_version: 1
  evidence_type: "native-child-bind-failure"
  parent_session_id: string
  attempt_id: string
  prepare_message_id: string
  prepare_call_id: string
  prepared_agent: string
  prepared_token_sha256: string
  prepared_prompt_sha256: string
  prepared_at: string
  launch_message_id: string
  launch_call_id: string
  launch_completed_at: string
  child_session_id: string
  seal_message_id: string
  seal_call_id: string
  seal_reason: "delegation-attempt-child-bind-failed"
  seal_failed_at: string
}

export interface NativePretoolSafetyEvidenceInput {
  parentSessionId: string
  attemptId: string
  change: string
  phase: "IMPLEMENT" | "VERIFY"
  startedAt: string
}

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value)
}

function messagesFromContext(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return null
  if (Array.isArray(value.data)) return value.data
  if (Array.isArray(value.messages)) return value.messages
  return null
}

function messageParts(message: RecordValue): unknown[] {
  const info = isRecord(message.info) ? message.info : message
  if (Array.isArray(message.content)) return message.content
  if (Array.isArray(message.parts)) return message.parts
  if (Array.isArray(info.content)) return info.content
  return []
}

function textFromState(state: RecordValue): string | null {
  if (!Array.isArray(state.content)) return null
  const texts = state.content.flatMap((item) => {
    if (typeof item === "string") return [item]
    if (!isRecord(item) || typeof item.text !== "string") return []
    return [item.text]
  })
  return texts.length ? texts.join("\n") : null
}

function skipTrivia(source: string, offset: number): number {
  let index = offset
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index + 2)
      index = newline < 0 ? source.length : newline + 1
      continue
    }
    if (source.startsWith("/*", index)) {
      const close = source.indexOf("*/", index + 2)
      if (close < 0) return source.length
      index = close + 2
      continue
    }
    break
  }
  return index
}

function skipQuoted(source: string, offset: number): number {
  const quote = source[offset]
  let index = offset + 1
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2
      continue
    }
    if (source[index] === quote) return index + 1
    if (quote !== "`" && (source[index] === "\n" || source[index] === "\r")) return source.length
    index += 1
  }
  return source.length
}

function identifierAt(source: string, offset: number): { value: string; end: number } | null {
  if (!/[A-Za-z_$]/.test(source[offset] || "")) return null
  let end = offset + 1
  while (end < source.length && /[\w$]/.test(source[end])) end += 1
  return { value: source.slice(offset, end), end }
}

function readStaticString(source: string, offset: number): { value: string; end: number } | null {
  const quote = source[offset]
  if (quote !== "'" && quote !== '"') return null
  let end = offset + 1
  while (end < source.length && source[end] !== quote) {
    if (source[end] === "\\" || source[end] === "\n" || source[end] === "\r") return null
    end += 1
  }
  if (end >= source.length) return null
  return { value: source.slice(offset + 1, end), end: end + 1 }
}

function objectEnd(source: string, open: number): number | null {
  let depth = 0
  for (let index = open; index < source.length;) {
    const next = skipTrivia(source, index)
    if (next !== index) {
      index = next
      continue
    }
    const char = source[index]
    if (char === "'" || char === '"' || char === "`") {
      index = skipQuoted(source, index)
      continue
    }
    if (char === "{") depth += 1
    else if (char === "}" && --depth === 0) return index
    index += 1
  }
  return null
}

function propertyValueEnd(source: string, offset: number, objectClose: number): number | null {
  let braces = 0
  let brackets = 0
  let parentheses = 0
  for (let index = offset; index < objectClose;) {
    const next = skipTrivia(source, index)
    if (next !== index) {
      index = next
      continue
    }
    const char = source[index]
    if (char === "'" || char === '"' || char === "`") {
      index = skipQuoted(source, index)
      continue
    }
    if (char === "{") braces += 1
    else if (char === "}") braces -= 1
    else if (char === "[") brackets += 1
    else if (char === "]") brackets -= 1
    else if (char === "(") parentheses += 1
    else if (char === ")") parentheses -= 1
    else if (char === "," && braces === 0 && brackets === 0 && parentheses === 0) return index
    index += 1
  }
  return objectClose
}

function exactStaticArguments(source: string, open: number, expected: Map<string, string>): boolean {
  const close = objectEnd(source, open)
  if (close === null) return false
  const seen = new Set<string>()
  let index = open + 1
  while (index < close) {
    index = skipTrivia(source, index)
    if (source[index] === "}") break
    if (source[index] === ",") {
      index += 1
      continue
    }
    if (source.startsWith("...", index)) return false
    const key = identifierAt(source, index)
    if (!key) return false
    const colon = skipTrivia(source, key.end)
    if (source[colon] !== ":") {
      if (expected.has(key.value)) return false
      index = key.end
      continue
    }
    const valueStart = skipTrivia(source, colon + 1)
    const valueEnd = propertyValueEnd(source, valueStart, close)
    if (valueEnd === null) return false
    if (expected.has(key.value)) {
      if (seen.has(key.value)) return false
      const literal = readStaticString(source, valueStart)
      if (!literal || skipTrivia(source, literal.end) !== valueEnd || literal.value !== expected.get(key.value)) return false
      seen.add(key.value)
    }
    index = valueEnd + (source[valueEnd] === "," ? 1 : 0)
  }
  return seen.size === expected.size
}

function isReturnedPrepareCall(source: string, callStart: number, objectOpen: number): boolean {
  const close = objectEnd(source, objectOpen)
  if (close === null) return false
  const callClose = skipTrivia(source, close + 1)
  if (source[callClose] !== ")") return false
  let end = skipTrivia(source, callClose + 1)
  if (source[end] === ";") end = skipTrivia(source, end + 1)
  if (end === source.length && /\breturn\s+(?:await\s+)?$/.test(source.slice(0, callStart))) return true

  const assignment = source.slice(0, callStart).match(/(?:^|[;\n])\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/)
  if (!assignment || !/^return\b/.test(source.slice(end))) return false
  const returned = identifierAt(source, skipTrivia(source, end + "return".length))
  if (!returned || returned.value !== assignment[1]) return false
  end = skipTrivia(source, returned.end)
  if (source[end] === ";") end = skipTrivia(source, end + 1)
  return end === source.length
}

function exactSourceToolBinding(code: string, toolName: string, expected: Map<string, string>): boolean {
  let index = 0
  const candidates: boolean[] = []
  while (index < code.length) {
    index = skipTrivia(code, index)
    const char = code[index]
    if (char === "'" || char === '"' || char === "`") {
      index = skipQuoted(code, index)
      continue
    }
    const tokenStart = index
    const token = identifierAt(code, index)
    if (!token) {
      index += 1
      continue
    }
    index = token.end
    if (token.value !== "tools") continue
    let cursor = skipTrivia(code, index)
    let member = ""
    if (code[cursor] === ".") {
      const property = identifierAt(code, skipTrivia(code, cursor + 1))
      if (!property) continue
      member = property.value
      cursor = property.end
    } else if (code[cursor] === "[") {
      const name = readStaticString(code, skipTrivia(code, cursor + 1))
      if (!name) continue
      const bracket = skipTrivia(code, name.end)
      if (code[bracket] !== "]") continue
      member = name.value
      cursor = bracket + 1
    } else {
      continue
    }
    if (member !== toolName) continue
    cursor = skipTrivia(code, cursor)
    if (code[cursor] !== "(") continue
    cursor = skipTrivia(code, cursor + 1)
    if (code[cursor] !== "{") {
      candidates.push(false)
      continue
    }
    candidates.push(exactStaticArguments(code, cursor, expected) && isReturnedPrepareCall(code, tokenStart, cursor))
  }
  return candidates.length === 1 && candidates[0] === true
}

function exactPrepareSourceBinding(code: string, input: NativePretoolSafetyEvidenceInput): boolean {
  return exactSourceToolBinding(code, "odf_delegation_prepare", new Map([
    ["attempt_id", input.attemptId],
    ["change", input.change],
    ["phase", input.phase],
  ]))
}

function exactSealSourceBinding(code: string, token: string, change: string, childSessionId: string): boolean {
  return exactSourceToolBinding(code, "odf_delegation_seal", new Map([
    ["token", token],
    ["change", change],
    ["session_id", childSessionId],
  ]))
}

function exactDirectStringFields(value: unknown, expected: Map<string, string>): boolean {
  if (!isRecord(value)) return false
  return [...expected].every(([key, expectedValue]) => value[key] === expectedValue)
}

function exactDirectBinding(args: unknown, input: NativePretoolSafetyEvidenceInput): boolean {
  if (!isRecord(args)) return false
  return args.attempt_id === input.attemptId && args.change === input.change && args.phase === input.phase
}

function hasChildIdentity(value: RecordValue): boolean {
  return [
    "child_session_id", "childSessionId", "child_id", "childId",
    "session_id", "sessionId", "sessionID",
    "task_session_id", "taskSessionId",
  ]
    .some((key) => typeof value[key] === "string" && (value[key] as string).length > 0)
}

/**
 * Prove that this exact native prepare call was rejected by the host pre-tool
 * safety gate before it returned a delegation token. A prior child of the same
 * parent is irrelevant: the proof is scoped to the attempt_id in the tool
 * invocation and to its terminal pre-tool rejection in the parent transcript.
 * Incomplete, compacted, malformed, or ambiguous history is not evidence.
 */
export function inspectNativePretoolSafetyBlock(
  context: unknown,
  input: NativePretoolSafetyEvidenceInput,
): NativePretoolSafetyEvidence | null {
  if (!safeIdentifier(input.parentSessionId) || !safeIdentifier(input.attemptId) ||
    !safeIdentifier(input.change) || !Number.isFinite(Date.parse(input.startedAt))) return null
  const messages = messagesFromContext(context)
  if (!messages || messages.length === 0 || messages.length > 10_000) return null
  const startedAt = Date.parse(input.startedAt)
  const matches: NativePretoolSafetyEvidence[] = []

  for (const rawMessage of messages) {
    if (!isRecord(rawMessage)) continue
    const info = isRecord(rawMessage.info) ? rawMessage.info : rawMessage
    if (info.type !== "assistant" && info.role !== "assistant") continue
    const messageTime = isRecord(info.time) ? info.time : isRecord(rawMessage.time) ? rawMessage.time : {}
    const createdAt = typeof messageTime.created === "number" ? messageTime.created : Number.NaN
    const completedAt = typeof messageTime.completed === "number"
      ? messageTime.completed
      : typeof messageTime.streamed === "number" ? messageTime.streamed : Number.NaN
    if (!Number.isFinite(createdAt) || !Number.isFinite(completedAt) || createdAt > startedAt || completedAt < startedAt) continue

    for (const rawPart of messageParts(rawMessage)) {
      if (!isRecord(rawPart) || rawPart.type !== "tool" || !isRecord(rawPart.state)) continue
      const state = rawPart.state
      if (state.status !== "completed") continue
      const toolName = typeof rawPart.name === "string" ? rawPart.name : typeof rawPart.tool === "string" ? rawPart.tool : ""
      let bound = false
      let prepareTool: "odf_delegation_prepare" | null = null
      if (toolName === "odf_delegation_prepare") {
        prepareTool = "odf_delegation_prepare"
        bound = exactDirectBinding(state.input, input)
      } else if (toolName === "execute" && isRecord(state.input) && typeof state.input.code === "string") {
        prepareTool = "odf_delegation_prepare"
        bound = exactPrepareSourceBinding(state.input.code, input)
      }
      if (!bound || !prepareTool) continue

      const outputText = textFromState(state)
      if (!outputText) return null
      let output: unknown
      try {
        output = JSON.parse(outputText)
      } catch {
        return null
      }
      if (!isRecord(output) || output.status !== "blocked" || output.reason !== "pre-tool-safety" ||
        output.phase !== input.phase || output.task_api_source !== "subagent" || output.token !== null || output.agent !== null || output.result !== null ||
        !Array.isArray(output.matched_rules) || output.matched_rules.length === 0 || hasChildIdentity(output)) {
        return null
      }
      const matchedRules = output.matched_rules
        .filter((rule): rule is string => typeof rule === "string" && /^[a-z0-9-]{1,64}$/.test(rule))
        .slice(0, 16)
      if (matchedRules.length === 0) return null
      const messageId = safeIdentifier(info.id) ? info.id : safeIdentifier(rawMessage.id) ? rawMessage.id : null
      if (!messageId) return null
      const callId = safeIdentifier(rawPart.id) ? rawPart.id : messageId
      const blockedAt = new Date(completedAt).toISOString()
      matches.push({
        schema_version: 1,
        evidence_type: "native-pretool-safety-block",
        parent_session_id: input.parentSessionId,
        attempt_id: input.attemptId,
        parent_message_id: messageId,
        prepare_call_id: callId,
        prepare_tool: prepareTool,
        blocked_at: blockedAt,
        matched_rules: matchedRules,
      })
    }
  }

  return matches.length === 1 ? matches[0] : null
}

function preparedDelegationToken(state: RecordValue, input: NativePretoolSafetyEvidenceInput): {
  token: string
  agent: string
  prompt: string
} | null {
  const outputText = textFromState(state)
  if (!outputText) return null
  let output: unknown
  try {
    output = JSON.parse(outputText)
  } catch {
    return null
  }
  if (!isRecord(output) || output.status !== "prepared" || output.attempt_id !== input.attemptId ||
    output.change !== input.change || output.phase !== input.phase || !safeIdentifier(output.token) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(output.token) || !safeIdentifier(output.agent)) return null
  const delegation = isRecord(output.delegation) ? output.delegation : null
  if (!delegation || delegation.agent !== output.agent || typeof delegation.prompt !== "string") return null
  const marker = delegation.prompt.match(/^<!-- ODF-DELEGATION (\{[^\r\n]*\}) -->/)
  if (!marker) return null
  let identity: unknown
  try {
    identity = JSON.parse(marker[1])
  } catch {
    return null
  }
  if (!isRecord(identity) || identity.change !== input.change || identity.phase !== input.phase ||
    identity.agent !== output.agent || identity.token !== output.token) return null
  return { token: output.token, agent: output.agent, prompt: delegation.prompt }
}

/**
 * Prove that an exact native prepare succeeded, but the following host
 * subagent tool call was aborted before execution. We require the persisted
 * OpenCode `executed: false` marker, empty tool input, the exact terminal
 * abort envelope, and an unambiguous parent transcript. Any evidence that the
 * tool started, returned a child, or may have launched a child fails closed.
 */
export function inspectNativeSubagentLaunchNotExecuted(
  context: unknown,
  input: NativePretoolSafetyEvidenceInput,
): NativeSubagentLaunchNotExecutedEvidence | null {
  if (!safeIdentifier(input.parentSessionId) || !safeIdentifier(input.attemptId) ||
    !safeIdentifier(input.change) || !Number.isFinite(Date.parse(input.startedAt))) return null
  const messages = messagesFromContext(context)
  if (!messages || messages.length === 0 || messages.length > 10_000) return null
  const startedAt = Date.parse(input.startedAt)
  const prepares: Array<{
    messageIndex: number
    partIndex: number
    messageId: string
    callId: string
    completedAt: number
    tokenSha256: string
  }> = []

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const rawMessage = messages[messageIndex]
    if (!isRecord(rawMessage)) continue
    const info = isRecord(rawMessage.info) ? rawMessage.info : rawMessage
    if (info.type !== "assistant" && info.role !== "assistant") continue
    const messageTime = isRecord(info.time) ? info.time : isRecord(rawMessage.time) ? rawMessage.time : {}
    const createdAt = typeof messageTime.created === "number" ? messageTime.created : Number.NaN
    const completedAt = typeof messageTime.completed === "number"
      ? messageTime.completed
      : typeof messageTime.streamed === "number" ? messageTime.streamed : Number.NaN
    if (!Number.isFinite(createdAt) || !Number.isFinite(completedAt) || createdAt > startedAt || completedAt < startedAt) continue

    const parts = messageParts(rawMessage)
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const rawPart = parts[partIndex]
      if (!isRecord(rawPart) || rawPart.type !== "tool" || !isRecord(rawPart.state) || rawPart.state.status !== "completed") continue
      const toolName = typeof rawPart.name === "string" ? rawPart.name : typeof rawPart.tool === "string" ? rawPart.tool : ""
      const state = rawPart.state
      const bound = toolName === "odf_delegation_prepare"
        ? exactDirectBinding(state.input, input)
        : toolName === "execute" && isRecord(state.input) && typeof state.input.code === "string"
          ? exactPrepareSourceBinding(state.input.code, input)
          : false
      if (!bound) continue
      const prepared = preparedDelegationToken(state, input)
      if (!prepared) return null
      const messageId = safeIdentifier(info.id) ? info.id : safeIdentifier(rawMessage.id) ? rawMessage.id : null
      if (!messageId) return null
      prepares.push({
        messageIndex,
        partIndex,
        messageId,
        callId: safeIdentifier(rawPart.id) ? rawPart.id : messageId,
        completedAt,
        tokenSha256: createHash("sha256").update(prepared.token).digest("hex"),
      })
    }
  }
  if (prepares.length !== 1) return null
  const prepare = prepares[0]
  const launchMatches: Array<{
    messageId: string
    callId: string
    failedAt: number
  }> = []
  let laterSubagentCalls = 0

  for (let messageIndex = prepare.messageIndex; messageIndex < messages.length; messageIndex += 1) {
    const rawMessage = messages[messageIndex]
    if (!isRecord(rawMessage)) continue
    const info = isRecord(rawMessage.info) ? rawMessage.info : rawMessage
    if (info.type !== "assistant" && info.role !== "assistant") continue
    const messageTime = isRecord(info.time) ? info.time : isRecord(rawMessage.time) ? rawMessage.time : {}
    const createdAt = typeof messageTime.created === "number" ? messageTime.created : Number.NaN
    const completedAt = typeof messageTime.completed === "number"
      ? messageTime.completed
      : typeof messageTime.streamed === "number" ? messageTime.streamed : Number.NaN
    const parts = messageParts(rawMessage)
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      if (messageIndex === prepare.messageIndex && partIndex <= prepare.partIndex) continue
      const rawPart = parts[partIndex]
      if (!isRecord(rawPart) || rawPart.type !== "tool") continue
      const toolName = typeof rawPart.name === "string" ? rawPart.name : typeof rawPart.tool === "string" ? rawPart.tool : ""
      if (toolName === "odf_delegation_prepare" ||
        (toolName === "execute" && isRecord(rawPart.state) && isRecord(rawPart.state.input) &&
          typeof rawPart.state.input.code === "string" && rawPart.state.input.code.includes("odf_delegation_prepare"))) return null
      if (toolName !== "subagent") continue
      laterSubagentCalls += 1
      const state = isRecord(rawPart.state) ? rawPart.state : null
      const error = state && isRecord(state.error) ? state.error : null
      const toolInput = state && isRecord(state.input) ? state.input : null
      if (laterSubagentCalls !== 1 || !Number.isFinite(createdAt) || !Number.isFinite(completedAt) ||
        createdAt < prepare.completedAt || completedAt < createdAt || completedAt < startedAt || rawPart.executed !== false ||
        !state || state.status !== "error" || !toolInput || Object.keys(toolInput).length !== 0 ||
        !error || error.type !== "aborted" || error.message !== "Tool execution interrupted" ||
        hasChildIdentity(rawPart) || hasChildIdentity(state) || hasChildIdentity(error) ||
        state.content !== undefined || state.metadata !== undefined) return null
      const messageId = safeIdentifier(info.id) ? info.id : safeIdentifier(rawMessage.id) ? rawMessage.id : null
      if (!messageId) return null
      launchMatches.push({
        messageId,
        callId: safeIdentifier(rawPart.id) ? rawPart.id : messageId,
        failedAt: completedAt,
      })
    }
  }
  if (laterSubagentCalls !== 1 || launchMatches.length !== 1) return null

  const launch = launchMatches[0]
  return {
    schema_version: 1,
    evidence_type: "native-subagent-launch-not-executed",
    parent_session_id: input.parentSessionId,
    attempt_id: input.attemptId,
    prepare_message_id: prepare.messageId,
    prepare_call_id: prepare.callId,
    prepared_token_sha256: prepare.tokenSha256,
    prepared_at: new Date(prepare.completedAt).toISOString(),
    launch_message_id: launch.messageId,
    launch_call_id: launch.callId,
    launch_tool: "subagent",
    launch_error_type: "aborted",
    launch_failed_at: new Date(launch.failedAt).toISOString(),
  }
}

/**
 * Prove that the exact prepared prompt was launched once and its matching seal
 * failed only while persisting the verified child binding. This proves neither
 * the child's result nor BUILD completion; callers must independently recheck
 * child ancestry, prompt digest, and idle state before settling the attempt.
 */
export function inspectNativeChildBindFailure(
  context: unknown,
  input: NativePretoolSafetyEvidenceInput,
  childSessionId: string,
): NativeChildBindFailureEvidence | null {
  if (!safeIdentifier(input.parentSessionId) || !safeIdentifier(input.attemptId) ||
    !safeIdentifier(input.change) || !Number.isFinite(Date.parse(input.startedAt)) ||
    !safeIdentifier(childSessionId) || childSessionId.length > 128) return null
  const messages = messagesFromContext(context)
  if (!messages || messages.length === 0 || messages.length > 10_000) return null
  const startedAt = Date.parse(input.startedAt)
  const prepares: Array<{
    messageIndex: number
    partIndex: number
    messageId: string
    callId: string
    completedAt: number
    token: string
    agent: string
    prompt: string
  }> = []

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const rawMessage = messages[messageIndex]
    if (!isRecord(rawMessage)) continue
    const info = isRecord(rawMessage.info) ? rawMessage.info : rawMessage
    if (info.type !== "assistant" && info.role !== "assistant") continue
    const messageTime = isRecord(info.time) ? info.time : isRecord(rawMessage.time) ? rawMessage.time : {}
    const createdAt = typeof messageTime.created === "number" ? messageTime.created : Number.NaN
    const completedAt = typeof messageTime.completed === "number"
      ? messageTime.completed
      : typeof messageTime.streamed === "number" ? messageTime.streamed : Number.NaN
    if (!Number.isFinite(createdAt) || !Number.isFinite(completedAt) || createdAt > startedAt || completedAt < startedAt) continue

    const parts = messageParts(rawMessage)
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const rawPart = parts[partIndex]
      if (!isRecord(rawPart) || rawPart.type !== "tool" || !isRecord(rawPart.state) || rawPart.state.status !== "completed") continue
      const toolName = typeof rawPart.name === "string" ? rawPart.name : typeof rawPart.tool === "string" ? rawPart.tool : ""
      const state = rawPart.state
      const bound = toolName === "odf_delegation_prepare"
        ? exactDirectBinding(state.input, input)
        : toolName === "execute" && isRecord(state.input) && typeof state.input.code === "string"
          ? exactPrepareSourceBinding(state.input.code, input)
          : false
      if (!bound) continue
      const prepared = preparedDelegationToken(state, input)
      if (!prepared) return null
      const messageId = safeIdentifier(info.id) ? info.id : safeIdentifier(rawMessage.id) ? rawMessage.id : null
      if (!messageId) return null
      prepares.push({
        messageIndex,
        partIndex,
        messageId,
        callId: safeIdentifier(rawPart.id) ? rawPart.id : messageId,
        completedAt,
        ...prepared,
      })
    }
  }
  if (prepares.length !== 1) return null
  const prepare = prepares[0]

  const launches: Array<{
    messageIndex: number
    partIndex: number
    messageId: string
    callId: string
    completedAt: number
  }> = []
  const seals: Array<{
    messageIndex: number
    partIndex: number
    messageId: string
    callId: string
    failedAt: number
  }> = []

  for (let messageIndex = prepare.messageIndex; messageIndex < messages.length; messageIndex += 1) {
    const rawMessage = messages[messageIndex]
    if (!isRecord(rawMessage)) continue
    const info = isRecord(rawMessage.info) ? rawMessage.info : rawMessage
    if (info.type !== "assistant" && info.role !== "assistant") continue
    const messageTime = isRecord(info.time) ? info.time : isRecord(rawMessage.time) ? rawMessage.time : {}
    const createdAt = typeof messageTime.created === "number" ? messageTime.created : Number.NaN
    const completedAt = typeof messageTime.completed === "number"
      ? messageTime.completed
      : typeof messageTime.streamed === "number" ? messageTime.streamed : Number.NaN
    const parts = messageParts(rawMessage)

    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      if (messageIndex === prepare.messageIndex && partIndex <= prepare.partIndex) continue
      const rawPart = parts[partIndex]
      if (!isRecord(rawPart) || rawPart.type !== "tool") continue
      const toolName = typeof rawPart.name === "string" ? rawPart.name : typeof rawPart.tool === "string" ? rawPart.tool : ""
      const state = isRecord(rawPart.state) ? rawPart.state : null
      const stateInput = state && isRecord(state.input) ? state.input : null
      const code = toolName === "execute" && typeof stateInput?.code === "string" ? stateInput.code : null

      if (toolName === "odf_delegation_prepare" || code?.includes("odf_delegation_prepare")) return null

      if (toolName === "subagent") {
        if (!Number.isFinite(createdAt) || !Number.isFinite(completedAt) ||
          createdAt < prepare.completedAt || completedAt < createdAt || completedAt < startedAt ||
          !state || state.status !== "completed" || rawPart.executed === false ||
          stateInput?.agent !== prepare.agent || stateInput.prompt !== prepare.prompt) return null
        const messageId = safeIdentifier(info.id) ? info.id : safeIdentifier(rawMessage.id) ? rawMessage.id : null
        if (!messageId) return null
        launches.push({
          messageIndex,
          partIndex,
          messageId,
          callId: safeIdentifier(rawPart.id) ? rawPart.id : messageId,
          completedAt,
        })
      }

      const isSealCall = toolName === "odf_delegation_seal" || code?.includes("odf_delegation_seal") === true
      if (!isSealCall) continue
      const sealBound = toolName === "odf_delegation_seal"
        ? exactDirectStringFields(state?.input, new Map([
          ["token", prepare.token],
          ["change", input.change],
          ["session_id", childSessionId],
        ]))
        : Boolean(code && exactSealSourceBinding(code, prepare.token, input.change, childSessionId))
      if (!sealBound || !state || state.status !== "completed" || !Number.isFinite(createdAt) ||
        !Number.isFinite(completedAt) || completedAt < createdAt || completedAt < startedAt) return null
      const outputText = textFromState(state)
      if (!outputText) return null
      let output: unknown
      try {
        output = JSON.parse(outputText)
      } catch {
        return null
      }
      if (!isRecord(output) || output.status !== "blocked" || output.reason !== "delegation-attempt-child-bind-failed") return null
      const messageId = safeIdentifier(info.id) ? info.id : safeIdentifier(rawMessage.id) ? rawMessage.id : null
      if (!messageId) return null
      seals.push({
        messageIndex,
        partIndex,
        messageId,
        callId: safeIdentifier(rawPart.id) ? rawPart.id : messageId,
        failedAt: completedAt,
      })
    }
  }

  if (launches.length !== 1 || seals.length !== 1) return null
  const launch = launches[0]
  const seal = seals[0]
  if (seal.messageIndex < launch.messageIndex ||
    seal.messageIndex === launch.messageIndex && seal.partIndex <= launch.partIndex ||
    seal.failedAt < launch.completedAt) return null

  return {
    schema_version: 1,
    evidence_type: "native-child-bind-failure",
    parent_session_id: input.parentSessionId,
    attempt_id: input.attemptId,
    prepare_message_id: prepare.messageId,
    prepare_call_id: prepare.callId,
    prepared_agent: prepare.agent,
    prepared_token_sha256: createHash("sha256").update(prepare.token).digest("hex"),
    prepared_prompt_sha256: createHash("sha256").update(prepare.prompt).digest("hex"),
    prepared_at: new Date(prepare.completedAt).toISOString(),
    launch_message_id: launch.messageId,
    launch_call_id: launch.callId,
    launch_completed_at: new Date(launch.completedAt).toISOString(),
    child_session_id: childSessionId,
    seal_message_id: seal.messageId,
    seal_call_id: seal.callId,
    seal_reason: "delegation-attempt-child-bind-failed",
    seal_failed_at: new Date(seal.failedAt).toISOString(),
  }
}
