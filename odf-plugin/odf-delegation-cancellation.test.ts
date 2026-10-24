import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  DEFAULT_DELEGATION_CANCELLATION_DEADLINE_MS,
  activeCancellationChildren,
  clearCancellationIndex,
  delegationCancellationDeadlineMs,
  handleParentCancellation,
  readCancellationOutcome,
  registerCancellationChild,
  unregisterCancellationChild,
  type CancellationSessionApi,
} from "./odf-delegation-cancellation.js"
import { createV2SessionTaskApi } from "./odf-delegation-health.js"
import {
  clearNativeLaunchChildren,
  createODFRegisteredTools,
  handleNativeDelegationSessionEvent,
  invokeTask,
  registerNativeLaunchChild,
} from "../plugins/odf-delegation.js"

const ENV_DEADLINE = "ODF_DELEGATION_CANCELLATION_DEADLINE_MS"
/** Test-only override value: the production deadline is never asserted as a literal. */
const TEST_DEADLINE_OVERRIDE_MS = 25

type CancellationPath = "sequential" | "parallel" | "native"

function child(parentSessionId: string, childSessionId: string, cancellationPath: CancellationPath = "native") {
  return { parentSessionId, childSessionId, path: cancellationPath }
}

/** A session modelling the complete V2 contract a confirmable verdict requires. */
function confirmedSession() {
  return {
    interrupt: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    context: vi.fn(async () => []),
  }
}

/** Exact session-ID arguments a mock was called with, in call order. */
function calledSessionIds(mock: { mock: { calls: unknown[][] } }): unknown[] {
  return mock.mock.calls.map(call => call[0])
}

beforeEach(() => {
  // Every parent-scoped run now keeps its window open until the deadline (REQ-03),
  // so the suite bounds that window through the exported env override instead of
  // waiting for the production default. The default itself is asserted explicitly
  // by the deadline test below, which clears this stub first.
  vi.stubEnv(ENV_DEADLINE, String(TEST_DEADLINE_OVERRIDE_MS))
})

afterEach(() => {
  clearCancellationIndex()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("delegation cancellation index", () => {
  it("registers a child under its exact parent and returns only that parent's children", () => {
    registerCancellationChild(child("parent-a", "child-a1", "sequential"))
    registerCancellationChild(child("parent-a", "child-a2", "parallel"))
    registerCancellationChild(child("parent-b", "child-b1", "native"))

    expect(activeCancellationChildren("parent-a").map(entry => entry.childSessionId)).toEqual(["child-a1", "child-a2"])
    expect(activeCancellationChildren("parent-b").map(entry => entry.childSessionId)).toEqual(["child-b1"])
    expect(activeCancellationChildren("parent-unknown")).toEqual([])
  })

  it("keeps exactly one entry when the same child is registered twice (native + parallel keys)", () => {
    registerCancellationChild(child("parent-a", "child-a1", "native"))
    registerCancellationChild(child("parent-a", "child-a1", "parallel"))

    const entries = activeCancellationChildren("parent-a")
    expect(entries).toHaveLength(1)
    expect(entries[0].childSessionId).toBe("child-a1")
  })

  it("unregisters a child and leaves other parents untouched", () => {
    registerCancellationChild(child("parent-a", "child-a1"))
    registerCancellationChild(child("parent-a", "child-a2"))
    registerCancellationChild(child("parent-b", "child-b1"))

    unregisterCancellationChild("parent-a", "child-a1")

    expect(activeCancellationChildren("parent-a").map(entry => entry.childSessionId)).toEqual(["child-a2"])
    expect(activeCancellationChildren("parent-b").map(entry => entry.childSessionId)).toEqual(["child-b1"])
  })

  it("exposes one finite env-overridable deadline with a documented default", () => {
    vi.unstubAllEnvs()
    expect(delegationCancellationDeadlineMs()).toBe(DEFAULT_DELEGATION_CANCELLATION_DEADLINE_MS)
    expect(Number.isFinite(DEFAULT_DELEGATION_CANCELLATION_DEADLINE_MS)).toBe(true)

    vi.stubEnv(ENV_DEADLINE, String(TEST_DEADLINE_OVERRIDE_MS))
    expect(delegationCancellationDeadlineMs()).toBe(TEST_DEADLINE_OVERRIDE_MS)

    vi.stubEnv(ENV_DEADLINE, "not-a-number")
    expect(delegationCancellationDeadlineMs()).toBe(DEFAULT_DELEGATION_CANCELLATION_DEADLINE_MS)

    vi.stubEnv(ENV_DEADLINE, "-1")
    expect(delegationCancellationDeadlineMs()).toBe(DEFAULT_DELEGATION_CANCELLATION_DEADLINE_MS)
  })
})

describe("confirmed verdict", () => {
  it("confirms a child only after interrupt and wait for that exact child ID", async () => {
    registerCancellationChild(child("confirm-parent", "confirm-child", "sequential"))
    const session = confirmedSession()

    const outcome = await handleParentCancellation({ parentSessionId: "confirm-parent", session })

    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "confirm-child" })
    expect(session.wait).toHaveBeenCalledWith({ sessionID: "confirm-child" })
    expect(outcome.verdicts).toHaveLength(1)
    expect(outcome.verdicts[0]).toMatchObject({
      parent_session_id: "confirm-parent",
      child_session_id: "confirm-child",
      path: "sequential",
      status: "confirmed",
      reason: null,
      interrupt_requested: true,
      terminal_idle_confirmed: true,
    })
    expect(outcome.confirmed).toEqual(["confirm-child"])
    expect(outcome.unconfirmed).toEqual([])
    // A confirmed child leaves the index; it can never be re-reported.
    expect(activeCancellationChildren("confirm-parent")).toEqual([])
  })

  it("does not confirm when the fixture withholds a resolving wait", async () => {
    registerCancellationChild(child("withheld-parent", "withheld-child"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => { throw new Error("no terminal idle") }),
    }

    const outcome = await handleParentCancellation({ parentSessionId: "withheld-parent", session })

    expect(session.wait).toHaveBeenCalledWith({ sessionID: "withheld-child" })
    expect(outcome.verdicts[0].status).not.toBe("confirmed")
  })

  it("confirms an already-terminal child through the same wait evidence", async () => {
    registerCancellationChild(child("terminal-parent", "terminal-child"))
    const session = confirmedSession()

    const outcome = await handleParentCancellation({ parentSessionId: "terminal-parent", session })

    expect(session.interrupt).toHaveBeenCalledTimes(1)
    expect(session.wait).toHaveBeenCalledTimes(1)
    expect(outcome.confirmed).toEqual(["terminal-child"])
    expect(outcome.verdicts[0].terminal_idle_confirmed).toBe(true)
  })
})

