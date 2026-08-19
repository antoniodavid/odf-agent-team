# Odoo OWL Components - Version Dispatcher

## CRITICAL: VERSION-GATED REQUIREMENTS

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   ⚠️  MANDATORY VERSION MATCHING ⚠️                                          ║
║                                                                              ║
║   OWL APIs and bundled versions are branch-dependent.                        ║
║   Using an unverified pattern WILL cause JavaScript errors.                   ║
║   Do not infer the OWL version from this document; verify the target branch   ║
║   and its source/package metadata first.                                      ║
║                                                                              ║
║   BEFORE writing ANY OWL component, identify your Odoo version               ║
║   and load the corresponding file. This is NOT optional.                     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

## Version-Specific Files

| Target Version | OWL guidance | File to Use |
|----------------|-------------|-------------|
| Odoo 14.0 | Verify whether the target branch uses legacy JS or OWL | `odoo-owl-components-14.md` |
| Odoo 15.0+ | Verify the branch's bundled OWL API before choosing a pattern | Matching version file |
| All versions | Concepts only; not a compatibility claim | `odoo-owl-components-all.md` |

## Migration Guides

| Migration Path | File |
|----------------|------|
| 14.0 → 15.0 | `odoo-owl-components-14-15.md` (Legacy to OWL 1.x) |
| 15.0 → 16.0 | `odoo-owl-components-15-16.md` (OWL 1.x to 2.x) |
| 16.0 → 17.0 | `odoo-owl-components-16-17.md` (OWL 2.x refinements) |
| 17.0 → 18.0 | `odoo-owl-components-17-18.md` (OWL 2.x refinements) |
| 18.0 → 19.0 | `odoo-owl-components-18-19.md` (verify target-branch OWL changes) |

## Quick Reference: OWL Changes by Version

### Legacy JavaScript (use only when verified for the target branch)
```javascript
// Legacy jQuery-based
odoo.define('module.widget', function (require) {
    var Widget = require('web.Widget');
    var MyWidget = Widget.extend({
        template: 'MyTemplate',
        start: function() {
            return this._super.apply(this, arguments);
        },
    });
    return MyWidget;
});
```

### Legacy `odoo.define` + OWL API (use only when verified)
```javascript
odoo.define('module.Component', function (require) {
    const { Component } = owl;
    const { useState } = owl.hooks;

    class MyComponent extends Component {
        setup() {
            this.state = useState({ count: 0 });
        }
    }
    MyComponent.template = 'module.MyComponent';
    return MyComponent;
});
```

### ES modules + OWL API (use only when verified)
```javascript
/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";

export class MyComponent extends Component {
    static template = "module.MyComponent";
    setup() {
        this.state = useState({ count: 0 });
    }
}
registry.category("actions").add("my_action", MyComponent);
```

### ES modules + additional version-gated props (use only when verified)
```javascript
/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";

export class MyComponent extends Component {
    static template = "module.MyComponent";
    static props = {
        // Explicit prop types required
    };
    setup() {
        this.state = useState({ count: 0 });
    }
}
```

## Key Differences

| Feature | Legacy/older API | ES-module OWL API | Target-branch additions |
|---------|---------|---------|---------|
| Module system | `odoo.define` | ES modules | ES modules |
| Import syntax | `require()` | `import` | `import` |
| Hooks | `owl.hooks` | Direct import | Direct import |
| Template | Property | Static property | Static property |
| Props | Version-gated | Version-gated | Version-gated |

## OWL Detection in Existing Code

| Indicator | Version |
|-----------|---------|
| `odoo.define()` | Legacy/older module system; verify branch |
| `require('web.Widget')` | Legacy widget API; verify branch |
| `const { Component } = owl` | Older OWL API; verify branch |
| `/** @odoo-module **/` | ES-module marker; verify branch |
| `import { Component }` | ES-module OWL API; verify branch |
| `static props = {}` | Verify requirement in target branch |

## Common OWL Patterns

### Registries
- `actions` - Client actions
- `fields` - Field widgets
- `views` - View types
- `systray` - Systray items
- `main_components` - Main UI components

### Services
- `orm` - Database operations
- `action` - Navigation
- `notification` - User notifications
- `dialog` - Modal dialogs
- `user` - Current user info
- `company` - Current company

---

**REMINDER**: OWL versions are NOT backwards compatible. Always verify your Odoo version before implementing OWL components.
