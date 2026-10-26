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
- Command definitions in `command/*.md` are in **English** (migrated from Spanish); runtime conversation with the user still follows the user's language.
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

### Compact-rule contract

`compact_rules` is the only part of a skill most delegations ever see, so it is
validated as a product surface:

- 150–600 characters, ending on a complete sentence.
- No ASCII banners (the box-drawing glyphs old skills carried) and no truncated
  tails.
- No two skills may share the same `compact_rules` string.
- Regenerate them from the skill's own rules and best practices; never copy the
  banner or the first paragraph.

## Validation

Every skill registered in `odf-registry.json` is checked by the Agent Skills
validator:

```bash
npm run validate:skills          # errors fail; warnings report migration debt
node scripts/odf-skill-validate.js --strict --json
```

Errors:

- `SKILL.md` starts with YAML frontmatter and parses.
- `name` is required, ≤64 characters, lowercase alphanumeric with single hyphens,
  and equals its parent directory for a `SKILL.md`.
- `description` is required and ≤1024 characters.
- `path` exists, is a file, and stays inside the registry or config root.
- `compact_rules` satisfies the contract above.

Warnings (migration debt; failures under `--strict`):

- Missing `license`, non-spec frontmatter keys, or a file that is not a
  `SKILL.md`.
- Body over 500 lines or ~20k characters, or absolute/personal paths.
- Frontmatter name that differs from the registry entry.

CI runs the validator, so a new skill reaches `main` only with valid frontmatter
and conforming compact rules.

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

## Writing for Agents

Skills are read by an agent, not a human skimming docs; the document's job is a
predictable process every run. Composition rules:

- **Context pointers**: a description line is a pointer; its wording decides when
  the agent reaches the material. Front-load the leading word, one trigger per
  branch, and cut identity the body already carries.
- **Two loads**: always-loaded text spends context load every turn; material
  reached through a pointer spends only the pointer. Push reference behind
  pointers (progressive disclosure); keep every-branch material inline.
- **Leading words**: anchor behaviour on compact pretrained concepts (seam,
  tracer bullet, red) instead of explaining them in sentences; repeat the token,
  not the definition.
- **Completion criteria**: every step ends on a checkable boundary; vague bounds
  invite premature completion. Demand ("every EXP-XX accounted for") drives legwork.
- **Positive framing**: state the target behaviour; a prohibition drags the banned
  behaviour into context. Keep a prohibition only as a hard guardrail, paired
  with its positive target.
- **Single source of truth**: one meaning lives in one place; duplication costs
  maintenance and inflates prominence. Never restate what the environment
  already exposes (package scripts, configs).

## Review Checklist

Before submitting a skill change:

- [ ] Frontmatter is complete and valid YAML.
- [ ] Sections follow the required structure.
- [ ] Compact rules are concise, actionable, and satisfy the compact-rule contract.
- [ ] `npm run validate:skills` passes with zero errors.
- [ ] `odf-registry.json` is updated.
- [ ] Path is relative when `use_relative_paths` is `true`.
- [ ] Version and changelog are updated if behavior changed.
- [ ] YAML scenario test passes.
- [ ] Pointers and steps follow the writing-for-agents rules (leading words, positive framing, no duplication).
- [ ] Change stays within the 400-line PR budget or is split into a chained PR.
