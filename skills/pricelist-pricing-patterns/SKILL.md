---
name: pricelist-pricing-patterns
description: "Use when implementing Odoo pricing: pricelists, rules, quantity breaks, currencies, dates, and customer-specific prices. Covers sequence, rounding, and price computation."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Pricelist and Pricing Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  PRICELIST & PRICING PATTERNS                                                ║
║  Dynamic pricing, discounts, and multi-currency price management             ║
║  Use for sales pricing, promotions, and customer-specific pricing            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Best Practices

1. **Use rule priority** - Specific rules before global (sequence matters)
2. **Date ranges** - Use for promotions, not permanent pricing
3. **Test thoroughly** - Verify all quantity breaks work
4. **Currency consistency** - Match pricelist and partner currency
5. **Audit trail** - Log price changes
6. **Performance** - Cache frequent price lookups
7. **Multi-company** - Separate pricelists per company
8. **Clear naming** - Descriptive pricelist names
9. **Limit complexity** - Too many rules = slow calculation
10. **Document rules** - Explain business logic behind pricing

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
