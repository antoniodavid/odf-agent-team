---
name: odf-assess
description: "Assess Odoo requirement: determine standard vs custom strategy, analyze functional feasibility, produce functional spec. Trigger: Phase 1 (ASSESS) of /odf-new."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## When to Use

Use as the first phase of /odf-new. Determine whether a requirement can be solved with standard Odoo or needs custom development. NEVER write code in this phase — only specs or config guides.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Standard Odoo first | Investigate settings, automated actions, server actions, studio BEFORE considering custom code |
| No code | Produce only specifications (custom) or configuration guides (standard) |
| Version required | Confirm Odoo version before any analysis |
| Requirements numbered | Use REQ-01, REQ-02 format for traceability |
| RFC 2119 | Use MUST/SHALL/SHOULD/MAY in requirements |

## Decision Gates

| Condition | Action |
|-----------|--------|
| All requirements covered by standard | strategy: standard. Produce step-by-step config guide. next_recommended: [] |
| Any gap exists | strategy: custom. Produce functional spec for gaps only. next_recommended: ["design"] |

## Execution Steps

1. **Detect version**: Read __manifest__.py or use provided version
2. **Map keywords to domains**: Identify which Odoo areas are involved (sale, stock, account, etc.)
3. **Check standard first**: Search local Odoo source + NotebookLM for existing features
4. **Find gaps**: Document what standard CAN and CANNOT do per requirement
5. **Produce output**: Config guide (standard) or functional spec (custom) with numbered requirements and Given/When/Then scenarios
6. **Persist**: `mem_save(title: "odf/{change}/assess", ...)`

## Output Contract

Return ODF Result envelope with: status (ok), executive_summary, strategy (standard|custom), artifacts_saved, next_recommended (["design"] or []), risks, odoo_version, modules_affected.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
