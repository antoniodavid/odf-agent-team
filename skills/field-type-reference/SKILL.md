---
name: field-type-reference
description: "Field Type Reference. Trigger: field types, Char Integer Monetary, Selection field, field reference."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo Field Type Reference

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  FIELD TYPE REFERENCE                                                        ║
║  Complete reference for all Odoo field types with version-specific notes     ║
║  Use when defining model fields                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Field Types Overview

| Type | Python Class | Storage | Use Case |
|------|-------------|---------|----------|
| Char | `fields.Char` | VARCHAR | Short text, names |
| Text | `fields.Text` | TEXT | Long text, descriptions |
| Html | `fields.Html` | TEXT | Rich formatted text |
| Integer | `fields.Integer` | INTEGER | Whole numbers |
| Float | `fields.Float` | FLOAT | Decimal numbers |
| Monetary | `fields.Monetary` | NUMERIC | Currency amounts |
| Boolean | `fields.Boolean` | BOOLEAN | True/False |
| Date | `fields.Date` | DATE | Dates without time |
| Datetime | `fields.Datetime` | TIMESTAMP | Dates with time |
| Selection | `fields.Selection` | VARCHAR | Choice from list |
| Binary | `fields.Binary` | BYTEA | Files, images |
| Many2one | `fields.Many2one` | INTEGER (FK) | Single relation |
| One2many | `fields.One2many` | Virtual | Reverse of Many2one |
| Many2many | `fields.Many2many` | Junction table | Multiple relations |

---


## Common Field Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `string` | str | Field label |
| `help` | str | Tooltip text |
| `required` | bool | Cannot be empty |
| `readonly` | bool | Cannot be edited in UI |
| `index` | bool/str | Create database index |
| `default` | value/callable | Default value |
| `copy` | bool | Copy when duplicating |
| `groups` | str | Access groups (comma separated) |
| `tracking` | bool | Track in chatter (v15+) |
| `store` | bool | Store computed field |
| `compute` | str | Compute method name |
| `depends` | str | Dependency fields |
| `inverse` | str | Inverse method name |

---


## Field Naming Conventions

| Suffix | Field Type | Example |
|--------|-----------|---------|
| `_id` | Many2one | `partner_id`, `company_id` |
| `_ids` | One2many, Many2many | `line_ids`, `tag_ids` |
| `_count` | Integer (computed) | `order_count`, `task_count` |
| `_date` | Date | `create_date`, `due_date` |
| `_datetime` | Datetime | `start_datetime` |
| `is_` | Boolean | `is_done`, `is_locked` |
| `has_` | Boolean | `has_children`, `has_invoice` |
| `x_` | Custom field | `x_custom_field` (for studio/inheritance) |

---


## Security-Sensitive Fields

```python
# Hide from non-admin
salary = fields.Monetary(
    string='Salary',
    groups='hr.group_hr_manager',      # Only HR managers
)

# Multiple groups
secret_field = fields.Char(
    string='Secret',
    groups='base.group_system,hr.group_hr_manager',
)
```

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
