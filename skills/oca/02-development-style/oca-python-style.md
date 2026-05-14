# OCA Python Style Guide

Python coding standards for OCA modules.

## Import Order

1. Standard library imports
2. Known third party imports (one per line, sorted)
3. Odoo imports (`odoo`)
4. Imports from Odoo modules (rarely, only if necessary)
5. Local imports in relative form
6. Unknown third party imports (with try/except)

```python
# 1: Standard library
import base64
import logging
import re

# 2: Third party
import lxml

# 3: Odoo
from odoo import api, fields, models
from odoo.exceptions import UserError
from odoo.tools.translate import _

# 4: Odoo modules (rare)
from odoo.addons.website.models.website import slug

# 5: Local
from . import utils

# 6: Unknown third party
_logger = logging.getLogger(__name__)
```

Use `isort` to automatically sort imports.

## Model Structure

Methods in a model should follow this order:

1. Private attributes (`_name`, `_inherit`, `_description`, `_order`)
2. Field declarations
3. SQL constraints
4. Default methods and `_default_get`
5. Compute and search methods (same order as field declaration)
6. Constraints (`@api.constrains`) and onchange (`@api.onchange`)
7. CRUD methods (ORM overrides)
8. Action methods
9. Business methods

```python
class Event(models.Model):
    # Private attributes
    _name = 'event.event'
    _inherit = ['event.event', 'mail.thread']
    _description = 'Event'
    _order = 'name'

    # Fields
    name = fields.Char()
    seats_reserved = fields.Integer(store=True, compute='_compute_seats')

    # SQL constraints
    _sql_constraints = [
        ('name_uniq', 'unique(name)', 'Name must be unique'),
    ]

    # Default methods
    def _default_name(self):
        ...

    # Compute/search (same order as fields)
    @api.depends('seats_max', 'registration_ids.state')
    def _compute_seats(self):
        ...

    # Constraints and onchanges
    @api.constrains('seats_max')
    def _check_seats_limit(self):
        ...

    @api.onchange('date_begin')
    def _onchange_date_begin(self):
        ...

    # CRUD
    def create(self, vals):
        ...

    # Action methods
    def action_validate(self):
        self.ensure_one()
        ...

    # Business methods
    def _send_confirmation(self):
        ...
```

## Method Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Compute | `_compute_<field>` | `_compute_amount_total` |
| Inverse | `_inverse_<field>` | `_inverse_amount` |
| Search | `_search_<field>` | `_search_partner` |
| Default | `_default_<field>` | `_default_date` |
| Onchange | `_onchange_<field>` | `_onchange_partner_id` |
| Constraint | `_check_<name>` | `_check_dates` |
| Action | `action_<name>` | `_action_confirm` |

## SQL Guidelines

### No SQL Injection

Never use Python string concatenation or interpolation for SQL queries:

```python
# WRONG - SQL injection vulnerability
cr.execute('SELECT * FROM res_partner WHERE id = ' + str(partner_id))

# CORRECT - Use parameters
cr.execute('SELECT * FROM res_partner WHERE id = %s', (partner_id,))

# CORRECT - For lists, use tuple
cr.execute('SELECT * FROM res_partner WHERE id IN %s', (tuple(ids),))
```

### Never Commit

The framework handles transactions. Never call `cr.commit()`:

```python
# WRONG
cr.commit()

# Use savepoint instead if needed
try:
    with cr.savepoint():
        method1()
except Exception:
    pass
```

### Use ORM When Possible

Don't bypass the ORM with raw SQL:

```python
# WRONG
cr.execute('SELECT id FROM auction_lots WHERE ...')
auction_lots_ids = [x[0] for x in cr.fetchall()]

# CORRECT - Use ORM
auction_lots_ids = self.search([
    ('auction_id', 'in', ids),
    ('state', '=', 'draft'),
])
```

## Python Idioms

- Prefer `%` over `.format()` for translation compatibility
- Use list/dict comprehension and `map`, `filter`, `sum`
- Use recordset methods: `filtered`, `mapped`, `sorted`
- Use meaningful variable names (avoid one-letter variables except in lambdas or loop indices)
- Use English variable names and comments
- Avoid `api.v7` decorator in new code unless parent already uses it

## Variable Naming

| Pattern | Use | Example |
|---------|-----|---------|
| `underscore_lowercase` | Common variables | `partner_id`, `order_lines` |
| `UPPERCASE` | Constants | `MAX_RETRY`, `DEFAULT_STATE` |
| No `_id` suffix | Recordset variables | `res_partner = self.env['res.partner']` |
| `_id` suffix | Single ID value | `partner_id = partners[0].id` |

## Field Naming

```python
# Many2One - suffix _id
partner_id = fields.Many2one('res.partner')

# One2Many/Many2Many - suffix _ids
line_ids = fields.One2many('sale.order.line', 'order_id')
tag_ids = fields.Many2many('sale.tag')

# Default with lambda (allows inheritance)
date = fields.Date(default=lambda self: self._default_date())

# No string if same as name
name = fields.Char()  # Not: fields.Char(string='Name')
```

## External Dependencies

### Import Error Handling

In Python files using external dependencies, add try-except with debug log:

```python
try:
    import external_dependency_python_N
    import external_dependency_python_M
    EXTERNAL_DEPENCY_BINARY_N_PATH = tools.find_in_path('external_dependency_binary_N')
except (ImportError, IOError) as err:
    _logger.debug(err)
```

This rule doesn't apply to test files or Odoo >= v12.

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-xml-style.md` | XML coding standards |
| `oca-manifest-format.md` | Manifest structure |
| `oca-naming-conv.md` | Naming conventions |
| `oca-compliance-check.md` | Validate compliance |
