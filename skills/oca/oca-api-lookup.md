# OCA API Lookup

Search Odoo official API from `odoo/odoo` repository.

## Search Command

```python
grep_app_searchGitHub(
    repo="odoo/odoo",
    query="@api.depends",  # or other API
    language=["Python"]
)
```

## Common APIs

| Decorator | Purpose |
|-----------|---------|
| `@api.depends` | Computed fields (stored) |
| `@api.onchange` | Form field changes (UI only) |
| `@api.constrains` | Validation |
| `@api.model` | Doesn't need recordset |
| `@api.model_create_multi` | Batch create |

## Output Format

```
## 🔍 API: @api.depends

### Signature
@api.depends('field1', 'field2')
def _compute_field(self):
    for record in self:
        record.field = ...

### Example from odoo/odoo
[Show 1-2 real examples from search]

### Best Practices
- Loop through self
- Handle edge cases
- Use for stored computed fields

### Common Mistakes
- Using @api.onchange for stored fields (wrong)
- Not looping through recordset
```

## When to Use

- Learning Odoo APIs
- Verifying correct usage
- Finding official examples
