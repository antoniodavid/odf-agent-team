#!/usr/bin/env node
import * as fs from "node:fs"
import * as path from "node:path"
import YAML from "yaml"
import { buildDashboard, collectDelegations, recordStageRole, resolveMetricsDir } from "./odf-metrics.js"
import { compareHumanJudge } from "./odf-judge.js"

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

export const WORK_TYPES = [
  "question", "investigation", "standard-config", "small-change", "feature",
  "cross-domain", "bugfix", "migration", "security", "verify-only",
]
export const ROUTE_RISKS = ["low", "standard", "high"]
export const REVIEW_ROUTE_VALUES = ["correct", "incorrect"]
export const REVIEW_FIT_VALUES = ["under", "ok", "over"]
const CHANGE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
export const ROUTE_STAGES = {
  question: ["EXPLORE"],
  investigation: ["EXPLORE"],
  "standard-config": ["DECIDE"],
  "small-change": ["DECIDE", "BUILD", "VERIFY"],
  feature: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
  "cross-domain": ["DECIDE", "PLAN", "BUILD", "VERIFY"],
  bugfix: ["FIX", "BUILD", "VERIFY"],
  migration: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
  security: ["DECIDE", "PLAN", "BUILD", "VERIFY"],
  "verify-only": ["VERIFY"],
}
export const STAGE_ROLES = {
  DECIDE: ["PROPOSE", "ASSESS"],
  PLAN: ["QA-PLAN", "DESIGN"],
  BUILD: [],
  VERIFY: [],
  EXPLORE: [],
  FIX: [],
}
const VALID_WORK_TYPES = new Set(WORK_TYPES)
const VALID_RISKS = new Set(ROUTE_RISKS)
const VALID_OUTCOMES = new Set(["pass", "fail"])
const VALID_STAGES = new Set(Object.keys(STAGE_ROLES))

function parseTrajectoryStep(step) {
  const raw = step.step.trim()
  const retry = /-retry$/i.test(raw)
  const base = raw.replace(/-retry$/i, "").trim()
  const parts = base.split(/\s+/)
  return { stage: parts[0] || "", role: parts[1] || null, extra: parts.slice(2), retry }
}

function validateTrajectory(golden) {
  const route = ROUTE_STAGES[golden.work_type]
  if (!Array.isArray(route)) return "work_type has no route"
  let stageIndex = -1
  let currentStage = null
  let seenRoles = new Set()
  for (const step of golden.trajectory) {
    const parsed = parseTrajectoryStep(step)
    if (!VALID_STAGES.has(parsed.stage)) return `trajectory step "${step.step}" is not a canonical stage`
    if (parsed.extra.length > 0) return `trajectory step "${step.step}" has extra tokens`
    const allowedRoles = STAGE_ROLES[parsed.stage] || []
    if (parsed.role && !allowedRoles.includes(parsed.role)) {
      return `trajectory step "${step.step}" has an invalid role for ${parsed.stage}`
    }
    if (parsed.stage === currentStage) {
      if (parsed.retry) continue
      if (!parsed.role) return `trajectory step "${step.step}" repeats ${parsed.stage}; use -retry for a retry`
      if (seenRoles.has(parsed.role)) return `trajectory step "${step.step}" repeats role ${parsed.role}`
      seenRoles.add(parsed.role)
      continue
    }
    const nextIndex = route.indexOf(parsed.stage, stageIndex + 1)
    if (nextIndex < 0) return `trajectory step "${step.step}" is out of route order`
    stageIndex = nextIndex
    currentStage = parsed.stage
    seenRoles = new Set(parsed.role ? [parsed.role] : [])
  }
  return null
}

