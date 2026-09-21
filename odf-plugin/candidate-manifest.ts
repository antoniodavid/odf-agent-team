/**
 * candidate-manifest
 * Canonical candidate manifest + reproducible digest for the policy gate.
 *
 * A candidate is the worktree delta relative to HEAD: every tracked change
 * (staged and unstaged), every untracked file, plus the base HEAD itself.
 * `git status --porcelain=v1 -z` is the source of truth (NUL-separated, so
 * paths with spaces/unicode survive). No file contents are copied out — only
 * sha256 hashes, so generated evidence stays bounded.
 */

import * as fsSync from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { getOdfConfigDir } from "./odf-delegation-shared.js"

export interface CandidateEntry {
  path: string
  status: string
  mode: number | null
  sha256: string | null
}

export interface CandidateManifest {
  base_head: string | null
  entries: CandidateEntry[]
}

const MAX_EXTERNAL_VALIDATION_SCOPE_PATHS = 64
const MAX_EXTERNAL_VALIDATION_SCOPE_PATH_LENGTH = 512

export interface ExternalValidationScopeResult {
  paths?: string[]
  error?: string
}

export interface ExternalValidationSubjectManifestEntry {
  path: string
  mode: number
  sha256: string
}

export interface ExternalValidationSubjectResult {
  paths?: string[]
  manifest?: ExternalValidationSubjectManifestEntry[]
  error?: string
}

const MAX_EXTERNAL_VALIDATION_SUBJECT_FILES = 256
const MAX_EXTERNAL_VALIDATION_SUBJECT_BYTES = 16 * 1024 * 1024
const SHA256_PATTERN = /^[0-9a-f]{64}$/

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function isSymlinkSafeWithinWorkspace(workspaceDir: string, relativePath: string): boolean {
  let realRoot: string
  try {
    realRoot = fsSync.realpathSync(workspaceDir)
  } catch {
    return false
  }

  let current = path.resolve(workspaceDir, relativePath)
  while (true) {
    try {
      return isWithinRoot(fsSync.realpathSync(current), realRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false
      const parent = path.dirname(current)
      if (parent === current) return false
      current = parent
    }
  }
}

/** Validate and canonicalize an optional per-change external candidate scope. */
export function normalizeExternalValidationScope(
  workspaceDir: string,
  requested: unknown,
): ExternalValidationScopeResult {
  if (requested === undefined) return {}
  if (!Array.isArray(requested) || requested.length === 0) {
    return { error: "external-validation scope must be a non-empty array" }
  }
  if (requested.length > MAX_EXTERNAL_VALIDATION_SCOPE_PATHS) {
    return { error: `external-validation scope may contain at most ${MAX_EXTERNAL_VALIDATION_SCOPE_PATHS} paths` }
  }

  const workspaceRoot = path.resolve(workspaceDir)
  const paths = new Set<string>()
  for (const value of requested) {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_EXTERNAL_VALIDATION_SCOPE_PATH_LENGTH) {
      return { error: "external-validation scope paths must be non-empty strings of at most 512 characters" }
    }
    if (/[\x00\r\n]/.test(value) || path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
      return { error: `external-validation scope path is not relative: ${value}` }
    }

    const slashPath = value.replaceAll("\\", "/")
    const components = slashPath.split("/")
    if (components.some(component => component === "..")) {
      return { error: `external-validation scope path contains traversal: ${value}` }
    }
    const normalized = components.filter(component => component !== "" && component !== ".").join("/")
    if (!normalized) return { error: "external-validation scope path must identify a workspace path" }

    const absolute = path.resolve(workspaceRoot, normalized)
    if (!isWithinRoot(absolute, workspaceRoot) || !isSymlinkSafeWithinWorkspace(workspaceRoot, normalized)) {
      return { error: `external-validation scope path escapes the workspace: ${value}` }
    }
    paths.add(normalized)
  }

  return { paths: [...paths].sort() }
}

