---
name: odoo-views-owl
description: "Use when building Odoo views, actions, dialogs, or OWL components: forms, lists, kanban, search, xpath inheritance, window actions, wizard dialogs, and version-specific OWL APIs."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo Views and OWL

## Activation Contract

Use this domain skill when the task touches one of the topics below. Read the
specific reference before writing code; the domain file is the router, not a
substitute for the detailed pattern.

## Topic Map

| Topic | Reference |
|-------|-----------|
| Form, list, kanban, search, calendar, pivot, graph | `references/odoo-view-patterns.md` |
| Window, server, client, and URL actions | `references/action-patterns.md` |
| Dialog service, wizards, notifications | `references/odoo-dialog-service.md` |
| OWL components, props, hooks, assets | `references/owl-components.md` |

## Hard Rules

- Inherit views with xpath and keep the original priority; never copy core views.
- attrs is removed in v17+: use invisible, readonly, and required expressions.
- Restrict sensitive fields, menus, and actions with groups.
- Window actions need res_model; wizards use target=new.
- Handle dialog cancel and discard explicitly.
- Load the target version's OWL guide before writing components.

## References

Read the topic reference first. Full code examples live next to it:

- `references/odoo-view-patterns-examples.md`
- `references/odoo-dialog-service-examples.md`

## Compact Rules

- Inherit views with xpath; never copy core views.
- v17+ uses invisible/readonly/required expressions; attrs is gone.
- Restrict fields, menus, and actions with groups.
- Window actions need res_model; wizards use target=new.
- Handle dialog cancel explicitly.
- Load the target version's OWL guide before writing components.
