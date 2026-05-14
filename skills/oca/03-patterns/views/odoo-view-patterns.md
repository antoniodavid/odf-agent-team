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

## Form View (Complete)

### Basic Form Structure

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_model_form" model="ir.ui.view">
        <field name="name">model.form</field>
        <field name="model">model.name</field>
        <field name="arch" type="xml">
            <form string="Title">
                <!-- Header with statusbar -->
                <header>
                    <button name="action_confirm" string="Confirm" type="object" class="btn-primary"/>
                    <field name="state" widget="statusbar"/>
                </header>

                <!-- Sheet container -->
                <sheet>
                    <!-- Group for fields -->
                    <group>
                        <group>
                            <field name="name"/>
                            <field name="partner_id"/>
                            <field name="date"/>
                        </group>
                        <group>
                            <field name="amount"/>
                            <field name="category_id"/>
                        </group>
                    </group>

                    <!-- Notebook for tabs -->
                    <notebook>
                        <page string="Details" name="details">
                            <field name="line_ids">
                                <tree editable="bottom">
                                    <field name="product_id"/>
                                    <field name="quantity"/>
                                    <field name="price_unit"/>
                                    <field name="price_subtotal"/>
                                </tree>
                            </field>
                        </page>
                        <page string="Notes" name="notes">
                            <field name="description" placeholder="Add notes..."/>
                        </page>
                    </notebook>
                </sheet>

                <!-- Chatter/mail thread -->
                <div class="oe_chatter">
                    <field name="message_follower_ids"/>
                    <field name="activity_ids"/>
                    <field name="message_ids"/>
                </div>
            </form>
        </field>
    </record>
</odoo>
```

### Common Widgets

| Widget | Use | Example |
|--------|-----|---------|
| `statusbar` | State field with workflow | `<field name="state" widget="statusbar"/>` |
| `many2one` | Relation field | Default widget |
| `selection` | Dropdown | Default for selection |
| `text` | Multi-line text | `<field name="notes" widget="text"/>` |
| `mail_thread` | Chatter display | `<field name="message_ids" widget="mail_thread"/>` |
| `mail_activity` | Activity mixin | `<field name="activity_ids" widget="mail_activity"/>` |
| `progressbar` | Progress indicator | `<field name="progress" widget="progressbar"/>` |
| `handle` | Drag handle | `<field name="sequence" widget="handle"/>` |
| `statinfo` | Statistics | `<field name="order_count" widget="statinfo"/>` |
| `priority` | Star rating | `<field name="priority" widget="priority"/>` |
| `badge` | Badge display | `<field name="state" widget="badge"/>` |
| `image` | Image preview | `<field name="image" widget="image"/>` |
| `pdf_viewer` | PDF display | `<field name="file" widget="pdf_viewer"/>` |

### Field Attributes

```xml
<!-- Readonly -->
<field name="amount" readonly="1"/>

<!-- Required -->
<field name="name" required="1"/>

<!-- Invisible -->
<field name="internal_note" invisible="1"/>

<!-- Placeholder -->
<field name="email" placeholder="user@company.com"/>

<!-- Help tooltip -->
<field name="amount" help="Total amount in company currency"/>

<!-- Force save -->
<field name="computed_field" force_save="1"/>
```

### Domains (Conditional Display)

```xml
<!-- Show field only if state is draft -->
<field name="approval_date" invisible="state != 'draft'"/>

<!-- Enable only for certain groups -->
<field name="admin_note" readonly="not user_has_groups('base.group_system')"/>

<!-- Conditional required -->
<field name="end_date" required="date_start and state == 'done'"/>
```

---

## List/Tree View (Complete)

### Basic List Structure

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_model_list" model="ir.ui.view">
        <field name="name">model.list</field>
        <field name="model">model.name</field>
        <field name="arch" type="xml">
            <tree>
                <field name="sequence" widget="handle"/>
                <field name="name"/>
                <field name="partner_id"/>
                <field name="amount" sum="Total"/>
                <field name="date"/>
                <field name="state"/>
            </tree>
        </field>
    </record>
</odoo>
```

### Editable List

```xml
<tree editable="bottom">
    <!-- or editable="top" -->
    <field name="product_id"/>
    <field name="quantity" editable="readonly"/>
    <field name="price_unit"/>
</tree>
```

### Tree Decorations

```xml
<tree decoration-info="state == 'draft'"
      decoration-success="state in ('done', 'paid')"
      decoration-danger="state == 'cancel'"
      decoration-muted="state == 'archived'">
    <field name="name"/>
    <field name="state"/>
</tree>
```

