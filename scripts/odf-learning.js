#!/usr/bin/env node
/**
 * ODF Learning Loop — pure pipeline that converts verified runs into
 * reviewable memory candidates and skill candidates, gated by golden
 * regression and mandatory human approval.
 *
 * T12 contract (docs/learning-loop-contract.md):
 *  - Admits ONLY verified runs: candidate_digest (64-hex) + valid receipt
 *    + approved expectations + known outcome.
 *  - Consolidates episodic runs -> reviewable memory (never auto-writes).
 *  - Proposes a skill ONLY from a difficult (>= threshold tool calls) verified
 *    success. 5+ tool calls is a SIGNAL, not proof — golden regression decides.
 *  - NEVER activates anything. Human approval is mandatory.
 *  - Rollback never rewrites source evidence; it only adds rolled_back flags.
 *
 * This module is a PURE pipeline. It does not call Engram and does not write
 * skills; the caller owns the real writer (same adapter split as odf-judge).
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { evaluateGoldens } from "./odf-evaluation.js"

export const LEARNING_SCHEMA_VERSION = 1

const HEX64 = /^[0-9a-f]{64}$/i
const KNOWN_OUTCOMES = new Set(["pass", "fail", "verified"])
const MEMORY_TOPIC_FIELDS = ["topic", "work_type"]

/**
 * A run is admissible ONLY when every admission credential is present and
 * coherent: 64-hex candidate_digest, a valid receipt (successful status with
 * a digest matching the run), approved (non-empty) expectations, and a known
 * outcome. Any missing credential -> false (fail-closed, never partial admit).
 */
export function isVerifiedRun(run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) return false

  const digest = run.candidate_digest
  if (typeof digest !== "string" || !HEX64.test(digest)) return false

  const receipt = run.receipt ?? run.receipt_ref
  if (!receipt || typeof receipt !== "object") return false
  const receiptStatus = receipt.status
  if (receiptStatus !== "success" && receiptStatus !== "verified") return false
  if (receipt.candidate_digest !== undefined && receipt.candidate_digest !== digest) return false

  const expectations = run.expectations
  if (!Array.isArray(expectations) || expectations.length === 0) return false
  if (!expectations.every((e) => e && typeof e === "object" && e.approved === true)) return false

  const outcome = run.outcome
  if (typeof outcome !== "string" || !KNOWN_OUTCOMES.has(outcome)) return false

  return true
}

function deriveFact(run) {
  const outcome = run.outcome
  const success = outcome === "pass" || outcome === "verified"
  const workType = run.work_type || run.topic || null
  const expectationIds = (run.expectations || []).map((e) => e && e.id).filter(Boolean)
  const scope = success
    ? `${workType ? `${workType}: ` : ""}candidate ${run.candidate_digest.slice(0, 8)} met approved expectations${expectationIds.length ? ` (${expectationIds.join(", ")})` : ""}`
    : `${workType ? `${workType}: ` : ""}candidate ${run.candidate_digest.slice(0, 8)} FAILED; outcome ${run.outcome}${expectationIds.length ? ` (${expectationIds.join(", ")})` : ""}`
  return { scope, success }
}

function topicOf(run) {
  for (const field of MEMORY_TOPIC_FIELDS) {
    if (typeof run[field] === "string" && run[field].length) return run[field]
  }
  return null
}

/**
 * Consolidate verified episodic runs into reviewable memory candidates.
 * Groups runs by topic/work_type; facts are DERIVED from runs, never invented.
 * No verified runs -> data_status "no_data" (T8 consistency).
 */
export function consolidateMemory(runs) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return { data_status: "no_data", candidates: [] }
  }
  const verified = runs.filter(isVerifiedRun)
  if (verified.length === 0) {
    return { data_status: "no_data", candidates: [] }
  }

  const byTopic = new Map()
  for (const run of verified) {
    const topic = topicOf(run) || "general"
    if (!byTopic.has(topic)) byTopic.set(topic, [])
    byTopic.get(topic).push(run)
  }

  const candidates = []
  for (const [topic, group] of byTopic) {
    const successes = group.filter((r) => deriveFact(r).success).length
    const failures = group.length - successes
    candidates.push({
      id: `memory-${topic}-${group[0].candidate_digest.slice(0, 8)}`,
      source_runs: group.map((r) => r.candidate_digest),
      fact: deriveFact(group[0]).scope,
      evidence_refs: group.map((r) => r.receipt_ref?.receipt_id || r.receipt?.receipt_id || r.candidate_digest),
      golden_regression: "pending",
      proposed_for: "human",
      summary: `${group.length} verified run(s) on "${topic}": ${successes} success, ${failures} fail`,
    })
  }

  return { data_status: "complete", candidates }
}

/**
 * Propose a skill candidate ONLY from a difficult verified success.
 * Difficulty is a SIGNAL (tool_call_count >= threshold), not proof; a
 * difficult but unverified run, or an easy verified run, proposes nothing.
 * Never activates — always requires human approval.
 */
