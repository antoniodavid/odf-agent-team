---
trigger: buscar en odoo|search odoo|find in odoo|código odoo|odoo code
---

# Search Local Odoo Codebase

ALWAYS use local codebase before GitHub.

## Local Paths

| Version | Path | Contents |
|---------|------|----------|
| 19 | `~/Workspace/Odoo/O19/` | odoo + enterprise |
| 17 | `~/Workspace/Odoo/O17/` | odoo + enterprise |
| 16 | `~/Workspace/Odoo/O16/` | odoo + enterprise |

## Structure

```
~/Workspace/Odoo/O{version}/
├── odoo/addons/{module}/     ← Community
├── enterprise/{module}/       ← Enterprise
└── design-themes/             ← Themes
```

## Search Commands

### Python Code
```bash
grep -rn "pattern" ~/Workspace/Odoo/O19/odoo/addons/point_of_sale/ --include="*.py"
```

### JavaScript/OWL
```bash
grep -rn "pattern" ~/Workspace/Odoo/O19/odoo/addons/point_of_sale/static/src/ --include="*.js"
```

### XML Views
```bash
grep -rn "pattern" ~/Workspace/Odoo/O19/odoo/addons/point_of_sale/ --include="*.xml"
```

### Find Files
```bash
find ~/Workspace/Odoo/O19/odoo/addons/point_of_sale/ -name "*.js" -type f
```

### Module List
```bash
ls ~/Workspace/Odoo/O19/odoo/addons/ | grep pos
ls ~/Workspace/Odoo/O19/enterprise/ | grep pos
```

## Common POS Paths (v19)

```
# Community POS
~/Workspace/Odoo/O19/odoo/addons/point_of_sale/
├── static/src/app/           ← OWL components
├── static/src/customer_display/  ← Customer Screen
├── models/                   ← Python models
└── views/                    ← XML views

# Enterprise POS
~/Workspace/Odoo/O19/enterprise/pos_*/
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
