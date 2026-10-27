# End-to-End Generation Examples

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  END-TO-END GENERATION EXAMPLES                                              ║
║  Complete input → output examples for autonomous agent operation             ║
║  Copy these patterns for consistent module generation                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---


## Agent Execution Summary

```
WORKFLOW EXECUTION PATTERN:

1. RECEIVE user request
2. PARSE requirements → structured input
3. VALIDATE input against schema
4. DETERMINE version → load skills
5. VERIFY patterns via GitHub (critical patterns only)
6. GENERATE files in correct order
7. VALIDATE generated code
8. OUTPUT with version notes and file tree

ALWAYS REMEMBER:
- Security files BEFORE views in manifest
- Version-specific patterns are MANDATORY
- Multi-company requires _check_company_auto (v18+)
- Create uses @api.model_create_multi (v17+)
- Views use inline expressions (v17+)
```

## Detailed examples

Read `end-to-end-examples-examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
