import * as fs from "node:fs"
import { randomBytes } from "node:crypto"
import * as path from "node:path"
import { getMetricsDir, hashSession, metricsBuffer, sanitizeMetricCostUsd } from "./odf-delegation-metrics.js"
import { tool } from "./odf-tool.js"

const FEEDBACK_CHANGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const FEEDBACK_STATUSES = ["ok", "blocked", "error", "timeout"] as const
const MAX_FEEDBACK_DAYS = 30
const MAX_METRICS_BYTES = 4 * 1024 * 1024
const MAX_FINISHED_RUNS = 10_000
const REQUEST_TIMEOUT_MS = 5_000
const PREVIEW_TTL_MS = 5 * 60_000
const MAX_PENDING_PREVIEWS = 100

type FeedbackStatus = typeof FEEDBACK_STATUSES[number]
type FeedbackRecord = {
  timestamp: string
  session_hash: string
  change: string
  event: "run"
  lifecycle: "finished"
  run_id: string
  status: FeedbackStatus
  duration_ms: number
  tokens?: { input?: unknown; output?: unknown }
  cost_usd?: unknown
}

export interface FeedbackAggregate {
  finished_runs: number
  latest_phase_status: FeedbackStatus
  duration_ms: number
  input_tokens: number | null
  input_token_runs: number
  output_tokens: number | null
  output_token_runs: number
  cost_usd: number | null
  cost_runs: number
}

export interface FeedbackPayload {
  schema_version: 1
  retention_days: number
  quality_rating: number
  aggregate: FeedbackAggregate
}

interface FeedbackConfig {
  endpoint: URL
  retentionDays: number
  bearerToken?: string
}

interface FeedbackDependencies {
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
  metricsDir?: string
  now?: () => Date
}

interface PendingFeedbackPreview {
  expiresAt: number
  sessionHash: string
  change: string
  rating: number
  endpoint: string
  retentionDays: number
  payloadJson: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && FEEDBACK_STATUSES.some(status => status === value)
}

function readConfig(env: Record<string, string | undefined>): FeedbackConfig | string {
  const rawEndpoint = env.ODF_FEEDBACK_ENDPOINT?.trim()
  if (!rawEndpoint) return "Online feedback is disabled; ODF_FEEDBACK_ENDPOINT is not configured. Nothing was sent."
  if (rawEndpoint.length > 2048) return "Feedback endpoint configuration is invalid. Nothing was sent."

  let endpoint: URL
  try {
    endpoint = new URL(rawEndpoint)
  } catch {
    return "Feedback endpoint configuration is invalid. Nothing was sent."
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    return "Feedback endpoint must be HTTPS and contain no embedded credentials, query, or fragment. Nothing was sent."
  }

  const rawRetention = env.ODF_FEEDBACK_RETENTION_DAYS
  if (!rawRetention || !/^[1-9]\d*$/.test(rawRetention)) {
    return "Set ODF_FEEDBACK_RETENTION_DAYS to the receiver's enforced retention (1–30 days). Nothing was sent."
  }
  const retentionDays = Number(rawRetention)
  if (!Number.isSafeInteger(retentionDays) || retentionDays > MAX_FEEDBACK_DAYS) {
    return "Receiver retention must be between 1 and 30 days. Nothing was sent."
  }

  const bearerToken = env.ODF_FEEDBACK_BEARER_TOKEN
  if (bearerToken !== undefined && (!/^[A-Za-z0-9._~+/-]{1,4096}={0,}$/.test(bearerToken))) {
    return "Feedback bearer-token configuration is invalid. Nothing was sent."
  }
  return { endpoint, retentionDays, ...(bearerToken ? { bearerToken } : {}) }
}

