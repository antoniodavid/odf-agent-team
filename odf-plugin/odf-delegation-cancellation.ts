/**
 * Parent-scoped delegation cancellation for ODF-managed child sessions.
 *
 * Cancellation is bounded and fail-closed. A child session is reported
 * `confirmed` only when `session.interrupt({ sessionID })` was requested for
 * that exact child and a following `session.wait({ sessionID })` for the same
 * child supplied terminal idle. Every other outcome — interrupt failure, wait
 * failure, an incomplete session API, or the bounded deadline elapsing — is
 * reported `unconfirmed` with the child session ID preserved, and the child
 * stays registered so a later attempt can still confirm it.
 *
 * Non-guarantees (REQ-09): this module makes no claim to stop children after a
 * SIGKILL of the host or of a child process, and parent cancellation is a no-op
 * on runtimes that emit no `session.execution.interrupted` event. Observed
 * `session.idle` and a `launch.state = "interrupted"` record are never idle
 * evidence and never produce a confirmed verdict.
 *
 * The module performs zero filesystem writes and zero ledger mutations: it
 * never settles an attempt, seals a child, writes a receipt, or touches a
 * parallel-join artifact.
 */

export type CancellationLaunchPath = "sequential" | "parallel" | "native"

/**
 * The only session capabilities the cancellation routine may use. `get` and
 * `context` are not called by the routine itself, but the contract requires them
 * on a complete V2 session API (REQ-06, E-06): their absence must fail closed as
 * `unconfirmed`, never as `confirmed`.
 */
export interface CancellationSessionApi {
  interrupt?: (input: { sessionID: string }) => unknown
  wait?: (input: { sessionID: string }) => unknown
  get?: (input: { sessionID: string }) => unknown
  context?: (input: { sessionID: string }) => unknown
}

/**
 * Contract capabilities required on top of `session.interrupt`/`session.wait`
 * before a verdict may be confirmed (REQ-06, E-06). `session.wait` supplies the
 * terminal idle; `session.get`/`session.context` are required by the existing
 * verification paths, so a session API missing either one is incomplete and can
 * never produce a confirmed verdict.
 */
const REQUIRED_CONFIRMATION_CAPABILITIES = ["get", "context"] as const

/** A child session registered as reachable by its parent's cancellation. */
export interface RegisteredCancellationChild {
  parentSessionId: string
  childSessionId: string
  path: CancellationLaunchPath
}

export type CancellationVerdictStatus = "confirmed" | "unconfirmed"

export type CancellationUnconfirmedReason =
  | "interrupt-failed"
  | "wait-failed"
  | "session-api-unavailable"
  | "deadline-expired"

export interface CancellationVerdict {
  parent_session_id: string
  child_session_id: string
  path: CancellationLaunchPath
  status: CancellationVerdictStatus
  /** `null` if and only if the verdict is confirmed. */
  reason: CancellationUnconfirmedReason | null
  /** True iff `session.interrupt` was issued for this exact child ID. */
  interrupt_requested: boolean
  /** True iff `session.wait` supplied terminal idle for this exact child ID. */
  terminal_idle_confirmed: boolean
  observed_at: string
}

export type ParentCancellationTrigger =
  | { event: "session.execution.interrupted"; reason: string }
  | { event: "child-launch-abort" }

export interface ParentCancellationOutcome {
  parent_session_id: string
  trigger: ParentCancellationTrigger | null
  /** One row per targeted child; a targeted child is never omitted. */
  verdicts: CancellationVerdict[]
  confirmed: string[]
  unconfirmed: string[]
}

/** Documented default cancellation window for one parent-scoped run. */
export const DEFAULT_DELEGATION_CANCELLATION_DEADLINE_MS = 5_000

/** The only deadline source in production code. */
export function delegationCancellationDeadlineMs(): number {
  const raw = Number(process.env.ODF_DELEGATION_CANCELLATION_DEADLINE_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DELEGATION_CANCELLATION_DEADLINE_MS
}

/** Bounded outcome store size, mirroring the observed-status store bound. */
export const MAX_TRACKED_CANCELLATION_PARENTS = 500

/**
 * Re-check cadence inside the bounded cancellation window. The fan-out keeps
 * re-reading the parent-scoped index until the deadline so a child registered
 * after an empty first snapshot is still classified (REQ-03), while completion
 * stays bounded by that same deadline.
 */
export const CANCELLATION_RECHECK_INTERVAL_MS = 10

const registered = new Map<string, Map<string, RegisteredCancellationChild>>()
const lastOutcome = new Map<string, ParentCancellationOutcome>()
const inFlightRuns = new Map<string, Promise<ParentCancellationOutcome>>()

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value)
}