describe("unconfirmed verdicts", () => {
  it("reports unconfirmed with the ID preserved when interrupt rejects", async () => {
    registerCancellationChild(child("interrupt-parent", "interrupt-child-1"))
    registerCancellationChild(child("interrupt-parent", "interrupt-child-2"))
    const session = {
      interrupt: vi.fn(async ({ sessionID }: { sessionID: string }) => {
        if (sessionID === "interrupt-child-1") throw new Error("interrupt failed")
      }),
      wait: vi.fn(async () => undefined),
      get: vi.fn(async () => ({})),
      context: vi.fn(async () => []),
    }

    const outcome = await handleParentCancellation({ parentSessionId: "interrupt-parent", session })

    expect(outcome.verdicts[0]).toMatchObject({
      child_session_id: "interrupt-child-1",
      status: "unconfirmed",
      reason: "interrupt-failed",
      interrupt_requested: true,
      terminal_idle_confirmed: false,
    })
    expect(outcome.unconfirmed).toEqual(["interrupt-child-1"])
    // The remaining child of the same parent is still processed.
    expect(outcome.confirmed).toEqual(["interrupt-child-2"])
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "interrupt-child-2" })
  })

  it("reports unconfirmed when wait rejects without retrying", async () => {
    registerCancellationChild(child("wait-parent", "wait-child"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => { throw new Error("wait failed") }),
    }

    const outcome = await handleParentCancellation({ parentSessionId: "wait-parent", session })

    expect(outcome.verdicts[0]).toMatchObject({
      status: "unconfirmed",
      reason: "wait-failed",
      interrupt_requested: true,
      terminal_idle_confirmed: false,
    })
    expect(session.wait).toHaveBeenCalledTimes(1)
  })

  it("reports unconfirmed for every child when wait is missing from the session API", async () => {
    registerCancellationChild(child("no-wait-parent", "no-wait-child-1", "native"))
    registerCancellationChild(child("no-wait-parent", "no-wait-child-2", "sequential"))
    const session = { interrupt: vi.fn(async () => undefined) }

    const outcome = await handleParentCancellation({ parentSessionId: "no-wait-parent", session })

    expect(outcome.verdicts.map(verdict => verdict.reason)).toEqual(["session-api-unavailable", "session-api-unavailable"])
    expect(outcome.verdicts.every(verdict => verdict.status === "unconfirmed")).toBe(true)
    expect(outcome.unconfirmed).toEqual(["no-wait-child-1", "no-wait-child-2"])
    expect(outcome.confirmed).toEqual([])
  })

  it("reports unconfirmed with no interrupt request when the session itself is missing", async () => {
    registerCancellationChild(child("no-session-parent", "no-session-child"))

    const outcome = await handleParentCancellation({ parentSessionId: "no-session-parent", session: undefined })

    expect(outcome.verdicts[0]).toMatchObject({
      child_session_id: "no-session-child",
      status: "unconfirmed",
      reason: "session-api-unavailable",
      interrupt_requested: false,
      terminal_idle_confirmed: false,
    })
  })

  it("fails closed when the session API is missing session.get", async () => {
    const parentSessionId = "missing-get-parent"
    const childSessionId = "missing-get-child"
    registerCancellationChild(child(parentSessionId, childSessionId, "native"))
    const session: CancellationSessionApi = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      context: vi.fn(async () => []),
    }

    const outcome = await handleParentCancellation({ parentSessionId, session })

    // REQ-06 / E-06: terminal idle alone is not enough when the contract's
    // session API is incomplete.
    expect(outcome.verdicts[0]).toMatchObject({
      child_session_id: childSessionId,
      status: "unconfirmed",
      reason: "session-api-unavailable",
      interrupt_requested: true,
      terminal_idle_confirmed: false,
    })
    expect(outcome.confirmed).toEqual([])
    expect(outcome.unconfirmed).toEqual([childSessionId])
    // The interrupt request is still issued and the registration survives for a
    // later attempt; the child ID is preserved verbatim.
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: childSessionId })
    expect(activeCancellationChildren(parentSessionId).map(entry => entry.childSessionId)).toEqual([childSessionId])
  })

  it("fails closed when the session API is missing session.context", async () => {
    const parentSessionId = "missing-context-parent"
    const childSessionId = "missing-context-child"
    registerCancellationChild(child(parentSessionId, childSessionId, "parallel"))
    const session: CancellationSessionApi = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      get: vi.fn(async () => ({})),
    }

    const outcome = await handleParentCancellation({ parentSessionId, session })

    expect(outcome.verdicts[0]).toMatchObject({
      child_session_id: childSessionId,
      status: "unconfirmed",
      reason: "session-api-unavailable",
      interrupt_requested: true,
      terminal_idle_confirmed: false,
    })
    expect(outcome.confirmed).toEqual([])
    expect(outcome.unconfirmed).toEqual([childSessionId])
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: childSessionId })
    expect(activeCancellationChildren(parentSessionId).map(entry => entry.childSessionId)).toEqual([childSessionId])
  })

  it("never presents an unconfirmed child as idle or stopped", async () => {
    registerCancellationChild(child("wording-parent", "wording-child"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => { throw new Error("wait failed") }),
    }

    const outcome = await handleParentCancellation({ parentSessionId: "wording-parent", session })
    const serialized = JSON.stringify(outcome)

    expect(outcome.verdicts[0].status).toBe("unconfirmed")
    expect(serialized).not.toContain("stopped")
    // The only permitted "idle" reference is the terminal_idle_confirmed field
    // name; no value may ever label a child idle.
    expect(serialized).not.toContain('"idle"')
    expect(serialized).not.toContain("\\\"idle\\\"")
  })

  it("leaves the workspace untouched: no join, ledger, or new file changes", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "odf-cancellation-"))
    try {
      const odfDirectory = path.join(workspace, ".odf")
      await fs.mkdir(odfDirectory)
      const joinPath = path.join(odfDirectory, "parallel-join-cancel-demo.json")
      const ledgerPath = path.join(odfDirectory, "attempt-ledger-cancel-demo.json")
      await fs.writeFile(joinPath, JSON.stringify({ change: "cancel-demo", branches: [] }, null, 2), "utf8")
      await fs.writeFile(ledgerPath, JSON.stringify({ attempt_id: "impl-r1", status: "running" }, null, 2), "utf8")
      const bytesBefore = await Promise.all([fs.readFile(joinPath, "utf8"), fs.readFile(ledgerPath, "utf8")])
      const listingBefore = (await fs.readdir(odfDirectory)).sort()

      registerCancellationChild(child("workspace-parent", "workspace-child"))
      const session = {
        interrupt: vi.fn(async () => undefined),
        wait: vi.fn(async () => { throw new Error("wait failed") }),
      }
      const outcome = await handleParentCancellation({ parentSessionId: "workspace-parent", session })

      expect(outcome.unconfirmed).toEqual(["workspace-child"])
      expect(await Promise.all([fs.readFile(joinPath, "utf8"), fs.readFile(ledgerPath, "utf8")])).toEqual(bytesBefore)
      expect((await fs.readdir(odfDirectory)).sort()).toEqual(listingBefore)
    } finally {
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })

  it("keeps the child registered after an unconfirmed verdict and clears it after a confirmed retry", async () => {    registerCancellationChild(child("retry-parent", "retry-child"))
    const failing = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => { throw new Error("wait failed") }),
    }

    const failed = await handleParentCancellation({ parentSessionId: "retry-parent", session: failing })
    expect(failed.unconfirmed).toEqual(["retry-child"])
    expect(activeCancellationChildren("retry-parent").map(entry => entry.childSessionId)).toEqual(["retry-child"])

    const retried = await handleParentCancellation({ parentSessionId: "retry-parent", session: confirmedSession() })
    expect(retried.confirmed).toEqual(["retry-child"])
    expect(activeCancellationChildren("retry-parent")).toEqual([])
  })
})

