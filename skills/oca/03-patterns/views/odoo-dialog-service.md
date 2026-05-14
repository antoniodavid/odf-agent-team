# Odoo Dialog Service Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  DIALOG SERVICE PATTERNS                                                   ║
║  Confirmation, Alerts, Wizards, and Modal Dialogs in OWL                  ║
║  For Odoo 16+ (OWL 2.x/3.x)                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

## Dialog Service Overview

Odoo 16+ uses the `dialog` service for all modal interactions. The service provides a unified API for:
- Confirmation dialogs
- Alert/notification dialogs
- Form dialogs (for quick create/edit)
- Custom component dialogs
- Wizard-style dialogs

---

## Import and Setup

```javascript
/** @odoo-module **/
import { useService } from "@web/core/utils/hooks";

export class MyComponent extends Component {
    setup() {
        this.dialog = useService("dialog");
        this.notification = useService("notification");
        this.action = useService("action");
    }
}
```

---

## Confirmation Dialog

### Basic Confirmation

```javascript
this.dialog.add(ConfirmationDialog, {
    title: "Confirm Action",
    body: "Are you sure you want to proceed?",
    confirm: () => {
        // Called when user clicks "Ok"
        this.doAction();
    },
    cancel: () => {
        // Called when user clicks "Cancel"
    },
});
```

### Confirmation with Icon

```javascript
this.dialog.add(ConfirmationDialog, {
    title: "Delete Record",
    body: "This action cannot be undone. Delete this record?",
    icon: "fa fa-trash text-danger",
    confirm: () => {
        this.deleteRecord();
    },
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
});
```

### Confirmation Dialog Props

| Prop | Type | Description |
|------|------|-------------|
| `title` | string | Dialog title |
| `body` | string | Dialog message |
| `icon` | string | Font Awesome class |
| `confirm` | function | Callback on confirm |
| `cancel` | function | Callback on cancel |
| `confirmLabel` | string | Confirm button text |
| `cancelLabel` | string | Cancel button text |
| `confirmClass` | string | CSS class for confirm button |

---

## Alert Dialog

### Basic Alert

```javascript
this.dialog.add(AlertDialog, {
    title: "Warning",
    body: "This operation may have side effects.",
    confirm: () => {
        // User acknowledged
    },
});
```

### Alert with Custom Buttons

```javascript
this.dialog.add(AlertDialog, {
    title: "Import Complete",
    body: "Successfully imported 150 records.",
    confirmLabel: "View Import",
    cancelLabel: "Close",
    confirm: () => {
        this.openImportLog();
    },
});
```

---

## Form Dialog (Quick Create/Edit)

### Quick Create Form

```javascript
this.dialog.addFormView("model.name", {
    title: "Create Record",
    viewParams: {
        context: { default_user_id: this.userId },
    },
    onSave: (record) => {
        // Called when record is saved
        this.addRecord(record);
    },
});
```

### Edit Existing Record

```javascript
this.dialog.addFormView("res.partner", {
    resId: partnerId,
    title: "Edit Partner",
    onSave: (record) => {
        this.updatePartner(record);
    },
    onDiscard: () => {
        // User cancelled
    },
});
```

### Form Dialog with Custom View

```javascript
this.dialog.addFormView("sale.order", {
    resId: orderId,
    title: "Sales Order",
    viewParams: {
        context: { create: false, edit: true },
        views: [[false, "form"], [false, "tree"]],
        viewId: this.customFormViewId,
    },
    onSave: (record) => {
        this.refreshOrder(record);
    },
});
```

### Form Dialog Options

| Option | Type | Description |
|--------|------|-------------|
| `resId` | number | Record ID to edit (null for create) |
| `title` | string | Dialog title |
| `viewParams.context` | object | Context for the form |
| `viewParams.views` | array | [[view_id, "form"]] pairs |
| `viewParams.viewId` | number | Specific view to use |
| `onSave` | function | Callback with saved record |
| `onDiscard` | function | Callback when cancelled |
| `size` | string | "sm", "lg", "xl", "full" |

