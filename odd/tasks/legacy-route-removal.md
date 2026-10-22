# Legacy Route Removal

Objective: retire the dead legacy-route compatibility in three bounded slices (F1, F4, F6) without changing the delegation API or breaking changes already in flight.
Branch: `feature/legacy-route-removal` (four work-unit commits). Delivery strategy `ask-on-risk`; test runner `npm test` (Vitest + YAML scenarios).
Status: T2, T3, T4, and T5 implemented, verified locally, and committed in reviewable slices.

## Specs

### S1 — Measure legacy phase usage before removing anything (F0)

Produce an inventory of legacy phase names actually delegated, grouped by `work_type`, from the metrics JSONL under `metrics/` and the static caller inventory (registry, commands, agents, skills). If the metrics carry no phase data, record `data_status: no_data` and use only the static inventory.

Acceptance:
- A table of `phase × work_type` counts with the data range, or `data_status: no_data` with the reason.
- The static inventory names every caller file that passes a legacy phase to `odf_delegate`, `odf_delegation_prepare`, `odf_parallel_delegate`, `odf_policy_gate`, or `odf_receipt`.
- No source or behavior change.

Check: read the metrics records and `grep` the callers; no test run required.

### S2 — Stop persisting `legacy_phases` in new workflow state (F1)

A newly created OpenSpec `state.yaml` must not contain `route.legacy_phases`. Today the bind persists the whole route object (`document.set("route", route)`), so every new change carries the legacy vocabulary.

Acceptance:
- A new bind produces a `route:` block with `work_type`, `entry`, `stages`, `plan`, `verification`, `parallel_build`, and `risk`, and no `legacy_phases` key.
- `WorkflowRoute` no longer exposes `legacy_phases` to the state writer.
- Status derivation still resolves the route from `work_type`, not from the persisted route.

Check: focused bind test plus inspect a generated `state.yaml` in a `mktemp -d` workspace.

### S3 — Existing state must keep binding (F1 invariant)

The bind compares the persisted route with the freshly resolved one and returns `route-conflict`. Removing `legacy_phases` from the route shape must not make existing states unbindable.

Acceptance:
- A fixture state containing `route.legacy_phases` re-binds successfully.
- No `route-conflict` is emitted for a route that differs only by the removed legacy key.
- The comparison remains strict for `work_type`, `entry`, `stages`, `plan`, `verification`, `parallel_build`, and `risk`.

Check: differential test — bind the same fixture before and after the change and compare the outcome and the resulting state bytes.

### S4 — Require workflow proof unconditionally (F6, strict workflow)

`IMPLEMENT` and `VERIFY` without `workflow_advance` must be blocked regardless of registry flags. The `strict_workflow: false` opt-out at `plugins/odf-delegation.ts:1876-1883` and the `strict_workflow` key in `odf-registry.json` are removed.

Acceptance:
- A delegation without `workflow_advance` returns `strict-workflow-proof-required` even when a registry fixture sets `strict_workflow: false`.
- No documentation describes an opt-out from strict workflow.
- The parallel path keeps its existing unconditional proof requirement.

Check: update the strict tests in `odf-plugin/odf-delegation.test.ts`, run `npm run typecheck`.

### S5 — Reject legacy delegation tokens and drop the host-prefix tolerance (F6, tokens/host)

A token record without `launch_mode` is a record prepared by a version that no longer ships. It must be rejected with a typed block that names the token and asks for a re-prepare, instead of being accepted and verified through the host `subagent` transcript prefix tolerance.

Acceptance:
- `odf_delegation_seal` and the parallel seal return a typed block (not a silent success) for a record without `launch_mode`.
- `preparedPromptFromV2Conversation` has no `allowLegacyHostPrefix` parameter and `OPENCODE_SUBAGENT_USER_PREFIX` is no longer stripped in the native seal path.
- The 2-hour `DELEGATION_TOKEN_TTL_MS` window is the only grace period required; no long-lived migration is added.

Check: remove or repurpose the `legacyTools` helper in `odf-plugin/odf-delegation-prepare-seal.test.ts`; focused seal tests and `npm run typecheck`.

### S6 — Deprecate `odf_status` without deleting it yet (F4)

