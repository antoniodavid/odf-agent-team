# OCA Naming Conventions

Naming standards for OCA modules, files, and code elements.

## Module Naming

### General Rules

| Rule | Example | Note |
|------|---------|------|
| Singular form | `sale_order`, not `sale_orders` | Unless compound name or Odoo already plural |
| Base modules | `base_location_nuts` | Prefix with `base_` |
| Localization | `l10n_es_pos`, `l10n_mx_edi` | Prefix `l10n_CC_` where CC is country code |
| Extend Odoo module | `mail_forward`, `sale_stock_custom` | Prefix with the module name |
| OCA + Odoo combination | `crm_partner_firstname` | Odoo name goes first |

### Template Usage

Use the official [OCA module template](https://github.com/OCA/maintainer-tools/tree/master/template/module) but remove sections with no meaningful content.

## File Naming

### General Rules

Filenames should use only `[a-z0-9_]`. Use correct file permissions: folders 755 and files 644.

### Module Directory Structure

```
addons/<my_module_name>/
|-- controllers/
|-- data/
|-- demo/
|-- models/
|-- views/
|-- security/
|-- static/
|-- tests/
|-- wizards/
|-- README.rst
|-- __init__.py
|-- __manifest__.py
|-- exceptions.py
`-- hooks.py
```

### File Naming Patterns

Split files by the model involved, either created or inherited.

| File Type | Pattern | Example |
|-----------|---------|---------|
| Model | `models/<main_model>.py` | `models/sale_order.py` |
| Data | `data/<main_model>_data.xml` | `data/sale_order_data.xml` |
| Demo | `demo/<main_model>_demo.xml` | `demo/sale_order_demo.xml` |
| View | `views/<main_model>_views.xml` | `views/sale_order_views.xml` |
| Template | `templates/<main_model>_template.xml` | `templates/sale_order_template.xml` |

### Controllers

If there is only one controller file, name it `main.py`. If there are several controller classes, split them into several files.

### Static Files

Name pattern is `<module_name>.<ext>`:
- `static/js/im_chat.js`
- `static/css/im_chat.css`
- `static/xml/im_chat.xml`

Don't link to external data (images, libraries). Copy them into the codebase.

## XML ID Naming

### Data Records

Pattern: `<model_name>_<record_name>`

```xml
<record id="res_users_important_person" model="res.users">
```

### Security, View, Action

| Type | Pattern | Example |
|------|---------|---------|
| Menu | `<model_name>_menu` | `sale_order_menu` |
| View | `<model_name>_view_<type>` | `sale_order_view_form` |
| Action | `<model_name>_action` | `sale_order_action` |
| Action (detail) | `<model_name>_action_<detail>` | `sale_order_action_view_tree` |
| Group | `<model_name>_group_<name>` | `sale_order_group_user` |
| Rule | `<model_name>_rule_<group>` | `sale_order_rule_company` |

### Inherited XML

When extending a view, the inherited view ID should follow the original naming even if it doesn't match OCA conventions:

```xml
<record id="original_id" model="ir.ui.view">
    <field name="inherit_id" ref="original_module.original_id"/>
</record>
```

## Python Element Naming

### Model Names

- Use dot lowercase name: `sale.order`
- Use singular form: `sale.order` not `sale.orders`

### Method Names

| Type | Pattern | Example |
|------|---------|---------|
| Compute | `_compute_<field>` | `_compute_amount_total` |
| Inverse | `_inverse_<field>` | `_inverse_amount` |
| Search | `_search_<field>` | `_search_partner` |
| Default | `_default_<field>` | `_default_date` |
| Onchange | `_onchange_<field>` | `_onchange_partner_id` |
| Constraint | `_check_<name>` | `_check_dates` |
| Action | `action_<name>` | `_action_confirm` |

### Variable Names

| Pattern | Use | Example |
|---------|-----|---------|
| `underscore_lowercase` | Common variables | `partner_id`, `order_lines` |
| `UPPERCASE` | Constants | `MAX_RETRY`, `DEFAULT_STATE` |
| `_id` suffix | Single ID value | `partner_id = partners[0].id` |

### Field Names

```python
# Many2One - suffix _id
partner_id = fields.Many2one('res.partner')

# One2Many/Many2Many - suffix _ids
line_ids = fields.One2many('sale.order.line', 'order_id')
tag_ids = fields.Many2many('sale.tag')
```

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-python-style.md` | Python coding standards |
| `oca-xml-style.md` | XML coding standards |
| `oca-manifest-format.md` | Manifest structure |
| `oca-compliance-check.md` | Validate compliance |
