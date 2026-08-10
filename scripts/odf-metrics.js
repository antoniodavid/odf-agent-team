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

/** Build the dashboard from delegation records. */
export function buildDashboard(records, days) {
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
  const pct = (part, tot) => (tot > 0 ? Math.round((part / tot) * 100) : 0)
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

  return {
    total,
    avgDurationMs: total > 0 ? durationSum / total : 0,
    avgTokens: total > 0 ? tokensSum / total : 0,
    selfDiscoveredPct: pct(selfDiscovered, total),
    errorsCount: errors.length,
    errorPct: pct(errors.length, total),
    agentRows,
    workTypeRows,
    branchRows,
    joinRows,
    validationRatio: validationRatioCount > 0 ? validationRatioSum / validationRatioCount : null,
    skillRows,
    errorRows,
    days,
  }
}

export function renderDashboard(d) {
  const lines = [
    `ODF: Agent Observatory (last ${d.days}d)`,
    "",
    "=== Overall ===",
    `  Total delegations: ${d.total}`,
    `  Avg duration: ${Math.round(d.avgDurationMs / 1000)}s`,
    `  Avg tokens: ${Math.round(d.avgTokens)}`,
    `  Skill resolution rate: ${100 - d.selfDiscoveredPct}% injected`,
    `  Validation ratio: ${d.validationRatio === null ? "n/a" : `${Math.round(d.validationRatio * 100)}%`}`,
    `  Errors: ${d.errorsCount} (${d.errorPct}%)`,
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
  return lines.join("\n")
}

export function main(argv = process.argv.slice(2)) {
  const daysFlag = argv.indexOf("--days")
  const days = daysFlag !== -1 && argv[daysFlag + 1] ? parseInt(argv[daysFlag + 1], 10) : 1
  const records = collectDelegations(resolveMetricsDir(), Number.isFinite(days) ? days : 1)
  const dashboard = buildDashboard(records, Number.isFinite(days) ? days : 1)
  return renderDashboard(dashboard)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  console.log(main())
}