`odf_status` stays callable for this release but must declare itself deprecated and stop being presented as a supported primary path.

Acceptance:
- Its JSON output includes `deprecated: true` and `replacement: "odf_workflow_status"`.
- `docs/plugin.md`, `AGENTS.md`, and `agent/odoo_orchestrator.md` mark it as legacy-only.
- No command or agent instructs calling it except the existing “only when canonical status is unavailable” note.
- The implementation is not deleted: `odf_workflow_status` still falls back to `buildEngramStatus`/`buildMergedStatus` for changes without a declared `artifact_store`.

Check: update `odf-plugin/opencode-v2-contract.test.ts:169`; focused test.

### S7 — Do not touch the delegation API or the read-side legacy derivation (scope guard)

This authorization covers F1, F4, and F6 only. The following stay unchanged:
- `ALLOWED_PHASES` (`plugins/odf-delegation.ts:586`), the `phase` tool schemas, and every phase→stage mapping.
- `legacy_phase` in the status output, `state_kind: "legacy-artifacts"`, `LEGACY_ARTIFACT_PHASES`, and the `--work-type` recovery in `/odf-continue`.
- `materializeLegacyCanonicalBoundary` and its composite gate.
- All current `work_type` values and their routes.

Acceptance: the diff for T2–T5 contains no change to those symbols; `legacy_phase` and `state_kind` still appear in `odf_workflow_status` output.

Check: `git diff --word-diff` review against the authorized files.

## Tasks

- [x] T1 — S1 — route: inline — evidence only, no commit. Result in L6: `data_status: no_data`; static inventory recorded.
- [x] T2 — S2, S3 — route: inline — `aca17c9` `refactor(workflow): stop persisting legacy route aliases`. Evidence in L7.
- [x] T3 — S4 — route: inline — `b7469ee` `refactor(delegation): require workflow proof unconditionally`. Evidence in L8.
- [x] T4 — S5 — route: inline — `5a2b64f` `refactor(delegation): reject legacy launch tokens`. Evidence in L12.
- [x] T5 — S6 — route: inline — closing commit `docs(status): deprecate odf_status`. Evidence in L9.
- [ ] D1 — deferred (not authorized) — F4 deletion: remove `odf_status`, `loadEngramStatus`, `buildEngramStatus`, `legacyArtifactState` after the `odf_workflow_status` fallback is migrated.
- [ ] D2 — deferred (not authorized) — F2 + F3: migrate the delegation API to canonical stages and delete `materializeLegacyCanonicalBoundary`.
- [x] D3 — authorized — F5: remove `legacy_phase`, `state_kind: "legacy-artifacts"`, `LEGACY_ARTIFACT_PHASES`, and the legacy `--work-type` recovery. This revises ODF 2 migration decision M6 and drops resumability for changes that predate `state.yaml`. Implemented on `feature/legacy-state-read-path-removal`; see `odd/tasks/legacy-state-read-path-removal.md`.

Route evidence: all five authorized tasks are small, understood, and touch one concern each; no parallel units and no writer reason. File count does not fire the writer trigger.

## Log

### L1 — Original request (verbatim)

> Revisar las rutas legacy del harrness y preparar para ir quitandola del harnness

### L2 — Scope decision (verbatim option and description)

> Solo compatibilidad muerta (Recomendado)

> F1 + F4 + F6: dejar de escribir legacy_phases, deprecar odf_status, quitar strict_workflow:false y tokens/host legacy. No toca la API de delegación ni rompe cambios existentes.

### L3 — Deliverable decision (verbatim option and description)

> Documento + tareas ODD

> Crear el documento y abrir las tareas F1-F6 con sus specs y commits esperados, listas para ejecutar.

Interpretation applied: the document carries the full F0–F6 picture, but only F1, F4, and F6 are opened as authorized tasks; F2, F3, and F5 are recorded as deferred D2 and D3.

### L4 — Baseline evidence (2026-10-21)

- `npx vitest run odf-plugin/odf-workflow-status.test.ts odf-plugin/odf-workflow.test.ts` → 2 files, 69/69 tests passed.
- `npm run typecheck` → clean (no diagnostics).
- Full `npm test`, the YAML runner, and registry validation were not run for this review.

