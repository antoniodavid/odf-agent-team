#!/usr/bin/env node
/**
 * ODF Estimator — pure similarity-based design-effort estimator (A1).
 *
 * Given a closed design's `design_meta`, estimates tool-call rounds → wallclock
 * by similarity to a history of past designs. It is a SUGGESTION (shadow), never
 * a gate.
 *
 * Honesty contract (mirrors evaluateGoldens): with no compatible history it
 * returns `data_status: "no_data"` with estimate null + score_label "N/A" — it
 * NEVER invents a numeric estimate. No RAG, no vector DB, no ML regression.
 *
 * This module is PURE: no Engram, no I/O except the CLI wrapper.
 */

export const ESTIMATOR_SCHEMA_VERSION = 1

import * as fs from "node:fs"
import * as path from "node:path"

const DEFAULT_MINUTES_PER_ROUND = 3
const INTEGRATION_RATIO = 0.15 // +15% for wiring modules together (10-20% band)

const RISK_COEF = {
  low: 1.0,
  medium: 1.3,
  high: 1.5,
  "very-high": 2.0,
}

/**
 * Weights for similarity, summing to 1. Categorical equality is a hard filter
 * (binary 1/0) with the highest weights; counters use a distance ratio; text
 * uses token/Jaccard overlap.
 */
const SIMILARITY_WEIGHTS = {
  work_type: 0.25,
  risk: 0.2,
  module_type: 0.15,
  models: 0.1,
  fields: 0.1,
  views: 0.05,
  tasks: 0.05,
  exp_count: 0.05,
  manifest_depends: 0.03,
  module_destination: 0.02,
}

const CATEGORICAL_FIELDS = ["work_type", "risk", "module_type"]
const COUNTER_FIELDS = ["models", "views", "tasks", "exp_count"]
const LOG_COUNTER_FIELDS = ["fields"] // log-scaled to tolerate order-of-magnitude gaps

/* ------------------------------------------------------------------ */
/* deriveDesignMeta                                                     */
/* ------------------------------------------------------------------ */

function asText(document) {
  if (typeof document === "string") return document
  if (document && typeof document === "object") {
    if (typeof document.document === "string") return document.document
    if (typeof document.design === "string") return document.design
    if (typeof document.markdown === "string") return document.markdown
    return JSON.stringify(document)
  }
  return ""
}

const countAll = (text, re) => (text.match(re) || []).length

// Slice the markdown between a start heading and the next heading, so counts
// stay scoped to their section (deterministic, not a full markdown parser).
function sliceSection(text, startRe, endRe) {
  const start = text.search(startRe)
  if (start < 0) return ""
  const after = text.slice(start + 1)
  const m = after.search(endRe)
  return m < 0 ? text.slice(start) : text.slice(start, start + 1 + m)
}

// Count a table's data rows: a line starting with "|" whose first cell is a
// lowercase identifier (skips header rows like "| Campo |" and separators).
const tableRows = (section) => countAll(section, /^\|\s*`?[a-z_][a-z0-9_]*`?\s*\|/gm)