### Aggregate/Sum in List

```xml
<field name="amount" sum="Total Amount"/>
<field name="quantity" avg="Average Quantity"/>
<field name="unit_price" avg="Avg Price"/>
```

### Colors in List

```xml
<tree colors="red:state=='cancel';blue:state=='done'">
    <field name="name"/>
    <field name="state"/>
</tree>
```

---

## Kanban View (Complete)

### Basic Kanban Structure

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_model_kanban" model="ir.ui.view">
        <field name="name">model.kanban</field>
        <field name="model">model.name</field>
        <field name="arch" type="xml">
            <kanban>
                <!-- Kanban header with grouping -->
                <field name="stage_id"/>
                <templates>
                    <t t-name="kanban-box">
                        <div class="oe_kanban_global_click">
                            <!-- Card header -->
                            <div class="oe_kanban_header">
                                <field name="name" class="fw-bold"/>
                                <field name="partner_id"/>
                            </div>

                            <!-- Card body -->
                            <div class="oe_kanban_body">
                                <field name="amount"/>
                                <field name="date_deadline"/>
                            </div>

                            <!-- Card footer with avatars -->
                            <div class="oe_kanban_footer">
                                <field name="user_id" widget="many2one_avatar_user"/>
                            </div>

                            <!-- Progress bar -->
                            <field name="progress" widget="progressbar"/>
                        </div>
                    </t>
                </templates>
            </kanban>
        </field>
    </record>
</odoo>
```

### Kanban with Quick Create

```xml
<kanban quick_create_view="quick_create_form">
    <field name="name"/>
    <!-- ... -->
</kanban>

<!-- Quick create form -->
<record id="quick_create_form" model="ir.ui.view">
    <field name="name">model.quick_create</field>
    <field name="model">model.name</field>
    <field name="arch" type="xml">
        <form>
            <field name="name"/>
        </form>
    </field>
</record>
```

### Kanban with Image

```xml
<kanban class="o_res_partner_kanban">
    <field name="image_128"/>
    <field name="name"/>
    <templates>
        <t t-name="kanban-box">
            <div class="oe_kanban_global_click">
                <div class="o_kanban_image">
                    <field name="image_128" widget="image" options="{'size': [40, 40]}"/>
                </div>
                <div class="oe_kanban_details">
                    <field name="name"/>
                </div>
            </div>
        </t>
    </templates>
</kanban>
```

---

## Search View

### Basic Search Structure

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_model_search" model="ir.ui.view">
        <field name="name">model.search</field>
        <field name="model">model.name</field>
        <field name="arch" type="xml">
            <search>
                <!-- Basic fields -->
                <field name="name"/>
                <field name="partner_id"/>
                <field name="user_id"/>

                <!-- Filters -->
                <filter string="My Records" name="my_records"
                        domain="[('user_id', '=', uid)]"/>
                <filter string="Draft" name="draft"
                        domain="[('state', '=', 'draft')]"/>
                <filter string="Done" name="done"
                        domain="[('state', '=', 'done')]"/>

                <!-- Group By -->
                <group expand="0" string="Group By">
                    <filter string="Partner" name="partner"
                            context="{'group_by': 'partner_id'}"/>
                    <filter string="Date" name="date"
                            context="{'group_by': 'date:month'}"/>
                    <filter string="State" name="state"
                            context="{'group_by': 'state'}"/>
                </group>
            </search>
        </field>
    </record>
</odoo>
```

### Search with Custom Filter

```xml
<search>
    <field name="name" string="Name"/>
    <field name="reference" string="Reference"/>

    <!-- Filter with domain -->
    <filter string="Overdue" name="overdue"
            domain="[('date_deadline', '<', context_today())]"/>

    <!-- Filter with context (toggle) -->
    <filter string="My Tasks" name="my_tasks"
            context="{'key': 'my_tasks'}"/>

    <group expand="1" string="Filters">
        <filter string="High Priority" name="high_priority"
                domain="[('priority', '=', 'high')]"/>
    </group>
</search>
```

---

## Calendar View

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_model_calendar" model="ir.ui.view">
        <field name="name">model.calendar</field>
        <field name="model">model.name</field>
        <field name="arch" type="xml">
            <calendar date_start="date_start"
                      date_stop="date_stop"
                      date_delay="duration"
                      color="user_id"
                      mode="month"
                      quick_create="1">
                <field name="name"/>
                <field name="partner_id"/>
                <field name="user_id"/>
            </calendar>
        </field>
    </record>