---

## Custom Component Dialog

### Create Custom Dialog Component

```javascript
/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { dialogService } from "@web/core/dialog/dialog_service";

export class CustomDialogPayload {
    static components = { Dialog };

    setup() {
        this.state = useState({
            value: "",
        });
    }

    get dialogTitle() {
        return "Custom Input";
    }

    confirm() {
        // Return value to caller
        this.props.close({ value: this.state.value });
    }

    cancel() {
        this.props.close();
    }
}

CustomDialogPayload.template = "my_module.CustomDialog";
```

### Template for Custom Dialog

```xml
<?xml version="1.0" encoding="utf-8"?>
<templates xml:space="preserve">
    <t t-name="my_module.CustomDialog" owl="1">
        <Dialog title="dialogTitle" modal="true" size="md">
            <div class="o_group">
                <div class="col-12">
                    <label>Enter Value</label>
                    <input type="text"
                           t-model="state.value"
                           class="form-control"/>
                </div>
            </div>
            <div class="footer">
                <button class="btn btn-secondary"
                        t-on-click="cancel">
                    Cancel
                </button>
                <button class="btn btn-primary"
                        t-on-click="confirm">
                    Confirm
                </button>
            </div>
        </Dialog>
    </t>
</templates>
```

### Open Custom Dialog

```javascript
this.dialog.add(CustomDialogPayload, {
    // props passed to component
}, {
    onClose: (result) => {
        if (result) {
            // Handle result.value
            console.log("User entered:", result.value);
        }
    },
});
```

---

## Wizard-Style Dialog

### Multi-Step Wizard

```javascript
/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

export class WizardDialog extends Component {
    setup() {
        this.state = useState({
            step: 1,
            data: {
                name: "",
                partner_id: null,
                amount: 0,
            },
        });
    }

    nextStep() {
        if (this.validateStep(this.state.step)) {
            this.state.step++;
        }
    }

    prevStep() {
        this.state.step--;
    }

    validateStep(step) {
        switch (step) {
            case 1:
                return !!this.state.data.name;
            case 2:
                return !!this.state.data.partner_id;
            default:
                return true;
        }
    }

    async confirm() {
        // Submit all data
        await this.orm.call("wizard.model", "action_submit", [this.state.data]);
        this.props.close();
    }
}

WizardDialog.template = "my_module.WizardDialog";
WizardDialog.components = { Dialog };
```

### Wizard Template

```xml
<t t-name="my_module.WizardDialog" owl="1">
    <Dialog title="Multi-Step Wizard" modal="true" size="lg">
        <!-- Progress indicator -->
        <div class="o_wizard_progress">
            <span class="o_wizard_step"
                  t-att-class="{active: state.step === 1, done: state.step > 1}">
                1. Basic Info
            </span>
            <span class="o_wizard_step"
                  t-att-class="{active: state.step === 2, done: state.step > 2}">
                2. Partner
            </span>
            <span class="o_wizard_step"
                  t-att-class="{active: state.step === 3}">
                3. Confirm
            </span>
        </div>

        <!-- Step 1 -->
        <div t-if="state.step === 1">
            <div class="mb-3">
                <label>Name</label>
                <input type="text" t-model="state.data.name" class="form-control"/>
            </div>
        </div>

        <!-- Step 2 -->
        <div t-if="state.step === 2">
            <div class="mb-3">
                <label>Partner</label>
                <field name="partner_id" widget="many2one"/>
            </div>
        </div>

        <!-- Step 3 -->
        <div t-if="state.step === 3">
            <p>Confirm submission of data?</p>
        </div>

        <!-- Footer -->
        <t t-set-slot="footer">
            <button t-if="state.step > 1"
                    class="btn btn-secondary"
                    t-on-click="prevStep">
                Back
            </button>
            <button t-if="state.step < 3"
                    class="btn btn-primary"
                    t-on-click="nextStep">
                Next
            </button>
            <button t-if="state.step === 3"
                    class="btn btn-success"
                    t-on-click="confirm">
                Submit
            </button>
        </t>
    </Dialog>
</templates>
```

