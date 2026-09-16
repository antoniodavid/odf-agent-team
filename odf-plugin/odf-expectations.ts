import { parseDocument } from "yaml"
import { normalizeArtifactKey, type WorkflowArtifacts, type WorkflowArtifact } from "./odf-workflow-status.js"

export type ExpectationsStatus = "approved" | "missing" | "invalid" | "tampered"

export interface ExpectationsVerdict {
  status: ExpectationsStatus
  ids: string[]
}

export interface ExpectationsEntry {
  id: string
  statement: string
  testable: boolean
  owned_by: "human"
}

export interface ExpectationsConnection {
  id: string
  relation: string
  reference: string
}

export interface ExpectationsDocument {
  change?: string
  intent?: string
  expectations?: ExpectationsEntry[]
  approved?: boolean
  approved_by?: string
  approved_at?: string
  immutable_since?: string
  /** Revision metadata (optional for compatibility): versioned supersession. */
  revision?: number
  supersedes?: string
  replan_from?: string
  constraints?: string[]
  success_scenarios?: ExpectationsEntry[]
  failure_scenarios?: ExpectationsEntry[]
  connections?: ExpectationsConnection[]
}

export const EXPECTATIONS_MAX_AUX_ENTRIES = 32
export const EXPECTATIONS_MAX_TEXT_LENGTH = 512
export const EXPECTATIONS_MAX_REFERENCE_LENGTH = 256

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/
const SCENARIO_ID_PATTERNS = {
  success: /^SUC-[0-9]{1,3}$/,
  failure: /^FAL-[0-9]{1,3}$/,
  connection: /^CON-[0-9]{1,3}$/,
} as const

export interface ExpectationsValidationInput {
  change: string
  artifacts: WorkflowArtifacts
  approvedArtifact?: WorkflowArtifacts
}

function artifactEntries(artifacts: WorkflowArtifacts): Array<{ key: string; content: unknown }> {
  if (Array.isArray(artifacts)) {
    return artifacts.map((artifact) => ({
      key: typeof artifact === "object" && artifact !== null && !Array.isArray(artifact) ? artifact.key || "" : "",
      content: typeof artifact === "string" ? artifact : artifact && typeof artifact === "object" && "content" in artifact ? artifact.content : artifact,
    }))
  }
  return Object.entries(artifacts).map(([key, artifact]) => ({
    key,
    content: typeof artifact === "string" ? artifact : artifact && typeof artifact === "object" && "content" in artifact ? artifact.content : artifact,
  }))
}

function parseArtifact(content: unknown): ExpectationsDocument | null {
  if (content && typeof content === "object" && !Array.isArray(content)) return content as ExpectationsDocument
  if (typeof content !== "string") return null
  try {
    const value = parseDocument(content).toJSON()
    return value && typeof value === "object" && !Array.isArray(value) ? value as ExpectationsDocument : null
  } catch {
    return null
  }
}

function findArtifact(artifacts: WorkflowArtifacts): ExpectationsDocument | null {
  const entry = artifactEntries(artifacts).find(({ key }) => normalizeArtifactKey(key).type === "expectations")
  return entry ? parseArtifact(entry.content) : null
}

export function validDate(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function expectationIds(document: ExpectationsDocument | null): string[] {
  return Array.isArray(document?.expectations)
    ? document.expectations
      .map((entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as unknown as Record<string, unknown>).id : null)
      .filter((id): id is string => typeof id === "string")
    : []
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function safeHumanText(value: unknown, maxLength = EXPECTATIONS_MAX_TEXT_LENGTH): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength &&
    value.trim() === value && !CONTROL_CHARACTERS.test(value)
}

function validConstraints(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length > EXPECTATIONS_MAX_AUX_ENTRIES) return false
  const normalized = value.map((item) => typeof item === "string" ? item.trim() : item)
  return value.every((item) => safeHumanText(item)) && new Set(normalized).size === value.length
}

