---
name: portal-access-patterns
description: "Use when building Odoo portal access: portal.mixin, controllers, templates, access tokens, and public routes. Covers token scope, permissions, and expiry."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Portal and Access Token Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  PORTAL & ACCESS TOKEN PATTERNS                                              ║
║  Customer portal, public access, and secure token-based sharing              ║
║  Use for external user access and document sharing                           ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Best Practices

1. **Always validate tokens** - Check existence and expiration
2. **Use HTTPS** - Tokens in URLs require encrypted transport
3. **Regenerate on sharing** - New token for each share request
4. **Limit token scope** - One token per document
5. **Set expiration** - Time-limit tokens when possible
6. **Log access** - Track who accessed what and when
7. **Clean up expired** - Regular cron to remove old tokens
8. **Check permissions** - Even with token, verify allowed actions
9. **Use sudo carefully** - Only for token validation
10. **Test portal views** - Verify as portal user, not admin

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
