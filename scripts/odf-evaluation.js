#!/usr/bin/env node
import * as fs from "node:fs"
import * as path from "node:path"
import YAML from "yaml"
import { buildDashboard, collectDelegations, recordStageRole, resolveMetricsDir } from "./odf-metrics.js"

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
  throw new Error("Usage: odf-evaluation offline <fixtures.json> | golden <goldens.json> | online [metrics.json|days] [days] | decisions [days] [--root <dir>] [--md]")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = main()
  if (typeof output === "string") process.stdout.write(output)
  else console.log(JSON.stringify(output, null, 2))
}