export function proposeSkillCandidate(run, { tool_calls_threshold = 5 } = {}) {
  if (!isVerifiedRun(run)) {
    return { proposed: false, reason: "run-not-verified" }
  }
  const toolCalls = Number(run.tool_call_count) || 0
  if (toolCalls < tool_calls_threshold) {
    return { proposed: false, reason: "trajectory-not-difficult" }
  }
  const success = run.outcome === "pass" || run.outcome === "verified"
  if (!success) {
    return { proposed: false, reason: "outcome-not-success" }
  }
  const workType = run.work_type || run.topic || "general"
  const id = `skill-${workType}-${run.candidate_digest.slice(0, 8)}`
  return {
    proposed: true,
    id,
    title: `${workType} skill candidate from difficult verified run`,
    trajectory_summary: `${toolCalls} tool calls across ${Array.isArray(run.trace_ref) ? run.trace_ref.length : "the"} trajectory; outcome ${run.outcome}`,
    source_run: run.candidate_digest,
    golden_regression: "pending",
    proposed_for: "human",
    outcome: "pass",
    golden_refs: Array.isArray(run.golden_refs) ? run.golden_refs : [],
    reason: `verified ${run.outcome} with ${toolCalls} tool calls (>= threshold ${tool_calls_threshold})`,
  }
}

/**
 * Run every candidate against the golden corpus before presentation.
 * Reuses evaluateGoldens' deterministic shape/consistency check to validate
 * the corpus; a candidate CONTRADICTS a golden when it explicitly references
 * (golden_refs) a guarded-defect golden (outcome "fail") but itself claims
 * success — promoting such a candidate would blind the guarded defect.
 * Contradicting candidates are failed and NOT presented.
 */
export function runGoldenRegression(candidates, goldens) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { data_status: "no_data", results: [] }
  }
  const goldenResult = evaluateGoldens(goldens || [])
  const goldenByProtect = new Map()
  for (const g of goldens || []) {
    if (g && typeof g.protects === "string") goldenByProtect.set(g.protects, g)
  }
  const claimedOutcome = (candidate) =>
    candidate.outcome === "fail" ? "fail" : "pass"
  return {
    data_status: (goldenResult.results || []).length ? "complete" : "no_data",
    results: candidates.map((candidate) => {
      const refs = Array.isArray(candidate.golden_refs) ? candidate.golden_refs : []
      const claim = claimedOutcome(candidate)
      const contradicts = (goldens || []).some((g) => {
        if (!g || g.outcome !== "fail") return false
        const referenced = refs.includes(g.id)
        const protectsMatch =
          typeof candidate.fact === "string" &&
          typeof g.protects === "string" &&
          candidate.fact.indexOf(g.protects) >= 0
        return referenced || protectsMatch
      }) && claim === "pass"
      const status = contradicts ? "failed" : "passed"
      return {
        candidate_id: candidate.id,
        status,
        protects: contradicts ? [] : (refs.length ? refs : []),
      }
    }),
  }
}

/**
 * Human approval gate: only the ids in approved_ids are activated; everything
 * else stays proposed (never auto-activated).
 */
export function approveCandidates(candidates, { approved_ids = [] } = {}) {
  const approved = new Set(approved_ids || [])
  return (candidates || []).map((candidate) =>
    approved.has(candidate.id)
      ? { ...candidate, approved: true, approved_by: "human" }
      : { ...candidate, approved: false, approved_by: null }
  )
}

/**
 * Rollback marks a candidate without rewriting source evidence: it only adds
 * rolled_back flags and references the original source_runs/evidence.
 */
export function rollbackCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return candidate
  return {
    ...candidate,
    rolled_back: true,
    rolled_back_at: new Date().toISOString(),
    preserves_evidence: {
      source_runs: candidate.source_runs || (candidate.source_run ? [candidate.source_run] : []),
      evidence_refs: candidate.evidence_refs || [],
    },
  }
}

/**
 * Full pipeline plan: memory candidates + skill candidates, each gated by
 * golden regression, with the KPI envelope { accepted, regressions_avoided,
 * rolled_back, pending }.
 */
export function buildPlan(runs, goldens, { approved_ids = [] } = {}) {
  const memory = consolidateMemory(runs)
  const skillRuns = (Array.isArray(runs) ? runs : []).filter((r) =>
    proposeSkillCandidate(r, {}).proposed
  )
  const skillCandidates = skillRuns.map((r) => proposeSkillCandidate(r, {}))

  const all = [...memory.candidates, ...skillCandidates]
  const regression = runGoldenRegression(all, goldens)

  const regressionByCandidate = new Map(regression.results.map((r) => [r.candidate_id, r]))
  const gated = all
    .map((candidate) => {
      const reg = regressionByCandidate.get(candidate.id)
      return { ...candidate, golden_regression: reg ? reg.status : "pending" }
    })
    .filter((candidate) => candidate.golden_regression !== "failed")

  const presented = approveCandidates(gated, { approved_ids })

  const accepted = presented.filter((c) => c.approved).length
  const regressionsAvoided = all.length - gated.length
  const rolledBack = presented.filter((c) => c.rolled_back).length
  const pending = presented.length - accepted - rolledBack

  return {
    schema_version: LEARNING_SCHEMA_VERSION,
    data_status: memory.data_status,
    plan: {
      memory: memory.candidates,
      skills: skillCandidates,
      golden_regression: regression,
      candidates: presented,
    },
    kpi: {
      accepted,
      regressions_avoided: regressionsAvoided,
      rolled_back: rolledBack,
      pending,
    },
  }
}

export function main(argv = process.argv.slice(2)) {
  const [input] = argv
  const goldensPath = path.resolve(process.env.ODF_GOLDENS || "scripts/fixtures/golden-trajectories.json")
  const goldens = JSON.parse(fs.readFileSync(goldensPath, "utf8"))
  if (!input) throw new Error("Usage: odf-learning <runs.json>")
  const runs = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"))
  return buildPlan(runs, goldens)
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(main(), null, 2))
