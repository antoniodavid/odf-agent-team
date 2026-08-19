import { parseDocument } from "yaml"
import { normalizeArtifactKey, type WorkflowArtifacts, type WorkflowArtifact } from "./odf-workflow-status.js"

export type ExpectationsStatus = "approved" | "missing" | "invalid" | "tampered"

export interface ExpectationsVerdict {
  status: ExpectationsStatus
  ids: string[]
}

interface ExpectationsDocument {
  change?: unknown
  intent?: unknown
  expectations?: unknown
  approved?: unknown
  approved_by?: unknown
  approved_at?: unknown
  immutable_since?: unknown
}

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
      .map((entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>).id : null)
      .filter((id): id is string => typeof id === "string")
    : []
}

function validDocument(document: ExpectationsDocument | null, change: string): boolean {
  if (!document || document.change !== change || typeof document.intent !== "string" || !document.intent.trim()) return false
  const entries = document.expectations
  return Array.isArray(entries) && entries.length > 0 && entries.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
    const item = entry as Record<string, unknown>
    return typeof item.id === "string" && /^EXP-\d+$/.test(item.id) &&
      typeof item.statement === "string" && item.statement.trim() &&
      typeof item.testable === "boolean" && item.owned_by === "human"
  }) && new Set(expectationIds(document)).size === entries.length &&
    document.approved === true && typeof document.approved_by === "string" && document.approved_by.trim() !== "" &&
    validDate(document.approved_at) && validDate(document.immutable_since)
}

function protectedExpectations(document: ExpectationsDocument | null): string {
  return JSON.stringify(document?.expectations || [])
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
