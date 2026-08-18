# Learning Loop Contract (T12)

Converts verified runs into reviewable memory and skill candidates, gated by
golden regression and mandatory human approval. The pipeline is pure — it does
not write to Engram or create skills; the caller owns the real writer
(adapter split, same as `odf-judge`).

## Admission — verified runs only

A run is admitted ONLY when it has every credential:

- `candidate_digest` — 64-hex string
- valid `receipt_ref`/`receipt` — successful status with a digest coherent with
  the run
- `expectations` approved — non-empty, every expectation `approved: true`
- `outcome` known — `pass` | `fail` | `verified`

Any missing credential → the run is rejected (`isVerifiedRun` returns `false`,
fail-closed, never a partial admit). Empty or fully-unverified input yields
`data_status: "no_data"` with `N/A` (T8 consistency).

## Difficulty signal

`tool_call_count >= threshold` (default 5) is a **signal, not proof**. A
difficult run proposes a skill only if it is ALSO verified AND its outcome is a
verified success (`pass`/`verified`). A difficult-but-unverified run, or an
easy verified run, proposes nothing.

## Golden regression before presentation

Every candidate runs against the golden corpus (`golden-trajectories.json`)
before it is presented. A candidate that **contradicts a golden** — it
explicitly references a guarded-defect golden (outcome `fail`) while claiming
success — is marked `failed` and is NOT presented. Golden regression is the
second gate after verification; difficulty alone never promotes a candidate.

## Human approval — mandatory

`approveCandidates` activates ONLY the ids in `approved_ids` (marked
`approved: true, approved_by: "human"`). Everything else stays `proposed` and
never activates. There is NO auto-activation.

## Rollback preserves evidence

`rollbackCandidate` only adds `rolled_back: true` + `rolled_back_at` and
references the original `source_runs`/`evidence_refs`. It never rewrites the
source evidence.

## Metrics (KPI)

The pipeline reports `{ accepted, regressions_avoided, rolled_back, pending }`:

- `accepted` — candidates human-approved and activated
- `regressions_avoided` — candidates blocked by golden regression
- `rolled_back` — candidates rolled back without rewriting evidence
- `pending` — proposed but not yet approved/rolled back

## Out of scope (parking lot)

Auto-skill activation is intentionally OUT of scope: it requires a calibrated
judge, proven goldens, and proven rollback before it can be considered. This
contract documents proposal only, never automatic activation.

## Module

- `scripts/odf-learning.js` — pure pipeline (no Engram, no skill writes)
- `scripts/odf-learning.d.ts` — types
- `scripts/odf-learning.test.ts` — 9 Vitest cases
- CLI: `node scripts/odf-learning.js <runs.json>` (honors `ODF_GOLDENS`)
