---
name: hr-employee-patterns
description: "Use when extending Odoo HR: hr.employee, departments, job positions, attendance, leaves, and onboarding. Covers sensitive fields, self-service views, and multi-company filters."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# HR and Employee Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  HR & EMPLOYEE PATTERNS                                                      ║
║  Employee management, contracts, attendance, and HR workflows                ║
║  Use for HR modules, time tracking, and workforce management                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Module Setup

### Manifest Dependencies
```python
{
    'name': 'My HR Module',
    'version': '18.0.1.0.0',
    'depends': ['hr'],  # Core HR
    # Optional: 'hr_contract', 'hr_attendance', 'hr_holidays', 'hr_expense'
    'data': [
        'security/ir.model.access.csv',
        'views/hr_views.xml',
    ],
}
```

---


## Best Practices

1. **Privacy** - Use `groups="hr.group_hr_user"` for sensitive fields
2. **Employee self-service** - Separate views for employees vs HR
3. **Multi-company** - Filter employees by company
4. **Manager hierarchy** - Use `parent_id` for reporting structure
5. **Document management** - Attach contracts, certificates
6. **Activity scheduling** - Use activities for HR tasks
7. **Audit trail** - Track changes to sensitive data
8. **Integration** - Connect with payroll, expense, timesheet

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
