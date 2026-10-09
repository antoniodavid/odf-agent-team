# Plugin Reference — `odf-delegation`

The ODF plugin injects **31 tools** into the orchestrator's tool list at runtime. They are **not MCP tools** — they are registered by the OpenCode plugin host from `plugins/odf-delegation.ts`.

## Tool inventory

| Tool | Kind | Purpose |
|------|------|---------|
| `odf_delegate` | write | Route a phase + prompt to the right sub-agent with skill injection |
| `odf_delegation_prepare` | write | Resolve agent/skills/profile/prompt and mint a bounded delegation token |
| `odf_delegation_launch` | write | Verify prepared prompt bytes against the token and submit them through the V2 session API |
| `odf_delegation_late_seal_prepare` | write | Verify an expired original child and mint a token/attempt/parent/child-bound, single-use late-seal capability |
| `odf_proposal_write` | write | Persist the token-bound PROPOSE artifact to its canonical OpenSpec path |
| `odf_delegation_seal` | write | Bind the child session to the token, run the phase gates and return the standard envelope |
| `odf_parallel_delegate` | write | Cross-domain BUILD as 2–3 parallel branches, one aggregate join |
| `odf_parallel_prepare` | write | Prepare a native parallel BUILD: branch prompts + one token |
| `odf_parallel_seal` | write | Seal a native parallel BUILD: verify branch sessions, run the aggregate scheduler, commit once |
| `odf_workflow_route` | read | Canonical thin-spine route for a work type |
| `odf_workflow_advance` | read | Preview/verify a transition (never mutates) |
| `odf_workflow_archive` | write | Locked, idempotent terminal ARCHIVE transition through the selected store |
| `odf_workflow_override` | write | Audited skip / re-enter / re-plan / settle-stale-attempt (BUILD & VERIFY can never be skipped) |
| `odf_workflow_bind` | write | Start or bind workflow state in the selected store |
| `odf_workflow_status` | read | Canonical status from OpenSpec / Engram / `.odf` |
| `odf_feedback_submit` | write | Preview or submit one explicitly confirmed, privacy-bounded feedback aggregate |
| `odf_entry_triage` | read | Classify micro / standard / full entry + pick work type |
| `odf_context_manifest` | read | Bounded, reference-only context manifest for a candidate |
| `odf_skill_inject` | read | Match and inject skill compact rules into a prompt |
| `odf_skill_resolve` | read | Preview matching skills **without** executing |
| `odf_registry_read` | read | Read + cache `odf-registry.json` (TTL + file watcher) |
| `odf_profile_select` | read | Which model profile applies to a phase |
| `odf_policy_gate` | write | Resolve + persist TDD/risk gate before IMPLEMENT/VERIFY |
| `odf_receipt` | write | Persist a failure-disposition receipt |
| `odf_status` | read | Legacy change status from Engram observations |
| `odf_notebooklm_lookup` | read | Search NotebookLM notebooks |
| `odf_community_tool_detect` | read | Is an optional tool (e.g. CodeGraph) available? |
| `odf_community_tool_install` | write | Install + wire an optional tool |
| `odf_governance_provenance` | write | Record OCA AI provenance in `.odf/ai-provenance.json` |
| `odf_governance_check` | read | OCA governance gate: diff, trailers, provenance |
| `odf_health` | read | Installed/runtime health check |

## Modules (`odf-plugin/`)

The entrypoint stays a monolith for the delegation core; self-contained concerns live beside it:

