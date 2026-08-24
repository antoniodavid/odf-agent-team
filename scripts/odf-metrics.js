#!/usr/bin/env node
/**
 * ODF Agent Observatory — read-only metrics dashboard over the plugin JSONL.
 *
 * Canonical source: the delegation log written by the plugin at
 * ${ODF_CONFIG_DIR:-~/.config/opencode}/metrics/delegations-YYYY-MM-DD.jsonl.
 * This script aggregates those lines; it never writes to Engram and never
 * appends to the metrics directory (the plugin owns the writer side).
 *
 * Usage:
 *   node scripts/odf-metrics.js [--days N]
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { estimateFromHistory } from "./odf-estimator.js"
import { readLibrary, resolveLibraryPath } from "./odf-design-library.js"

export function resolveMetricsDir() {
  const configDir = process.env.ODF_CONFIG_DIR
    ? path.resolve(process.env.ODF_CONFIG_DIR)
    : path.join(os.homedir(), ".config", "opencode")
  return path.join(configDir, "metrics")
}

/** Parse a delegation log file, skipping malformed lines. */
export function readDelegationFile(filePath) {
  let content
  try {
    content = fs.readFileSync(filePath, "utf8")
  } catch {
    return []
  }
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/** Collect delegation records within the last N days (UTC filenames). */
export function collectDelegations(metricsDir, days) {
  if (days < 1) days = 1
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1))
  const cutoffDay = cutoff.toISOString().split("T")[0]

  let files = []
  try {
    files = fs.readdirSync(metricsDir)
  } catch {
    return []
  }

  return files
    .filter((f) => f.startsWith("delegations-") && f.endsWith(".jsonl"))
    .filter((f) => f.slice("delegations-".length, -".jsonl".length) >= cutoffDay)
    .flatMap((f) => readDelegationFile(path.join(metricsDir, f)))
}

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const MAX_JOIN_COUNT = 3

function safeToken(value) {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value) ? value : null
}

function boundedCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_JOIN_COUNT ? value : null
}

