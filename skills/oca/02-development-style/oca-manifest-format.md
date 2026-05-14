# OCA Manifest Format

`__manifest__.py` structure and requirements for OCA modules.

## Required Keys

```python
{
    'name': 'Module Name',
    'version': '17.0.1.0.0',
    'category': 'Sales',
    'author': 'Your Name, Odoo Community Association (OCA)',
    'website': 'https://github.com/OCA/<repo>',
    'license': 'AGPL-3',
    'depends': ['base'],
    'data': [
        'security/ir.model.access.csv',
        'views/sale_order_views.xml',
    ],
    'installable': True,
    'development_status': 'Beta',
}
```

## Manifest Rules

- **Avoid empty keys**
- `license` and `images` keys must be present
- Author text must include `, Odoo Community Association (OCA)`
- Website key must be `https://github.com/OCA/<repo>` or `https://github.com/OCA/<repo>/tree/<branch>/<addon>`
- Don't use company logo or corporate branding

## Author Format

```python
# ✅ Correct
'author': 'My Name, Odoo Community Association (OCA)'

# ❌ Incorrect
'author': 'My Name'
'author': 'My Company, OCA'
```

## Website Format

```python
# ✅ Correct
'website': 'https://github.com/OCA/sale-workflow'
'website': 'https://github.com/OCA/sale-workflow/tree/17.0/sale_partner_verification'

# ❌ Incorrect
'website': 'https://mycompany.com'
'website': 'https://github.com/mycompany/repo'
```

## Version Numbers

### Format

The version number in `__manifest__.py` should be the Odoo major version (e.g., `17.0`) followed by module `x.y.z` version numbers.

Example: `17.0.1.0.0` for first release of a 17.0 module.

### Semantic Versioning

| Part | Description |
|------|-------------|
| `x` (Major) | Significant changes to data model or views. May require data migration. |
| `y` (Minor) | New features without breaking backward compatibility. Module upgrade likely needed. |
| `z` (Patch) | Bug fixes. Server restart typically needed. |

When introducing breaking changes, include migration instructions or scripts.

## External Dependencies

### Manifest Declaration

```python
{
    'external_dependencies': {
        'bin': ['external_dependency_binary_1'],
        'python': ['external_dependency_python_1'],
    },
}
```

### Dependency Rules

- **Never pin exact versions** in the module
- May require lower bound (e.g., `external_dependency_python>1.4`) if using recent features
- May exceptionally require upper bound if incompatible with recent versions and not feasible to fix

### Dependency Guidelines

- **Never** place exact pins on dependencies
- **May** require lower bound if depending on recent library features
- **May exceptionally** place upper bound if incompatible with recent versions and not feasible to fix

If module dependencies versions are pinned or too strict, integrators may face "dependency hell" with unresolvable conflicts.

## Installation Hooks

When `pre_init_hook`, `post_init_hook`, `uninstall_hook`, and `post_load` are used, place them in `hooks.py` at module root:

```python
{
    'pre_init_hook': 'pre_init_hook',
    'post_init_hook': 'post_init_hook',
    'uninstall_hook': 'uninstall_hook',
    'post_load': 'post_load',
}
```

Add imports to `__init__.py` as needed:

```python
from .hooks import pre_init_hook, post_init_hook, uninstall_hook, post_load
```

For monkey patches, use `post_load` hook and only apply if the module is installed.

## Development Status

```python
'development_status': 'Beta',  # Alpha, Beta, Production/Stable, Mature
```

If not specified, **Beta is assumed**.

See `oca-maturity-levels.md` for requirements of each level.

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-python-style.md` | Python coding standards |
| `oca-xml-style.md` | XML coding standards |
| `oca-naming-conv.md` | Naming conventions |
| `oca-maturity-levels.md` | Development status levels |
| `oca-compliance-check.md` | Validate compliance |
