#!/usr/bin/env node
import * as fs from "node:fs"
import * as path from "node:path"
import { buildDashboard, collectDelegations, resolveMetricsDir } from "./odf-metrics.js"

function matchExpectation(record, expected) {
  return Object.entries(expected || {}).every(([key, value]) => record[key] === value)
}

/** Deterministic evaluation over checked-in or supplied JSON fixtures. */
export function evaluateOffline(fixtures) {
  const results = (Array.isArray(fixtures) ? fixtures : []).map((fixture, index) => ({
    name: fixture.name || `fixture-${index + 1}`,
    passed: matchExpectation(fixture.record || {}, fixture.expect),
  }))
  const passed = results.filter(result => result.passed).length
  return {
    mode: "offline",
    total: results.length,
    passed,
    failed: results.length - passed,
    score: results.length ? passed / results.length : 1,
    results,
  }
}

/** Evaluate only observed metric records; no model or provider is involved. */
export function evaluateOnline(records, days = 1) {
  const dashboard = buildDashboard(records, days)
  return {
    mode: "online",
    total: dashboard.total,
    errors: dashboard.errorsCount,
    error_rate: dashboard.total ? dashboard.errorsCount / dashboard.total : 0,
    score: dashboard.total ? 1 - dashboard.errorsCount / dashboard.total : 1,
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"))
}

export function main(argv = process.argv.slice(2)) {
  const [mode, input, daysArg] = argv
  if (mode === "offline" && input) return evaluateOffline(readJson(input))
  if (mode === "online") {
    const days = Number.parseInt(daysArg || "7", 10)
    const records = input ? readJson(input) : collectDelegations(resolveMetricsDir(), days)
    return evaluateOnline(records, days)
  }
  throw new Error("Usage: odf-evaluation offline <fixtures.json> | online [metrics.json] [days]")
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(main(), null, 2))
