---
name: odf-tdd
description: "Strict TDD mode for ODF: tests before code. Trigger: /odf-tdd on, strict_tdd flag active, or when strict TDD enforcement is needed."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

## When to Use

Active when `strict_tdd: true` (set via `/odf-tdd on`). Enforces test-first development across all ODF phases. Each feature MUST have a failing test before implementation begins.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Test before code | Write failing test FIRST, THEN implement to make it pass (red-green-refactor) |
| Every REQ-XX needs a test | No implementation task without a corresponding test task |
| Tests stay with code | Test file belongs in same commit as the behavior it verifies |
| VERIFY fails if untested | If code exists without test for a REQ-XX, status: failed |
| Opt-in only | `/odf-tdd on` to enable, `/odf-tdd off` to disable |

## Decision Gates

| Condition | Action |
|-----------|--------|
| strict_tdd=true AND no test for REQ-XX | Block IMPLEMENT, require test task first |
| strict_tdd=true, test written, test passes before code | Accept (red skipped — test must fail first) |
| strict_tdd=false | Standard behavior: tests can come after code |
| User runs /odf-tdd on | Set flag in registry, enable enforcement |

## Execution Steps

1. **ASSESS**: Include "testable" as requirement criterion. Each REQ-XX must have a testable scenario.
2. **DESIGN**: Every implementation task must have a paired test task. Task IDs: `T-N` for test, `I-N` for implementation.
3. **IMPLEMENT**: For each pair: write test (T-N) → confirm it fails → implement (I-N) → confirm test passes.
4. **VERIFY**: Check that every REQ-XX has a PASSING test. If code exists without test → FAIL.

## Output Contract

When enforcing: return `status: blocked` with `reason: "Strict TDD: REQ-XX has no test. Write test before implementing."`
When passing: include `tdd: compliant` in the result.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