| Module | Responsibility |
|--------|----------------|
| `odf-delegation-shared.ts` | Safe paths, registry type model, `ODF_REGISTERED_TOOLS` |
| `odf-delegation-metrics.ts` | Telemetry records, flush loop, token estimation |
| `odf-feedback.ts` | Local-session aggregate preview and opt-in HTTPS feedback submission |
| `odf-delegation-health.ts` | Read-only health, native task adapter, SDK session fallback |
| `odf-delegation-policy.ts` | Policy Gate resolution/persistence |
| `odf-delegation-loopguard.ts` | Duplicate-launch and loop protection |
| `odf-late-seal-capability.ts` | One-time, short-TTL authority bound to an expired token/attempt/parent/child |
| `odf-session-status.ts` | Bounded process-local cache of observed V2 child liveness |
| `odf-delegation-receipts.ts` | Failure receipts |
| `odf-workflow.ts` | Canonical stage state machine |
| `odf-workflow-status.ts` | Read-only status merger (OpenSpec authority) |
| `entry-triage.ts` | Deterministic micro/standard/full classification |
| `odf-expectations.ts` | Human Expectations + revisions |
| `odf-governance.ts` | OCA governance gate |
| `odf-observability.ts` | Structured logging |
| `odf-parallel-join.ts` | Aggregate join for parallel branches |
| `odf-registry-io.ts` | Registry read/cache |
| `odf-skills.ts` | Skill matching + compact-rule injection |
| `odf-source-authority.ts` | Local Odoo source resolution |
| `odf-context-manifest.ts` | Bounded context manifest |
| `candidate-manifest.ts` | Candidate tracking |
| `odf-community-tools.ts` | CodeGraph detect/install |
| `opencode-v2-adapter.ts` | Official V2 `Plugin.define`/`setup` adapter (tools, hooks, session bridge) |
| `opencode-v2-entrypoint.ts` | V2-only entrypoint re-export |
| `odf-tool.ts` | Host-neutral `tool` helper (identity function + `zod` schema namespace) that replaces the runtime import of `@opencode-ai/plugin` |
| `runtime-boundary.ts` | Host-neutral plugin id/lifecycle seam |

## `odf_delegate` flow

```
orchestrator
   │  odf_delegate(phase, prompt, context_files)
   ▼
┌─ plugin ─────────────────────────────────────────────┐
│ 1. load odf-registry.json (TTL cache)                │
│ 2. resolve agent  (phase + keywords → agent)         │
│ 3. match ≤5 skills (phase-aware canonical matcher)   │
│ 4. inject compact rules + active profile into prompt │
│ 5. enforce Policy Gate / evidence seal / design_closed│
│ 6. transport:                                         │
│      native toolCtx.task  ──or──  SDK child session   │
│ 7. return envelope {status, agent, skills, result}    │
│    status ∈ delegated | blocked | error | timeout     │
└──────────────────────────────────────────────────────┘
   │
   ▼
specialist agent  ──►  Odoo worktree (edits, tests)
```

**Why one call is efficient:** the orchestrator issues a single `odf_delegate` round-trip. The plugin does registry lookup, agent resolution, skill matching, profile selection, and gate enforcement *inside that call* — the specialist arrives pre-loaded with rules instead of spending its own turns grepping the repo.

**Blocked envelope:** if no task API is available, the tool returns `{status:"blocked", reason:"task-api-unavailable"}` and **never** hands back an executable fallback prompt.

## Native prepare/seal flow (OpenCode V2)

The native prepare/launch/seal flow creates visible child sessions through the
V2 API instead of handing prompt text to the host `subagent` tool:

```
orchestrator
   │ 1. odf_delegation_prepare(phase, change, prompt, …)
   │      → { token, delegation: { agent, description, prompt } }
   │ 2. odf_delegation_launch({ token, change, prompt })
   │      → session.prompt(text: exact prepared bytes) → child sessionID
   │ 3. odf_delegation_seal({ token, change, session_id })
   ▼
plugin
   • verifies the child session (agent, prompt digest, workspace, parentID when present)
   • reads the ODF Result through the V2 session API
   • runs the composite gates or replays the authoritative delegate for BUILD/VERIFY
     (proof revalidation, prepared policy gate, validation-evidence seal, workflow commit,
      attempt settlement, failure receipts)
   • consumes the token and returns the standard envelope (+ task_session_id)
```

- Launch checks the prompt digest and UTF-8 byte length before creating a child,
  then submits the same string directly through `session.prompt`. The seal
  independently hashes the child transcript; a successful API call or returned
  session ID is not proof of receipt.
