# Odoo Tour Testing — detailed examples

> Reference for the `odoo-tour-testing` skill. Load when you need the full code.

## QUnit Tours (JavaScript)

### Basic Tour Structure

```javascript
/** @odoo-module **/
import { registry } from "@web/core/registry";

registry.category("web_tour.tours").add("my_tour_name", {
    url: "/web",
    steps: [
        {
            id: "start_button",
            content: "Click start button",
            trigger: ".o_button_start",
        },
        {
            id: "fill_name",
            content: "Enter the name",
            trigger: "input[name='name']",
            run: "test",
        },
        {
            id: "confirm",
            content: "Click confirm",
            trigger: ".btn-confirm",
        },
    ],
});
```

### Tour with Form Fill

```javascript
registry.category("web_tour.tours").add("sale_order_tour", {
    url: "/web",
    steps: [
        {
            id: "go_to_sales",
            content: "Go to Sales",
            trigger: ".o_menu_item[data-menu-xmlid='sales_team.menu_sales']",
        },
        {
            id: "create_order",
            content: "Create new order",
            trigger: ".o_list_button_add",
        },
        {
            id: "select_partner",
            content: "Select partner",
            trigger: ".o_field_widget[name='partner_id'] input",
            run: async function (helpers) {
                await helpers.click(".ui-menu-item:first");
            },
        },
        {
            id: "add_line",
            content: "Add product line",
            trigger: ".o_field_x2many .o_field_widget[name='order_line'] .fa-plus",
        },
        {
            id: "fill_line",
            content: "Fill product details",
            trigger: "tr.o_data_row:first .o_field_widget[name='product_id'] input",
            run: "text Product A",
        },
        {
            id: "save",
            content: "Save order",
            trigger: ".o_form_button_save",
        },
    ],
});
```

### Tour with Assertions

```javascript
registry.category("web_tour.tours").add("sale_order_assert_tour", {
    url: "/web",
    steps: [
        // ... steps to create order ...
        {
            id: "check_amount",
            content: "Verify amount is calculated",
            trigger: ".o_field_widget[name='amount_total'] .o_form_integer",
            run: function () {
                const amount = document.querySelector(".o_field_widget[name='amount_total']").textContent;
                if (!amount.includes("100")) {
                    throw new Error("Amount not calculated correctly");
                }
            },
        },
    ],
});
```

---


## Tour Steps Reference

### Trigger Types

| Trigger Type | Example | Use Case |
|--------------|---------|----------|
| CSS Selector | `.o_button` | Click buttons |
| Attribute | `[data-menu-xmlid='...']` | Menu items |
| Text Content | `text:Submit` | Link text |
| Position | `first`.o_button | First matching |
| Multiple | `.a, .b` | Any match |

### Run Actions

```javascript
// Click
run: "click"

// Fill text input
run: "text My Value"

// Fill and select from dropdown
run: async function (helpers) {
    await helpers.edit("Value", ".selector");
    await helpers.click(".ui-menu-item:first");
}

// Drag and drop
run: "drag_and_drop .source, .target"

// Select dropdown option
run: "select 2"

// Check checkbox
run: "check"

// Uncheck
run: "uncheck"

// Press key
run: function () {
    document.querySelector("input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}
```

### Step Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Step identifier |
| `content` | string | User-facing instruction |
| `trigger` | string | CSS selector or text trigger |
| `run` | string/function | Action to perform |
| `edition` | string | "community", "enterprise", or "both" |
| `mobile` | boolean | Run on mobile |
| `invalidate` | function | Custom validation |

---


## HTTPCase Tours (Python)

### Basic HTTPCase Tour

```python
from odoo.tests import HttpCase, tagged

@tagged('post_install', '-at_install', 'my_tour')
class TestSaleOrder(HttpCase):

    def setUp(self):
        super().setUp()
        self.partner = self.env['res.partner'].create({
            'name': 'Test Partner',
        })

    def test_sale_order_tour(self):
        """Test sale order creation via tour."""
        self.start_tour(
            '/web',
            'sale_order_creation_tour',
            login='admin',
        )
        # Verify order was created
        order = self.env['sale.order'].search([
            ('partner_id', '=', self.partner.id)
        ], limit=1)
        self.assertTrue(order)

    def test_sale_order_with_data(self):
        """Test with pre-created data."""
        # Create order before tour
        order = self.env['sale.order'].create({
            'partner_id': self.partner.id,
        })
        self.start_tour(
            '/web',
            'sale_order_edit_tour',
            login='admin',
            # Pass data to tour
            params={
                'order_id': order.id,
            },
        )
```

### HTTPCase with Tour Parameters

