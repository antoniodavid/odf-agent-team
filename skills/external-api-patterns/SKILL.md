---
name: external-api-patterns
description: "Use when integrating Odoo with external services: XML-RPC and JSON-RPC clients, REST calls, webhooks, OAuth2, retries, and rate limits. Covers credentials, timeouts, and response validation."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# External API Integration Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  EXTERNAL API INTEGRATION PATTERNS                                           ║
║  Connecting to third-party services, REST/SOAP APIs, and webhooks            ║
║  Use for payment gateways, shipping providers, CRM sync, etc.                ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Best Practices

1. **Never hardcode credentials** - Use ir.config_parameter or dedicated config model
2. **Use HTTPS** - Always use secure connections
3. **Implement retry logic** - Handle transient failures
4. **Log all API calls** - For debugging and audit
5. **Handle rate limits** - Implement backoff strategies
6. **Validate responses** - Don't trust external data
7. **Use timeouts** - Prevent hanging requests
8. **Queue heavy operations** - Don't block user actions
9. **Test with sandbox** - Use environment switching
10. **Secure webhooks** - Always verify signatures

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
