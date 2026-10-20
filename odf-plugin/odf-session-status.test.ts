import { describe, expect, it, vi } from "vitest"
import { observeOpenCodeSessionEvent, readObservedSessionStatus } from "./odf-session-status.js"
import {
  clearCancellationIndex,
  handleParentCancellation,
  registerCancellationChild,
} from "./odf-delegation-cancellation.js"

describe("observed OpenCode session status", () => {
  it("uses only known busy, retry, and idle events; missing evidence stays unknown", () => {
    const sessionID = "status-test-child"
    expect(readObservedSessionStatus(sessionID)).toBeNull()

    observeOpenCodeSessionEvent({ type: "session.status", data: { sessionID, status: { type: "busy" } } }, new Date("2026-09-28T10:00:00Z"))
    expect(readObservedSessionStatus(sessionID)).toEqual({ state: "busy", observed_at: "2026-09-28T10:00:00.000Z" })

    observeOpenCodeSessionEvent({ type: "session.status", properties: { sessionID, status: { type: "idle" } } }, new Date("2026-09-28T10:01:00Z"))
    expect(readObservedSessionStatus(sessionID)).toEqual({ state: "idle", observed_at: "2026-09-28T10:01:00.000Z" })
    observeOpenCodeSessionEvent({ type: "session.status", data: { sessionID, status: { type: "unknown" } } })
    expect(readObservedSessionStatus(sessionID)?.state).toBe("idle")
    expect(readObservedSessionStatus("status-test-never-seen")).toBeNull()
  })

  it("does not retain malformed event data or unsafe identifiers", () => {
    observeOpenCodeSessionEvent({ type: "session.status", data: { sessionID: "bad\nsession", status: { type: "busy" } } })
    observeOpenCodeSessionEvent({ type: "session.error", data: { sessionID: "status-test-error", status: { type: "busy" } } })
    expect(readObservedSessionStatus("bad\nsession")).toBeNull()
    expect(readObservedSessionStatus("status-test-error")).toBeNull()
  })

  it("never confirms a child from an observed idle status alone", async () => {
    const sessionID = "observed-idle-child"
    registerCancellationChild({
      parentSessionId: "observed-idle-parent",
      childSessionId: sessionID,
      path: "native",
    })
    observeOpenCodeSessionEvent({ type: "session.status", data: { sessionID, status: { type: "idle" } } })
    expect(readObservedSessionStatus(sessionID)?.state).toBe("idle")

    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => { throw new Error("no terminal idle") }),
    }
    const outcome = await handleParentCancellation({ parentSessionId: "observed-idle-parent", session })

    expect(outcome.verdicts[0]).toMatchObject({
      child_session_id: sessionID,
      status: "unconfirmed",
      terminal_idle_confirmed: false,
    })
    expect(outcome.confirmed).toEqual([])
    clearCancellationIndex()
  })
})
