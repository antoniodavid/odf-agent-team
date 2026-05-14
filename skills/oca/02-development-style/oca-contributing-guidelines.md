# OCA Contributing Guidelines

> **For Odoo/OCA projects ONLY.** Consolidated best practices for contributing to OCA.
>
> Use when user says: "how to contribute", "OCA guidelines", "best practices", 
> "module structure", or when reviewing code for OCA compliance.

Complete contributing guidelines for OCA repositories, extracted from official OCA documentation.

---

## 🏷️ Naming Conventions

### Module Names

| Rule | Example |
|------|---------|
| Singular (no plural) | `sale_order`, no `sale_orders` |
| Prefijo `base_` para módulos base | `base_location_nuts` |
| Prefijo `l10n_CC_` para localización | `l10n_es_pos`, `l10n_mx_edi` |
| Extender Odoo = prefijo del módulo | `mail_forward`, `sale_stock_custom` |
| OCA + Odoo = Odoo primero | `crm_partner_firstname` |

### File Names

```
models/<model_name>.py           # sale_order.py
views/<model_name>_views.xml     # sale_order_views.xml  
data/<model_name>_data.xml       # sale_order_data.xml
demo/<model_name>_demo.xml       # sale_order_demo.xml
```

### XML IDs

| Type | Pattern | Example |
|------|--------|---------|
| Vista | `<model>_view_<type>` | `sale_order_view_form` |
| Acción | `<model>_action` | `sale_order_action` |
| Menú | `<model>_menu` | `sale_order_menu` |
| Grupo | `<model>_group_<name>` | `sale_order_group_user` |
| Regla | `<model>_rule_<group>` | `sale_order_rule_company` |

---

## 📦 Manifest (`__manifest__.py`)

```python
{
    'name': 'Module Name',
    'version': '17.0.1.0.0',
    'category': 'Sales',
    'summary': 'Short description',
    'author': 'Your Name, Odoo Community Association (OCA)',  # ⚠️ Siempre agregar OCA
    'website': 'https://github.com/OCA/<repo>',  # ⚠️ Link al repo OCA
    'license': 'AGPL-3',  # ⚠️ Obligatorio
    'depends': ['sale', 'stock'],
    'data': [
        'security/ir.model.access.csv',
        'views/sale_order_views.xml',
    ],
    'demo': [
        'demo/sale_order_demo.xml',
    ],
    'installable': True,
    'development_status': 'Beta',  # Alpha/Beta/Production/Stable/Mature
    'maintainers': ['tu_github_username'],
}
```

### ⚠️ Reglas Obligatorias
- ✅ Incluir `license`
- ✅ Incluir `,Odoo Community Association (OCA)` en `author`
- ✅ `website` = `https://github.com/OCA/<repo>`
- ❌ No usar logo corporativo
- ❌ No dejar keys vacías

---

## 🐍 Python Guidelines

### Orden de Imports

```python
# 1. Standard library
import base64
import logging

# 2. Third party conocidos
import lxml

# 3. Odoo
from odoo import api, fields, models
from odoo.exceptions import UserError
from odoo.tools.translate import _

# 4. Odoo addons (raro)
from odoo.addons.website.models.website import slug

# 5. Local
from . import utils

# 6. Third party desconocidos (con try/except)
_logger = logging.getLogger(__name__)
try:
    import phonenumbers
except ImportError:
    _logger.debug('Cannot import phonenumbers')
```

### Orden en Modelo

```python
class SaleOrder(models.Model):
    # 1. Atributos privados
    _name = 'sale.order'
    _inherit = ['sale.order', 'mail.thread']
    _description = 'Sale Order'
    _order = 'date desc'

    # 2. Campos
    custom_field = fields.Char()
    
    # 3. SQL Constraints
    _sql_constraints = [...]
    
    # 4. Métodos default
    def _default_custom(self):
        ...
    
    # 5. Compute/Search (mismo orden que campos)
    @api.depends('field')
    def _compute_custom(self):
        ...
    
    # 6. Constraints y Onchange
    @api.constrains('field')
    def _check_custom(self):
        ...
    
    # 7. CRUD methods
    def create(self, vals):
        ...
    
    # 8. Action methods
    def action_confirm(self):
        self.ensure_one()
        ...
    
    # 9. Business methods
    def _prepare_invoice(self):
        ...
```

### Naming de Métodos

| Tipo | Patrón | Ejemplo |
|------|--------|---------|
| Compute | `_compute_<field>` | `_compute_amount_total` |
| Inverse | `_inverse_<field>` | `_inverse_amount` |
| Search | `_search_<field>` | `_search_partner` |
| Default | `_default_<field>` | `_default_date` |
| Onchange | `_onchange_<field>` | `_onchange_partner_id` |
| Constraint | `_check_<name>` | `_check_dates` |
| Action | `action_<name>` | `action_confirm` |

---

## 📝 Campos

```python
# Many2One - sufijo _id
partner_id = fields.Many2one('res.partner', string='Partner')

# One2Many/Many2Many - sufijo _ids
line_ids = fields.One2many('sale.order.line', 'order_id')
tag_ids = fields.Many2many('sale.tag', string='Tags')

# Default con lambda (permite herencia)
date = fields.Date(default=lambda self: self._default_date())

# No usar string si es igual al nombre
name = fields.Char()  # ✅ No: fields.Char(string='Name')
```

---

## 🔒 SQL - Seguridad

```python
# ❌ NUNCA concatenar strings (SQL Injection!)
cr.execute('SELECT * FROM res_partner WHERE id = ' + str(partner_id))

# ✅ SIEMPRE usar parámetros
cr.execute('SELECT * FROM res_partner WHERE id = %s', (partner_id,))

# ✅ Para listas, usar tuple
cr.execute('SELECT * FROM res_partner WHERE id IN %s', (tuple(ids),))
```

### ⚠️ Nunca hacer `cr.commit()`
El framework maneja las transacciones. Solo usar en casos muy específicos con comentario explicando por qué.

---

## 🧪 Tests

```python
from odoo.tests import TransactionCase, tagged

@tagged('post_install', '-at_install')
class TestSaleOrder(TransactionCase):
    
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({
            'name': 'Test Partner'
        })
    
    def test_order_confirm(self):
        """Test order confirmation logic."""
        order = self.env['sale.order'].create({
            'partner_id': cls.partner.id,
        })
        order.action_confirm()
        self.assertEqual(order.state, 'sale')
```

### Tips Tests
- Bug fix → Test que falla sin el fix
- Usar `freezegun` para fechas
- Mock servicios externos
- Evitar depender de demo data
- Usar `@tagged('external')` para tests con servicios externos

---

## 🔄 Versionado

```
{odoo_version}.{major}.{minor}.{patch}

Ejemplo: 17.0.1.0.0

- major: Cambios en modelo/vistas (requiere migración)
- minor: Nuevas features (compatibles)
- patch: Bug fixes
```

---

## 🔗 Relacionado

- [[OCA-Commit-Messages]] - Commit message format
- [[OCA-Development-Status]] - Maturity levels
- [[OCA-PR-Checklist]] - PR checklist
- [[OCA-Maintainer-Role]] - Maintainer responsibilities
- [[OCA-Repository-Policy]] - Repository organization

#oca #guidelines #contributing #odoo
