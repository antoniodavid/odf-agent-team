/**
 * Receipt persistence + the odf_receipt tool (P1 modularization slice).
 * Extracted from plugins/odf-delegation.ts — behavior unchanged.
 */

import * as fsSync from "node:fs"
import * as path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { buildCandidateManifest, computeCandidateDigest } from "./candidate-manifest.js"
import { gitHead, readPersistedExternalValidationScope } from "./odf-delegation-policy.js"
import { debugLog, resolveWorkspaceRoot } from "./odf-delegation-shared.js"

export interface ODFReceipt {
  change: string
  phase: "PROPOSE" | "ASSESS" | "QA-PLAN" | "DESIGN" | "IMPLEMENT" | "VERIFY" | "EXPLORE" | "FIX"
  status: "ok" | "warning" | "blocked" | "failed"
  cause: "validation-failed" | "error" | "timeout" | "scope-change" | "re-plan" | "abandon" | null
  evidence: {
    summary: string
    frozen_diff_ref: string | null
    failing: string[]
    refs: string[]
  } | null
  action: { committed: "scope-change" | "re-plan" | "abandon" | "retry" | "none"; user_decision?: string } | null
  review_gate: { attempts_used: number; budget_lines: number | null; verdict: "FAIL" | "PASS" | "PASS_WITH_WARNINGS" } | null
  frozen_diff_ref: string | null
  candidate_digest?: string | null
  expectations_ids?: string[]
  resolved_at: string
  parallel?: {
    branch_ids: string[]
    summaries: Record<string, string>
    attempt_ledger_refs: string[]
    validation_evidence_refs: string[]
  }
}

/** Candidate digest of a workspace, or null when git/scope validation is unavailable. */
export function candidateDigestOrNull(workspaceDir: string, change?: string): string | null {
  const persistedScope = change
    ? readPersistedExternalValidationScope(workspaceDir, change)
    : { paths: undefined, invalid: false }
  if (persistedScope.invalid) return null
  const manifest = buildCandidateManifest(workspaceDir, persistedScope.paths)
  return manifest.base_head !== null ? computeCandidateDigest(manifest) : null
}

export function saveReceiptJson(workspaceDir: string, receipt: ODFReceipt): void {
  try {
    const dir = path.join(workspaceDir, ".odf")
    fsSync.mkdirSync(dir, { recursive: true })
    fsSync.writeFileSync(
      path.join(dir, `receipt-${receipt.change}.json`),
      JSON.stringify(receipt, null, 2),
      "utf8"
    )
  } catch (err) {
    console.warn(`[odf-delegation] Failed to persist receipt for ${receipt.change}: ${err}`)
  }
}

/**
 * Upsert a receipt without clobbering a resolved one. A receipt whose `action`
 * is set is terminal until a deliberate transition; an update with `action:
 * null` never overwrites an existing set action.
 *
 * A written receipt is bound to the candidate digest current at write time
 * (stamped over any caller value), so a later write for the same change after a
 * candidate mutation never inherits the old candidate's binding.
 */
export function mergeReceipt(
  workspaceDir: string,
  incoming: ODFReceipt
): ODFReceipt {
  try {
    const existing = JSON.parse(
      fsSync.readFileSync(path.join(workspaceDir, ".odf", `receipt-${incoming.change}.json`), "utf8")
    ) as ODFReceipt
    if (existing.action && !incoming.action) {
      return existing
    }
    if (existing.action && incoming.action && incoming.action.committed !== "retry") {
      return existing
    }
  } catch {
    // No prior receipt or unreadable → write incoming.
  }
  incoming.candidate_digest = candidateDigestOrNull(workspaceDir, incoming.change)
  saveReceiptJson(workspaceDir, incoming)
  return incoming
}

export function createODFReceipt(): ReturnType<typeof tool> {
  return tool({    description: `Persist an ODF receipt (failure disposition) for a change.

Writes/merges <worktree>/.odf/receipt-{change}.json. Use after a phase fails or
blocked: record the cause, evidence refs, and the committed action
(scope-change | re-plan | abandon | retry). A receipt with an action set is
terminal until a deliberate transition — an update without action never
overwrites it. Best-effort like the policy gate: never blocks the flow.`,
    args: {
      change: tool.schema
        .string()
        .describe("Change name (kebab-case)"),
      phase: tool.schema
        .enum(["PROPOSE", "ASSESS", "QA-PLAN", "DESIGN", "IMPLEMENT", "VERIFY", "EXPLORE", "FIX"])
        .describe("Phase that produced the receipt"),
      status: tool.schema
        .enum(["ok", "warning", "blocked", "failed"])
        .describe("Phase outcome (result-contract status)"),
      cause: tool.schema
        .enum(["validation-failed", "error", "timeout", "scope-change", "re-plan", "abandon"])
        .optional()
        .describe("Why the phase failed/blocked"),
      evidence_summary: tool.schema
        .string()
        .optional()
        .describe("Short decision-grade summary of the evidence"),
      failing: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Commands/tests that failed"),
      refs: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Topic keys / paths of the evidence (e.g. odf/{change}/verify-report)"),
      action: tool.schema
        .enum(["scope-change", "re-plan", "abandon", "retry", "none"])
        .optional()
        .describe("Committed next step (set when the user decides)"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Project directory (defaults to cwd)"),
    },
    async execute(args: {
      change: string
      phase: ODFReceipt["phase"]
      status: ODFReceipt["status"]
      cause?: ODFReceipt["cause"]
      evidence_summary?: string
      failing?: string[]
      refs?: string[]
      action?: "scope-change" | "re-plan" | "abandon" | "retry" | "none"
      workspace_dir?: string
    }): Promise<string> {
      const workspace = resolveWorkspaceRoot(args.workspace_dir || process.cwd())
      const receipt: ODFReceipt = {
        change: args.change,
        phase: args.phase,
        status: args.status,
        cause: args.cause || null,
        evidence:
          args.evidence_summary || args.failing?.length || args.refs?.length
            ? {
                summary: args.evidence_summary || "",
                frozen_diff_ref: gitHead(workspace),
                failing: args.failing || [],
                refs: args.refs || [],
              }
            : null,
        action: args.action ? { committed: args.action } : null,
        review_gate: args.phase === "VERIFY" ? { attempts_used: 1, budget_lines: null, verdict: args.status === "ok" ? "PASS" : args.status === "warning" ? "PASS_WITH_WARNINGS" : "FAIL" } : null,
        frozen_diff_ref: gitHead(workspace),
        resolved_at: new Date().toISOString(),
      }
      const merged = mergeReceipt(workspace, receipt)
      const mergedAction = merged.action?.committed || "pending"
      debugLog(`[odf-delegation] odf_receipt: change=${merged.change} phase=${merged.phase} status=${merged.status} cause=${merged.cause} action=${mergedAction}`)
      return JSON.stringify(merged, null, 2)
    },
  })
}
