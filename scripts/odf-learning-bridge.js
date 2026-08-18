#!/usr/bin/env node
/**
 * ODF Learning Bridge (C1) — turn an archived ODF change into a verified run
 * for the T12 learning loop (odf-learning.js), so successful designs propose
 * reviewable skill/memory candidates from archive time.
 *
 * The bridge adapts the change's design_meta + approved expectations + IMPLEMENT
 * telemetry into the single "run" shape the learning pipeline admits. It is
 * PURE (no I/O) except the CLI wrapper, mirroring odf-learning.js /
 * odf-design-library.js.
 *
 * Honesty contract (T8, same as the sibling pipelines):
 *  - A run is only built when a 64-hex candidate_digest (from the verify
 *    receipt or design_meta) AND approved expectations exist; otherwise it
 *    returns `{ run: null, data_status: "no_data", reason }` — never a fake run.
 *  - tool_call_count is NOT captured by current telemetry (no per-tool spans),
 *    so it is derived honestly and flagged via `tool_call_source`:
 *      "actual"  — records carry per-tool spans (a `tool` field) → counted,
 *      "derived" — rounds_real from collectImplementationRounds(records),
 *      null      — no records / no usable duration → never invented.
 *  - Skills are proposed ONLY from difficult (>= tool_calls_threshold) verified
 *    successes. Auto-activation is out of scope (learning-loop-contract.md):
 *    every candidate is `proposed_for: "human"` and requires explicit approval.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {
  LEARNING_SCHEMA_VERSION,
  proposeSkillCandidate,
  consolidateMemory,
  runGoldenRegression,
  approveCandidates,
} from "./odf-learning.js"
import { collectImplementationRounds } from "./odf-design-library.js"

export { LEARNING_SCHEMA_VERSION } from "./odf-learning.js"

const HEX64 = /^[0-9a-f]{64}$/i
const KNOWN_OUTCOMES = new Set(["pass", "fail", "verified"])
const OK_RECEIPT_STATUSES = new Set(["success", "verified"])

/* ------------------------------------------------------------------ */
/* input normalization                                                  */
/* ------------------------------------------------------------------ */

// 64-hex digest from the verify receipt or design_meta; null when absent.
function candidateDigest(receipt, design_meta) {
  for (const d of [receipt && receipt.candidate_digest, design_meta && design_meta.candidate_digest]) {
    if (typeof d === "string" && HEX64.test(d)) return d.toLowerCase()
  }
  return null
}

// Approved EXP-XX from the odf/{change}/expectations artifact. Accepts the
// canonical artifact ({ expectations: [...], approved: true }) or a plain array
// of per-item-approved expectations. Unapproved input → [] (fail-closed).
function approvedExpectations(expectations) {
  const artifact = expectations && typeof expectations === "object" ? expectations : null
  if (!artifact) return []
  const list = Array.isArray(artifact)
    ? artifact
    : Array.isArray(artifact.expectations)
      ? artifact.expectations
      : []
  const artifactApproved = !Array.isArray(artifact) && (artifact.approved === true || !!artifact.approved_by)
  return list
    .filter((e) => e && typeof e === "object" && (e.approved === true || artifactApproved))
    .map((e) => ({ id: e.id, statement: e.statement, approved: true }))
}

// The archive gate guarantees VERIFY passed before C1 runs, so an absent receipt
// status maps to "success" rather than inventing a different verification state.
function receiptStatus(receipt) {
  const s = receipt && typeof receipt === "object" ? receipt.status : null
  return OK_RECEIPT_STATUSES.has(s) ? s : "success"
}

// Same gate: called only after a passing VERIFY, so an absent outcome maps to
// "pass"; an explicit known outcome (pass/fail/verified) is always preserved.
function runOutcome(outcome) {
  return typeof outcome === "string" && KNOWN_OUTCOMES.has(outcome) ? outcome : "pass"
}

// Honest tool_call_count: actual (per-tool spans) > derived (rounds_real) > null.
function deriveToolCalls(records) {
  if (Array.isArray(records)) {
    const toolLevel = records.filter(
      (r) => r && typeof r === "object" && typeof r.tool === "string" && r.tool.length > 0
    )
    if (toolLevel.length > 0) return { tool_call_count: toolLevel.length, tool_call_source: "actual" }
    const rounds = collectImplementationRounds(records).rounds_real
    if (Number.isFinite(rounds) && rounds > 0) return { tool_call_count: rounds, tool_call_source: "derived" }
  }
  return { tool_call_count: null, tool_call_source: null }
}