/**
 * Idempotent registration: exactly one entry per (parent, child), so a child
 * reachable through two launch keys is interrupted at most once per run. There
 * is deliberately no cap and no eviction — an evicted entry would be a silently
 * omitted child, which REQ-03/REQ-06 forbid.
 */
export function registerCancellationChild(child: RegisteredCancellationChild): void {
  if (!safeIdentifier(child?.parentSessionId) || !safeIdentifier(child?.childSessionId)) return
  const children = registered.get(child.parentSessionId) ?? new Map<string, RegisteredCancellationChild>()
  if (!children.has(child.childSessionId)) {
    children.set(child.childSessionId, {
      parentSessionId: child.parentSessionId,
      childSessionId: child.childSessionId,
      path: child.path,
    })
  }
  registered.set(child.parentSessionId, children)
}

/** Remove a registration; called only for a confirmed verdict. */
export function unregisterCancellationChild(parentSessionId: string, childSessionId: string): void {
  const children = registered.get(parentSessionId)
  if (!children) return
  children.delete(childSessionId)
  if (children.size === 0) registered.delete(parentSessionId)
}

/** Deterministic (insertion order) snapshot of one parent's active children. */
export function activeCancellationChildren(parentSessionId: string): RegisteredCancellationChild[] {
  return [...(registered.get(parentSessionId)?.values() ?? [])]
}

/** Whole-index or per-parent reset, mirroring `clearNativeLaunchChildren`. */
export function clearCancellationIndex(parentSessionId?: string): void {
  if (parentSessionId === undefined) registered.clear()
  else registered.delete(parentSessionId)
}

/** Last bounded cancellation outcome for a parent, or null when none ran. */
export function readCancellationOutcome(parentSessionId: string): ParentCancellationOutcome | null {
  return lastOutcome.get(parentSessionId) ?? null
}

function rememberCancellationOutcome(outcome: ParentCancellationOutcome): void {
  lastOutcome.delete(outcome.parent_session_id)
  lastOutcome.set(outcome.parent_session_id, outcome)
  while (lastOutcome.size > MAX_TRACKED_CANCELLATION_PARENTS) {
    const oldest = lastOutcome.keys().next().value
    if (oldest === undefined) break
    lastOutcome.delete(oldest)
  }
}

type AttemptOutcome = "resolved" | "rejected"
type DeadlineRaceOutcome = AttemptOutcome | "expired"

/** Convert a session call into a settle signal so a rejection is never lost. */
function attempt(work: Promise<unknown>): Promise<AttemptOutcome> {
  return work.then(() => "resolved" as const, () => "rejected" as const)
}

/**
 * Resolve with the work's settle signal, or with `"expired"` when the shared
 * run deadline elapses first. The deadline is computed once per run, so a
 * background interrupt or wait that resolves after the window can never upgrade
 * a latched verdict.
 */
function raceDeadline(work: Promise<AttemptOutcome>, deadlineAt: number): Promise<DeadlineRaceOutcome> {
  return new Promise<DeadlineRaceOutcome>(resolve => {
    let settled = false
    const finish = (outcome: DeadlineRaceOutcome): void => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    const remaining = deadlineAt - Date.now()
    const timer = remaining > 0 ? setTimeout(() => finish("expired"), remaining) : null
    void work.then(outcome => {
      if (timer) clearTimeout(timer)
      finish(outcome)
    })
    if (!timer) finish("expired")
  })
}

/**
 * Resolve after one re-check interval, never past the run deadline: this is what
 * keeps the window open for late registrations while bounding completion.
 */
function awaitRecheckWindow(deadlineAt: number): Promise<void> {
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) return Promise.resolve()
  return new Promise<void>(resolve => {
    setTimeout(resolve, Math.min(remaining, CANCELLATION_RECHECK_INTERVAL_MS))
  })
}

function verdictFor(
  child: RegisteredCancellationChild,
  status: CancellationVerdictStatus,
  reason: CancellationUnconfirmedReason | null,
  interruptRequested: boolean,
  terminalIdleConfirmed: boolean,
): CancellationVerdict {
  return {
    parent_session_id: child.parentSessionId,
    child_session_id: child.childSessionId,
    path: child.path,
    status,
    reason,
    interrupt_requested: interruptRequested,
    terminal_idle_confirmed: terminalIdleConfirmed,
    observed_at: new Date().toISOString(),
  }
}

