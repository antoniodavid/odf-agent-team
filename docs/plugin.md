# Plugin Reference — `odf-delegation`

The ODF plugin injects **19 tools** into the orchestrator's tool list at runtime. They are **not MCP tools** — they are registered by the OpenCode plugin host from `plugins/odf-delegation.ts`.

## Tool inventory

| Tool | Kind | Purpose |
|------|------|---------|
| `odf_delegate` | write | Route a phase + prompt to the right sub-agent with skill injection |
| `odf_parallel_delegate` | write | Cross-domain BUILD as 2–3 parallel branches, one aggregate join |
| `odf_workflow_route` | read | Canonical thin-spine route for a work type |
| `odf_workflow_advance` | read | Preview/verify a transition (never mutates) |
| `odf_workflow_override` | write | Audited skip / re-enter / re-plan (BUILD & VERIFY can never be skipped) |
| `odf_workflow_bind` | write | Start or bind workflow state in the selected store |
| `odf_workflow_status` | read | Canonical status from OpenSpec / Engram / `.odf` |
| `odf_entry_triage` | read | Classify micro / standard / full entry + pick work type |
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
