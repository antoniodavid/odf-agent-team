#!/usr/bin/env node
import * as fs from "node:fs"
import * as path from "node:path"
import { buildDashboard, collectDelegations, resolveMetricsDir } from "./odf-metrics.js"

function matchExpectation(record, expected) {
  return Object.entries(expected || {}).every(([key, value]) => record[key] === value)
}

/**
 * Deterministic evaluation over checked-in or supplied JSON fixtures.
 * An empty/missing fixture set is honest "no_data": score is null (N/A),
 * never 1 (a perfect score on zero evidence would misrepresent results).
 */
export function evaluateOffline(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return { mode: "offline", data_status: "no_data", total: 0, passed: 0, failed: 0, score: null, score_label: "N/A", results: [] }
  }
  const results = fixtures.map((fixture, index) => ({
    name: fixture.name || `fixture-${index + 1}`,
    passed: matchExpectation(fixture.record || {}, fixture.expect),
  }))
  const passed = results.filter(result => result.passed).length
  return {
    mode: "offline",
    data_status: "complete",
    total: results.length,
    passed,
    failed: results.length - passed,
    score: passed / results.length,
    score_label: `${passed}/${results.length}`,
    results,
  }
}

export function evaluateOnline(records, days = 1) {
  if (!Array.isArray(records) || records.length === 0) {
    return { mode: "online", data_status: "no_data", total: 0, errors: 0, error_rate: null, score: null, score_label: "N/A" }
  }
  const dashboard = buildDashboard(records, days)
  if (dashboard.total === 0) {
    return {
      mode: "online",
      data_status: dashboard.data_status,
      total: 0,
      errors: 0,
      error_rate: null,
      score: null,
      score_label: "N/A",
      started_count: dashboard.startedCount,
      unfinished_count: dashboard.unfinishedCount,
    }
  }
  const total = dashboard.total
  const errors = dashboard.errorsCount
  const partial = dashboard.data_status === "partial"
  const coverage = dashboard.coverage
  const result = {
    mode: "online",
    total,
    errors,
    error_rate: errors / total,
    score: 1 - errors / total,
    score_label: `${errors}/${total} errors`,
    started_count: dashboard.startedCount,
    unfinished_count: dashboard.unfinishedCount,
  }
  if (partial) {
    result.data_status = "partial"
    result.coverage = coverage
    result.records_with_telemetry = dashboard.records_with_telemetry
  } else {
    result.data_status = "complete"
  }
  return result
}

const VALID_WORK_TYPES = new Set(["feature", "migration", "security", "bugfix", "cross-domain", "custom"])
const VALID_RISKS = new Set(["low", "medium", "high"])
const VALID_OUTCOMES = new Set(["pass", "fail"])

/**
 * Deterministic shape/consistency check for a single golden trajectory.
 * A golden is a reference corpus entry, not an executable runner; we only
 * verify that its shape is well-formed and its fields are consistent.
 */
export function validateGolden(golden) {
  const problems = []
  if (!golden || typeof golden !== "object") {
    return { valid: false, problems: ["golden must be an object"] }
  }
  if (typeof golden.id !== "string" || golden.id.length === 0) problems.push("id must be a non-empty string")
  if (!VALID_WORK_TYPES.has(golden.work_type)) problems.push(`work_type must be one of ${[...VALID_WORK_TYPES].join(", ")}`)
  if (!VALID_RISKS.has(golden.risk)) problems.push(`risk must be one of ${[...VALID_RISKS].join(", ")}`)
  if (!VALID_OUTCOMES.has(golden.outcome)) problems.push("outcome must be 'pass' or 'fail'")
  if (typeof golden.expectation !== "string" || golden.expectation.length === 0) problems.push("expectation must be a non-empty string")
  if (typeof golden.protects !== "string" || golden.protects.trim().length === 0) problems.push("protects must be a non-empty string describing the guarded defect/contract")
  if (golden.golden !== true) problems.push("golden must be true")
  if (!Array.isArray(golden.trajectory) || golden.trajectory.length === 0) problems.push("trajectory must be a non-empty array")
  for (const step of golden.trajectory || []) {
    if (!step || typeof step.step !== "string") { problems.push("each trajectory step must have a string step"); break }
    if (step.ok !== undefined && typeof step.ok !== "boolean") { problems.push("each trajectory step ok must be boolean"); break }
  }
  return { valid: problems.length === 0, problems }
}

/**
 * Deterministic reference-corpus evaluation over golden trajectories.
 * Empty/missing corpus is honest "no_data": score null (N/A), never 1.
 * This is a shape/consistency verifier, not an executable trajectory runner.
 */
export function evaluateGoldens(goldens) {
  if (!Array.isArray(goldens) || goldens.length === 0) {
    return { mode: "golden", data_status: "no_data", total: 0, passed: 0, failed: 0, score: null, results: [] }
  }
  const results = goldens.map((golden) => {
    const { valid, problems } = validateGolden(golden)
    return {
      id: golden && golden.id ? golden.id : "(unnamed)",
      passed: valid,
      expectation: golden && golden.expectation ? golden.expectation : null,
      protects: golden && golden.protects ? golden.protects : null,
      problems: valid ? [] : problems,
    }
  })
  const passed = results.filter((result) => result.passed).length
  return {
    mode: "golden",
    data_status: "complete",
    total: results.length,
    passed,
    failed: results.length - passed,
    score: results.length ? passed / results.length : null,
    results,
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"))
}

export function main(argv = process.argv.slice(2)) {
  const [mode, input, daysArg] = argv
  if (mode === "offline" && input) return evaluateOffline(readJson(input))
  if (mode === "golden" && input) return evaluateGoldens(readJson(input))
  if (mode === "online") {
    const days = Number.parseInt(daysArg || "7", 10)
    const records = input ? readJson(input) : collectDelegations(resolveMetricsDir(), days)
    return evaluateOnline(records, days)
  }
  throw new Error("Usage: odf-evaluation offline <fixtures.json> | golden <goldens.json> | online [metrics.json] [days]")
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(main(), null, 2))
