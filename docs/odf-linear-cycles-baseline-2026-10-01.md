# ODF linear-cycles baseline — 2026-10-01

## Purpose

Record the available runtime evidence before changing ODF route execution, as
required by [issue #95](https://github.com/antoniodavid/odf-agent-team/issues/95).
This is a partial baseline, not an end-to-end workflow latency measurement.

## Snapshot

- Captured: 2026-10-01 UTC.
- Window: 14 UTC date buckets, 2026-09-18 through 2026-10-01 inclusive.
- Source: the installed ODF metrics directory, read in place with
  `ODF_CONFIG_DIR=~/.config/opencode`; no raw telemetry was copied into this
  repository.
- Command: `node scripts/odf-toolkit.js metrics --days 14 --json`.
- Raw records: 475. The dashboard's aggregate delegation cohort contains 142
  samples after its lifecycle/span/join filtering and run de-duplication.

## Delegation-duration baseline

Durations are for individual delegated phase calls, not user-visible workflow
wall-clock time.

| Cohort | Samples | p50 | p95 |
|---|---:|---:|---:|
| All eligible phase calls | 142 | 250,784 ms (4m 11s) | 900,174 ms (15m 00s) |

| Phase | Samples | p50 | p95 |
|---|---:|---:|---:|
| ASSESS | 8 | 417,083 ms | 900,280 ms |
| DESIGN | 24 | 428,303 ms | 900,815 ms |
| EXPLORE | 2 | 554,083 ms | 595,483 ms |
| FIX | 9 | 402,346 ms | 665,154 ms |
| IMPLEMENT | 57 | 147,325 ms | 600,364 ms |
| PROPOSE | 9 | 14,695 ms | 211,933 ms |
| QA-PLAN | 13 | 269,238 ms | 883,214 ms |
| VERIFY | 20 | 204,738 ms | 749,402 ms |

Outcome distribution for the 142-sample cohort:

| Outcome | Count | Share |
|---|---:|---:|
| `ok` | 43 | 30.3% |
| `blocked` | 60 | 42.3% |
| `error` | 15 | 10.6% |
| `timeout` | 24 | 16.9% |

## Coverage and limits

- `work_type` is present for 77/142 samples (54.2%): 8 `small-change`, 69
  `feature`; 65 are unknown. This is not enough to compare route-specific
  outcomes confidently.
- A usable model identity is unavailable for all 142 samples.
- Validation-evidence, receipt, and escalation fields are unreported for all
  142 samples.
- `entry_to_final_gate` has **0 samples** and is reported as unavailable. The
  dataset does not establish request-to-VERIFY wall-clock time, user turns, or
  orchestration handoffs.
- The historical workflow review found qualitative friction around repeated
  status/proof reconstruction during continuation and archive-state recovery
  after concurrent activity. Those observations are not timed and are not
  included as numeric samples here.

Therefore these figures establish phase-call latency only. They do **not**
support a claim that a runtime route change improves whole-workflow latency by
50%, nor do they justify enabling the advisory triage binding as auto-routing.

## Measurement gate before runtime routing changes

1. Capture a cohort linking entry, route/work type, phase calls, and verified
   final gate to the same change/run identity; include outcomes and handoff/turn
   counts without recording prompt or customer content.
2. Verify that the cohort has usable `entry_to_final_gate` samples and adequate
   `work_type` coverage before comparing routes.
3. Keep the existing advisory binding advisory until its execution consumer and
   persisted authorization contract have dedicated tests. Preserve the
   mandatory BUILD/VERIFY evidence, security, OCA, TDD, receipt, and storage
   compatibility gates.

Re-run the same command after a low-risk rollout and compare equivalent cohorts;
do not interpret missing data as zero latency or a successful workflow.