/** Aggregate only completed run records matching the current local session and change. */
export function aggregateFeedbackRecords(
  records: readonly unknown[],
  expectedSessionHash: string,
  change: string,
): FeedbackAggregate | null {
  const byRun = new Map<string, FeedbackRecord>()
  for (const value of records) {
    if (!isRecord(value) || value.session_hash !== expectedSessionHash || value.change !== change) continue
    if (value.event !== "run" || value.lifecycle !== "finished") continue
    if (value.schema_version !== 1 || typeof value.run_id !== "string" || !FEEDBACK_CHANGE_PATTERN.test(value.run_id)) continue
    if (!isFeedbackStatus(value.status)) continue
    if (typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp))) continue
    const duration = finiteNonNegativeInteger(value.duration_ms)
    if (duration === undefined) continue

    const tokens = isRecord(value.tokens) ? value.tokens : undefined
    const record: FeedbackRecord = {
      timestamp: value.timestamp,
      session_hash: expectedSessionHash,
      change,
      event: "run",
      lifecycle: "finished",
      run_id: value.run_id,
      status: value.status,
      duration_ms: duration,
      ...(tokens ? { tokens: { input: tokens.input, output: tokens.output } } : {}),
      ...(Object.hasOwn(value, "cost_usd") ? { cost_usd: value.cost_usd } : {}),
    }
    const previous = byRun.get(record.run_id)
    if (!previous || Date.parse(record.timestamp) >= Date.parse(previous.timestamp)) byRun.set(record.run_id, record)
  }
  if (byRun.size === 0 || byRun.size > MAX_FINISHED_RUNS) return null

  const runs = [...byRun.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
  let duration = 0
  let inputTokens = 0
  let inputTokenRuns = 0
  let outputTokens = 0
  let outputTokenRuns = 0
  let cost = 0
  let costRuns = 0
  for (const run of runs) {
    duration += run.duration_ms
    if (!Number.isSafeInteger(duration)) return null

    const input = finiteNonNegativeInteger(run.tokens?.input)
    if (input !== undefined) {
      inputTokens += input
      inputTokenRuns += 1
      if (!Number.isSafeInteger(inputTokens)) return null
    }
    const output = finiteNonNegativeInteger(run.tokens?.output)
    if (output !== undefined) {
      outputTokens += output
      outputTokenRuns += 1
      if (!Number.isSafeInteger(outputTokens)) return null
    }
    const runCost = sanitizeMetricCostUsd(run.cost_usd)
    if (runCost !== undefined && runCost !== null) {
      cost += runCost
      costRuns += 1
      if (!Number.isFinite(cost) || cost > 1_000_000_000) return null
    }
  }

  return {
    finished_runs: runs.length,
    latest_phase_status: runs[runs.length - 1].status,
    duration_ms: duration,
    input_tokens: inputTokenRuns > 0 ? inputTokens : null,
    input_token_runs: inputTokenRuns,
    output_tokens: outputTokenRuns > 0 ? outputTokens : null,
    output_token_runs: outputTokenRuns,
    cost_usd: costRuns > 0 ? Number(cost.toFixed(8)) : null,
    cost_runs: costRuns,
  }
}

function readRecentRecords(metricsDir: string, now: Date): { records?: unknown[]; error?: string } {
  const records: unknown[] = []
  let bytesRead = 0
  for (let offset = 0; offset < MAX_FEEDBACK_DAYS; offset += 1) {
    const day = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const filename = path.join(metricsDir, `delegations-${day}.jsonl`)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(filename)
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") continue
      return { error: "Recent local metrics could not be read safely. Nothing was sent." }
    }
    if (!stat.isFile() || stat.isSymbolicLink()) return { error: "Recent local metrics are not regular files. Nothing was sent." }
    bytesRead += stat.size
    if (bytesRead > MAX_METRICS_BYTES) return { error: "Recent local metrics exceed the safe read limit. Nothing was sent." }

    let contents: string
    try {
      contents = fs.readFileSync(filename, "utf8")
    } catch {
      return { error: "Recent local metrics could not be read safely. Nothing was sent." }
    }
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line) as unknown)
      } catch {
        return { error: "Recent local metrics contain a malformed record. Nothing was sent." }
      }
    }
  }
  return { records }
}

function payloadPreview(payload: FeedbackPayload): string {
  return JSON.stringify(payload)
}