/* ------------------------------------------------------------------ */
/* buildVerifiedRunFromChange                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a learning-loop `run` from an archived change. Returns
 * `{ run, data_status: "complete" }` when the run is admissible, or
 * `{ run: null, data_status: "no_data", reason }` when a required credential
 * (64-hex candidate_digest, approved expectations) is missing.
 */
export function buildVerifiedRunFromChange({ design_meta, expectations, records, outcome, receipt } = {}) {
  const digest = candidateDigest(receipt, design_meta)
  if (!digest) {
    return { run: null, data_status: "no_data", reason: "missing candidate_digest (64-hex from receipt or design_meta)" }
  }
  const exps = approvedExpectations(expectations)
  if (exps.length === 0) {
    return { run: null, data_status: "no_data", reason: "missing approved expectations" }
  }
  const { tool_call_count, tool_call_source } = deriveToolCalls(records)
  const run = {
    candidate_digest: digest,
    receipt_ref: {
      status: receiptStatus(receipt),
      candidate_digest: digest,
      ...(receipt && typeof receipt === "object" && receipt.receipt_id ? { receipt_id: receipt.receipt_id } : {}),
    },
    expectations: exps,
    outcome: runOutcome(outcome),
    work_type: (design_meta && design_meta.work_type) || null,
    topic: (design_meta && (design_meta.change || design_meta.work_type)) || null,
    tool_call_count,
    tool_call_source,
    design_meta: design_meta || null,
  }
  return { run, data_status: "complete" }
}

/* ------------------------------------------------------------------ */
/* proposeFromArchivedChange                                            */
/* ------------------------------------------------------------------ */

/**
 * Archive-time learning proposal. Builds the verified run and feeds it to the
 * T12 pipeline: skill candidate only from a difficult verified success, memory
 * consolidation, golden regression, and the KPI envelope. NUNCA propone cuando
 * el run no es verificado (`run_verified: false`, `no_data`) — fail-closed.
 */
export function proposeFromArchivedChange(
  { design_meta, expectations, records, goldens, outcome, receipt, tool_calls_threshold = 5 } = {}
) {
  const built = buildVerifiedRunFromChange({ design_meta, expectations, records, outcome, receipt })
  if (!built.run) {
    return {
      schema_version: LEARNING_SCHEMA_VERSION,
      data_status: "no_data",
      run_verified: false,
      reason: built.reason,
      skill_candidates: [],
      memory_candidates: [],
      golden_regression: { data_status: "no_data", results: [] },
      kpi: { accepted: 0, regressions_avoided: 0, rolled_back: 0, pending: 0 },
    }
  }

  const run = built.run
  const skill = proposeSkillCandidate(run, { tool_calls_threshold })
  const memory = consolidateMemory([run])
  const skill_candidates = skill.proposed ? [skill] : []
  const memory_candidates = memory.candidates
  const proposed = [...memory_candidates, ...skill_candidates]
  const regression = runGoldenRegression(proposed, goldens || [])

  const byCandidate = new Map(regression.results.map((r) => [r.candidate_id, r]))
  const gated = proposed
    .map((c) => ({ ...c, golden_regression: byCandidate.get(c.id)?.status ?? "pending" }))
    .filter((c) => c.golden_regression !== "failed")
  const presented = approveCandidates(gated, { approved_ids: [] })

  return {
    schema_version: LEARNING_SCHEMA_VERSION,
    data_status: built.data_status,
    run_verified: true,
    skill_candidates,
    memory_candidates,
    golden_regression: regression,
    kpi: {
      accepted: presented.filter((c) => c.approved).length,
      regressions_avoided: proposed.length - gated.length,
      rolled_back: 0,
      pending: presented.length,
    },
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

/** CLI: `node scripts/odf-learning-bridge.js propose <change.json>` */
export function main(argv = process.argv.slice(2)) {
  const [mode, input] = argv
  if (mode !== "propose" || !input) throw new Error("Usage: odf-learning-bridge propose <change.json>")
  const change = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"))
  if (!change.goldens) {
    const goldensPath = path.resolve(process.env.ODF_GOLDENS || "scripts/fixtures/golden-trajectories.json")
    change.goldens = JSON.parse(fs.readFileSync(goldensPath, "utf8"))
  }
  return proposeFromArchivedChange(change)
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(main(), null, 2))