describe("parent tool-call abort", () => {
  const parentToolContext = (sessionID: string, signal: AbortSignal) => ({
    sessionID,
    messageID: "message",
    agent: "odoo_orchestrator",
    signal,
    progress: vi.fn(async () => undefined),
  })

  it("fans the parent tool-call abort out to every registered child of that parent, once each", async () => {
    const controller = new AbortController()
    const session = {
      create: vi.fn(async () => ({ id: "abort-live-child" })),
      get: vi.fn(async () => ({ model: { providerID: "provider", id: "model" } })),
      prompt: vi.fn(() => new Promise<void>(() => undefined)),
      wait: vi.fn(async () => undefined),
      context: vi.fn(async () => []),
      interrupt: vi.fn(async () => undefined),
    }
    const bridge = createV2SessionTaskApi(parentToolContext("abort-parent", controller.signal) as never, session as never)
    registerCancellationChild(child("abort-parent", "abort-sibling-child", "native"))
    registerCancellationChild(child("abort-other-parent", "abort-other-child", "native"))

    const invocation = invokeTask(bridge, "odoo_qa_engineer", "wait", undefined, 600_000, controller.signal)
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalled())
    controller.abort()
    await expect(invocation).rejects.toThrow("task-cancelled")

    // The live invocation's child and the parent's other registered child are
    // both cancelled, each with its own exact session ID and exactly once.
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "abort-live-child" })
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "abort-sibling-child" })
    expect(session.interrupt).toHaveBeenCalledTimes(2)
    // Parent isolation: the other parent's child is never touched.
    expect(readCancellationOutcome("abort-other-parent")).toBeNull()
    expect(activeCancellationChildren("abort-other-parent")).toHaveLength(1)
  })
})

