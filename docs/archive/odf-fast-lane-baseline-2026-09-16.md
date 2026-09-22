# ODF Fast-Lane Baseline — 2026-09-16

## Evidence status

- **Observed command:** `node scripts/odf-toolkit.js metrics --days 14 --json` on 2026-09-16 UTC.
- **Purpose:** FL-01 task-call evidence and the FL-02 cohort/rollback definition for ODF2 readiness.
- **Claim boundary:** This report measures phase/task `duration_ms`. It does not measure `/odf-new` or `/odf-fix` entry-to-final-gate latency and makes no performance claim.
- **Odoo runtime:** Odoo version, project, and a real Odoo runtime are not present in the sanitized telemetry.

## Cohort and window

- **Window:** 14-day window selected by the command.
- **Raw telemetry records:** 418. This is the raw-record count, not the baseline denominator.
- **Baseline completed task-call samples:** 133. Lifecycle markers, spans, and joins are excluded from this denominator.

## Overall task-call baseline

| Sample | p50 | p95 | Average |
|---:|---:|---:|---:|
| 133 | 123,671 ms | 600,847.6 ms | 250,187.5263 ms |

### Outcomes

| Outcome | Count |
|---|---:|
| ok | 29 |
| blocked | 67 |
| error | 12 |
| timeout | 25 |

## Phase/task duration

These are phase/task durations, not `/odf-new` or `/odf-fix` entry-to-final-gate durations.

| Phase | p50 | p95 |
|---|---:|---:|
| ASSESS | 361,301 ms | 750,361 ms |
| DESIGN | 455,890 ms | 634,302.6 ms |
| EXPLORE | 13,819 ms | 13,819 ms |
| FIX | 13,063 ms | 1,446,798.95 ms |
| IMPLEMENT | 54,034 ms | 600,533.8 ms |
| PROPOSE | 101,114.5 ms | 178,640.2 ms |
| QA-PLAN | 241,476 ms | 600,373.1 ms |

`FIX` is a phase label, not proof of an end-to-end `/odf-fix` run.

## Dimension coverage

- **Work type:** 70/133 (52.63%) reported: `small-change` 12, `feature` 52, and `bugfix` 6. The remaining 63 samples are unknown.
- **Model field:** 133/133 present, but `model_available` is 0/133. Provider/model identity is unavailable.
- **Validation evidence:** 0/133.
- **Receipts:** 0/133.
- **Escalation:** 0/133.

Coverage gaps are: `work_type`, `model_identity`, `validation_evidence`, `receipt`, `escalation`, and `entry_to_final_gate`.

## End-to-end measurement gap

`entry_to_final_gate` is unavailable: `sample_count` is 0 and p50/p95 are N/A. The telemetry therefore cannot establish complete `/odf-new` or `/odf-fix` entry-to-final-verified-gate cohorts. This report makes no end-to-end or performance claim.

## FL-02 proposed cohort and rollback definition

Comparable cohorts must contain complete `entry_started` → `verified_completed` flows with matching `work_type`, Odoo version, workspace, and source-authority dimensions when available. Lifecycle markers, spans, and joins are excluded from the denominator. No comparable cohort exists in this evidence window.

The following hold/rollback signals are **proposed** and require explicit maintainer approval before any canary:

- >10% matched-cohort p95 regression.
- Any protected or architectural risk incorrectly downgraded.
- Any candidate, evidence, or receipt binding failure.
- Missing final-gate evidence.
- Telemetry coverage below 95%.
- Any unexplained increase in errors, timeouts, or receipts.

No canary, rollout, or ODF2 execution claim is made.
