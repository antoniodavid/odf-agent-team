---
name: odoo-modeling
description: "Use when modeling Odoo data: fields, computed values, inheritance, constraints, domains, context, onchange, errors, and migrations. Covers the concrete pattern and the target-version ORM rules."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo Modeling

## Activation Contract

Use this domain skill when the task touches one of the topics below. Read the
specific reference before writing code; the domain file is the router, not a
substitute for the detailed pattern.

## Topic Map

| Topic | Reference |
|-------|-----------|
| Computed, related, inverse, search | `references/computed-field-patterns.md` |
| Extension, classical, delegation, mixins | `references/inheritance-patterns.md` |
| SQL and Python constraints | `references/constraint-patterns.md` |
| env, context, sudo, company switching | `references/context-environment-patterns.md` |
| Domains, operators, record rules | `references/domain-filter-patterns.md` |
| Exceptions and user feedback | `references/error-handling-patterns.md` |
| Field types and attributes | `references/field-type-reference.md` |
| onchange vs computed | `references/onchange-dynamic-patterns.md` |
| Migration scripts and OpenUpgrade | `references/data-migration-patterns.md` |

## Hard Rules

- Read the target-version Odoo source before choosing an ORM pattern.
- Prefer computed fields over onchange for persisted values; list every dependency.
- _inherit extends, _name + _inherit creates, _inherits delegates; call super().
- Validate with constraints; never rely on UI onchange for integrity.
- Never interpolate SQL; use parameters or the ORM.
- Add a regression test for every behavior change.

## References

Read the topic reference first. Full code examples live next to it:

- `references/inheritance-patterns-examples.md`
- `references/field-type-reference-examples.md`
- `references/onchange-dynamic-patterns-examples.md`
- `references/data-migration-patterns-examples.md`

## Compact Rules

- Read the topic reference before writing model code.
- Prefer computed fields over onchange for persisted values; list every dependency.
- _inherit extends, _name + _inherit creates, _inherits delegates.
- Validate with constraints, never with UI onchange alone.
- Never interpolate SQL; use parameters or the ORM.
- Add a regression test for every behavior change.
