# Field Type Reference — detailed examples

> Reference for the `field-type-reference` skill. Load when you need the full code.

## String Fields

### Char
```python
# Basic
name = fields.Char(string='Name')

# With constraints
name = fields.Char(
    string='Name',
    required=True,
    size=64,                    # Max length (rarely used)
    trim=True,                  # Strip whitespace (default True)
    translate=True,             # Enable translations
)

# With tracking (v15+)
name = fields.Char(
    string='Name',
    required=True,
    tracking=True,              # Track in chatter
    index=True,                 # Create index
)

# With index types (v16+)
code = fields.Char(
    string='Code',
    index='btree_not_null',     # Exclude NULL values from index
)
search_name = fields.Char(
    string='Search Name',
    index='trigram',            # For ILIKE searches
)
```

### Text
```python
description = fields.Text(
    string='Description',
    translate=True,
    tracking=True,
)
```

### Html
```python
content = fields.Html(
    string='Content',
    sanitize=True,              # Clean HTML (default True)
    sanitize_tags=True,         # Remove unsafe tags
    sanitize_attributes=True,   # Remove unsafe attributes
    sanitize_style=True,        # Clean style attributes
    strip_style=False,          # Remove all styles
    strip_classes=False,        # Remove all classes
)
```

---


## Numeric Fields

### Integer
```python
sequence = fields.Integer(
    string='Sequence',
    default=10,
    index=True,
)

count = fields.Integer(
    string='Count',
    compute='_compute_count',
    store=True,
)
```

### Float
```python
# Basic
quantity = fields.Float(string='Quantity')

# With precision
quantity = fields.Float(
    string='Quantity',
    digits='Product Unit of Measure',  # Named precision
)

# With explicit precision
amount = fields.Float(
    string='Amount',
    digits=(16, 2),                    # (total, decimal)
)

# Computed with aggregation
total = fields.Float(
    string='Total',
    compute='_compute_total',
    store=True,
    group_operator='sum',              # For group_by aggregation
)
```

### Monetary
```python
# Requires currency field
currency_id = fields.Many2one(
    comodel_name='res.currency',
    string='Currency',
    default=lambda self: self.env.company.currency_id,
)

amount = fields.Monetary(
    string='Amount',
    currency_field='currency_id',      # REQUIRED: link to currency
)

# Related currency (common pattern)
currency_id = fields.Many2one(
    comodel_name='res.currency',
    related='company_id.currency_id',
    store=True,
)
```

---


## Boolean Fields

```python
active = fields.Boolean(
    string='Active',
    default=True,
)

is_done = fields.Boolean(
    string='Done',
    compute='_compute_is_done',
    store=True,
)

# Copy behavior
copy_this = fields.Boolean(default=True)              # Copied by default
dont_copy = fields.Boolean(default=True, copy=False)  # Not copied
```

---


## Date/Time Fields

### Date
```python
date = fields.Date(
    string='Date',
    default=fields.Date.today,         # Today as default
)

date = fields.Date(
    string='Date',
    default=fields.Date.context_today, # Today in user's timezone
)

# Computed date
deadline = fields.Date(
    string='Deadline',
    compute='_compute_deadline',
    store=True,
    index=True,
)
```

### Datetime
```python
datetime = fields.Datetime(
    string='Date Time',
    default=fields.Datetime.now,       # Current datetime
)

# With copy behavior
create_datetime = fields.Datetime(
    string='Created',
    default=fields.Datetime.now,
    copy=False,
)
```

---


## Selection Fields

### Basic Selection
```python
state = fields.Selection(
    selection=[
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('done', 'Done'),
        ('cancelled', 'Cancelled'),
    ],
    string='Status',
    default='draft',
    required=True,
    tracking=True,
)
```

### Extending Selection (inheritance)
```python
# In inherited model
state = fields.Selection(
    selection_add=[
        ('approved', 'Approved'),       # Add new option
        ('rejected', 'Rejected'),
    ],
    ondelete={                          # Handle deletion (v14+)
        'approved': 'set default',
        'rejected': 'cascade',
    },
)
```

### Dynamic Selection
```python
type = fields.Selection(
    selection='_get_type_selection',
    string='Type',
)

@api.model
def _get_type_selection(self):
    return [
        ('type1', 'Type 1'),
        ('type2', 'Type 2'),
    ]
```

---


## Binary Fields

```python
# File attachment
document = fields.Binary(
    string='Document',
    attachment=True,                   # Store as attachment (recommended)
)
document_name = fields.Char(string='File Name')

# Image with auto-resize
image = fields.Image(
    string='Image',
    max_width=1920,
    max_height=1920,
)

# Image variants (automatic)
image_128 = fields.Image(
    string='Image 128',
    related='image',
    max_width=128,
    max_height=128,
    store=True,
)
```