- A durable launch record binds parent and child IDs. Retries reuse the same
  session and never resend prompts in `sending`, `uncertain`, or `interrupted`
  states. Only a persisted `created` state can resume submission.
- The seal reads the transcript through the documented V2 `session.context`
  API, including its projected V2 message and supported response-envelope
  shapes. Empty, incomplete, malformed, or failed reads return a bounded
  `conversation_read.context` diagnostic; raw host error text is not exposed.
- For proof-backed attempts, the returned child ID is first recorded as
  `native_child_observed_session_id` (unverified). It becomes
  `native_child_session_id` only after ancestry, agent, workspace, idle, and
  exact prompt-digest checks pass. An observed ID alone never completes or
  settles an attempt; an unreadable transcript leaves the token and attempt
  available for a safe retry.
- The token is a bounded opaque `odf-tok-…` file under `.odf/` (two-hour TTL);
  binding failures keep it for a retry, processed delegations consume it.
- IMPLEMENT/VERIFY also require `artifact_store`, the exact `workflow_advance`
  proof and a fresh `attempt_id`; the attempt is acquired at prepare time and
  settled by the seal. Fast-lane BUILD/VERIFY stays on `odf_delegate`.
- If the original two-hour token expires after launch, call
  `odf_delegation_late_seal_prepare` in the original parent session with the
  original token and child ID. It verifies the still-running attempt, child
  ancestry/agent/workspace, idle state, and exact prompt bytes without changing
  the token or attempt. Pass the returned ten-minute capability to
  `odf_delegation_seal`; ordinary evidence and workflow gates still apply. Only
  an accepted seal consumes the capability; do not relaunch the child or edit
  the original expiry.

### Native parallel BUILD (cross-domain)

`odf_parallel_prepare` → one `odf_delegation_launch` call with every exact branch
prompt → `odf_parallel_seal` runs the same aggregate scheduler as
`odf_parallel_delegate` with visible branch sessions: per-branch validation evidence, the
`.odf/parallel-join-{change}.json` artifact, one BUILD commit and one aggregate
receipt on failure. The aggregate envelope matches `odf_parallel_delegate` plus
per-branch `task_session_id`. Branch context files must not overlap and branches
range from two to three.

### Causal workflow diagnostics

`odf_workflow_status` includes a bounded `observability.causal_sequence` from
native delegation token records: prepared, host-dispatch, seal-start,
child-result-read, workflow-commit-observed, and seal-result milestones. These
timestamps represent when ODF persisted or observed each boundary, not inferred
provider timestamps. `causal_gaps` and partial source coverage identify
timestamps or milestones that were not persisted; the status
does not invent times or expose the token, full prompt, or raw seal envelope.
Each event carries the change and sanitized stage artifact references. The
child-result event compares prepared, dispatched, and received digest prefixes
and UTF-8 lengths, with a bounded difference summary. Only safe session IDs are
included for correlation. Reads are capped at 1,000 `.odf/` directory entries
and 100 token records per change.
`observability.delegation_status` keeps stage-artifact presence, latest observed
child liveness/result, handoff integrity, seal, and canonical commit distinct.
Liveness is `unknown` until a V2 `session.status` event has been observed; the
reported next action is advisory and never performs recovery.

### Active-change discovery and recovery

When `odf_workflow_status` is called without `change_name`,
`active_change_resolution.status` is one of `none`, `unambiguous`, `ambiguous`,
or `incomplete`; an explicitly named query reports `explicit`. Candidate
projections and source scanning are bounded and read-only; `candidate_count` is
`null` when a source is missing, malformed, or truncated. Continuation
may use the returned snapshot only for `unambiguous` with one resumable
candidate; multiple candidates require a user choice, and any discovery warning
blocks implicit selection. OpenSpec and Engram are both enumerated because a
single OpenSpec-authoritative change does not prove that no Engram-only change
also exists. The selected workflow state remains authoritative, and the same
snapshot used to establish uniqueness is used to render the selected status.
Passing an exact `change_name` can resolve candidate ambiguity, but does not
clear receipts, make a non-resumable change resumable, or bypass any gate.

