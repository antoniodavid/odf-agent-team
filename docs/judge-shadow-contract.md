# Judge Shadow Contract (T10)

The **judge shadow** measures the semantic correctness of a candidate (its
`candidate_digest`) against the **approved human Expectations** (`EXP-XX`) and
the technical plan (`REQ-XX`), WITHOUT assuming delivery authority. It is a
calibration sensor, not a gate.

## What shadow means

- The judge runs **in parallel** and its result is **recorded** (JSONL); it
  never alters workflow state (does not touch `commitWorkflowTransition` nor VERIFY).
- An `unavailable` judgment is NOT a judgment: it is honesty about missing data
  (consistent with T7/T8 — no verdict is synthesized without a provider).

## Schema version

`JUDGE_SCHEMA_VERSION = 1`. Every output carries `schema_version`. Any
contract change (rubric, shape, telemetry) increments the version.

## Rubric

`defaultJudgeRubric()` returns versioned (JSON-serializable) criteria:

| id | weight | what it evaluates |
|----|--------|-------------------|
| `correctness_vs_expectations` | 0.60 | The candidate satisfies the `EXP-XX` it claims to cover, with evidence verifiable per EXP. |
| `regression_risk` | 0.25 | Risk of breaking existing behavior / invariants / the trace. |
| `evidence_quality` | 0.15 | Evidence complete, reproducible and tied to the digest. |

Policy: `pass` only with correctness satisfied + acceptable risk + adequate
evidence; otherwise `fail`. Never fabricate a verdict without a provider.

## Binding

Each judgment is bound to traceable identity via `bound_to`:

```json
{ "expectation_ids": ["EXP-01", "EXP-02"], "candidate_digest": "…", "trace_ref": "…" }
```

## Metrics

`compareHumanJudge({ human, judge })` returns:

| field | definition |
|-------|------------|
| `agreement` | `true` if both pass/fail and match; `false` if they differ; `null` if judge `unavailable`. |
| `false_pass` | human `fail` and judge `pass`. |
| `false_block` | human `pass` and judge `fail`. |
| `unavailable` | judge `unavailable` (no opinion). |
| `cost` | telemetry absent → `null` (T7); a real provider would populate it. |

Cumulative aggregation: `agreement rate` and `false_pass rate` over compared
judgments; `unavailable rate` separate. Roadmap KPI: **measured human/judge
agreement and false-pass rate; no gate impact.**

## Shadow NEVER blocks

- The judge shadow is **read-only**: it records, it does not gate.
- `judge: "fail"` in shadow stops nothing; it feeds calibration.
- The deterministic verifiers (`evaluateGoldens`/`evaluateOffline`) and human
  VERIFY (`odoo_qa_engineer`) remain the only gate.

## Promotion to blocking role (activator)

Promoting the judge to **any role that blocks delivery** is an explicit
**human decision** backed by **measured calibration**:

1. Human/judge agreement threshold and false-pass ceiling agreed with the
   operator (e.g. `agreement >= 0.9` and `false_pass <= 0.02` over N samples).
2. Low `unavailable` rate (a judge that does not opine cannot gate).
3. Operator review over a sample of discrepancies.
4. Decision recorded by a human (never by the judge itself) before activating
   any gate.

Without that decision, the judge stays in shadow. The repo does not promote
to gate.

## Provider extension point

`evaluateShadow` reads `ODF_JUDGE_MODEL` (and optionally `ODF_JUDGE_PROVIDER`)
to populate `judge_version.model/provider`. Without `ODF_JUDGE_MODEL` it
returns `verdict: "unavailable"`, `verdict_label: "N/A"`,
`data_status: "no_data"`.

An operator wires a real provider by replacing the body of `runJudge` (in
`scripts/odf-judge.js`) with a call to their configured LLM, returning
`{ verdict, verdict_label, rationale }`. The adapter preserves the contract:
schema, rubric, binding and telemetry.
