#!/usr/bin/env node
import * as fs from "node:fs"
import * as path from "node:path"

export const JUDGE_SCHEMA_VERSION = 1

export function defaultJudgeRubric() {
  return {
    schema_version: JUDGE_SCHEMA_VERSION,
    criteria: [
      {
        id: "correctness_vs_expectations",
        weight: 0.6,
        prompt:
          "Does the delivered candidate satisfy the approved human Expectations (EXP-XX) it claims to cover? Evidence must map each expectation to concrete, checkable output; unverified claims lower the score.",
      },
      {
        id: "regression_risk",
        weight: 0.25,
        prompt:
          "Does the candidate risk breaking existing behavior, contracts, or the trace it builds on? Note missing safeguards, removed invariants, or high-risk changes with no coverage.",
      },
      {
        id: "evidence_quality",
        weight: 0.15,
        prompt:
          "Is the supplied evidence (trace, tests, receipts) complete, reproducible, and tied to the candidate digest? Absent or untraceable evidence lowers the score.",
      },
    ],
    verdict_policy:
      "Verdict is pass only when correctness is satisfied with acceptable regression risk and adequate evidence; otherwise fail. Never fabricate a verdict when no provider is configured.",
  }
}

export function compareHumanJudge({ human, judge }) {
  if (judge === "unavailable") {
    return { agreement: null, false_pass: false, false_block: false, unavailable: true }
  }
  return {
    agreement: human === judge,
    false_pass: human === "fail" && judge === "pass",
    false_block: human === "pass" && judge === "fail",
    unavailable: false,
  }
}

/**
 * Shadow-mode judge evaluation. Never mutates workflow state and never gates.
 *
 * When no provider is configured (no ODF_JUDGE_MODEL) the verdict is
 * `unavailable` with data_status `no_data` — honest, never a synthesized pass.
 *
 * Provider extension point: an operator wires a real LLM by setting
 * ODF_JUDGE_MODEL (+ optional ODF_JUDGE_PROVIDER) and injecting the model
 * call in place of the `runJudge` default below. The adapter owns the
 * contract (schema, rubric, binding, telemetry); only the model round-trip
 * is external.
 */
export function evaluateShadow({ expectations, candidate_digest, trace_ref, evidence, golden } = {}) {
  const model = process.env.ODF_JUDGE_MODEL || null
  const provider = process.env.ODF_JUDGE_PROVIDER || null
  const base = {
    mode: "shadow",
    schema_version: JUDGE_SCHEMA_VERSION,
    judge_version: { rubric_version: JUDGE_SCHEMA_VERSION, model, provider },
    bound_to: {
      expectation_ids: (expectations || []).map((e) => (typeof e === "string" ? e : e && e.id)).filter(Boolean),
      candidate_digest: candidate_digest || null,
      trace_ref: trace_ref || null,
    },
  }
  if (!model) {
    return {
      ...base,
      verdict: "unavailable",
      verdict_label: "N/A",
      rationale: null,
      data_status: "no_data",
    }
  }
  const result = runJudge({ expectations, candidate_digest, trace_ref, evidence, golden }, base)
  return {
    ...base,
    ...result,
    data_status: "complete",
    judge_version: { ...base.judge_version, ...(result.judge_version || {}) },
  }
}

/**
 * Default judge runner: no real provider, returns an explicit null verdict
 * placeholder. An operator replaces this body with a call to their LLM
 * provider (e.g. an async completion against ODF_JUDGE_MODEL) and returns
 * { verdict, verdict_label, rationale }.
 */
function runJudge(_input, _base) {
  return { verdict: null, verdict_label: null, rationale: null }
}

export function recordShadowJudgment(entry) {
  return {
    schema_version: JUDGE_SCHEMA_VERSION,
    ...entry,
    judge_version: {
      rubric_version: JUDGE_SCHEMA_VERSION,
      model: (entry && entry.judge_version && entry.judge_version.model) || null,
      provider: (entry && entry.judge_version && entry.judge_version.provider) || null,
    },
  }
}

export function appendShadowJudgment(filePath, entry) {
  const line = JSON.stringify(recordShadowJudgment(entry)) + "\n"
  fs.appendFileSync(path.resolve(filePath), line, "utf8")
  return line.trim()
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"))
}

export function main(argv = process.argv.slice(2)) {
  const [mode, input] = argv
  if (mode === "shadow" && input) return evaluateShadow(readJson(input))
  throw new Error("Usage: odf-judge shadow <input.json>")
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(main(), null, 2))
