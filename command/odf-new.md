---
description: "Start new Odoo feature/module with ODF workflow. Usage: /odf-new <name> [description] [--fast] [--assess]"
triggers: ["/odf-new"]
agent: odoo_orchestrator
---

# /odf-new — Start ODF change

Starts a new ODF change using the canonical flow `DECIDE -> optional PLAN -> BUILD -> VERIFY`.
The composite stages expose their roles: `DECIDE` = `PROPOSE` + `ASSESS`, `PLAN` = `QA-PLAN` +
`DESIGN`; `BUILD` and `VERIFY` have no role.

## One route shown to the user

The triage level (`micro/standard/full`) describes entry scope; the resolved
`work_type` selects the route. Canonical stages and their roles are internal
mappings, not additional user-facing stages or approvals. Show one
resolved route and its next action. The optional shadow prediction is advisory
and has `execution_unchanged: true`; it must not be presented as automatic
routing or as evidence that execution was shortened.

| Resolved work type | User-facing route |
|---|---|
| `question` / `investigation` | `EXPLORE` via `/odf-explore` (ephemeral; not bound) |
| `standard-config` | `DECIDE` (configuration guidance; terminal, no BUILD/VERIFY/archive) |
| `small-change` | `DECIDE → BUILD → VERIFY` (inline plan and focused QA) |
| `feature-inline` | `DECIDE → BUILD → VERIFY` (ICE decision; ASSESS only when the entry gate requires it) |
| `bugfix` | `FIX → BUILD → VERIFY` (diagnosis, root cause, regression) |
| `feature` / `cross-domain` / `migration` / `security` | `DECIDE → PLAN → BUILD → VERIFY` (formal plan/QA) |
| `verify-only` | `VERIFY` |

Every code-changing route carries a focused QA plan tied to approved
Expectations. Small changes and bugfixes keep it inline; routes requiring PLAN
or an explicit risk/complexity escalation use a formal QA-PLAN. VERIFY and its
evidence gates remain required by the resolved route.

## Usage

```
/odf-new <change-name> ["description"] [--fast] [--assess]
```

## Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `change-name` | Yes | string | Change identifier in kebab-case. E.g.: `sale-discount-field` |
| `description` | No | string | Short description in quotes. If omitted, the change name is used |
| `--fast` | No | flag | Skips intermediate approval gates up to BUILD. Choosing `execution_mode: auto` in preflight makes intermediate approvals automatic while still applying the mandatory gates |
| `--assess` | No | flag | Forces the bounded ASSESS decision gate on a `feature-inline` entry even when no other trigger fires |

## Examples

- `/odf-new sale-discount-field`
- `/odf-new sale-discount-field "Add configurable discount per partner category"`
- `/odf-new pos-custom-receipt --fast`
- `/odf-new sale-discount-field "Add configurable discount per partner category" --assess`
- `/odf-new sale-discount-field "Add configurable discount per partner category"` — in preflight, answer `execution_mode: auto` for autopilot

## Orchestrator Instructions

