# OCA OpenUpgrade Analysis

**CANONICAL SOURCE** for migrations. Find `upgrade_analysis.txt` in OCA/OpenUpgrade.

## File Location

```
OCA/OpenUpgrade/openupgrade_scripts/scripts/<module>/<version>/upgrade_analysis.txt
```

## Search Command

```python
grep_app_searchGitHub(
    repo="OCA/OpenUpgrade",
    query="upgrade_analysis.txt <module> <version>",
    language=["Text"]
)
```

## What upgrade_analysis.txt Contains

- **Model Changes:** Fields added/removed/renamed
- **Field Changes:** Type, property changes
- **View Changes:** Fields in views, widgets
- **XML ID Changes:** Renames
- **DB Changes:** Constraints, indexes
- **Migrations:** Pre/post SQL scripts
- **Breaking Changes:** API changes

## Output Format

```
## 📦 OpenUpgrade Analysis: {module} ({from_ver} → {to_ver})

### Model Changes
| Model | Field | Change | Action |

### Breaking Changes
| Old | New | Impact |

### Migration SQL
Pre: [sql]
Post: [sql]

### Your Affected Code
| File | Line | Issue | Fix |

### Testing Checklist
- [ ] Backup DB
- [ ] Run pre-migration
- [ ] Upgrade
- [ ] Run post-migration
- [ ] Verify data
```

## Priority Order

1. OpenUpgrade analysis (FIRST)
2. odoo/odoo CHANGELOG
3. OCA community examples
