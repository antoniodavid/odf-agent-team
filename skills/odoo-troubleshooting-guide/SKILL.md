---
name: odoo-troubleshooting-guide
description: "Use when diagnosing an Odoo error: version-specific failures, XML, security, ORM, performance, OWL, and install errors. Covers a quick lookup table and debug techniques."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo Troubleshooting Guide

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  TROUBLESHOOTING GUIDE                                                       ║
║  Common errors, causes, and solutions for Odoo module development            ║
║  Organized by error type and affected versions                               ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Quick Error Lookup Table

| Error Pattern | Likely Cause | Version | Solution |
|---------------|--------------|---------|----------|
| `'api' has no attribute 'multi'` | Using @api.multi | v15+ | Remove decorator |
| `attrs attribute is no longer supported` | Using attrs= | v17+ | Use invisible= |
| `create() takes 2 positional arguments` | Single create() | v17+ | Use @api.model_create_multi |
| `check_company failed` | Cross-company relation | v18+ | Add check_company=True |
| `SQL string query deprecated` | String SQL | v19 | Use SQL() builder |
| `External ID not found` | Missing XML reference | All | Check file order in manifest |
| `Access Denied` | Missing security rules | All | Add ir.model.access.csv |
| `KeyError: 'field_name'` | Field not in vals | All | Use .get() or check field |
| `RecursionError` | Circular compute | All | Check @api.depends |
| `MissingError` | Deleted record access | All | Check record.exists() |


## Common Fixes Summary

| Problem | Quick Fix |
|---------|-----------|
| Module won't install | Check `__init__.py` imports |
| Fields not showing | Upgrade module, clear cache |
| Access denied | Add ir.model.access.csv |
| View not loading | Check xpath expressions |
| Computed not updating | Check @api.depends |
| Slow performance | Use search_read, prefetch |
| v17+ attrs error | Use inline expressions |
| v17+ create error | Use @api.model_create_multi |
| v18+ company error | Add check_company=True |
| v19 SQL warning | Use SQL() builder |

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
