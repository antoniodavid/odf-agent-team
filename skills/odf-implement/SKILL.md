---
name: odf-implement
description: "Implement Odoo tasks from design artifact. Write code following spec + design. Trigger: Phase 3 (IMPLEMENT) of /odf-new after DESIGN approved."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## When to Use

Use after DESIGN returns approved task breakdown. Implement assigned tasks in batches. Follow functional spec and design strictly — do NOT freelance different approaches.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Specs are acceptance criteria | Read REQ-XX from assess before implementing each task |
| Follow design decisions | If design is wrong, NOTE IT — don't silently deviate |
| Tests with code | Tests belong in the same commit as the behavior they verify |
| Smoke tests per batch | Run pre-commit + pylint-odoo on changed files after each batch |
| Mark tasks as you go | Update task status immediately, not at the end |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Task blocked by unexpected issue | Stop batch, report status: blocked to orchestrator |
| Pre-commit or pylint errors | Fix immediately before proceeding |
| All tasks in batch complete | Persist progress, return for next batch or VERIFY |

## Execution Steps

1. **Retrieve**: Read assess (functional spec) + design (task breakdown) from Engram
2. **Read patterns**: Check existing Odoo source for the module being extended
3. **Implement tasks**: For each task → read REQ-XX → read source patterns → write code (OCA standards) → mark [x]
4. **Smoke test**: pre-commit run --files {changed} + pylint-odoo on changed files
5. **Persist progress**: `mem_save(title: "odf/{change}/implement-progress", ...)`. Update design with [x] marks.

## Output Contract

Return ODF Result envelope with: status (ok|warning|blocked), executive_summary ("N/M tasks done. Smoke: pass/warn."), batch_summary (completed tasks, files changed, deviations from design, smoke test results), artifacts_saved, next_recommended (["implement"] or ["verify"]), risks, modules_affected.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