### L5 — Review findings that shaped the specs

- `legacy_phases` is write-only: it is persisted at `plugins/odf-delegation.ts:9568` and never read back. `odf-workflow-status.ts:544` resolves the route from `work_type`.
- `route-conflict` at `plugins/odf-delegation.ts:9510` deep-compares the persisted route, so S2 without S3 breaks every existing rebind.
- The delegation vocabulary is not dead: `ALLOWED_PHASES` is the only accepted phase set, and `odf_policy_gate`, `odf_receipt`, the attempt ledger, and telemetry all use `IMPLEMENT`/`VERIFY`. That is why F2 is deferred.
- `odf_workflow_status` still depends on the Engram fallback at `plugins/odf-delegation.ts:8720-8737`, so deleting `odf_status` now would remove a live path. Hence S6 deprecates instead of deleting.
- `launch_mode` is absent only on records prepared by older versions; with a 2-hour TTL the rejection in S5 needs no long migration window.
- `strict_workflow` is already `true` in `odf-registry.json` and the roadmap records the opt-out as a temporary exit with no known consumers (`docs/archive/harness-roadmap.md:462-466`).

### L6 — T1 inventory (2026-10-21)

Metrics data: `metrics/*.jsonl`, 12 records across 4 files (2026-09-30 to 2026-10-20).

`data_status: no_data` for a `phase × work_type` matrix: records carry `phase` but no `work_type`, and the only observed phases are `RECOVERY` (7), `EXPLORE` (4), `DESIGN` (1). No `PROPOSE`, `ASSESS`, `QA-PLAN`, `IMPLEMENT`, or `VERIFY` record exists in the local metrics, so no runtime frequency claim can be made from them.

Static caller inventory (the actual delegation surface):

| Surface | Legacy phases | Evidence |
|---|---|---|
| Plugin API | `PROPOSE`, `ASSESS`, `QA-PLAN`, `DESIGN`, `IMPLEMENT`, `VERIFY`, `EXPLORE`, `FIX` | `plugins/odf-delegation.ts:586`, schemas `:1734`, `:3677`, `:6181` |
| Policy gate / receipts | `IMPLEMENT`, `VERIFY` | `plugins/odf-delegation.ts:1436-1437`, `:1465`, `:2233` |
| Parallel BUILD | `IMPLEMENT` only | `plugins/odf-delegation.ts:4799`, `:5485-5486`, `:5622` |
| Agent registry | 10 of 11 agents declare legacy phases; `odoo_orchestrator` is `ALL` | `odf-registry.json` `agents[].phases` |
| Commands | 11 files mention legacy phases: `odf-agent-new`, `odf-apply`, `odf-archive`, `odf-continue`, `odf-explore`, `odf-fix`, `odf-new`, `odf-profile`, `odf-qa`, `odf-status`, `odf-verify` | `command/*.md` |
| Agent docs | 9 files: `odoo_backend_engineer`, `odoo_batch_implementer`, `odoo_dba_devops`, `odoo_frontend_engineer`, `odoo_functional_consultant`, `odoo_orchestrator`, `odoo_proposer`, `odoo_qa_engineer`, `odoo_upgrade_migrator` | `agent/*.md` |
| Skills | 13 files, including `_shared/result-contract.md` (the agent output contract) and `_shared/skill-resolver.md` | `skills/` |

Conclusion: F2 is a repo-wide contract migration, not a deletion. The authorized F1/F4/F6 tasks do not depend on this matrix and can proceed; D2 remains blocked on an explicit contract decision.

### L7 — T2 implementation and evidence (2026-10-21)

Changed:
- `plugins/odf-delegation.ts`: added `routeStateProjection` and `comparableRouteState`; the bind compares routes with `legacy_phases` ignored on both sides and writes the projection only for a new state or a state without a `route` node.
- `odf-plugin/odf-delegation.test.ts`: added four bind tests.

RED evidence (temporary local revert, file restored by hash check):
- Without the write projection, `persists a new state route without legacy phase aliases` fails.
- With the projection but a strict comparison, `re-binds a state whose persisted route already dropped the legacy alias` fails with `route-conflict` — the S3 trap.
- The tolerance does not overreach: `still blocks a persisted route that differs beyond the legacy alias` keeps blocking.

