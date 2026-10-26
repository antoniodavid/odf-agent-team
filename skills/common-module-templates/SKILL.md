---
name: common-module-templates
description: "Common Module Templates. Trigger: module templates, common module structure, scaffold."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Common Module Templates

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  COMMON MODULE TEMPLATES                                                     ║
║  Ready-to-use templates for extending popular Odoo apps                      ║
║  Patterns are for v18 - adjust for other versions per version guides         ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Template Index

| Target App | Template | Common Use Cases |
|------------|----------|------------------|
| Sale | sale_extension | Custom fields, workflows, reports |
| Stock | stock_extension | Warehouse operations, tracking |
| HR | hr_extension | Employee data, custom leaves |
| CRM | crm_extension | Lead scoring, custom stages |
| Accounting | account_extension | Custom reports, fiscal positions |
| Website | website_extension | Pages, snippets, themes |
| Project | project_extension | Task types, time tracking |


## Usage Instructions for Agents

When generating a module that extends a common app:

1. **Identify the target app** (sale, stock, hr, crm, project, website, account)
2. **Load this template file** as a reference
3. **Load the version-specific files** for your target version
4. **Adapt the template** to the specific requirements
5. **Apply version-specific patterns** (attrs, Command class, etc.)

### Example Agent Request
```json
{
  "action": "generate",
  "params": {
    "module_name": "sale_approval",
    "module_description": "Sale order approval workflow",
    "odoo_version": "18.0",
    "target_apps": ["sale"],
    "template_base": "sale_extension",
    "custom_features": [
      "approval_threshold_config",
      "manager_approval",
      "email_notifications"
    ]
  }
}
```

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