/** Expand, validate, and hash explicitly declared external validation subjects. */
export function captureExternalValidationSubjectManifest(
  workspaceDir: string,
  requested: unknown,
): ExternalValidationSubjectResult {
  if (requested === undefined) return {}
  const normalized = normalizeExternalValidationScope(workspaceDir, requested)
  if (normalized.error || !normalized.paths) return { error: normalized.error || "external-validation subjects are invalid" }

  const workspaceRoot = path.resolve(workspaceDir)
  const files = new Map<string, string>()
  const visit = (relativePath: string): string | null => {
    const absolutePath = path.resolve(workspaceRoot, relativePath)
    let stat: fsSync.Stats
    try {
      stat = fsSync.lstatSync(absolutePath)
    } catch {
      return `external-validation subject is missing or unreadable: ${relativePath}`
    }
    if (stat.isSymbolicLink()) return `external-validation subject must not be a symlink: ${relativePath}`
    if (stat.isFile()) {
      if (files.has(relativePath)) return null
      if (files.size >= MAX_EXTERNAL_VALIDATION_SUBJECT_FILES) {
        return `external-validation subjects may contain at most ${MAX_EXTERNAL_VALIDATION_SUBJECT_FILES} files`
      }
      files.set(relativePath, absolutePath)
      return null
    }
    if (!stat.isDirectory()) return `external-validation subject is not a file or directory: ${relativePath}`

    let entries: fsSync.Dirent[]
    try {
      entries = fsSync.readdirSync(absolutePath, { withFileTypes: true })
    } catch {
      return `external-validation subject is missing or unreadable: ${relativePath}`
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const child = path.posix.join(relativePath, entry.name)
      const error = visit(child)
      if (error) return error
    }
    return null
  }

  for (const relativePath of normalized.paths) {
    const error = visit(relativePath)
    if (error) return { error }
  }

  let totalBytes = 0
  const manifest: ExternalValidationSubjectManifestEntry[] = []
  for (const relativePath of [...files.keys()].sort()) {
    const absolutePath = files.get(relativePath)!
    try {
      const content = fsSync.readFileSync(absolutePath)
      totalBytes += content.byteLength
      if (totalBytes > MAX_EXTERNAL_VALIDATION_SUBJECT_BYTES) {
        return { error: `external-validation subjects may contain at most ${MAX_EXTERNAL_VALIDATION_SUBJECT_BYTES} bytes` }
      }
      const stat = fsSync.statSync(absolutePath)
      if (!stat.isFile()) return { error: `external-validation subject is missing or unreadable: ${relativePath}` }
      manifest.push({
        path: relativePath,
        mode: stat.mode & 0o777,
        sha256: createHash("sha256").update(content).digest("hex"),
      })
    } catch {
      return { error: `external-validation subject is missing or unreadable: ${relativePath}` }
    }
  }

  return { paths: normalized.paths, manifest }
}

/** Normalize the structural shape of a persisted subject manifest before comparison. */
export function normalizeExternalValidationSubjectManifest(
  requested: unknown,
): { manifest?: ExternalValidationSubjectManifestEntry[]; error?: string } {
  if (!Array.isArray(requested) || requested.length > MAX_EXTERNAL_VALIDATION_SUBJECT_FILES) {
    return { error: "external-validation subject manifest must be a bounded array" }
  }

  const manifest: ExternalValidationSubjectManifestEntry[] = []
  const paths = new Set<string>()
  for (const value of requested) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { error: "external-validation subject manifest entries must be objects" }
    }
    const entry = value as Record<string, unknown>
    if (Object.keys(entry).sort().join(",") !== "mode,path,sha256") {
      return { error: "external-validation subject manifest entry has unexpected fields" }
    }
    if (typeof entry.path !== "string" || entry.path.length === 0 || /[\x00\r\n]/.test(entry.path) ||
      path.isAbsolute(entry.path) || path.posix.isAbsolute(entry.path) || path.win32.isAbsolute(entry.path)) {
      return { error: "external-validation subject manifest path is not relative" }
    }
    const normalizedPath = entry.path.replaceAll("\\", "/")
    if (normalizedPath.split("/").some(component => component === "..")) {
      return { error: "external-validation subject manifest path contains traversal" }
    }
    const canonicalPath = normalizedPath.split("/").filter(component => component !== "" && component !== ".").join("/")
    if (!canonicalPath || paths.has(canonicalPath)) {
      return { error: "external-validation subject manifest contains duplicate or empty paths" }
    }
    if (typeof entry.mode !== "number" || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 ||
      typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)) {
      return { error: "external-validation subject manifest entry is malformed" }
    }
    paths.add(canonicalPath)
    manifest.push({ path: canonicalPath, mode: entry.mode, sha256: entry.sha256 })
  }

  manifest.sort((left, right) => left.path.localeCompare(right.path))
  return { manifest }
}

function pathMatchesScope(candidatePath: string, scope: string[]): boolean {
  const normalized = candidatePath.split(path.sep).join("/")
  return scope.some(root => normalized === root || normalized.startsWith(`${root}/`))
}

