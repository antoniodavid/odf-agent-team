# M2 Design — Prepare/Seal Native Delegation

Status: accepted for implementation (2026-09-28). Implements the Phase 2 route in
`odd/tasks/native-delegation-migration.md` for roadmap issue #55. `odf_delegate`
keeps working unchanged; the native path is additive until parity is proven.

## Context

OpenCode V2 exposes subagents only through the host `subagent` tool (child
session, foreground or background). Plugins cannot invoke it and cannot set
`parentID` on `session.create` today (upstream `anomalyco/opencode#49389`).
ODF still needs its gates on every phase boundary. The split below lets the
orchestrator own the visible native launch while the plugin owns everything
that makes the delegation safe.

## Decision

Delegate in two plugin calls around one native host call:

```text
orchestrator
  → odf_delegation_prepare   (plugin: agent, skills, gate, prompt, token)
  → subagent                 (host: visible child session)
  → odf_delegation_seal      (plugin: bind, validate, commit, seal, metrics)
```

The plugin never calls `task()` and never launches a session for this path; the
host owns the child session and its lifecycle. Every gate stays plugin-side and
deterministic.

### ADR-lite

- **Decision**: two plugin tools, one host `subagent` call, bound by an opaque
  delegation token stored under `.odf/`.
- **Options considered**: (a) plugin bridge only (status quo, no subtask);
  (b) host `parentID` forwarding only (blocked upstream, gives linkage but not
  gate placement); (c) hook-based interception of `subagent` calls (cannot
  replace the tool result, so the envelope would have nowhere to live);
  (d) prepare/seal (chosen).
- **Consequence**: one extra orchestrator round-trip per phase and a token
  lifecycle to bound; in exchange the delegation is visible, background-capable
  and host-managed, while the gates do not move.

## Token

Opaque, bounded, workspace-scoped:

```json
{
  "schema_version": 1,
  "token": "odf-tok-<32 hex>",
  "change": "barcode-cycle-count-list-ux",
  "phase": "IMPLEMENT",
  "agent": "odoo_batch_implementer",
  "artifact_store": "openspec",
  "workspace": "<realpath of the workspace root>",
  "prompt_digest": "<sha256 of the enriched prompt>",
  "context_files": ["..."],
  "attempt_id": "impl-r7",
  "branch_id": "default",
  "created_at": "2026-09-28T19:30:00.000Z",
  "expires_at": "2026-09-28T21:30:00.000Z",
  "status": "prepared"
}
```

- Stored at `.odf/delegation-<change>-<token>.json` (one file per token, bounded
  to 16 KiB, `ensureSafeOdfDirectory` + containment guards).
- TTL: 2 hours. Expired or unknown tokens fail closed.
- One prepared token per `(change, phase, agent, branch_id)`: a new prepare for
  the same key supersedes the previous unsealed token (which is marked expired).
- Attempt acquisition happens in **prepare** (preserves the one-running-attempt
  concurrency guard); settlement happens in **seal**. A token that never seals
  leaves a running attempt recoverable through the existing audited
  `odf_workflow_override action=settle-attempt`.

## `odf_delegation_prepare`

Input: `change`, `phase`, `prompt`, optional `agent`, `artifact_store`,
`context_files`, `target`, `odoo_source_root`, `odoo_source_repos`, `profile`,
`workflow_advance`, `attempt_id`, `workspace_dir`.

