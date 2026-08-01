---
name: odf-verify
description: "Quality gate for ODF: evidence-based risk tiers (0/1/4 lenses), spec compliance matrix, single-attempt correction budget. Trigger: Phase 4 (VERIFY) of /odf-new."
license: MIT
metadata:
  author: adruban
  version: "3.0"
---

## When to Use

Use as the final phase of /odf-new after IMPLEMENT is complete. Run real tests and linting — static analysis alone is NOT verification. Review effort scales with the RISK TIER of the frozen diff, never with diff size.

## Risk Tier Classification

The tier is decided by the EVIDENCE in the frozen diff, NEVER by the number of lines. A 300-line rename is LOW; 2 lines in `ir.model.access.csv` are HIGH.

| Tier | Evidence signals (any match → that tier) | Lenses |
|------|------------------------------------------|--------|
| **HIGH** | `ir.model.access.csv`, record rules, `groups=` assignments, permission changes, security inheritance, `compute`/`related` fields that WRITE, security onchange, raw SQL (`env.cr.execute` with interpolation), payments/money, data loss (`unlink`/archive), `subprocess`/`os.system`, public endpoints | **4 lenses**: risk, resilience, readability, reliability |
| **MEDIUM** | Everything not explicitly HIGH or LOW | **1 lens** (focus configurable, default readability) |
| **LOW** | Passive byte-proven: XML view/form/tree/action/menu, manifest metadata, renames/moves, docs | **0 lenses**: structural readback + native tool verification |

## Lens Selection Policy

| Tier | Lenses | Mechanism |
|------|--------|-----------|
| HIGH | 4 (risk, resilience, readability, reliability) | Judgment Day 3-pass review (reviewer → maintainer → attacker). The risk lens covers the attacker perspective |
| MEDIUM | 1 (focus configurable, default readability) | Single focused review pass |
| LOW | 0 | Structural readback (file exists, parses, breaks nothing) + native tool verification (pre-commit/lint if applicable). Launch NO reviewers |

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Classify first | Classify the tier from the frozen diff BEFORE any verification work |
| Execute tests | Run the real module test suite — static analysis and manual browser checks are not substitutes |
| Compare against specs | Every REQ-XX from assess must have a PASSING test |
| Judgment Day | HIGH tier ONLY: 3 review passes (reviewer, maintainer, attacker). NEVER run for LOW/MEDIUM |
| Never fix issues | Only report them — the orchestrator decides what to do |
| Test evidence | Record the exact command, explicit isolated database, exit code, and output evidence; a command without `-d {test_db}` is invalid |
| Deferred tests | Skipped, deferred, unavailable, or unrecorded tests yield `blocked` with `verification-deferred`; they never yield PASS or PASS WITH WARNINGS |

## Decision Gates

| Condition | Verdict |
|-----------|---------|
| Required module test command ran with explicit database, exit code 0, output evidence, all specs covered, no CRITICAL issues | PASS |
| Required module test command ran and passed, and only non-blocking warnings exist | PASS WITH WARNINGS |
| Any test fails or a spec is UNTESTED | FAIL |
| Tests skipped, deferred, unavailable, or missing the required result record | BLOCKED (`verification-deferred`) |

## Execution Steps

1. **Retrieve artifacts**: assess (specs), design (tasks), implement-progress (what was built) from Engram
2. **Freeze the candidate diff**: record the base tree/reference and count `original_changed_lines`
3. **Classify risk tier** from the frozen diff (Risk Tier Classification table)
4. **Check completeness**: Count total vs completed tasks. Flag CRITICAL if core tasks incomplete
5. **Check OCA compliance**: Manifest (version, license, author, depends), security (ir.model.access.csv), code quality (imports, SQL injection, translations), tests
6. **Run pre-commit**: `pre-commit run -a`. Flag CRITICAL on non-auto-fixable failures
7. **Run tests**: Use the project's `testing.test_command` from `odf-init/{project}` with `{module}` substituted. The persisted Docker template is `docker compose run --rm odoo odoo -d {test_db} -i {module} --test-enable --stop-after-init`; the local template is `odoo-bin -d {test_db} -i {module} --test-enable --stop-after-init`. Read the project config first — never guess a runner or database. If no disposable `{test_db}` can be detected, return `blocked` with `verification-deferred` and ask the user. Never run or document `dropdb`, `DROP DATABASE`, `TRUNCATE`, or destructive re-initialization as automatic setup.
   - Save a test result record containing `command`, `database` (the explicit `{test_db}`), `exit_code`, and `output_evidence`. A manual browser check is supplementary and cannot replace the module test suite.
8. **Run pylint-odoo**: `pylint --load-plugins=pylint_odoo -d all -e odoolint {module}`
9. **Build spec compliance matrix**: Cross-reference EVERY REQ-XX scenario against test results. COMPLIANT = test exists AND passed. UNTESTED = CRITICAL
10. **Review by tier**:
    - **HIGH** → 4 lenses: risk, resilience, readability, reliability via Judgment Day 3-pass (reviewer → maintainer → attacker); the risk lens covers the attacker perspective
    - **MEDIUM** → 1 focused lens (default readability, focus configurable)
    - **LOW** → structural readback + native tool verification only — do NOT launch reviewers
11. **Persist**: `mem_save(title: "odf/{change}/verify-report", ..., frozen_diff_ref: ...)` (see Correction Budget & Single Attempt)

## Correction Budget & Single Attempt

- Freeze the candidate diff on VERIFY entry; record the base tree/reference and `original_changed_lines`.
- **Correction budget** = `min(200, ceil(original_changed_lines / 2))` lines, frozen at that moment.
- Max **ONE correction attempt** per candidate. After the attempt, re-verify ONCE against the SAME frozen diff (`frozen_diff_ref`).
- If the single attempt fails → DO NOT re-launch. Escalate to the user with ONE actionable question (scope change / re-plan / abandon) with evidence of what failed.
- **Inconclusive validator does not consume the attempt**: if re-verification could not inspect the frozen diff (tooling failure, corrupted context, network), it does NOT count as the only attempt — retry without penalty. ONLY a re-verification that actually inspected the bytes and returned `failed` consumes the attempt.
- The verify report MUST link the frozen diff: save `frozen_diff_ref` so re-verification compares against the SAME bytes.

## Output Contract

Return ODF Result envelope with: status (ok|warning|blocked|failed), executive_summary ("PASS/FAIL/BLOCKED: X/Y specs compliant, Z critical issues"), compliance matrix (table: requirement, scenario, test, result), test_results (including command, database, exit_code, output_evidence), lint_results, review_summary, judgment_day_discrepancies (HIGH tier only), risks, modules_affected, frozen_diff_ref. Use `blocked` with `verification-deferred` when required tests are skipped, deferred, unavailable, or lack valid evidence; never report PASS or PASS WITH WARNINGS in that case.

**On FAIL**: include the failure disposition fields so the orchestrator can write the receipt — `cause` (`validation-failed`), `evidence.failing` (the commands/tests that failed), and `evidence.refs` (verify-report topic key + frozen ref). The orchestrator records them via `odf_receipt` before escalating.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
