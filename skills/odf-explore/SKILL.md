---
name: odf-explore
description: "Use when investigating Odoo behavior before a change: search the local source, read the real files, and cite evidence."
license: MIT
metadata:
  author: antoniodavid
  version: "2.2"
---

## Activation Contract

Use only for `/odf-explore` or an explicit Odoo investigation before proposing
a change. Do not implement or turn an investigation into an approval.

## When to Use

Use BEFORE /odf-new when you need to understand how Odoo handles a feature, find existing patterns, or check version differences. Do NOT use for simple questions or bugfixes.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Local source first | ALWAYS search the project's `<odoo-source-root>` before concluding |
| Read actual files | Never guess Odoo behavior — read models/, views/, tests/ |
| Standard check | Determine if standard Odoo already covers the need |
| Version noted | APIs change between versions — check the target version specifically |
| Cite sources | Every claim traces to a primary source (local Odoo source file:line, official docs, tests) and is cited inline — secondary write-ups and recollection are not evidence |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Standard Odoo covers the need | Report standard approach + config guide, suggest no custom code |
| Gap exists (partial or full) | Report findings + recommend /odf-new for the missing pieces |
| Unclear how Odoo works | Read local source, check tests for usage patterns, then decide |

## Execution Steps

1. **Resolve project root and check CodeGraph** for structural questions before broad filesystem searches.
2. **Find modules and patterns** with native OpenCode `Glob` and `Grep` in `<odoo-source-root>/odoo/addons/`.
3. **Read key files** with `Read`: `__manifest__.py` (scope), `models/` (logic), `views/` (UI), and `tests/` (examples).
4. **Synthesize**: Report modules, models, patterns found, standard coverage assessment, and recommended next step. Cite the primary source (file:line for local code, official doc reference) for every claim; never present a guess as a finding.

## Output Contract

Return the complete shared ODF Result envelope, including every required common field (especially `strategy` and `skill_resolution`), plus an exploration report with relevant_modules (table: module, purpose, relevance), key_models (table: model, fields, methods), standard_coverage (Yes/No/Partial), and recommendation (start /odf-new or use standard config).

## References

- `../_shared/result-contract.md` — ODF Result envelope
- `../_shared/odoo-sources.md` — Local source paths
