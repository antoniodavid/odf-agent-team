---
description: "Run QA lenses for an ODF change. Usage: /odf-qa <change-name> [--plan|--review|--coverage|--report]"
---

# ODF: QA (utility and lens)

QA is a workflow utility/lens, not a canonical stage of the DAG. It can
produce test intent for `PLAN`, batch review evidence for `BUILD`, or
coverage aggregation for `VERIFY`, depending on the route, risk, and work
type.

## Parse Command

```
/odf-qa <change-name>              — Run full QA suite (all activities)
/odf-qa <change-name> --plan      — Generate test plan (after ASSESS)
/odf-qa <change-name> --review     — Review tests (during/after IMPLEMENT)
/odf-qa <change-name> --coverage  — Run coverage analysis
/odf-qa <change-name> --report    — Generate final QA report
```

## Options

| Option | Description | When to Use |
|--------|-------------|-------------|
| (none) | Applicable QA lenses | Runs the QA coverage selected by route/risk/work type |
| `--plan` | Test intent | Inside `PLAN`, after `DECIDE` when applicable |
| `--review` | Test review evidence | Inside `BUILD`, per implementation batch |
| `--coverage` | Coverage aggregation | Inside `VERIFY` or as a prior read |
| `--report` | Auxiliary QA report | During or after `VERIFY`, when requested |

## Orchestrator Instructions

### 1. Detect the QA lens

Use the explicit flag if present. With no flag, consult `odf_workflow_route`, the
risk, and the work type to select only the applicable lenses. Do not create a
`QA` stage or make `QA-REVIEW` or `QA-AGGREGATE` mandatory before
`VERIFY`.

```
--plan      → PLAN: test intent; legacy artifact qa-plan
--review    → BUILD: batch review evidence; legacy artifact qa-review
--coverage  → VERIFY: coverage aggregation; legacy artifact qa-aggregate
--report    → QA report utility; legacy artifact qa-report
```

### 2. Check project configuration

```
mem_search("odf-init/{project}") → project config
Use for:
   - Test command template
   - Coverage tool configuration
   - Odoo version
```

### 3. Run the QA activity

When the activity delegates ODF work, use `odf_delegate` and its skill
resolution; do not call `task()` directly. Legacy artifact names are kept as
compatibility adapters. With strict workflow active by default, every
delegation with an `IMPLEMENT`/`VERIFY` phase must pass the transition under
`workflow_advance`, `artifact_store: openspec|engram`, and a fresh opaque
`attempt_id`; QA-REVIEW/AGGREGATE/REPORT are sub-steps within an already open
BUILD/VERIFY attempt, not fresh gated starts.

**QA-PLAN** (lens of `PLAN`; legacy name):
```
Read: ~/.config/opencode/skills/odf-qa/SKILL.md
Run: odoo_qa_engineer through odf_delegate
Input: assess artifact + user requirement
Output: qa-plan.md artifact
Role: test intent inside PLAN; approval follows the active mode
```

**QA-REVIEW** (lens of `BUILD`; legacy name):
```
Read: ~/.config/opencode/skills/odf-qa/SKILL.md
Run: odoo_qa_engineer through odf_delegate
Input: tests written in the last batch
Output: qa-review.md artifact
Role: batch evidence inside BUILD; optional depending on route/risk/work type
```

**QA-AGGREGATE** (lens of `VERIFY`; legacy name):
```
Read: ~/.config/opencode/skills/odf-qa/SKILL.md
Run: odoo_qa_engineer through odf_delegate
Input: all implement-progress artifacts
Output: qa-aggregate.md artifact
Role: coverage aggregation inside VERIFY; do not turn it into a universal gate
```

**QA-REPORT** (utility of `VERIFY`; legacy name):
```
Read: ~/.config/opencode/skills/odf-qa/SKILL.md
Run: odoo_qa_engineer through odf_delegate
Input: all artifacts (assess, design, implement, verify)
Output: qa-report.md artifact
Role: optional reporting utility; VERIFY remains the independent quality gate
```

### 4. Persist QA Artifacts

Persist each QA artifact through the **selected store** (per the persistence
contract — never hardcode `mem_save`):

```
QA-PLAN:      openspec → openspec/changes/{change}/qa-plan/plan.md | engram → odf/{change}/qa-plan
QA-REVIEW:    openspec → openspec/changes/{change}/qa-review.md   | engram → odf/{change}/qa-review
QA-AGGREGATE: openspec → openspec/changes/{change}/qa-aggregate.md| engram → odf/{change}/qa-aggregate
QA-REPORT:    openspec → openspec/changes/{change}/qa-report.md   | engram → odf/{change}/qa-report
```

Return the canonical `artifact_ref: {store, ref}` for each artifact in the ODF
Result; `engram_topic_key` is compatibility-only.

## Output Format

### QA-PLAN Output

```
ODF: Test Plan Generated

  Change: {change-name}
  Requirements: {N}
  Test Scenarios: {N}
  Coverage Target: {X}%

  Test Scenarios:
  | ID | Requirement | Test Type | Priority |
  |----|-------------|-----------|----------|
  | TS-01 | REQ-01 | Unit | High |

  Next: DESIGN — Proceed? (or review test plan)
```

### QA-REVIEW Output

```
ODF: Test Review Complete

  Change: {change-name}
  Batch: {N}
  Tests Reviewed: {N}
  Coverage: {X}%

  Issues Found:
  | File | Test | Issue | Severity |
  |------|------|-------|----------|

  Next: Continue IMPLEMENT or run VERIFY
```

### QA-COVERAGE Output

```
ODF: Coverage Analysis

  Change: {change-name}
  Current Coverage: {X}%
  Target Coverage: {Y}%
  Status: {PASS|WARN|FAIL}

  Uncovered Code Paths:
  - models/sale_order.py:45-52
  - models/sale_order.py:78-85

  Next: Add tests for uncovered paths
```

### QA-REPORT Output

```
ODF: QA Report

  Change: {change-name}
  Final Coverage: {X}%
  Tests: {N} total ({P} passed, {F} failed)

  Coverage by Module:
  | Module | Coverage | Target | Status |
  |--------|----------|--------|--------|
  | module_a | 85% | 80% | PASS |

  Requirements Traceability:
  | Requirement | Tests | Status |
  |-------------|-------|--------|
  | REQ-01 | TS-01, TS-02 | COVERED |

  Verdict: {PASS|PASS WITH WARNINGS|FAIL}
```
