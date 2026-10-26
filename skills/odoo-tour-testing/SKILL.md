---
name: odoo-tour-testing
description: "Odoo Tour Testing. Trigger: tour test, qUnit tour, HttpCase UI, chrome tour."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo Tour Testing Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  TOUR TESTING PATTERNS                                                     ║
║  QUnit tours, HTTPCase tours, and UI automation in Odoo                   ║
║  For Odoo 16+                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Tour System Overview

Odoo tours are automated UI tests that simulate user interactions:
- **QUnit Tours**: JavaScript-based, run in browser
- **HTTPCase Tours**: Python-based, test full stack with browser
- **Tour Builder**: Define steps in JavaScript, executed by Odoo

---


## Tour Best Practices

### Step Naming

```javascript
// Good: descriptive IDs
{ id: "click_customer_dropdown", ... }
{ id: "select_customer_acme", ... }
{ id: "verify_order_created", ... }

// Bad: generic IDs
{ id: "step_1", ... }
{ id: "click_button", ... }
```

### Content Descriptions

```javascript
// Good: specific action
content: "Click 'Add a line' to add order line"

// Bad: vague
content: "Click here"
content: "Add line"
```

### Waiting for Elements

```javascript
// Explicit wait for element
{
    id: "wait_for_modal",
    trigger: ".o_modal",
    auto: true,  // Auto-click when visible
},

// Wait for data loaded
{
    id: "wait_for_data",
    trigger: ".o_field_widget[name='amount']",
    run: function () {
        // Check data loaded
        if (!document.querySelector(".o_field_widget[name='amount'] .o_input")) {
            return "retry";
        }
    },
},
```

### Error Handling

```javascript
// Retry on transient error
{
    id: "save_with_retry",
    trigger: ".o_form_button_save",
    run: function () {
        const btn = document.querySelector(".o_form_button_save");
        if (btn.disabled) {
            return "retry";  // Retry step
        }
        btn.click();
    },
},

// Explicit error
{
    id: "verify_error",
    trigger: ".o_notification_manager .o_notification",
    run: function () {
        const error = document.querySelector(".o_notification_title");
        if (!error.textContent.includes("Error")) {
            throw new Error("Expected error notification");
        }
    },
},
```

---


## Version Notes

### Odoo 17+
- New tour API with `params` support
- Better async step handling

### Odoo 16
- Original tour system
- Use `run: "text"` for inputs

### Best Practices

1. **Unique step IDs** - Avoid conflicts
2. **Specific triggers** - Use `data-menu-xmlid` over CSS classes
3. **Descriptive content** - Helps debugging
4. **Handle async** - Use `async function` for complex interactions
5. **Test both editions** - Use `edition` property
6. **Clean up data** - Use `at_install` tag for data setup tours

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
