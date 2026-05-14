---
description: "Run verification on current ODF change. Usage: /odf-verify [change-name]"
---

# ODF: Verify Implementation

Run the quality gate: pre-commit, tests, OCA compliance, spec compliance matrix.

## Parse Arguments

```
/odf-verify              — Verify the most recent active change
/odf-verify sale-discount — Verify a specific change by name
```

## Orchestrator Instructions

1. **Recover state** from Engram
2. **Verify IMPLEMENT has progress** — if no tasks completed, warn
3. **Load all artifacts**: assess (for requirements), design (for decisions), implement-progress
4. **Launch VERIFY phase**: Read `/home/adruban/.config/opencode/skills/odf-verify/SKILL.md`
5. **Delegate to a general sub-agent** that executes:
   a. `pre-commit run -a` (OCA linting + formatting)
   b. `pylint --load-plugins=pylint_odoo` (Odoo-specific lint)
   c. `odoo-bin --test-enable -i {module} --stop-after-init` (unit tests)
   d. OCA manifest compliance check
   e. Security validation (ir.model.access.csv completeness)
   f. Spec compliance matrix (requirements vs test results)
6. **Show verdict**: PASS / PASS WITH WARNINGS / FAIL
7. **If FAIL**: list issues by severity, suggest `/odf-apply` to fix
8. **If PASS**: persist verify-report to Engram, update state

## Output

```
ODF: Verifying "{change-name}"

  -- Build & Lint --
  pre-commit: Passed (3 auto-fixed)
  pylint-odoo: No issues

  -- Tests --
  odoo-bin --test-enable: 12 passed, 0 failed

  -- OCA Compliance --
  Manifest: version, license, author OK
  Security: ir.model.access.csv present
  Imports: Correct order

  -- Spec Compliance --
  | Requirement | Status |
  |-------------|--------|
  | REQ-01: Discount per category | COMPLIANT |
  | REQ-02: Manager-only config | COMPLIANT |
  | REQ-03: Negative discount blocked | PARTIAL |

  Verdict: PASS WITH WARNINGS
  Warnings: 1 scenario partially covered
```
