---
description: "Continue the ODF flow from the last completed stage. Usage: /odf-continue [change-name]"
triggers: ["/odf-continue"]
agent: odoo_orchestrator
---

# /odf-continue — Continue ODF change

Resumes the ODF flow from the last completed stage of a named change or the only active change when discovery is complete. If several changes match or discovery is incomplete, ask the user to choose or resolve the blocker; never select by recency. The canonical route is `DECIDE -> optional PLAN -> BUILD -> VERIFY`; legacy phases are only read through their adapter.

When the user intentionally changes scope (skipping PLAN, repeating a stage, or re-planning with new Expectations), use `odf_workflow_override` (skip/re-enter/re-plan) after explicit user approval; never alter state by hand. For a stale running attempt left by a pre-fix interruption (visible as `active_attempts` with `status: running` in `odf_workflow_status` and no live task), settle it with `odf_workflow_override action=settle-attempt`, the `attempt_id`, `confirm_no_active_run: true`, and a human-approved reason. Native prepare/seal attempts additionally require the exact child session ID already persisted by a seal that verified the prepared prompt and idle state; the tool matches that ID, verifies its parent, and awaits V2 `session.wait` again. If the child binding is absent, retry the original seal with its prepared token and exact child session instead of settling. Never settle a native attempt when its child session ID is unavailable or its idle state cannot be confirmed. For a persisted parallel join left `running` by a host restart, settle every running branch attempt with `settle-attempt` and then the join with `odf_workflow_override action=settle-join` plus `confirm_no_active_run: true`; the join becomes blocked with a failure receipt, so commit a retry receipt before resuming.

## Usage

```
/odf-continue                         — Resume only when exactly one active change is discoverable
/odf-continue <change-name>           — Resume a specific change
/odf-continue <change-name> --work-type <type> — Explicit recovery without binding
```

## Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `change-name` | No | string | Exact change to continue. If omitted, discovery must be complete and return exactly one active change; ambiguity is read-only and requires a choice |
| `--work-type` | No | canonical work type | Explicit choice required when the legacy state has no binding |

## Examples

- `/odf-continue`
- `/odf-continue sale-discount-field`

## Orchestrator Instructions

1. **Query `odf_workflow_status` once**, passing `change_name` when provided. It uses the current session workspace by default; do not shell-scan the project or call a second status tool to reconstruct the same state.
2. **Resolve the returned change**: with a name, require an exact match. Without one, continue only when `active_change_resolution.status === "unambiguous"` and its sole candidate is resumable. For `ambiguous`, ask one grouped question listing candidates; for `incomplete` or `blocked`, report the warnings and stop; for `none`, report no active changes. Never choose by recency. An explicitly named `canonical_stage: ARCHIVED` change is already complete, not continuable; report that and do not use Engram to reinterpret it as active.
3. **Verify preflight**: if it is incomplete, run the preflight gate first.
4. Read the returned `work_type`. If a valid value exists, use it as the authority; never infer it from `legacy_phase`, artifacts, or `solution_strategy`.
5. Apply `state_kind` without losing legacy recovery: `expectations-only` blocks and refers to `/odf-new {change}`; `none` blocks due to total absence; `legacy-artifacts` preserves `resumable: true` and requires `--work-type <type>` when `recovery_work_type_required` is `true`, then resolves that explicit route without creating or binding state; `canonical` uses the normal state. `/odf-continue` never creates workflows, never passes `preflight`/`expectations` to `odf_workflow_bind`, and never infers `work_type`. If a canonical state exists but the binding is missing, require `--work-type` and bind only that existing state with its explicit store.
6. **Resolve the route** with the persisted or explicitly selected work type through `odf_workflow_route(work_type)` and use its canonical stages: `DECIDE -> optional PLAN -> BUILD -> VERIFY`.
7. Reuse the same status result while state is unchanged. Use `canonical_stage`, `pending_stage`, `resumable`, and `receipt` as canonical state, then dispatch the next stage through the legacy adapter without reinterpreting historical phases as new stages:
   - `PROPOSE` + `ASSESS` → `DECIDE`
   - `QA-PLAN` + `DESIGN` → `PLAN`
   - `IMPLEMENT` → `BUILD`
   - `VERIFY` → `VERIFY`
