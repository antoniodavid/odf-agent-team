# Legacy status field removal (D4)

Objective: drop the legacy projection (`phase`, `artifacts`, `applyProgress`, `lastUpdated`) from the `odf_workflow_status` output and delete `legacyArtifactState`, the last symbol D1 could not remove.
Branch: `feature/legacy-status-field-removal` (work-unit commits). Delivery strategy `ask-on-risk`; test runner `npm test` (Vitest + YAML scenarios).
Status: implemented, verified locally, and committed. Independent verifier unavailable at runtime; see L5.

## Specs

### S1 — The status output stops emitting the legacy projection

`odf_workflow_status` keeps its canonical fields and drops the four legacy ones.

Acceptance:
- The `status: "found"` response has no `phase`, `artifacts`, `applyProgress`, or `lastUpdated` keys.
- That holds for a canonical OpenSpec change, a hybrid change, an Engram-only change, and an archived change.
- `progress` (`completed`, `total`, `known`, `source`) keeps the values `applyProgress` reported for the same observations.
- Everything else is unchanged: `canonical_stage`, `pending_stage`, `completed_canonical_stages`, `legacy_phase`, `state_kind`, `resumable`, `artifact_refs`, `source`, `warnings`, `observability`, `active_change_resolution`. `legacy_phase` stays because it belongs to D3, which is not authorized here.

### S2 — The legacy projection code is deleted

Acceptance:
- `legacyArtifactState` and `PROGRESS_ARTIFACT_TYPES` are gone from `plugins/odf-delegation.ts`.
- `ODFChangeStatus` no longer declares `phase`, `artifacts`, `applyProgress`, or `lastUpdated`.
- No dead locals or unused imports remain; `npm run typecheck` is clean.

### S3 — Documentation follows the new surface

Acceptance:
- `command/odf-status.md` no longer instructs showing "the legacy ones (`phase`, `artifacts`, `applyProgress`, `lastUpdated`)".
- No other command, agent, skill, or doc references those four output fields.

### S4 — No behavior change outside the removed fields

Acceptance:
- Discovery, Engram fallback, receipts, resumability, observability, and the artifact-store routing are unchanged.
- Verification: focused tests, `npm run test:unit`, `npm test`, `npm run typecheck`, registry validation.
- Independent verifier run because the change touches high-risk item 3 (a contract others consume).

## Tasks

- [x] T1 — S1 — route: inline — migrated the existing field assertions to `progress` and added absence assertions; RED recorded. Evidence in L2.
- [x] T2 — S1, S2 — route: inline — deleted the emission, the four type members, and the helper; GREEN observed. Evidence in L3.
- [x] T3 — S3 — route: inline — updated `command/odf-status.md`. Evidence in L4.
- [x] T4 — S1–S4 — route: inline — full verification. The independent verifier for risk item 3 was unavailable (runtime permission). Evidence in L5.

Route evidence: one understood change across plugin, tests, and one command doc; no parallel units and no writer reason.

## Log

### L1 — Original request (verbatim)

Question asked: `¿Qué slice autorizás como siguiente? Los tres tocan contrato visible para consumidores, así que necesito tu elección explícita antes de escribir código.`

Answer (verbatim, selected option label and description):

> D4: adelgazar el status (Recomendado)

> Quita `phase`, `artifacts`, `applyProgress` y `lastUpdated` de `odf_workflow_status`, y con ellos `legacyArtifactState` (el único símbolo que D1 no pudo borrar). No cambia reanudabilidad, `state_kind` ni el contrato de delegación: solo rompe a quien lea esos cuatro campos. Cierra lo que quedó pendiente de D1.

Scope reading applied: the authorization covers the four output fields, `legacyArtifactState`, and the documentation of those fields. It does not cover `legacy_phase`, `state_kind: "legacy-artifacts"`, `LEGACY_ARTIFACT_PHASES`, or the `--work-type` recovery (D3), and it does not cover the delegation phase API (D2).

### L2 — Baseline inventory and RED evidence (2026-10-22)

Emission points in `plugins/odf-delegation.ts`:
- `6245` `ODFChangeStatus` declares `phase`, `artifacts`, `applyProgress`, `lastUpdated`.
- `8604-8623` `buildMergedStatus` computes `artifactStates` and `lastUpdated` and returns the four fields.
- `8945-8954` the tool response spreads `status.workflowStatus` and re-adds `phase`, `artifacts`, `applyProgress`, `lastUpdated`.
- `8470` `PROGRESS_ARTIFACT_TYPES` and `8472` `legacyArtifactState` exist only for the `artifactStates` map.

