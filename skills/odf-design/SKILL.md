---
name: odf-design
description: "Create technical design + task breakdown for Odoo custom module. Trigger: Phase 2 (DESIGN) of /odf-new after ASSESS approved."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## When to Use

Use after ASSESS returns strategy: custom. Produce architecture decisions, data model, file structure, and phased task breakdown. The orchestrator will approve before IMPLEMENT.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Read source first | Read the Odoo module being extended BEFORE designing |
| Traceability | Every task must link to a requirement REQ-XX from ASSESS |
| Security required | Every new model MUST have ir.model.access.csv |
| Tests required | Every feature MUST have at least one test task |
| OCA conventions | File structure, naming, manifest follow OCA standards |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Single module | Design one module with 3 phases: Foundation → Views → Tests |
| Multi-module (2+) | Design per module: Primary first (all phases), then secondary. Prefix task IDs (A1.1, B1.1) |
| Complex architecture | Include architecture decisions with rationale + rejected alternatives |

## Execution Steps

1. **Retrieve**: `mem_get_observation(id)` on assess artifact from Engram
2. **Investigate**: Read the Odoo source modules being extended/inherited
3. **Design**: Produce architecture decisions table, data model (models + fields), views (type + action), security, file structure
4. **Break down tasks**: Phase 1: Foundation (models + security). Phase 2: Views + UI. Phase 3: Tests + polish. Link each task to REQ-XX
5. **Persist**: `mem_save(title: "odf/{change}/design", ...)`

## Output Contract

Return ODF Result envelope with: status (ok), executive_summary ("N models, N views, N tasks in M phases"), artifacts_saved, next_recommended (["implement"]), risks, odoo_version, modules_affected.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
