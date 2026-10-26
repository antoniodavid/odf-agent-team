---
name: assets-bundling-patterns
description: "Assets Bundling Patterns. Trigger: assets bundle, ir.assets, js/css assets, web.assets."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Assets Bundling Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ASSETS BUNDLING PATTERNS                                                    ║
║  JavaScript, CSS, and SCSS asset management                                  ║
║  Use for frontend customization and OWL component registration               ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Asset Bundles Overview

### Main Bundles
| Bundle | Used In | Purpose |
|--------|---------|---------|
| `web.assets_backend` | Backend UI | JS/CSS for Odoo backend |
| `web.assets_frontend` | Website | JS/CSS for public website |
| `web.assets_common` | Both | Shared resources |
| `web.assets_qweb` | Both | QWeb templates |
| `point_of_sale.assets` | POS | Point of Sale |

---


## Best Practices

1. **Use namespaced classes** - Prefix with `.o_my_module`
2. **Follow directory structure** - Consistent file organization
3. **Use SCSS variables** - Leverage Bootstrap/Odoo variables
4. **Minimize bundle size** - Only include what's needed
5. **Lazy load heavy libs** - Don't slow initial load
6. **Support dark mode** - Use CSS variables
7. **Test with debug=assets** - Catch compilation errors
8. **Version compatibility** - Check asset syntax for version
9. **Document dependencies** - Note external libraries
10. **Clean up on uninstall** - Remove generated assets

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
