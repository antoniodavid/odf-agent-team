---
name: accounting-patterns
description: "Use when implementing Odoo accounting flows: journal entries, invoices, payments, taxes, fiscal positions, reconciliation, and financial reports. Covers account.move, account.payment, multi-currency, and entry balancing."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Accounting Integration Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ACCOUNTING INTEGRATION PATTERNS                                             ║
║  Journal entries, invoicing, and financial operations                        ║
║  Use for ERP integrations, financial reporting, and accounting automation    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Module Setup

### Manifest Dependencies
```python
{
    'name': 'My Accounting Module',
    'version': '18.0.1.0.0',
    'depends': ['account'],
    'data': [
        'security/ir.model.access.csv',
        'data/account_data.xml',
        'views/account_views.xml',
    ],
}
```

---


## Best Practices

1. **Always balance entries** - Debits must equal credits
2. **Use correct account types** - Receivable, payable, income, expense
3. **Post entries** - Draft entries don't affect financials
4. **Handle multi-currency** - Use currency conversion methods
5. **Respect fiscal year** - Check date restrictions
6. **Use proper journals** - Sales, purchase, bank, cash, general
7. **Reconcile regularly** - Match payments to invoices
8. **Multi-company aware** - Always filter by company
9. **Tax compliance** - Use correct tax accounts
10. **Audit trail** - Don't delete, use reversals

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
