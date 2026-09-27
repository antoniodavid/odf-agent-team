/**
 * Shared deterministic helpers for the ODF delegation engine: safe paths,
 * registry path resolution, and the registry type model. Extracted from
 * plugins/odf-delegation.ts to keep the entrypoint navigable.
 */

import * as fsSync from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { sanitizeChangeName } from "../scripts/lib/preflight.js"
import { resolveOdfConfigDir } from "../scripts/lib/config-dir.js"

export const CHANGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

// CONFIGURATION / SAFE PATHS
// ==========================================

/**
 * Return the ODF configuration directory (the pack root).
 *
 * Delegates to the shared resolver — `ODF_CONFIG_DIR` (absolute) → the pack this
 * module ships in (when it carries a registry) → `$XDG_CONFIG_HOME/opencode` →
 * `~/.config/opencode`. The resolved path is always absolute.
 *
 * The middle step is what makes a global install work under XDG and a
 * project-local `<project>/.opencode` work without the launcher exporting
 * `ODF_CONFIG_DIR`; both used to fall through to `~/.config/opencode`.
 */
export function getOdfConfigDir(): string {
  const { dir, ignored } = resolveOdfConfigDir(process.env)
  if (ignored) {
    console.warn(`[odf-delegation] ODF_CONFIG_DIR "${ignored}" is not absolute; falling back to default.`)
  }
  return dir
}

export function isWithinRoot(candidate: string, root: string): boolean {
  const normalizedRoot = path.normalize(root)
  const normalizedCandidate = path.normalize(candidate)
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep)
  )
}

export function resolveWorkspaceRoot(cwd = process.cwd()): string {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (root) return path.normalize(root)
  } catch {
    // Fall back for non-Git workspaces.
  }
  return path.normalize(path.resolve(cwd))
}

export function canonicalWorkspaceRoot(cwd = process.cwd()): string {
  return fsSync.realpathSync(resolveWorkspaceRoot(cwd))
}

// Debug logging: silent by default; enable with ODF_DEBUG=1 to restore the
// informational [odf-delegation] lines (warnings always print).
export const ODF_DEBUG = process.env.ODF_DEBUG === "1" || process.env.ODF_DEBUG === "true"
export function debugLog(...args: unknown[]): void {
  if (ODF_DEBUG) console.log("[odf-delegation]", ...args)
}

/**
 * Resolve the Engram project identity for a workspace. Engram (CLI and server)
 * derives the project from the git remote basename; fall back to the git
 * toplevel basename, then the directory basename for non-Git workspaces.
 */
export function workspaceProjectName(workspaceRoot: string): string {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (remote) {
      const base = remote.replace(/\.git$/, "").split(/[/:]/).pop()
      if (base) return base
    }
  } catch {
    // Fall through to the toplevel/directory basename.
  }
  try {
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (gitRoot) return path.basename(path.normalize(gitRoot))
  } catch {
    // Fall back for non-Git workspaces.
  }
  return path.basename(path.normalize(workspaceRoot))
}


export function resolvePath(registryDir: string, entryPath: string): string {
  if (typeof entryPath !== "string" || !entryPath) return ""
  if (entryPath.split(/[\\/]/).includes("..")) return ""

  const allowedRoots = [path.normalize(registryDir), getOdfConfigDir()]

  let resolved: string
  if (path.isAbsolute(entryPath)) {
    resolved = path.normalize(entryPath)
  } else if (entryPath.startsWith("~/")) {
    resolved = path.normalize(path.join(os.homedir(), entryPath.slice(2)))
  } else {
    resolved = path.resolve(registryDir, entryPath)
  }

  if (!allowedRoots.some(root => isWithinRoot(resolved, root))) {
    return ""
  }

  if (fsSync.existsSync(resolved)) {
    try {
      if (!fsSync.statSync(resolved).isFile()) return ""
      if (!allowedRoots.some(root => isWithinRoot(fsSync.realpathSync(resolved), root))) return ""
    } catch {
      return ""
    }
  }

  return resolved
}


export interface ODFSkill {
  name: string
  title: string
  category: string
  triggers: string[]
  compact_rules: string
  path: string
  odoo_versions: number[]
  sdd_phase: string | null
}

export interface ODFAgent {
  name: string
  mode: string
  description: string
  phases: string[]
  routing_triggers?: string[]
  model: string | null
  path: string
  installed: boolean
}

export interface ODFProfile {
  phase: string
  model: string
  temperature: number
  reasoning?: boolean
  description: string
}

export interface ODFPackage {
  name: string
  version: string
  description: string
  repository: string
  dependencies: Record<string, string>
}

export interface ODFCommand {
  name: string
  description: string
  path: string
  triggers?: string[]
}

export interface ODFCapability {
  name: string
  type: 'capability' | 'agent'
  description?: string
  path: string
}

export interface ODFCommunityTool {
  name: string
  title: string
  package_name: string
  command_name: string
  repo_url: string
  description: string
  installed: boolean
}

export interface ODFRegistry {
  version: number
  last_updated: string
  skills: ODFSkill[]
  agents: ODFAgent[]
  profiles?: ODFProfile[]
  notebooklm_sources?: Record<string, string>
  package?: ODFPackage
  commands?: ODFCommand[]
  capabilities?: ODFCapability[]
  community_tools?: ODFCommunityTool[]
  flags?: Record<string, boolean | string | number>
}

export const ODF_REGISTERED_TOOLS = [
  "odf_delegate",
  "odf_parallel_delegate",
  "odf_workflow_route",
  "odf_workflow_advance",
  "odf_workflow_override",
  "odf_workflow_bind",
  "odf_entry_triage",
  "odf_context_manifest",
  "odf_skill_inject",
  "odf_registry_read",
  "odf_notebooklm_lookup",
  "odf_profile_select",
  "odf_skill_resolve",
  "odf_community_tool_detect",
  "odf_community_tool_install",
  "odf_status",
  "odf_workflow_status",
  "odf_policy_gate",
  "odf_receipt",
  "odf_health",
  "odf_governance_provenance",
  "odf_governance_check",
] as const

export type OpencodeClient = ReturnType<typeof createOpencodeClient>
export interface ODFEntryAuthorization {
  nonce: string
  sessionID: string
  messageID: string
  generation: number
  changeName: string
  workspaceRoot: string
  claimed: boolean
}
export type ODFEntryAuthorizations = Map<string, ODFEntryAuthorization>
export type ODFEntryGenerations = Map<string, number>

export function canonicalChangeName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : ""
  return CHANGE_NAME_PATTERN.test(raw) ? sanitizeChangeName(raw) : ""
}
