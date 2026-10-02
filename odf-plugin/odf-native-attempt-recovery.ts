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

function exactPrepareArguments(source: string, open: number, input: NativePretoolSafetyEvidenceInput): boolean {
  const close = objectEnd(source, open)
  if (close === null) return false
  const expected = new Map<string, string>([
    ["attempt_id", input.attemptId],
    ["change", input.change],
    ["phase", input.phase],
  ])
  const seen = new Set<string>()
  let index = open + 1
  while (index < close) {
    index = skipTrivia(source, index)
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

function isReturnedDirectPrepareCall(source: string, callStart: number, objectOpen: number): boolean {
  if (!/\breturn\s+(?:await\s+)?$/.test(source.slice(0, callStart))) return false
  const close = objectEnd(source, objectOpen)
  if (close === null) return false
  const callClose = skipTrivia(source, close + 1)
  if (source[callClose] !== ")") return false
  let end = skipTrivia(source, callClose + 1)
  if (source[end] === ";") end = skipTrivia(source, end + 1)
  return end === source.length
}

function exactSourceBinding(code: string, input: NativePretoolSafetyEvidenceInput): boolean {
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
    if (member !== "odf_delegation_prepare") continue
    cursor = skipTrivia(code, cursor)
    if (code[cursor] !== "(") continue
    cursor = skipTrivia(code, cursor + 1)
    if (code[cursor] !== "{") {
      candidates.push(false)
      continue
    }
    candidates.push(exactPrepareArguments(code, cursor, input) && isReturnedDirectPrepareCall(code, tokenStart, cursor))
  }
  return candidates.length === 1 && candidates[0] === true
}

function exactDirectBinding(args: unknown, input: NativePretoolSafetyEvidenceInput): boolean {
  if (!isRecord(args)) return false
  return args.attempt_id === input.attemptId && args.change === input.change && args.phase === input.phase
}

function hasChildIdentity(value: RecordValue): boolean {
  return ["child_session_id", "session_id", "sessionID", "task_session_id", "taskSessionId"]
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
        bound = exactSourceBinding(state.input.code, input)
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
