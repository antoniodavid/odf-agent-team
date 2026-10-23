# Local decision review and human/judge agreement (Phase 2)

Objective: add the missing ground-truth layer for decision evaluation: a local, closed-label human review of route/risk/plan/gate decisions, its aggregation in `odf-evaluation decisions`, and a human/judge agreement report over shadow judgments.
Branch: `feat/decision-review` (work-unit commits). Test runner `npm test` (Vitest + YAML scenarios).

## Specs

### S1 — Local decision review artifact and CLI

Acceptance:
- `node scripts/odf-evaluation.js review <change> --route correct|incorrect --risk under|ok|over --plan under|ok|over --gate correct|incorrect --rating 1..5 [--root <dir>]` writes `<root>/.odf/decision-review-{change}.json`.
- The artifact is `{schema_version: 1, change, route, risk, plan, gate, rating, reviewed_at, source: "local-human-review"}`.
- The change name is validated with the kebab-case pattern; the review path stays inside `.odf`; no free text, prompts, secrets, or absolute paths are stored.
- Invalid enum values, a rating outside 1..5, a missing field, or an unknown flag exits with an explicit error and writes nothing.
- Re-running the review overwrites the artifact with a fresh `reviewed_at` (a human may revise a label).
- The command is local-only; it never sends data anywhere.

### S2 — Decision report includes human labels

Acceptance:
- `evaluateDecisions` reads `.odf/decision-review-{change}.json` when present and exposes per change: `review` (or `null`), `review_route_correct`, `review_risk_fit`, `review_plan_fit`, `review_gate_correct`, and `review_rating`.
- Aggregate output adds `reviews`: count, coverage, route-correct rate, risk-fit counts, plan-fit counts, gate-correct rate, and average rating.
- Missing or invalid reviews are `null`/`N/A` with a warning; they never block the report and never invent a label.
- Markdown output includes the review coverage/rates and per-change labels.
- `data_status` remains `no_data`/`partial`/`complete` based on changes and telemetry; reviews are an additional dimension, not a gate.

### S3 — Human/judge agreement report

Acceptance:
- `node scripts/odf-evaluation.js agreement [file] [--root <dir>] [--md]` reads a shadow-judgment JSONL; the default is `<root>/.odf/shadow-judgments.jsonl`.
- Each entry is compared with `compareHumanJudge`; output includes `total`, `compared`, `agreement`, `false_pass`, `false_block`, `unavailable`, and their rates.
- An empty/missing file is `no_data`; all-unavailable entries are `no_data`; a mix is `partial`; full comparison is `complete`.
- A null/unknown judge verdict is unavailable, never a disagreement.
- The report is calibration only; it never gates delivery.

### S4 — Archive/verify integration and documentation

Acceptance:
- `command/odf-archive.md` instructs the orchestrator to offer the local review after a successful archive, ask the four closed questions plus rating, and run the CLI; it is optional and non-blocking.
- `command/odf-verify.md` mentions the same optional review for verify-only or user-requested closure.
- `docs/decision-evaluation.md` documents the review labels, the agreement report, privacy, and the non-gating rule.

### S5 — No behavior change outside evaluation

Acceptance:
- Delegation, workflow, gates, receipts, archive, and runtime behavior are unchanged.
- Verification: focused tests, `npm run typecheck`, `npm run test:unit`, `npm run test:yaml`, registry validation, and `git diff --check <base>..HEAD`.

## Tasks

- [x] T1 — S1 — route: inline — `106ed82` review CLI, artifact validation, and tests.
- [x] T2 — S2 — route: inline — `106ed82` decision report integration and tests.
- [x] T3 — S3 — route: inline — `106ed82` agreement report and tests.
- [x] T4 — S4, S5 — route: inline — docs and full verification (this commit).

## Log

### L1 — Original request (verbatim)

> go

### L2 — Scope decision

Phase 2 of `docs/decision-evaluation.md`: local `odf_decision_review` labels at archive/verify and human/judge agreement. No new plugin capture path and no automatic gating.

### L3 — Baseline evidence (2026-10-23)

- `docs/decision-evaluation.md` lists Phase 2 as the next step: local decision review labels and human/judge agreement.
- `scripts/odf-judge.js` already exposes `compareHumanJudge`, `recordShadowJudgment`, and `appendShadowJudgment`; there is no standard agreement report yet.
- `scripts/odf-evaluation.js` already derives route agreement, risk, plan, first-pass, rework, receipts, overrides, and stage activity; it does not read human labels.
- `odf-evaluation decisions` is merged in `6e3eb94`.

### L4 — Verification evidence (2026-10-23)

- `npm run typecheck` — clean.
- `npm run test:unit` — 1305/1305 passed.
- `npm run test:yaml` — 331/331 passed.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` — all paths valid.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-evaluation.js decisions 365 --root "$PWD" --md` — `partial`, 3 changes, reviews 0/3, human rates N/A, plus the existing route/risk/plan/first-pass/rework/receipts/overrides data.
- `node scripts/odf-evaluation.js agreement --root "$PWD"` — `no_data` when no shadow-judgment file exists.
- Review CLI tests cover valid labels, invalid route/rating, path-traversal rejection, report aggregation, and agreement rates.
- The `verify-report` prerequisite is merged in PR #170 (`d3b3c93`).
