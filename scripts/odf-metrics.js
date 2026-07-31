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

function resolveMetricsDir() {
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

/** Build the dashboard from delegation records. */
export function buildDashboard(records, days) {
  const total = records.length
  const byAgent = new Map()
  const skills = new Map()
  const errors = []
  let durationSum = 0
  let tokensSum = 0
  let selfDiscovered = 0

  for (const r of records) {
    durationSum += typeof r.duration_ms === "number" ? r.duration_ms : 0
    tokensSum += typeof r.token_estimate === "number" ? r.token_estimate : 0
    if (r.skill_resolution === "none") selfDiscovered += 1
    if (r.status === "error" || r.status === "timeout") {
      errors.push({ timestamp: r.timestamp, agent: r.agent, error: r.error || r.status, duration_ms: r.duration_ms })
    }
    if (!byAgent.has(r.agent)) {
      byAgent.set(r.agent, { count: 0, duration: 0, tokens: 0, resolved: 0 })
    }
    const a = byAgent.get(r.agent)
    a.count += 1
    a.duration += typeof r.duration_ms === "number" ? r.duration_ms : 0
    a.tokens += typeof r.token_estimate === "number" ? r.token_estimate : 0
    if (r.skill_resolution === "injected") a.resolved += 1
    for (const s of r.skills_injected || []) {
      skills.set(s, (skills.get(s) || 0) + 1)
    }
  }

  const fmtDur = (ms) => `${Math.round((ms || 0) / 1000)}s`
  const fmtTokens = (n) => (n || 0).toLocaleString()
  const pct = (part, tot) => (tot > 0 ? Math.round((part / tot) * 100) : 0)

  const agentRows = [...byAgent.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([agent, a]) => {
      const name = agent.length > 18 ? agent.slice(0, 15) + "..." : agent
      return `${name.padEnd(18)} ${String(a.count).padStart(11)} ${fmtDur(a.duration / a.count).padStart(9)} ${fmtTokens(a.tokens / a.count).padStart(12)} ${String(pct(a.resolved, a.count) + "%").padStart(11)}`
    })

  const skillRows = [...skills.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, n]) => `  ${name.padEnd(38)} ${n}`)

  const errorRows = errors
    .slice(0, 10)
    .map((e) => `  ${e.timestamp} | ${e.agent} | ${(e.error || "").slice(0, 80)} | ${fmtDur(e.duration_ms)}`)

  return {
    total,
    avgDurationMs: total > 0 ? durationSum / total : 0,
    avgTokens: total > 0 ? tokensSum / total : 0,
    selfDiscoveredPct: pct(selfDiscovered, total),
    errorsCount: errors.length,
    errorPct: pct(errors.length, total),
    agentRows,
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