/**
 * One attempt for one child, with the verdict latched at first settlement. This
 * function is total: every branch returns a verdict, so no targeted child can be
 * omitted from the outcome.
 */
async function runChildCancellation(
  child: RegisteredCancellationChild,
  session: CancellationSessionApi | undefined,
  deadlineAt: number,
): Promise<CancellationVerdict> {
  const interrupt = session?.interrupt
  if (typeof interrupt !== "function") {
    return verdictFor(child, "unconfirmed", "session-api-unavailable", false, false)
  }

  // The interrupt is issued for this exact child; a rejection still counts as an
  // issued request, so `interrupt_requested` reflects the attempt.
  const interruptOutcome = await raceDeadline(
    attempt(Promise.resolve().then(() => interrupt({ sessionID: child.childSessionId }))),
    deadlineAt,
  )
  if (interruptOutcome === "expired") return verdictFor(child, "unconfirmed", "deadline-expired", true, false)
  if (interruptOutcome === "rejected") return verdictFor(child, "unconfirmed", "interrupt-failed", true, false)

  const wait = session?.wait
  if (typeof wait !== "function") return verdictFor(child, "unconfirmed", "session-api-unavailable", true, false)

  // `session.wait` is the only confirmation source; there is no retry.
  const waitOutcome = await raceDeadline(
    attempt(Promise.resolve().then(() => wait({ sessionID: child.childSessionId }))),
    deadlineAt,
  )
  if (waitOutcome === "expired") return verdictFor(child, "unconfirmed", "deadline-expired", true, false)
  if (waitOutcome === "rejected") return verdictFor(child, "unconfirmed", "wait-failed", true, false)

  // REQ-06 / E-06: terminal idle is not enough when the contract's session API is
  // incomplete. A session missing `get` or `context` fails closed as unconfirmed
  // with the child ID preserved, and never settles or mutates a record.
  if (REQUIRED_CONFIRMATION_CAPABILITIES.some(name => typeof session?.[name] !== "function")) {
    return verdictFor(child, "unconfirmed", "session-api-unavailable", true, false)
  }
  return verdictFor(child, "confirmed", null, true, true)
}

export interface CancellationFanOutOptions {
  parentSessionId: string
  session?: CancellationSessionApi
  /** Explicit child list; when given, no re-check happens (REQ-03 scope). */
  children?: RegisteredCancellationChild[]
  /** Parent-scoped re-check source, re-read until the deadline. */
  resolveChildren?: () => RegisteredCancellationChild[]
  /**
   * Children the caller already targeted itself (for example the live child of
   * a parent tool-call abort). They are never interrupted or re-reported by this
   * run, which is what keeps one interrupt per child across both mechanisms.
   */
  excludedChildSessionIds?: readonly string[]
  deadlineMs?: number
  trigger?: ParentCancellationTrigger | null
}

