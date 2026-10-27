---
name: odoo-versioning
description: "Use when a task depends on the Odoo version: supported releases, breaking changes, ORM patterns per version, Community vs Enterprise, and migration paths from 16 to 19."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo Versioning

## Activation Contract

Use this domain skill when the task touches one of the topics below. Read the
specific reference before writing code; the domain file is the router, not a
substitute for the detailed pattern.

## Topic Map

| Topic | Reference |
|-------|-----------|
| Version support, deprecations, detection | `references/odoo-version-knowledge.md` |
| ORM model patterns per version | `references/odoo-model-patterns.md` |
| Community vs Enterprise editions | `references/odoo-editions.md` |

## Hard Rules

- Determine the target version first: manifest, requirements, or existing code.
- Versions 16-19 are supported; 15 is migration source only.
- Load the version-specific file before writing or upgrading code.
- Never copy a pattern across versions without checking the target API.
- Do not depend on Enterprise modules from a Community module.
- Verify XML IDs and model names against the target source.

## References

Read the topic reference first. Full code examples live next to it:

- No separate example files in this domain.

## Compact Rules

- Determine the target Odoo version first; never assume.
- 16-19 are supported; 15 is migration source only.
- Load the version-specific file before writing or upgrading code.
- Never copy a pattern across versions without checking the target API.
- Community modules must not depend on Enterprise modules.
- Verify XML IDs and model names against the target source.
