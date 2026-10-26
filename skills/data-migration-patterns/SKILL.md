---
name: data-migration-patterns
description: "Use when writing Odoo migration scripts: migrations pre and post, OpenUpgrade analysis, batching, testing, and idempotency. Covers renamed or removed fields and irreversible steps."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Data Migration and Upgrade Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  DATA MIGRATION PATTERNS                                                     ║
║  Version upgrades, data transformation, and migration scripts                ║
║  Use for module upgrades, data fixes, and version transitions                ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Best Practices

### 1. Always Check Version
```python
def migrate(cr, version):
    if not version:
        return  # Fresh install
    # Migration code
```

### 2. Use Logging
```python
_logger.info("Starting migration from %s", version)
_logger.info("Migrated %d records", count)
_logger.warning("Skipped %d invalid records", skipped)
```

### 3. Handle Errors Gracefully
```python
def migrate(cr, version):
    try:
        # Migration code
    except Exception as e:
        _logger.error("Migration failed: %s", e)
        raise
```

### 4. Make Idempotent
```python
# Good - can run multiple times
cr.execute("""
    UPDATE my_model
    SET new_field = old_field
    WHERE new_field IS NULL  -- Only unmigrated
""")

# Bad - breaks on re-run
cr.execute("""
    UPDATE my_model
    SET new_field = old_field
""")
```

### 5. Commit Large Operations
```python
for i, record in enumerate(records):
    record.migrate()
    if i % 1000 == 0:
        cr.commit()
        env.invalidate_all()
```

### 6. Test Before Production
```python
# Run on copy of production database
# Verify data integrity after migration
# Check performance with realistic data volumes
```

### 7. Installing Modules During Migration
```python
# Good - use button_install() during migration
def migrate(cr, version):
    """Install dependency module during migration."""
    env = api.Environment(cr, SUPERUSER_ID, {})

    module = env['ir.module.module'].search([
        ('name', '=', 'required_module'),
        ('state', '!=', 'installed'),
    ])

    if module:
        module.button_install()
        _logger.info("Queued installation of %s", module.name)

# Bad - causes UserError during migration
def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    module = env['ir.module.module'].search([
        ('name', '=', 'required_module'),
    ])
    module._button_immediate_install()  # ERROR: Cannot be called on non-loaded registries
```

**Why**: During migration, the registry is not fully loaded. The `_button_immediate_install()` method requires a complete registry and will raise:
```
odoo.exceptions.UserError: The method _button_immediate_install cannot be called on init or non loaded registries. Please use button_install instead.
```

Use `button_install()` which queues the installation to happen after the registry is properly initialized.

---

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
