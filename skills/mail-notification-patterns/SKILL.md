---
name: mail-notification-patterns
description: "Use when adding Odoo mail and notifications: mail.thread, templates, message_post, followers, activities, and bus notifications. Covers email rendering, batching, and tracking."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Mail and Notification Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  MAIL & NOTIFICATION PATTERNS                                                ║
║  Email templates, chatter integration, and activity management               ║
║  Use for automated emails, discussions, and workflow notifications           ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Best Practices

1. **Use templates** - Define email templates in XML for maintainability
2. **Handle missing emails** - Always check `partner_id.email` before sending
3. **Use queues** - Set `force_send=False` for batch operations
4. **Track important fields** - Add `tracking=True` to key fields
5. **Custom subtypes** - Create subtypes for different notification types
6. **Activity scheduling** - Use activities for task management
7. **Follower management** - Auto-subscribe relevant parties
8. **Test email rendering** - Verify templates render correctly

---


## Manifest Dependencies

```python
{
    'depends': [
        'mail',  # Required for mail.thread
    ],
    'data': [
        'data/mail_template.xml',
        'data/mail_subtype.xml',
        'data/mail_activity_type.xml',
        'views/my_model_views.xml',
    ],
}
```

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
