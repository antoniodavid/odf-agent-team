---
name: odf-explore
description: "Deep investigation of Odoo codebase to understand patterns before proposing solutions. Trigger: /odf-explore, 'how does Odoo handle X', research, investigation."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## When to Use

Use BEFORE /odf-new when you need to understand how Odoo handles a feature, find existing patterns, or check version differences. Do NOT use for simple questions or bugfixes.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Local source first | ALWAYS search ~/Workspace/Odoo/O{VER}/ before concluding |
| Read actual files | Never guess Odoo behavior — read models/, views/, tests/ |
| Standard check | Determine if standard Odoo already covers the need |
| Version noted | APIs change between versions — check the target version specifically |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Standard Odoo covers the need | Report standard approach + config guide, suggest no custom code |
| Gap exists (partial or full) | Report findings + recommend /odf-new for the missing pieces |
| Unclear how Odoo works | Read local source, check tests for usage patterns, then decide |

## Execution Steps

1. **Find modules**: `fff "{topic}" ~/Workspace/Odoo/O{VER}/addons/ --type d`
2. **Find patterns**: `fff_grep "{concept}" ~/Workspace/Odoo/O{VER}/addons/{module}/`
3. **Read key files**: __manifest__.py (scope), models/*.py (logic), views/*.xml (UI), tests/*.py (examples)
4. **Synthesize**: Report modules, models, patterns found, standard coverage assessment, and recommended next step

## Output Contract

Return exploration report with: status (ok), executive_summary, relevant_modules (table: module, purpose, relevance), key_models (table: model, fields, methods), standard_coverage (Yes/No/Partial), recommendation (start /odf-new or use standard config), artifacts_saved, odoo_version, modules_affected.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
