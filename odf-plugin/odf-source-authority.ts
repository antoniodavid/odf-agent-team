import * as fsSync from "node:fs"
import * as path from "node:path"
import { authorityLookup, type AuthorityLookupResult } from "../scripts/odf-toolkit.js"

const MAX_FILE_LENGTH = 256
const MAX_SNIPPET_LENGTH = 160
const MAX_XMLID_LENGTH = 160
const MAX_ROOT_LENGTH = 4096

export interface SourceAuthorityEvidence {
  file: string
  line: number
  snippet: string
}

interface LookupEvidence extends SourceAuthorityEvidence {
  xmlid?: string
  name?: string
  target_xmlid?: string
}

export interface SourceAuthorityActionEnvelope {
  ok: true
  verified: true
  action_xmlid: string
  relation: string
  target_xmlid: string
  evidence: {
    action: SourceAuthorityEvidence
    relation: SourceAuthorityEvidence
    target: SourceAuthorityEvidence
  }
}

export interface SourceAuthorityViewEnvelope {
  ok: true
  verified: true
  view_xmlid: string
  relation: "inherit_id"
  target_xmlid: string
  evidence: {
    view: SourceAuthorityEvidence
    relation: SourceAuthorityEvidence
    target: SourceAuthorityEvidence
  }
}

export type SourceAuthorityEnvelope = SourceAuthorityActionEnvelope | SourceAuthorityViewEnvelope

export interface SourceAuthorityRoots {
  source: string
  repos?: string
}

export interface SourceAuthorityValidation {
  ok: boolean
  reason?: string
  envelope?: SourceAuthorityEnvelope
}

function safeText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\0\r\n]/.test(value)
}

function safeRelativeFile(value: unknown): value is string {
  return safeText(value, MAX_FILE_LENGTH) && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..")
}

function safeEvidence(value: unknown): value is SourceAuthorityEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const evidence = value as Record<string, unknown>
  return safeRelativeFile(evidence.file) &&
    Number.isInteger(evidence.line) && (evidence.line as number) > 0 && (evidence.line as number) <= 1_000_000 &&
    safeText(evidence.snippet, MAX_SNIPPET_LENGTH)
}

function evidenceMatches(actual: unknown, expected: SourceAuthorityEvidence): boolean {
  if (!safeEvidence(actual)) return false
  const value = actual as unknown as Record<string, unknown>
  return value.file === expected.file && value.line === expected.line && value.snippet === expected.snippet
}

function lookupEvidence(value: unknown): LookupEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const evidence = value as Record<string, unknown>
  return safeEvidence(evidence) ? evidence as LookupEvidence : null
}

function canonicalEnvelope(result: AuthorityLookupResult, kind: "view"): SourceAuthorityViewEnvelope | null
function canonicalEnvelope(result: AuthorityLookupResult, kind: "action"): SourceAuthorityActionEnvelope | null
function canonicalEnvelope(result: AuthorityLookupResult, kind: "action" | "view"): SourceAuthorityEnvelope | null {
  const source = lookupEvidence(kind === "view" ? result.view : result.action)
  const relation = lookupEvidence(result.relation)
  const target = lookupEvidence(result.target)
  if (!result.ok || !source?.xmlid || !relation?.name || !relation.target_xmlid || !target?.xmlid) return null
  const sourceEvidence = { file: source.file, line: source.line, snippet: source.snippet }
  const relationEvidence = { file: relation.file, line: relation.line, snippet: relation.snippet }
  const targetEvidence = { file: target.file, line: target.line, snippet: target.snippet }
  if (kind === "view") {
    return {
      ok: true,
      verified: true,
      view_xmlid: source.xmlid,
      relation: "inherit_id",
      target_xmlid: target.xmlid,
      evidence: { view: sourceEvidence, relation: relationEvidence, target: targetEvidence },
    }
  }
  return {
    ok: true,
    verified: true,
    action_xmlid: source.xmlid,
    relation: relation.name,
    target_xmlid: target.xmlid,
    evidence: { action: sourceEvidence, relation: relationEvidence, target: targetEvidence },
  }
}

function resolveRoot(workspaceRoot: string, value: unknown, label: string): { root: string | null; reason?: string } {
  if (typeof value !== "string" || !value.trim()) return { root: null, reason: `source authority unavailable: missing ${label}` }
  const raw = value.trim()
  if (raw.length > MAX_ROOT_LENGTH || /[\0\r\n]/.test(raw)) {
    return { root: null, reason: `source authority unavailable: invalid ${label}` }
  }
  const candidate = path.isAbsolute(raw) ? raw : path.resolve(workspaceRoot, raw)
  try {
    const resolved = fsSync.realpathSync(candidate)
    if (!fsSync.statSync(resolved).isDirectory()) return { root: null, reason: `source authority unavailable: ${label} is not a directory` }
    return { root: resolved }
  } catch {
    return { root: null, reason: `source authority unavailable: cannot read ${label}` }
  }
}

