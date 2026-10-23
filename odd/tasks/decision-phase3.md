# Decision evaluation Phase 3: periods, cadence, and proposals

Objective: close the feedback loop by comparing decision-quality reports across periods, surfacing when a local review is due, and generating deterministic, human-approved improvement proposals.
Branch: `feat/decision-phase3` (work-unit commits). Test runner `npm test` (Vitest + YAML scenarios).

## Specs

### S1 — Period comparison

Acceptance:
- `node scripts/odf-evaluation.js compare <before.json> <after.json> [--md]` compares two saved `decisions` reports.
- The comparison exposes before/after values and deltas for: changes, route-agreement rate, first-pass rate, rework rate, receipts, overrides, archive rate, review coverage, review route-correct rate, review gate-correct rate, and average rating.
- Each delta carries a direction and a `higher_is_better` interpretation; the report never declares a winner on its own.
- Either report `no_data` yields `no_data` with a warning; a partial report yields `partial`.
- Markdown renders a before/after/delta table.

### S2 — Review cadence

Acceptance:
- `node scripts/odf-evaluation.js cadence [days] [--root <dir>] [--md]` reads OpenSpec changes and `.odf/decision-review-*.json`.
- It reports changes, reviewed changes, review count, coverage, latest `reviewed_at`, age in days, and `due`.
- `due` is true when no review exists or the latest review is older than `days` (default 30).
- An empty workspace is `no_data`; a workspace with changes is `complete` or `partial` based on review coverage.
- The output is advisory; it never blocks workflow or archive.

### S3 — Human-approved improvement proposals

Acceptance:
- `node scripts/odf-evaluation.js proposals <report.json> [--md]` reads a saved `decisions` report and emits deterministic proposals.
- Rules cover: route agreement below 0.8, risk fit `under`, plan fit `under`, gate-correct below 1, rework rate above 0.2, first-pass yield below 0.7, and review coverage below 0.5.
- Every proposal carries `id`, `kind`, `severity`, `evidence`, `recommendation`, `requires_human_approval: true`, and `auto_apply: false`.
- No proposal changes routes, risk tiers, plan modes, gates, or files. A human decides whether to act.
- A `no_data` report yields `no_data`; Markdown renders the proposal list.

### S4 — Documentation and limits

Acceptance:
- `docs/decision-evaluation.md` documents the saved-baseline workflow for `compare`, the recommended cadence, and the human-approval rule for `proposals`.
- The document states that the tools are calibration/advisory only and that Engram-only changes remain out of scope.
- `docs/architecture.md` or the existing evaluation link points to the new modes.

### S5 — No behavior change outside evaluation

Acceptance:
- Delegation, workflow, gates, receipts, archive, and runtime behavior are unchanged.
- Verification: focused tests, `npm run typecheck`, `npm run test:unit`, `npm run test:yaml`, registry validation, and `git diff --check <base>..HEAD`.

## Tasks

- [x] T1 — S1 — route: inline — `a6e1a53` comparison function, CLI, and tests.
- [x] T2 — S2 — route: inline — `a6e1a53` cadence function, CLI, and tests.
- [x] T3 — S3 — route: inline — `a6e1a53` proposal rules, CLI, and tests.
- [x] T4 — S4, S5 — route: inline — docs and full verification (this commit).

## Log

### L1 — Original request (verbatim)

> go Fase 3

### L2 — Scope decision

Phase 3 of `docs/decision-evaluation.md`: period comparison, review cadence, and human-approved improvement proposals. No new capture path, no automatic gating, no auto-apply.

### L3 — Baseline evidence (2026-10-23)

- `odf-evaluation decisions` and `review`/`agreement` are merged in `23b182d`.
- The decisions report already exposes route agreement, first-pass, rework, receipts, overrides, archive, reviews, and stage activity.
- There is no comparison mode, cadence check, or proposal generator yet.
- `scripts/odf-learning-bridge.js` remains the human-approved learning path for archived changes; Phase 3 proposals are deterministic report-derived suggestions, not auto-activation.

### L4 — Verification evidence (2026-10-23)

- `npm run typecheck` — clean.
- `npm run test:unit` — 1311/1311 passed.
- `npm run test:yaml` — 331/331 passed.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` — all paths valid.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-evaluation.js decisions 365 --root "$PWD" > /tmp/decision-report.json`; `proposals` returns 3 proposals: `rework-hotspot`, `first-pass-yield`, `review-coverage`.
- `cadence --root "$PWD" --md` — `partial`, due yes, 3 changes, 0 reviews, 0% coverage.
- `compare <report> <report> --md` — `partial`, flat deltas, route/human rates N/A (no bindings/reviews).
- Comparison, cadence, and proposal tests cover deltas, no_data/partial, due/current/old reviews, threshold rules, human approval, and Markdown.
