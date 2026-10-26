---
name: import-export-patterns
description: "Use when importing or exporting Odoo data: CSV loads, programmatic import, external IDs, batch processing, and export reports. Covers validation, previews, and error reporting."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Import/Export Data Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  IMPORT/EXPORT DATA PATTERNS                                                 ║
║  CSV import, Excel export, data migration, and bulk operations               ║
║  Use for data loading, reporting exports, and system integration             ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Best Practices

1. **Validate first** - Check all rows before creating any
2. **Use transactions** - Rollback on errors
3. **Batch processing** - Commit in chunks for large imports
4. **External IDs** - Use for data that may be re-imported
5. **Error reporting** - Show row numbers and specific errors
6. **Preview mode** - Let users review before committing
7. **Template download** - Provide import template
8. **Encoding** - Handle UTF-8 properly
9. **Progress feedback** - Show import progress
10. **Logging** - Log imports for audit trail

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
