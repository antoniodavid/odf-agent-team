---
description: "Run verification on current ODF change. Usage: /odf-verify [change-name]"
---

# ODF: Verify Implementation

Run the quality gate: pre-commit, tests, OCA compliance, spec compliance matrix, and tier-appropriate lens review.

## Parse Arguments

```
/odf-verify              — Verify the most recent active change
/odf-verify sale-discount — Verify a specific change by name
```

## Orchestrator Instructions

1. **Recover state** from the selected artifact store (OpenSpec `state.yaml`, Engram `odf/{change}/state`, or both in hybrid mode)
2. **Verify IMPLEMENT has progress** — if no tasks completed, warn
3. **Load all artifacts**: assess (for requirements), design (for decisions), implement-progress
4. **Freeze the candidate diff**: record the base tree/reference and `original_changed_lines`; compute the correction budget (`min(200, ceil(original_changed_lines / 2))` lines)
5. **Classify risk tier** from the frozen diff (Risk Tier Classification in the skill) and delegate by tier:
   - **HIGH** → 4 lenses: risk, resilience, readability, reliability (Judgment Day 3-pass; attacker perspective covered by the risk lens)
   - **MEDIUM** → 1 lens, single focus (default readability)
   - **LOW** → 0 lenses: silent structural readback + native tool verification (pre-commit/lint if applicable). Launch NO reviewers
   - All tiers still run: pre-commit, pylint-odoo, odoo tests, spec compliance matrix
6. **Show verdict**: PASS / PASS WITH WARNINGS / FAIL
7. **If FAIL**: list issues by severity. Enter the correction budget — max `min(200, ceil(original_changed_lines / 2))` lines, ONE attempt:
   a. Delegate ONE correction attempt to IMPLEMENT, bounded by the frozen budget
   b. Re-verify ONCE against the SAME frozen diff (`frozen_diff_ref`)
   c. Re-verification passed → proceed to step 8
   d. Re-verification inconclusive (validator could not inspect the frozen diff: tooling failure, corrupted context, network) → does NOT consume the attempt; retry without penalty
   e. Re-verification inspected the bytes and returned FAILED → STOP. Escalate to the user with ONE actionable question (scope change / re-plan / abandon) and evidence of what failed. NEVER auto-loop
8. **If PASS** (or PASS WITH WARNINGS): persist verify-report with `frozen_diff_ref` to the selected store and update runtime state

## Output

```
ODF: Verifying "{change-name}"

  -- Risk Tier --
  Tier: MEDIUM (1 lens: readability)

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
  Correction budget: min(200, ceil(X/2)) = Y lines, 0/1 attempts used
```
