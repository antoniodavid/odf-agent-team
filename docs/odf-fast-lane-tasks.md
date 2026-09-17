# ODF Fast Lane Tasks

This is an executable **future** task breakdown. Every item is intentionally unchecked: no implementation is claimed by this planning change.

## Work-unit rules

- Keep each unit reviewable and independently verifiable.
- Do not add a new canonical workflow or `WorkType`; use the existing `small-change` route for eligible features and preserve `bugfix` for fixes.
- Fail closed on missing facts, risk signals, policy/evidence failures, or scope changes.
- Do not run destructive database commands. All future Odoo commands must name the exact authorized `-d <test_db>`.

## 1. Baseline instrumentation and measurement

### FL-01 — Establish the latency baseline

- **Depends on:** none.
- **Status:** Partial / in progress. The task-call baseline exists, but the end-to-end entry-to-final-gate baseline is unavailable.
- **Likely files:** `odf-plugin/odf-delegation-metrics.ts`, `plugins/odf-delegation.ts` (only if current events cannot reconstruct entry-to-final-gate timing).
- **Intent:** Use existing run/span JSONL telemetry to measure `/odf-new` and `/odf-fix` p50/p95, task-call count, phase duration, outcome, work type, model availability, validation, receipts, and escalation. Add only bounded allowlisted dimensions for entry level, micro-policy result, validation mode, and redundancy-scan disposition when required.
- **Verification commands/evidence:** `node "$PACK/scripts/odf-toolkit.js" metrics --days 14 --json`; [2026-09-16 baseline report](odf-fast-lane-baseline-2026-09-16.md) records the available task-call evidence and the end-to-end measurement gap. Confirm no raw prompt, path, secret, database value, or PII is emitted.
- **Out of scope:** New telemetry storage, generic tracing framework, speculative cache, or behavior changes.

### FL-02 — Define the comparison cohort and rollback signal

- **Depends on:** FL-01.
- **Status:** Proposed / in progress. The cohort and rollback definition is documented, but it has not been executed or approved for canary use.
- **Likely files:** `docs/odf-fast-lane-plan.md`, rollout configuration file identified by the implementation owner (no new framework).
- **Intent:** Freeze the baseline window and define comparable cohorts from complete `entry_started` → `verified_completed` flows with matching `work_type`, Odoo version, workspace, and source-authority dimensions when available. Exclude lifecycle markers, spans, and joins from the denominator.
- **Proposed hold/rollback signals:** >10% matched-cohort p95 regression; any protected/architectural risk incorrectly downgraded; any candidate/evidence/receipt binding failure; missing final-gate evidence; telemetry coverage below 95%; or an unexplained increase in errors, timeouts, or receipts. These thresholds are proposed and require explicit maintainer approval before canary.
- **Verification commands/evidence:** Reviewable [baseline table and cohort/rollback definition](odf-fast-lane-baseline-2026-09-16.md) plus a dry-run dashboard/query definition; no code execution required for the documentation artifact.
- **Out of scope:** Claiming an improvement before a canary or changing default rollout state.

## 2. Entry-triage optimization

### FL-03 — Reuse known project facts before triage

- **Depends on:** FL-01.
- **Likely files:** `command/odf-new.md`, `agent/odoo_orchestrator.md`, `odf-plugin/entry-triage.ts`, `plugins/odf-delegation.ts`.
- **Intent:** Pass the existing project module list, Odoo version, domain/module facts, test command, source roots, and approved Expectations into one deterministic triage call. Avoid repeating stable discovery during the same entry/continuation. Preserve the one grouped question for missing or unclear ICE facts.
- **Verification commands/evidence:** Triage fixture matrix showing stable inputs produce the same result; evidence that unknown modules remain warnings and missing facts remain a question/standard result rather than an unsafe micro result.
- **Out of scope:** Persistent general-purpose cache, changing the risk vocabulary, or letting the LLM choose `work_type`.

### FL-04 — Move triage ahead of expensive redundancy work

- **Depends on:** FL-03.
- **Likely files:** `command/odf-new.md`, `agent/odoo_orchestrator.md`.
- **Intent:** Make the order explicit: health → known facts → triage → conditional redundancy scan. Defer or reduce redundancy scanning only for a clear, single-module, low-risk micro result; retain it for warnings, unknown modules, contradictory prior learning, ambiguity, and all elevated signals.
- **Verification commands/evidence:** Orchestrator trace or structured event proving order; cases for clear micro, unclear, unknown module, contradictory learning, and protected-risk entries; no scan suppression for any protected signal.
- **Out of scope:** Deleting the redundancy tool, globally disabling prior-learning checks, or deciding scope from a scan result without user disposition.

