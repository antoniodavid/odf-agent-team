---
name: odf-qa
description: "QA workflow for ODF: test planning, coverage analysis, test review, quality gates. Trigger: /odf-qa or orchestrator needs QA in any phase."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## When to Use

Use for test strategy planning (after ASSESS), test review (during IMPLEMENT), coverage aggregation (before VERIFY), or final QA reporting (after VERIFY).

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Run actual coverage | Use coverage tools — don't estimate coverage percentages |
| Trace to requirements | Every test must map to a REQ-XX from the assess artifact |
| Flag untested paths | Identify critical paths without test coverage — don't ignore them |
| Check isolation | Tests MUST use TransactionCase — no shared state between tests |

## Decision Gates

| Phase | Input | Output |
|-------|-------|--------|
| QA-PLAN | Assess artifact | Test scenarios (unit/integration/E2E) + coverage targets + fixture design |
| QA-REVIEW | Test files from IMPLEMENT | Test quality report (isolation, assertions, coverage delta) |
| QA-AGGREGATE | All batch results | Aggregate coverage report + requirements traceability |
| QA-REPORT | All QA artifacts | Final QA metrics + quality gate status + verdict |

## Execution Steps

1. **QA-PLAN**: Parse REQ-XX from assess → design test scenarios → set coverage targets per module type → persist as qa-plan
2. **QA-REVIEW**: Review test quality (isolation, meaningful assertions, coverage toward targets) → flag issues → persist as qa-review
3. **QA-AGGREGATE**: Collect all batch test results → generate aggregate coverage → map to requirements → identify untested paths → persist as qa-aggregate
4. **QA-REPORT**: Compile final metrics → build requirements traceability matrix → evaluate quality gates → persist as qa-report

## Output Contract

Return ODF Result envelope with: status (ok|warning|blocked|failed), executive_summary ("{N} tests, {X}% coverage, {Y}/{Z} requirements covered"), artifacts_saved (qa-plan, qa-review, qa-aggregate, qa-report), next_recommended (["implement"] or ["verify"]), risks, odoo_version, modules_affected.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
