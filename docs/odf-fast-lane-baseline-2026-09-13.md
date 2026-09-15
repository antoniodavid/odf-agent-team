# ODF Fast-Lane Baseline — 2026-09-13

## Cohort and window

- **Window:** 2026-08-31 through 2026-09-13 UTC, using `metrics --days 14`.
- **Cohort:** 95 completed, non-span task calls from the configured daily JSONL telemetry.
- **Raw telemetry lines:** 320. This backward-compatible count includes lifecycle markers and spans; it is not the baseline sample size.
- **Duration meaning:** recorded phase/task `duration_ms`, not entry-to-final-gate time. Percentiles use the sorted completed-call durations with linear interpolation.
- **Odoo version/project:** not available in the current sanitized telemetry.

## Overall baseline

| Sample | p50 | p95 | Average |
|---:|---:|---:|---:|
| 95 | 148,073 ms | 900,134 ms | 287,339 ms |

### Outcomes

| Outcome | Count | Rate |
|---|---:|---:|
| ok | 26 | 27.4% |
| blocked | 39 | 41.1% |
| error | 9 | 9.5% |
| timeout | 21 | 22.1% |

## Phase latency

| Phase | Samples | p50 | p95 |
|---|---:|---:|---:|
| ASSESS | 12 | 315,640 ms | 735,366 ms |
| DESIGN | 12 | 542,997 ms | 735,064 ms |
| EXPLORE | 1 | 13,819 ms | 13,819 ms |
| FIX | 23 | 10,289 ms | 1,466,558 ms |
| IMPLEMENT | 35 | 242,673 ms | 690,789 ms |
| PROPOSE | 5 | 83,371 ms | 175,124 ms |
| QA-PLAN | 7 | 240,284 ms | 600,373 ms |

`FIX` is a canonical phase label, not proof of an end-to-end `/odf-fix` run.

## Dimension coverage

- **Work type:** 32/95 reported (33.7%): `feature` 30 and `small-change` 2; 63 calls are unknown.
- **Model availability:** the availability flag is present for 95/95 calls; 0 report an available model and 95 report unavailable. Model identity and profile are not available.
- **Validation:** 0/95 completed task calls report validation evidence. There are no scheduler-join records in this cohort, so no validation ratio is available there either.
- **Receipts:** 0/95 completed task calls report a receipt reference. Receipt-producing failures cannot be measured from this cohort.
- **Escalation:** the current telemetry schema has no escalation dimension. The baseline reports this as unavailable; blocked, error, and timeout outcomes are not treated as escalations.

## End-to-end measurement gap

The current telemetry cannot prove `/odf-new` or `/odf-fix` entry-to-final-verified-gate latency. It has phase/task durations and sanitized change/run identifiers, but no bounded entry event, command-entry discriminator, or final verified-gate completion marker that can establish those cohorts. Therefore both end-to-end p50 and p95 are **N/A**, and this report makes no `/odf-new` or `/odf-fix` latency claim.

The baseline command remains:

```text
node scripts/odf-toolkit.js metrics --days 14 --json
```

The JSON output preserves the existing `records` and `by_phase` fields and adds a `baseline` object. The baseline excludes started markers, spans, and scheduler joins from completed task-call samples. No raw prompts, paths, database names, secrets, usernames, or PII are included.