/**
 * Deterministic shape/consistency check for a single golden trajectory.
 * A golden is a reference corpus entry, not an executable runner; it must
 * still follow the selected route, its stages, and its stage roles.
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
  if (Array.isArray(golden.trajectory) && golden.trajectory.length > 0) {
    const trajectoryProblem = validateTrajectory(golden)
    if (trajectoryProblem) problems.push(trajectoryProblem)
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

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function readJsonLines(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    }).filter(Boolean)
  } catch {
    return []
  }
}

function countBy(values) {
  const counts = {}
  for (const value of values) {
    const key = value === undefined || value === null || value === "" ? "unknown" : String(value)
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function listChanges(root) {
  const changesDir = path.join(root, "openspec", "changes")
  try {
    return fs.readdirSync(changesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "archive")
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function listStateChanges(root) {
  return listChanges(root).filter((change) => {
    try {
      const state = YAML.parse(fs.readFileSync(path.join(root, "openspec", "changes", change, "state.yaml"), "utf8"))
      return state && typeof state === "object"
    } catch {
      return false
    }
  })
}

function emptyDecisionAggregate() {
  return {
    changes: 0,
    route_agreement: { compared: 0, agreed: 0, rate: null },
    risk_tiers: {},
    plan_modes: {},
    first_pass: { count: 0, rate: null },
    rework: { changes: 0, rate: null },
    receipts: { count: 0, causes: {}, statuses: {} },
    overrides: 0,
    archive: { count: 0, rate: null },
    reviews: {
      count: 0,
      coverage: null,
      route_correct: { count: 0, total: 0, rate: null },
      risk_fit: {},
      plan_fit: {},
      gate_correct: { count: 0, total: 0, rate: null },
      avg_rating: null,
    },
    stage_activity: {},
  }
}

function aggregateDecisions(changes) {
  if (changes.length === 0) return emptyDecisionAggregate()
  const compared = changes.filter((change) => change.route_agreement !== null)
  const agreed = compared.filter((change) => change.route_agreement === true).length
  const firstPass = changes.filter((change) => change.first_pass).length
  const rework = changes.filter((change) => change.rework_count > 0).length
  const receipts = changes.flatMap((change) => change.receipts)
  const stageActivity = {}
  for (const change of changes) {
    for (const [label, activity] of Object.entries(change.stage_activity)) {
      stageActivity[label] ??= { calls: 0, ok: 0, blocked: 0, error: 0, duration_ms: 0 }
      stageActivity[label].calls += activity.calls
      stageActivity[label].ok += activity.ok
      stageActivity[label].blocked += activity.blocked
      stageActivity[label].error += activity.error
      stageActivity[label].duration_ms += activity.duration_ms
    }
  }
  for (const activity of Object.values(stageActivity)) {
    activity.avg_duration_ms = activity.calls > 0 ? Math.round(activity.duration_ms / activity.calls) : null
  }
  const reviewed = changes.filter((change) => change.review)
  const routeCorrect = reviewed.filter((change) => change.review.route === "correct").length
  const gateCorrect = reviewed.filter((change) => change.review.gate === "correct").length
  const ratings = reviewed.map((change) => change.review.rating)
  return {
    changes: changes.length,
    route_agreement: {
      compared: compared.length,
      agreed,
      rate: compared.length > 0 ? agreed / compared.length : null,
    },
    risk_tiers: countBy(changes.map((change) => change.risk_tier)),
    plan_modes: countBy(changes.map((change) => change.plan_mode)),
    first_pass: { count: firstPass, rate: firstPass / changes.length },
    rework: { changes: rework, rate: rework / changes.length },
    receipts: {
      count: receipts.length,
      causes: countBy(receipts.map((receipt) => receipt.cause)),
      statuses: countBy(receipts.map((receipt) => receipt.status)),
    },
    overrides: changes.reduce((sum, change) => sum + change.override_count, 0),
    archive: {
      count: changes.filter((change) => change.archived).length,
      rate: changes.filter((change) => change.archived).length / changes.length,
    },
    reviews: {
      count: reviewed.length,
      coverage: reviewed.length / changes.length,
      route_correct: {
        count: routeCorrect,
        total: reviewed.length,
        rate: reviewed.length > 0 ? routeCorrect / reviewed.length : null,
      },
      risk_fit: countBy(reviewed.map((change) => change.review.risk)),
      plan_fit: countBy(reviewed.map((change) => change.review.plan)),
      gate_correct: {
        count: gateCorrect,
        total: reviewed.length,
        rate: reviewed.length > 0 ? gateCorrect / reviewed.length : null,
      },
      avg_rating: ratings.length > 0 ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null,
    },
    stage_activity: stageActivity,
  }
}

/**
 * Decision-quality report over evidence already on disk: OpenSpec state,
 * policy gates, receipts, attempt ledgers, override audits, and metrics JSONL.
 * It is a calibration report, never a gate. Engram-only changes are not read.
 */