8. **Use the returned receipt and runtime data**. If `receipt.state` is `pending`, stop and re-present its disposition with evidence; never resume even if the OpenSpec/Engram artifact suggests a pending stage. If `active_attempts` shows a `running` attempt but no child task is active, ask/confirm no active run, then settle that exact attempt with `odf_workflow_override action=settle-attempt` before retrying. For a native prepare/seal attempt, the exact child must already be durably bound after the seal verified its prepared prompt; pass that same `child_session_id`. Settlement verifies the ID and parent and requires V2 `session.wait` to confirm idle again. If no binding exists or completion cannot be verified, leave the attempt running and retry the original seal with its token and child mapping. Never recover a delegation prompt from `.odf/` files or OpenCode's session database.
9. **Select the first pending canonical stage**. Do not invent a phase, repeat completed work, or relaunch an adapter whose artifact is already confirmed.
10. **Delegate** the next stage through the ODF delegation path: on OpenCode V2 use `odf_delegation_prepare` → `odf_delegation_launch` with the returned prompt unchanged → `odf_delegation_seal`; otherwise use `odf_delegate`. The seal returns the same envelope (plus `task_session_id`). `odf_delegate` remains mandatory for fast-lane BUILD/VERIFY. For fresh cross-domain BUILD use `odf_parallel_prepare` → one `odf_delegation_launch` call with every exact branch prompt → `odf_parallel_seal`; use `odf_parallel_delegate` as fallback and for `resume_from_join` continuation, which is not supported by native prepare. Use the legacy adapter only to run or read historical contracts.
11. **Show the approval gate** after the stage when the interaction mode requires it. With `execution_mode: auto`, the continuation auto-runs the pending phase and then auto-launches the following phases under the same stop conditions (internal result `ok`/`warning`, no pending receipt, no pending correction/disposition, verified validation evidence, and no product/scope decision required).

For BUILD (`IMPLEMENT`) and VERIFY starts, include the persisted or explicitly selected `work_type`, the `odf_workflow_advance` transition input under `workflow_advance`, an explicit `artifact_store: openspec|engram`, and a fresh opaque `attempt_id`. Reusing an ID or relaunching a completed stage is blocked; an already committed desired state returns `already-committed` without relaunching. The standalone tool is advisory and store-independent; the delegate re-reads, validates, and commits only the selected store before closing the attempt. An evidence or persistence failure does not advance the canonical state. Never substitute a default value or infer it from legacy state. The binding must explicitly receive `artifact_store: openspec` or `artifact_store: engram`; Engram-only callers must use the persisted state recovered by status. Never claim OpenSpec persistence for Engram-only. Legacy omissions of `workflow_advance` are only compatible when `flags.strict_workflow` is `false` (explicit opt-out; the registry default is `true` since strict workflow activation), remain without auto-commit; with `true`, they are blocked before delegating.

For a fresh `work_type: cross-domain` BUILD, use `odf_parallel_prepare` → `odf_delegation_launch` with all exact branch prompts → `odf_parallel_seal` on OpenCode V2; otherwise use `odf_parallel_delegate`. Pass one shared `change`, explicit selected `artifact_store`, `phase: IMPLEMENT`, and the exact shared `workflow_advance` proof that advances to `BUILD`. Supply 2-3 independent branches with unique safe `branch_id` and fresh safe `attempt_id` values plus non-overlapping `context_files`; concurrency is fixed at 3. Branches never commit individually. A `parallel_join` with `join.status: running` exposes active branch statuses and running/completed/failed counts; do not close BUILD or relaunch those branches. Do not close BUILD unless the aggregate `join.status` is `complete`, every branch returned a successful delegated envelope, and every branch `validation.status` is `verified`; then commit the selected store once. A blocked/failed branch or unverified validation blocks BUILD and writes one aggregate receipt. After the complete join, run VERIFY sequentially.

For a cross-domain BUILD continuation, read the supplemental `.odf/parallel-join-{change}.json` evidence through `odf_workflow_status`. If its `join.status` is `running`, stop: active branches are visible, and `resume_from_join: true` must fail closed with `reason: parallel-join-running` rather than relaunching them. If the host restarted and no branch attempt is active, recover the join with the audited `settle-attempt` (per running branch attempt) plus `settle-join` overrides and a committed retry receipt before continuing. For native prepared branches, each settlement requires the exact child ID already bound to that branch after prompt and idle verification; the override revalidates its parent and idle state. Otherwise call `odf_parallel_delegate` with `resume_from_join: true`, the exact `workflow_advance` proof, and no `branches` or conversation-derived prompts. Reuse every completed and verified branch without relaunching it. The scheduler creates fresh attempt IDs only for retryable or incomplete branches, keeps the original aggregate `join.expected` and completed count semantics, and permits one remaining retry branch only in this continuation path. A malformed, mismatched, oversized, or unsafe join blocks closed; fresh calls still require 2-3 branches.

## Routing Contract

- Input: `/odf-continue` command with optional exact name and `--work-type`.
- Output: conversational prompt with:
  - `command: odf-continue`
  - `change: <change-name|sole-unambiguous-active>`
  - `work_type: <canonical type>` only when explicit recovery is provided

## Error Handling

- **Named change archived**: report that it is complete and do not reinterpret Engram or legacy artifacts as active state.
- **Named change not found**: report that it is unavailable and suggest `/odf-new <name>` only if the user intends to start a new change.
- **Multiple active changes**: list the bounded candidates and ask the user to choose; do not continue any of them yet.
- **Incomplete active-change discovery**: report the blocker/warnings and stop, or ask for an exact name if that resolves the missing store; do not infer uniqueness.
- **No active changes**: report and suggest `/odf-new <name>` only if the user intends to start a new change.
- **Native prepare/subagent/seal or `odf_delegate` error**: show the message, keep state, offer to retry.

## Output Format

```
ODF: Continuing "{change-name}"

Last stage: {stage}
Next stage: {next-stage}
Canonical stage: {canonical_stage}
Pending canonical stage: {pending_stage}
Agent: {agent}
...
```
