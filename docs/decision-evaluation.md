# Decision evaluation

ODF already records operational telemetry (duration, status, tokens) and a
reference corpus of golden trajectories. This report adds a **decision-quality**
view over evidence that is already on disk. It is a calibration tool, never a
gate: it does not block, approve, or change workflow state.

## Run

```bash
node scripts/odf-evaluation.js decisions [days] [--root <dir>] [--md]
```

- `days` (default 30) limits the metrics window.
- `--root` points at the Odoo project root; the default is the current directory.
- `--md` prints Markdown instead of JSON.

The command reads:

- `openspec/changes/*/state.yaml` (canonical state, route, completed stages,
  `entry_route_binding`).
- `.odf/policy-gate-{change}.json` (risk tier, gate stage, changed lines).
- `.odf/receipt-{change}.json` (failure disposition).
- `.odf/attempt-ledger-{change}.jsonl` (attempts, failures, rework).
- `.odf/override-{change}.jsonl` (audited overrides).
- The plugin metrics JSONL (`delegations-YYYY-MM-DD.jsonl`).

Engram-only changes are not read; the report warns and excludes them. It never
reads prompts, diffs, source contents, credentials, or absolute paths.

## What it measures

| Field | Definition |
|---|---|
| `route_agreement` | `entry_route_binding.predicted_route === work_type`; `null` when the binding is missing. |
| `risk_tier` | Persisted Policy Gate `risk_tier` (`LOW`, `MEDIUM`, `HIGH`); `null` when no gate exists. |
| `plan_mode` | Route `plan` (`none`, `inline`, `required`). |
| `first_pass` | No failed attempt-ledger record and no receipt for the change. |
| `rework_count` | Failed attempt-ledger records. |
| `receipts` | Persisted failure dispositions (stage, role, status, cause, action). |
| `override_count` | Audited override records. |
| `stage_activity` | Calls, ok/blocked/error counts, total and average duration per stage role. |
| `archived` | State `canonical_stage === "ARCHIVED"`. |

Aggregate output includes route agreement, risk-tier and plan-mode
distributions, first-pass yield, rework rate, receipts by cause/status, override
count, archive rate, and stage activity. Missing evidence is `null`/`N/A` or a
warning; an empty workspace is `no_data`. The report never invents a value.

## Ground truth and limits

A decision is not "correct" because the harness says so. The report combines:

1. **Objective outcomes**: first-pass, rework, receipts, overrides, archive,
   duration.
2. **Human labels** (Phase 2): a local decision review at archive/verify.
3. **Reference trajectories**: golden cases that protect a known defect.
4. **Semantic shadow** (optional): human/judge agreement and false-pass rate.

Current limits:

- It does not capture new decision records; it derives the report from existing
  evidence. Phase 2 adds the local decision review labels.
- It cannot see post-merge defects or incidents; those require a manual label.
- Route agreement requires a persisted `entry_route_binding`.
- Engram-only changes are out of scope for this report.
- `verify-report` is the VERIFY completion artifact; `verify` remains an alias
  for references but does not complete the stage.

## Guardrails

- Local-only by default; no prompts, free text, diffs, secrets, or absolute
  paths in the output.
- `no_data`/`N/A` honesty: never synthesize a score or a verdict.
- Calibration only: no automatic gating, promotion, or route change. A human
  decides whether a metric becomes a gate.
- The existing `/odf-feedback` remote submission remains opt-in, aggregate, and
  separate from this report.

## Phase 2/3 extensions

- Local `odf_decision_review` at archive/verify: route correct, risk adequate,
  plan adequate, gate correct, overall rating; no free text.
- Human/judge agreement and false-pass rate as a calibration report.
- Period comparison (`before`/`after`) and a periodic review cadence.
- Human-approved learning proposals (`odf-learning-bridge`) fed by the report.
