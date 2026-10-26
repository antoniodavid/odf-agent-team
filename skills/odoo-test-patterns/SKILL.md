---
name: odoo-test-patterns
description: "Use when writing Odoo tests: TransactionCase, HttpCase, tours, fixtures, tags, and test commands. Covers CRUD, computes, constraints, access rights, and version-specific patterns."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo Test Patterns Guide

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  TEST PATTERNS GUIDE                                                         ║
║  Comprehensive testing patterns for Odoo modules across all versions         ║
║  Generate when include_tests: true is specified                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Test File Structure

```
{module_name}/
├── tests/
│   ├── __init__.py
│   ├── common.py              # Shared test data and base classes
│   ├── test_{model_name}.py   # Model unit tests
│   ├── test_security.py       # Security/access tests
│   └── test_integration.py    # Integration tests
```


## Test Class Hierarchy

```python
# tests/__init__.py
from . import test_my_model
from . import test_security
from . import test_integration
```


## Test Tags Reference

| Tag | Meaning |
|-----|---------|
| `post_install` | Run after module installation |
| `-at_install` | Don't run during installation |
| `standard` | Standard test (default) |
| `external` | Requires external services |


## Running Tests

```bash
# Run all tests for a module
./odoo-bin -d testdb -i my_module --test-enable --stop-after-init

# Run specific test class
./odoo-bin -d testdb --test-tags my_module.TestMyModel

# Run with coverage
coverage run ./odoo-bin -d testdb -i my_module --test-enable --stop-after-init
coverage report
```


## Test Generation Checklist

For each model, generate tests for:

- [ ] Basic CRUD operations (create, read, update, delete)
- [ ] All computed fields
- [ ] All constraints (Python and SQL)
- [ ] State workflow transitions
- [ ] Access rights by user group
- [ ] Record rules (multi-company, ownership)
- [ ] Onchange methods
- [ ] Action methods (buttons)
- [ ] Copy behavior
- [ ] Batch operations

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