export function establishSourceAuthorityRoots(opts: {
  workspaceRoot: string
  sourceRoot?: string
  reposRoot?: string
}): { ok: true; roots: SourceAuthorityRoots } | { ok: false; reason: string } {
  const source = resolveRoot(opts.workspaceRoot, opts.sourceRoot, "odoo_source_root")
  if (!source.root) return { ok: false, reason: source.reason! }
  if (opts.reposRoot === undefined) return { ok: true, roots: { source: source.root } }
  const repos = resolveRoot(opts.workspaceRoot, opts.reposRoot, "odoo_source_repos")
  if (!repos.root) return { ok: false, reason: repos.reason! }
  return { ok: true, roots: { source: source.root, repos: repos.root } }
}

function authorityHints(text: string): { action: string | null; relation: string | null; target: string | null } {
  const ids = [...text.matchAll(/\b([A-Za-z_][\w-]*)\.([A-Za-z_][\w-]*)\b/g)]
  const actionIds = [...new Set(ids.map(match => `${match[1]}.${match[2]}`).filter(value => value.split(".")[1].startsWith("action_")))]
  const targetIds = [...new Set(ids.map(match => `${match[1]}.${match[2]}`).filter(value => value.split(".")[1].startsWith("view_")))]
  const relations = [...text.matchAll(/\b(search_view_id|inherit_id)\b/gi)].map(match => match[1].toLowerCase())
  return {
    action: actionIds.length === 1 ? actionIds[0] : null,
    relation: [...new Set(relations)].length === 1 ? [...new Set(relations)][0] : null,
    target: actionIds.length === 1 && targetIds.length === 1 ? targetIds[0] : null,
  }
}

export function isViewAuthorityWork(phase: string, task: string, contextFiles: string[] = []): boolean {
  if (phase !== "DESIGN" && phase !== "IMPLEMENT") return false
  const text = `${task}\n${contextFiles.join("\n")}`
  return /\bview\s+inheritance\b/i.test(text) ||
    /\binherit[_-]id\b/i.test(text) ||
    /\bsearch[_-]view[_-]id\b/i.test(text) ||
    /\b(?:action|view)[\s_-]+xml[\s_-]*id\b/i.test(text)
}

