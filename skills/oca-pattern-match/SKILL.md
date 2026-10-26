---
name: oca-pattern-match
description: "Use when looking for an Odoo or OCA pattern: search local source or odoo/odoo, match the target version, and report file:line."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# OCA Pattern Match

Find patterns in Odoo official + OCA community repos.

## Search Commands

```bash
# Odoo official source (resolved by odf-init)
rg -n "@api.depends" <odoo-source-root>/odoo --glob "*.py" | head -20

# OCA community source, when cloned locally
rg -n "@api.depends" <oca-repos-root> --glob "*.py" | head -20
```

## When to Use Each

| Use Case | Primary | Secondary |
|----------|---------|-----------|
| Official API | odoo/odoo | - |
| Framework patterns | odoo/odoo | OCA/* |
| Best practices | OCA/* | odoo/odoo |
| Testing patterns | odoo/odoo | OCA/* |
| Performance | OCA/* | odoo/odoo |

## Output Format

```
## 🔍 Pattern: {query}

### 🏛️ Official Odoo
File: addons/sale/models/sale.py:45
[code example]

### 🌟 OCA Community
File: OCA/sale-workflow/model.py:23
[code example]

### 📊 Comparison
| Aspect | Official | OCA |
|--------|----------|-----|

### 💡 Recommendation
Use [Official/OCA] because...

[Adapted code for user's context]
```