function fileIdentity(absPath: string): { mode: number | null; sha256: string | null } {
  try {
    const stat = fsSync.statSync(absPath)
    if (!stat.isFile()) return { mode: null, sha256: null }
    return {
      mode: stat.mode & 0o777,
      sha256: createHash("sha256").update(fsSync.readFileSync(absPath)).digest("hex"),
    }
  } catch {
    return { mode: null, sha256: null }
  }
}

const ODF_STATE_DIR = ".odf"

// ODF persists its own state under .odf/ and durable telemetry under
// the configured metrics directory. Those files are harness bookkeeping, not
// candidate content, and would otherwise invalidate the digest on every save.
function configuredTelemetryDir(workspaceDir: string): string | null {
  const workspaceRoot = path.resolve(workspaceDir)
  const metricsDir = path.resolve(getOdfConfigDir(), "metrics")
  const relative = path.relative(workspaceRoot, metricsDir)
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) return null
  return relative.split(path.sep).join("/")
}

function isOdfState(p: string, telemetryDir: string | null): boolean {
  const normalized = p.split(path.sep).join("/")
  return normalized === ODF_STATE_DIR || normalized.startsWith(ODF_STATE_DIR + "/") ||
    telemetryDir !== null && (normalized === telemetryDir || normalized.startsWith(telemetryDir + "/"))
}

/**
 * Combined status: concatenate the staged (X) and unstaged (Y) chars from
 * porcelain v1 and drop spaces, e.g. " M" → "M", "MM" → "MM", "R " → "R".
 */
function combinedStatus(xy: string): string {
  return (xy[0] + xy[1]).replace(/ /g, "")
}

/**
 * Build the deterministic candidate manifest for a workspace.
 * Returns `{ base_head: null, entries: [] }` when Git is unavailable.
 */
export function buildCandidateManifest(workspaceDir: string, externalValidationScope?: readonly string[]): CandidateManifest {
  const scopeResult = normalizeExternalValidationScope(workspaceDir, externalValidationScope)
  if (scopeResult.error) throw new TypeError(scopeResult.error)
  const scope = scopeResult.paths
  let baseHead: string
  let statusOut: string
  try {
    baseHead =
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: workspaceDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
    // --untracked-files=all lists every untracked file instead of collapsing
    // directories, so each candidate path is its own entry.
    statusOut = execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: workspaceDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
  } catch {
    return { base_head: null, entries: [] }
  }

  const byPath = new Map<string, CandidateEntry>()
  const telemetryDir = configuredTelemetryDir(workspaceDir)
  const put = (p: string, status: string, readFile: boolean) => {
    if (!p || isOdfState(p, telemetryDir) || scope && !pathMatchesScope(p, scope)) return
    if (scope && !isSymlinkSafeWithinWorkspace(workspaceDir, p)) return
    const abs = path.resolve(workspaceDir, p)
    const identity = readFile ? fileIdentity(abs) : { mode: null, sha256: null }
    const existing = byPath.get(p)
    if (existing) {
      for (const ch of status) {
        if (!existing.status.includes(ch)) existing.status += ch
      }
      if (existing.mode === null && identity.mode !== null) existing.mode = identity.mode
      if (existing.sha256 === null && identity.sha256 !== null) existing.sha256 = identity.sha256
      return
    }
    byPath.set(p, { path: p, status, mode: identity.mode, sha256: identity.sha256 })
  }

  const fields = statusOut.split("\0")
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    if (!f) continue
    const xy = f.slice(0, 2)
    const firstPath = f.slice(3)
    if (xy[0] === "R" || xy[0] === "C") {
      // Rename/copy record: "<XY> <dest>\0<source>\0". Dest exists in the
      // worktree; the source no longer does, so it is a synthetic delete.
      const source = fields[++i] ?? ""
      put(firstPath, combinedStatus(xy), true)
      put(source, "D", false)
    } else {
      put(firstPath, combinedStatus(xy), true)
    }
  }

  const entries = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { base_head: baseHead || null, entries }
}

/**
 * sha256 hex of the canonical serialization of the manifest: compact JSON with
 * ordered keys and entries sorted by path. An empty candidate (base_head
 * present, no entries) still hashes to a stable, explicit digest.
 */
export function computeCandidateDigest(manifest: CandidateManifest): string {
  const entries = [...manifest.entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const canonical = JSON.stringify({
    base_head: manifest.base_head,
    entries: entries.map((e) => ({ path: e.path, status: e.status, mode: e.mode, sha256: e.sha256 })),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

/** Paths of every candidate entry (including untracked), for risk classification. */
export function extractChangedPaths(manifest: CandidateManifest): string[] {
  return manifest.entries.map((e) => e.path)
}
