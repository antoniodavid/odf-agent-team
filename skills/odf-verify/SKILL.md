---
name: odf-verify
description: "Quality gate for ODF: runs tests, linting, OCA compliance check, spec compliance matrix, Judgment Day adversarial review. Trigger: Phase 4 (VERIFY) of /odf-new."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## When to Use

Use as the final phase of /odf-new after IMPLEMENT is complete. Run real tests and linting — static analysis alone is NOT verification.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Execute tests | Run the actual test suite — static analysis is not verification |
| Compare against specs | Every REQ-XX from assess must have a PASSING test |
| Judgment Day | Perform 3 review passes: reviewer, maintainer, attacker — flag discrepancies |
| Never fix issues | Only report them — the orchestrator decides what to do |

## Decision Gates

| Condition | Verdict |
|-----------|---------|
| All tests pass, all specs covered, no CRITICAL issues | PASS |
| Tests pass but non-blocking warnings exist | PASS WITH WARNINGS |
| Any test fails or a spec is UNTESTED | FAIL |

## Execution Steps

1. **Retrieve artifacts**: assess (specs), design (tasks), implement-progress (what was built) from Engram
2. **Check completeness**: Count total vs completed tasks. Flag CRITICAL if core tasks incomplete
3. **Check OCA compliance**: Manifest (version, license, author, depends), security (ir.model.access.csv), code quality (imports, SQL injection, translations), tests
4. **Run pre-commit**: `pre-commit run -a`. Flag CRITICAL on non-auto-fixable failures
5. **Run tests**: Use project config command or odoo-bin -i {module} --test-enable
6. **Run pylint-odoo**: `pylint --load-plugins=pylint_odoo -d all -e odoolint {module}`
7. **Build spec compliance matrix**: Cross-reference EVERY REQ-XX scenario against test results. COMPLIANT = test exists AND passed. UNTESTED = CRITICAL
8. **Code review**: Check security, performance, code quality, version-specific patterns
9. **Judgment Day**: Second pass from maintainer perspective. Third pass from attacker perspective. Compare all 3 passes and flag discrepancies
10. **Persist**: `mem_save(title: "odf/{change}/verify-report", ...)`

## Output Contract

Return ODF Result envelope with: status (ok|warning|failed), executive_summary ("PASS/FAIL: X/Y specs compliant, Z critical issues"), compliance matrix (table: requirement, scenario, test, result), test_results, lint_results, review_summary, judgment_day_discrepancies, risks, modules_affected.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