GREEN evidence:
- `npx vitest run odf-plugin/odf-delegation.test.ts` → 475/475 pass.
- `npm run typecheck` → clean.

Compatibility note: existing states keep their persisted `route.legacy_phases` bytes; the write path only projects new states. `openspec/changes/*/state.yaml` in this repository remain unchanged.

### L8 — T3 implementation and evidence (2026-10-21)

Changed:
- `plugins/odf-delegation.ts`: removed the registry-gated opt-out; `IMPLEMENT`/`VERIFY` without `workflow_advance` always return `strict-workflow-proof-required` with the message `IMPLEMENT/VERIFY require workflow_advance; the proof-optional legacy omission is no longer accepted.`
- `odf-registry.json`: removed `flags.strict_workflow`.
- `agent/odoo_orchestrator.md`, `command/odf-new.md`, `command/odf-continue.md`: removed the opt-out description.
- `odf-plugin/odf-delegation.test.ts`: the opt-out test is inverted (`strict-opt-out-removed`), the flag-default assertion now checks the key is absent, and nine tests that used the opt-out as a shortcut now run through the canonical proof-backed path with a persisted state, `workflow_advance`, `artifact_store`, `attempt_id`, and validation evidence.

RED evidence: with the old registry-gated branch restored, `strict-opt-out-removed` fails (the delegation succeeds); with the new branch it blocks.

GREEN evidence: `npx vitest run odf-plugin/odf-delegation.test.ts` → 475/475 pass; `npm run typecheck` → clean.
`docs/archive/harness-roadmap.md` keeps the historical record of the original opt-out decision and was not rewritten.

### L9 — T5 implementation and evidence (2026-10-21)

Changed:
- `plugins/odf-delegation.ts`: `odf_status` description declares deprecation; both `found` and `not-found` outputs carry `deprecated: true` and `replacement: "odf_workflow_status"`; the injected ODF system guidance marks it deprecated.
- `docs/plugin.md`, `AGENTS.md`, `docs/architecture.md`, `agent/odoo_orchestrator.md`: mark `odf_status` as deprecated.
- `odf-plugin/odf-delegation.test.ts`: the legacy status test asserts the deprecation fields.

GREEN evidence: focused `odf_status` test passes; `odf-plugin/opencode-v2-contract.test.ts` → 7/7 pass; `npm run typecheck` → clean. The implementation is retained because `odf_workflow_status` still falls back to `buildEngramStatus` for changes without a declared `artifact_store` (D1).

### L10 — T4 status: not started (2026-10-21)

S5 is correct but not a small deletion. The token/host compatibility is what makes the current seal suite runnable: 19 tests use `legacyTools()`, which downgrades a freshly prepared token by deleting `launch_mode`, `parent_session_id`, `launch`, and `prompt_byte_length`, and three tests feed a transcript prefixed with `OPENCODE_SUBAGENT_USER_PREFIX` so the seal can strip it.

Rejecting legacy tokens forces every one of those tests onto `odf_delegation_launch` with a V2 session mock that mints the child, records the durable launch, and returns an exact unprefixed transcript. That is a real rewrite of the native-seal suite, not a mechanical edit, and a mistake there weakens the tests that guard prompt-digest and parent/child binding.

Decision taken: do not rush S5 inside the same change set. T4 remains open with this plan:
1. Remove `OPENCODE_SUBAGENT_USER_PREFIX` stripping and the `allowLegacyHostPrefix` parameter from `preparedPromptFromV2Conversation`.
2. Require `launch_mode: "programmatic"` and `prompt_byte_length` in `isDelegationTokenRecord` (and branch records), returning `delegation-token-legacy` when only those fields are missing.
3. Convert the 19 `legacyTools` tests to programmatic launch, preserving each original assertion; delete `markTokenLegacy`, `legacyTools`, and `prepareDesignLegacy`.
4. Re-run the full suite and the focused seal tests, with RED evidence for the `delegation-token-legacy` block.

### L11 — Full verification (2026-10-21)

