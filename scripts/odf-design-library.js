#!/usr/bin/env node
/**
 * ODF Design Library — reusable design index + estimator calibration (B1 + A3).
 *
 * A small, versioned JSON index of archived ODF designs (design_meta + real
 * effort) that future changes can search and that calibrates the estimator from
 * real telemetry. Engram stays the store of FULL documents; this library is only
 * the structured index (design_meta + effort + refs).
 *
 * Consumers:
 *   - searchDesigns(query, library): token/keyword overlap over the key fields,
 *     mirroring the estimator's `similarity` technique (no embeddings).
 *   - collectImplementationRounds(records): sums IMPLEMENT telemetry duration
 *     into tool-call rounds (feeds the library at archive time).
 *   - calibrateFromHistory(library): per-bucket rates (rounds/model, rounds/task)
 *     from real rounds_real — what the estimator's estimateFromHistory computes
 *     inline, materialized for future consumption.
 *
 * Honesty contract (same as odf-estimator): with no library/records it returns
 * `data_status: "no_data"` — it NEVER invents effort. No RAG, no vector DB, no ML.
 *
 * PURE module (no Engram): I/O only in readLibrary/writeLibrary/appendAndWrite
 * and the CLI wrapper.
 */

export const LIBRARY_SCHEMA_VERSION = 1
export const DEFAULT_MINUTES_PER_ROUND = 3

import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { roundsFromDurationMs } from "./odf-estimator.js"

/* ------------------------------------------------------------------ */
/* appendDesign                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build a normalized library entry (NO I/O). `design_ref`/`retrospective_ref`
 * default to the odf/{change} conventions; `archived_at` defaults to today
 * (YYYY-MM-DD). `rounds_real` stays null when unknown — never invented.
 */
export function appendDesign(design_meta, { rounds_real, design_ref, retrospective_ref, archived_at } = {}) {
  const change = (design_meta && typeof design_meta === "object" && design_meta.change) || null
  return {
    change,
    design_meta: design_meta || {},
    rounds_real: Number.isFinite(rounds_real) && rounds_real > 0 ? Math.round(rounds_real) : null,
    design_ref: design_ref || (change ? `odf/${change}/design` : null),
    retrospective_ref: retrospective_ref || (change ? `odf/${change}/retrospective` : null),
    archived_at: archived_at || new Date().toISOString().slice(0, 10),
  }
}

/* ------------------------------------------------------------------ */
/* readLibrary / writeLibrary                                           */
/* ------------------------------------------------------------------ */

/** Read an index.json; missing/corrupt/non-array designs → no_data (honest). */
export function readLibrary(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"))
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.designs)) {
      return { data_status: "no_data", designs: [] }
    }
    return { schema_version: raw.schema_version ?? LIBRARY_SCHEMA_VERSION, designs: raw.designs }
  } catch {
    return { data_status: "no_data", designs: [] }
  }
}

/** Write a library object as formatted JSON (mkdir -p on parent dir). */
export function writeLibrary(filePath, library) {
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, JSON.stringify(library, null, 2) + "\n")
}

/* ------------------------------------------------------------------ */
/* searchDesigns                                                        */
/* ------------------------------------------------------------------ */

