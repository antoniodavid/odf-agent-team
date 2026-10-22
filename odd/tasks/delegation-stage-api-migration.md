# Delegation stage API migration (D2)

Objective: migrate the delegation API from legacy phases to canonical stages plus a role selector for the two composite stages, and replace `materializeLegacyCanonicalBoundary` with a stage-based canonical commit. It also closes the `route.legacy_phases` and bind-tolerance scope that D3 left to D2.
Branch: `feature/delegation-stage-api-migration` (work-unit commits). Delivery strategy `ask-on-risk`; test runner `npm test` (Vitest + YAML scenarios).

## Specs

### S1 — Public delegation inputs are stage-first

Acceptance:
- `odf_delegate`, `odf_delegation_prepare`, `odf_parallel_delegate`, and `odf_parallel_prepare` accept `stage` and no longer accept `phase`.
- `odf_policy_gate` accepts `stage: "BUILD" | "VERIFY"`.
- `odf_receipt` accepts `stage` plus an optional `role`.
- `odf_profile_select` and `odf_skill_resolve` accept `stage` plus an optional `role`.
- An invocation that passes `phase` is rejected by schema validation; no tool silently accepts both spellings.
- The allowed stage domain is exactly `DECIDE`, `PLAN`, `BUILD`, `VERIFY`, `EXPLORE`, `FIX`, reused from `CanonicalStage` in `odf-plugin/odf-workflow.ts`.

### S2 — Role is required only for composite stages

Verbatim approved contract:

> `{stage: "DECIDE", role: "propose"|"assess"}` y `{stage: "PLAN", role: "qa-plan"|"design"}`. BUILD/VERIFY/EXPLORE/FIX no llevan role. `agent` sigue siendo override opcional.

Acceptance:
- `DECIDE` requires `role` `PROPOSE` or `ASSESS`.
- `PLAN` requires `role` `QA-PLAN` or `DESIGN`.
- `BUILD`, `VERIFY`, `EXPLORE`, and `FIX` reject any `role` value.
- A missing role returns a typed `role-required` block that lists the two allowed roles for that stage.
- A role supplied for a non-composite stage returns a typed `role-not-applicable` block.
- An unknown stage returns a typed `invalid-stage` block that lists the six canonical stages.
- Assumption: role values are uppercase (`PROPOSE`, `ASSESS`, `QA-PLAN`, `DESIGN`) to match the registry vocabulary and stage casing; the approved option's lowercase examples are illustrative.

### S3 — Agent resolution keeps its behavior

Acceptance:
- The internal phase is derived once: `role` for `DECIDE`/`PLAN`; `IMPLEMENT` for `BUILD`; `VERIFY` for `VERIFY`; `EXPLORE` and `FIX` for themselves.
- `agent` remains an optional explicit override and is validated against the derived phase, so `agent-phase-ineligible` keeps its meaning.
- Keyword routing is unchanged: `DESIGN` routes among backend, frontend, API, DBA, and upgrade-migrator agents; `ASSESS` routes between functional consultant and upgrade migrator; `BUILD`/`FIX` route among their domain agents; `VERIFY` defaults to the QA engineer.
- When `agent` is absent, the resolved agent is the same agent the legacy phase would have selected for the same task text, stage, and role.

### S4 — Skills, profiles, and previews use the derived role

Acceptance:
- `matchSkills` and `getProfileByPhase` receive the derived internal phase; registry `agents[].phases` and `profiles[].phases` stay role-keyed and unchanged.
- `odf_skill_resolve` accepts `stage` + `role`, resolves the same agent/skills/profile as the equivalent delegation, and its output names the stage and role instead of a top-level phase.
- `odf_profile_select` accepts `stage` + `role` and returns the profile for the derived phase.

### S5 — Policy gate, receipts, and attempt ledger speak stages

