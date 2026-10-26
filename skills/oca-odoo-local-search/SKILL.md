---
name: oca-odoo-local-search
description: "Use when searching a local Odoo source tree: locate models, views, and tests with rg or find, and cite file:line evidence instead of guessing."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
  triggers: "buscar en odoo|search odoo|find in odoo|código odoo|odoo code"
---


# Search Local Odoo Codebase

ALWAYS use local codebase before GitHub.

## Local Paths

Set the root detected by `odf-init` before searching:

```bash
ODOO_SRC=<odoo-source-root>
```

| What | Path |
|------|------|
| Community addons | `$ODOO_SRC/odoo/addons/` |
| Enterprise addons | `$ODOO_SRC/enterprise/` |
| Web client | `$ODOO_SRC/odoo/addons/web/static/src/` |

## Search Commands

### Python Code
```bash
grep -rn "pattern" "$ODOO_SRC/odoo/addons/point_of_sale/" --include="*.py"
```

### JavaScript/OWL
```bash
grep -rn "pattern" "$ODOO_SRC/odoo/addons/point_of_sale/static/src/" --include="*.js"
```

### XML Views
```bash
grep -rn "pattern" "$ODOO_SRC/odoo/addons/point_of_sale/" --include="*.xml"
```

### Find Files
```bash
find "$ODOO_SRC/odoo/addons/point_of_sale/" -name "*.js" -type f
```

### Module List
```bash
ls "$ODOO_SRC/odoo/addons/" | grep pos
ls "$ODOO_SRC/enterprise/" | grep pos
```

## Common POS Paths

```text
$ODOO_SRC/odoo/addons/point_of_sale/
├── static/src/app/               ← OWL components
├── static/src/customer_display/  ← Customer Screen
├── models/                       ← Python models
└── views/                        ← XML views

$ODOO_SRC/enterprise/pos_*/
```

## DO NOT

- ❌ Use `grep_app_searchGitHub` if local exists
- ❌ Search entire codebase (be specific)
- ❌ Clone repos (already cloned)

## DO

- ✅ Use `grep -rn` for fast search
- ✅ Use `find` for file discovery
- ✅ Use `read` tool for file content
- ✅ Be specific with paths
