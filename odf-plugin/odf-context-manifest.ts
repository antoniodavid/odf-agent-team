/** Bounded, reference-only Context Manifest. No filesystem or workflow access. */

import { createHash } from "node:crypto"
import { tool } from "@opencode-ai/plugin"

export const CONTEXT_MANIFEST_VERSION = 1 as const
export const CONTEXT_MANIFEST_LIMITS = {
  string: 256,
  dependencies: 32,
  references: 64,
  roots: 4,
  authority: 64,
  missing: 32,
} as const

export type ContextStatus = "available" | "missing" | "unsafe" | "unavailable"

export interface ContextManifestInput {
  project?: unknown
  odoo_version?: unknown
  module?: unknown
  domain?: unknown
  dependencies?: unknown
  references?: { files?: unknown; symbols?: unknown; tests?: unknown } | unknown
  source_roots?: unknown
  authority_evidence_refs?: unknown
  missing_facts?: unknown
  candidate_digest?: unknown
  codegraph?: { status?: unknown; reference?: unknown } | unknown
}

export interface ContextManifest {
  version: 1
  project: string | null
  odoo_version: number | null
  module: string | null
  domain: string | null
  dependencies: string[]
  references: { files: string[]; symbols: string[]; tests: string[] }
  source_roots: string[]
  source_roots_status: ContextStatus
  authority_evidence_refs: string[]
  authority_status: ContextStatus
  missing_facts: string[]
  candidate_digest: string | null
  codegraph: { status: ContextStatus; reference: string | null }
  manifest_digest: string
}

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/
const SAFE_SCALAR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const HEX64 = /^[0-9a-f]{64}$/i

function safeValue(value: unknown, pattern: RegExp, max = CONTEXT_MANIFEST_LIMITS.string): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= max && !/[\0\r\n]/.test(normalized) && pattern.test(normalized)
    ? normalized
    : null
}

function safeReference(value: unknown): string | null {
  const ref = safeValue(value, SAFE_TOKEN)
  if (!ref || ref.split(/[\\/]/).some(part => part === ".." || part === ".") || ref.includes("//") || /^[A-Za-z][A-Za-z0-9+.-]*:[\\/]/.test(ref)) return null
  return ref
}

function list(value: unknown, limit: number, pathLike = false): { values: string[]; invalid: boolean } {
  if (value === undefined) return { values: [], invalid: false }
  if (!Array.isArray(value)) return { values: [], invalid: true }
  const bounded = value.slice(0, limit)
  const accepted = bounded.map(item => pathLike ? safeReference(item) : safeValue(item, SAFE_TOKEN)).filter((item): item is string => item !== null)
  const values = [...new Set(accepted)]
  return { values: values.sort(), invalid: value.length > limit || values.length !== bounded.length }
}

function rootList(value: unknown): { values: string[]; status: ContextStatus } {
  if (value === undefined || value === null) return { values: [], status: "missing" }
  if (!Array.isArray(value) || value.length === 0 || value.length > CONTEXT_MANIFEST_LIMITS.roots) return { values: [], status: "unsafe" }
  const values = value.map(safeReference)
  if (values.some(value => value === null)) return { values: [], status: "unsafe" }
  const unique = [...new Set(values as string[])]
  return unique.length === values.length
    ? { values: unique.sort(), status: "available" }
    : { values: [], status: "unsafe" }
}

function canonicalPayload(manifest: ContextManifest | Omit<ContextManifest, "manifest_digest">): Omit<ContextManifest, "manifest_digest"> {
  return {
    version: CONTEXT_MANIFEST_VERSION,
    project: manifest.project,
    odoo_version: manifest.odoo_version,
    module: manifest.module,
    domain: manifest.domain,
    dependencies: [...manifest.dependencies].sort(),
    references: {
      files: [...manifest.references.files].sort(),
      symbols: [...manifest.references.symbols].sort(),
      tests: [...manifest.references.tests].sort(),
    },
    source_roots: [...manifest.source_roots].sort(),
    source_roots_status: manifest.source_roots_status,
    authority_evidence_refs: [...manifest.authority_evidence_refs].sort(),
    authority_status: manifest.authority_status,
    missing_facts: [...manifest.missing_facts].sort(),
    candidate_digest: manifest.candidate_digest,
    codegraph: { status: manifest.codegraph.status, reference: manifest.codegraph.reference },
  }
}

export function computeContextManifestDigest(manifest: ContextManifest | Omit<ContextManifest, "manifest_digest">): string {
  return createHash("sha256").update(JSON.stringify(canonicalPayload(manifest))).digest("hex")
}