Acceptance:
- `PolicyGateDecision.phase` becomes `stage: "BUILD" | "VERIFY"`; `computePolicyGate` takes `stage`.
- The persisted `.odf/policy-gate-{change}.json` uses `stage`; a persisted gate without a matching `stage` is never reused and is recomputed.
- `ODFReceipt.phase` becomes `stage` plus `role`; `review_gate` is populated only for `VERIFY`.
- Existing receipt files remain readable because the disposition reads only `action`, `status`, and `candidate_digest`; no legacy field is required.
- The attempt ledger record field `phase` becomes `stage: "BUILD" | "VERIFY"`.
- A pre-upgrade ledger line that still carries `phase: "IMPLEMENT"` is normalized on read to `stage: "BUILD"` so the ledger does not become unreadable; `phase: "VERIFY"` normalizes to `stage: "VERIFY"`. This is data tolerance for append-only files, not a public API alias.
- Attempt concurrency, reuse, and stale-attempt recovery keep their current behavior and messages, with the stage name substituted.

### S6 — Delegation tokens bind stage and role

Acceptance:
- `DELEGATION_TOKEN_SCHEMA_VERSION` becomes `2`.
- Token records store `stage` and `role` instead of `phase`.
- The prompt marker carries `{ change, stage, role, agent, token }`.
- A version-1 token is rejected with a typed block that asks for a re-prepare; the 2-hour TTL remains the only grace period.
- `odf_delegation_seal`, `odf_delegation_late_seal_prepare`, native recovery, and every public envelope expose `stage` and `role`, not `phase`.
- Seal/recovery identity checks compare `change`, `stage`, `role`, `agent`, and `attempt_id` exactly as they compared `change` and `phase` before.

### S7 — Canonical stage commit replaces the legacy boundary

Acceptance:
- `materializeLegacyCanonicalBoundary` and `LEGACY_CANONICAL_BOUNDARIES` are deleted.
- A successful stage-terminal role delegation (`ASSESS` for `DECIDE`, `DESIGN` for `PLAN`) commits the canonical stage derived from the route, with the same blocked reasons: state unavailable, missing/invalid `work_type`, malformed state, artifact prefix not terminal, and workflow-lock failure.
- The commit writes `work_type`, `canonical_stage`, `completed_canonical_stages`, and `last_updated`; it no longer writes the legacy `phase` key.
- Idempotency compares the persisted stages and `canonical_stage` only; an existing `phase` key in a state document is preserved but never required.
- A successful `PROPOSE` delegation does not commit `DECIDE`; the prefix guard keeps the same behavior as today.

### S8 — Telemetry and metrics record stages

Acceptance:
- New metric events carry `stage` and `role` instead of `phase`.
- `flow_stage` resolution and the bind terminal marker sequence keep their current values; the sequence is keyed by stage+role internally.
- Historical metric events that carry `phase` remain readable through the existing `PHASE_STAGE` map; no historical file is rewritten.

### S9 — Parallel BUILD is a BUILD-stage contract

Acceptance:
- `odf_parallel_delegate` and `odf_parallel_prepare` accept only `stage: "BUILD"`; any other stage returns a typed `parallel-stage-unsupported` block.
- The parallel join artifact records `stage: "BUILD"`; a pre-upgrade artifact with `phase: "IMPLEMENT"` is rejected with a typed reason and `resume_from_join: true` retries only the incomplete branches.
- The aggregate scheduler, branch attempts, and the single canonical BUILD commit keep their current behavior.

### S10 — Route aliases leave the delegation surface

Acceptance:
- `WorkflowRoute` no longer exposes `legacy_phases`; `resolveWorkflowRoute` and `odf_workflow_route` return `stages` only.
- The bind keeps tolerating a persisted `route.legacy_phases` key in existing states and never writes it for a new state; this is data tolerance, not a route contract.
- `WORK_TYPES`, stage order, `plan`, `verification`, `parallel_build`, and `risk` are unchanged.

### S11 — Documentation and registry follow the new surface

Acceptance:
- `agent/odoo_orchestrator.md`, `command/*.md`, `skills/**`, `docs/architecture.md`, `docs/plugin.md`, and `AGENTS.md` describe `stage` + `role` and contain no delegation call with `phase:`.
- The `docs/architecture.md` mapping table becomes "canonical stage → roles" and keeps the six-stage domain.
- `odf-registry.json` `agents[].phases` and `profiles[].phases` stay as internal role metadata; `node scripts/odf-registry-validate.js` passes.
- OCA governance provenance (`GOVERNANCE_PHASES`, `.odf/ai-provenance.json`) is explicitly out of scope for D2; it is a separate publication artifact.

### S12 — No behavior change outside the migrated surface