---

## Notification Service (Toast)

### Basic Notification

```javascript
this.notification.add("Record saved successfully", {
    type: "success", // "info", "warning", "danger"
    duration: 5000,  // milliseconds
});
```

### Notification with Title

```javascript
this.notification.add("3 records selected", {
    title: "Selection",
    subtitle: "Ready to process",
    type: "info",
});
```

### Sticky Notification

```javascript
this.notification.add("Processing...", {
    type: "warning",
    sticky: true,  // Stays until dismissed
});
```

---

## Warning/Error Dialog

### Warning Message

```javascript
this.dialog.add(WarningDialog, {
    title: "Insufficient Stock",
    body: "The requested quantity is not available.",
});
```

### Error with Traceback

```javascript
this.dialog.add(ErrorDialog, {
    title: "Operation Failed",
    body: error.message || "An unexpected error occurred",
});
```

---

## File Download Dialog

```javascript
await this.orm.call("ir.actions.report", "action_report", [report_id], {
    report_type: "pdf",
});
// Odoo handles download automatically
```

---

## Selection Dialog (Pick from List)

```javascript
this.dialog.add(SelectionDialog, {
    title: "Select Partner",
    list: [
        { label: "Partner A", value: 1 },
        { label: "Partner B", value: 2 },
        { label: "Partner C", value: 3 },
    ],
    onSelect: (item) => {
        this.partnerId = item.value;
    },
});
```

---

## Loading Dialog

```javascript
// Show loading
const dialog = this.dialog.add(LoadingDialog, {
    title: "Loading",
});

// Close loading (usually automatic)
dialog.close();
```

---

## Dialog Size Classes

```javascript
this.dialog.add(Component, {}, {
    size: "sm",   // 300px
    // or
    size: "md",   // 600px (default)
    // or
    size: "lg",   // 900px
    // or
    size: "xl",   // 1200px
    // or
    size: "full", // 100%
});
```

---

## Version Notes

### Odoo 19 (OWL 3.x)
- Dialog service API unchanged from OWL 2.x
- Use new `useService` hook pattern

### Odoo 16-18 (OWL 2.x)
- Original dialog service implementation
- ConfirmationDialog, AlertDialog, WarningDialog, ErrorDialog

### Common Imports

```javascript
// OWL Components
import { Component, useState, useRef } from "@odoo/owl";

// Services
import { useService } from "@web/core/utils/hooks";

// Dialog Components
import { Dialog } from "@web/core/dialog/dialog";
import { ConfirmationDialog } from "@web/core/dialog/ confirmation_dialog";
import { AlertDialog } from "@web/core/dialog/alert_dialog";
import { WarningDialog } from "@web/core/dialog/warning_dialog";
import { LoadingDialog } from "@web/core/dialog/loading_dialog";
```

---

## Best Practices

1. **Always handle cancel/discard** - User might close dialog without action
2. **Use appropriate sizes** - Don't use full size for simple confirmations
3. **Set clear titles** - User should know what they're confirming
4. **Use notifications for non-blocking** - For success after background action
5. **Form dialogs for CRUD** - Quick create/edit without leaving current view
6. **Custom dialogs for complex UI** - Multi-step wizards, custom inputs

---

## Debugging Dialogs

### Check Dialog Service Available
```javascript
setup() {
    if (!this.dialog) {
        console.warn("Dialog service not available");
    }
}
```

### Dialog Not Opening
- Check if component is properly mounted
- Verify service import: `useService("dialog")`
- Check console for JavaScript errors