---
description: "Continue the ODF flow from the last completed stage. Usage: /odf-continue [change-name]"
triggers: ["/odf-continue"]
agent: odoo_orchestrator
---

# /odf-continue — Continue ODF change

Resumes the ODF flow from the last completed stage of the most recent active change or of a named change. The canonical route is `DECIDE -> optional PLAN -> BUILD -> VERIFY`; legacy phases are only read through their adapter.

When the user intentionally changes scope (skipping PLAN, repeating a stage, or re-planning with new Expectations), use `odf_workflow_override` (skip/re-enter/re-plan) after explicit user approval; never alter state by hand. For a stale running attempt left by a pre-fix interruption (visible as `active_attempts` with `status: running` in `odf_workflow_status` and no live task), settle it with `odf_workflow_override action=settle-attempt`, the `attempt_id`, `confirm_no_active_run: true`, and a human-approved reason.

## Usage

```
/odf-continue                         — Resume the most recent active change
/odf-continue <change-name>           — Resume a specific change
/odf-continue <change-name> --work-type <type> — Explicit recovery without binding
```

## Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `change-name` | No | string | Name of the change to continue. If omitted, the most recent one is used |
| `--work-type` | No | canonical work type | Explicit choice required when the legacy state has no binding |

## Examples

- `/odf-continue`
- `/odf-continue sale-discount-field`

## Orchestrator Instructions

1. **Load active changes** from `openspec/changes/*/state.yaml` (and/or Engram `odf/*/state`).
2. **Sort** by `last_updated` descending.
3. **Select change**:
   - If a name is provided: load that change; error if it is not active.
   - If there is no name: choose the most recent one.
   - If several are active and no name is given: list them and ask the user.
4. **Verify preflight**: if it is incomplete, run the preflight gate first.
5. **Query `odf_workflow_status`** and read its `work_type`. If a valid value exists, use it as the authority; never infer it from `legacy_phase`, artifacts, or `solution_strategy`.
6. Apply `state_kind` without losing legacy recovery: `expectations-only` blocks and refers to `/odf-new {change}`; `none` blocks due to total absence; `legacy-artifacts` preserves `resumable: true` and requires `--work-type <type>` when `recovery_work_type_required` is `true`, then resolves that explicit route without creating or binding state; `canonical` uses the normal state. `/odf-continue` never creates workflows, never passes `preflight`/`expectations` to `odf_workflow_bind`, and never infers `work_type`. If a canonical state exists but the binding is missing, require `--work-type` and bind only that existing state with its explicit store.
7. **Resolve the route** with the persisted or explicitly selected work type through `odf_workflow_route(work_type)` and use its canonical stages: `DECIDE -> optional PLAN -> BUILD -> VERIFY`.
8. **Query `odf_workflow_status`** and use `canonical_stage`, `pending_stage`, `resumable`, and `receipt` as the canonical state; then dispatch the next stage through the legacy adapter, without reinterpreting historical phases as new stages:
   - `PROPOSE` + `ASSESS` → `DECIDE`
   - `QA-PLAN` + `DESIGN` → `PLAN`
   - `IMPLEMENT` → `BUILD`
   - `VERIFY` → `VERIFY`
9. **Rediscover the pending receipt** in `<worktree>/.odf/receipt-{change}.json` or through the adapted state. Prefer the read-only bundle: `PACK="${ODF_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"; node "$PACK/scripts/odf-toolkit.js" state --root <root> --change <change>` (state + receipts + gates in one compact JSON; never search the filesystem for the script). If `receipt.state` is `pending`, stop and re-present its disposition with the evidence; never resume even if the OpenSpec/Engram artifact suggests a pending stage.
10. **Select the first pending canonical stage**. Do not invent a phase, do not repeat already completed work, and do not relaunch an adapter whose artifact is already confirmed.
11. **Delegate** the next stage through `odf_delegate`; use the legacy adapter only to run or read historical contracts.
12. **Show the approval gate** after the stage when the interaction mode requires it. With `execution_mode: auto`, the continuation auto-runs the pending phase and then auto-launches the following phases under the same stop conditions (internal result `ok`/`warning`, no pending receipt, no pending correction/disposition, verified validation evidence, and no product/scope decision required).

For BUILD (`IMPLEMENT`) and VERIFY starts, include the persisted or explicitly selected `work_type`, the `odf_workflow_advance` transition input under `workflow_advance`, an explicit `artifact_store: openspec|engram`, and a fresh opaque `attempt_id`. Reusing an ID or relaunching a completed stage is blocked; an already committed desired state returns `already-committed` without relaunching. The standalone tool is advisory and store-independent; the delegate re-reads, validates, and commits only the selected store before closing the attempt. An evidence or persistence failure does not advance the canonical state. Never substitute a default value or infer it from legacy state. The binding must explicitly receive `artifact_store: openspec` or `artifact_store: engram`; Engram-only callers must use the persisted state recovered by status. Never claim OpenSpec persistence for Engram-only. Legacy omissions of `workflow_advance` are only compatible when `flags.strict_workflow` is `false` (explicit opt-out; the registry default is `true` since strict workflow activation), remain without auto-commit; with `true`, they are blocked before delegating.

For a persisted `work_type: cross-domain` at BUILD, use `odf_parallel_delegate` instead of `odf_delegate`. Pass one shared `change`, explicit selected `artifact_store`, `phase: IMPLEMENT`, and the exact shared `workflow_advance` proof that advances to `BUILD`. Supply 2-3 independent branches with unique safe `branch_id` and fresh safe `attempt_id` values plus non-overlapping `context_files`; concurrency is fixed at 3. Branches never commit individually. A `parallel_join` with `join.status: running` exposes active branch statuses and running/completed/failed counts; do not close BUILD or relaunch those branches. Do not close BUILD unless the aggregate `join.status` is `complete`, every branch returned a successful delegated envelope, and every branch `validation.status` is `verified`; then commit the selected store once. A blocked/failed branch or unverified validation blocks BUILD and writes one aggregate receipt. After the complete join, run VERIFY sequentially.

For a cross-domain BUILD continuation, read the supplemental `.odf/parallel-join-{change}.json` evidence through `odf_workflow_status`. If its `join.status` is `running`, stop: active branches are visible, and `resume_from_join: true` must fail closed with `reason: parallel-join-running` rather than relaunching them. Otherwise call `odf_parallel_delegate` with `resume_from_join: true`, the exact `workflow_advance` proof, and no `branches` or conversation-derived prompts. Reuse every completed and verified branch without relaunching it. The scheduler creates fresh attempt IDs only for retryable or incomplete branches, keeps the original aggregate `join.expected` and completed count semantics, and permits one remaining retry branch only in this continuation path. A malformed, mismatched, oversized, or unsafe join blocks closed; fresh calls still require 2-3 branches.

## Routing Contract

- Input: `/odf-continue` command with optional name and `--work-type`.
- Output: conversational prompt with:
  - `command: odf-continue`
  - `change: <change-name|latest>`
  - `work_type: <canonical type>` only when explicit recovery is provided

## Error Handling

- **Named change not active**: list active ones and suggest `/odf-new`.
- **No active changes**: report and suggest `/odf-new <name>`.
- **`odf_delegate` error**: show the message, keep state, offer to retry.

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
