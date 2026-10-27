---
name: odoo-testing
description: "Use when testing or hardening an Odoo module: test classes, fixtures, tours, compliance checks, end-to-end examples, performance, and failure diagnosis. Covers the real suite and the evidence expected before a PR."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo Testing and Quality

## Activation Contract

Use this domain skill when the task touches one of the topics below. Read the
specific reference before writing code; the domain file is the router, not a
substitute for the detailed pattern.

## Topic Map

| Topic | Reference |
|-------|-----------|
| Test classes, fixtures, tags | `references/odoo-test-patterns.md` |
| OCA compliance and pre-PR checks | `references/oca-compliance-check.md` |
| Complete module walkthroughs | `references/end-to-end-examples.md` |
| Browser tours (QUnit and HttpCase) | `references/odoo-tour-testing.md` |
| Performance and query optimization | `references/odoo-performance-guide.md` |
| Error lookup and debugging | `references/odoo-troubleshooting-guide.md` |

## Hard Rules

- Run the real module suite with the project's test command; skipped is not passed.
- Choose the narrowest valid class: TransactionCase, HttpCase, or Form.
- Cover CRUD, computes, constraints, access rights, and failure paths.
- Run OCA compliance checks before opening a PR.
- Measure performance before optimizing; verify with query counts.
- Diagnose by target version; do not assume an error is version-independent.

## References

Read the topic reference first. Full code examples live next to it:

- `references/odoo-test-patterns-examples.md`
- `references/end-to-end-examples-examples.md`
- `references/odoo-tour-testing-examples.md`
- `references/odoo-troubleshooting-guide-examples.md`

## Compact Rules

- Run the real module suite; a skipped test is not a pass.
- Use TransactionCase, HttpCase, or Form for the behavior under test.
- Cover CRUD, computes, constraints, access rights, and failure paths.
- Run OCA compliance checks before opening a PR.
- Measure performance before optimizing.
- Diagnose errors against the target Odoo version.
