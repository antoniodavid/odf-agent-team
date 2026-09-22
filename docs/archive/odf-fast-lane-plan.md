# ODF Fast Lane Plan

## Conclusion

Optimize **ENTRY/TRIAGE first**, then add a bounded micro execution policy on the existing `small-change` route. Do not create a second full workflow or globally merge dependent phases. Clear, low-risk, single-module work may use one inline BUILD prompt, targeted Odoo evidence, and deterministic host validation; standard, ambiguous, or elevated-risk work keeps capable implementation routing and full agent VERIFY.

The fast lane is an execution policy, not a new `WorkType`. The canonical route, Policy Gate, attempt ledger, artifact store, receipts, source authority, validation evidence, and escalation behavior remain authoritative.

## Current bottleneck evidence

| Finding | Repository evidence | Planning consequence |
|---|---|---|
| Latency is dominated by sequential phase/task round trips, not TypeScript dispatch. | `/odf-new` runs health, triage, redundancy, Expectations, route, bind, and then phase work before BUILD ([`command/odf-new.md:34-56`](../command/odf-new.md#L34-L56)); `/odf-fix` composes diagnosis, BUILD, and VERIFY ([`command/odf-fix.md:14-44`](../command/odf-fix.md#L14-L44)). | Remove avoidable entry work before optimizing generic plugin code. |
| A fast canonical route already exists. | `small-change` is `DECIDE -> BUILD -> VERIFY` with an inline plan and required verification ([`odf-plugin/odf-workflow.ts:87-95`](../odf-plugin/odf-workflow.ts#L87-L95)). | Reuse this route; do not add `micro-change` or a parallel workflow. |
| Triage is deterministic but can still require facts. | Risk signals, module/domain, expected file count, Expectations clarity, and known-module warnings are handled by the pure classifier ([`odf-plugin/entry-triage.ts:19-46`](../odf-plugin/entry-triage.ts#L19-L46), [`:149-265`](../odf-plugin/entry-triage.ts#L149-L265)). | Reuse project facts and classify before expensive redundancy work. |
| Gated delegation performs meaningful work before and after the agent call. | `odf_delegate` validates the transition, reads state, resolves source authority, acquires an attempt, applies the Policy Gate, injects skills, records telemetry, validates evidence, commits state, and settles the attempt ([`plugins/odf-delegation.ts:1123-1555`](../plugins/odf-delegation.ts#L1123-L1555), [`:1660-1880`](../plugins/odf-delegation.ts#L1660-L1880)). | Keep those gates, but avoid launching unnecessary phase agents for eligible micro work. |
| Safety controls are already host-enforced. | Attempt IDs and phase completion are locked in the ledger ([`plugins/odf-delegation.ts:662-739`](../plugins/odf-delegation.ts#L662-L739)); validation evidence is bound to the change, candidate, database, commands, exit codes, freshness, and risk tier ([`plugins/odf-delegation.ts:751-946`](../plugins/odf-delegation.ts#L751-L946)). | Make the fast lane consume the same seals instead of inventing weaker checks. |
| Telemetry is bounded and correlated, but the improvement must be measured end to end. | JSONL metrics already carry phase, duration, status, work type, run/span IDs, model availability, and sanitized task labels ([`odf-plugin/odf-delegation-metrics.ts:16-78`](../odf-plugin/odf-delegation-metrics.ts#L16-L78), [`:238-365`](../odf-plugin/odf-delegation-metrics.ts#L238-L365)). | Establish p50/p95 before behavior changes and compare equivalent post-rollout cohorts. |

## Goals

- Reduce time from an accepted small Odoo request to a verified candidate.
- Make entry classification deterministic, cheap, and conservative.
- Reuse `odf-init/{project}` facts and avoid repeating known discovery.
- Keep implementation capable enough for the selected Odoo domain.
- Use focused Odoo tests in the inner loop and full module/CI tests at the final gate.
- Escalate on uncertainty, missing facts, changed scope, or any protected risk signal.
- Make latency and safety regressions visible through existing telemetry and artifacts.

## Non-goals

- No new canonical workflow, `WorkType`, phase, or parallel full pipeline.
- No global FIX→BUILD or BUILD→VERIFY merge.
- No removal of human Expectations, Policy Gate, attempt ledger, artifact persistence, receipts, source authority, or validation evidence.
- No speculative cache layer, framework rewrite, or broad plugin micro-optimization before entry measurements.
- No silent model switch or global reduction of agent steps.
- No relaxation for migration, security, payment, public API, data loss, PII, or architectural signals.

## Route policy

| Entry/result | Canonical route | Eligible execution | Verification | Escalation |
|---|---|---|---|---|
| Standard configuration | Existing `standard-config` (`DECIDE`) | Existing behavior; no code BUILD | None because this route has no build | Any implementation request leaves this route. |
| Clear micro feature | Existing `small-change` (`DECIDE -> BUILD -> VERIFY`) | One Odoo module, one functional domain, few files (initial bound: `<=3`), approved clear Expectations, no protected or architectural signal; inline BUILD prompt with targeted context | Keep canonical `VERIFY` stage, but use deterministic host validation for the eligible micro case; targeted Odoo evidence is required | Missing facts, unexpected files, failed evidence, source-authority failure, or scope/risk change promotes to full agent VERIFY or the appropriate higher route. |
| Bounded bugfix | Existing `bugfix` (`FIX -> BUILD -> VERIFY`) | Preserve diagnosis/FIX and root-cause regression evidence; apply the same bounded BUILD policy only after FIX confirms one module/few files and no elevated signal | Deterministic host validation may close only the explicitly eligible micro execution; otherwise full agent VERIFY | Architectural, multi-module, unclear, or elevated-risk diagnosis escalates to `DECIDE -> PLAN` before editing, as today. |
| Standard or ambiguous feature/fix | Existing `feature` or `bugfix` route | Existing capable agent routing and required artifacts | Full agent VERIFY | No fast-lane downgrade. |
| Migration, security, payment, public API, data loss, PII, cross-domain, or architectural work | Existing elevated/full route | Existing specialized agents and required plan | Full agent VERIFY with the existing risk lenses | Risk is monotonic: it can escalate, never downgrade. |

The micro row does **not** remove a canonical stage. It changes only the executor for an already-required low-risk verification stage; BUILD and VERIFY remain observable, evidence-backed transitions. `odf_workflow_advance` must still reject invalid ordering and unverified BUILD input ([`odf-plugin/odf-workflow.ts:177-263`](../odf-plugin/odf-workflow.ts#L177-L263)).

## Target flow

1. **Health first.** Keep `odf_health` as the first `/odf-new` ODF operation ([`command/odf-new.md:36-42`](../command/odf-new.md#L36-L42); [`agent/odoo_orchestrator.md:54-58`](../agent/odoo_orchestrator.md#L54-L58)).
2. **Load known facts once.** Reuse the project version, module list, test command, Odoo source roots, and existing approved Expectations from the selected store. Do not rediscover stable facts for the same entry.
3. **Triage before redundancy.** Run deterministic `odf_entry_triage` with known modules and project facts before the redundancy scan. Ask at most one grouped question when ICE facts are missing or unclear.
4. **Short-circuit only a clear micro case.** For a clear, low-risk micro result, defer or reduce the expensive redundancy scan and record that decision. A warning, unknown module, contradictory prior learning, or unclear scope re-enables the normal scan and/or escalates.
5. **Bind the canonical route.** Persist preflight, route, and approved Expectations through `odf_workflow_bind`; for `small-change`, materialize the existing terminal `DECIDE`. For `bugfix`, retain the terminal `FIX` root-cause and regression contract.
6. **Apply mechanical gates before BUILD.** Resolve the Policy Gate, acquire a fresh attempt ID, and preserve the selected artifact store. A blocked gate stops the lane; it never falls through to an ungated task.
7. **Run one bounded inline BUILD.** Forward a compact prompt containing the approved intent, Expectations, affected module, targeted Odoo source evidence, exact source roots, test command, and explicit file budget. Keep capable implementation routing for domain work; use a faster model only when its policy is explicitly allowed and the task remains deterministic.
8. **Run the focused inner loop.** Prefer Odoo `--test-tags` or `--test-file` for the affected test/module, always with the exact authorized `-d <test_db>` context. Capture command, database, exit code, and output evidence.
9. **Seal deterministic validation.** The host validates freshness, change binding, candidate digest, minimum commands for the risk tier, zero exit codes, known success patterns, and database context. The agent cannot self-declare success.
10. **Close or escalate.** For eligible micro work, the host executes the canonical VERIFY transition with the validated evidence. For standard, ambiguous, or elevated-risk work, launch the full `odoo_qa_engineer` VERIFY route. Any failed or missing seal writes a receipt and stops for disposition.
11. **Run the final gate.** The final gate runs the full module/CI command required by project configuration, even if targeted tests passed during BUILD. Archive only after the existing successful VERIFY requirements are met.

## Safety invariants

| Invariant | Required behavior |
|---|---|
| Canonical state | `small-change` remains the route for clear micro features; `bugfix` remains the route for fixes. No parallel state machine or inferred work type. |
| Entry authorization | `/odf-new` health, preflight, approved human Expectations, and same-session bind authorization remain mandatory. |
| Risk monotonicity | Any protected signal, architectural signal, unknown/contradictory fact, or scope expansion disables the micro policy and escalates. The current classifier already forces protected signals away from micro ([`odf-plugin/entry-triage.ts:158-193`](../odf-plugin/entry-triage.ts#L158-L193)). |
| Policy Gate | Resolve and persist before IMPLEMENT/VERIFY; the sub-agent/host consumes the decision and never recomputes it ([`plugins/odf-delegation.ts:948-999`](../plugins/odf-delegation.ts#L948-L999)). |
| Attempt integrity | Every gated execution uses a fresh safe attempt ID, is locked in the attempt ledger, and settles exactly once. |
| Source authority | View/model/XML ID work must use the exact Odoo source roots and deterministic authority evidence; fast mode cannot bypass it ([`plugins/odf-delegation.ts:1424-1439`](../plugins/odf-delegation.ts#L1424-L1439), [`:1739-1757`](../plugins/odf-delegation.ts#L1739-L1757)). |
| Validation evidence | The host accepts only fresh, parseable, candidate-bound evidence with explicit command/database/output details; prose never counts ([`plugins/odf-delegation.ts:806-946`](../plugins/odf-delegation.ts#L806-L946)). |
| Receipts | Failures, timeouts, cancellations, and validation blocks persist a receipt before user disposition ([`plugins/odf-delegation.ts:1881-1947`](../plugins/odf-delegation.ts#L1881-L1947)). |
| No unsafe coalescing | Do not merge dependent FIX→BUILD or BUILD→VERIFY globally. Only the bounded micro executor may replace an agent call with the deterministic host verifier, and only after the same transition/evidence checks. |
| Privacy | Keep telemetry hashed and bounded; never add raw prompts, paths, database credentials, or PII to fast-lane metrics. |

## Observability and metrics

### Baseline

Before changing behavior, capture a comparable baseline from existing JSONL telemetry and ODF command outcomes:

- p50 and p95 end-to-end time for `/odf-new` and `/odf-fix`, from entry to final verified gate;
- p50 and p95 by canonical `work_type`, phase, model/profile, success, block, timeout, and escalation;
- number of task calls and phase calls per completed change;
- time spent in triage, redundancy, Expectations/bind, BUILD, targeted validation, full VERIFY, and final module/CI tests;
- validation failure, receipt, retry, and escalation rates;
- sample size, time window, Odoo version, project, and whether the run was comparable.

Existing `duration_ms` is sufficient for phase/task distributions, but end-to-end entry timing may require one bounded `entry` run/span. Add only the smallest safe fields needed to distinguish `entry_level`, `micro_policy`, `validation_mode`, and `redundancy_scan` outcomes. Follow the current sanitization, bounded-buffer, hashed-session, and daily JSONL policy ([`odf-plugin/odf-delegation-metrics.ts:238-365`](../odf-plugin/odf-delegation-metrics.ts#L238-L365)).

### Success dashboard

Report baseline and canary side by side. A rollout is eligible to expand only when p50 and p95 improve for the target cohort without an increase in validation failures, receipt-producing failures, risk escalations being incorrectly suppressed, or missing evidence. Always report tail latency separately; a better median does not justify a worse p95.

## Rollout stages

1. **Measure only.** Add or verify bounded entry/run dimensions, export p50/p95, and record the baseline. No behavior change.
2. **Triage optimization.** Reuse known facts, run triage before redundancy, and defer/reduce redundancy only for clear low-risk micro results. Keep a fail-closed kill switch.
3. **Shadow micro policy.** Compute eligibility and expected route, but execute the current standard path. Compare classifications, predicted file bounds, risk signals, and latency.
4. **Opt-in canary.** Enable the micro executor for a small, explicitly configured cohort. Use inline BUILD, targeted tests, deterministic evidence, and host VERIFY; promote any uncertainty immediately.
5. **Controlled expansion.** Expand only after acceptance criteria hold across representative Odoo modules and both feature/fix entries. Keep standard and elevated routes unchanged.
6. **Revert.** Use `odf_workflow_override` with `action: disable-fast-lane`, a named approver, and a human-approved reason. The operation writes an audited `.odf/fast-lane-rollback-{change}.json` marker, returns to the existing route, and leaves workflow state, artifacts, receipts, and evidence unchanged. Never auto-retry around a pending receipt.

## Acceptance criteria

- Clear micro eligibility is deterministic: one module, one domain, bounded files, approved clear Expectations, and no protected/architectural signal.
- The existing `small-change` route remains the canonical feature route; no new full workflow exists.
- `/odf-fix` retains diagnosis/FIX and cannot bypass root-cause or regression evidence.
- Health, preflight, Expectations, Policy Gate, attempt ledger, artifact persistence, source authority, validation evidence, receipts, and final archive rules remain mandatory.
- Targeted Odoo tests use `--test-tags` or `--test-file`, include an explicit `-d <test_db>`, and produce deterministic evidence.
- The full module/CI suite still runs at the final gate.
- Standard, ambiguous, elevated-risk, source-authority-failing, and evidence-failing work uses full agent VERIFY or the appropriate escalated route.
- Baseline and post-rollout p50/p95 are reported with comparable cohorts and no unreviewed safety regression.
- Telemetry remains bounded, sanitized, session-hashed, and free of secrets/PII.
- Rollback is an explicit, audited configuration/policy disable, not a workflow-state or artifact rewrite; the marker is fail-closed and idempotent.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Triage false positive sends complex work to micro | Conservative eligibility, known-module validation, protected signal list, shadow mode, and immediate escalation on changed facts. |
| Targeted tests miss an integration regression | Full module/CI tests remain the final gate; micro validation is not a replacement for final coverage. |
| Host validator is treated as a weaker VERIFY | Keep the canonical VERIFY transition and all evidence requirements; only change the executor for the bounded micro cohort. |
| Redundancy scan suppression misses an existing implementation | Suppress only for clear low-risk micro entries; warnings, unknown modules, or contradictory learnings restore the scan. |
| Faster model lowers implementation quality | Restrict faster models to deterministic classification/verification; retain capable implementation routing and compare failure/receipt rates. |
| Fewer OpenCode steps hide incomplete work | Bound steps, require a complete result/evidence envelope, and escalate on timeout, empty output, missing artifacts, or missing validation. |
| p50 improves while tail latency worsens | Gate rollout on both p50 and p95, plus blocked/timeout/receipt rates. |
| Telemetry leaks sensitive data | Reuse current sanitizers and add only allowlisted bounded tokens; never persist raw prompts or database values. |

## Source links

### Repository sources

- [`command/odf-new.md`](../command/odf-new.md) — entry order, triage, redundancy, Expectations, bind, and existing `small-change` note.
- [`command/odf-fix.md`](../command/odf-fix.md) — FIX → BUILD → VERIFY and escalation rules.
- [`agent/odoo_orchestrator.md`](../agent/odoo_orchestrator.md) — supervised auto, micro path, delegation rules, phase gates, and non-negotiable guarantees.
- [`odf-plugin/odf-workflow.ts`](../odf-plugin/odf-workflow.ts) — canonical route matrix and transition validation.
- [`odf-plugin/entry-triage.ts`](../odf-plugin/entry-triage.ts) — deterministic ICE/risk classification and existing work-type selection.
- [`plugins/odf-delegation.ts`](../plugins/odf-delegation.ts) — policy/evidence/attempt/receipt enforcement, delegation lifecycle, and tool registration.
- [`odf-plugin/odf-delegation-metrics.ts`](../odf-plugin/odf-delegation-metrics.ts) — bounded, sanitized JSONL telemetry and run/span schema.

### Primary external sources

- [GitHub Spec Kit README](https://github.com/github/spec-kit/blob/main/README.md) — spec-driven phases, the assess → fix → test bug workflow, and the explicit recognition that small fixes do not always need the full workflow.
- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents) — prefer simple composable workflows, route distinct task classes, ground agents in environment evidence, and add complexity only when it improves outcomes.
- [OpenAI: Latency optimization](https://platform.openai.com/docs/guides/latency-optimization) — make fewer requests, use faster models for suitable subtasks, parallelize only independent work, generate fewer tokens, and do not default to an LLM when deterministic logic is sufficient.
- [Odoo 19: Testing Odoo](https://www.odoo.com/documentation/19.0/developer/reference/backend/testing.html#test-selection) — test selection with `--test-tags`, including module/class/method targeting.
- [Odoo 19: Command-line interface](https://www.odoo.com/documentation/19.0/developer/reference/cli.html#testing) — `--test-enable`, `--test-file`, `--test-tags`, and explicit database/module CLI behavior.
- [OpenCode: Agents](https://opencode.ai/docs/agents/) — agent modes, permissions, model selection, and bounded `steps` for controlled execution.
