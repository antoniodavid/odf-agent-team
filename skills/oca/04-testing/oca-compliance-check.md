# OCA Compliance Check

Comprehensive validation of Odoo module code against OCA guidelines. Use before submitting PRs or during code review.

## Pre-Flight Checks

Before running detailed checks, verify:

- [ ] Module installs without errors
- [ ] All Python files have valid syntax
- [ ] No obvious files missing from `__manifest__.py`

## Manifest Checks (`__manifest__.py`)

### Version Format

```python
'version': '17.0.1.0.0'  # Odoo version . module version
```

| Check | Valid | Invalid |
|-------|-------|---------|
| Format | `17.0.1.0.0` | `1.0`, `17.0`, `17.0.1` |
| Odoo version prefix | Matches branch (17.0 for 17.0) | Mismatch with branch |

### Required Keys

| Key | Required | Notes |
|-----|----------|-------|
| `name` | ✅ | Human-readable name |
| `version` | ✅ | Format: `{OdooVersion}.{x}.{y}.{z}` |
| `author` | ✅ | Must include `, Odoo Community Association (OCA)` |
| `license` | ✅ | `AGPL-3` or `LGPL-3` |
| `website` | ✅ | `https://github.com/OCA/<repo>` |
| `depends` | ✅ | At minimum `['base']` |
| `installable` | ✅ | `True` for community |
| `development_status` | ⚠️ | Recommended: Alpha/Beta/Stable/Mature |

### Author Format

```python
# ✅ Correct
'author': 'My Name, Odoo Community Association (OCA)'

# ❌ Incorrect
'author': 'My Name'
'author': 'My Company, OCA'
```

### Website Format

```python
# ✅ Correct
'website': 'https://github.com/OCA/sale-workflow'
'website': 'https://github.com/OCA/sale-workflow/tree/17.0/sale_partner_verification'

# ❌ Incorrect
'website': 'https://mycompany.com'
'website': 'https://github.com/mycompany/repo'
```

### No Empty Keys

```python
# ❌ Don't leave keys empty
'description': '',

# ✅ Remove unused keys or provide value
# 'description': 'Module description',
```

## Python Code Checks

### Import Order

Imports must be in this order:

1. **Standard library** (`os`, `logging`, `datetime`)
2. **Third party** (`requests`, `lxml`) - sorted alphabetically
3. **Odoo imports** (`odoo`, `from odoo import`)
4. **Odoo addons** (rare, e.g., `from odoo.addons.web.models...`)
5. **Local imports** (`from . import utils`)
6. **Unknown third party** (with try/except)

```python
# ✅ Correct order
import base64
import logging

import requests
from lxml import etree

import odoo
from odoo import api, fields, models
from odoo.exceptions import UserError

from . import utils

_logger = logging.getLogger(__name__)
```

### PEP8 Compliance

| Rule | Max Line Length | Indentation | Blank Lines |
|------|----------------|-------------|-------------|
| Limit | 79 characters | 4 spaces | 2 between classes |

Use `flake8` or `pylint` to check.

### SQL Injection Prevention

```python
# ❌ NEVER - SQL injection vulnerability
cr.execute(f'SELECT * FROM {table} WHERE id = {user_id}')

# ✅ Use parameterized queries
cr.execute('SELECT * FROM table_name WHERE id = %s', (user_id,))

# ✅ For lists, use tuple()
cr.execute('SELECT * FROM table_name WHERE id IN %s', (tuple(ids),))
```

### No Direct commits

```python
# ❌ NEVER
cr.commit()

# ✅ Use savepoint for testing
with cr.savepoint():
    # code
```

### ORM Over Raw SQL

```python
# ❌ Don't bypass ORM
cr.execute('SELECT id FROM sale_order WHERE partner_id = %s', (partner_id,))
order_ids = [x[0] for x in cr.fetchall()]

# ✅ Use ORM
order_ids = self.search([('partner_id', '=', partner_id)])
```

### Method Naming