function deriveCounts(text) {
  const dataSection = sliceSection(text, /^#{2,3}\s*3\.?\s*data model/im, /^#{2,3}\s*4\.?/im)
  const viewsSection = sliceSection(text, /^#{2,3}\s*4\.?\s*vistas/im, /^#{2,3}\s*5\.?/im)
  return {
    models: countAll(text, /_name\s*=\s*['"]/g) + countAll(text, /_inherit\s*=\s*['"]/g),
    fields: tableRows(dataSection),
    views: tableRows(viewsSection) + countAll(viewsSection, /act_window/gi),
    tasks: countAll(text, /\bT\d+\b/g),
    exp_count: new Set(text.match(/EXP-\d+/g) || []).size,
  }
}

/**
 * Derive `design_meta` from a closed design document. Heuristic + deterministic:
 * it does not parse markdown perfectly, it counts section lines/references in a
 * reasonable way. Accepts a markdown string or an object that carries one
 * (document/design/markdown) or a pre-structured design_meta.
 *
 * Returns { meta, reason } — meta is null when nothing can be derived.
 */
export function deriveDesignMeta(document) {
  if (document && typeof document === "object" && !Array.isArray(document)) {
    if (Object.keys(document).length === 0) return { meta: null, reason: "empty document" }
    const hasStructuredCounts =
      ["models", "fields", "views", "tasks", "exp_count"].every((k) => Number.isFinite(document[k]))
    if (hasStructuredCounts) {
      return { meta: { ...document, closed: document.closed !== false } }
    }
  }

  const text = asText(document).trim()
  if (!text) return { meta: null, reason: "empty document" }

  const counts = deriveCounts(text)

  const manifestDepends = (() => {
    const m = text.match(/depends[\s\S]{0,60}\[([^\]]*)\]/i)
    if (!m) return []
    return m[1].split(",").map((s) => s.replace(/['"\s]/g, "")).filter(Boolean)
  })()

  const odooVersion = (() => {
    const m = text.match(/\b(1[6-9])\b/)
    return m ? Number(m[1]) : null
  })()

  const moduleType = /inherit/i.test(text) && !/module_type["']?\s*:\s*["']new/i.test(text) ? "inherit" : "new"

  const moduleDestination = (() => {
    const dest = text.match(/module_destination["']?\s*[:=]\s*["']?([a-z0-9_.-]+)["']?/i)
    if (dest) return dest[1]
    const mod = text.match(/\bmodule["']?\s*[:=]\s*["']?([a-z0-9_.-]+)["']?/i)
    return mod ? mod[1] : null
  })()

  // work_type/risk: honor an explicit declaration if present, else default low/feature.
  const workTypeMatch = text.match(/work_type["']?\s*[:=]\s*["']([^"']+)["']/i)
  const riskMatch = text.match(/risk["']?\s*[:=]\s*["']([^"']+)["']/i)

  if (counts.models === 0 && counts.tasks === 0 && counts.fields === 0) {
    return { meta: null, reason: "no derivable data (no models/tasks/fields)" }
  }

  return {
    meta: {
      change: (document && typeof document === "object" && document.change) || null,
      work_type: workTypeMatch ? workTypeMatch[1] : "feature",
      risk: riskMatch ? riskMatch[1] : "low",
      module_type: moduleType,
      odoo_version: odooVersion,
      models: counts.models,
      fields: counts.fields,
      views: counts.views,
      tasks: counts.tasks,
      exp_count: counts.exp_count,
      manifest_depends: manifestDepends,
      module_destination: moduleDestination,
      closed: true,
    },
  }
}

/* ------------------------------------------------------------------ */
/* similarity                                                           */
/* ------------------------------------------------------------------ */

function binaryEqual(a, b) {
  return String(a ?? "") === String(b ?? "") ? 1 : 0
}

function counterScore(a, b, logScale) {
  const an = Number(a) || 0
  const bn = Number(b) || 0
  const max = Math.max(an, bn)
  if (max === 0) return 1
  const diff = Math.abs(an - bn)
  return logScale ? 1 - Math.log1p(diff) / Math.log1p(max) : 1 - diff / max
}

function jaccard(a, b) {
  const A = new Set(Array.isArray(a) ? a : [])
  const B = new Set(Array.isArray(b) ? b : [])
  if (A.size === 0 && B.size === 0) return 1
  const union = new Set([...A, ...B])
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return inter / union.size
}

function tokenOverlap(a, b) {
  const norm = (v) => String(v ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const A = new Set(norm(a))
  const B = new Set(norm(b))
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return inter / Math.max(A.size, B.size)
}

/**
 * Similarity score [0,1] between two `design_meta`. Weighted overlap per field,
 * no embeddings. Categoricals are binary hard filters; counters are distance
 * ratios; text is Jaccard/token overlap. Weights documented above, sum to 1.
 */
export function similarity(a, b) {
  if (!a || !b) return 0
  let score = 0
  for (const field of CATEGORICAL_FIELDS) {
    score += SIMILARITY_WEIGHTS[field] * binaryEqual(a[field], b[field])
  }
  for (const field of COUNTER_FIELDS) {
    score += SIMILARITY_WEIGHTS[field] * counterScore(a[field], b[field], false)
  }
  for (const field of LOG_COUNTER_FIELDS) {
    score += SIMILARITY_WEIGHTS[field] * counterScore(a[field], b[field], true)
  }
  score += SIMILARITY_WEIGHTS.manifest_depends * jaccard(a.manifest_depends, b.manifest_depends)
  score += SIMILARITY_WEIGHTS.module_destination * tokenOverlap(a.module_destination, b.module_destination)
  return Math.max(0, Math.min(1, score))
}

/* ------------------------------------------------------------------ */
/* estimateFromHistory                                                  */
/* ------------------------------------------------------------------ */

/**
 * Convert a telemetry duration (ms) into tool-call rounds.
 * rounds = duration_ms / (minutes_per_round * 60000), rounded to nearest int.
 */
export function roundsFromDurationMs(duration_ms, minutes_per_round = DEFAULT_MINUTES_PER_ROUND) {
  const msPerRound = minutes_per_round * 60000
  if (!Number.isFinite(duration_ms) || duration_ms <= 0) return 0
  return Math.max(1, Math.round(duration_ms / msPerRound))
}

function roundsOf(entry, minutesPerRound) {
  if (Number.isFinite(entry.rounds_real) && entry.rounds_real > 0) return entry.rounds_real
  if (Number.isFinite(entry.duration_ms) && entry.duration_ms > 0) {
    return roundsFromDurationMs(entry.duration_ms, minutesPerRound)
  }
  return null
}

function sameBucket(meta, candidate) {
  return (
    String(meta?.work_type ?? "") === String(candidate?.work_type ?? "") &&
    String(meta?.risk ?? "") === String(candidate?.risk ?? "") &&
    String(meta?.module_type ?? "") === String(candidate?.module_type ?? "")
  )
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const stddev = (xs) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/**
 * Estimate rounds → wallclock from similar past designs.
 * `history` is [{ design_meta, rounds_real | duration_ms }, ...]. Only designs
 * in the same bucket (work_type+risk+module_type) count; the estimate uses per-
 * unit rates (rounds per model, rounds per task) from that bucket, then applies
 * the risk coefficient and +integration, and converts to wallclock.
 *
 * With no compatible bucket / empty history it returns honest
 * `{ data_status: "no_data", estimate: null, score_label: "N/A" }` — never invents.
 */
export function estimateFromHistory(design_meta, history, { minutes_per_round = DEFAULT_MINUTES_PER_ROUND, top_n = 5 } = {}) {
  if (!design_meta || typeof design_meta !== "object") {
    return { data_status: "no_data", estimate: null, score_label: "N/A" }
  }
  if (!Array.isArray(history) || history.length === 0) {
    return { data_status: "no_data", estimate: null, score_label: "N/A" }
  }

  const scored = history
    .map((entry) => {
      const rounds = roundsOf(entry, minutes_per_round)
      return {
        change: entry.change || null,
        score: similarity(design_meta, entry.design_meta || {}),
        rounds_real: rounds,
        design_meta: entry.design_meta || {},
      }
    })
    .filter((s) => s.rounds_real !== null)

  const bucket = scored.filter((s) => sameBucket(design_meta, s.design_meta))
  if (bucket.length === 0) {
    return { data_status: "no_data", estimate: null, score_label: "N/A" }
  }

  const targetModels = Number(design_meta.models) || 0
  const targetTasks = Number(design_meta.tasks) || 0

  const roundsPerModel = mean(bucket.map((s) => s.rounds_real / Math.max(s.design_meta.models, 1)))
  const roundsPerTask = mean(bucket.map((s) => s.rounds_real / Math.max(s.design_meta.tasks, 1)))

  const unitEstimate = (roundsPerModel * targetModels + roundsPerTask * targetTasks) / 2
  const baseRounds = Math.max(1, Math.round(unitEstimate))

  const riskCoef = RISK_COEF[design_meta.risk] ?? 1.0
  const riskAdjustedRounds = Math.round(baseRounds * riskCoef)
  const integrationRounds = Math.round(baseRounds * INTEGRATION_RATIO)
  const totalRounds = riskAdjustedRounds + integrationRounds
  const wallclockMin = Math.round(totalRounds * minutes_per_round)

  const matching = bucket
    .slice()
    .sort((x, y) => y.score - x.score)
    .slice(0, top_n)
    .map((s) => ({ change: s.change, score: Number(s.score.toFixed(3)), rounds_real: s.rounds_real }))

  return {
    data_status: "complete",
    matching,
    estimate: {
      base_rounds: baseRounds,
      risk_coef: riskCoef,
      risk_adjusted_rounds: riskAdjustedRounds,
      integration_rounds: integrationRounds,
      total_rounds: totalRounds,
      wallclock_min: wallclockMin,
      minutes_per_round: minutes_per_round,
      confidence: {
        n: bucket.length,
        sigma: Number(stddev(bucket.map((s) => s.rounds_real)).toFixed(2)),
      },
    },
    score_label: `${bucket.length} historicos`,
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"))
}

export function main(argv = process.argv.slice(2)) {
  const [mode, metaPath, historyPath] = argv
  if (mode !== "estimate" || !metaPath) {
    throw new Error("Usage: odf-estimator estimate <design_meta.json> [history.json]")
  }
  const designMeta = readJson(metaPath)
  const history = historyPath ? readJson(historyPath) : []
  return {
    schema_version: ESTIMATOR_SCHEMA_VERSION,
    design_meta: designMeta,
    ...estimateFromHistory(designMeta, history),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(main(), null, 2))
