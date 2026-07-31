---
name: odf-tdd
description: "Strict TDD mode for ODF: tests before code. Two-source kill switch (global + local), any off wins, fail-closed. Trigger: /odf-tdd on, effective TDD mode active, or when strict TDD enforcement is needed."
license: MIT
metadata:
  author: antoniodavid
  version: "2.0"
---

## When to Use

Active when the EFFECTIVE TDD mode is ON. Effective mode = two-source kill switch: global `flags.strict_tdd` (registry) AND the absence of local marker `<worktree>/.odf/tdd.off`. ANY source off → effective OFF; unreadable local source → fail-closed OFF (never ON). Enforces test-first development across all ODF phases. Each feature MUST have a failing test before implementation begins.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Resolve effective mode first | Effective = global AND local. Any off wins; unreadable local → OFF. Never assume ON |
| Test before code | Write failing test FIRST, THEN implement to make it pass (red-green-refactor) |
| Every REQ-XX needs a test | No implementation task without a corresponding test task |
| Tests stay with code | Test file belongs in same commit as the behavior it verifies |
| VERIFY fails if untested | If code exists without test for a REQ-XX, status: failed |
| Opt-in only | Global via `/odf-tdd on`; repo-local OFF-only via `/odf-tdd local off`. A repo cannot force TDD on |
| Re-activation re-validates | Re-enabling TDD re-validates state from zero — does NOT inherit "was off, still no mandatory tests" |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Effective ON AND no test for REQ-XX | Block IMPLEMENT, require test task first |
| Effective ON, test written, test passes before code | Accept (red skipped — test must fail first) |
| Effective OFF (any source off, or local unreadable) | Standard behavior: tests can come after code |
| User runs /odf-tdd on | Set global flag in registry; effective mode still gated by local source |
| User runs /odf-tdd local off | Create `<worktree>/.odf/tdd.off` → effective OFF for that repo |

## Execution Steps

1. **RESOLVE effective mode BEFORE each IMPLEMENT/VERIFY phase**: read global `flags.strict_tdd` from `~/.config/opencode/odf-registry.json` AND check for `<worktree>/.odf/tdd.off` (worktree root via `git rev-parse --show-toplevel`). Any off (or unreadable local) → effective OFF. This effective mode is what applies — the preflight `tdd_mode` is only the declared default.
2. **ASSESS**: Include "testable" as requirement criterion. Each REQ-XX must have a testable scenario.
3. **DESIGN**: Every implementation task must have a paired test task. Task IDs: `T-N` for test, `I-N` for implementation.
4. **IMPLEMENT**: For each pair: write test (T-N) → confirm it fails → implement (I-N) → confirm test passes.
5. **VERIFY**: Check that every REQ-XX has a PASSING test. If code exists without test → FAIL.

## Output Contract

When enforcing: return `status: blocked` with `reason: "Strict TDD: REQ-XX has no test. Write test before implementing."` and `tdd_effective: on`.
When not enforcing (any source off): include `tdd_effective: off`.
When passing: include `tdd: compliant` in the result.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