export function evaluateDecisions({ root = process.cwd(), days = 30, metricsRecords = null } = {}) {
  const resolvedRoot = path.resolve(root)
  const changeNames = listChanges(resolvedRoot)
  if (changeNames.length === 0) {
    return {
      mode: "decisions",
      data_status: "no_data",
      days,
      total: 0,
      changes: [],
      aggregate: emptyDecisionAggregate(),
      warnings: ["No OpenSpec changes were found under openspec/changes."],
    }
  }

  let records = []
  const warnings = []
  if (Array.isArray(metricsRecords)) {
    records = metricsRecords
  } else {
    try {
      records = collectDelegations(resolveMetricsDir(), days)
    } catch {
      warnings.push("Metrics could not be read; decision counts exclude delegation telemetry.")
    }
  }

  const odfDir = path.join(resolvedRoot, ".odf")
  const changes = []
  for (const change of changeNames) {
    const statePath = path.join(resolvedRoot, "openspec", "changes", change, "state.yaml")
    let state
    try {
      state = YAML.parse(fs.readFileSync(statePath, "utf8"))
    } catch {
      warnings.push(`${change}: state.yaml could not be read; skipped.`)
      continue
    }
    if (!state || typeof state !== "object") {
      warnings.push(`${change}: state.yaml is not an object; skipped.`)
      continue
    }

    const workType = typeof state.work_type === "string" ? state.work_type : null
    const route = Array.isArray(state.route?.stages)
      ? state.route.stages.filter((stage) => typeof stage === "string")
      : (workType && ROUTE_STAGES[workType]) || []
    const completed = Array.isArray(state.completed_canonical_stages)
      ? state.completed_canonical_stages.filter((stage) => typeof stage === "string")
      : []
    const canonicalStage = typeof state.canonical_stage === "string" ? state.canonical_stage : null
    const pendingStage = route.find((stage) => !completed.includes(stage)) || null
    const terminalStage = route.length > 0 ? route[route.length - 1] : null
    const archived = canonicalStage === "ARCHIVED"
    const binding = state.entry_route_binding && typeof state.entry_route_binding === "object"
      ? state.entry_route_binding
      : null
    const predictedRoute = binding && typeof binding.predicted_route === "string" ? binding.predicted_route : null
    const routeAgreement = predictedRoute && workType ? predictedRoute === workType : null
    const gate = readJsonSafe(path.join(odfDir, `policy-gate-${change}.json`))
    const receipt = readJsonSafe(path.join(odfDir, `receipt-${change}.json`))
    const ledger = readJsonLines(path.join(odfDir, `attempt-ledger-${change}.jsonl`))
    const overrides = readJsonLines(path.join(odfDir, `override-${change}.jsonl`))
    const review = readDecisionReview(resolvedRoot, change)
    const changeMetrics = records.filter((record) => record && record.change === change)
    const runRecords = changeMetrics.filter((record) => record.event === "run" || record.event === undefined)
    const calls = runRecords.length > 0 ? runRecords : changeMetrics

    const stageActivity = {}
    for (const record of calls) {
      const target = recordStageRole(record)
      const label = target.role ? `${target.stage} ${target.role}` : target.stage
      stageActivity[label] ??= { calls: 0, ok: 0, blocked: 0, error: 0, duration_ms: 0 }
      const activity = stageActivity[label]
      activity.calls++
      if (record.status === "ok") activity.ok++
      else if (record.status === "blocked") activity.blocked++
      else if (record.status === "error" || record.status === "timeout") activity.error++
      activity.duration_ms += Number.isFinite(record.duration_ms) ? record.duration_ms : 0
    }
    for (const activity of Object.values(stageActivity)) {
      activity.avg_duration_ms = activity.calls > 0 ? Math.round(activity.duration_ms / activity.calls) : null
    }

    const failedAttempts = ledger.filter((record) => record.status === "failed").length
    const firstPass = failedAttempts === 0 && !receipt
    const receipts = receipt
      ? [{
        stage: typeof receipt.stage === "string" ? receipt.stage : null,
        role: typeof receipt.role === "string" ? receipt.role : null,
        status: typeof receipt.status === "string" ? receipt.status : null,
        cause: typeof receipt.cause === "string" ? receipt.cause : null,
        action: receipt.action && typeof receipt.action === "object" ? receipt.action.committed || null : null,
      }]
      : []

    if (changeMetrics.length === 0) warnings.push(`${change}: no delegation telemetry matched the report window.`)
    if (!binding) warnings.push(`${change}: no entry_route_binding; route agreement is unknown.`)
    if (!gate) warnings.push(`${change}: no policy gate; risk tier is unknown.`)

    changes.push({
      change,
      work_type: workType,
      route,
      terminal_stage: terminalStage,
      canonical_stage: canonicalStage,
      completed_stages: completed,
      pending_stage: pendingStage,
      resumable: typeof state.resumable === "boolean" ? state.resumable : null,
      archived,
      source: changeMetrics.length > 0 ? "openspec+metrics" : "openspec-only",
      risk_tier: gate && typeof gate.risk_tier === "string" ? gate.risk_tier : null,
      gate_stage: gate && typeof gate.stage === "string" ? gate.stage : null,
      plan_mode: state.route && typeof state.route.plan === "string" ? state.route.plan : null,
      verification: state.route && typeof state.route.verification === "string" ? state.route.verification : null,
      predicted_route: predictedRoute,
      predicted_stages: binding && Array.isArray(binding.predicted_stages) ? binding.predicted_stages : null,
      route_agreement: routeAgreement,
      review,
      review_route_correct: review ? review.route === "correct" : null,
      review_risk_fit: review ? review.risk : null,
      review_plan_fit: review ? review.plan : null,
      review_gate_correct: review ? review.gate === "correct" : null,
      review_rating: review ? review.rating : null,
      metrics_count: changeMetrics.length,
      delegations: calls.length,
      stage_activity: stageActivity,
      attempts: ledger.length,
      failed_attempts: failedAttempts,
      rework_count: failedAttempts,
      first_pass: firstPass,
      receipts,
      override_count: overrides.length,
    })
  }

  const dataStatus = changes.length === 0
    ? "no_data"
    : changes.every((change) => change.metrics_count > 0) ? "complete" : "partial"
  return {
    mode: "decisions",
    data_status: dataStatus,
    days,
    total: changes.length,
    changes,
    aggregate: aggregateDecisions(changes),
    warnings,
  }
}

