# OCA Skills - Complete Index

Skills for OCA compliance and Odoo development. **126 specialized skills** organized into 5 categories + core tools.

## Quick Navigation

| Category | Location | Count | Purpose |
|----------|----------|--------|---------|
| **Governance** | `01-oca-governance/` | 5 | OCA policies, PR workflow, commit messages |
| **Development Style** | `02-development-style/` | 18 | Python, XML, manifest, naming, generators |
| **Patterns** | `03-patterns/` | 42 | Implementation patterns by area |
| **Testing** | `04-testing/` | 8 | Test patterns, compliance, review |
| **Version** | `05-version/` | 39 | Version-specific guides |
| **Core Tools** | `(root)` | 14 | OCA search, migration, PR tools |

---

## Category 1: OCA Governance (5 skills)

**Location**: `01-oca-governance/`

OCA policies, contribution workflow, and community governance.

| Skill | Purpose |
|-------|---------|
| `oca-pr-workflow` | PR checklist, submission, review, merge |
| `oca-maturity-levels` | Alpha/Beta/Stable/Mature requirements |
| `oca-commit-messages` | Commit message format, tags, examples |
| `oca-repository-policy` | Repository structure, governance, stability |
| `oca-maintainer-role` | Maintainer responsibilities, PSC |

---

## Category 2: Development Style (18 skills)

**Location**: `02-development-style/`

Code style standards for Python, XML, manifest, and naming.

### Code Style (4 skills)
| Skill | Purpose |
|-------|---------|
| `oca-python-style` | Import order, model structure, SQL, idioms |
| `oca-xml-style` | XML format, inheritance, IDs |
| `oca-manifest-format` | Manifest structure, external dependencies |
| `oca-naming-conv` | Module, file, XML ID naming conventions |

### Module Generators (14 skills)
| Skill | Purpose |
|-------|---------|
| `odoo-module-generator` | Generic module generator |
| `odoo-module-generator-14` | Odoo 14 template |
| `odoo-module-generator-15` | Odoo 15 template |
| `odoo-module-generator-16` | Odoo 16 template |
| `odoo-module-generator-17` | Odoo 17 template |
| `odoo-module-generator-18` | Odoo 18 template |
| `odoo-module-generator-19` | Odoo 19 template |
| `odoo-module-generator-all` | All versions combined |
| `odoo-module-generator-14-15` | 14-15 compatibility |
| `odoo-module-generator-15-16` | 15-16 compatibility |
| `odoo-module-generator-16-17` | 16-17 compatibility |
| `odoo-module-generator-17-18` | 17-18 compatibility |
| `odoo-module-generator-18-19` | 18-19 compatibility |
| `common-module-templates` | Common module structures |

---

## Category 3: Patterns (42 skills)

**Location**: `03-patterns/`

Implementation patterns organized by functional area.

### Models (9 skills)
**Location**: `03-patterns/models/`

| Skill | Purpose |
|-------|---------|
| `inheritance-patterns` | Model/view inheritance, delegation |
| `computed-field-patterns` | @api.depends, stored/computed |
| `constraint-patterns` | @api.constrains, _sql_constraints |
| `field-type-reference` | All Odoo field types |
| `context-environment-patterns` | with_context, with_user, sudo |
| `domain-filter-patterns` | Domains, filtering, record sets |
| `onchange-dynamic-patterns` | @api.onchange, dynamic fields |
| `data-migration-patterns` | Migration scripts |
| `error-handling-patterns` | Exception handling, logging |

### Views (3 skills)
**Location**: `03-patterns/views/`

| Skill | Purpose |
|-------|---------|
| `odoo-view-patterns` | Form, List, Kanban, Calendar, Pivot |
| `odoo-dialog-service` | Dialog service, wizards |
| `action-patterns` | Server actions, automated actions |

### Business (19 skills)
**Location**: `03-patterns/business/`

| Skill | Purpose |
|-------|---------|
| `external-api-patterns` | XML-RPC, JSON-RPC, API clients |
| `controller-api-patterns` | HTTP controllers, routes |
| `cron-automation-patterns` | ir.cron, scheduled actions |
| `mail-notification-patterns` | Email templates, notifications |
| `menu-navigation-patterns` | Menu items, actions |
| `accounting-patterns` | Chart of accounts, fiscal positions |
| `config-settings-patterns` | ir.config_parameter usage |
| `dashboard-kpi-patterns` | Dashboard widgets, KPI calculations |
| `hr-employee-patterns` | Employee management |
| `import-export-patterns` | Data import/export |
| `lot-serial-patterns` | Lot/serial number management |
| `portal-access-patterns` | Public access, portal users |
| `pricelist-pricing-patterns` | Pricelists, discount rules |
| `product-variant-patterns` | Product variants, attributes |
| `project-task-patterns` | Project management patterns |
| `purchase-procurement-patterns` | Purchase flow, procurement |
| `assets-bundling-patterns` | JS/CSS asset management |
| `attachment-binary-patterns` | File attachments, binary fields |
| `logging-debugging-patterns` | _logger, debug patterns |

### Frontend (11 skills)
**Location**: `03-patterns/frontend/`

| Skill | Purpose |
|-------|---------|
| `odoo-owl-components` | Generic OWL patterns |
| `odoo-owl-components-15` | OWL 1.x (Odoo 15) |
| `odoo-owl-components-16` | OWL 2.x (Odoo 16-17) |
| `odoo-owl-components-17` | OWL 2.x (Odoo 17) |
| `odoo-owl-components-18` | OWL 2.x (Odoo 18) |
| `odoo-owl-components-19` | OWL 3.x (Odoo 19) |
| `odoo-owl-components-15-16` | OWL 15-16 transition |
| `odoo-owl-components-16-17` | OWL 16-17 continuity |
| `odoo-owl-components-17-18` | OWL 17-18 transition |
| `odoo-owl-components-18-19` | OWL 18-19 transition |
| `odoo-owl-components-all` | All versions |

