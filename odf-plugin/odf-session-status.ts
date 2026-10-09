/** Bounded in-memory view of the latest OpenCode session.status event per session. */

const MAX_OBSERVED_SESSIONS = 500
const SESSION_ID_PATTERN = /^[^\0\r\n]{1,256}$/

export type OpenCodeSessionState = "busy" | "retry" | "idle"

export interface ObservedSessionStatus {
  state: OpenCodeSessionState
  observed_at: string
}

const observedStatuses = new Map<string, ObservedSessionStatus>()

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Update the bounded process-local cache from an OpenCode V2 event. */
export function observeOpenCodeSessionEvent(event: unknown, now = new Date()): void {
  const value = asRecord(event)
  if (!value || value.type !== "session.status") return
  const data = asRecord(value.data) || asRecord(value.properties)
  const status = asRecord(data?.status)
  const sessionId = typeof data?.sessionID === "string" ? data.sessionID : data?.sessionId
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return
  if (!(status?.type === "busy" || status?.type === "retry" || status?.type === "idle")) return
  if (!Number.isFinite(now.getTime())) return

  observedStatuses.delete(sessionId)
  observedStatuses.set(sessionId, { state: status.type, observed_at: now.toISOString() })
  while (observedStatuses.size > MAX_OBSERVED_SESSIONS) {
    const oldest = observedStatuses.keys().next().value
    if (oldest === undefined) break
    observedStatuses.delete(oldest)
  }
}

/** Return only the latest observed status; absence is unknown, never idle. */
export function readObservedSessionStatus(sessionId: string): ObservedSessionStatus | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null
  return observedStatuses.get(sessionId) || null
}
