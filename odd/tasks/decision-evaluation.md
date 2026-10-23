# Decision evaluation and feedback (Phase 0/1)

Objective: make the existing evaluation stack trustworthy and add a decision-quality report that answers whether the harness chose the right work type, route, stage role, risk tier, plan mode, and gate, using existing local artifacts and telemetry.
Branch: `feat/decision-evaluation` (work-unit commits). Test runner `npm test` (Vitest + YAML scenarios).

## Specs

### S1 — Evaluation foundation is consistent with the stage contract

Acceptance:
- `odf-evaluation online` accepts `online`, `online <days>`, and `online <metrics.json> [days]`; `online 14` no longer tries to read a file named `14`.
- The golden validator accepts exactly the canonical `WORK_TYPES` (10) and the route risk values `low`, `standard`, `high`; it no longer accepts `custom` or `medium`.
- The checked-in golden corpus uses canonical stage/role step labels and covers at least feature, migration, small-change, cross-domain, bugfix, standard-config, and verify-only.
- `evaluateGoldens` validates that each trajectory is an ordered subsequence of the route stages, that each role belongs to its stage, and that a stage is not repeated except for an explicit `-retry` suffix. Shape-only validation is no longer sufficient.
- `evaluateShadow` returns `unavailable`/`no_data` when no provider produced a real `pass` or `fail` verdict, including when `ODF_JUDGE_MODEL` is set but the default runner returns `null`.
- `compareHumanJudge` treats a null/unknown judge verdict as `unavailable`, never as a disagreement.

### S2 — Decision report over existing local evidence

Acceptance:
- `odf-evaluation decisions [days] [--root <dir>] [--md]` reads OpenSpec state, `.odf` policy gates, receipts, attempt ledgers, parallel joins, and metrics JSONL.
- It emits one record per change with: `change`, `work_type`, `route.stages`, terminal stage, `canonical_stage`, completed/pending stages, `resumable`, `risk_tier`, `plan_mode`, `verification`, `predicted_route` (from `entry_route_binding`), `route_agreement`, stage/role/agent activity, attempt count, `rework_count`, `first_pass`, receipts, override count, and `archived`.
- Aggregate output includes: route agreement, risk-tier distribution, plan-mode distribution, first-pass yield, rework rate, gate/receipt counts, override count, archive rate, and per-stage/role delegation counts and durations.
- Missing evidence is `null`/`N/A` or a warning, never an invented value. An empty workspace is `no_data`.
- Engram-only changes are reported as `source: "openspec-only"` and excluded from the aggregate with a warning; the report never reads prompts, diffs, secrets, or absolute paths.

### S3 — CLI, output, and tests

Acceptance:
- `decisions` prints JSON by default and Markdown with `--md`; usage errors are explicit.
- Tests cover: empty workspace `no_data`; one complete change with route agreement and first-pass; a route mismatch; a failed attempt/rework; a receipt/override; an invalid golden order/role; `online 14`; judge null/unavailable.
- The report is deterministic for the same fixture workspace.

### S4 — Documentation and limits

Acceptance:
- `docs/decision-evaluation.md` documents the report fields, metric definitions, privacy limits, and the fact that decision metrics are calibration, never gates.
- The document names the Phase 2/3 extensions: local decision review labels, human/judge agreement, and human-approved learning proposals.
- No new plugin capture path is added in Phase 1; the report is derived from evidence already on disk.

### S5 — No behavior change outside evaluation

Acceptance:
- Delegation, workflow, gates, receipts, archive, and runtime behavior are unchanged.
- Verification: focused tests, `npm run typecheck`, `npm run test:unit`, `npm run test:yaml`, registry validation, and `git diff --check <base>..HEAD`.

## Tasks

- [x] T1 — S1 — route: inline — `75f45ad` fix the evaluation foundation and golden validation; tests first.
- [x] T2 — S2, S3 — route: inline — `75f45ad` add the decision report, CLI, and fixtures.
- [x] T3 — S4, S5 — route: inline — docs and full verification (this commit).

## Log

### L1 — Original request (verbatim)

> 1. continue.
>
> luego revisar como pudiera obtener feedback para saber si cada decision que tomo en el harness es la correcta, necesito herramientas para evaluar lo que se ha construido e ir mejorandolo.

### L2 — Delivery decision (verbatim option and description)

> Publicar verify + Fase 0/1 (Recomendado)

> Publico `fix/verify-artifact-contract` (push + PR) y luego implemento la Fase 0 + Fase 1: arreglo la base de evaluación y añado decision ledger + `odf-evaluation decisions` con route_agreement.

### L3 — Baseline evidence (2026-10-23)

- `node scripts/odf-evaluation.js online 14` fails with `ENOENT ... /14`: the CLI treats the day count as a file path.
- `validateGolden` rejects `work_type: "small-change"` and `risk: "standard"`, while accepting the non-route `custom` and the non-route risk `medium`.
- The checked-in golden corpus still uses phase step names (`PROPOSE`, `ASSESS`, `DESIGN`, `IMPLEMENT`) and `evaluateGoldens` only checks shape.
- `ODF_JUDGE_MODEL=test` with the default runner returns `verdict: null`, `data_status: "complete"`.
- Existing assets: operational metrics/dashboard/baseline, offline/online/golden evaluation, 7 goldens, judge shadow, entry-route shadow, learning proposals, design-library calibration, opt-in aggregate feedback.

### L4 — Verification evidence (2026-10-23)

- `npm run typecheck` — clean.
- `npm run test:unit` — 1300/1300 passed.
- `npm run test:yaml` — 331/331 passed.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` — all paths valid.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-evaluation.js decisions 365 --root "$PWD" --md` — `partial`, 3 changes, risk MEDIUM, plan modes required/inline, first-pass 1/3, receipts 2, overrides 4, no route bindings.
- Golden corpus: 12 entries covering feature, migration, recovery, stale evidence, unsafe tool, multi-company, unapproved expectations, small-change, standard-config, cross-domain, bugfix, and verify-only.
- `scripts/odf-judge.js` with `ODF_JUDGE_MODEL` but no provider now reports `unavailable`/`no_data`.
- The `verify-report` prerequisite is merged in PR #170 (`d3b3c93`).