function validScenarioEntries(value: unknown, idPattern: RegExp): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length > EXPECTATIONS_MAX_AUX_ENTRIES) return false
  const ids: string[] = []
  const valid = value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
    const item = entry as unknown as Record<string, unknown>
    if (!exactKeys(item, ["id", "statement", "testable", "owned_by"]) ||
      typeof item.id !== "string" || !idPattern.test(item.id) ||
      !safeHumanText(item.statement) || typeof item.testable !== "boolean" || item.owned_by !== "human") {
      return false
    }
    ids.push(item.id)
    return true
  })
  return valid && new Set(ids).size === ids.length
}

function safeReference(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= EXPECTATIONS_MAX_REFERENCE_LENGTH &&
    value.trim() === value && !value.includes("..") && /^[A-Za-z0-9][A-Za-z0-9._:/#?=&+%@-]*$/.test(value)
}

function validConnections(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length > EXPECTATIONS_MAX_AUX_ENTRIES) return false
  const ids: string[] = []
  const valid = value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
    const item = entry as unknown as Record<string, unknown>
    if (!exactKeys(item, ["id", "relation", "reference"]) ||
      typeof item.id !== "string" || !SCENARIO_ID_PATTERNS.connection.test(item.id) ||
      typeof item.relation !== "string" || item.relation.length > 32 ||
      !/^[a-z][a-z0-9-]*$/.test(item.relation) || !safeReference(item.reference)) {
      return false
    }
    ids.push(item.id)
    return true
  })
  return valid && new Set(ids).size === ids.length
}

function validDocument(document: ExpectationsDocument | null, change: string): boolean {
  if (!document || document.change !== change || typeof document.intent !== "string" || !document.intent.trim()) return false
  const entries = document.expectations
  return Array.isArray(entries) && entries.length > 0 && entries.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
    const item = entry as unknown as Record<string, unknown>
    return typeof item.id === "string" && /^EXP-\d+$/.test(item.id) &&
      typeof item.statement === "string" && item.statement.trim() &&
      typeof item.testable === "boolean" && item.owned_by === "human"
  }) && new Set(expectationIds(document)).size === entries.length &&
    document.approved === true && typeof document.approved_by === "string" && document.approved_by.trim() !== "" &&
    validDate(document.approved_at) && validDate(document.immutable_since) &&
    (document.revision === undefined || (typeof document.revision === "number" && Number.isInteger(document.revision) && document.revision >= 1)) &&
    (document.supersedes === undefined || typeof document.supersedes === "string") &&
    (document.replan_from === undefined || typeof document.replan_from === "string") &&
    validConstraints(document.constraints) &&
    validScenarioEntries(document.success_scenarios, SCENARIO_ID_PATTERNS.success) &&
    validScenarioEntries(document.failure_scenarios, SCENARIO_ID_PATTERNS.failure) &&
    validConnections(document.connections)
}

function protectedExpectations(document: ExpectationsDocument | null): string {
  return JSON.stringify({
    change: document?.change,
    intent: document?.intent,
    expectations: document?.expectations,
    constraints: document?.constraints,
    success_scenarios: document?.success_scenarios,
    failure_scenarios: document?.failure_scenarios,
    connections: document?.connections,
  })
}

/** Pure contract gate; the next caller is VERIFY, not this work unit. */
export function validateExpectations({ change, artifacts, approvedArtifact }: ExpectationsValidationInput): ExpectationsVerdict {
  const document = findArtifact(artifacts)
  if (!document) return { status: "missing", ids: [] }
  const ids = expectationIds(document)
  if (document.approved !== true) return { status: "invalid", ids }
  if (approvedArtifact && protectedExpectations(document) !== protectedExpectations(findArtifact(approvedArtifact))) {
    return { status: "tampered", ids }
  }
  return validDocument(document, change) ? { status: "approved", ids } : { status: "tampered", ids }
}
