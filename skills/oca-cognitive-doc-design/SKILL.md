---
name: oca-cognitive-doc-design
description: "Use when writing a design doc, spec, report, or PR description: answer first, progressive disclosure, chunking, and reviewer empathy."
license: Apache-2.0
metadata:
  author: antoniodavid
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
| Signposting | Use headings, labels, callouts, and summaries so readers know where they are |
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

- `../oca-governance-pr-workflow/SKILL.md` — PR templates
