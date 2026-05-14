# OCA XML Style Guide

XML coding standards for OCA modules.

## Format Rules

- **Indent using 4 spaces**
- Place `id` attribute before `model`
- For field declarations, `name` attribute first, then value, then other attributes ordered by importance
- Group records by model
- Use `<data>` only for not-updatable data with `noupdate=1`
- Use `<odoo>` for `noupdate=0` or demo data
- Use `<odoo noupdate='1'>` for noupdate data
- **Do not prefix** the xmlid by the current module's name

```xml
<record id="view_id" model="ir.ui.view">
    <field name="name">view.name</field>
    <field name="model">object_name</field>
    <field name="priority" eval="16"/>
    <field name="arch" type="xml">
        <tree>
            <field name="my_field_1"/>
            <field name="my_field_2"/>
        </tree>
    </field>
</record>
```

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
| Group | `<model_name>_group_<name>` | `sale_order_group_user` |
| Rule | `<model_name>_rule_<group>` | `sale_order_rule_company` |

### Inherited XML

A module can extend a view only one time. When inheriting a view, follow naming conventions even if the original doesn't:

```xml
<record id="original_id" model="ir.ui.view">
    <field name="inherit_id" ref="original_module.original_id"/>
```

## View Inheritance

### Standard Extension

```xml
<record id="sale_order_view_form_inherit" model="ir.ui.view">
    <field name="name">sale.order.form.inherit</field>
    <field name="model">sale.order</field>
    <field name="inherit_id" ref="sale.view_order_form"/>
    <field name="arch" type="xml">
        <xpath expr="//field[@name='partner_id']" position="after">
            <field name="x_field"/>
        </xpath>
    </field>
</record>
```

### Avoid position="replace"

Avoid `position="replace"` because it can cause "Element cannot be located in parent view" errors. If necessary, use priority > 100 and include an explicit comment.

```xml
<record id="view_id" model="ir.ui.view">
    <field name="name">view.name</field>
    <field name="model">object_name</field>
    <field name="priority">110</field>
    <field name="arch" type="xml">
        <!-- Necessary because... -->
        <xpath expr="//field[@name='my_field']" position="replace">
            <field name="new_field"/>
        </xpath>
    </field>
</record>
```

## ir.filters Records

Must have explicit `user_id` field:

```xml
<record id="filter_id" model="ir.filters">
    <field name="name">My Filter</field>
    <field name="model_id">sale.order</field>
    <field name="user_id" eval="False"/>
</record>
```

## Demo Data

Suffix demo record XML IDs with `demo`:

```xml
<record id="res_users_demo_user" model="res.users">
```

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-python-style.md` | Python coding standards |
| `oca-manifest-format.md` | Manifest structure |
| `oca-naming-conv.md` | Naming conventions |
| `oca-compliance-check.md` | Validate compliance |
