---
description: "Run QA activities for an ODF change. Usage: /odf-qa <change-name> [--plan|--review|--coverage|--report]"
---

# ODF: QA Activities

Run quality assurance activities for an active ODF change.

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
| (none) | Full QA suite | Default - runs all applicable QA |
| `--plan` | Generate test plan | After ASSESS, before DESIGN |
| `--review` | Review existing tests | After IMPLEMENT batches |
| `--coverage` | Coverage analysis | Anytime to see current coverage |
| `--report` | Final QA report | Before VERIFY |

## Orchestrator Instructions

### 1. Detect QA Phase

Based on the change's current state, determine which QA activity to run:

```
State: ASSESS complete, no qa-plan
  → Run QA-PLAN (generate test plan)

State: DESIGN complete, IMPLEMENT in progress
  → Run QA-REVIEW (review tests from last batch)

State: All IMPLEMENT batches done
  → Run QA-AGGREGATE + QA-REPORT (final QA before VERIFY)

State: VERIFY complete
  → Run QA-REPORT (compile final QA metrics)
```

### 2. Check Project Config

```
mem_search("odf-init/{project}") → project config
Use for:
  - Test command template
  - Coverage tool configuration
  - Odoo version
```

### 3. Launch QA Activity

Based on activity type:

**QA-PLAN** (after ASSESS):
```
Read: /home/adruban/.config/opencode/skills/odf-qa/SKILL.md
Launch: odoo_qa_engineer via Task tool
Input: assess artifact + user requirement
Output: qa-plan.md artifact
Gate: Show test plan, ask "Approve test plan?"
```

**QA-REVIEW** (during IMPLEMENT):
```
Read: /home/adruban/.config/opencode/skills/odf-qa/SKILL.md
Launch: odoo_qa_engineer via Task tool
Input: tests written in last batch
Output: qa-review.md artifact
No gate - show review summary only
```

**QA-AGGREGATE** (before VERIFY):
```
Read: /home/adruban/.config/opencode/skills/odf-qa/SKILL.md
Launch: odoo_qa_engineer via Task tool
Input: all implement-progress artifacts
Output: qa-aggregate.md artifact
Gate: Must pass coverage threshold to continue
```

**QA-REPORT** (after VERIFY):
```
Read: /home/adruban/.config/opencode/skills/odf-qa/SKILL.md
Launch: odoo_qa_engineer via Task tool
Input: all artifacts (assess, design, implement, verify)
Output: qa-report.md artifact
No gate - compile final metrics
```

### 4. Persist QA Artifacts

```
QA-PLAN:  mem_save("odf/{change}/qa-plan")
QA-REVIEW: mem_save("odf/{change}/qa-review")
QA-AGGREGATE: mem_save("odf/{change}/qa-aggregate")
QA-REPORT: mem_save("odf/{change}/qa-report")
```

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
