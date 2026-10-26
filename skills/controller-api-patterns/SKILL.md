---
name: controller-api-patterns
description: "Controller Api Patterns. Trigger: http controller, http.route, REST endpoint, website route."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Controller and API Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  CONTROLLER & API PATTERNS                                                   ║
║  HTTP controllers, REST endpoints, and web routes                            ║
║  Use for APIs, webhooks, and custom web endpoints                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## File Structure

```
my_module/
├── controllers/
│   ├── __init__.py
│   └── main.py
└── __manifest__.py
```

### __init__.py
```python
from . import main
```

---


## Best Practices

1. **Use appropriate auth** - `public` for public APIs, `user` for authenticated
2. **Handle errors gracefully** - Return proper HTTP status codes
3. **Validate input** - Check required fields and types
4. **Use sudo carefully** - Only when necessary for public endpoints
5. **CSRF protection** - Disable only for legitimate API endpoints
6. **Rate limiting** - Implement for public APIs
7. **Logging** - Log API requests for debugging
8. **Documentation** - Document endpoints for consumers

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