Acceptance:
- Work types, routes, ticket triage, health, expectations, artifact stores, and `odf_workflow_status` semantics are unchanged.
- VERIFY's evidence seal, Policy Gate blocking, failure receipts, fast-lane BUILD, and native recovery keep their current behavior.
- Verification: focused tests per task, `npm run typecheck`, `npm run test:unit`, `npm run test:yaml`, the registry validator, and `git diff --check <base>..HEAD`.
- An independent verifier runs because the change removes published tool fields (`phase`) and a persisted state key (high-risk item 3). If the runtime denies the verifier, the result is recorded as unavailable, never PASS.

## Tasks

- [x] T1 — S1, S2 — route: inline — `1ad1fa8` `refactor(delegation): introduce the canonical stage+role contract`.
- [x] T2 — S1, S3, S4 — route: inline — `3635464` `refactor(delegation): accept canonical stages in odf_delegate`.
- [x] T3 — S6 — route: inline — `829df36` `refactor(delegation): bind native tokens to stage and role`.
- [x] T4 — S5 — route: inline — `4faec55` `refactor(delegation): gate and settle canonical stages`.
- [x] T5 — S9 — route: inline — `2962eb2` `refactor(delegation): make parallel BUILD a stage contract`.
- [x] T6 — S7 — route: inline — `2755ed8` `refactor(delegation): commit canonical stages instead of legacy boundaries`.
- [x] T7 — S8, S10 — route: inline — `7d0ef41` `refactor(workflow): emit stages and drop route phase aliases`.
- [x] T8 — S11, S12 — route: inline — `f43cdb5` toolkit read side, `13f7741` docs, `8443c4b` route fixture; full verification recorded in L5.

## Log

### L1 — Authorization (verbatim)

Original directive:

> seguir con el proceso de refactoring.

Contract question asked after the evidence showed that `DECIDE` and `PLAN` each own two roles:

> D2 migra la API de delegación de fases legacy a stages canónicos. DECIDE y PLAN tienen dos roles cada uno (PROPOSE/ASSESS y QA-PLAN/DESIGN), así que el stage solo no alcanza para elegir agente, skills y artefacto. ¿Qué contrato tomo? En las tres opciones el `phase` legacy deja de aceptarse, y `materializeLegacyCanonicalBoundary` se elimina/reemplaza.

Answer (selected label and description, verbatim):

> stage + role (Recomendado)

> `{stage: "DECIDE", role: "propose"|"assess"}` y `{stage: "PLAN", role: "qa-plan"|"design"}`. BUILD/VERIFY/EXPLORE/FIX no llevan role. `agent` sigue siendo override opcional. Preserva el ruteo por keywords (frontend/api/dba en design; consultant/upgrade en assess) y elimina ALLOWED_PHASES del API público. Es el mapeo más fiel y sin pérdida.

### L2 — Baseline (2026-10-22)

- Branch point: `97cb231` (`refactor(status): remove the legacy state read path (#167)`), tracked-clean `main`.
- Commit mapping used by the migration is the existing one: `PROPOSE`+`ASSESS` → `DECIDE`, `QA-PLAN`+`DESIGN` → `PLAN`, `IMPLEMENT` → `BUILD`, `VERIFY` → `VERIFY`, `EXPLORE` → `EXPLORE`, `FIX` → `FIX`.
- Correction to the earlier proposal: `EXPLORE` and `FIX` are already canonical stages in `odf-plugin/odf-workflow.ts` (`CanonicalStage`), not work types.

### L3 — Static inventory (2026-10-22)

