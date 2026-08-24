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
export function buildCandidateManifest(workspaceDir: string): CandidateManifest {
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
    if (!p || isOdfState(p, telemetryDir)) return
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
