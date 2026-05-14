# OCA Suggest Improvements

Analyze code and suggest improvements.

## Check Categories

| Category | Focus |
|----------|-------|
| Security | SQL injection, XSS, permissions |
| Performance | N+1 queries, indexes, algorithms |
| Code Quality | Duplication, long methods, naming |
| Best Practices | Odoo conventions, patterns |

## Common Issues

### Security (CRITICAL)
```python
# BAD: SQL injection
cr.execute(f"SELECT * FROM t WHERE id={user_input}")

# GOOD: Parameterized
cr.execute("SELECT * FROM t WHERE id=%s", (user_input,))

# BEST: Use ORM
self.search([('id', '=', user_input)])
```

### Performance (HIGH)
```python
# BAD: N+1 queries
for order in orders:
    name = order.partner_id.name  # Query per iteration

# GOOD: Preload
names = orders.mapped('partner_id.name')
```

### Code Quality (MEDIUM)
```python
# BAD: Magic numbers
if amount > 1000:
    discount = 0.1

# GOOD: Constants
DISCOUNT_THRESHOLD = 1000
DISCOUNT_RATE = 0.10
```

## Output Format

```
## 💡 Improvements

### Critical (Do Now)
1. [Issue] → [Fix]

### High (Do Today)
1. [Issue] → [Fix]

### Medium (This Week)
1. [Issue] → [Fix]
```
