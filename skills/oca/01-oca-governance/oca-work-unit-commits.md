---
name: oca-work-unit-commits
description: "Plan commits as reviewable work units using OCA format. Trigger: implementation, commit splitting, keeping tests/docs with code, OCA commit compliance."
license: Apache-2.0
metadata:
  author: adruban
  version: "1.0"
---

## When to Use

Load this skill when deciding what belongs in each commit or PR for an OCA project. Replaces conventional-commits in Odoo/OCA repositories. Use for: splitting features into reviewable work, preparing commits before PR, keeping reviewer cognitive load healthy.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| OCA format | `[TAG] module_name: short desc (≤50 chars)` — tags: FIX, ADD, IMP, REF, REM, MIG, MOV, DOC, TEST, SEC, PERF |
| Imperative mood | "Fix" not "Fixed" — "Add" not "Added" |
| One work unit per commit | A commit represents one deliverable behavior, fix, migration, or docs unit |
| Tests with code | Tests belong in the same commit as the behavior they verify |
| Docs with the change | Docs belong with the feature or workflow they explain |
| Body explains WHY | Body describes the problem being solved, not what the diff shows (max 80 chars/line) |
| Close issues | `Closes #123` or `Fixes #456` in the body |
| No Co-Authored-By | Never add AI attribution trailers |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Single logical change | One commit with one OCA tag |
| Multiple modules affected | Either split into separate commits per module, or use `[IMP] mod1, mod2: description` |
| Change >400 lines | Split into work units, consider chained PRs |
| Fix + refactor in same change | Two separate commits: one [FIX], one [REF] |
| SDD task already defined | Each work unit = one commit per deliverable behavior |

## Execution Steps

1. **Identify work units**: Group changes by deliverable behavior (not by file type)
2. **Format each commit**: `[TAG] module_name: description (≤50 chars)` + body explaining WHY
3. **Verify**: Each commit stands alone (repo makes sense after this commit only), tests/docs included, rollback is reasonable
4. **Reference issues**: Add `Closes #N` in the body

## Output Contract

Return commit message(s) ready to paste. Each message follows OCA format with [TAG], imperative mood, ≤50 char subject, body explaining WHY (≤80 chars/line), and issue references.

## References

- `/home/adruban/.config/opencode/skills/oca/01-oca-governance/oca-commit-messages.md` — Full OCA commit reference