| Method Type | Pattern | Example |
|-------------|---------|---------|
| Compute | `_compute_<field>` | `_compute_amount_total` |
| Inverse | `_inverse_<field>` | `_inverse_amount` |
| Search | `_search_<field>` | `_search_partner` |
| Default | `_default_<field>` | `_default_date` |
| Onchange | `_onchange_<field>` | `_onchange_partner_id` |
| Constraint | `_check_<name>` | `_check_seats` |
| Action | `action_<name>` | `action_confirm` |

### Model Structure Order

1. Private attributes (`_name`, `_inherit`, `_description`)
2. Field declarations
3. SQL constraints (`_sql_constraints`)
4. Default methods
5. Compute/search methods (same order as fields)
6. Constraints and onchanges
7. CRUD methods
8. Action methods
9. Business methods

### Field Naming

```python
# ✅ Correct
partner_id = fields.Many2one('res.partner')  # _id suffix
line_ids = fields.One2many('sale.order.line', 'order_id')  # _ids suffix
tag_ids = fields.Many2many('sale.tag')

# ❌ Don't use string if same as name
name = fields.Char(string='Name')  # redundant
```

### Variable Naming

```python
# ✅ Use descriptive names
order_line = self.env['sale.order.line']
total_amount = sum(line.price for line in lines)

# ❌ Avoid one-letter names except
# - loop indices
# - lambda parameters
# - math expressions
```

## XML Checks

### Indentation

- Use **4 spaces** for indentation
- No tabs
- Align attributes within tags

```xml
<!-- ✅ Correct -->
<record id="sale_order_form" model="ir.ui.view">
    <field name="name">sale.order.form</field>
    <field name="model">sale.order</field>
</record>

<!-- ❌ Incorrect -->
<record id="sale_order_form" model="ir.ui.view">
  <field name="name">sale.order.form</field>
</record>
```

### Record Structure

```xml
<!-- ✅ Correct order -->
<record id="view_id" model="ir.ui.view">
    <field name="name">view.name</field>
    <field name="model">object_name</field>
    <field name="priority" eval="16"/>
    <field name="arch" type="xml">
        <tree>
            <field name="name"/>
        </tree>
    </field>
</record>
```

### XML ID Naming

| Element | Pattern | Example |
|---------|---------|---------|
| View | `<model>_view_<type>` | `sale_order_view_form` |
| Action | `<model>_action` | `sale_order_action` |
| Menu | `<model>_menu` | `sale_order_menu` |
| Group | `<model>_group_<name>` | `sale_order_group_user` |
| Rule | `<model>_rule_<group>` | `sale_order_rule_company` |

### No Module Prefix in Internal IDs

```xml
<!-- ❌ Don't prefix with module name -->
<record id="my_module.view_id" model="ir.ui.view">

<!-- ✅ Just use the ID -->
<record id="view_id" model="ir.ui.view">
```

### ir.filters Records

```xml
<!-- ✅ Must have explicit user_id -->
<record id="filter_id" model="ir.filters">
    <field name="name">My Filter</field>
    <field name="model_id">sale.order</field>
    <field name="user_id" eval="False"/>
</record>
```

### No position="replace" Without Justification

```xml
<!-- ❌ Avoid without good reason -->
<field name="my_field" position="replace">
    <field name="new_field"/>
</field>

<!-- ✅ If needed, add comment and high priority -->
<record id="view_id" model="ir.ui.view">
    <field name="priority" eval="110"/>
    <field name="arch" type="xml">
        <!-- Necessary because... -->
        <xpath expr="//field[@name='my_field']" position="replace">
            <field name="new_field"/>
        </xpath>
    </field>
</record>
```

### Demo Data IDs

```xml
<!-- ✅ Suffix demo records with _demo -->
<record id="res_users_demo_user" model="res.users">
```

## Security Checks

### Access Control File

```csv
# ✅ ir.model.access.csv format
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_sale_order_user,sale.order.user,model_sale_order,base.group_user,1,1,0,0
```

### Record Rules

