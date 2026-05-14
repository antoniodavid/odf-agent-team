# OCA Migration Assistance

Guide version migrations using OpenUpgrade + Odoo official.

## Priority Order

1. **OpenUpgrade** `upgrade_analysis.txt` (CANONICAL)
2. **Odoo Official** CHANGELOG, breaking changes
3. **OCA Community** migration examples

## Search Commands

```python
# OpenUpgrade analysis
grep_app_searchGitHub(repo="OCA/OpenUpgrade", query="upgrade_analysis.txt sale 18.0")

# Odoo changes
grep_app_searchGitHub(repo="odoo/odoo", query="CHANGELOG 18.0")

# Community examples
grep_app_searchGitHub(repo="OCA/", query="migration 18.0")
```

## Output Format

```
## 🔄 Migration: {module} {from} → {to}

### OpenUpgrade Analysis
[From upgrade_analysis.txt]

### Breaking Changes
| Change | Impact | Action |

### Your Code Affected
| File | Line | Issue | Fix |

### Migration Scripts
Pre-migration: [SQL]
Post-migration: [SQL]

### Checklist
- [ ] Backup
- [ ] Pre-migration
- [ ] Upgrade
- [ ] Post-migration
- [ ] Test
```

## Key Tips

1. Always backup first
2. Test on staging
3. Run pre/post scripts
4. Verify data integrity
