---
name: odoo-business-flows
description: "Use when implementing an Odoo business domain: accounting, stock and lots, sales and pricing, purchasing, HR, projects, mail, portal, attachments, imports, cron, settings, dashboards, controllers, or external APIs."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Odoo Business Flows

## Activation Contract

Use this domain skill when the task touches one of the topics below. Read the
specific reference before writing code; the domain file is the router, not a
substitute for the detailed pattern.

## Topic Map

| Topic | Reference |
|-------|-----------|
| Accounting, invoices, taxes, reconciliation | `references/accounting-patterns.md` |
| Asset bundles and frontend assets | `references/assets-bundling-patterns.md` |
| Binary fields, attachments, uploads | `references/attachment-binary-patterns.md` |
| Settings and ir.config_parameter | `references/config-settings-patterns.md` |
| HTTP controllers and REST endpoints | `references/controller-api-patterns.md` |
| Cron jobs and scheduled actions | `references/cron-automation-patterns.md` |
| Dashboards and KPI views | `references/dashboard-kpi-patterns.md` |
| External APIs, webhooks, OAuth2 | `references/external-api-patterns.md` |
| HR employees, departments, leaves | `references/hr-employee-patterns.md` |
| CSV import and export | `references/import-export-patterns.md` |
| Logging, debugging, audit | `references/logging-debugging-patterns.md` |
| Lots, serials, traceability | `references/lot-serial-patterns.md` |
| Mail templates and notifications | `references/mail-notification-patterns.md` |
| Menus and navigation | `references/menu-navigation-patterns.md` |
| Portal access and tokens | `references/portal-access-patterns.md` |
| Pricelists and pricing rules | `references/pricelist-pricing-patterns.md` |
| Product templates, variants, SKUs | `references/product-variant-patterns.md` |
| Projects, tasks, timesheets | `references/project-task-patterns.md` |
| Purchasing, RFQs, vendors | `references/purchase-procurement-patterns.md` |

## Hard Rules

- Identify the business domain first and read its reference before coding.
- Filter by company and respect record rules on every business model.
- Prefer the ORM over SQL; never hardcode taxes, accounts, or currencies.
- Use Monetary and Decimal for money; never float arithmetic for amounts.
- Keep tests with the workflow, including the failure paths.
- Load the target-version behavior before copying a pattern.

## References

Read the topic reference first. Full code examples live next to it:

- `references/accounting-patterns-examples.md`
- `references/assets-bundling-patterns-examples.md`
- `references/attachment-binary-patterns-examples.md`
- `references/controller-api-patterns-examples.md`
- `references/dashboard-kpi-patterns-examples.md`
- `references/external-api-patterns-examples.md`
- `references/hr-employee-patterns-examples.md`
- `references/import-export-patterns-examples.md`
- `references/mail-notification-patterns-examples.md`
- `references/portal-access-patterns-examples.md`
- `references/pricelist-pricing-patterns-examples.md`
- `references/project-task-patterns-examples.md`

## Compact Rules

- Identify the business domain, then read its reference before coding.
- Filter by company and respect record rules on every business model.
- Prefer the ORM over SQL; never hardcode taxes, accounts, or currencies.
- Use Monetary and Decimal for money, never float arithmetic.
- Add tests for the workflow and its failure paths.
- Load the target-version behavior before copying a pattern.