Recovery remains separate from diagnosis. `busy` or `retry` child liveness means
wait for that exact child; missing liveness is `unknown`, never idle. An idle
child still requires the original prompt-integrity and seal/evidence checks.
Stale attempts use the audited `odf_workflow_override` recovery path only after
the parent/child bindings and idle state are proven. An expired native token
requires `odf_delegation_late_seal_prepare` to mint a different ten-minute,
single-use capability bound to the original token, attempt, parent, and child;
the original expiry is unchanged, and the resulting seal reruns normal gates.
These recommendations do not automatically launch, settle, or mutate work.
Before a recovery mutation, the orchestrator reports its observed cause,
evidence references, bounded action, and possible effects. Afterward it reports
the persisted change and remaining pending gates. Recovery outcomes and elapsed
time are local bounded metric spans; host-provided `cost_usd` and real token
counts are captured only when present, never synthesized.

### Conversational routing and offline evidence

Explicit slash commands override natural-language routing. Read-only
investigation stays in EXPLORE; implementation after exploration requires an
explicit user request and a fresh authorized workflow. Direct feature and
bugfix starts are recognized narrowly by the V2 adapter and receive the same
first-operation `odf_health` gate and same-session bind capability as command
starts. The natural entry capability is bound to a compatible work type and a
single chosen change name; ambiguous or unsupported text does not mint it.

Deterministic offline journeys (`scripts/odf-issue-122-journeys.test.ts`) cover
exploration-to-feature, bugfix-to-verified-fix, follow-up/resume, ambiguous
intent, active-child wait timeout, and scope escalation. Focused regressions also
exercise prompt detection and bind authorization
(`opencode-v2-adapter.test.ts`), active-change selection and store failures
(`odf-delegation.test.ts`, `orchestrator.test.ts`), child timeout/settlement
(`odf-delegation-prepare-seal.test.ts`, `odf-native-attempt-recovery.test.ts`),
and redacted causal diagnostics (`odf-observability.test.ts`). These deterministic
tests validate implementation boundaries; they do not simulate model judgment
or claim conversational-quality improvements. Evaluation remains offline and
provider-agnostic.

### Explicit online feedback

`/odf-feedback <change>` previews an aggregate from the current session's local
metrics. It sends nothing until the user reviews the destination and values and
confirms. The endpoint is operator-configured, HTTPS-only, and disabled by
default. Only an explicit 1–5 rating and bounded aggregate counts, duration,
latest phase status, and host-provided token/cost values are sent. Prompts,
outputs, free text, identifiers, paths, model/provider names, and estimates are
excluded. There is no durable outbox or retry. The endpoint owner must enforce
the configured 1–30-day retention; ODF cannot verify remote retention. See
[`metrics-and-engram-maintenance.md`](metrics-and-engram-maintenance.md) for the
payload and configuration contract.

**Visibility and interruptions:** programmatic launch returns child session IDs;
the parent transcript need not contain a host `subagent` row. With legacy
`odf_delegate` the delegation runs inside the tool call, so the child session —
titled `ODF <phase> → <agent> · <change>` — is visible under `/sessions` while
it runs. An interrupted or uncertain programmatic submission is never resent;
retry the seal with that same session ID so it can independently wait for and
inspect the transcript. If the prompt was not admitted, the seal fails closed.

## Transport

1. **Native** — host exposes `toolCtx.task`; permissions derive from the host.
2. **SDK child session** — `client.session.create` + `client.session.prompt`; parent session, agent, model, and workspace-relative context are forwarded. Best-effort metadata binding; native permissions remain authoritative when available.
3. Neither → blocked (see above).

## Invariants

- BUILD and VERIFY can never be skipped; only DECIDE/PLAN via audited `odf_workflow_override`.
- Max **5** skill compact rules per delegation.
- Policy Gate for IMPLEMENT/VERIFY is authoritative and recomputed only by `odf_policy_gate`.
- Task failures auto-seal a receipt.
- Registry relative paths resolve against the directory containing `odf-registry.json`; absolute legacy paths keep working.