function boundedRatio(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

function joinRecord(record) {
  const status = record.join_status
  if (status !== "running" && status !== "complete" && status !== "blocked") return null
  const expected = boundedCount(record.join_expected)
  const completed = boundedCount(record.join_completed)
  const failed = boundedCount(record.join_failed)
  const running = boundedCount(record.join_running)
  if (expected === null || completed === null || failed === null || running === null || completed > expected || failed > expected || running > expected) return null
  return {
    status,
    expected,
    completed,
    failed,
    running,
    validationRatio: boundedRatio(record.validation_ratio),
  }
}

/** Coverage requires the complete O1 identity/lifecycle proof, not legacy T7 fields. */
const VALID_OUTCOME_STATUSES = new Set(["ok", "blocked", "error", "timeout"])

function isSpanRecord(record) {
  return !!record && record.event === "span"
}

function hasTelemetry(record) {
  return !!record &&
    record.schema_version === 1 &&
    record.event === "run" &&
    record.lifecycle === "finished" &&
    safeToken(record.run_id) !== null &&
    safeToken(record.change) !== null &&
    safeToken(record.trace_id) !== null &&
    safeToken(record.span_id) !== null &&
    VALID_OUTCOME_STATUSES.has(record.status)
}

function hasSpanTelemetry(record) {
  if (!record || record.schema_version !== 1 || record.event !== "span") return false
  if (record.lifecycle !== "started" && record.lifecycle !== "finished") return false
  if (safeToken(record.trace_id) === null || safeToken(record.span_id) === null || safeToken(record.parent_span_id) === null) return false
  if (record.span_kind !== "branch" && record.span_kind !== "task") return false
  return record.span_kind !== "branch" || (safeToken(record.branch_id) !== null && safeToken(record.attempt_id) !== null)
}

function isLifecycleRecord(record) {
  return !!record && record.event === "run" &&
    (record.lifecycle === "started" || record.lifecycle === "finished") &&
    safeToken(record.run_id) !== null
}

function lifecycleState(records) {
  const started = new Set()
  const finished = new Set()
  for (const record of records) {
    if (joinRecord(record) || isSpanRecord(record) || !isLifecycleRecord(record)) continue
    const runId = safeToken(record.run_id)
    if (record.lifecycle === "started") started.add(runId)
    else finished.add(runId)
  }
  const unfinishedRunIds = [...started].filter(runId => !finished.has(runId))
  return {
    startedCount: started.size,
    unfinishedCount: unfinishedRunIds.length,
    unfinishedRunIds,
  }
}

function aggregationRecords(records) {
  const finishedRunIds = new Set()
  return new Set(records.filter(record => {
    if (isSpanRecord(record)) return false
    if (joinRecord(record)) return false
    if (!isLifecycleRecord(record)) return true
    if (record.lifecycle === "started") return false
    const runId = safeToken(record.run_id)
    if (finishedRunIds.has(runId)) return false
    finishedRunIds.add(runId)
    return true
  }))
}

/* ------------------------------------------------------------------ */
/* C2 — learning / estimation progress (MAPE + library stats)           */
/* ------------------------------------------------------------------ */

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const stddev = (xs) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

// Group all indexed designs by the estimator's bucket key (work_type + risk +
// module_type); avg_rounds_real is the mean over entries WITH rounds_real
// (null when a bucket has none — never invented).
function bucketStats(designs) {
  const byKey = new Map()
  for (const d of designs) {
    const meta = d && d.design_meta ? d.design_meta : {}
    const key = `${meta.work_type ?? ""}|${meta.risk ?? ""}|${meta.module_type ?? ""}`
    if (!byKey.has(key)) {
      byKey.set(key, { work_type: meta.work_type ?? "", risk: meta.risk ?? "", module_type: meta.module_type ?? "", n: 0, rounds: [] })
    }
    const b = byKey.get(key)
    b.n += 1
    if (Number.isFinite(d.rounds_real) && d.rounds_real > 0) b.rounds.push(d.rounds_real)
  }
  return [...byKey.values()]
    .map((b) => ({
      work_type: b.work_type,
      risk: b.risk,
      module_type: b.module_type,
      n: b.n,
      avg_rounds_real: b.rounds.length ? Number(mean(b.rounds).toFixed(2)) : null,
    }))
    .sort((a, b) => b.n - a.n || `${a.work_type}|${a.risk}|${a.module_type}`.localeCompare(`${b.work_type}|${b.risk}|${b.module_type}`))
}

// Leave-one-out MAPE over the real estimator: for each design with rounds_real,
// estimate it from every OTHER design (the estimator keeps same-bucket ones)
// and measure |estimated_total_rounds - real| / real. Estimates that come back
// no_data (no same-bucket peer) are skipped, not counted as zero error.
function computeMape(withEffort) {
  if (withEffort.length < 2) return { value: null, n: 0, sigma: null, label: "N/A" }
  const aps = []
  for (const d of withEffort) {
    const peers = withEffort.filter((p) => p !== d)
    const est = estimateFromHistory(d.design_meta, peers)
    if (est.data_status !== "complete" || !est.estimate || est.estimate.total_rounds <= 0) continue
    aps.push(Math.abs(est.estimate.total_rounds - d.rounds_real) / d.rounds_real)
  }
  if (aps.length === 0) return { value: null, n: 0, sigma: null, label: "N/A" }
  const value = Number(mean(aps).toFixed(4))
  return { value, n: aps.length, sigma: Number(stddev(aps).toFixed(4)), label: `${Math.round(value * 100)}%` }
}

/**
 * Continuous-improvement signal over the design library (C2). Reports library
 * size, per-bucket effort stats, and a leave-one-out MAPE of the estimator
 * against real effort. Honesty contract (T8): with an empty library or fewer
 * than 2 designs carrying rounds_real it returns data_status "no_data" with
 * mape.value null / label "N/A" — never 0 nor NaN.
 *
 * reuse_proxy is a simple stand-in for reuse: the number of indexed designs
 * (no reuse telemetry is captured today).
 */
export function learningProgress(library) {
  const designs = library && Array.isArray(library.designs) ? library.designs : []
  const withEffort = designs.filter((d) => d && d.design_meta && Number.isFinite(d.rounds_real) && d.rounds_real > 0)
  const mape = computeMape(withEffort)
  return {
    data_status: mape.n > 0 ? "complete" : "no_data",
    design_count: designs.length,
    by_bucket: bucketStats(designs),
    mape,
    reuse_proxy: designs.length,
  }
}

/** Build the dashboard from delegation records. */
export function buildDashboard(records, days, library = null) {
  const lifecycle = lifecycleState(records)
  const aggregate = aggregationRecords(records)
  let total = 0
  const byAgent = new Map()
  const byWorkType = new Map()
  const byBranch = new Map()
  const byJoinStatus = new Map()
  const skills = new Map()
  const errors = []
  let durationSum = 0
  let tokensSum = 0
  let selfDiscovered = 0
  let validationRatioSum = 0
  let validationRatioCount = 0

  for (const r of records) {
    if (isSpanRecord(r)) continue
    const join = joinRecord(r)
    if (join) {
      if (!byJoinStatus.has(join.status)) {
        byJoinStatus.set(join.status, { count: 0, expected: 0, completed: 0, failed: 0, running: 0, validationRatioSum: 0, validationRatioCount: 0 })
      }
      const aggregate = byJoinStatus.get(join.status)
      aggregate.count += 1
      aggregate.expected += join.expected
      aggregate.completed += join.completed
      aggregate.failed += join.failed
      aggregate.running += join.running
      if (join.validationRatio !== null) {
        aggregate.validationRatioSum += join.validationRatio
        aggregate.validationRatioCount += 1
        validationRatioSum += join.validationRatio
        validationRatioCount += 1
      }
      continue
    }

    if (!aggregate.has(r)) continue

    total += 1
    const duration = typeof r.duration_ms === "number" && Number.isFinite(r.duration_ms) && r.duration_ms >= 0 ? r.duration_ms : 0
    const tokens = typeof r.token_estimate === "number" && Number.isFinite(r.token_estimate) && r.token_estimate >= 0 ? r.token_estimate : 0
    durationSum += duration
    tokensSum += tokens
    if (r.skill_resolution === "none") selfDiscovered += 1
    if (r.status === "error" || r.status === "timeout") {
      errors.push({ timestamp: r.timestamp, agent: safeToken(r.agent) || "unknown", error: r.error || r.status, duration_ms: duration })
    }
    const agent = safeToken(r.agent) || "unknown"
    if (!byAgent.has(agent)) {
      byAgent.set(agent, { count: 0, duration: 0, tokens: 0, resolved: 0 })
    }
    const a = byAgent.get(agent)
    a.count += 1
    a.duration += duration
    a.tokens += tokens
    if (r.skill_resolution === "injected") a.resolved += 1
    for (const s of Array.isArray(r.skills_injected) ? r.skills_injected : []) {
      skills.set(s, (skills.get(s) || 0) + 1)
    }

    const workType = safeToken(r.work_type)
    if (workType) {
      if (!byWorkType.has(workType)) byWorkType.set(workType, { count: 0, duration: 0 })
      const work = byWorkType.get(workType)
      work.count += 1
      work.duration += duration
    }

    const branch = safeToken(r.branch_id)
    if (branch) {
      if (!byBranch.has(branch)) byBranch.set(branch, { count: 0, duration: 0 })
      const branchStats = byBranch.get(branch)
      branchStats.count += 1
      branchStats.duration += duration
    }

  }

  const fmtDur = (ms) => `${Math.round((ms || 0) / 1000)}s`
  const fmtTokens = (n) => (n || 0).toLocaleString()
  // Returns null (not 0/100) when there is no base — a percentage over zero
  // records would misrepresent "no data" as a real figure.
  const pct = (part, tot) => (tot > 0 ? Math.round((part / tot) * 100) : null)
  const fmtRatio = (ratio) => ratio === null ? "n/a" : `${Math.round(ratio * 100)}%`

  const agentRows = [...byAgent.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([agent, a]) => {
      const name = agent.length > 18 ? agent.slice(0, 15) + "..." : agent
      return `${name.padEnd(18)} ${String(a.count).padStart(11)} ${fmtDur(a.duration / a.count).padStart(9)} ${fmtTokens(a.tokens / a.count).padStart(12)} ${String(pct(a.resolved, a.count) + "%").padStart(11)}`
    })

  const workTypeRows = [...byWorkType.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([workType, stats]) => `  ${workType.padEnd(20)} ${String(stats.count).padStart(11)} ${fmtDur(stats.duration / stats.count).padStart(9)}`)

  const branchRows = [...byBranch.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([branch, stats]) => `  ${branch.padEnd(20)} ${String(stats.count).padStart(8)} ${fmtDur(stats.duration).padStart(11)} ${fmtDur(stats.duration / stats.count).padStart(9)}`)

  const joinRows = [...byJoinStatus.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([status, join]) => {
      const ratio = join.validationRatioCount > 0 ? join.validationRatioSum / join.validationRatioCount : null
      return `  ${status.padEnd(10)} ${String(join.count).padStart(6)} ${String(join.expected).padStart(8)} ${String(join.completed).padStart(9)} ${String(join.failed).padStart(7)} ${String(join.running).padStart(8)} ${fmtRatio(ratio).padStart(10)}`
    })

  const skillRows = [...skills.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name, n]) => `  ${name.padEnd(38)} ${n}`)

  const errorRows = errors
    .slice(0, 10)
    .map((e) => `  ${String(e.timestamp || "unknown").slice(0, 64)} | ${e.agent} | ${String(e.error || "").replace(/\s+/g, " ").slice(0, 80)} | ${fmtDur(e.duration_ms)}`)

  // Partial means an unfinished run exists or a finished aggregate record lacks
  // the T7 telemetry fields. Started markers never inflate this denominator.
  const coverageRecords = records.filter(r => !joinRecord(r) && aggregate.has(r))
  const withTelemetry = coverageRecords.filter(hasTelemetry).length
  const spanRecords = records.filter(isSpanRecord)
  const spansWithTelemetry = spanRecords.filter(hasSpanTelemetry).length
  const branchRecords = spanRecords.filter(record => record.span_kind === "branch")
  const branchesWithTelemetry = branchRecords.filter(hasSpanTelemetry).length
  const fieldRecords = records.filter(r => !joinRecord(r))
  const fieldCoverage = (predicate) => ({
    records: fieldRecords.length,
    available: fieldRecords.filter(predicate).length,
    coverage: fieldRecords.length > 0 ? fieldRecords.filter(predicate).length / fieldRecords.length : null,
  })
  const telemetryCoverage = {
    runs: {
      records: coverageRecords.length,
      available: withTelemetry,
      coverage: coverageRecords.length > 0 ? withTelemetry / coverageRecords.length : null,
    },
    spans: {
      records: spanRecords.length,
      available: spansWithTelemetry,
      coverage: spanRecords.length > 0 ? spansWithTelemetry / spanRecords.length : null,
    },
    branch: {
      records: branchRecords.length,
      available: branchesWithTelemetry,
      coverage: branchRecords.length > 0 ? branchesWithTelemetry / branchRecords.length : null,
    },
    model: fieldCoverage(record => record.model_available === true && typeof record.model === "string"),
    provider: fieldCoverage(record => typeof record.provider === "string"),
    real_tokens: fieldCoverage(record => {
      const tokens = record.tokens
      return !!tokens && (typeof tokens.input === "number" || typeof tokens.output === "number")
    }),
  }
  const partial = lifecycle.unfinishedCount > 0 || coverageRecords.length > 0 && withTelemetry < coverageRecords.length
  const data_status = total === 0 ? lifecycle.unfinishedCount > 0 ? "partial" : "no_data" : partial ? "partial" : "complete"

  return {
    total,
    data_status,
    coverage: coverageRecords.length > 0 ? withTelemetry / coverageRecords.length : null,
    records_with_telemetry: withTelemetry,
    span_coverage: telemetryCoverage.spans.coverage,
    span_records: spanRecords.length,
    records_with_span_telemetry: spansWithTelemetry,
    branch_coverage: telemetryCoverage.branch.coverage,
    branch_records: branchRecords.length,
    records_with_branch_telemetry: branchesWithTelemetry,
    telemetry_coverage: telemetryCoverage,
    startedCount: lifecycle.startedCount,
    unfinishedCount: lifecycle.unfinishedCount,
    unfinishedRunIds: lifecycle.unfinishedRunIds,
    avgDurationMs: total > 0 ? durationSum / total : 0,
    avgTokens: total > 0 ? tokensSum / total : 0,
    selfDiscoveredPct: pct(selfDiscovered, total),
    selfDiscoveredPctLabel: total > 0 ? `${pct(selfDiscovered, total)}%` : "N/A",
    skillInjectionPct: pct(total - selfDiscovered, total),
    skillInjectionPctLabel: total > 0 ? `${pct(total - selfDiscovered, total)}%` : "N/A",
    errorsCount: errors.length,
    errorPct: pct(errors.length, total),
    errorPctLabel: total > 0 ? `${pct(errors.length, total)}%` : "N/A",
    agentRows,
    workTypeRows,
    branchRows,
    joinRows,
    validationRatio: validationRatioCount > 0 ? validationRatioSum / validationRatioCount : null,
    skillRows,
    errorRows,
    days,
    learning: learningProgress(library),
  }
}

