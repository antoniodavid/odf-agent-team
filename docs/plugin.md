# Plugin Reference — `odf-delegation`

The ODF plugin injects **29 tools** into the orchestrator's tool list at runtime. They are **not MCP tools** — they are registered by the OpenCode plugin host from `plugins/odf-delegation.ts`.

## Tool inventory

| Tool | Kind | Purpose |
|------|------|---------|
| `odf_delegate` | write | Route a phase + prompt to the right sub-agent with skill injection |
| `odf_delegation_prepare` | write | Resolve agent/skills/profile/prompt and mint a bounded delegation token |
| `odf_delegation_launch` | write | Verify prepared prompt bytes against the token and submit them through the V2 session API |
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
| `odf-delegation-health.ts` | Read-only health, native task adapter, SDK session fallback |
| `odf-delegation-policy.ts` | Policy Gate resolution/persistence |
| `odf-delegation-loopguard.ts` | Duplicate-launch and loop protection |
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

### Native parallel BUILD (cross-domain)

`odf_parallel_prepare` → one `odf_delegation_launch` call with every exact branch
prompt → `odf_parallel_seal` runs the same aggregate scheduler as
`odf_parallel_delegate` with visible branch sessions: per-branch validation evidence, the
`.odf/parallel-join-{change}.json` artifact, one BUILD commit and one aggregate
receipt on failure. The aggregate envelope matches `odf_parallel_delegate` plus
per-branch `task_session_id`. Branch context files must not overlap and branches
range from two to three.

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