</odoo>
```

### Calendar Attributes

| Attribute | Description |
|-----------|-------------|
| `date_start` | Start date field |
| `date_stop` | End date field |
| `date_delay` | Duration field |
| `color` | Color by field |
| `mode` | Default view: `day`, `week`, `month` |
| `quick_create` | Enable quick create |
| `event_open_popup` | Open in popup |

---

## Pivot View

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_model_pivot" model="ir.ui.view">
        <field name="name">model.pivot</field>
        <field name="model">model.name</field>
        <field name="arch" type="xml">
            <pivot>
                <field name="amount" type="measure"/>
                <field name="quantity" type="measure"/>
                <field name="partner_id" type="row"/>
                <field name="date" interval="month" type="col"/>
            </pivot>
        </field>
    </record>
</odoo>
```

### Pivot Measures

```xml
<field name="amount" type="measure"/>
<!-- type="measure" = sum -->
<!-- type="row" = group by row -->
<!-- type="col" = group by column -->
```

---

## Graph View

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_model_graph" model="ir.ui.view">
        <field name="name">model.graph</field>
        <field name="model">model.name</field>
        <field name="arch" type="xml">
            <graph type="bar" orientation="vertical">
                <field name="partner_id" type="row"/>
                <field name="amount" type="measure"/>
                <field name="date" interval="month" type="col"/>
            </graph>
        </field>
    </record>
</odoo>
```

### Graph Types

| Type | Description |
|------|-------------|
| `bar` | Bar chart |
| `pie` | Pie chart |
| `line` | Line chart |
| `bar_stacked` | Stacked bar |

---

## Activity View

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_model_activity" model="ir.ui.view">
        <field name="name">model.activity</field>
        <field name="model">model.name</field>
        <field name="arch" type="xml">
            <activity string="Activities"
                      date_start="date"
                      date_stop="date_deadline">
                <field name="user_id" avatar_field="avatar_128"/>
                <templates>
                    <div t-name="activity-template">
                        <div class="o_activity">
                            <field name="name"/>
                        </div>
                    </div>
                </templates>
            </activity>
        </field>
    </record>
</odoo>
```

---

## Window Action with Views

```xml
<!-- Action that opens specific views -->
<record id="action_model" model="ir.actions.act_window">
    <field name="name">Records</field>
    <field name="res_model">model.name</field>
    <field name="view_mode">tree,form,kanban,calendar,pivot,graph</field>
    <field name="view_ids" eval="[
        (5, 0, {'view_mode': 'tree', 'view_id': ref('view_model_list')}),
        (0, 0, {'view_mode': 'form', 'view_id': ref('view_model_form')}),
        (0, 0, {'view_mode': 'kanban', 'view_id': ref('view_model_kanban')}),
    ]"/>
    <field name="context">{
        'default_partner_id': partner_id,
        'search_default_my_records': 1,
    }</field>
    <field name="domain">[('state', '!=', 'cancel')]</field>
</record>
```

---

## Common Patterns

### Button Box (Smart Buttons)

```xml
<div class="oe_button_box" name="button_box">
    <button class="oe_stat_button" type="object" name="action_view_orders">
        <field string="Orders" name="order_count" widget="statinfo"/>
    </button>
    <button class="oe_stat_button" type="object" name="action_view_invoices">
        <field string="Invoices" name="invoice_count" widget="statinfo"/>
    </button>
</div>
```

### Chatter/Mail Thread

```xml
<div class="oe_chatter" name="chatter">
    <field name="message_follower_ids" widget="mail_followers"/>
    <field name="activity_ids" widget="mail_activity"/>
    <field name="message_ids" widget="mail_thread"/>
</div>
```

### Notebook with Pages

```xml
<notebook>
    <page string="Main" name="main">
        <!-- Main content -->
    </page>
    <page string="Settings" name="settings" groups="base.group_system">
        <!-- Admin settings -->
    </page>
    <page string="History" name="history">
        <!-- Audit trail -->
    </page>
</notebook>
```

### Group (Two-Column Layout)

```xml
<group>
    <group name="left">
        <field name="field1"/>
        <field name="field2"/>
    </group>
    <group name="right">
        <field name="field3"/>
        <field name="field4"/>
    </group>
</group>
```

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

## Debugging Views

### Check View Inheritance
```python
# Get the actual arch of a view
view = env['ir.ui.view'].search([('model', '=', 'sale.order')])
print(view.get_view(view.id)['arch'])
```

### View Inheritance Check
```bash
# List all views for a model
grep -r "model=\"sale.order\"" addons/
```

### Common Errors
- `Field does not exist` → Check field name in model
- `Invalid XML` → Check all tags closed
- `View type not found` → Check view mode in action