async function executeCancellationFanOut(options: CancellationFanOutOptions): Promise<ParentCancellationOutcome> {
  const parentSessionId = options.parentSessionId
  const deadlineAt = Date.now() + (options.deadlineMs ?? delegationCancellationDeadlineMs())
  const excluded = new Set(options.excludedChildSessionIds ?? [])
  const started = new Map<string, RegisteredCancellationChild>()
  const verdictByChild = new Map<string, CancellationVerdict>()
  const pipelines: Promise<void>[] = []

  const isTargetable = (child: RegisteredCancellationChild): boolean =>
    !started.has(child.childSessionId) && !excluded.has(child.childSessionId)

  const start = (candidates: RegisteredCancellationChild[]): void => {
    for (const child of candidates) {
      if (!isTargetable(child)) continue
      started.set(child.childSessionId, child)
      pipelines.push(runChildCancellation(child, options.session, deadlineAt).then(verdict => {
        verdictByChild.set(child.childSessionId, verdict)
      }))
    }
  }

  start(options.children ?? options.resolveChildren?.() ?? [])
  await Promise.allSettled(pipelines)

  // Registration race (REQ-03). An empty first snapshot is not evidence that the
  // parent has no children: such a run must not declare completion, so its window
  // stays open to the deadline and the final pass classifies whatever appeared —
  // a child registered inside the window is never silently dropped. Once children
  // have been classified, the drain rule completes as soon as a re-check pass adds
  // nothing. Both paths are bounded by the same deadline, and starting a child
  // with an elapsed window still requires session.wait for confirmation (REQ-05).
  if (options.resolveChildren) {
    const resolveChildren = options.resolveChildren
    const awaitingFirstChild = started.size === 0
    while (Date.now() < deadlineAt) {
      await awaitRecheckWindow(deadlineAt)
      const newlySeen = resolveChildren().filter(isTargetable)
      if (newlySeen.length > 0) {
        start(newlySeen)
        await Promise.allSettled(pipelines)
        continue
      }
      if (!awaitingFirstChild) break
    }
    const late = resolveChildren().filter(isTargetable)
    if (late.length > 0) {
      start(late)
      await Promise.allSettled(pipelines)
    }
  }

  const verdicts = [...started.values()]
    .map(child => verdictByChild.get(child.childSessionId))
    .filter((verdict): verdict is CancellationVerdict => Boolean(verdict))

  for (const verdict of verdicts) {
    if (verdict.status === "confirmed") unregisterCancellationChild(parentSessionId, verdict.child_session_id)
  }

  const outcome: ParentCancellationOutcome = {
    parent_session_id: parentSessionId,
    trigger: options.trigger ?? null,
    verdicts,
    confirmed: verdicts.filter(verdict => verdict.status === "confirmed").map(verdict => verdict.child_session_id),
    unconfirmed: verdicts.filter(verdict => verdict.status === "unconfirmed").map(verdict => verdict.child_session_id),
  }

  for (const verdict of verdicts) {
    if (verdict.status !== "unconfirmed") continue
    console.warn(
      `[odf-delegation] parent cancellation unconfirmed for child ${verdict.child_session_id}` +
      ` (parent ${verdict.parent_session_id}, path ${verdict.path}): ${verdict.reason}`,
    )
  }

  rememberCancellationOutcome(outcome)
  return outcome
}

/**
 * Bounded fan-out over one parent's children. A duplicate or repeated
 * *parent-scoped* trigger for the same parent reuses the run that is already in
 * flight instead of starting a second fan-out, so duplicate signals never
 * double-interrupt a child and never emit contradictory verdicts. A run with an
 * explicit child list (the child-launch-abort trigger) carries its own child set
 * and its own session, so it neither reuses nor registers here: swallowing it
 * into an unrelated in-flight run would silently drop its children.
 */
export function runCancellationFanOut(options: CancellationFanOutOptions): Promise<ParentCancellationOutcome> {
  const parentSessionId = options.parentSessionId
  const parentScoped = options.children === undefined
  if (parentScoped) {
    const inFlight = inFlightRuns.get(parentSessionId)
    if (inFlight) return inFlight
  }

  const run = executeCancellationFanOut(options)
  if (parentScoped) {
    inFlightRuns.set(parentSessionId, run)
    const clear = (): void => {
      if (inFlightRuns.get(parentSessionId) === run) inFlightRuns.delete(parentSessionId)
    }
    void run.then(clear, clear)
  }
  return run
}

/** Parent-scoped cancellation triggered by a verified parent cancellation event. */
export function handleParentCancellation(options: {
  parentSessionId: string
  session?: CancellationSessionApi
  deadlineMs?: number
  trigger?: ParentCancellationTrigger | null
  excludedChildSessionIds?: readonly string[]
}): Promise<ParentCancellationOutcome> {
  const parentSessionId = options.parentSessionId
  return runCancellationFanOut({
    parentSessionId,
    session: options.session,
    deadlineMs: options.deadlineMs,
    trigger: options.trigger ?? null,
    excludedChildSessionIds: options.excludedChildSessionIds,
    resolveChildren: () => activeCancellationChildren(parentSessionId),
  })
}

/**
 * Sibling fan-out for the `MessageAbortedError` child-launch trigger. The child
 * list is explicit, so no re-check runs: REQ-03 binds the parent-scoped run.
 */
export function cancelChildLaunchSiblings(options: {
  parentSessionId: string
  childSessionIds: string[]
  session?: CancellationSessionApi
  deadlineMs?: number
}): Promise<ParentCancellationOutcome> {
  const parentSessionId = options.parentSessionId
  const known = new Map(activeCancellationChildren(parentSessionId).map(child => [child.childSessionId, child]))
  const children = options.childSessionIds.map(childSessionId => known.get(childSessionId)
    ?? { parentSessionId, childSessionId, path: "native" as CancellationLaunchPath })
  return runCancellationFanOut({
    parentSessionId,
    session: options.session,
    deadlineMs: options.deadlineMs,
    trigger: { event: "child-launch-abort" },
    children,
  })
}
