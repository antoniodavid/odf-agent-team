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
6. **Show verdict**: PASS / PASS WITH WARNINGS / BLOCKED (`verification-deferred`) / FAIL. Skipped, deferred, unavailable, or unrecorded tests cannot be PASS or PASS WITH WARNINGS.
7. **If FAIL**: list issues by severity. Enter the correction budget — max `min(200, ceil(original_changed_lines / 2))` lines, ONE attempt:
   a. Delegate ONE correction attempt to IMPLEMENT, bounded by the frozen budget
   b. Re-verify ONCE against the SAME frozen diff (`frozen_diff_ref`)
   c. Re-verification passed → proceed to step 8
   d. Re-verification inconclusive (validator could not inspect the frozen diff: tooling failure, corrupted context, network) → does NOT consume the attempt; retry without penalty
   e. Re-verification inspected the bytes and returned FAILED → STOP. Escalate to the user with ONE actionable question (scope change / re-plan / abandon) and evidence of what failed. NEVER auto-loop
8. **If PASS** (or PASS WITH WARNINGS): only after the real module test command ran and passed with an explicit database, exit code, and output evidence, persist verify-report with `frozen_diff_ref` to the selected store and update runtime state. A manual browser check is supplementary, never a substitute.

## Output

```
ODF: Verifying "{change-name}"

  -- Risk Tier --
  Tier: MEDIUM (1 lens: readability)

  -- Build & Lint --
  pre-commit: Passed (3 auto-fixed)
  pylint-odoo: No issues

   -- Tests --
   docker compose run --rm odoo odoo -d {test_db} -i {module} --test-enable --stop-after-init: 12 passed, 0 failed
   Database: {test_db}; exit_code: 0; output_evidence: "12 passed, 0 failed"
   (use the project's testing.test_command from odf-init/{project}; substitute {module} only)

  -- OCA Compliance --
  Manifest: version, license, author OK
  Security: ir.model.access.csv present
  Imports: Correct order

  -- Spec Compliance --
  | Expectation | Status |
  |-------------|--------|
  | EXP-01: Discount per category | COMPLIANT |
  | EXP-02: Manager-only config | COMPLIANT |
  | EXP-03: Negative discount blocked | PARTIAL |

   Verdict: PASS WITH WARNINGS
   Warnings: 1 scenario partially covered
   Correction budget: min(200, ceil(X/2)) = Y lines, 0/1 attempts used
```

Evaluate against the approved human Expectations (EXP-XX) as the primary
contract; use REQ-XX only as technical context. If no `expectations` artifact
exists (legacy change), emit an explicit `missing-expectations` warning and
fall back to REQ-XX. If expectations exist but are not approved, or an
approved statement was rewritten, block with `expectations-not-approved` /
`expectations-tampered`.

If the test command cannot run, is skipped, deferred, unavailable, lacks an
explicit `-d {test_db}`, or has no result record with command, database,
exit_code, and output evidence, return `blocked` with
`verification-deferred`. Ask for the exact disposable database instead of
guessing one. Never run or generate `dropdb`, `DROP DATABASE`, `TRUNCATE`, or
destructive re-initialization as automatic setup.

The receipt must also include `candidate_digest`, `executor`, and
`test_identity` (from the injected Policy Gate decision) or the harness
rejects it before the workflow can advance.