### FL-05 — Tighten deterministic micro eligibility

- **Depends on:** FL-03.
- **Likely files:** `odf-plugin/entry-triage.ts`, `odf-plugin/odf-workflow.ts` only if transition metadata needs a non-routing policy field, `odf-plugin/entry-triage.test.ts`.
- **Intent:** Encode the bounded policy as data/validation, not a second route: exactly one known Odoo module, one functional domain, initial file forecast `<=3`, approved clear Expectations, no security/migration/payment/public-api/data-loss/PII or architectural signal. Keep protected signals monotonic and preserve existing canonical work types.
- **Verification commands/evidence:** Pure classifier cases for each positive and negative condition, boundary at 3/4 files, missing facts, unknown module, explicit work type conflict, and every protected signal.
- **Out of scope:** Broad semantic inference, automatic file-count promises, or adding `micro-change` to `WORK_TYPES`.

## 3. Micro policy and route integration

### FL-06 — Define the inline BUILD contract

- **Depends on:** FL-05.
- **Status:** Defined / in progress. Contract locations: [`command/odf-new.md`](../command/odf-new.md), [`command/odf-fix.md`](../command/odf-fix.md), and [`agent/odoo_orchestrator.md`](../agent/odoo_orchestrator.md#future-inline-build-contract-fl-06-shadow-only-by-default). No executor, canary, or rollout is enabled.
- **Likely files:** `command/odf-new.md`, `command/odf-fix.md`, `agent/odoo_orchestrator.md`, `plugins/odf-delegation.ts`.
- **Intent:** For eligible `small-change`, create one bounded BUILD prompt containing approved intent/Expectations, module/domain, file budget, targeted context, exact Odoo source roots, test command, source-authority requirements, evidence path, and executor/database guard. For `/odf-fix`, retain FIX/root-cause/regression evidence before applying the bounded BUILD policy.
- **Verification commands/evidence:** Documentation evidence is the linked contract above; no runtime evidence, canary, rollout, or performance claim exists in this slice. Future captured-prompt verification must cover all required fields and must block or promote on missing source roots, database authorization, Expectations, test command, scope, authority, task, or validation evidence.
- **Out of scope:** Direct generic `task()` calls, bypassing `odf_delegate`, or allowing implementation to choose its own policy.

### FL-07 — Integrate the policy without a parallel workflow

- **Depends on:** FL-06.
- **Likely files:** `odf-plugin/odf-workflow.ts`, `plugins/odf-delegation.ts`, `command/odf-new.md`, `agent/odoo_orchestrator.md`.
- **Intent:** Keep `small-change` as `DECIDE -> BUILD -> VERIFY` and `bugfix` as `FIX -> BUILD -> VERIFY`. Make the micro policy select an executor inside those routes; do not globally merge dependent phases. A micro host verifier still performs the canonical VERIFY transition and cannot skip BUILD/VERIFY ordering.
- **Verification commands/evidence:** Route snapshots remain unchanged for all existing work types; `odf_workflow_advance` rejects missing/invalid validation; standard/ambiguous/elevated cases still launch full agent VERIFY; micro failures promote rather than silently pass.
- **Out of scope:** New stages, new route matrices, cross-domain parallelization changes, or a global FIX→BUILD/BUILD→VERIFY coalescence.

### FL-08 — Preserve state, ledger, gate, receipt, and authority seals

- **Depends on:** FL-07.
- **Likely files:** `plugins/odf-delegation.ts`, `odf-plugin/odf-delegation-metrics.ts`, `command/odf-new.md`, `command/odf-fix.md`.
- **Intent:** Route every micro execution through the same selected artifact store, Policy Gate, fresh attempt ID, validation evidence, candidate binding, source authority, telemetry, and receipt code paths. Add no fast-path write that can create unbound state or settle a phase without evidence.
- **Verification commands/evidence:** Unit/integration fixtures for duplicate attempt ID, running/completed phase, stale/mismatched evidence, pending receipt, source-authority failure, task timeout, empty result, and policy block; inspect persisted artifact refs and receipt refs.
- **Out of scope:** Weakening policy/evidence schemas or replacing host validation with agent prose.

## 4. Targeted Odoo validation

### FL-09 — Add a targeted-test command contract

- **Depends on:** FL-06.
- **Likely files:** `agent/odoo_orchestrator.md`, `command/odf-new.md`, `command/odf-fix.md`, `plugins/odf-delegation.ts`.
- **Intent:** Use Odoo 19 `--test-tags` for module/class/method selection and `--test-file` for a specific Python file in the inner loop. Require exact `-d <test_db>`, authorized database context, exit code, output evidence, and the existing minimum command count by risk tier.
- **Verification commands/evidence:** Future evidence records such as `odoo-test` with `odoo-bin -d <test_db> --test-tags /<module> --stop-after-init` or `odoo-test` with `odoo-bin -d <test_db> --test-file <path> --stop-after-init`; verify the host rejects missing `-d`, missing output, non-zero exit, stale evidence, or wrong candidate.
- **Out of scope:** Destructive database setup, guessed databases, replacing the final module/CI suite, or changing Odoo test semantics.

### FL-10 — Keep the full final gate

- **Depends on:** FL-09.
- **Likely files:** `agent/odoo_orchestrator.md`, `plugins/odf-delegation.ts`.
- **Intent:** Require the configured full module/CI test command at the final gate after targeted inner-loop tests. Preserve the existing archive rule that cannot accept deferred, missing, or unrecorded module evidence.
- **Verification commands/evidence:** A micro fixture proves targeted BUILD evidence is followed by the full configured command before successful archive; a missing final record blocks archive.
- **Out of scope:** Treating targeted tests as sufficient final coverage or removing full agent VERIFY for standard/elevated work.

## 5. Model and OpenCode steps policy

### FL-11 — Bound cheap classification and verification policy

- **Depends on:** FL-05, FL-09.
- **Likely files:** `odf-registry.json`, `odf-plugin/odf-skills.ts`, `plugins/odf-delegation.ts`, `agent/odoo_orchestrator.md`.
- **Intent:** Consider a faster model and bounded OpenCode `steps` only for deterministic classification/host-verification prompts. Keep capable implementation routing for Odoo code, view authority, integrations, and any uncertain task. Make the policy explicit, opt-in/canary-controlled, and fail closed; do not silently override user-owned model/profile selection.
- **Verification commands/evidence:** Profile-resolution output identifies model and step bound; fixtures prove no faster-model policy is selected for implementation when capability/risk requires the specialist; timeout/empty-result paths create receipts and escalate.
- **Out of scope:** Global model replacement, unrestricted agent autonomy, silent step reduction for all phases, or model benchmarking without outcome metrics.

### FL-12 — Limit the micro prompt and context surface

- **Depends on:** FL-06, FL-11.
- **Likely files:** `plugins/odf-delegation.ts`, `agent/odoo_orchestrator.md`.
- **Intent:** Keep inline prompts compact and stable: shared rules first, dynamic task facts late, only relevant module/source/test context, and a complete structured result contract. Do not spend the optimization budget on broad input trimming before reducing calls and generated output.
- **Verification commands/evidence:** Compare prompt token estimate and task duration in metrics; verify required safety/source/evidence instructions remain present and task labels stay sanitized.
- **Out of scope:** Prompt caching infrastructure, generic context-index rewrites, or removal of required source/evidence instructions.

## 6. Tests and evidence

### FL-13 — Expand triage and route regression coverage

- **Depends on:** FL-05, FL-07.
- **Likely files:** `odf-plugin/entry-triage.test.ts`, `odf-plugin/odf-workflow.test.ts`, `scripts/odf-harness.test.ts`.
- **Intent:** Cover deterministic eligibility, protected-risk precedence, existing route snapshots, canonical stage ordering, and escalation behavior.
- **Verification commands/evidence:** `npx vitest run odf-plugin/entry-triage.test.ts odf-plugin/odf-workflow.test.ts scripts/odf-harness.test.ts`; attach the test output and case matrix.
- **Out of scope:** Removing existing route tests or testing only the happy path.

### FL-14 — Expand delegation safety and telemetry coverage

- **Depends on:** FL-08, FL-09, FL-11.
- **Likely files:** `odf-plugin/odf-delegation.test.ts`, `odf-plugin/odf-delegation-metrics.test.ts` if present/required, `scripts/odf-harness.test.ts`, `plugins/odf-delegation.ts` only for the implementation.
- **Intent:** Prove policy/attempt/evidence/receipt/source-authority invariants remain active for micro, standard, and elevated routes. Verify p50/p95 inputs are bounded and sanitized.
- **Verification commands/evidence:** `npx vitest run odf-plugin/odf-delegation.test.ts scripts/odf-harness.test.ts`; use fixture evidence with wrong candidate digest, wrong database, stale timestamp, missing output, non-zero exit, reused attempt, and pending receipt.
- **Out of scope:** Live Odoo execution in the ODF harness unit suite or destructive database operations.

### FL-15 — Validate against representative Odoo modules

- **Depends on:** FL-10, FL-13, FL-14.
- **Likely files:** No repository source change required unless a test fixture needs one; future evidence belongs in the review/CI system, not committed generated databases.
- **Intent:** Exercise one clear model/view/test micro feature, one localized bugfix, one ambiguous request, and each protected-risk category. Include source-authority work and a case exceeding the file bound.
- **Verification commands/evidence:** Authorized Odoo 19 targeted commands with `-d <test_db>`, followed by the configured full module/CI command; preserve `.odf/validation-evidence-<change>.json` and final verification report refs.
- **Out of scope:** Production databases, destructive setup, broad performance claims from a single sample, or changing module behavior for the test.

## 7. Documentation and rollout

### FL-16 — Update operational documentation after behavior is implemented

- **Depends on:** FL-07, FL-09, FL-11, FL-14.
- **Likely files:** `command/odf-new.md`, `command/odf-fix.md`, `agent/odoo_orchestrator.md`, `docs/odf-fast-lane-plan.md`.
- **Intent:** Document the final policy name, exact eligibility, triage-before-redundancy order, targeted test templates, host-validation semantics, escalation triggers, kill switch, metrics query, and final-gate requirement. Keep all generated artifacts in English.
- **Verification commands/evidence:** Markdown link check or repository documentation review; compare docs to actual route, plugin seals, and test evidence schema. No code path may rely on undocumented fast-lane behavior.
- **Out of scope:** Claiming implementation in this planning change or duplicating the entire orchestrator contract.

### FL-17 — Run staged rollout and review metrics

- **Depends on:** FL-01, FL-02, FL-15, FL-16.
- **Likely files:** Existing rollout/configuration file only; no new framework or data store.
- **Intent:** Execute measure-only → shadow → opt-in canary → controlled expansion. Review p50/p95, task count, targeted/full validation, receipt rate, timeout rate, escalation correctness, and artifact completeness at every stage.
- **Verification commands/evidence:** `node "$PACK/scripts/odf-toolkit.js" metrics --days 14 --json`; attach before/after cohort report and explicit go/hold/rollback decision. Disable the policy when any acceptance threshold fails.
- **Out of scope:** Automatic expansion, automatic retry around receipts, or silently changing the default route.

## Final acceptance checklist

- [ ] ENTRY/TRIAGE was measured and optimized before generic plugin micro-optimization.
- [ ] The existing `small-change` route remains canonical; no parallel full workflow or `micro-change` type was added.
- [ ] Micro eligibility requires one known module, one domain, bounded files, clear approved Expectations, and no protected/architectural signal.
- [ ] `/odf-fix` still requires diagnosis, root cause, and minimal regression before BUILD.
- [ ] Health, preflight, Expectations, Policy Gate, attempt ledger, artifact persistence, source authority, validation evidence, receipts, and archive gates remain mandatory.
- [ ] Triage runs before expensive redundancy scanning; clear low-risk micro entries alone may defer/reduce that scan.
- [ ] Micro BUILD uses a bounded inline prompt and capable implementation routing where needed.
- [ ] Inner-loop Odoo tests use `--test-tags` and/or `--test-file` with explicit `-d <test_db>`.
- [ ] Full module/CI tests remain the final gate.
- [ ] Standard, ambiguous, and elevated-risk work keeps full agent VERIFY.
- [ ] FIX→BUILD and BUILD→VERIFY were not globally merged.
- [ ] p50/p95 baseline and post-canary reports use comparable cohorts and include safety/error metrics.
- [ ] Telemetry is bounded, sanitized, session-hashed, and free of secrets/PII.
- [ ] Rollback disables the micro policy without rewriting state, artifacts, evidence, or receipts.
- [ ] `npm run typecheck`, focused Vitest tests, full repository tests, registry validation, and the representative Odoo evidence all pass in the implementation PR.

## Recommended commit/PR order

1. `perf(metrics): baseline fast-lane latency`
2. `perf(triage): reuse facts before redundancy scan`
3. `feat(policy): bound micro build and host validation`
4. `test(odf): cover fast-lane safety invariants`
5. `docs(odf): document fast-lane rollout`

Each commit should remain independently reviewable. Do not commit generated databases, secrets, raw telemetry, or implementation claims with the documentation-only planning change.
