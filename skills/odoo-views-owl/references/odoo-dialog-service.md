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

### Odoo 19 (OWL 2.8.x)
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

## Detailed examples

Read `odoo-dialog-service-examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