- `npm run test:unit` → 46 files, 1265/1265 tests pass.
- `npm test` → 331/331 YAML scenarios pass.
- `npm run typecheck` → clean.
- No commit was created. All changes remain in the working tree.

### L12 — T4 implementation and evidence (2026-10-21)

Changed:
- `odf-plugin/odf-delegation-tokens.ts`: `DelegationTokenRecord` now requires `launch_mode: "programmatic"` and `prompt_byte_length`, and `DelegationTokenBranch` requires `prompt_byte_length`. `createDelegationTokenRecord` always stamps `launch_mode`, and the now-meaningless `launch_mode` input field and its validation were removed. `isDelegationTokenRecord`/`isTokenBranch` accept an `allowLegacyFields` flag only for classification; `readDelegationToken` returns the typed `delegation-token-legacy` error for a well-formed record that lacks those fields instead of treating it as malformed or valid.
- `plugins/odf-delegation.ts`: added `delegationTokenReadMessage`, used by launch, the proposal writer, late-seal preparation, the serial seal, and the parallel seal so a legacy token gets a block that names the token and asks for a fresh `odf_delegation_prepare`. Removed the now-always-true `record.launch_mode === "programmatic"` guards.
- `odf-plugin/odf-delegation-health.ts`: removed `OPENCODE_SUBAGENT_USER_PREFIX` and the `allowLegacyHostPrefix` parameter; `preparedPromptFromV2Conversation` returns the first user text verbatim.
- `odf-plugin/odf-delegation-prepare-seal.test.ts`: replaced `legacyTools`/`markTokenLegacy`/`prepareDesignLegacy` with `markLaunched`/`markBranchesLaunched` (durable `launch` records for the seal tests), removed all prefixed transcript fixtures, and updated the DESIGN/proof seal expectations to `task_api_source: "sdk.v2"`. The expired-token fixture now carries its parent and a matching durable launch so the seal reaches the expiry branch. `prepareDesign` accepts an explicit preparing session because the launch tests model `prepare-session` while the seal tests model `parent-session`.
- `odf-plugin/opencode-v2-adapter.test.ts`: the transcript test now pins that a host prefix is preserved literally and never stripped.
- New regression tests: token-level `rejects records written before the programmatic launch contract` and seal-level `rejects a legacy token with a typed block and asks for a fresh prepare`.

RED evidence:
- The first conversion run against the new validator produced 23 failures whose reason was `delegation-token-legacy` (all old `legacyTools` fixtures), confirming the rejection is active rather than silently accepted.
- Temporarily restoring acceptance of legacy-shaped records (`isDelegationTokenRecord(parsed, true)` in `readDelegationToken`) made both new regression tests fail: the token read returned `error: null`, and the seal blocked with `delegation-parent-mismatch` instead of `delegation-token-legacy`. The file was restored byte-for-byte from a backup and re-verified.

GREEN evidence:
- `npx vitest run odf-plugin/odf-delegation-prepare-seal.test.ts` → 43/43 pass.
- `npx vitest run odf-plugin/odf-delegation-tokens.test.ts odf-plugin/opencode-v2-adapter.test.ts` → 47/47 pass.
- `npm run test:unit` → 46 files, 1267/1267 tests pass.
- `npm test` → 331/331 YAML scenarios pass.
- `npm run typecheck` → clean; `node scripts/odf-registry-validate.js` → all registered paths valid.

Compatibility note: a token prepared by an older build is rejected as soon as the new build reads it, regardless of its 2-hour TTL, because the record shape is checked on read. No migration or long grace window was added; a fresh `odf_delegation_prepare` is required. Runtime effect still requires reinstalling the pack into `~/.config/opencode`.

### L13 — Delivery (2026-10-21)

Branch `feature/legacy-route-removal`, four work-unit commits:
- `aca17c9` — T2: stop persisting legacy route aliases.
- `b7469ee` — T3: require workflow proof unconditionally.
- `5a2b64f` — T4: reject legacy launch tokens.
- T5 closing commit: deprecate `odf_status`; this commit also records the delivery.

Push, pull request creation, and merge remain the user's decision. Runtime behavior changes only after reinstalling the pack into `~/.config/opencode`.