---

## Category 4: Testing (8 skills)

**Location**: `04-testing/`

| Skill | Purpose |
|-------|---------|
| `odoo-test-patterns` | TransactionCase, HttpCase, fixtures |
| `odoo-tour-testing` | QUnit tours, HTTPCase, UI automation |
| `odoo-performance-guide` | Performance optimization |
| `odoo-troubleshooting-guide` | Common issues and fixes |
| `odoo-editions` | Community vs Enterprise differences |
| `end-to-end-examples` | Complete module examples |
| `oca-compliance-check` | Pre-PR validation checklist |
| `oca-code-review` | Code review process |

---

## Category 5: Version-Specific (39 skills)

**Location**: `05-version/`

### Model Patterns (13 skills)

| Version | Skill |
|---------|-------|
| All | `odoo-model-patterns-all` |
| Odoo 19 | `odoo-model-patterns-19` |
| Odoo 18 | `odoo-model-patterns-18` |
| Odoo 17 | `odoo-model-patterns-17` |
| Odoo 16 | `odoo-model-patterns-16` |
| Odoo 15 | `odoo-model-patterns-15` |
| Odoo 14 | `odoo-model-patterns-14` |
| 14-15 | `odoo-model-patterns-14-15` |
| 15-16 | `odoo-model-patterns-15-16` |
| 16-17 | `odoo-model-patterns-16-17` |
| 17-18 | `odoo-model-patterns-17-18` |
| 18-19 | `odoo-model-patterns-18-19` |
| Generic | `odoo-model-patterns` |

### Security Guides (9 skills)

| Version | Skill |
|---------|-------|
| All | `odoo-security-guide-all` |
| Odoo 19 | `odoo-security-guide-19` |
| Odoo 18 | `odoo-security-guide-18` |
| Odoo 17 | `odoo-security-guide-17` |
| Odoo 16 | `odoo-security-guide-16` |
| Odoo 15 | `odoo-security-guide-15` |
| Odoo 14 | `odoo-security-guide-14` |
| Generic | `odoo-security-guide` |

### Version Knowledge (13 skills)

| Version | Skill |
|---------|-------|
| All | `odoo-version-knowledge-all` |
| Odoo 19 | `odoo-version-knowledge-19` |
| Odoo 18 | `odoo-version-knowledge-18` |
| Odoo 17 | `odoo-version-knowledge-17` |
| Odoo 16 | `odoo-version-knowledge-16` |
| Odoo 15 | `odoo-version-knowledge-15` |
| Odoo 14 | `odoo-version-knowledge-14` |
| 14-15 | `odoo-version-knowledge-14-15` |
| 15-16 | `odoo-version-knowledge-15-16` |
| 16-17 | `odoo-version-knowledge-16-17` |
| 17-18 | `odoo-version-knowledge-17-18` |
| 18-19 | `odoo-version-knowledge-18-19` |
| Generic | `odoo-version-knowledge` |

---

## Core OCA Tools (14 skills)

**Location**: `(root - not categorized)`

OCA-specific tools for search, migration, and PR operations.

| Skill | Purpose |
|-------|---------|
| `oca-lookup-guideline` | Quick OCA reference |
| `oca-odoo-local-search` | Local Odoo codebase search |
| `oca-search-migration-prs` | Find open migration PRs |
| `oca-pr-checkout` | Get code from pending PR |
| `oca-pr-dependencies` | Analyze PR dependencies |
| `oca-migration-status` | Repo migration status |
| `oca-migration-assist` | Migration guidance |
| `oca-upgrade-analysis` | OpenUpgrade analysis |
| `oca-api-lookup` | Odoo API docs |
| `oca-pattern-match` | Find patterns in odoo/odoo + OCA/* |
| `oca-suggest-improve` | Suggest improvements |
| `oca-documentation-gen` | Generate docs |
| `oca-contributing-guide` | **DEPRECATED** - See 02-development-style |
| `SKILL.md` | This index |

---

## Tools

| Tool | Purpose |
|------|---------|
| `fff` | Fast file finder with fuzzy search |
| `fff_grep` | Fast content search across files |
| `gh` | GitHub CLI for PR operations |

---

## Usage

### Finding Skills

1. **Use `fff`** for fast file finding:
   ```bash
   fff "computed" skills/oca/03-patterns/models/
   fff "view" skills/oca/03-patterns/views/
   fff "ow" skills/oca/03-patterns/frontend/
   ```

2. **Use this SKILL.md** for complete index

3. **Use `skill_finder` agent** for targeted lookups (extracts 20-50 lines)

### Loading Skills

Load a skill by reading the file:
```
Read: skills/oca/{category}/{skill-name}.md
```

Example:
```
Read: /home/adruban/.config/opencode/skills/oca/02-development-style/oca-python-style.md
```

---

## Skill Size Guidelines

| Type | Lines | Use |
|------|-------|-----|
| **Reference** | 50-100 | Quick lookup with code |
| **Guide** | 100-300 | Complete topic coverage |
| **Pattern** | 200-500 | Code examples and templates |
| **Compendium** | 500+ | Use via skill_finder agent |

---

## Backwards Compatibility

Some skills have been reorganized. The original files are kept as aliases:

| Old Location | New Location |
|--------------|--------------|
| `oca-contributing-guide.md` | `02-development-style/oca-python-style.md` + others |

---

Last updated: 2026-04-02