describe("registration race", () => {
  it("targets a child registered while the cancellation is in flight", async () => {
    let releaseWait: (() => void) | undefined
    const gatedWait = new Promise<void>(resolve => { releaseWait = resolve })
    registerCancellationChild(child("race-parent", "race-child-1", "native"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => gatedWait),
      get: vi.fn(async () => ({})),
      context: vi.fn(async () => []),
    }

    const run = handleParentCancellation({ parentSessionId: "race-parent", session })
    registerCancellationChild(child("race-parent", "race-child-2", "parallel"))
    releaseWait?.()

    const outcome = await run

    expect(session.interrupt).toHaveBeenCalledTimes(2)
    expect(session.wait).toHaveBeenCalledTimes(2)
    expect(outcome.confirmed).toEqual(["race-child-1", "race-child-2"])
    expect(outcome.verdicts.map(verdict => verdict.path)).toEqual(["native", "parallel"])
  })

  it("never omits a child registered inside the window when the first snapshot was empty", async () => {
    vi.useFakeTimers()
    const session = confirmedSession()
    const run = handleParentCancellation({ parentSessionId: "empty-window-parent", session })

    // The first snapshot is empty and drains immediately; the child is
    // registered after that pass but still inside the bounded window.
    await vi.advanceTimersByTimeAsync(0)
    registerCancellationChild(child("empty-window-parent", "window-child", "parallel"))
    await vi.advanceTimersByTimeAsync(delegationCancellationDeadlineMs())

    const outcome = await run
    const verdict = outcome.verdicts.find(entry => entry.child_session_id === "window-child")

    expect(verdict).toBeDefined()
    expect(verdict?.status).toBe("confirmed")
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "window-child" })
  })

  it("reports a child discovered after the deadline as unconfirmed with its ID preserved", async () => {
    vi.useFakeTimers()
    const parentSessionId = "late-parent"
    registerCancellationChild(child(parentSessionId, "busy-child", "native"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(() => new Promise<void>(() => undefined)),
    }

    // Registered exactly as the bounded window closes: the final pass must still
    // classify it instead of omitting it.
    setTimeout(() => {
      registerCancellationChild(child(parentSessionId, "late-child", "sequential"))
    }, delegationCancellationDeadlineMs())
    const run = handleParentCancellation({ parentSessionId, session })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(delegationCancellationDeadlineMs())

    const outcome = await run
    const late = outcome.verdicts.find(verdict => verdict.child_session_id === "late-child")

    expect(late).toBeDefined()
    expect(late?.status).toBe("unconfirmed")
    expect(late?.reason).toBe("deadline-expired")
    expect(outcome.unconfirmed).toEqual(["busy-child", "late-child"])
  })

  it("does not target children of another parent registered during the same window", async () => {
    let releaseWait: (() => void) | undefined
    const gatedWait = new Promise<void>(resolve => { releaseWait = resolve })
    registerCancellationChild(child("scoped-parent-a", "scoped-child-a", "native"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => gatedWait),
      get: vi.fn(async () => ({})),
      context: vi.fn(async () => []),
    }

    const run = handleParentCancellation({ parentSessionId: "scoped-parent-a", session })
    registerCancellationChild(child("scoped-parent-b", "scoped-child-b", "native"))
    releaseWait?.()

    const outcome = await run

    expect(session.interrupt).toHaveBeenCalledTimes(1)
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "scoped-child-a" })
    expect(outcome.verdicts.map(verdict => verdict.child_session_id)).toEqual(["scoped-child-a"])
    expect(readCancellationOutcome("scoped-parent-b")).toBeNull()
    expect(activeCancellationChildren("scoped-parent-b")).toHaveLength(1)
  })
})