Consumers:
- `command/odf-status.md:39` documents the four fields as the legacy ones to show, and its sample detail renders an artifact checklist from the `artifacts` map.
- `odf-plugin/odf-workflow-status.test.ts:907-924` asserts `phase`, `applyProgress`, and `artifacts["implement-progress"]`.
- `odf-plugin/odf-delegation.test.ts:2496`, `:2523` assert `status.artifacts[...]`.
- `odf-plugin/odf-delegation.test.ts:3977`, `:3980`, `:4021` assert `applyProgress` and the `artifacts` map.
- `odf-plugin/odf-workflow-status.test.ts:740`, `:766` and `odf-plugin/odf-delegation.test.ts:2596`, `:2604` assert `artifacts.expectations`.
- No other module, script, agent, or skill reads the four fields; `ODFChangeStatus` has no consumer outside `plugins/odf-delegation.ts`.

RED evidence (tests migrated first, production code still unchanged):
- `expected { status: 'found', …(23) } to not have property "phase"` — `odf_workflow_status tool > returns canonical fields…`
- `expected { status: 'found', …(23) } to not have property "artifacts"` — `resolves explicitly named archived OpenSpec changes…` and `merges Engram artifacts for a hybrid store`
- `expected { status: 'found', …(23) } to not have property "phase"` — `derives an Engram-only change through the canonical builder`
- Result: 4 failed | 509 passed.

### L3 — Implementation and evidence (2026-10-22)

Changed in `plugins/odf-delegation.ts`:
- `ODFChangeStatus` keeps `change`, `workflowStatus`, and `observability`.
- `buildMergedStatus` no longer builds `artifactStates` or `lastUpdated` and returns only `change` and `workflowStatus`.
- The `status: "found"` response stops re-adding the four fields after spreading `workflowStatus`.
- `legacyArtifactState` and the private `PROGRESS_ARTIFACT_TYPES` set are deleted; the canonical `progress` field already reports `completed`, `total`, `known`, and `source`.

Tests migrated (no test added or removed):
- `odf-workflow-status.test.ts`: the tool test is renamed to `returns canonical fields without the legacy status projection`; `phase`/`applyProgress`/`artifacts` assertions become `progress` assertions plus absence loops.
- `odf-delegation.test.ts`: the archived and hybrid tests assert `artifact_refs` and the absence of `artifacts`; the export-path test now distinguishes `progress.source` (`implement-progress` vs `apply-progress`) instead of comparing two identical `applyProgress` objects; the Engram-only pin test uses `progress`; the failed-save test uses the canonical `missing-expectations` warning instead of `artifacts.expectations`; the observability test keeps `legacy_phase: "PROPOSE"` to pin that D4 does not remove it.

GREEN evidence:
- `npx vitest run odf-plugin/odf-workflow-status.test.ts odf-plugin/odf-delegation.test.ts` → 2 files, 513/513 pass.
- `npm run typecheck` → clean.

### L4 — Documentation (2026-10-22)

`command/odf-status.md`:
- The `## Canonical Fields` section no longer says "in addition to the legacy ones (`phase`, `artifacts`, `applyProgress`, `lastUpdated`)".
- The summary table renders `Stage` with canonical values (`DECIDE`, `INIT`) instead of the phase label.
- The detail sample drops the artifact checklist (its only source was the removed map), keeps `Legacy phase`, and lists the canonical fields.

### L5 — Verification (2026-10-22)

Commands and observed results:
- `npm run test:unit -- --testTimeout=30000` → 46/46 files, 1267/1267 tests pass, with `Errors 1 error`: `[vitest-worker]: Timeout calling "onTaskUpdate"`. The same error, with the same 46 files and 1267 tests, reproduces on baseline `23ed0b0` in a scratch worktree (`/tmp/opencode/odf-baseline`, removed afterwards), so it pre-exists this change.
- `npm run test:yaml` → 331/331 scenarios pass.
- `npm test` → reports `331 passed, 1 failed`; the failing counter is the `--plugin-tests` step, which increments when the Vitest child process exits non-zero. That exit code comes from the same pre-existing unhandled worker error, not from a failing test.
- `npm run typecheck` → clean.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` → all registered paths valid.
- `git diff --check 23ed0b0..HEAD` → clean.

Risk line: **item 3** — the change removes four fields from a published tool output that consumers can read.

Independent verifier: **unavailable**. Two launch attempts (`general`, then `odoo_code_reviewer`) were rejected by the runtime with `permission.rejected: Permission denied: subagent`. No PASS was inferred from this; the change's own checks above are the evidence collected.

Native review: `gentle-ai review assess` reports `risk: high` and `review_due: true`, but `gentle-ai review mode status` reports `receipt-driven development: off (decided by global)`, so no review lifecycle was started.

Commits: `eb8d644` (code + tests), `18b51d6` (docs). Branch `feature/legacy-status-field-removal`.