| Surface | Evidence |
|---|---|
| Public phase schemas | `plugins/odf-delegation.ts:1436` (`odf_policy_gate`), `:1732` (`odf_delegate`), `:3674` (`odf_delegation_prepare`), `:4794` and `:5478` (parallel), `:6172` (`odf_profile_select`); `odf-plugin/odf-skills.ts:282` (`odf_skill_resolve`); `odf-plugin/odf-delegation-receipts.ts:122` (`odf_receipt`) |
| Validation | `ALLOWED_PHASES` at `plugins/odf-delegation.ts:586`; checks at `:1810` and `:3719` |
| Boundary materialization | `materializeLegacyCanonicalBoundary` at `:7065`, `LEGACY_CANONICAL_BOUNDARIES` at `:6919`, call site `:1686` |
| Agent resolution | `resolveAgent`/`validateAgentSelection` from `scripts/lib/agent-resolve.js`; calls at `plugins/odf-delegation.ts:2180`, `:2190`, `:3868`, `:3874`, parallel at `:4951` |
| Policy gate | `PolicyGateDecision.phase` and reuse at `odf-plugin/odf-delegation-policy.ts:24`, `:384`, `:408`; tool at `plugins/odf-delegation.ts:1436` |
| Receipts | `ODFReceipt.phase` at `odf-plugin/odf-delegation-receipts.ts:13`, tool at `:122` |
| Attempt ledger | `AttemptLedgerPhase` at `plugins/odf-delegation.ts:678`; validation at `:822`; acquire at `:998` |
| Tokens | `DELEGATION_PHASES` and schema v1 at `odf-plugin/odf-delegation-tokens.ts:20`, `:33`; validation at `:426` |
| Telemetry | phase→stage map `PHASE_STAGE` at `odf-plugin/odf-observability.ts:383`; bind prefix at `plugins/odf-delegation.ts:1512` |
| Parallel join | `odf-plugin/odf-parallel-join.ts:133` rejects anything but `phase: "IMPLEMENT"` |
| Route aliases | `WorkflowRoute.legacy_phases` at `odf-plugin/odf-workflow.ts:27`; bind tolerance at `plugins/odf-delegation.ts:9156`, `:9167` |
| Registry | 10 of 11 agents declare `phases`; `odoo_orchestrator` declares `ALL`; profiles keyed by phase (6 entries, no EXPLORE/FIX) |
| Test weight | `odf-plugin/odf-delegation.test.ts` 233 `phase:` occurrences, `odf-delegation-prepare-seal.test.ts` 44, `odf-native-attempt-recovery.test.ts` 15, YAML scenarios 14, docs 12 |

### L4 — Work-unit evidence (2026-10-22)

Each work unit was verified before its commit:

| Unit | Focused evidence | Result |
|---|---|---|
| T1 | `npx vitest run odf-plugin/odf-delegation-contract.test.ts` | 12/12 passed |
| T2 | `npx vitest run odf-plugin/odf-delegation.test.ts` | 477/477 passed |
| T3 | `npx vitest run odf-plugin/odf-delegation-tokens.test.ts odf-plugin/odf-delegation-prepare-seal.test.ts odf-plugin/odf-observability.test.ts` | 68/68 passed |
| T4 | `npx vitest run odf-plugin` | 921/921 passed |
| T5 | `npx vitest run odf-plugin/odf-delegation.test.ts odf-plugin/odf-delegation-prepare-seal.test.ts` | 520/520 passed |
| T6 | `npx vitest run odf-plugin/odf-delegation.test.ts odf-plugin/odf-delegation-prepare-seal.test.ts` | 520/520 passed |
| T7 | `npx vitest run odf-plugin` | 921/921 passed |

Full verification after T7:
- `npm run typecheck` — clean.
- `npm run test:unit` — 1281/1281 passed; Vitest still reports the pre-existing `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error on some runs, which is not a test failure.
- `npm run test:yaml` — 331/331 passed.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` — all registered paths valid.

Out-of-scope remnants, intentional:
- `ValidationEvidenceFile.phase` and the `phase: "VERIFY"` field written by `odf-toolkit manual-evidence` remain the validation-evidence proof contract (S12 keeps the evidence seal unchanged).
- OCA governance `GOVERNANCE_PHASES` and `.odf/ai-provenance.json` remain a separate publication artifact.
- Historical reads keep `PHASE_STAGE` and the `by_phase` dashboard bucket name; new events write `stage`/`role`.

### L5 — Full verification (2026-10-22)

On the branch tip after T8:

- `npm run typecheck` — clean (no diagnostics).
- `npm run test:unit` — 47 files, 1281/1281 tests passed. Vitest reports the pre-existing `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error; it is not a failing test and predates this work.
- `npm run test:yaml` — 331/331 passed.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` — all registered paths valid.
- `git diff --check main..HEAD` — clean.

Independent verifier: requested because the change removes published tool fields (`phase`) and a persisted route key (`legacy_phases`), which is Task Size high-risk item 3. The runtime denied the delegated verifier (`permission.rejected`), so the result is recorded as unavailable, never PASS.