export function renderDashboard(d) {
  const lines = [
    `ODF: Agent Observatory (last ${d.days}d)`,
    "",
    "=== Overall ===",
    `  Total delegations: ${d.total}`,
    `  Avg duration: ${d.total > 0 ? `${Math.round(d.avgDurationMs / 1000)}s` : "N/A"}`,
    `  Avg tokens: ${d.total > 0 ? `${Math.round(d.avgTokens)}` : "N/A"}`,
    `  Skill resolution rate: ${d.skillInjectionPctLabel} injected`,
    `  Validation ratio: ${d.validationRatio === null ? "n/a" : `${Math.round(d.validationRatio * 100)}%`}`,
    `  Errors: ${d.errorsCount} (${d.errorPctLabel})`,
    `  Unfinished runs: ${d.unfinishedCount || 0}`,
    "",
    "=== By Agent ===",
    `  ${"Agent".padEnd(18)} ${"Delegations".padStart(11)} ${"Avg Dur".padStart(9)} ${"Avg Tokens".padStart(12)} ${"Resolution".padStart(11)}`,
  ]
  if (d.agentRows.length > 0) {
    lines.push(...d.agentRows)
  } else {
    lines.push("  (no delegations)")
  }
  lines.push("", "=== By Work Type ===", `  ${"Work Type".padEnd(20)} ${"Delegations".padStart(11)} ${"Total Dur".padStart(9)}`)
  lines.push(...(d.workTypeRows.length > 0 ? d.workTypeRows : ["  (none)"]))
  lines.push("", "=== By Branch (duration) ===", `  ${"Branch".padEnd(20)} ${"Calls".padStart(8)} ${"Total Dur".padStart(11)} ${"Avg Dur".padStart(9)}`)
  lines.push(...(d.branchRows.length > 0 ? d.branchRows : ["  (none)"]))
  lines.push("", "=== Scheduler Joins ===", `  ${"Status".padEnd(10)} ${"Events".padStart(6)} ${"Expected".padStart(8)} ${"Completed".padStart(9)} ${"Failed".padStart(7)} ${"Running".padStart(8)} ${"Validation".padStart(10)}`)
  lines.push(...(d.joinRows.length > 0 ? d.joinRows : ["  (none)"]))
  lines.push("", "=== Top Skills (by injection count) ===")
  if (d.skillRows.length > 0) {
    lines.push(...d.skillRows)
  } else {
    lines.push("  (none)")
  }
  lines.push("", "=== Errors ===")
  if (d.errorRows.length > 0) {
    lines.push(...d.errorRows)
  } else {
    lines.push("  (none)")
  }
  const l = d.learning || { data_status: "no_data", design_count: 0, by_bucket: [], mape: { value: null, n: 0, sigma: null, label: "N/A" }, reuse_proxy: 0 }
  lines.push("", "=== Learning / estimation progress ===")
  lines.push(`  Design library: ${l.design_count} indexed`)
  if (l.by_bucket.length > 0) {
    lines.push(
      "  By bucket: " + l.by_bucket.map((b) => `${b.work_type}/${b.risk}/${b.module_type}: n=${b.n}${b.avg_rounds_real !== null ? `, avg ${b.avg_rounds_real} rounds` : ""}`).join("; ")
    )
  }
  lines.push(`  MAPE (leave-one-out): ${l.mape.label}`)
  if (l.mape.n > 0) {
    lines.push(`    n=${l.mape.n}, sigma=${l.mape.sigma}`)
  }
  return lines.join("\n")
}

export function main(argv = process.argv.slice(2)) {
  const daysFlag = argv.indexOf("--days")
  const daysRaw = daysFlag !== -1 && argv[daysFlag + 1] ? parseInt(argv[daysFlag + 1], 10) : 1
  const days = Number.isFinite(daysRaw) ? daysRaw : 1
  const records = collectDelegations(resolveMetricsDir(), days)
  const library = readLibrary(resolveLibraryPath({ repo: argv.includes("--repo") }))
  const dashboard = buildDashboard(records, days, library)
  if (argv.includes("--json")) return JSON.stringify(dashboard, null, 2)
  return renderDashboard(dashboard)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  console.log(main())
}
