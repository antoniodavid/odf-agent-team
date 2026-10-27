# Onchange and Dynamic Form Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ONCHANGE & DYNAMIC FORM PATTERNS                                            ║
║  @api.onchange, dynamic domains, and form field updates                      ║
║  Use for interactive form behavior and field auto-population                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Onchange vs Computed

### When to Use Onchange
```python
# Onchange: user can modify the auto-filled value
@api.onchange('partner_id')
def _onchange_partner_id(self):
    """Fill address from partner (user can edit)."""
    if self.partner_id:
        self.street = self.partner_id.street
        self.city = self.partner_id.city
```

### When to Use Computed
```python
# Computed: value always derived from other fields
partner_id = fields.Many2one('res.partner')
partner_name = fields.Char(
    compute='_compute_partner_name',
    store=True,
)

@api.depends('partner_id')
def _compute_partner_name(self):
    for record in self:
        record.partner_name = record.partner_id.name or ''
```

### Combined Pattern
```python
class Order(models.Model):
    _name = 'my.order'

    partner_id = fields.Many2one('res.partner')

    # Computed (always calculated)
    partner_email = fields.Char(
        compute='_compute_partner_email',
        store=True,
    )

    # Editable (filled by onchange, user can modify)
    delivery_address = fields.Text()

    @api.depends('partner_id')
    def _compute_partner_email(self):
        for record in self:
            record.partner_email = record.partner_id.email or ''

    @api.onchange('partner_id')
    def _onchange_partner_id(self):
        """Pre-fill delivery address."""
        if self.partner_id:
            self.delivery_address = self._format_address(self.partner_id)
```

---


## Best Practices

### Do's
```python
# Good: Clear dependent fields
@api.onchange('parent_id')
def _onchange_parent_id(self):
    self.child_id = False  # Clear when parent changes

# Good: Handle empty values
@api.onchange('partner_id')
def _onchange_partner_id(self):
    if self.partner_id:
        self.phone = self.partner_id.phone
    else:
        self.phone = ''

# Good: Return domains for filtering
@api.onchange('category_id')
def _onchange_category_id(self):
    return {
        'domain': {
            'product_id': [('categ_id', '=', self.category_id.id)]
                          if self.category_id else [],
        }
    }
```

### Don'ts
```python
# Bad: Heavy computation in onchange
@api.onchange('product_id')
def _onchange_product_id(self):
    # Don't do expensive operations
    all_orders = self.env['sale.order'].search([])  # Bad!

# Bad: Database writes in onchange
@api.onchange('quantity')
def _onchange_quantity(self):
    self.env['stock.move'].create({})  # Bad! Record doesn't exist yet

# Bad: Modifying records outside self
@api.onchange('partner_id')
def _onchange_partner_id(self):
    self.partner_id.last_accessed = fields.Date.today()  # Bad!
```

---


## Summary Table

| Feature | Onchange | Computed |
|---------|----------|----------|
| Trigger | User interaction | Dependency change |
| User editable | Yes | No (unless inverse) |
| Works before save | Yes | Yes |
| Works after save | No | Yes |
| Database query | Avoid | OK with store=True |
| Return domains | Yes | No |
| Return warnings | Yes | No |
| Use case | Auto-fill suggestions | Derived values |

## Detailed examples

Read `onchange-dynamic-patterns-examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