export function renderDecisionMarkdown(report) {
  if (!report || report.mode !== "decisions") return "# Decision evaluation\n\nInvalid report.\n"
  if (report.data_status === "no_data") {
    return "# Decision evaluation\n\nNo data. No OpenSpec changes were found.\n"
  }
  const aggregate = report.aggregate
  const rate = (value) => value === null || value === undefined ? "N/A" : `${Math.round(value * 100)}%`
  const lines = [
    "# Decision evaluation",
    "",
    `Data status: **${report.data_status}** · changes: **${report.total}** · window: ${report.days} days`,
    "",
    "## Aggregate",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Route agreement | ${aggregate.route_agreement.agreed}/${aggregate.route_agreement.compared} (${rate(aggregate.route_agreement.rate)}) |`,
    `| First-pass yield | ${aggregate.first_pass.count}/${aggregate.changes} (${rate(aggregate.first_pass.rate)}) |`,
    `| Changes with rework | ${aggregate.rework.changes}/${aggregate.changes} (${rate(aggregate.rework.rate)}) |`,
    `| Receipts | ${aggregate.receipts.count} |`,
    `| Overrides | ${aggregate.overrides} |`,
    `| Archived | ${aggregate.archive.count}/${aggregate.changes} (${rate(aggregate.archive.rate)}) |`,
    `| Reviews | ${aggregate.reviews.count}/${aggregate.changes} (${rate(aggregate.reviews.coverage)}) |`,
    `| Route correct (human) | ${aggregate.reviews.route_correct.count}/${aggregate.reviews.route_correct.total} (${rate(aggregate.reviews.route_correct.rate)}) |`,
    `| Risk fit | under ${aggregate.reviews.risk_fit.under || 0}, ok ${aggregate.reviews.risk_fit.ok || 0}, over ${aggregate.reviews.risk_fit.over || 0} |`,
    `| Plan fit | under ${aggregate.reviews.plan_fit.under || 0}, ok ${aggregate.reviews.plan_fit.ok || 0}, over ${aggregate.reviews.plan_fit.over || 0} |`,
    `| Gate correct (human) | ${aggregate.reviews.gate_correct.count}/${aggregate.reviews.gate_correct.total} (${rate(aggregate.reviews.gate_correct.rate)}) |`,
    `| Avg rating | ${aggregate.reviews.avg_rating === null ? "N/A" : aggregate.reviews.avg_rating.toFixed(1)} |`,
    "",
    "### Risk tiers",
    "",
    "| Tier | Changes |",
    "|---|---|",
    ...Object.entries(aggregate.risk_tiers).map(([tier, count]) => `| ${tier} | ${count} |`),
    "",
    "### Plan modes",
    "",
    "| Mode | Changes |",
    "|---|---|",
    ...Object.entries(aggregate.plan_modes).map(([mode, count]) => `| ${mode} | ${count} |`),
    "",
    "### Stage activity",
    "",
    "| Stage role | Calls | Ok | Blocked | Error | Avg ms |",
    "|---|---|---|---|---|---|",
    ...Object.entries(aggregate.stage_activity).map(([label, activity]) =>
      `| ${label} | ${activity.calls} | ${activity.ok} | ${activity.blocked} | ${activity.error} | ${activity.avg_duration_ms ?? "N/A"} |`),
    "",
    "### Human reviews",
    "",
    "| Change | Route | Risk | Plan | Gate | Rating |",
    "|---|---|---|---|---|---|",
    ...(report.changes.filter((change) => change.review).length > 0
      ? report.changes.filter((change) => change.review).map((change) =>
        `| ${change.change} | ${change.review.route} | ${change.review.risk} | ${change.review.plan} | ${change.review.gate} | ${change.review.rating} |`)
      : ["| — | — | — | — | — | — |"]),
    "",
    "## Changes",
    "",
    "| Change | Work type | Risk | Plan | First pass | Rework | Route agreement |",
    "|---|---|---|---|---|---|---|",
    ...report.changes.map((change) =>
      `| ${change.change} | ${change.work_type ?? "?"} | ${change.risk_tier ?? "N/A"} | ${change.plan_mode ?? "N/A"} | ${change.first_pass ? "yes" : "no"} | ${change.rework_count} | ${change.route_agreement === null ? "N/A" : change.route_agreement ? "yes" : "no"} |`),
    "",
  ]
  if (report.warnings.length > 0) {
    lines.push("## Warnings", "", ...report.warnings.map((warning) => `- ${warning}`), "")
  }
  return lines.join("\n")
}

function parseDecisionArgs(argv) {
  let days = 30
  let root = process.cwd()
  let markdown = false
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--md") {
      markdown = true
    } else if (arg === "--root") {
      const value = argv[++index]
      if (!value) return { error: "--root requires a directory" }
      root = value
    } else if (arg === "--days") {
      const value = argv[++index]
      if (!value || !/^\d+$/.test(value)) return { error: "--days requires a positive integer" }
      days = Number(value)
    } else if (/^\d+$/.test(arg)) {
      days = Number(arg)
    } else {
      return { error: `Unknown decisions argument: ${arg}` }
    }
  }
  if (!Number.isInteger(days) || days <= 0) return { error: "days must be a positive integer" }
  return { days, root, markdown }
}

function decisionReviewPath(root, change) {
  return path.join(path.resolve(root), ".odf", `decision-review-${change}.json`)
}

export function readDecisionReview(root, change) {
  if (typeof change !== "string" || !CHANGE_PATTERN.test(change)) return null
  const review = readJsonSafe(decisionReviewPath(root, change))
  if (!review || typeof review !== "object" || review.schema_version !== 1 || review.change !== change) return null
  if (!REVIEW_ROUTE_VALUES.includes(review.route) ||
    !REVIEW_FIT_VALUES.includes(review.risk) ||
    !REVIEW_FIT_VALUES.includes(review.plan) ||
    !REVIEW_ROUTE_VALUES.includes(review.gate) ||
    !Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) return null
  return review
}

/**
 * Persist one local, closed-label human review. No free text, no prompts, no
 * remote submission. A later review for the same change overwrites the file.
 */
export function writeDecisionReview({ root = process.cwd(), change, route, risk, plan, gate, rating } = {}) {
  const resolvedRoot = path.resolve(root)
  if (typeof change !== "string" || !CHANGE_PATTERN.test(change)) throw new Error("change must be a kebab-case name")
  if (!REVIEW_ROUTE_VALUES.includes(route)) throw new Error(`route must be one of ${REVIEW_ROUTE_VALUES.join(", ")}`)
  if (!REVIEW_FIT_VALUES.includes(risk)) throw new Error(`risk must be one of ${REVIEW_FIT_VALUES.join(", ")}`)
  if (!REVIEW_FIT_VALUES.includes(plan)) throw new Error(`plan must be one of ${REVIEW_FIT_VALUES.join(", ")}`)
  if (!REVIEW_ROUTE_VALUES.includes(gate)) throw new Error(`gate must be one of ${REVIEW_ROUTE_VALUES.join(", ")}`)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("rating must be an integer from 1 to 5")

  const review = {
    schema_version: 1,
    change,
    route,
    risk,
    plan,
    gate,
    rating,
    reviewed_at: new Date().toISOString(),
    source: "local-human-review",
  }
  fs.mkdirSync(path.join(resolvedRoot, ".odf"), { recursive: true })
  fs.writeFileSync(decisionReviewPath(resolvedRoot, change), JSON.stringify(review, null, 2), "utf8")
  return review
}

function parseReviewArgs(argv) {
  let root = process.cwd()
  let change = null
  const values = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--root") {
      const value = argv[++index]
      if (!value) return { error: "--root requires a directory" }
      root = value
    } else if (arg === "--route") {
      values.route = argv[++index]
    } else if (arg === "--risk") {
      values.risk = argv[++index]
    } else if (arg === "--plan") {
      values.plan = argv[++index]
    } else if (arg === "--gate") {
      values.gate = argv[++index]
    } else if (arg === "--rating") {
      const value = argv[++index]
      values.rating = value === undefined ? NaN : Number(value)
    } else if (arg.startsWith("--")) {
      return { error: `Unknown review argument: ${arg}` }
    } else if (!change) {
      change = arg
    } else {
      return { error: `Unexpected review argument: ${arg}` }
    }
  }
  if (!change) return { error: "review requires a change name" }
  if (!values.route || !values.risk || !values.plan || !values.gate || values.rating === undefined) {
    return { error: "review requires --route, --risk, --plan, --gate, and --rating" }
  }
  return { root, change, route: values.route, risk: values.risk, plan: values.plan, gate: values.gate, rating: values.rating }
}

export function readShadowJudgments(filePath) {
  return readJsonLines(filePath)
}

/**
 * Human/judge calibration over shadow-judgment entries. An unavailable or null
 * judge verdict is not a disagreement; it is excluded from the compared set.
 */
export function evaluateAgreement(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      mode: "agreement",
      data_status: "no_data",
      total: 0,
      compared: 0,
      agreement: 0,
      false_pass: 0,
      false_block: 0,
      unavailable: 0,
      rates: { agreement: null, false_pass: null, false_block: null, unavailable: null },
    }
  }
  let compared = 0
  let agreement = 0
  let falsePass = 0
  let falseBlock = 0
  let unavailable = 0
  for (const entry of entries) {
    const result = compareHumanJudge({
      human: entry && entry.human,
      judge: entry && entry.judge,
    })
    if (result.unavailable) {
      unavailable++
      continue
    }
    compared++
    if (result.agreement) agreement++
    if (result.false_pass) falsePass++
    if (result.false_block) falseBlock++
  }
  return {
    mode: "agreement",
    data_status: compared === 0 ? "no_data" : compared === entries.length ? "complete" : "partial",
    total: entries.length,
    compared,
    agreement,
    false_pass: falsePass,
    false_block: falseBlock,
    unavailable,
    rates: {
      agreement: compared > 0 ? agreement / compared : null,
      false_pass: compared > 0 ? falsePass / compared : null,
      false_block: compared > 0 ? falseBlock / compared : null,
      unavailable: entries.length > 0 ? unavailable / entries.length : null,
    },
  }
}

export function renderAgreementMarkdown(report) {
  if (!report || report.mode !== "agreement") return "# Human/judge agreement\n\nInvalid report.\n"
  if (report.data_status === "no_data") {
    return "# Human/judge agreement\n\nNo data. No comparable shadow judgments were found.\n"
  }
  const rate = (value) => value === null || value === undefined ? "N/A" : `${Math.round(value * 100)}%`
  return [
    "# Human/judge agreement",
    "",
    `Data status: **${report.data_status}** · total: **${report.total}** · compared: **${report.compared}**`,
    "",
    "| Metric | Count | Rate |",
    "|---|---|---|",
    `| Agreement | ${report.agreement} | ${rate(report.rates.agreement)} |`,
    `| False pass | ${report.false_pass} | ${rate(report.rates.false_pass)} |`,
    `| False block | ${report.false_block} | ${rate(report.rates.false_block)} |`,
    `| Unavailable | ${report.unavailable} | ${rate(report.rates.unavailable)} |`,
    "",
  ].join("\n")
}

function parseAgreementArgs(argv) {
  let root = process.cwd()
  let file = null
  let markdown = false
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--md") {
      markdown = true
    } else if (arg === "--root") {
      const value = argv[++index]
      if (!value) return { error: "--root requires a directory" }
      root = value
    } else if (arg === "--file") {
      const value = argv[++index]
      if (!value) return { error: "--file requires a path" }
      file = value
    } else if (arg.startsWith("--")) {
      return { error: `Unknown agreement argument: ${arg}` }
    } else if (!file) {
      file = arg
    } else {
      return { error: `Unexpected agreement argument: ${arg}` }
    }
  }
  return { root, file: file || path.join(path.resolve(root), ".odf", "shadow-judgments.jsonl"), markdown }
}

const HIGHER_IS_BETTER = {
  changes: null,
  route_agreement_rate: true,
  first_pass_rate: true,
  rework_rate: false,
  receipts: false,
  overrides: false,
  archive_rate: true,
  review_coverage: true,
  review_route_correct_rate: true,
  review_gate_correct_rate: true,
  review_avg_rating: true,
}

function decisionMetricSummary(report) {
  const aggregate = report.aggregate || {}
  return {
    changes: report.total ?? 0,
    route_agreement_rate: aggregate.route_agreement?.rate ?? null,
    first_pass_rate: aggregate.first_pass?.rate ?? null,
    rework_rate: aggregate.rework?.rate ?? null,
    receipts: aggregate.receipts?.count ?? 0,
    overrides: aggregate.overrides ?? 0,
    archive_rate: aggregate.archive?.rate ?? null,
    review_coverage: aggregate.reviews?.coverage ?? null,
    review_route_correct_rate: aggregate.reviews?.route_correct?.rate ?? null,
    review_gate_correct_rate: aggregate.reviews?.gate_correct?.rate ?? null,
    review_avg_rating: aggregate.reviews?.avg_rating ?? null,
  }
}

export function compareDecisions(before, after) {
  if (!before || before.mode !== "decisions" || !after || after.mode !== "decisions") {
    return {
      mode: "comparison",
      data_status: "no_data",
      before: null,
      after: null,
      deltas: {},
      warnings: ["compare requires two decisions reports."],
    }
  }
  if (before.data_status === "no_data" || after.data_status === "no_data") {
    return {
      mode: "comparison",
      data_status: "no_data",
      before: decisionMetricSummary(before),
      after: decisionMetricSummary(after),
      deltas: {},
      warnings: ["At least one report has no data."],
    }
  }
  const beforeMetrics = decisionMetricSummary(before)
  const afterMetrics = decisionMetricSummary(after)
  const deltas = {}
  for (const key of Object.keys(beforeMetrics)) {
    const beforeValue = beforeMetrics[key]
    const afterValue = afterMetrics[key]
    if (typeof beforeValue === "number" && typeof afterValue === "number") {
      const delta = afterValue - beforeValue
      deltas[key] = {
        before: beforeValue,
        after: afterValue,
        delta,
        direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
        higher_is_better: HIGHER_IS_BETTER[key] ?? null,
      }
    } else {
      deltas[key] = {
        before: beforeValue,
        after: afterValue,
        delta: null,
        direction: null,
        higher_is_better: HIGHER_IS_BETTER[key] ?? null,
      }
    }
  }
  return {
    mode: "comparison",
    data_status: before.data_status === "complete" && after.data_status === "complete" ? "complete" : "partial",
    before: beforeMetrics,
    after: afterMetrics,
    deltas,
    warnings: [],
  }
}

function formatMetricValue(key, value) {
  if (value === null || value === undefined) return "N/A"
  if (key.endsWith("_rate") || key === "review_coverage") return `${Math.round(value * 100)}%`
  if (key === "review_avg_rating") return value.toFixed(1)
  return String(value)
}

function formatDelta(key, delta) {
  if (delta === null || delta === undefined) return "N/A"
  const sign = delta > 0 ? "+" : ""
  if (key.endsWith("_rate") || key === "review_coverage") return `${sign}${Math.round(delta * 100)}pp`
  if (key === "review_avg_rating") return `${sign}${delta.toFixed(1)}`
  return `${sign}${delta}`
}

export function renderComparisonMarkdown(report) {
  if (!report || report.mode !== "comparison") return "# Decision comparison\n\nInvalid report.\n"
  if (report.data_status === "no_data") {
    return "# Decision comparison\n\nNo data. Save two `decisions` reports before comparing.\n"
  }
  const labels = {
    changes: "Changes",
    route_agreement_rate: "Route agreement",
    first_pass_rate: "First-pass yield",
    rework_rate: "Rework rate",
    receipts: "Receipts",
    overrides: "Overrides",
    archive_rate: "Archive rate",
    review_coverage: "Review coverage",
    review_route_correct_rate: "Route correct (human)",
    review_gate_correct_rate: "Gate correct (human)",
    review_avg_rating: "Average rating",
  }
  return [
    "# Decision comparison",
    "",
    `Data status: **${report.data_status}**`,
    "",
    "| Metric | Before | After | Delta | Direction |",
    "|---|---|---|---|---|",
    ...Object.entries(report.deltas).map(([key, value]) =>
      `| ${labels[key] || key} | ${formatMetricValue(key, value.before)} | ${formatMetricValue(key, value.after)} | ${formatDelta(key, value.delta)} | ${value.direction || "N/A"} |`),
    "",
  ].join("\n")
}

function parseCompareArgs(argv) {
  let markdown = false
  const files = []
  for (const arg of argv) {
    if (arg === "--md") markdown = true
    else if (arg.startsWith("--")) return { error: `Unknown compare argument: ${arg}` }
    else files.push(arg)
  }
  if (files.length !== 2) return { error: "compare requires exactly two report files: <before.json> <after.json>" }
  return { before: files[0], after: files[1], markdown }
}

/**
 * Review cadence over local decision reviews. Advisory only: it never blocks
 * archive, verify, or workflow.
 */
export function evaluateCadence({ root = process.cwd(), days = 30 } = {}) {
  const resolvedRoot = path.resolve(root)
  const changes = listStateChanges(resolvedRoot)
  const reviews = changes.map((change) => readDecisionReview(resolvedRoot, change)).filter(Boolean)
  const latestReviewAt = reviews
    .map((review) => review.reviewed_at)
    .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) || null
  const ageDays = latestReviewAt ? Math.max(0, Math.floor((Date.now() - Date.parse(latestReviewAt)) / 86_400_000)) : null
  const coverage = changes.length > 0 ? reviews.length / changes.length : null
  const due = reviews.length === 0 || ageDays === null || ageDays > days
  const message = changes.length === 0
    ? "No OpenSpec changes were found."
    : reviews.length === 0
      ? "No local decision reviews recorded; run review at the next archive/verify."
      : due
        ? `Latest review is ${ageDays} days old (cadence ${days} days); review is due.`
        : `Latest review is ${ageDays} days old; cadence is current.`
  return {
    mode: "cadence",
    data_status: changes.length === 0 ? "no_data" : coverage === 1 ? "complete" : "partial",
    due,
    days,
    changes: changes.length,
    reviewed_changes: reviews.length,
    review_count: reviews.length,
    coverage,
    latest_review_at: latestReviewAt,
    age_days: ageDays,
    message,
  }
}

export function renderCadenceMarkdown(report) {
  if (!report || report.mode !== "cadence") return "# Review cadence\n\nInvalid report.\n"
  if (report.data_status === "no_data") {
    return "# Review cadence\n\nNo data. No OpenSpec changes were found.\n"
  }
  return [
    "# Review cadence",
    "",
    `Data status: **${report.data_status}** · due: **${report.due ? "yes" : "no"}**`,
    "",
    `- Changes: ${report.changes}`,
    `- Reviewed changes: ${report.reviewed_changes}`,
    `- Coverage: ${report.coverage === null ? "N/A" : `${Math.round(report.coverage * 100)}%`}`,
    `- Latest review: ${report.latest_review_at || "N/A"}`,
    `- Age: ${report.age_days === null ? "N/A" : `${report.age_days} days`}`,
    `- Cadence: ${report.days} days`,
    "",
    report.message,
    "",
  ].join("\n")
}

function parseCadenceArgs(argv) {
  let root = process.cwd()
  let days = 30
  let markdown = false
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--md") {
      markdown = true
    } else if (arg === "--root") {
      const value = argv[++index]
      if (!value) return { error: "--root requires a directory" }
      root = value
    } else if (arg === "--days") {
      const value = argv[++index]
      if (!value || !/^\d+$/.test(value)) return { error: "--days requires a positive integer" }
      days = Number(value)
    } else if (/^\d+$/.test(arg)) {
      days = Number(arg)
    } else {
      return { error: `Unknown cadence argument: ${arg}` }
    }
  }
  if (!Number.isInteger(days) || days <= 0) return { error: "days must be a positive integer" }
  return { root, days, markdown }
}

/**
 * Deterministic, advisory proposals derived from one decisions report. Every
 * proposal requires explicit human approval and none is applied automatically.
 */
export function buildProposals(report) {
  if (!report || report.mode !== "decisions" || report.data_status === "no_data") {
    return {
      mode: "proposals",
      data_status: "no_data",
      proposals: [],
      warnings: ["No decisions report data; no proposals were generated."],
    }
  }
  const aggregate = report.aggregate || {}
  const route = aggregate.route_agreement || {}
  const firstPass = aggregate.first_pass || {}
  const rework = aggregate.rework || {}
  const reviews = aggregate.reviews || {}
  const riskFit = reviews.risk_fit || {}
  const planFit = reviews.plan_fit || {}
  const gateCorrect = reviews.gate_correct || {}
  const proposals = []
  const add = (id, kind, severity, evidence, recommendation) => proposals.push({
    id,
    kind,
    severity,
    evidence,
    recommendation,
    requires_human_approval: true,
    auto_apply: false,
  })

  if (route.rate !== null && route.rate !== undefined && route.rate < 0.8) {
    add("route-alignment", "route", "high", { rate: route.rate, compared: route.compared }, "Review triage and route mapping for the mismatched changes; add a golden for each confirmed misroute.")
  }
  if ((riskFit.under || 0) > 0) {
    add("risk-underestimated", "risk", "high", { under: riskFit.under, ok: riskFit.ok || 0, over: riskFit.over || 0 }, "Raise the default risk tier or add protected signals for the affected work types.")
  }
  if ((planFit.under || 0) > 0) {
    add("plan-underestimated", "plan", "high", { under: planFit.under, ok: planFit.ok || 0, over: planFit.over || 0 }, "Require formal PLAN or QA-PLAN earlier for the affected route or risk tier.")
  }
  if (gateCorrect.rate !== null && gateCorrect.rate !== undefined && gateCorrect.rate < 1) {
    add("gate-review", "gate", "medium", { rate: gateCorrect.rate, total: gateCorrect.total }, "Inspect the gate marked incorrect and add a focused golden before changing any rule.")
  }
  if (rework.rate !== null && rework.rate !== undefined && rework.rate > 0.2) {
    add("rework-hotspot", "rework", "medium", { rate: rework.rate, changes: rework.changes }, "Inspect the stage or role with the most failed attempts; consider a plan or agent adjustment.")
  }
  if (firstPass.rate !== null && firstPass.rate !== undefined && firstPass.rate < 0.7) {
    add("first-pass-yield", "quality", "medium", { rate: firstPass.rate, count: firstPass.count, changes: aggregate.changes }, "Review receipts and failed attempts for the dominant cause before changing the harness.")
  }
  if (reviews.coverage !== null && reviews.coverage !== undefined && reviews.coverage < 0.5) {
    add("review-coverage", "process", "low", { coverage: reviews.coverage, count: reviews.count, changes: aggregate.changes }, "Record local decision reviews at archive or verify to build ground truth.")
  }
  return {
    mode: "proposals",
    data_status: "complete",
    proposals,
    warnings: proposals.length === 0 ? ["No proposal thresholds were crossed."] : [],
  }
}

export function renderProposalsMarkdown(report) {
  if (!report || report.mode !== "proposals") return "# Improvement proposals\n\nInvalid report.\n"
  if (report.data_status === "no_data") {
    return "# Improvement proposals\n\nNo data. Save a `decisions` report with data first.\n"
  }
  const lines = [
    "# Improvement proposals",
    "",
    `Proposals: **${report.proposals.length}** · every proposal requires human approval and is never applied automatically.`,
    "",
  ]
  if (report.proposals.length === 0) {
    lines.push("No proposal thresholds were crossed.", "")
    return lines.join("\n")
  }
  for (const proposal of report.proposals) {
    lines.push(
      `## ${proposal.id} — ${proposal.kind} (${proposal.severity})`,
      "",
      `Evidence: \`${JSON.stringify(proposal.evidence)}\``,
      "",
      proposal.recommendation,
      "",
      "Requires human approval: **yes** · Auto apply: **no**",
      "",
    )
  }
  return lines.join("\n")
}