describe("idempotence and isolation", () => {
  it("reuses the in-flight run for a duplicate trigger of the same parent", async () => {
    let releaseWait: (() => void) | undefined
    const gatedWait = new Promise<void>(resolve => { releaseWait = resolve })
    registerCancellationChild(child("duplicate-parent", "duplicate-child", "native"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => gatedWait),
      get: vi.fn(async () => ({})),
      context: vi.fn(async () => []),
    }

    const first = handleParentCancellation({ parentSessionId: "duplicate-parent", session })
    const second = handleParentCancellation({ parentSessionId: "duplicate-parent", session })
    expect(second).toBe(first)

    releaseWait?.()
    const [firstOutcome, secondOutcome] = await Promise.all([first, second])

    expect(session.interrupt).toHaveBeenCalledTimes(1)
    expect(session.wait).toHaveBeenCalledTimes(1)
    expect(firstOutcome).toEqual(secondOutcome)
    expect(firstOutcome.confirmed).toEqual(["duplicate-child"])
    expect(firstOutcome.unconfirmed).toEqual([])
  })

  it("does not re-interrupt a confirmed child on a repeated trigger", async () => {
    registerCancellationChild(child("repeat-parent", "repeat-child", "native"))
    const session = confirmedSession()

    const first = await handleParentCancellation({ parentSessionId: "repeat-parent", session })
    const second = await handleParentCancellation({ parentSessionId: "repeat-parent", session })

    expect(first.confirmed).toEqual(["repeat-child"])
    expect(session.interrupt).toHaveBeenCalledTimes(1)
    expect(second.verdicts).toEqual([])
    expect(second.unconfirmed).toEqual([])
  })

  it("isolates concurrent parent A and parent B cancellations", async () => {
    const releases: Array<() => void> = []
    const gate = (): Promise<void> => new Promise<void>(resolve => { releases.push(resolve) })
    registerCancellationChild(child("concurrent-parent-a", "concurrent-child-a1", "sequential"))
    registerCancellationChild(child("concurrent-parent-a", "concurrent-child-a2", "parallel"))
    registerCancellationChild(child("concurrent-parent-b", "concurrent-child-b1", "native"))
    const sessionA = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(() => gate()),
      get: vi.fn(async () => ({})),
      context: vi.fn(async () => []),
    }
    const sessionB = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(() => gate()),
      get: vi.fn(async () => ({})),
      context: vi.fn(async () => []),
    }

    const runA = handleParentCancellation({ parentSessionId: "concurrent-parent-a", session: sessionA })
    const runB = handleParentCancellation({ parentSessionId: "concurrent-parent-b", session: sessionB })
    await vi.waitFor(() => expect(releases).toHaveLength(3), { interval: 1 })
    for (const release of [...releases]) release()
    const [outcomeA, outcomeB] = await Promise.all([runA, runB])

    expect(calledSessionIds(sessionA.interrupt)).toEqual([
      { sessionID: "concurrent-child-a1" },
      { sessionID: "concurrent-child-a2" },
    ])
    expect(calledSessionIds(sessionB.interrupt)).toEqual([{ sessionID: "concurrent-child-b1" }])
    expect(outcomeA.verdicts.map(verdict => verdict.parent_session_id)).toEqual(["concurrent-parent-a", "concurrent-parent-a"])
    expect(outcomeB.verdicts.map(verdict => verdict.parent_session_id)).toEqual(["concurrent-parent-b"])
    expect(outcomeA.confirmed).toEqual(["concurrent-child-a1", "concurrent-child-a2"])
    expect(outcomeB.confirmed).toEqual(["concurrent-child-b1"])
  })
})

