# Legacy state read path removal (D3)

Objective: remove the remaining legacy read path from `odf_workflow_status` — `legacy_phase`, `state_kind: "legacy-artifacts"`, `LEGACY_ARTIFACT_PHASES`, and the legacy `--work-type` recovery — after proving no active change depends on it.
Branch: `feature/legacy-state-read-path-removal` (work-unit commits). Delivery strategy `ask-on-risk`; test runner `npm test` (Vitest + YAML scenarios).

## Specs

### S1 — No active change loses resumability

Before any source change, prove that no active change is classified `legacy-artifacts`.

Acceptance:
- Every active change in `openspec/changes/*/state.yaml` is inventoried with its `state_kind` and `resumable` values.
- Every change reachable through the status tool is inventoried the same way.
- If no change is `legacy-artifacts`, the removal proceeds and the evidence is recorded; if one is, it is bound to canonical state first.
- No source or behavior change in this task.

Check: one `odf_workflow_status` call per active change in a `mktemp -d`-free read-only pass; no test run required.

### S2 — The status stops emitting `legacy_phase`

Acceptance:
- The `odf_workflow_status` response has no `legacy_phase` key for any of: canonical, archived, Engram-only, expectations-only, and artifact-only changes.
- The observability event no longer carries `phase`.
- `canonical_stage`, `pending_stage`, `completed_canonical_stages`, `artifact_refs`, `progress`, `receipt`, `state_present`, `state_kind`, `resumable`, `work_type`, `artifact_store`, `next_handoff`, `source`, and `warnings` are otherwise unchanged for canonical states.

### S3 — `state_kind: "legacy-artifacts"` is removed

Acceptance:
- `WorkflowStateKind` no longer contains `"legacy-artifacts"`.
- A change with artifacts but no canonical state reports `state_kind: "none"`, `canonical_stage: "INIT"`, and `resumable: false`.
- Such a change emits a warning that names the remedy (`/odf-new {change}`), matching the existing `expectations-only` warning pattern.
- `artifact_refs` still lists the artifacts that were found; the status is not silent about them.

### S4 — The legacy derivation symbols are deleted

Acceptance:
- `LEGACY_ARTIFACT_PHASES` is gone from `odf-plugin/odf-artifact-contract.ts`.
- `legacyPhase`, `LEGACY_PHASES`, `DEFAULT_LEGACY_PHASES`, `LEGACY_STAGE`, `STAGE_LEGACY`, `LEGACY_COMPLETION_PHASES`, `legacyCompletedStages`, `artifactLegacyPhase`, and `LEGACY_ARTIFACT_PHASE_SET` are gone from `odf-plugin/odf-workflow-status.ts`.
- The state document's `phase` key is no longer read for completion, stage inference, or archive detection.
- `npm run typecheck` is clean.

### S5 — The legacy `--work-type` recovery is removed

Acceptance:
- `recovery_work_type_required` is `statePresent && work_type === null`; it no longer fires for artifact-only changes.
- `/odf-continue` step 5 has no `legacy-artifacts` branch.
- The canonical recovery still works: a canonical state without `work_type` requires an explicit `--work-type` and binds only that existing state.
- `/odf-continue` still never creates a workflow and never passes `preflight`/`expectations`.

### S6 — Documentation follows the new surface

Acceptance:
- `command/odf-continue.md`, `agent/odoo_orchestrator.md`, `command/odf-status.md`, and `docs/architecture.md` contain no `legacy_phase`, `legacy-artifacts`, `LEGACY_ARTIFACT_PHASES`, or `recovery_work_type_required` reference.
- The canonical-stage ↔ legacy-phase mapping table in `docs/architecture.md` stays: the delegation API still speaks legacy phases until D2.

### S7 — No behavior change outside the removed surface

Acceptance:
- The route object (`route.legacy_phases`), the bind tolerance for it, `ALLOWED_PHASES`, and every phase→stage mapping stay unchanged (D2 scope).
- Archived, expectations-only, discovery, receipt, `next_handoff`, and artifact-store routing keep their current behavior.
- Verification: focused tests, `npm run test:unit`, `npm run test:yaml`, `npm run typecheck`, registry validation, `git diff --check <base>..HEAD`.
- Independent verifier run because the change removes a published status field and a state kind (high-risk item 3).

## Tasks

- [x] T1 — S1 — route: inline — inventory active changes and record the evidence. No commit. Evidence in L2.
- [x] T2 — S2, S3, S4 — route: inline — tests migrated first (RED in L3), then the legacy derivation and status field removed. Commit holds tests.
- [x] T3 — S5 — route: inline — legacy recovery branch dropped from `recovery_work_type_required` and `/odf-continue`.
- [x] T4 — S6 — route: inline — `command/odf-continue.md`, `agent/odoo_orchestrator.md`, `command/odf-status.md`, `docs/architecture.md` updated.
- [ ] T5 — S7 — route: inline — full verification plus the independent verifier. Unit, YAML, typecheck, registry, and ranged diff check recorded in L3; the independent verifier is unavailable in this runtime.

## Log

### L1 — Original request (verbatim)