function tokenize(text) {
  return String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

// Token/keyword overlap over the fields the estimator already weighs: change,
// module_destination, work_type, module_type, risk, manifest_depends.
function queryScore(query, entry) {
  const meta = entry.design_meta || {}
  const haystack = [
    entry.change,
    meta.module_destination,
    meta.work_type,
    meta.module_type,
    meta.risk,
    ...(Array.isArray(meta.manifest_depends) ? meta.manifest_depends : []),
  ]
    .filter((v) => v !== null && v !== undefined)
    .join(" ")
  const q = tokenize(query)
  const h = new Set(tokenize(haystack))
  if (q.length === 0) return 0
  return q.filter((t) => h.has(t)).length / q.length
}

/**
 * Rank library designs against a free-text query. Without a library (or with an
 * empty one) returns `data_status: "no_data"` — never a fabricated ranking.
 */
export function searchDesigns(query, library, { top_n = 5 } = {}) {
  const designs = library && Array.isArray(library.designs) ? library.designs : null
  if (!designs || designs.length === 0) return { data_status: "no_data", results: [] }
  const results = designs
    .map((entry) => ({
      change: (entry && entry.change) || null,
      score: queryScore(query, entry),
      rounds_real: Number.isFinite(entry.rounds_real) && entry.rounds_real > 0 ? Math.round(entry.rounds_real) : null,
      archived_at: (entry && entry.archived_at) || null,
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top_n)
    .map((s) => ({ ...s, score: Number(s.score.toFixed(3)) }))
  return { data_status: "complete", results }
}

/* ------------------------------------------------------------------ */
/* appendAndWrite                                                       */
/* ------------------------------------------------------------------ */

/**
 * Convenience: read → append (dedupe by `change`: existing entry is updated,
 * never duplicated) → write. Returns the entry that was persisted.
 */
export function appendAndWrite(filePath, design_meta, opts = {}) {
  const library = readLibrary(filePath)
  const designs = Array.isArray(library.designs) ? library.designs : []
  const entry = appendDesign(design_meta, opts)
  const idx = designs.findIndex((d) => d.change === entry.change)
  if (idx >= 0) designs[idx] = entry
  else designs.push(entry)
  writeLibrary(filePath, { schema_version: LIBRARY_SCHEMA_VERSION, designs })
  return entry
}

/* ------------------------------------------------------------------ */
/* A3 — calibration from telemetry                                      */
/* ------------------------------------------------------------------ */

// A delegation "completed" the phase when it did not end in error/timeout/blocked.
const okStatus = (status) => status !== "error" && status !== "timeout" && status !== "blocked"

/**
 * Convert IMPLEMENT delegation records into real tool-call rounds.
 * Keeps only completed (non-error/timeout/blocked) `phase: "IMPLEMENT"` records
 * and sums duration_ms → rounds via the estimator's roundsFromDurationMs.
 * No records / no usable duration → { rounds_real: null, data_status: "no_data" }.
 */
export function collectImplementationRounds(records, { minutes_per_round = DEFAULT_MINUTES_PER_ROUND } = {}) {
  if (!Array.isArray(records)) return { rounds_real: null, data_status: "no_data", duration_ms: 0, record_count: 0 }
  const impl = records.filter(
    (r) => r && String(r.phase).toUpperCase() === "IMPLEMENT" && okStatus(r.status)
  )
  const duration_ms = impl.reduce(
    (sum, r) => sum + (Number.isFinite(r.duration_ms) && r.duration_ms > 0 ? r.duration_ms : 0),
    0
  )
  if (impl.length === 0 || duration_ms <= 0) {
    return { rounds_real: null, data_status: "no_data", duration_ms, record_count: impl.length }
  }
  return {
    rounds_real: roundsFromDurationMs(duration_ms, minutes_per_round),
    data_status: "complete",
    duration_ms,
    record_count: impl.length,
  }
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const stddev = (xs) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/**
 * Derive the per-bucket rates the estimator uses (rounds/model, rounds/task,
 * sigma) from the library's real rounds_real. Same bucket key as the estimator:
 * work_type + risk + module_type. Entries without rounds_real are skipped.
 * Empty library → { buckets: [], data_status: "no_data" }.
 */
export function calibrateFromHistory(library) {
  const designs = library && Array.isArray(library.designs) ? library.designs : []
  const withEffort = designs.filter(
    (d) => d && d.design_meta && Number.isFinite(d.rounds_real) && d.rounds_real > 0
  )
  if (withEffort.length === 0) {
    return { schema_version: LIBRARY_SCHEMA_VERSION, buckets: [], data_status: "no_data" }
  }
  const byBucket = new Map()
  for (const d of withEffort) {
    const { work_type = "", risk = "", module_type = "" } = d.design_meta
    const key = `${work_type}|${risk}|${module_type}`
    if (!byBucket.has(key)) byBucket.set(key, [])
    byBucket.get(key).push(d)
  }
  const buckets = [...byBucket.entries()]
    .map(([key, entries]) => {
      const [work_type, risk, module_type] = key.split("|")
      const rounds = entries.map((d) => d.rounds_real)
      return {
        work_type,
        risk,
        module_type,
        n: entries.length,
        rounds_per_model: Number(mean(entries.map((d) => d.rounds_real / Math.max(d.design_meta.models, 1))).toFixed(2)),
        rounds_per_task: Number(mean(entries.map((d) => d.rounds_real / Math.max(d.design_meta.tasks, 1))).toFixed(2)),
        sigma: Number(stddev(rounds).toFixed(2)),
      }
    })
    .sort((a, b) => b.n - a.n || `${a.work_type}|${a.risk}|${a.module_type}`.localeCompare(`${b.work_type}|${b.risk}|${b.module_type}`))
  return { schema_version: LIBRARY_SCHEMA_VERSION, buckets, data_status: "complete" }
}

/* ------------------------------------------------------------------ */
/* index location + CLI                                                 */
/* ------------------------------------------------------------------ */

/**
 * Where the library index lives. Default: the ODF config dir
 * (${ODF_CONFIG_DIR:-~/.config/opencode}/design-library/index.json) — runtime
 * data outside the repo. `{ repo: true }` → a local `design-library/index.json`
 * next to the checkout (for teams that commit the index).
 */
export function resolveLibraryPath({ repo = false } = {}) {
  if (repo) return path.join(process.cwd(), "design-library", "index.json")
  const configDir = process.env.ODF_CONFIG_DIR
    ? path.resolve(process.env.ODF_CONFIG_DIR)
    : path.join(os.homedir(), ".config", "opencode")
  return path.join(configDir, "design-library", "index.json")
}

export function main(argv = process.argv.slice(2)) {
  const [mode, ...rest] = argv
  if (mode === "search") {
    const query = rest[0]
    if (!query) throw new Error("Usage: odf-design-library search <query> [index.json]")
    const library = readLibrary(rest[1] || resolveLibraryPath())
    return { schema_version: LIBRARY_SCHEMA_VERSION, query, ...searchDesigns(query, library) }
  }
  if (mode === "append") {
    const [metaPath, indexPath] = rest
    if (!metaPath || !indexPath) throw new Error("Usage: odf-design-library append <design_meta.json> <index.json>")
    const designMeta = JSON.parse(fs.readFileSync(path.resolve(metaPath), "utf8"))
    const entry = appendAndWrite(indexPath, designMeta)
    return { schema_version: LIBRARY_SCHEMA_VERSION, index: indexPath, entry }
  }
  if (mode === "calibrate") {
    const indexPath = rest[0]
    if (!indexPath) throw new Error("Usage: odf-design-library calibrate <index.json>")
    return calibrateFromHistory(readLibrary(indexPath))
  }
  throw new Error(
    "Usage: odf-design-library { search <query> [index.json] | append <design_meta.json> <index.json> | calibrate <index.json> }"
  )
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(main(), null, 2))