function parseProposalsArgs(argv) {
  let file = null
  let markdown = false
  for (const arg of argv) {
    if (arg === "--md") markdown = true
    else if (arg.startsWith("--")) return { error: `Unknown proposals argument: ${arg}` }
    else if (!file) file = arg
    else return { error: `Unexpected proposals argument: ${arg}` }
  }
  if (!file) return { error: "proposals requires a decisions report file" }
  return { file, markdown }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"))
}

function parseOnlineArgs(input, daysArg) {
  const day = (value) => typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null
  const inputDays = day(input)
  const argDays = day(daysArg)
  if (inputDays !== null && argDays !== null) return { error: "online accepts a metrics file or a day count, not both" }
  if (inputDays !== null) return { file: null, days: inputDays }
  if (input) return { file: input, days: argDays ?? 7 }
  return { file: null, days: argDays ?? 7 }
}

export function main(argv = process.argv.slice(2)) {
  const [mode, input, daysArg] = argv
  if (mode === "offline" && input) return evaluateOffline(readJson(input))
  if (mode === "golden" && input) return evaluateGoldens(readJson(input))
  if (mode === "online") {
    const parsed = parseOnlineArgs(input, daysArg)
    if (parsed.error) throw new Error(parsed.error)
    const records = parsed.file ? readJson(parsed.file) : collectDelegations(resolveMetricsDir(), parsed.days)
    return evaluateOnline(records, parsed.days)
  }
  if (mode === "decisions") {
    const parsed = parseDecisionArgs(argv.slice(1))
    if (parsed.error) throw new Error(parsed.error)
    const report = evaluateDecisions({ root: parsed.root, days: parsed.days })
    return parsed.markdown ? renderDecisionMarkdown(report) : report
  }
  if (mode === "review") {
    const parsed = parseReviewArgs(argv.slice(1))
    if (parsed.error) throw new Error(parsed.error)
    return writeDecisionReview(parsed)
  }
  if (mode === "agreement") {
    const parsed = parseAgreementArgs(argv.slice(1))
    if (parsed.error) throw new Error(parsed.error)
    const report = evaluateAgreement(readShadowJudgments(parsed.file))
    return parsed.markdown ? renderAgreementMarkdown(report) : report
  }
  if (mode === "compare") {
    const parsed = parseCompareArgs(argv.slice(1))
    if (parsed.error) throw new Error(parsed.error)
    const report = compareDecisions(readJson(parsed.before), readJson(parsed.after))
    return parsed.markdown ? renderComparisonMarkdown(report) : report
  }
  if (mode === "cadence") {
    const parsed = parseCadenceArgs(argv.slice(1))
    if (parsed.error) throw new Error(parsed.error)
    const report = evaluateCadence({ root: parsed.root, days: parsed.days })
    return parsed.markdown ? renderCadenceMarkdown(report) : report
  }
  if (mode === "proposals") {
    const parsed = parseProposalsArgs(argv.slice(1))
    if (parsed.error) throw new Error(parsed.error)
    const report = buildProposals(readJson(parsed.file))
    return parsed.markdown ? renderProposalsMarkdown(report) : report
  }
  throw new Error("Usage: odf-evaluation offline <fixtures.json> | golden <goldens.json> | online [metrics.json|days] [days] | decisions [days] [--root <dir>] [--md] | review <change> --route <value> --risk <value> --plan <value> --gate <value> --rating <1-5> [--root <dir>] | agreement [file] [--root <dir>] [--md] | compare <before.json> <after.json> [--md] | cadence [days] [--root <dir>] [--md] | proposals <report.json> [--md]")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = main()
  if (typeof output === "string") process.stdout.write(output)
  else console.log(JSON.stringify(output, null, 2))
}
