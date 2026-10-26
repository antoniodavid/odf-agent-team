---
name: odoo-view-patterns
description: "Odoo View Patterns. Trigger: view, form, tree, kanban, search, xml."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo View Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  VIEW PATTERNS                                                             ║
║  Form, List, Kanban, Search, Calendar, Pivot, Graph views                ║
║  Creation from scratch (not inheritance)                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## View Types Overview

| View Type | Model | Purpose |
|-----------|-------|---------|
| Form | `ir.ui.view` | Single record editing |
| List/Tree | `ir.ui.view` | Multiple records display |
| Kanban | `ir.ui.view` | Card-based分组 |
| Search | `ir.ui.view` | Filter/search bar |
| Calendar | `ir.ui.view` | Date-based scheduling |
| Pivot | `ir.ui.view` | Data aggregation |
| Graph | `ir.ui.view` | Charts |
| Gantt | `ir.ui.view` | Timeline |
| Activity | `ir.ui.view` | Activity stream |

---


## Version Notes

### Odoo 17+ Changes
- `attrs` deprecated → use `invisible` directly
- View names can be dynamic with `string` attribute

### Odoo 16+ Changes
- Bootstrap 5 classes standard
- Use `o_` prefix for custom classes

### Best Practices

1. **Always use groups** for form layout
2. **Use header with statusbar** for workflow states
3. **Use notebook for secondary info** to avoid cluttered forms
4. **Add help tooltips** to complex fields
5. **Use proper field types** - don't use Char for dates
6. **Group List fields** with `sum`, `avg` for totals
7. **Kanban should be clickable** with `oe_kanban_global_click`
8. **Calendar needs `date_start`** minimum

---

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
