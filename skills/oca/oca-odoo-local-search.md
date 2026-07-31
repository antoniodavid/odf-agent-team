---
trigger: buscar en odoo|search odoo|find in odoo|código odoo|odoo code
---

# Search Local Odoo Codebase

ALWAYS use local codebase before GitHub.

## Local Paths

| Version | Path | Contents |
|---------|------|----------|
| 19 | `~/Workspace/Doodba_ENV/O19/odoo/custom/src/odoo/` | odoo + enterprise |
| 17 | `~/Workspace/Doodba_ENV/O17/odoo/custom/src/odoo/` | odoo + enterprise |
| 16 | `~/Workspace/Doodba_ENV/O16/odoo/custom/src/odoo/` | odoo + enterprise |

## Structure

```
~/Workspace/Doodba_ENV/O{version}/odoo/custom/src/odoo/
├── odoo/addons/{module}/     ← Community
├── enterprise/{module}/       ← Enterprise
└── design-themes/             ← Themes
```

## Search Commands

### Python Code
```bash
grep -rn "pattern" ~/Workspace/Doodba_ENV/O19/odoo/custom/src/odoo/addons/point_of_sale/ --include="*.py"
```

### JavaScript/OWL
```bash
grep -rn "pattern" ~/Workspace/Doodba_ENV/O19/odoo/custom/src/odoo/addons/point_of_sale/static/src/ --include="*.js"
```

### XML Views
```bash
grep -rn "pattern" ~/Workspace/Doodba_ENV/O19/odoo/custom/src/odoo/addons/point_of_sale/ --include="*.xml"
```

### Find Files
```bash
find ~/Workspace/Doodba_ENV/O19/odoo/custom/src/odoo/addons/point_of_sale/ -name "*.js" -type f
```

### Module List
```bash
ls ~/Workspace/Doodba_ENV/O19/odoo/custom/src/odoo/addons/ | grep pos
ls ~/Workspace/Doodba_ENV/O19/odoo/custom/src/enterprise/ | grep pos
```

## Common POS Paths (v19)

```
# Community POS
~/Workspace/Doodba_ENV/O19/odoo/custom/src/odoo/addons/point_of_sale/
├── static/src/app/           ← OWL components
├── static/src/customer_display/  ← Customer Screen
├── models/                   ← Python models
└── views/                    ← XML views

# Enterprise POS
~/Workspace/Doodba_ENV/O19/odoo/custom/src/enterprise/pos_*/
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
