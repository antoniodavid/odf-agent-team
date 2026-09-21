/**
 * Policy Gate (slice 1): deterministic risk-tier classification and the
 * authoritative TDD/policy decision for IMPLEMENT/VERIFY. Extracted from
 * plugins/odf-delegation.ts.
 */

import * as fsSync from "node:fs"
import * as path from "node:path"
import { execFileSync, execSync } from "node:child_process"
import {
  buildCandidateManifest,
  captureExternalValidationSubjectManifest,
  computeCandidateDigest,
  extractChangedPaths,
  normalizeExternalValidationScope,
} from "./candidate-manifest.js"
import { debugLog, resolveWorkspaceRoot, type ODFRegistry } from "./odf-delegation-shared.js"

// POLICY GATE (slice 1)
// ==========================================

export interface PolicyGateDecision {
  change: string
  phase: "IMPLEMENT" | "VERIFY"
  gate: "allow" | "block"
  reason: string
  tdd: {
    global: boolean
    local_readable: boolean
    local_off: boolean
    effective: "on" | "off"
  }
  risk_tier: "LOW" | "MEDIUM" | "HIGH"
  frozen_diff_ref: string | null
  candidate_digest: string | null
  base_head: string | null
  changed_lines: number | null
  correction_budget_lines: number | null
  changed_paths: string[]
  external_validation_scope?: string[]
  external_validation_subjects?: string[]
  resolved_at: string
}

/**
 * Classify the risk tier of a change from its changed paths.
 * HIGH: security files, CSV access rules, ir.model.access.
 * LOW: passive byte-proven files (views/data XML, docs, po, demo yml, manifest).
 * Everything else (models, controllers, raw Python) → MEDIUM.
 */
export function classifyRiskTier(changedPaths: string[]): "LOW" | "MEDIUM" | "HIGH" {
  // ponytail: filename-first tier, escalate-only content scan in classifyRiskTierWithContent
  const HIGH_PATTERNS = [
    /security\//i,
    /ir\.model\.access/i,
    /\.csv$/i,
    /groups=/i,
    /_security/i,
  ]
  const LOW_PATTERNS = [
    /views\/[^/]+\.xml$/i,
    /data\/[^/]+\.xml$/i,
    /\.ya?ml$/i,
    /\.md$/i,
    /\.po$/i,
    /\.pot$/i,
    /__manifest__\.py$/i,
  ]

  for (const p of changedPaths) {
    if (HIGH_PATTERNS.some(rx => rx.test(p))) return "HIGH"
  }
  if (changedPaths.length === 0) return "MEDIUM"
  return changedPaths.every(p => LOW_PATTERNS.some(rx => rx.test(p))) ? "LOW" : "MEDIUM"
}

/**
 * Content-aware tier escalation (slice 5). Filename-only classification misses
 * security signals inside otherwise innocent-looking files (raw SQL with
 * interpolation, eval, subprocess, record rules). This scan can ONLY escalate
 * to HIGH — never downgrade — and reads at most MAX bytes per changed file,
 * skipping unreadable or missing ones.
 */