describe("parent cancellation trigger", () => {
  it("cancels exactly the trigger parent's registered children", async () => {
    registerCancellationChild(child("trigger-parent-a", "trigger-child-a1", "sequential"))
    registerCancellationChild(child("trigger-parent-a", "trigger-child-a2", "parallel"))
    registerCancellationChild(child("trigger-parent-b", "trigger-child-b1", "native"))
    const session = confirmedSession()

    await handleNativeDelegationSessionEvent({
      type: "session.execution.interrupted",
      durable: { aggregateID: "trigger-parent-a", seq: 1, version: 1 },
      data: { sessionID: "trigger-parent-a", reason: "user" },
    }, session)

    expect(calledSessionIds(session.interrupt)).toEqual([
      { sessionID: "trigger-child-a1" },
      { sessionID: "trigger-child-a2" },
    ])
    expect(session.interrupt).not.toHaveBeenCalledWith({ sessionID: "trigger-child-b1" })
    const outcome = readCancellationOutcome("trigger-parent-a")
    expect(outcome?.verdicts.map(verdict => verdict.child_session_id)).toEqual(["trigger-child-a1", "trigger-child-a2"])
    expect(outcome?.trigger).toEqual({ event: "session.execution.interrupted", reason: "user" })
    expect(readCancellationOutcome("trigger-parent-b")).toBeNull()
  })

  it("is a no-op with an empty verdict for an unknown parent and for a parent with no children", async () => {
    const session = confirmedSession()

    await handleNativeDelegationSessionEvent({
      type: "session.execution.interrupted",
      durable: { aggregateID: "no-children-parent", seq: 1, version: 1 },
      data: { sessionID: "no-children-parent", reason: "shutdown" },
    }, session)

    expect(session.interrupt).not.toHaveBeenCalled()
    expect(session.wait).not.toHaveBeenCalled()
    expect(readCancellationOutcome("no-children-parent")).toEqual({
      parent_session_id: "no-children-parent",
      trigger: { event: "session.execution.interrupted", reason: "shutdown" },
      verdicts: [],
      confirmed: [],
      unconfirmed: [],
    })
  })

  it("does not trigger on session.idle, on a non-cancellation error, or from an interrupted launch record", async () => {
    const session = confirmedSession()
    registerNativeLaunchChild("idle-parent", "idle-token", "idle-child", "native")

    await handleNativeDelegationSessionEvent({ type: "session.idle", properties: { sessionID: "idle-child" } }, session)
    await handleNativeDelegationSessionEvent({ type: "session.idle", properties: { sessionID: "idle-parent" } }, session)
    await handleNativeDelegationSessionEvent({
      type: "session.error",
      properties: { sessionID: "idle-parent", error: { name: "ProviderError" } },
    }, session)

    expect(session.interrupt).not.toHaveBeenCalled()
    expect(session.wait).not.toHaveBeenCalled()
    expect(readCancellationOutcome("idle-parent")).toBeNull()
    expect(activeCancellationChildren("idle-parent").map(entry => entry.childSessionId)).toEqual(["idle-child"])
    clearNativeLaunchChildren("idle-parent", "idle-token")

    // A native launch record in state "interrupted" is never idle evidence:
    // confirmation still requires session.wait, which rejects here.
    const interruptedRecord = {
      parent_session_id: "interrupted-parent",
      child_session_id: "interrupted-child",
      state: "interrupted" as const,
    }
    registerCancellationChild(child(interruptedRecord.parent_session_id, interruptedRecord.child_session_id))
    const failing = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => { throw new Error("no terminal idle") }),
    }
    await handleNativeDelegationSessionEvent({
      type: "session.execution.interrupted",
      durable: { aggregateID: "interrupted-parent", seq: 1, version: 1 },
      data: { sessionID: "interrupted-parent", reason: "user" },
    }, failing)

    expect(readCancellationOutcome("interrupted-parent")?.verdicts[0]).toMatchObject({
      child_session_id: "interrupted-child",
      status: "unconfirmed",
      terminal_idle_confirmed: false,
    })
  })

  it("processes every reason value of the pinned event union", async () => {
    const reasons = ["user", "shutdown", "superseded", "inactivity"]
    for (const reason of reasons) {
      const parentSessionId = `reason-parent-${reason}`
      registerCancellationChild(child(parentSessionId, `reason-child-${reason}`, "sequential"))
      const session = confirmedSession()

      await handleNativeDelegationSessionEvent({
        type: "session.execution.interrupted",
        durable: { aggregateID: parentSessionId, seq: 1, version: 1 },
        data: { sessionID: parentSessionId, reason },
      }, session)

      expect(session.interrupt).toHaveBeenCalledWith({ sessionID: `reason-child-${reason}` })
      expect(readCancellationOutcome(parentSessionId)?.trigger).toEqual({
        event: "session.execution.interrupted",
        reason,
      })
      expect(readCancellationOutcome(parentSessionId)?.confirmed).toEqual([`reason-child-${reason}`])
    }
  })
})