export function buildContextManifest(input: ContextManifestInput = {}): ContextManifest {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const missing = new Set<string>()
  const scalar = (key: string, pattern = SAFE_SCALAR): string | null => {
    const value = safeValue(raw[key], pattern)
    if (!value) missing.add(key.replace(/_/g, "-"))
    return value
  }
  const project = scalar("project")
  const moduleName = scalar("module")
  const domain = scalar("domain")
  const odooVersion = Number.isInteger(raw.odoo_version) && (raw.odoo_version as number) > 0 && (raw.odoo_version as number) < 100
    ? raw.odoo_version as number
    : (missing.add("odoo-version"), null)

  const dependencies = list(raw.dependencies, CONTEXT_MANIFEST_LIMITS.dependencies)
  if (dependencies.invalid) missing.add("dependencies")
  const referencesValue = raw.references
  const referencesRaw = referencesValue && typeof referencesValue === "object" && !Array.isArray(referencesValue)
    ? referencesValue as Record<string, unknown>
    : {}
  if (referencesValue !== undefined && (!referencesValue || typeof referencesValue !== "object" || Array.isArray(referencesValue))) missing.add("references")
  const references = {
    files: list(referencesRaw.files, CONTEXT_MANIFEST_LIMITS.references, true),
    symbols: list(referencesRaw.symbols, CONTEXT_MANIFEST_LIMITS.references),
    tests: list(referencesRaw.tests, CONTEXT_MANIFEST_LIMITS.references, true),
  }
  if (references.files.invalid || references.symbols.invalid || references.tests.invalid) missing.add("references")
  if (!references.files.values.length && !references.symbols.values.length && !references.tests.values.length) missing.add("relevant-references")

  const roots = rootList(raw.source_roots)
  if (roots.status !== "available") missing.add(`source-roots:${roots.status}`)
  const authority = list(raw.authority_evidence_refs, CONTEXT_MANIFEST_LIMITS.authority, true)
  if (authority.invalid) missing.add("authority-evidence")
  const authorityStatus: ContextStatus = authority.invalid || roots.status === "unsafe"
    ? "unsafe"
    : authority.values.length && roots.status === "available" ? "available" : "missing"
  if (authorityStatus !== "available") missing.add(`authority-evidence:${authorityStatus}`)

  const candidateDigest = typeof raw.candidate_digest === "string" && HEX64.test(raw.candidate_digest.trim())
    ? raw.candidate_digest.trim().toLowerCase()
    : (missing.add("candidate-digest"), null)

  const codegraphValue = raw.codegraph
  const rawCodeGraph = codegraphValue && typeof codegraphValue === "object" && !Array.isArray(codegraphValue)
    ? codegraphValue as Record<string, unknown>
    : null
  const requestedStatus = rawCodeGraph?.status
  const codegraphReference = rawCodeGraph ? safeReference(rawCodeGraph.reference) : null
  const invalidCodegraph = codegraphValue !== undefined && rawCodeGraph === null
  let codegraph: ContextManifest["codegraph"]
  if (codegraphValue === undefined) codegraph = { status: "missing", reference: null }
  else if (invalidCodegraph || (rawCodeGraph !== null && rawCodeGraph.reference !== undefined && !codegraphReference)) codegraph = { status: "unsafe", reference: null }
  else if (requestedStatus === "available" || requestedStatus === "indexed") {
    codegraph = codegraphReference ? { status: "available", reference: codegraphReference } : { status: "unsafe", reference: null }
  } else if (requestedStatus === "unavailable" || requestedStatus === "missing") {
    codegraph = { status: requestedStatus, reference: codegraphReference }
  } else codegraph = { status: "unsafe", reference: null }
  if (codegraph.status !== "available") missing.add(`codegraph:${codegraph.status}`)

  const missingFacts = list(raw.missing_facts, CONTEXT_MANIFEST_LIMITS.missing, true)
  if (missingFacts.invalid) missing.add("missing-facts")
  const generatedMissing = [...missing].sort()
  const explicitMissing = missingFacts.values.filter(value => !missing.has(value))

  const base: Omit<ContextManifest, "manifest_digest"> = {
    version: CONTEXT_MANIFEST_VERSION,
    project,
    odoo_version: odooVersion,
    module: moduleName,
    domain,
    dependencies: dependencies.values,
    references: { files: references.files.values, symbols: references.symbols.values, tests: references.tests.values },
    source_roots: roots.values,
    source_roots_status: roots.status,
    authority_evidence_refs: authority.values,
    authority_status: authorityStatus,
    missing_facts: [...new Set(generatedMissing.concat(explicitMissing))].slice(0, CONTEXT_MANIFEST_LIMITS.missing),
    candidate_digest: candidateDigest,
    codegraph,
  }
  return { ...base, manifest_digest: computeContextManifestDigest(base) }
}

export function createODFContextManifest(): ReturnType<typeof tool> {
  return tool({
    description: "Build a bounded, read-only, reference-only Context Manifest from explicit inputs. No prompts, source contents, filesystem access, persistence, workflow state, or CodeGraph execution.",
    args: {
      project: tool.schema.string().optional(),
      odoo_version: tool.schema.number().optional(),
      module: tool.schema.string().optional(),
      domain: tool.schema.string().optional(),
      dependencies: tool.schema.array(tool.schema.string()).optional(),
      references: tool.schema.object({
        files: tool.schema.array(tool.schema.string()).optional(),
        symbols: tool.schema.array(tool.schema.string()).optional(),
        tests: tool.schema.array(tool.schema.string()).optional(),
      }).optional(),
      source_roots: tool.schema.array(tool.schema.string()).optional(),
      authority_evidence_refs: tool.schema.array(tool.schema.string()).optional(),
      missing_facts: tool.schema.array(tool.schema.string()).optional(),
      candidate_digest: tool.schema.string().optional(),
      codegraph: tool.schema.object({
        status: tool.schema.enum(["available", "indexed", "missing", "unavailable"]),
        reference: tool.schema.string().optional(),
      }).optional(),
    },
    async execute(args: ContextManifestInput): Promise<string> {
      return JSON.stringify(buildContextManifest(args), null, 2)
    },
  })
}
