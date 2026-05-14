# OCA Pattern Match

Find patterns in Odoo official + OCA community repos.

## Search Commands

```python
# Odoo Official
grep_app_searchGitHub(repo="odoo/odoo", query="@api.depends", language=["Python"])

# OCA Community
grep_app_searchGitHub(repo="OCA/", query="@api.depends", language=["Python"])
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