describe("native and parallel registration", () => {
  it("registers a serial native launch child with path native and a parallel branch child with path parallel", () => {
    registerNativeLaunchChild("launch-parent", "token-serial", "launch-child-native", "native")
    registerNativeLaunchChild("launch-parent", "token-parallel", "launch-child-parallel", "parallel")
    registerNativeLaunchChild("launch-parent", "token-default", "launch-child-default")

    expect(activeCancellationChildren("launch-parent")).toEqual([
      { parentSessionId: "launch-parent", childSessionId: "launch-child-native", path: "native" },
      { parentSessionId: "launch-parent", childSessionId: "launch-child-parallel", path: "parallel" },
      { parentSessionId: "launch-parent", childSessionId: "launch-child-default", path: "native" },
    ])

    clearNativeLaunchChildren("launch-parent", "token-serial")
    clearNativeLaunchChildren("launch-parent", "token-parallel")
    clearNativeLaunchChildren("launch-parent", "token-default")
  })

  it("interrupts each native and parallel child exactly once with its own ID", async () => {
    registerNativeLaunchChild("launch-parent", "token-serial", "launch-child-native", "native")
    registerNativeLaunchChild("launch-parent", "token-parallel", "launch-child-parallel", "parallel")
    const session = confirmedSession()

    const outcome = await handleParentCancellation({ parentSessionId: "launch-parent", session })

    expect(calledSessionIds(session.interrupt)).toEqual([
      { sessionID: "launch-child-native" },
      { sessionID: "launch-child-parallel" },
    ])
    expect(outcome.verdicts.map(verdict => verdict.path)).toEqual(["native", "parallel"])
    expect(outcome.confirmed).toEqual(["launch-child-native", "launch-child-parallel"])

    clearNativeLaunchChildren("launch-parent", "token-serial")
    clearNativeLaunchChildren("launch-parent", "token-parallel")
  })

  it("interrupts a child reachable through two launch keys only once", async () => {
    registerNativeLaunchChild("launch-parent", "token-serial", "launch-child-shared", "native")
    registerNativeLaunchChild("launch-parent", "token-parallel", "launch-child-shared", "parallel")
    // Two launch keys, one registration: the child can only be interrupted once.
    expect(activeCancellationChildren("launch-parent")).toHaveLength(1)
    const session = confirmedSession()

    const outcome = await handleParentCancellation({ parentSessionId: "launch-parent", session })

    expect(activeCancellationChildren("launch-parent")).toEqual([])
    expect(session.interrupt).toHaveBeenCalledTimes(1)
    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "launch-child-shared" })
    expect(outcome.verdicts).toHaveLength(1)

    clearNativeLaunchChildren("launch-parent", "token-serial")
    clearNativeLaunchChildren("launch-parent", "token-parallel")
  })
})

describe("sequential registration", () => {
  const toolContext = {
    sessionID: "sequential-parent",
    messageID: "message",
    agent: "odoo_orchestrator",
    signal: new AbortController().signal,
    progress: vi.fn(async () => undefined),
  }

  const validOdfResult = {
    status: "ok",
    executive_summary: "Phase completed",
    strategy: "custom",
    artifacts_saved: [],
    next_recommended: [],
    risks: [],
    odoo_version: 18,
    modules_affected: [],
    skill_resolution: "injected",
  }

  it("registers the sequential child while its invocation is in flight and cancels it on a parent-scoped trigger", async () => {
    const session = {
      create: vi.fn(async () => ({ id: "sequential-child" })),
      get: vi.fn(async () => ({ model: { providerID: "provider", id: "model" } })),
      prompt: vi.fn(() => new Promise<void>(() => undefined)),
      wait: vi.fn(async () => undefined),
      context: vi.fn(async () => []),
      interrupt: vi.fn(async () => undefined),
    }
    const bridge = createV2SessionTaskApi(toolContext as never, session as never)
    void bridge({ agent: "odoo_qa_engineer", prompt: "wait" })
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalled())

    expect(activeCancellationChildren("sequential-parent")).toEqual([
      { parentSessionId: "sequential-parent", childSessionId: "sequential-child", path: "sequential" },
    ])

    const outcome = await handleParentCancellation({ parentSessionId: "sequential-parent", session })

    expect(session.interrupt).toHaveBeenCalledWith({ sessionID: "sequential-child" })
    expect(session.wait).toHaveBeenCalledWith({ sessionID: "sequential-child" })
    expect(outcome.confirmed).toEqual(["sequential-child"])
    expect(activeCancellationChildren("sequential-parent")).toEqual([])
  })

  it("unregisters the sequential child when the invocation fulfils", async () => {
    const session = {
      create: vi.fn(async () => ({ id: "fulfilled-child" })),
      get: vi.fn(async () => ({ model: { providerID: "provider", id: "model" } })),
      prompt: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      context: vi.fn(async () => [{ type: "assistant", content: [{ type: "text", text: JSON.stringify(validOdfResult) }] }]),
      interrupt: vi.fn(async () => undefined),
    }
    const bridge = createV2SessionTaskApi(toolContext as never, session as never)

    await bridge({ agent: "odoo_qa_engineer", prompt: "fulfil" })

    expect(activeCancellationChildren("sequential-parent")).toEqual([])
  })

  it("keeps the sequential child registered when the invocation rejects", async () => {
    const session = {
      create: vi.fn(async () => ({ id: "rejected-child" })),
      get: vi.fn(async () => ({ model: { providerID: "provider", id: "model" } })),
      prompt: vi.fn(async () => { throw new Error("session-prompt-error") }),
      wait: vi.fn(async () => undefined),
      context: vi.fn(async () => []),
      interrupt: vi.fn(async () => undefined),
    }
    const bridge = createV2SessionTaskApi(toolContext as never, session as never)

    await expect(bridge({ agent: "odoo_qa_engineer", prompt: "reject" })).rejects.toThrow("session-prompt-error")

    // The child may still be running, so the registration survives the abort.
    expect(activeCancellationChildren("sequential-parent")).toEqual([
      { parentSessionId: "sequential-parent", childSessionId: "rejected-child", path: "sequential" },
    ])
  })
})