---


## Relational Fields

### Many2one
```python
# Basic
partner_id = fields.Many2one(
    comodel_name='res.partner',
    string='Partner',
)

# With constraints
partner_id = fields.Many2one(
    comodel_name='res.partner',
    string='Partner',
    required=True,
    ondelete='cascade',                # cascade, set null, restrict
    index=True,
    tracking=True,
)

# With domain
partner_id = fields.Many2one(
    comodel_name='res.partner',
    string='Customer',
    domain=[('customer_rank', '>', 0)],
)

# Dynamic domain
partner_id = fields.Many2one(
    comodel_name='res.partner',
    string='Partner',
    domain="[('company_id', '=', company_id)]",
)

# v18+ Multi-company
partner_id = fields.Many2one(
    comodel_name='res.partner',
    string='Partner',
    check_company=True,                # REQUIRED in v18+
)
```

### One2many
```python
# Basic (REQUIRES inverse_name)
line_ids = fields.One2many(
    comodel_name='my.model.line',
    inverse_name='model_id',           # REQUIRED
    string='Lines',
)

# With copy behavior
line_ids = fields.One2many(
    comodel_name='my.model.line',
    inverse_name='model_id',
    string='Lines',
    copy=True,                         # Copy lines when record copied
)

# With domain
active_line_ids = fields.One2many(
    comodel_name='my.model.line',
    inverse_name='model_id',
    string='Active Lines',
    domain=[('active', '=', True)],
)
```

### Many2many
```python
# Basic (auto table name)
tag_ids = fields.Many2many(
    comodel_name='my.model.tag',
    string='Tags',
)

# With explicit relation table
tag_ids = fields.Many2many(
    comodel_name='my.model.tag',
    relation='my_model_tag_rel',       # Junction table name
    column1='model_id',                # This model's column
    column2='tag_id',                  # Related model's column
    string='Tags',
)

# With domain
active_tag_ids = fields.Many2many(
    comodel_name='my.model.tag',
    string='Active Tags',
    domain=[('active', '=', True)],
)
```

---


## Computed Fields

### Basic Computed
```python
full_name = fields.Char(
    string='Full Name',
    compute='_compute_full_name',
)

@api.depends('first_name', 'last_name')
def _compute_full_name(self):
    for record in self:
        record.full_name = f"{record.first_name or ''} {record.last_name or ''}".strip()
```

### Stored Computed
```python
total = fields.Float(
    string='Total',
    compute='_compute_total',
    store=True,                        # Save to database
)

@api.depends('line_ids.amount')
def _compute_total(self):
    for record in self:
        record.total = sum(record.line_ids.mapped('amount'))
```

### Inverse (Editable Computed)
```python
full_name = fields.Char(
    string='Full Name',
    compute='_compute_full_name',
    inverse='_inverse_full_name',      # Makes field editable
    store=True,
)

def _inverse_full_name(self):
    for record in self:
        if record.full_name:
            parts = record.full_name.split(' ', 1)
            record.first_name = parts[0]
            record.last_name = parts[1] if len(parts) > 1 else ''
```

### Search on Computed
```python
total = fields.Float(
    string='Total',
    compute='_compute_total',
    search='_search_total',            # Enable searching
)

def _search_total(self, operator, value):
    # Return domain that filters records
    if operator == '>':
        ids = self.search([]).filtered(lambda r: r.total > value).ids
        return [('id', 'in', ids)]
    return []
```

---


## Related Fields

```python
# Simple related
partner_name = fields.Char(
    string='Partner Name',
    related='partner_id.name',
)

# Stored related (for performance/search)
partner_name = fields.Char(
    string='Partner Name',
    related='partner_id.name',
    store=True,
    index=True,
)

# Readonly related (can't edit through this field)
partner_email = fields.Char(
    string='Partner Email',
    related='partner_id.email',
    readonly=True,
)
```

---


## Version-Specific Notes

### v14
```python
# Use track_visibility (deprecated in v15)
name = fields.Char(track_visibility='onchange')
```

### v15+
```python
# Use tracking
name = fields.Char(tracking=True)
```

### v16+
```python
# Index types
code = fields.Char(index='btree_not_null')
name = fields.Char(index='trigram')
```

### v18+
```python
# Multi-company fields
partner_id = fields.Many2one('res.partner', check_company=True)

# Type hints on model
class MyModel(models.Model):
    name: str = fields.Char(required=True)
    amount: float = fields.Float()
```

### v19+
```python
# Type hints required
class MyModel(models.Model):
    _name = 'my.model'

    name: str = fields.Char(required=True)
    active: bool = fields.Boolean(default=True)
    amount: float = fields.Monetary(currency_field='currency_id')
```

---
