# Feature-inline with a conditional ASSESS gate

Objective: add a lean `feature-inline` route and make ASSESS a deterministic,
conditional gate instead of a mandatory SDD stage. Target is the Odoo customer
flow only; harness-development artifacts stay untouched.
Branch: `feat/feature-inline-assess-gate`. Delivery strategy: `ask-on-risk`.
Test runner: `npm test`.

## Specs

- **S1**: `feature-inline` is a canonical work type with route
  `DECIDE -> BUILD -> VERIFY`, `plan: inline`, `verification: required`,
  `parallel_build: false`, `risk: standard`.
- **S2**: entry triage selects `feature-inline` for a standard entry with no
  risk signals, no missing facts, and no unclear intent. The existing `feature`
  route is unchanged and remains selectable explicitly or when triage cannot
  classify safely.
- **S3**: a pure assessment gate returns one of `skip`, `assess`, `escalate`
  with a reason and bounded signals:
  - `escalate` when the resolved route is `feature`, `cross-domain`,
    `migration`, or `security`, or when a risk signal is present.
  - `assess` when the resolved route is `feature-inline` and any of these holds:
    the entry still needs a question, intent clarity is `unclear`, a warning
    reports an unknown module, `expected_files > 10`, a context file lands under
    `models/`, `security/`, `data/`, `migrations/`, `wizard/`, `report/`, or
    `controllers/`, the redundancy probe found at least one hit or
    contradiction, or the caller passed `explicit_assess`.
  - `skip` otherwise.
- **S4**: a `feature-inline` bind with `terminal_stage: DECIDE` requires an
  `assessment` object whose `mode` is `skip`; the persisted `decision` artifact
  records `assessment` and the existing `intent` / `expectations_approved`.
  A `feature-inline` bind whose gate mode is `assess` must not use a terminal
  DECIDE; it runs exactly one ASSESS delegation that saves the canonical
  `decision` artifact before DECIDE commits.
- **S5**: `feature` remains untouched. No existing change state or legacy
  artifact (`proposal`, `assess`, `design`, `qa-plan`, `tasks`) is migrated,
  rewritten, or deleted.
- **S6**: route, assessment gate, bind, command, orchestrator, and the lean
  ASSESS skill are documented and covered by focused tests. Typecheck, the
  full unit suite, the YAML scenarios, and the registry validator pass.

## Tasks

- T1 (S1, S2) — DONE. `odf-plugin/odf-workflow.ts`, `odf-plugin/entry-triage.ts`,
  `scripts/odf-evaluation.js`, route/workflow tests. Route and triage mapping.
- T2 (S3) — DONE. `odf-plugin/entry-triage.ts` assessment gate plus 9 focused
  tests.
- T3 (S4) — DONE. `plugins/odf-delegation.ts` terminal validation, assessment
  persistence, hardcoded work-type enums, and 3 delegation tests.
- T4 (S6) — DONE. `command/odf-new.md`, `agent/odoo_orchestrator.md`,
  `agent/odoo_{backend,frontend}_engineer.md`, `agent/odoo_qa_engineer.md`,
  `skills/odf-assess/SKILL.md`, `docs/route-contract.md`,
  `docs/architecture.md`.
- T5 (S6) — DONE. `npm run typecheck` clean; focused Vitest files green;
  `npx vitest run` 1358/1358; `npm run test:yaml` 331/331;
  `ODF_CONFIG_DIR=$PWD node scripts/odf-registry-validate.js` valid.

## Log

- **L1** (user, verbatim): "como pudiera agregar ASSET a la opcion A. ASSET es importante aunque hay ocasiones que todo esta claro y no se necesita"
- **L2** (user, verbatim): "si"
- **L3** (decision): ASSET is interpreted as ASSESS. Option A is the lean
  `feature-inline` + terminal DECIDE route confirmed in the preceding review.
- **L4** (scope): target is the flow used in Odoo customer projects; the
  harness-development SDD (`openspec/sdd-init.yaml`, `openspec/specs`) is out
  of scope.
- **L5** (implementation, 2026-10-25): T1-T4 implemented. `feature-inline` is
  additive; `feature` and all legacy routes/artifacts are untouched. Evidence:
  `npm run typecheck` clean, `npx vitest run` 1358/1358, `npm run test:yaml`
  331/331, registry validator valid, focused route/workflow/triage/delegation
  tests green.
- **L6** (verification limitation): the independent verifier could not be
  launched because the runtime denied the `subagent` permission
  (`Permission denied: subagent`). No independent PASS is claimed; the
  implementer's focused tests and full suite are the only evidence recorded.
- **L7** (user, 2026-10-25): requested a PR and a merge into `main`.