describe("non-guarantees", () => {
  it("publishes the bounded cancellation contract without termination claims", () => {
    const description = createODFRegisteredTools().odf_delegate.description

    expect(description).toContain("session.interrupt")
    expect(description).toContain("session.wait")
    expect(description).toContain("reported confirmed")
    expect(description).toContain("reports the child session ID")
    expect(description).toContain("may leave it unknown")
    expect(description).toContain("SIGKILL")
    expect(description).toContain("no-op on runtimes that emit no session.execution.interrupted event")
    // No termination wording: "idle" is only ever the required confirmation
    // source (session.wait terminal idle), never a claim about a stopped child.
    expect(description.toLowerCase()).not.toContain("stopped")
  })

  it("never renders an unconfirmed outcome as stopped", async () => {
    registerCancellationChild(child("render-parent", "render-child"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(async () => { throw new Error("wait failed") }),
    }

    const outcome = await handleParentCancellation({ parentSessionId: "render-parent", session })

    expect(JSON.stringify(outcome)).not.toContain("stopped")
    expect(outcome.verdicts[0].status).toBe("unconfirmed")
  })
})

describe("cancellation deadline", () => {
  it("reports unconfirmed with the ID preserved when the child stays busy past the deadline", async () => {
    vi.useFakeTimers()
    registerCancellationChild(child("deadline-parent", "deadline-child", "parallel"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(() => new Promise<void>(() => undefined)),
    }

    const run = handleParentCancellation({ parentSessionId: "deadline-parent", session })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(delegationCancellationDeadlineMs())
    const outcome = await run

    expect(outcome.verdicts[0]).toMatchObject({
      child_session_id: "deadline-child",
      status: "unconfirmed",
      reason: "deadline-expired",
      interrupt_requested: true,
      terminal_idle_confirmed: false,
    })
    expect(activeCancellationChildren("deadline-parent")).toHaveLength(1)
  })

  it("does not upgrade a latched verdict when the background wait resolves later", async () => {
    vi.useFakeTimers()
    let releaseWait: (() => void) | undefined
    registerCancellationChild(child("latched-parent", "latched-child"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(() => new Promise<void>(resolve => { releaseWait = resolve })),
    }

    const run = handleParentCancellation({ parentSessionId: "latched-parent", session })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(delegationCancellationDeadlineMs())
    const outcome = await run

    expect(outcome.verdicts[0].reason).toBe("deadline-expired")
    releaseWait?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome.verdicts[0].status).toBe("unconfirmed")
    expect(outcome.confirmed).toEqual([])
    expect(activeCancellationChildren("latched-parent")).toHaveLength(1)
  })

  it("reads the window from the exported env override", async () => {
    vi.useFakeTimers()
    vi.stubEnv(ENV_DEADLINE, String(TEST_DEADLINE_OVERRIDE_MS))
    expect(delegationCancellationDeadlineMs()).toBe(TEST_DEADLINE_OVERRIDE_MS)
    registerCancellationChild(child("env-parent", "env-child"))
    const session = {
      interrupt: vi.fn(async () => undefined),
      wait: vi.fn(() => new Promise<void>(() => undefined)),
    }

    const run = handleParentCancellation({ parentSessionId: "env-parent", session })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(delegationCancellationDeadlineMs())
    const outcome = await run

    expect(outcome.verdicts[0].reason).toBe("deadline-expired")
    expect(outcome.verdicts[0].child_session_id).toBe("env-child")
  })
})