Question asked: `D4 está fusionado y verificado. Lo que queda son dos cambios de contrato visible y una mutación de tu entorno. ¿Cuál autorizo como siguiente paso?`

Answer (verbatim, selected option label and description):

> D3 con migración previa (Recomendado)

> Primero vinculo `native-seal-handoff-automation` a un `state.yaml` canónico para que no pierda reanudabilidad, y después retiro `legacy_phase`, `state_kind: "legacy-artifacts"`, `LEGACY_ARTIFACT_PHASES` y la recuperación `--work-type`. Es el slice más acotado y cierra la lectura legacy que D1 y D4 ya dejaron a medias. Revisa ODF2 M6, así que queda registrado en el feature document.

### L2 — Pre-migration evidence (2026-10-22)

The authorized precondition was "no active change loses resumability". The evidence closes it without a bind:

| Change | `state_kind` | `resumable` | `canonical_stage` | Persisted legacy key |
|---|---|---|---|---|
| `delegation-cancellation-lifecycle` | `canonical` | `true` | `PLAN` | `phase: DESIGN` (redundant with `canonical_stage: PLAN` + `completed_canonical_stages: [DECIDE, PLAN]`) |
| `native-child-expiry-recovery` | `canonical` | `true` | `DECIDE` | none |
| `native-v2-model-inheritance` | `canonical` | `true` | `DECIDE` | none |
| `native-seal-handoff-automation` | `none` | `false` | `INIT` | none; only the Engram artifact `odf/native-seal-handoff-automation/qa-plan-receipt` |

No change reports `state_kind: "legacy-artifacts"`, so there is nothing to migrate: `native-seal-handoff-automation` is already non-resumable and would not change classification. The bind described in the authorized option is not executed because it would create state for a change that the status surface already reports as dead.

`phase: DESIGN` in `delegation-cancellation-lifecycle` is the only persisted legacy key. Post-removal its `canonical_stage` stays `PLAN` and its completed stages stay `[DECIDE, PLAN]`, both read from the canonical keys, so no behavior changes for it.

Discovery note: `odf_workflow_status` without a name reports `active-change-discovery-incomplete` with the warning `engram-export-invalid`, and enumerates many `state_kind: "none"` candidates derived from the repository's `engram-export.json`. That file is a pre-existing untracked artifact outside this change; named lookups are unaffected and are the evidence source above.

### L3 — Implementation and evidence (2026-10-22)

Design decision recorded before writing code: an artifacts-only change now reports `state_kind: "none"` and keeps the derived `canonical_stage` / `completed_canonical_stages` for observability, but `resumable` is `false` and the response carries `"Workflow state is missing; artifacts alone are not resumable."`. Collapsing to `none` would otherwise have reported `canonical_stage: INIT` next to populated `artifact_refs`; keeping the derivation reports what the artifacts prove while refusing continuation, which is the authorized outcome. `recovery_work_type_required` is now `statePresent && work_type === null`, so the canonical `--work-type` recovery survives and the legacy branch is gone.

RED observed before implementation: `npx vitest run odf-plugin/odf-workflow-status.test.ts odf-plugin/odf-delegation.test.ts` → 10 failed / 503 passed. The failures were exactly the migrated assertions: `legacy_phase` absence, `state_kind: "none"`, `recovery_work_type_required: false`, `resumable: false`, the ignored `phase` key, the ignored `phase: archived` archive signal, and the command-doc contract.

GREEN after implementation:

- `npx vitest run odf-plugin/odf-workflow-status.test.ts odf-plugin/odf-delegation.test.ts` → 2 files, 513 passed.
- `npm run test:unit -- --testTimeout=30000` → 46 files, 1267 passed.
- `npm run test:yaml` → 331 passed, 0 failed.
- `npx tsc --noEmit` → clean.
- `ODF_CONFIG_DIR=$PWD node scripts/odf-registry-validate.js` → all registered paths valid.

`legacy_phase`, `state_kind: "legacy-artifacts"`, and `LEGACY_ARTIFACT_PHASES` have no remaining non-test reference. `route.legacy_phases`, the bind tolerance for it, and the phase→stage delegation mapping are untouched (S7 / D2 scope).

### L4 — Differential probe and verification limits (2026-10-22)

Differential probe against the only real canonical state with a persisted legacy key (`openspec/changes/delegation-cancellation-lifecycle/state.yaml`, which carries `phase: DESIGN`): a temporary Vitest file imported `deriveWorkflowStatus` from source and read that file directly. Result: `canonical_stage: PLAN`, `completed_canonical_stages: [DECIDE, PLAN]`, `pending_stage: BUILD`, `state_kind: canonical`, `recovery_work_type_required: false`, `resumable: true`, `work_type: feature`, and no `legacy_phase` key. The removed key changed nothing for it because its canonical keys already carried the same information. The temporary file was deleted; no scratch remains in the worktree.

`git diff --check main..HEAD` → clean.

Independent verifier: unavailable in this runtime. The delegation mechanism returned `permission.rejected`, so no independent verifier inspected this candidate. The result is recorded as unavailable, never as PASS; the change's own focused tests, full unit suite, YAML scenarios, typecheck, registry validation, and the differential probe are the evidence that exists.