export function validateSourceAuthority(opts: {
  result: unknown
  task: string
  contextFiles?: string[]
  roots: SourceAuthorityRoots
}): SourceAuthorityValidation {
  const rawResult = opts.result && typeof opts.result === "object" && !Array.isArray(opts.result)
    ? opts.result as Record<string, unknown>
    : null
  const raw = rawResult?.source_authority
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "source authority evidence is missing or malformed" }
  }
  const envelope = raw as Record<string, unknown>
  const rawActionXmlid = envelope.action_xmlid
  const rawViewXmlid = envelope.view_xmlid
  const rawRelation = envelope.relation
  const rawTargetXmlid = envelope.target_xmlid
  const actionXmlid = safeText(rawActionXmlid, MAX_XMLID_LENGTH) ? rawActionXmlid : null
  const viewXmlid = safeText(rawViewXmlid, MAX_XMLID_LENGTH) ? rawViewXmlid : null
  const relation = safeText(rawRelation, MAX_XMLID_LENGTH) ? rawRelation : null
  const targetXmlid = safeText(rawTargetXmlid, MAX_XMLID_LENGTH) ? rawTargetXmlid : null
  if (envelope.ok !== true || envelope.verified !== true || Boolean(actionXmlid) === Boolean(viewXmlid) || !relation || !targetXmlid) {
    return { ok: false, reason: "source authority evidence is malformed or must declare ok: true and verified: true" }
  }
  const evidence = envelope.evidence
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { ok: false, reason: "source authority evidence must include source, relation, and target file-line evidence" }
  }
  const evidenceRecord = evidence as Record<string, unknown>
  const hints = authorityHints(`${opts.task}\n${opts.contextFiles?.join("\n") || ""}`)
  if (hints.relation && relation.toLowerCase() !== hints.relation) return { ok: false, reason: "source authority relation does not match the task" }
  if (viewXmlid) {
    if (relation !== "inherit_id" || !safeEvidence(evidenceRecord.view) ||
      !safeEvidence(evidenceRecord.relation) || !safeEvidence(evidenceRecord.target)) {
      return { ok: false, reason: "source authority evidence must include view, relation, and target file-line evidence" }
    }
    const lookup = authorityLookup({
      source: opts.roots.source,
      repos: opts.roots.repos,
      view: viewXmlid,
      relation: "inherit_id",
    })
    const expected = canonicalEnvelope(lookup, "view")
    if (!expected) return { ok: false, reason: `source authority lookup failed: ${lookup.reason || "unproven relation"}` }
    if (viewXmlid !== expected.view_xmlid || relation !== expected.relation || targetXmlid !== expected.target_xmlid) {
      return { ok: false, reason: "source authority evidence does not match the deterministic view relation" }
    }
    if (!evidenceMatches(evidenceRecord.view, expected.evidence.view) ||
      !evidenceMatches(evidenceRecord.relation, expected.evidence.relation) ||
      !evidenceMatches(evidenceRecord.target, expected.evidence.target)) {
      return { ok: false, reason: "source authority file-line evidence does not match the deterministic lookup" }
    }
    return { ok: true, envelope: expected }
  }

  if (!safeEvidence(evidenceRecord.action) || !safeEvidence(evidenceRecord.relation) || !safeEvidence(evidenceRecord.target)) {
    return { ok: false, reason: "source authority evidence contains malformed or unbounded file-line evidence" }
  }
  if (!actionXmlid) return { ok: false, reason: "source authority action XML ID is missing" }
  if (hints.action && actionXmlid !== hints.action) return { ok: false, reason: "source authority action XML ID does not match the task" }
  if (hints.target && targetXmlid !== hints.target) return { ok: false, reason: "source authority target XML ID does not match the task" }

  const lookup = authorityLookup({
    source: opts.roots.source,
    repos: opts.roots.repos,
    action: actionXmlid,
    relation,
  })
  const expected = canonicalEnvelope(lookup, "action")
  if (!expected) return { ok: false, reason: `source authority lookup failed: ${lookup.reason || "unproven relation"}` }
  if (actionXmlid !== expected.action_xmlid || relation !== expected.relation || targetXmlid !== expected.target_xmlid) {
    return { ok: false, reason: "source authority evidence does not match the deterministic action relation" }
  }
  if (!evidenceMatches(evidenceRecord.action, expected.evidence.action) ||
    !evidenceMatches(evidenceRecord.relation, expected.evidence.relation) ||
    !evidenceMatches(evidenceRecord.target, expected.evidence.target)) {
    return { ok: false, reason: "source authority file-line evidence does not match the deterministic lookup" }
  }
  return { ok: true, envelope: expected }
}

function scrubEvidence(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const evidence = value as Record<string, unknown>
  return {
    ...(safeRelativeFile(evidence.file) ? { file: evidence.file } : {}),
    ...(Number.isInteger(evidence.line) && (evidence.line as number) > 0 && (evidence.line as number) <= 1_000_000 ? { line: evidence.line } : {}),
    ...(safeText(evidence.snippet, MAX_SNIPPET_LENGTH) ? { snippet: evidence.snippet } : {}),
  }
}

export function scrubSourceAuthority(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, verified: false }
  const authority = value as Record<string, unknown>
  const evidence = authority.evidence && typeof authority.evidence === "object" && !Array.isArray(authority.evidence)
    ? authority.evidence as Record<string, unknown>
    : {}
  return {
    ok: authority.ok === true,
    verified: authority.verified === true,
    ...(safeText(authority.action_xmlid, MAX_XMLID_LENGTH) ? { action_xmlid: authority.action_xmlid } : {}),
    ...(safeText(authority.view_xmlid, MAX_XMLID_LENGTH) ? { view_xmlid: authority.view_xmlid } : {}),
    ...(safeText(authority.relation, MAX_XMLID_LENGTH) ? { relation: authority.relation } : {}),
    ...(safeText(authority.target_xmlid, MAX_XMLID_LENGTH) ? { target_xmlid: authority.target_xmlid } : {}),
    evidence: {
      action: scrubEvidence(evidence.action),
      view: scrubEvidence(evidence.view),
      relation: scrubEvidence(evidence.relation),
      target: scrubEvidence(evidence.target),
    },
  }
}

export function replaceSourceAuthority(result: unknown, authority: SourceAuthorityEnvelope | Record<string, unknown>): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result
  return { ...(result as Record<string, unknown>), source_authority: authority }
}
