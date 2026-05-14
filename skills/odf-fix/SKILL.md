---
name: odf-fix
description: "Lightweight 3-step bugfix flow: DIAGNOSE → FIX → VERIFY. Trigger: /odf-fix, bugfix request, error report, 'this is broken'."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## When to Use

Use odf-fix for targeted bugs where the problem is known and scope is small (1-3 files). Do NOT use for new features, architectural changes, or unclear scope — use /odf-new instead.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| No gates | Run DIAGNOSE → FIX → VERIFY continuously without pausing for approval |
| Root cause first | Identify root cause BEFORE modifying any code |
| Test validates fix | Include a test that fails without the fix |
| Scope bound | If diagnosis reveals >3 files affected, STOP and suggest /odf-new |
| One fix per invocation | Do not fix multiple unrelated bugs in one run |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Root cause found, fix is 1-3 files | Proceed to FIX |
| Root cause involves architecture change | Stop, recommend /odf-new |
| Fix affects security or data integrity | Add CRITICAL flag in report |
| Can't reproduce the bug | Stop, report reproduction steps attempted |

## Execution Steps

1. **DIAGNOSE**: Reproduce the bug, find root cause. Check logs, trace the error path, identify the exact file + line.
2. **FIX**: Write the fix + a test that fails without it. Follow OCA standards.
3. **VERIFY**: Run pre-commit on changed files, run module tests, confirm the fix works.

## Output Contract

Return ODF Result envelope with: status (ok|blocked|failed), executive_summary, diagnosis (root cause + file:line), fix_summary (files changed + what changed), test_evidence (command output), risks.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/persistence-contract.md` — Engram rules
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