For multi-company modules:
```xml
<record id="sale_order_rule_company" model="ir.rule">
    <field name="name">Sale Order: multi-company</field>
    <field name="model_id" ref="model_sale_order"/>
    <field name="domain_force">[('company_id', 'in', company_ids)]</field>
</record>
```

### No Hardcoded User IDs

```python
# ❌ Never
user_id = 1  # admin
user_id = ref('base.user_root')

# ✅ Use reference methods
user_id = self.env.ref('base.user_admin').id
user_id = self.env.uid
```

## Test Checks

### Test File Structure

```python
from odoo.tests import TransactionCase, tagged

@tagged('post_install', '-at_install')
class TestSaleOrder(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({
            'name': 'Test Partner',
        })

    def test_order_confirmation(self):
        """Test order confirmation sets state to sale."""
        order = self.env['sale.order'].create({
            'partner_id': self.partner.id,
        })
        order.action_confirm()
        self.assertEqual(order.state, 'sale')
```

### Required Tags

| Tag | Use |
|-----|-----|
| `post_install` | Run after full installation |
| `-at_install` | Skip at install phase |

### Test Best Practices

- [ ] Each test method tests one thing
- [ ] Use descriptive test names: `test_<what_is_tested>`
- [ ] Create test data in `setUpClass` or within test
- [ ] Avoid relying on demo data
- [ ] Use `freezegun` for date-dependent tests
- [ ] Mock external services

## File Structure Checks

### Required Files

```
module_name/
├── __init__.py          ✅ Required
├── __manifest__.py      ✅ Required
├── README.rst          ✅ Auto-generated from readme/
├── models/
│   ├── __init__.py
│   └── *.py
├── views/
│   └── *.xml
├── security/
│   └── ir.model.access.csv
└── tests/
    ├── __init__.py
    └── test_*.py
```

### File Permissions

- Directories: `755`
- Files: `644`

### One Model Per File

```python
# models/sale_order.py
class SaleOrder(models.Model):
    _name = 'sale.order'
    # ...

# models/sale_order_line.py
class SaleOrderLine(models.Model):
    _name = 'sale.order.line'
    # ...
```

## External Dependencies

### Manifest Declaration

```python
'external_dependencies': {
    'python': ['requests', 'barcode'],
    'bin': ['external_tool'],
}
```

### Import Error Handling

```python
# ✅ Required for external dependencies
try:
    import barcode
    from barcode import generate
except ImportError:
    _logger.debug('barcode library not found')
```

## Output Format

Run compliance check and produce this report:

```markdown
## ✅ OCA Compliance Report: {module_name}

### Manifest
| Item | Status | Details |
|------|--------|---------|
| Version format | ✅ | 17.0.1.0.0 |
| Author includes OCA | ✅ | 'My Name, Odoo Community Association (OCA)' |
| License | ✅ | AGPL-3 |
| Website | ✅ | https://github.com/OCA/... |

### Python Code
| File | Issues | Severity |
|------|--------|----------|
| models/sale_order.py | 2 | Warning |
| models/sale_order_line.py | 0 | - |

### XML Code
| File | Issues | Severity |
|------|--------|----------|
| views/sale_order_views.xml | 1 | Error |

### Security
| Item | Status |
|------|--------|
| ir.model.access.csv | ✅ Present |
| Record rules | ⚠️ Missing (multi-company) |

### Tests
| Item | Status |
|------|--------|
| Test file present | ✅ |
| Proper tags | ✅ |
| Test count | 5 tests |

## Overall Score: 85/100

### Critical Issues (Must Fix)
1. SQL injection risk in `models/sale_order.py:45`

### Warnings (Should Fix)
1. Missing `development_status` in manifest
2. Method `_compute_total` could be optimized

### Passed Checks
- ✅ Import order correct
- ✅ XML indentation correct
- ✅ Test tags present
```

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-contributing-guide.md` | Complete contributing guidelines |
| `oca-pr-workflow.md` | PR submission workflow |
| `oca-code-review.md` | Code review process |
| `oca-commit-messages.md` | Commit message conventions |