```python
def test_with_parameters(self):
    partner = self.env['res.partner'].create({
        'name': 'Test Partner',
    })
    product = self.env['product.product'].create({
        'name': 'Test Product',
        'list_price': 100.0,
    })

    self.start_tour(
        '/web',
        'sale_order_with_data_tour',
        login='admin',
        params={
            'partner_id': partner.id,
            'product_id': product.id,
        },
    )
```

### JavaScript Tour with Parameters

```javascript
registry.category("web_tour.tours").add("sale_order_with_data_tour", {
    url: "/web",
    params: {
        partner_id: 1,
        product_id: 1,
    },
    steps: [
        {
            id: "go_to_sales",
            trigger: "[data-menu-xmlid='sales_team.menu_sales']",
        },
        {
            id: "create_order",
            trigger: ".o_list_button_add",
        },
        {
            id: "select_partner",
            trigger: "[name='partner_id'] input",
            run: function (helpers) {
                // Use param passed from Python
                const partnerId = this.params.partner_id;
                // Find and click the partner
            },
        },
    ],
});
```

---


## Running Tours

### Run Single Tour

```bash
# From terminal
odoo-bin -d dbname --test-enable --tour my_tour

# Or with full path
odoo-bin -d dbname --test-enable --tour module.tour_name
```

### Run All Tours

```bash
odoo-bin -d dbname --test-enable
```

### Run with Specific Module

```python
# In test file
@tagged('-at_install', 'post_install', 'my_tour')
class TestMyModule(HttpCase):
    def test_my_tour(self):
        self.start_tour('/web', 'my_module.my_tour', login='admin')
```

---


## Tour Debugging

### Enable Tour Debug Mode

```javascript
// In browser console
odoo.debug = true;

// Tours will highlight steps
localStorage.setItem('tour_debug', 'true');
```

### Check Tour Registry

```javascript
// List all registered tours
console.log(odoo.__DEBUG__.tours);

// Run specific tour manually
odoo.__DEBUG__.tours['tour_name'].run();
```

### Tour not Starting

1. Check browser console for errors
2. Verify tour is registered: `registry.category("web_tour.tours")`
3. Check trigger selector exists in DOM
4. Add `auto: true` for automatic trigger

---


## Enterprise vs Community

### Edition-Specific Tours

```javascript
registry.category("web_tour.tours").add("my_tour", {
    steps: [
        // All editions
        {
            id: "common_step",
            content: "This applies to all",
            trigger: ".o_button",
        },
        // Enterprise only
        {
            id: "enterprise_feature",
            edition: "enterprise",
            content: "Enterprise feature",
            trigger: ".o_enterprise_button",
        },
        // Community only
        {
            id: "community_feature",
            edition: "community",
            content: "Community feature",
            trigger: ".o_community_button",
        },
    ],
});
```

### Feature Detection in Tours

```javascript
{
    id: "conditional_step",
    trigger: ".o_feature_dependent",
    run: function () {
        // Check if feature available
        if (document.querySelector(".o_enterprise_feature")) {
            // Do something
        }
    },
}
```

---


## Common Tour Patterns

### Create Record

```javascript
{
    id: "create_record",
    trigger: ".o_list_button_add",
    run: "click",
},
{
    id: "fill_required_field",
    trigger: "[name='name'] input",
    run: "text New Record",
},
{
    id: "save",
    trigger: ".o_form_button_save",
    run: "click",
},
```

### Edit Record

```javascript
{
    id: "open_record",
    trigger: ".o_data_cell:first",
    run: "click",
},
{
    id: "edit_field",
    trigger: "[name='name'] input",
    run: function (helpers) {
        helpers.edit("Updated Name", "[name='name'] input");
    },
},
{
    id: "save_changes",
    trigger: ".o_form_button_save",
    run: "click",
},
```

### Delete Record

```javascript
{
    id: "select_record",
    trigger: ".o_data_row:first .o_checkbox",
    run: "check",
},
{
    id: "action_menu",
    trigger: ".o_action_manager .o_list_export_xlsx",
},
{
    id: "delete",
    trigger: "text:Delete",
    run: "click",
},
{
    id: "confirm_delete",
    trigger: ".o_dialog .btn-primary",
    run: "click",
},
```

### Search and Filter

```javascript
{
    id: "open_search",
    trigger: ".o_searchview input",
    run: "click",
},
{
    id: "type_search",
    trigger: ".o_searchview input",
    run: "text Partner Name",
},
{
    id: "apply_filter",
    trigger: ".o_searchview button[aria-label='Search']",
    run: "click",
},
{
    id: "use_filter",
    trigger: ".o_filter_menu .o_menu_item:contains('My Records')",
    run: "click",
},
```

---