1. **Run `odf_health` first**: this MUST be the first ODF operation, before `question`, status/triage/route tools, Engram writes, artifact/state creation, or delegation. Continue only for `warning` with required checks present (or future `ok`). If the tool is missing, throws, returns malformed output, `failed`, or `blocked`, stop immediately with no later side effects. A missing tool is not a broken installation: ODF registers its tools per project when the runtime boots, so a project activated afterwards stays inert for that runtime. Report the `/odf-init` reload recovery (fully restart OpenCode — every window and the `opencode serve --service` daemon — then verify `/odf-health`) instead of proposing a reinstall.
2. **Parse arguments**: extract `change-name`, optional `description`, the `--fast` flag, and the `--assess` flag.
3. **Sanitize** the name to kebab-case.
4. **Check for an existing change** with `odf_workflow_status`: if `state_present: true` and the selected state is active, ask once: continue this existing change, rename, or cancel. On explicit continue, reuse this status result and the approved state/Expectations, then follow `/odf-continue` from its next-stage selection; do not require a repeated slash command, rerun preflight/triage/redundancy, rebind, or reconfirm unchanged Expectations. Expectations without state are not an active workflow and are not resumable. An archived change is never offered as active continuation.
5. **Load project configuration** from `odf-init/{project}` if it exists.
6. **Run the preflight gate**: if it is incomplete, derive stable values first (`artifact_store`, `delivery_strategy`, `review_budget_lines`, `odoo_version`, `chain_strategy`, `tdd_mode` from `odf-init/{project}` and defaults; `execution_mode: auto` for `small-change`, `bugfix`, and `feature-inline`). Ask only genuinely project-specific facts in one grouped question, validate the answers, and keep the record in memory; do not persist it yet.
7. **Construct ICE context once** from already available project facts, then invoke `odf_entry_triage`. The optional `ice_context` envelope is reference-only: it contains bounded provenance, safe references, and classifier metadata, never raw intent or Expectations content. Forward it only to entry triage; do not persist it, send it to phase delegation, or build a second context artifact. Explicit/current user fields and approved Expectations remain authoritative; valid context only fills omitted facts, while risk signals may add a monotonic escalation. Invalid, unsafe, or incomplete context is ignored with a warning and cannot make the request more eligible. Do not invent project facts or automatically query CodeGraph in this slice.
8. **Classify the entry** with `odf_entry_triage`: pass the parsed `description` and the available optional fields (`module`, `domain`, `expected_files`, `expectations_clear`, `risk_signals`). Pass `known_modules` with the project modules from `odf-init/{project}` (persisted config) so triage flags nonexistent modules. A bounded single-module/domain change with clear expectations and up to five predicted files qualifies as `small-change`. If `needs_question` is `true`, the returned work type is provisional: ask ONE grouped question (data + intent/context/Expectations when the description is not concrete) and re-run triage with the answers. Do not bind, delegate, or present a final route until `needs_question` is `false`; unresolved facts block rather than default to `feature`. Use the final `work_type`; do not choose it freely. `feature-inline` is the default for a standard entry; `feature` stays for explicit selection or when triage cannot classify safely. Migration/security/payment/public API/data-loss/pii are never micro.
9. **Context and redundancy pre-check (before DECIDE)**: with domain terms from the `description`, run:
   ```
   PACK="${ODF_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
   node "$PACK/scripts/odf-toolkit.js" redundancy --repo <repo-dir> --terms "<domain terms>" --project <project-name>
   ```
   It searches existing implementations (models/views/static/controllers/data/tests, bounded) and prior learnings (`odf-learned/{project}` = basis of "already seen/rejected"). If there are relevant matches or learnings that contradict, present them to the user (extend what exists / already implemented / cancel) BEFORE delegating DECIDE; never decide alone.
   Then **resolve the assessment gate**: when triage selected `feature-inline`, re-run `odf_entry_triage` with the same facts plus `context_files` (the repository-relative files already selected) and `redundancy: { hits, contradictions }`, and pass `explicit_assess: true` when `--assess` was used. Consume the returned `assessment_gate` exactly; do not override its `mode`, `reason`, or `signals`.
10. **Resolve Expectations**: first read the existing artifact from the same store. If it is approved, valid, and matches the human contract exactly, reuse its IDs and complete protected content without asking, renumbering, or saving again. Protected content includes `change`, `intent`, `expectations`, and any present top-level `constraints`, `success_scenarios`, `failure_scenarios`, or `connections`. If it differs or is invalid/tampered, block. If it does not exist, distill intent and Expectations from the USER (description + ONE clarification), restate `EXP-01…EXP-N` with `owned_by: "human"`, ask for explicit confirmation, and keep the approved document in memory.
11. **Resolve the route** with `odf_workflow_route(work_type)`.
12. **Start atomically through `odf_workflow_bind`**: pass `change_name`, `work_type`, the complete preflight, and the exact approved `expectations` document. Missing-state creation is accepted only under the runtime authorization issued for this exact `/odf-new` command/change after health; an ordinary bind cannot create state. Use `artifact_store: openspec` for OpenSpec or hybrid authority and `artifact_store: engram` for Engram-only. For `small-change`/`standard-config`, also pass `terminal_stage: DECIDE`; for all others bind before the first stage role. For `feature-inline`, branch only on the resolved gate:
    - `assessment_gate.mode: "skip"` → pass `terminal_stage: DECIDE`, the exact `assessment` object, `intent`, and `expectations_approved: true`.
    - `assessment_gate.mode: "assess"` → bind without `terminal_stage`; DECIDE stays pending until one bounded ASSESS saves the canonical `decision` artifact.
    - `assessment_gate.mode: "escalate"` → bind `work_type: feature` instead; never force a `feature-inline` terminal DECIDE through an escalation.
Do not start `question`/`investigation` through this command; use `/odf-explore`. The tool persists canonical state before Expectations. Never persist either artifact directly. Stop on any blocked/failure result.
13. **Run the route's entry stage role**: use `PROPOSE`/`ASSESS` only when the resolved route requires formal DECIDE. `small-change` uses the terminal DECIDE materialized by bind, `standard-config` ends there, `bugfix` begins at FIX, and `feature-inline` runs exactly one bounded `ASSESS` only when its gate mode is `assess`; otherwise it proceeds to BUILD. Lean ASSESS returns the canonical `decision` artifact with strategy, scope, affected areas, risks, and unknowns, and must not create `proposal`/`assess`/`design`/`qa-plan`/`tasks` artifacts. Never infer the route from the triage level alone.
14. **Run only the resolved route**: for inline-plan BUILD (`small-change`, `feature-inline`, `bugfix`), forward the persisted `work_type`, `plan: inline`, completed DECIDE/FIX evidence, approved Expectations, and bounded inline implementation tasks/QA plan; do not require formal ASSESS/DESIGN/QA-PLAN artifacts. Keep formal PLAN/QA-PLAN only when required by the route or an explicit risk/complexity escalation; then BUILD and VERIFY when that route requires them. Do not reintroduce skipped stages or ask for approval at a role-only transition.
15. If `--fast`, skip voluntary approval gates only where existing compatibility permits; never skip health, preflight, Expectations approval/reuse validation, Policy Gate, validation evidence, route-required VERIFY, or failure disposition. If `execution_mode` is `auto`, the voluntary approval gates are skipped automatically under the same rules as `--fast`, and the mandatory gates listed here still apply: health, preflight, Expectations approval/reuse validation, Policy Gate, validation evidence, route-required VERIFY, and failure disposition.

