---
description: "Start new Odoo feature/module with ODF workflow. Usage: /odf-new <name> [description] [--fast]"
triggers: ["/odf-new"]
agent: odoo_orchestrator
---

# /odf-new — Start ODF change

Starts a new ODF change using the canonical flow `DECIDE -> optional PLAN -> BUILD -> VERIFY`.
Legacy mapping remains compatible: `DECIDE = PROPOSE + ASSESS`, `PLAN = QA-PLAN + DESIGN`,
and `BUILD = IMPLEMENT`.

## Usage

```
/odf-new <change-name> ["description"] [--fast]
```

## Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `change-name` | Yes | string | Change identifier in kebab-case. E.g.: `sale-discount-field` |
| `description` | No | string | Short description in quotes. If omitted, the change name is used |
| `--fast` | No | flag | Skips intermediate approval gates up to IMPLEMENT. Choosing `execution_mode: auto` in preflight makes intermediate approvals automatic while still applying the mandatory gates |

## Examples

- `/odf-new sale-discount-field`
- `/odf-new sale-discount-field "Add configurable discount per partner category"`
- `/odf-new pos-custom-receipt --fast`
- `/odf-new sale-discount-field "Add configurable discount per partner category"` — in preflight, answer `execution_mode: auto` for autopilot

## Orchestrator Instructions

1. **Run `odf_health` first**: this MUST be the first ODF operation, before `question`, status/triage/route tools, Engram writes, artifact/state creation, or delegation. Continue only for `warning` with required checks present (or future `ok`). If the tool is missing, throws, returns malformed output, `failed`, or `blocked`, stop immediately with no later side effects.
2. **Parse arguments**: extract `change-name`, optional `description`, and the `--fast` flag.
3. **Sanitize** the name to kebab-case.
4. **Check for an existing change** with `odf_workflow_status`: if `state_present: true` and the selected state is active, offer `/odf-continue {change}` or ask to rename. Expectations without state are not an active workflow and are not resumable.
5. **Load project configuration** from `odf-init/{project}` if it exists.
6. **Run the preflight gate**: if it is incomplete, ask for the missing fields in English and validate them, but keep it in memory; do not persist it yet.
7. **Construct ICE context once** from already available project facts, then invoke `odf_entry_triage`. The optional `ice_context` envelope is reference-only: it contains bounded provenance, safe references, and classifier metadata, never raw intent or Expectations content. Forward it only to entry triage; do not persist it, send it to phase delegation, or build a second context artifact. Explicit/current user fields and approved Expectations remain authoritative; valid context only fills omitted facts, while risk signals may add a monotonic escalation. Invalid, unsafe, or incomplete context is ignored with a warning and cannot make the request more eligible. Do not invent project facts or automatically query CodeGraph in this slice.
8. **Classify the entry** with `odf_entry_triage`: pass the parsed `description` and the available optional fields (`module`, `domain`, `expected_files`, `expectations_clear`, `risk_signals`). Pass `known_modules` with the project modules from `odf-init/{project}` (persisted config) so triage flags nonexistent modules. If `needs_question` is `true`, ask ONE grouped question (data + intent/context/Expectations when the description is not concrete) and re-run triage. Use its `work_type`; do not choose it freely. Migration/security/payment/public API/data-loss/pii are never micro.
9. **Redundancy pre-check (before PROPOSE)**: with domain terms from the `description`, run:
   ```
   PACK="${ODF_CONFIG_DIR:-$HOME/.config/opencode}"
   node "$PACK/scripts/odf-toolkit.js" redundancy --repo <repo-dir> --terms "<domain terms>" --project <project-name>
   ```
   It searches existing implementations (models/views/static/controllers/data/tests, bounded) and prior learnings (`odf-learned/{project}` = basis of "already seen/rejected"). If there are relevant matches or learnings that contradict, present them to the user (extend what exists / already implemented / cancel) BEFORE delegating PROPOSE; never decide alone.