export function createODFFeedbackSubmit(dependencies: FeedbackDependencies = {}): ReturnType<typeof tool> {
  const pendingPreviews = new Map<string, PendingFeedbackPreview>()
  return tool({
    description: "Preview or submit explicitly user-rated, aggregate ODF feedback. Submission requires an HTTPS endpoint, receiver retention configured to at most 30 days, and confirm_remote_submission=true after the user confirms. Never sends prompts, responses, free text, change/session IDs, paths, or estimated usage.",
    args: {
      action: tool.schema.enum(["preview", "submit"]),
      change: tool.schema.string().min(1).max(64).regex(FEEDBACK_CHANGE_PATTERN),
      rating: tool.schema.number().int().min(1).max(5),
      confirm_remote_submission: tool.schema.boolean().optional(),
      confirmation_token: tool.schema.string().regex(/^[A-Za-z0-9_-]{32}$/).optional(),
    },
    execute: async (args, context) => {
      if (!FEEDBACK_CHANGE_PATTERN.test(args.change) || !Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) {
        return "Invalid feedback change or rating. Choose a local change name and an integer rating from 1 to 5; nothing was sent."
      }
      const config = readConfig(dependencies.env ?? process.env)
      if (typeof config === "string") return config
      if (!context.sessionID) return "No current session is available to select local aggregate metrics. Nothing was sent."
      const now = (dependencies.now ?? (() => new Date()))()
      const nowMs = now.getTime()
      for (const [token, preview] of pendingPreviews) {
        if (preview.expiresAt <= nowMs) pendingPreviews.delete(token)
      }
      let pendingPreview: { token: string; preview: PendingFeedbackPreview } | null = null
      if (args.action === "submit") {
        if (args.confirm_remote_submission !== true || !args.confirmation_token) {
          return "Submission blocked: explicit confirmation is required after reviewing the preview. Nothing was sent."
        }
        const preview = pendingPreviews.get(args.confirmation_token)
        if (!preview) return "Submission blocked: preview token is missing, expired, or already used. Nothing was sent."
        if (
          preview.sessionHash !== hashSession(context.sessionID) ||
          preview.change !== args.change ||
          preview.rating !== args.rating ||
          preview.endpoint !== config.endpoint.href ||
          preview.retentionDays !== config.retentionDays
        ) return "Submission blocked: confirmation does not match this session, change, rating, endpoint, or retention. Nothing was sent."
        pendingPreview = { token: args.confirmation_token, preview }
      }

      const records = readRecentRecords(dependencies.metricsDir ?? getMetricsDir(), now)
      if (!records.records) return records.error ?? "Local metrics could not be read. Nothing was sent."
      const aggregate = aggregateFeedbackRecords(
        [...records.records, ...metricsBuffer],
        hashSession(context.sessionID),
        args.change,
      )
      if (!aggregate) return "No safe, completed local metrics matched this session and change; nothing was sent."

      const payload: FeedbackPayload = {
        schema_version: 1,
        retention_days: config.retentionDays,
        quality_rating: args.rating,
        aggregate,
      }
      const destination = config.endpoint.origin
      const payloadJson = JSON.stringify(payload)
      if (args.action === "preview") {
        if (pendingPreviews.size >= MAX_PENDING_PREVIEWS) {
          const oldest = pendingPreviews.keys().next()
          if (!oldest.done) pendingPreviews.delete(oldest.value)
        }
        const confirmationToken = randomBytes(24).toString("base64url")
        pendingPreviews.set(confirmationToken, {
          expiresAt: nowMs + PREVIEW_TTL_MS,
          sessionHash: hashSession(context.sessionID),
          change: args.change,
          rating: args.rating,
          endpoint: config.endpoint.href,
          retentionDays: config.retentionDays,
          payloadJson,
        })
        return {
          title: "Feedback preview — not sent",
          output: `Destination host: ${destination} (endpoint path hidden). The receiver is configured for ${config.retentionDays}-day retention; ODF cannot verify enforcement. Payload: ${payloadPreview(payload)}. Confirmation token (one-time, valid 5 minutes): ${confirmationToken}. No network request was made.`,
        }
      }

      const fetcher = dependencies.fetch ?? globalThis.fetch
      if (typeof fetcher !== "function") return "Online feedback is unavailable in this runtime. Nothing was sent."
      if (!pendingPreview) return "Submission blocked: preview confirmation is unavailable. Nothing was sent."
      if (pendingPreview.preview.payloadJson !== payloadJson) {
        pendingPreviews.delete(pendingPreview.token)
        return "Submission blocked: aggregate data changed after preview. Preview again before confirming. Nothing was sent."
      }
      // Consume before I/O: one preview authorizes at most one request, including
      // when the network response is lost and the remote outcome is unknown.
      pendingPreviews.delete(pendingPreview.token)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = await fetcher(config.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.bearerToken ? { authorization: `Bearer ${config.bearerToken}` } : {}),
          },
          body: payloadJson,
          redirect: "error",
          signal: controller.signal,
        })
        if (!response.ok) return `Feedback endpoint rejected the request (HTTP ${response.status}); no retry was made.`
        return "Feedback submitted. No durable local feedback copy, queue, or retry was created."
      } catch {
        return "Submission outcome is unknown because the request failed or timed out; no retry or local queue was created."
      } finally {
        clearTimeout(timeout)
      }
    },
  })
}