export const HIGH_CONTENT_PATTERNS = [
  /env\.cr\s*\.\s*execute|cr\s*\.\s*execute\s*\(/i, // raw SQL
  /\beval\s*\(/i, // eval()
  /\bexec\s*\(/i, // exec()
  /subprocess\s*\.|os\.system\s*\(|shell\s*=\s*True/i, // shell escape
  /model\s*=\s*["']ir\.(?:rule|model\.access)["']/i, // security record in XML
  /groups\s*=\s*["'][^"']*["']/i, // group assignment in data/views
]
export const HIGH_CONTENT_MAX_BYTES = 64 * 1024

export function classifyRiskTierWithContent(changedPaths: string[], workspaceDir: string): "LOW" | "MEDIUM" | "HIGH" {
  const byName = classifyRiskTier(changedPaths)
  if (byName === "HIGH") return "HIGH"

  for (const p of changedPaths) {
    let fd: number | null = null
    try {
      const abs = path.resolve(workspaceDir, p)
      fd = fsSync.openSync(abs, "r")
      const buf = Buffer.alloc(HIGH_CONTENT_MAX_BYTES)
      const bytes = fsSync.readSync(fd, buf, 0, HIGH_CONTENT_MAX_BYTES, 0)
      const content = buf.subarray(0, bytes).toString("utf8")
      if (HIGH_CONTENT_PATTERNS.some(rx => rx.test(content))) return "HIGH"
    } catch {
      // Unreadable or missing file — skip; filename tier stands.
    } finally {
      if (fd !== null) {
        try { fsSync.closeSync(fd) } catch { /* best-effort */ }
      }
    }
  }
  return byName
}

export function gitHead(workspaceDir: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null
  } catch {
    return null
  }
}

/**
 * Effective TDD = global `flags.strict_tdd` (registry) AND absence of the
 * local marker `<worktree>/.odf/tdd.off`. Any off → effective OFF; an
 * unreadable local source (anything but ENOENT) → fail-closed OFF.
 */
export function resolveTddEffective(
  registry: ODFRegistry,
  workspaceDir: string
): { global: boolean; local_readable: boolean; local_off: boolean; effective: "on" | "off" } {
  const global = registry.flags?.strict_tdd === true
  const marker = path.join(workspaceDir, ".odf", "tdd.off")
  let localReadable = false
  let localOff = false
  try {
    fsSync.readFileSync(marker, "utf8")
    localOff = true
    localReadable = true
  } catch (err) {
    localOff = false
    localReadable = (err as NodeJS.ErrnoException).code === "ENOENT"
  }
  const effective = global && localReadable && !localOff ? "on" : "off"
  return { global, local_readable: localReadable, local_off: localOff, effective }
}

export function savePolicyGateJson(workspaceDir: string, decision: PolicyGateDecision): void {
  try {
    const dir = path.join(workspaceDir, ".odf")
    fsSync.mkdirSync(dir, { recursive: true })
    fsSync.writeFileSync(
      path.join(dir, `policy-gate-${decision.change}.json`),
      JSON.stringify(decision, null, 2),
      "utf8"
    )
  } catch (err) {
    console.warn(`[odf-delegation] Failed to persist policy gate for ${decision.change}: ${err}`)
  }
}

export function readPersistedExternalValidationScope(
  workspaceDir: string,
  change: string,
): { paths?: string[]; invalid: boolean } {
  const gatePath = path.join(workspaceDir, ".odf", `policy-gate-${change}.json`)
  try {
    fsSync.lstatSync(gatePath)
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? { invalid: false } : { invalid: true }
  }

  try {
    const raw = JSON.parse(fsSync.readFileSync(gatePath, "utf8")) as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(raw, "external_validation_scope")) return { invalid: false }
    const result = normalizeExternalValidationScope(workspaceDir, raw.external_validation_scope)
    return result.error ? { invalid: true } : { paths: result.paths, invalid: false }
  } catch {
    return { invalid: true }
  }
}

export function readPersistedExternalValidationSubjects(
  workspaceDir: string,
  change: string,
): { paths?: string[]; invalid: boolean } {
  const gatePath = path.join(workspaceDir, ".odf", `policy-gate-${change}.json`)
  try {
    fsSync.lstatSync(gatePath)
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? { invalid: false } : { invalid: true }
  }

  try {
    const raw = JSON.parse(fsSync.readFileSync(gatePath, "utf8")) as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(raw, "external_validation_subjects")) return { invalid: false }
    const result = captureExternalValidationSubjectManifest(workspaceDir, raw.external_validation_subjects)
    return result.error ? { invalid: true } : { paths: result.paths, invalid: false }
  } catch {
    return { invalid: true }
  }
}

// ponytail: cap untracked reads at 1 MiB; oversized files fail closed instead of guessing.
const MAX_SCOPED_UNTRACKED_LINE_COUNT_BYTES = 1024 * 1024

function countScopedUntrackedLines(workspaceDir: string, relativePath: string): number | null {
  try {
    const absolutePath = path.resolve(workspaceDir, relativePath)
    const stat = fsSync.statSync(absolutePath)
    if (!stat.isFile() || stat.size > MAX_SCOPED_UNTRACKED_LINE_COUNT_BYTES) return null
    const content = fsSync.readFileSync(absolutePath, "utf8")
    if (content.length === 0) return 0
    const lines = content.split(/\r\n|\n|\r/)
    return lines.at(-1) === "" ? lines.length - 1 : lines.length
  } catch {
    return null
  }
}

function resolveReadableWorkspaceRoot(workspaceDir: string | undefined): string | null {
  const requested = workspaceDir === undefined ? process.cwd() : workspaceDir.trim()
  if (!requested) return null
  try {
    const selected = path.resolve(requested)
    const selectedStat = fsSync.statSync(selected)
    if (!selectedStat.isDirectory()) return null
    fsSync.accessSync(selected, fsSync.constants.R_OK | fsSync.constants.X_OK)
    const workspace = fsSync.realpathSync(resolveWorkspaceRoot(selected))
    const workspaceStat = fsSync.statSync(workspace)
    if (!workspaceStat.isDirectory()) return null
    fsSync.accessSync(workspace, fsSync.constants.R_OK | fsSync.constants.X_OK)
    return workspace
  } catch {
    return null
  }
}

function blockedWorkspaceDecision(opts: {
  change: string
  phase: "IMPLEMENT" | "VERIFY"
  registry: ODFRegistry
}): PolicyGateDecision {
  return {
    change: opts.change || "",
    phase: opts.phase,
    gate: "block",
    reason: "unsafe-workspace-path — selected workspace root is blank, missing, or unreadable",
    tdd: { global: opts.registry.flags?.strict_tdd === true, local_readable: false, local_off: false, effective: "off" },
    risk_tier: "MEDIUM",
    frozen_diff_ref: null,
    candidate_digest: null,
    base_head: null,
    changed_lines: null,
    correction_budget_lines: null,
    changed_paths: [],
    resolved_at: new Date().toISOString(),
  }
}

/**
 * Resolve and persist the Policy Gate for a change before IMPLEMENT/VERIFY.
 * Resolves effective TDD and, for VERIFY, freezes the diff ref, counts changed
 * lines, classifies the risk tier, and computes the correction budget.
 *
 * The gate DOCUMENTS the decision — it does not analyze code. `gate` stays
 * "allow" except for hard conditions (missing change name). Idempotent: reuses
 * a persisted decision with the same phase + frozen diff ref (no re-freeze).
 */
export function computePolicyGate(opts: {
  change: string
  phase: "IMPLEMENT" | "VERIFY"
  workspaceDir?: string
  registry: ODFRegistry
  externalValidationScope?: readonly string[]
  externalValidationSubjects?: readonly string[]
}): PolicyGateDecision {
  const workspace = resolveReadableWorkspaceRoot(opts.workspaceDir)
  if (!workspace) return blockedWorkspaceDecision(opts)
  const tdd = resolveTddEffective(opts.registry, workspace)

  if (!opts.change || !opts.change.trim()) {
    return {
      change: opts.change || "",
      phase: opts.phase,
      gate: "block",
      reason: "missing change name — cannot persist a policy gate",
      tdd,
      risk_tier: "MEDIUM",
      frozen_diff_ref: null,
      candidate_digest: null,
      base_head: null,
      changed_lines: null,
      correction_budget_lines: null,
      changed_paths: [],
      resolved_at: new Date().toISOString(),
    }
  }

  const scopeResult = normalizeExternalValidationScope(workspace, opts.externalValidationScope)
  if (scopeResult.error) {
    return {
      change: opts.change,
      phase: opts.phase,
      gate: "block",
      reason: `invalid external-validation scope — ${scopeResult.error}`,
      tdd,
      risk_tier: "MEDIUM",
      frozen_diff_ref: null,
      candidate_digest: null,
      base_head: null,
      changed_lines: null,
      correction_budget_lines: null,
      changed_paths: [],
      resolved_at: new Date().toISOString(),
    }
  }
  const externalValidationScope = scopeResult.paths
  const subjectResult = captureExternalValidationSubjectManifest(workspace, opts.externalValidationSubjects)
  if (subjectResult.error) {
    return {
      change: opts.change,
      phase: opts.phase,
      gate: "block",
      reason: `invalid external-validation subjects — ${subjectResult.error}`,
      tdd,
      risk_tier: "MEDIUM",
      frozen_diff_ref: null,
      candidate_digest: null,
      base_head: null,
      changed_lines: null,
      correction_budget_lines: null,
      changed_paths: [],
      resolved_at: new Date().toISOString(),
    }
  }
  const externalValidationSubjects = subjectResult.paths

  const gatePath = path.join(workspace, ".odf", `policy-gate-${opts.change}.json`)
  const manifest = buildCandidateManifest(workspace, externalValidationScope)
  const head = manifest.base_head

  const persistedSubjects = readPersistedExternalValidationSubjects(workspace, opts.change)
  if (persistedSubjects.invalid) {
    return {
      change: opts.change,
      phase: opts.phase,
      gate: "block",
      reason: "invalid persisted external-validation subjects — policy gate must be repaired before reuse",
      tdd,
      risk_tier: "MEDIUM",
      frozen_diff_ref: null,
      candidate_digest: null,
      base_head: null,
      changed_lines: null,
      correction_budget_lines: null,
      changed_paths: [],
      resolved_at: new Date().toISOString(),
    }
  }

  // Idempotency: reuse a frozen decision for the same change + phase only when
  // the candidate bytes are unchanged (digest match), not merely when HEAD is.
  try {
    const existing = JSON.parse(fsSync.readFileSync(gatePath, "utf8")) as PolicyGateDecision
    if (
      existing.phase === opts.phase &&
      head !== null &&
      existing.candidate_digest != null &&
      existing.candidate_digest === computeCandidateDigest(manifest) &&
      (() => {
        const persistedScope = normalizeExternalValidationScope(workspace, existing.external_validation_scope)
        return !persistedScope.error && JSON.stringify(persistedScope.paths) === JSON.stringify(externalValidationScope)
      })() &&
      JSON.stringify(persistedSubjects.paths) === JSON.stringify(externalValidationSubjects)
    ) {
      return existing
    }
  } catch {
    // No prior gate, stale, or unreadable → recompute.
  }

  let frozenDiffRef: string | null = null
  let candidateDigest: string | null = null
  let baseHead: string | null = null
  let changedLines: number | null = null
  let changedPaths: string[] = []
  let riskTier: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM"
  let correctionBudget: number | null = null

  if (opts.phase === "VERIFY") {
    frozenDiffRef = head
    baseHead = head
    if (head !== null) {
      candidateDigest = computeCandidateDigest(manifest)
      try {
        const numstat = externalValidationScope
          ? execFileSync("git", ["diff", "--numstat", "HEAD", "--", ...externalValidationScope], {
            cwd: workspace,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).toString().trim()
          : execSync("git diff --numstat HEAD", { cwd: workspace, encoding: "utf8" }).toString().trim()
        changedLines = numstat
          .split("\n")
          .filter(Boolean)
          .reduce((sum: number, line: string) => {
            const [add, del] = line.split("\t")
            const a = parseInt(add, 10)
            const d = parseInt(del, 10)
            return sum + (Number.isFinite(a) ? a : 0) + (Number.isFinite(d) ? d : 0)
          }, 0)
        if (externalValidationScope) {
          for (const entry of manifest.entries) {
            if (entry.status !== "??") continue
            const lines = countScopedUntrackedLines(workspace, entry.path)
            if (lines === null) {
              changedLines = null
              break
            }
            changedLines += lines
          }
        }
      } catch {
        changedLines = null
      }
      changedPaths = extractChangedPaths(manifest)
      riskTier = classifyRiskTierWithContent(changedPaths, workspace)
      correctionBudget = changedLines != null ? Math.min(200, Math.ceil(changedLines / 2)) : null
    } else {
      // git unavailable → fail-closed for VERIFY: no reproducible candidate
      // means verification cannot be bound to anything, so the delegation must
      // not run. The user must make the candidate reproducible first.
      return {
        change: opts.change,
        phase: opts.phase,
        gate: "block",
        reason: "verification-unavailable: initialize a git repository or provide candidate discovery; verification cannot proceed without a reproducible candidate",
        tdd,
        risk_tier: "MEDIUM",
        frozen_diff_ref: null,
        candidate_digest: null,
        base_head: null,
        changed_lines: null,
        correction_budget_lines: null,
        changed_paths: [],
        resolved_at: new Date().toISOString(),
      }
    }
  }

  const decision: PolicyGateDecision = {
    change: opts.change,
    phase: opts.phase,
    gate: "allow",
    reason:
      opts.phase === "VERIFY"
        ? "policy gate documented — sub-agent verifies against the frozen diff ref"
        : "policy gate documented — TDD enforcement lives in the odf-tdd skill",
    tdd,
    risk_tier: riskTier,
    frozen_diff_ref: frozenDiffRef,
    candidate_digest: candidateDigest,
    base_head: baseHead,
    changed_lines: changedLines,
    correction_budget_lines: correctionBudget,
    changed_paths: changedPaths,
    ...(externalValidationScope ? { external_validation_scope: externalValidationScope } : {}),
    ...(externalValidationSubjects ? { external_validation_subjects: externalValidationSubjects } : {}),
    resolved_at: new Date().toISOString(),
  }

  savePolicyGateJson(workspace, decision)
  return decision
}
