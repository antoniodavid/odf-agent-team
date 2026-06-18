# ODF Skill Style Guide

This guide defines how to write and maintain ODF skills.

## Skill Structure

ODF skills follow the LLM-first gentle-ai structure. A skill file is a Markdown document with YAML frontmatter followed by structured sections.

### Frontmatter

```yaml
---
name: my-skill
description: "Short, searchable description. Trigger: user says X, Y, or Z."
license: MIT
metadata:
  author: your-name
  version: "1.0"
---
```

Keep the description short and include trigger keywords so the skill resolver can match it.

### Required Sections

| Section | Purpose |
|---------|---------|
| Activation Contract | When the skill should be loaded. Use trigger phrases. |
| Hard Rules | Non-negotiable rules the agent must follow. |
| Decision Gates | Conditions that change the recommended path. |
| Execution Steps | Numbered or ordered list of what to do. |
| Output Contract | Expected return format, envelope fields, or artifacts. |
| References | Links to related skills, files, or external docs. |

Use second-level headings (`##`) for each section.

## Language

- Generated technical artifacts default to **English**.
- User-facing command definitions and prompts in `command/*.md` are in **Spanish** for this project.
- Skills may be in English or Spanish depending on their audience; prefer English for technical rules.

## Compact Rules

The registry stores a `compact_rules` string for each skill. Write compact rules as:

- Short imperative statements.
- One idea per line or bullet.
- Concrete examples over abstract guidance.
- Avoid redundant prose that duplicates the skill body.

Example:

```text
- Use @api.depends with explicit field paths
- Set store=True if field is searched/grouped
- Handle empty recordsets (for record in self:)
```

## Naming Conventions

- Skill names use kebab-case: `odf-verify`, `oca-commit-messages`.
- Prefix ODF skills with `odf-`.
- Prefix OCA governance/style skills with `oca-`.
- Agent names use snake_case: `odoo_backend_engineer`.

## Registry Registration

When you add or modify a skill, update `odf-registry.json`:

- Add or update the skill entry under `skills`.
- Ensure `path` is relative to the registry directory when `flags.use_relative_paths` is `true`.
- List supported Odoo versions in `odoo_versions`.
- Assign an `sdd_phase` when the skill is tied to a specific workflow phase.
- Bump the skill `version` and add a changelog entry when behavior changes.

## Triggers

Triggers are the keywords used by the skill resolver. Include:

- File extensions (`.py`, `.xml`, `__manifest__.py`).
- Directory names (`models/`, `views/`, `tests/`).
- Action verbs (`test`, `commit`, `review`, `migrate`).
- Domain terms relevant to the skill.

Keep triggers specific enough to avoid false positives.

## Versioning

Use semantic-ish versioning for skills:

- `1.0` — initial version.
- `2.0` — major restructure or breaking behavior change.
- `2.1` — additive change or clarification.

Always add a `changelog` entry with date and short description.

## Testing

If a skill includes deterministic logic, add or extend a YAML scenario in `scripts/odf-agent-tests/`:

- Name the test clearly.
- Provide `input.task` and `input.context`.
- Specify `expected.skill_resolution`, `expected.expected_skills`, and `expected.status_in`.

Run the scenario with:

```bash
node scripts/odf-test-runner.js
```

## Review Checklist

Before submitting a skill change:

- [ ] Frontmatter is complete and valid YAML.
- [ ] Sections follow the required structure.
- [ ] Compact rules are concise and actionable.
- [ ] `odf-registry.json` is updated.
- [ ] Path is relative when `use_relative_paths` is `true`.
- [ ] Version and changelog are updated if behavior changed.
- [ ] YAML scenario test passes.
- [ ] Change stays within the 400-line PR budget or is split into a chained PR.