10. **Resolve Expectations**: first read the existing artifact from the same store. If it is approved, valid, and matches the human contract exactly, reuse its IDs and content without asking, renumbering, or saving again. If it differs or is invalid/tampered, block. If it does not exist, distill intent and Expectations from the USER (description + ONE clarification), restate `EXP-01…EXP-N` with `owned_by: "human"`, ask for explicit confirmation, and keep the approved document in memory.
11. **Resolve the route** with `odf_workflow_route(work_type)`.
12. **Start atomically through `odf_workflow_bind`**: pass `change_name`, `work_type`, the complete preflight, and the exact approved `expectations` document. Missing-state creation is accepted only under the runtime authorization issued for this exact `/odf-new` command/change after health; an ordinary bind cannot create state. Use `artifact_store: openspec` for OpenSpec or hybrid authority and `artifact_store: engram` for Engram-only. For `small-change`/`standard-config`, also pass `terminal_stage: DECIDE`; for all others bind before the first phase. The tool persists canonical state before Expectations. Never persist either artifact directly. Stop on any blocked/failure result.
13. **Run DECIDE** through `PROPOSE` and `ASSESS` only for non-micro routes. Micro routes use the terminal DECIDE materialized by the bind; `standard-config` ends there.
14. **Run optional PLAN**, then BUILD and VERIFY according to the resolved route. Do not reintroduce skipped legacy adapters.
15. If `--fast`, skip voluntary approval gates only where existing compatibility permits; never skip health, preflight, Expectations approval/reuse validation, Policy Gate, validation evidence, route-required VERIFY, or failure disposition. If `execution_mode` is `auto`, the voluntary approval gates are skipped automatically under the same rules as `--fast`, and the mandatory gates listed here still apply: health, preflight, Expectations approval/reuse validation, Policy Gate, validation evidence, route-required VERIFY, and failure disposition.

For BUILD (`IMPLEMENT`) and VERIFY starts, pass the persisted `work_type`, exact transition input as `workflow_advance`, explicit authoritative `artifact_store`, and a fresh opaque `attempt_id` for each launch. Reusing an ID or relaunching a completed phase is blocked; an already committed desired state returns `already-committed` without relaunching. `odf_workflow_advance` is read-only and store-independent; the delegate re-reads, validates, and commits only the selected store before settling the attempt. Evidence or persistence failure leaves canonical state unchanged and blocks. A `/odf-new` run without a persisted binding must stop; never forward an unbound caller default. Legacy calls that omit `workflow_advance` are blocked unless `flags.strict_workflow` is explicitly `false` (opt-out); they never auto-commit.

For cross-domain BUILD, use `odf_parallel_delegate` instead of `odf_delegate`: pass one shared `change`, explicit `artifact_store`, `work_type: cross-domain`, `phase: IMPLEMENT`, and the exact shared `workflow_advance` proof that advances to `BUILD`. Provide 2-3 independent branches, each with a unique safe `branch_id`, fresh safe `attempt_id`, prompt, and non-overlapping `context_files`; the scheduler has a fixed concurrency cap of 3. Branches do not commit workflow state individually. BUILD closes only after the aggregate `join.status: complete`, every branch returns a successful delegated envelope, and every branch has `validation.status: verified`; then the selected store is committed once. Any blocked/failed branch or unverified validation blocks BUILD and produces one aggregate receipt. VERIFY always runs sequentially after a complete join.

Standard configuration terminates after DECIDE and has no BUILD or VERIFY stage. Small changes
may use an inline plan before BUILD. Existing public phase commands and legacy phase IDs remain
available for compatibility; they have not disappeared.

## Routing Contract

- Input: `/odf-new` command with parsed arguments.
- Output: conversational prompt for the orchestrator with the fields:
  - `command: odf-new`
  - `change: <change-name>`
  - `description: <description>`
  - `fast: true|false`
  - `ice_context: <optional bounded reference-only envelope>`
- `work_type`: deterministic result of `odf_entry_triage(description + optional fields)`; never chosen at will.

## Error Handling

- **Missing `change-name`**: show usage and abort.
- **Duplicate name**: warn and offer to continue or rename.
- **Invalid preflight**: re-ask for fields with allowed values.
- **`odf_delegate` error**: show the message, keep state, offer to retry.

## Output Format

```
ODF: Starting change "{change-name}"

Phase: PROPOSE
Agent: odoo_proposer
...

Assessment completed:
  Strategy: {standard | custom}
  Summary: {executive_summary}

Do you want to adjust anything, or shall we continue?
```