For BUILD and VERIFY starts, pass the persisted `work_type`, exact transition input as `workflow_advance`, explicit authoritative `artifact_store`, and a fresh opaque `attempt_id` for each launch. Reusing an ID or relaunching a completed stage role is blocked; an already committed desired state returns `already-committed` without relaunching. `odf_workflow_advance` is read-only and store-independent; the delegate re-reads, validates, and commits only the selected store before settling the attempt. Evidence or persistence failure leaves canonical state unchanged and blocks. A `/odf-new` run without a persisted binding must stop; never forward an unbound caller default. Calls that omit `workflow_advance` are always blocked before delegation; the proof-optional legacy path was removed and never auto-committed.

On OpenCode V2, delegate these stages through the native route instead: `odf_delegation_prepare` → `odf_delegation_launch` (pass `delegation.prompt` unchanged) → `odf_delegation_seal`; the seal returns the same envelope (plus `task_session_id`). Do not use the host `subagent` tool to transport prepared prompts. `odf_delegate` remains mandatory for fast-lane BUILD/VERIFY and as the non-V2 fallback.

For a fresh cross-domain BUILD on OpenCode V2, use `odf_parallel_prepare` → one `odf_delegation_launch` call with every exact branch prompt → `odf_parallel_seal`; otherwise use `odf_parallel_delegate`. Pass one shared `change`, explicit `artifact_store`, `work_type: cross-domain`, `stage: BUILD`, and the exact shared `workflow_advance` proof that advances to `BUILD`. Provide 2-3 independent branches, each with a unique safe `branch_id`, fresh safe `attempt_id`, prompt, and non-overlapping `context_files`; the scheduler has a fixed concurrency cap of 3. Branches do not commit workflow state individually. BUILD closes only after the aggregate `join.status: complete`, every branch returns a successful delegated envelope, and every branch has `validation.status: verified`; then the selected store is committed once. Any blocked/failed branch or unverified validation blocks BUILD and produces one aggregate receipt. VERIFY always runs sequentially after a complete join.

Standard configuration terminates after DECIDE and has no BUILD, VERIFY, or archive stage.
Small changes may use an inline plan before BUILD. The delegation API accepts canonical
`stage` + `role`; legacy phase IDs are rejected. Public command names remain available.

## Opt-in inline BUILD boundary (FL-06)

The bounded executor is disabled unless the orchestrator explicitly persists the validated
`fast_lane_policy` object together with an eligible `small-change` binding. The `--fast` flag alone
only skips voluntary approval gates; it does not enable the bounded executor, change the default
route, or enable a canary. Eligibility requires `shadow.micro_policy === "eligible"` and the
existing persisted `work_type: small-change`. `standard-config` remains DECIDE-only and never
enters BUILD. `bugfix` remains on `FIX -> BUILD -> VERIFY`; the shadow result alone never changes
that route.

When the explicit policy enables the contract, follow the single bounded BUILD prompt and
existing gate requirements in [the orchestrator contract](../agent/odoo_orchestrator.md#opt-in-inline-build-contract-fl-06).
The prompt must reference approved human Expectations/intent, one known module, one functional
domain, no more than five predicted files, only relevant context files, exact source roots,
the configured test command and authorized test database, validation evidence, source authority,
an out-of-scope guard, and escalation conditions. It must still call `odf_delegate` at the
canonical `small-change` BUILD stage with exact `workflow_advance`, an explicit artifact store,
and a fresh `attempt_id`; never call `task()` directly or invent a workflow, stage role, work type, or
gate. Missing or contradictory facts, risk, scope expansion, authority/database/task/validation
failures promote to standard/full handling or block; they never bypass a gate. The policy is
explicit and disabled by default; no canary, rollout, or performance claim is implied.

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
- **Duplicate name**: ask once to continue the active change, rename, or cancel; explicit continue dispatches the pending stage directly from the already-read status.
- **Invalid preflight**: re-ask for fields with allowed values.
- **Native prepare/subagent/seal, parallel prepare/seal, or `odf_delegate` error**: show the message, keep state, offer to retry.

## Output Format

```
ODF: Starting change "{change-name}"

Route: {one resolved user-facing route}
Next: {single next action}
QA: {inline focused checks | formal QA-PLAN, as selected by the route}

Continue only when a required human decision is actually pending.
```
