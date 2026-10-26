---
name: oca-migration-assist
description: "Use when porting an OCA module: OpenUpgrade analysis first, then changelogs and migration PRs, with idempotent scripts."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# OCA Migration Assistance

Guide version migrations using OpenUpgrade + Odoo official.

## Priority Order

1. **OpenUpgrade** `upgrade_analysis.txt` (CANONICAL)
2. **Odoo Official** CHANGELOG, breaking changes
3. **OCA Community** migration examples

## Search Commands

```bash
# OpenUpgrade analysis, cloned locally
rg -n "sale" <openupgrade-root>/upgrade_analysis.txt

# Odoo changes
git -C <odoo-source-root>/odoo log --oneline --grep "18.0" | head -20

# Community examples, when cloned locally
rg -n "migration 18.0" <oca-repos-root> --glob "*.md" | head -20
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