Behavior (reuses today's helpers, no behavior forks):

1. Resolve workspace, change, agent (`resolveAgent`), skills (`matchSkills`) and
   profile exactly like `odf_delegate`.
2. IMPLEMENT/VERIFY: compute and persist the Policy Gate (`computePolicyGate`);
   block on `gate: "block"`. Acquire the attempt ledger record.
3. Assemble the same enriched prompt as `odf_delegate` (compact rules + profile
   block + source-authority contract + policy gate block + executor boundary)
   and prefix the ODF delegation marker carrying `change`, `phase`, `agent`,
   `token` and a human description.
4. Write the token file. Return:

```json
{
  "status": "prepared",
  "change": "…", "phase": "…", "agent": "…",
  "token": "odf-tok-…",
  "delegation": {
    "agent": "odoo_batch_implementer",
    "description": "ODF IMPLEMENT → odoo_batch_implementer · <change>",
    "prompt": "<enriched prompt, passed verbatim to subagent>"
  },
  "policy_gate": { "…": "…" },
  "profile": { "…": "…" },
  "skills_injected": ["…"],
  "source_authority_required": true,
  "attempt_id": "impl-r7",
  "next": "call subagent with delegation.agent/description/prompt, then odf_delegation_seal({ token, session_id })"
}
```

No workflow state is committed here; nothing runs yet.

## `odf_delegation_seal`

Input: `token`, `session_id`, optional `workspace_dir`.

Behavior:

1. Load and validate the token (exists, not expired, `status: "prepared"`,
   workspace match).
2. Verify the child session is the one bound to the token, fail-closed on any
   mismatch:
   - `session.get({ sessionID })` exists and its `agent` equals the token agent;
   - the session's first user prompt equals the token's enriched prompt
     (`prompt_digest`); the orchestrator must pass `delegation.prompt` verbatim;
   - the session directory equals the token workspace;
   - when the host exposes `parentID` (upstream #49389), require it to match the
     orchestrating session.
3. Read the child's final assistant text through the V2 session API and parse
   the ODF Result with the existing parser. No assistant text / aborted child →
   blocked with a receipt.
4. Run the same post-task gates as `odf_delegate`: source authority,
   `design_closed`, artifact refs, PLAN materialization, proof-backed BUILD/VERIFY
   lifecycle (validation evidence + workflow commit), attempt settlement,
   failure receipts, `task_session_id` in the envelope, metrics with
   `task_api_source: "subagent"`.
5. Mark the token sealed and delete it. Duplicate seal (`already-sealed`),
   unknown token and expiry each block with a distinct reason.

The returned envelope keeps the exact `odf_delegate` field set so orchestrator
and tests can consume either path.

## Enforcement and recovery

- Instructions (orchestrator + commands) require: prepare → `subagent` → seal,
  with the prepared `agent`/`description`/`prompt` passed verbatim.
- Hardening (same change, behind the existing hook surface): `execute.before`
  warns/blocks when an ODF agent is launched through `subagent` without the ODF
  marker, and seal reports unsealed tokens for the current change.
- Recovery: orphan token → `delegation-token-expired` / `settle-attempt`;
  duplicate seal → `delegation-already-sealed`; child aborted → blocked receipt.

## Compatibility

- `odf_delegate`, `odf_parallel_delegate` and the V2 bridge stay unchanged.
- New registered tools `odf_delegation_prepare` / `odf_delegation_seal` must be
  added to `ODF_REGISTERED_TOOLS`, the V2 adapter test that asserts the tool
  list, `operator` docs and the architecture docs.
- `DelegationMetrics["task_api_source"]` gains `"subagent"`.
- Parallel BUILD (Phase 3) reuses the token with `branch_id`; the aggregate join
  stays with `odf_parallel_delegate` semantics.

## Verification

- Unit: token lifecycle (create/read/expire/supersede/replay), prompt digest,
  path safety; prepare output (skills, gate, source-authority contract,
  marker); seal binding failures (agent/digest/workspace/session mismatch).
- Parity: for identical inner results, seal produces the same envelope as
  `odf_delegate` for DESIGN delegated, IMPLEMENT validation seal, VERIFY commit
  and failure receipt.
- Integration: mocked V2 session API with a child conversation; a real
  end-to-end run in an Odoo worktree as release evidence.
- Full matrix: typecheck, unit, YAML scenarios, registry validation, harness.
