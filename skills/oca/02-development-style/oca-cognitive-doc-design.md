---
name: cognitive-doc-design
description: "Design ODF artifacts (specs, designs, reports) that reduce cognitive load for reviewers. Trigger: writing spec, design, report, PR description, or any document for human review."
license: Apache-2.0
metadata:
  author: adruban
  version: "1.0"
---

## When to Use

Load this skill when creating or editing documentation that humans need to understand quickly: functional specs (ASSESS), technical designs (DESIGN), verification reports (VERIFY), PR descriptions, or contributor guides.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Lead with the answer | Put the decision, action, or outcome first. Context comes after. |
| Progressive disclosure | Happy path first, then details, edge cases, references |
| Chunking | Group related info into small sections. Keep lists short. |
| Recognition over recall | Tables, checklists, examples > prose that must be remembered |
| Review empathy | Design so reviewers verify intent without reconstructing the whole story |

## Decision Gates

| Document type | Structure |
|---------------|-----------|
| Functional spec (ASSESS) | Business Need → Standard Coverage → Custom Reqs (numbered) → Out of Scope |
| Technical design (DESIGN) | Architecture Decisions → Data Model → Views → Security → Tasks |
| Verification report (VERIFY) | Completeness → Compliance → Tests → Review → Spec Matrix → Verdict |
| PR description | Summary → Changes → Test Plan → Checklist |

## Output Contract

Return document with: outcome-oriented title, one-paragraph summary, quick path (numbered steps), details (table: topic, decision), checklist (confirmable items), next step.

## References

- `/home/adruban/.config/opencode/skills/oca/01-oca-governance/oca-pr-workflow.md` — PR templates
