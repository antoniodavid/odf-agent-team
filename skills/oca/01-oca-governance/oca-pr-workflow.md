# OCA Pull Request Workflow

Complete workflow for submitting, reviewing, and merging pull requests in OCA repositories.

> **Replaces `caveman-commit` for OCA PRs.** Use this skill when creating branches, commits, or PRs in OCA projects.

---

## Workflow Overview

```
1. Issue exists? Confirm it's approved (status:approved or maintainer-ack'd)
   gh issue view <N> --repo OCA/<repo>

2. Create branch from target version branch
   git checkout <ver> && git pull
   git checkout -b <type>/<module>-<short-desc>

3. Implement changes
   → Follow OCA code style (oca-python-style, oca-xml-style)
   → Include tests (mandatory for Stable/Mature)
   → Commit with OCA format: [TAG] module_name: description

4. Run pre-PR checklist (see below) locally

5. Push and create PR with template
   gh pr create --repo OCA/<repo> --title "[TAG] module: desc" --body-file .github/PULL_REQUEST_TEMPLATE.md

6. Wait for CI + review
   = Alpha/Beta: 1 review required
   = Stable: 2 reviews + 5-day period + tests required
   = Mature: Stable + docs + changelog + 2 contributors

7. Respond to feedback, don't force push after review starts
```

---

## Branch Naming

Branches MUST follow this pattern:

```
^(fix|imp|add|ref|rem|mig)\/[a-z0-9._-]+$
```

| Type | When | Example |
|------|------|---------|
| `fix/` | Bug fixes | `fix/sale_order-missing-partner` |
| `imp/` | Improvements | `imp/account-optimize-tax` |
| `add/` | New features | `add/stock-move-tracking-field` |
| `ref/` | Refactoring | `ref/base-extract-utils` |
| `mig/` | Migration | `mig/sale_margin-to-17.0` |

Rules: all lowercase, hyphens/underscores/dots as separators, no spaces.

---

## PR Body Template

When creating a PR via GitHub CLI, use this template structure:

```markdown
## Description

{Clear description of what this PR does and why}

## Related Issue

Closes #N

## OCA Compliance Checklist

- [ ] Version format: {ver}.0.1.0.0
- [ ] License: AGPL-3
- [ ] Author includes OCA
- [ ] Tests included and passing
- [ ] OCA commit format used
- [ ] READEME.rst generated (not manually edited)
```

---

## PR Creation Commands

```bash
# Create PR from current branch
gh pr create \
  --repo OCA/<repo> \
  --title "[FIX] sale_order: handle missing partner on confirm" \
  --body "## Description\n\n{description}\n\nCloses #N"

# Add a label
gh pr edit <N> --repo OCA/<repo> --add-label "label-name"

# Check PR status
gh pr checks <N> --repo OCA/<repo>
```

---

## Overview

All OCA modules, regardless of maturity level, must pass automated CI checks. The difference lies in the peer review requirements:

| Level | CI | Reviews | Test Coverage | Other |
|-------|-----|---------|---------------|-------|
| Alpha/Beta | Green | 1 | Optional | Code formatted |
| Stable | Green | 2 | Required | 5-day review period |
| Mature | Green | 2 | Good coverage | + docs, changelog |

## Pre-PR Checklist

### Manifest

- [ ] `version` = `{odoo_version}.x.y.z` (e.g., `17.0.1.0.0`)
- [ ] `license` = `AGPL-3` (or compatible)
- [ ] `author` includes `, Odoo Community Association (OCA)`
- [ ] `website` = `https://github.com/OCA/<repo>`
- [ ] `development_status` correct (Alpha/Beta/Stable/Mature)
- [ ] `maintainers` declared if applicable
- [ ] No empty keys
- [ ] All data files listed in `data` and `demo` keys

### Python Code

- [ ] Imports ordered correctly (isort)
- [ ] PEP8 compliant (flake8)
- [ ] No SQL injection vulnerabilities
- [ ] No `cr.commit()` without explicit justification
- [ ] ORM used instead of raw SQL when possible
- [ ] Method naming follows conventions (`_compute_*`, `action_*`, etc.)
- [ ] No hardcoded user IDs or company IDs
- [ ] `ensure_one()` used in single-record methods

### XML Code

- [ ] 4-space indentation
- [ ] `id` attribute before `model` in records
- [ ] XML IDs follow naming conventions
- [ ] `user_id` explicit in `ir.filters` records
- [ ] No `position="replace"` without justification
- [ ] No module prefix in internal xmlids
- [ ] Groups properly declared

### Tests

- [ ] Tests included (mandatory for Stable/Mature)
- [ ] Tests pass locally
- [ ] Bug fixes include test that fails without the fix
- [ ] Proper test tags: `@tagged('post_install', '-at_install')`
- [ ] Tests use `TransactionCase` or `HttpCase`
- [ ] External services mocked

### Documentation

- [ ] `readme/DESCRIPTION.rst` describes the module
- [ ] `readme/USAGE.rst` if there are user instructions
- [ ] `readme/CONTRIBUTORS.rst` updated with all contributors
- [ ] `README.rst` generated (not manually edited)

### Translations

- [ ] All user-facing strings use `_()` for translation
- [ ] `.pot` file updated if new strings added
- [ ] No direct `.po` file modifications (use Weblate)

## Commit Message Format

### Structure

```
[TAG] module_name: short description (max 50 chars)

Longer explanation of WHY the change is needed.
Can span multiple lines, max 80 chars per line.

Closes #123
```

### Tag Reference

| Tag | Use | Example |
|-----|-----|---------|
| `[FIX]` | Bug fix | `[FIX] sale_order: handle missing partner on confirm` |
| `[ADD]` | New feature | `[ADD] stock_move: add tracking field` |
| `[IMP]` | Improvement | `[IMP] account: optimize tax computation` |
| `[REF]` | Refactoring | `[REF] base_calendar: extract common utilities` |
| `[REM]` | Remove feature | `[REM] legacy_report: remove deprecated report` |
| `[MIG]` | Version migration | `[MIG] sale_margin: migrate to 17.0` |
| `[MOV]` | Move code | `[MOV] stock: reorganize models directory` |
| `[MERGE]` | Merge commit | `[MERGE]` (rarely used) |

### Examples

```markdown
[FIX] sale_order: handle missing partner on confirm

The confirm action was failing when partner_shipping_id
was not set. Added fallback to partner_id.

Closes #123
```

```markdown
[ADD] stock_move: add tracking field

New field to track movement origin for better
traceability in warehouse operations.
```

```markdown
[IMP] account_invoice: optimize tax computation

Cache tax results to avoid recalculation on every
invoice line change. Performance improvement of 15%.
```

### Commit Message Rules

- **Use imperative mood**: "Fix", "Add", "Remove" (not "Fixed", "Added")
- **Max 50 chars** in the summary line
- **Explain WHY**, not just WHAT
- **Don't** create separate commits for "Fix pep8" or "Add unittest"
- **Single logical change** per commit
- **Avoid multi-module commits** when possible

### PR Truncation

If the commit message is cut with ellipsis:

```markdown
[FIX] module_foo: and this is my very long m[...]
```

This means the message is too long. Shorten the summary and move details to the description.

## During Review

### Responding to Feedback

1. **Respond to all comments** - even if just to acknowledge
2. **Make requested changes** before re-requesting review
3. **Re-request review** when all comments addressed
4. **Don't force push** after reviews have started
5. **Don't squash commits** without checking with reviewers

### Review Types

When reviewing, categorize your feedback:

| Type | Meaning |
|------|---------|
| **Approve** | Ready to merge |
| **Request Changes** | Needs modifications before merge |
| **Comment** | General feedback, no action required |
| **Test** | Functionally tested the module |

### Being Reviewed

- Start by thanking the contributor
- Be cordial and polite
- Understand that nothing is obvious in a PR
- Ask for clarification if purpose is unclear
- Request demo/steps to reproduce if needed

## Requirements by Maturity Level

### Alpha/Beta Modules

- [ ] CI green (coverage can fail)
- [ ] 1 peer review
- [ ] Code formatted (pre-commit)
- [ ] Installs correctly in Runboat
- [ ] No conflicts with other modules

### Stable Modules

All Alpha/Beta requirements plus:
- [ ] 2 peer reviews minimum
- [ ] **5-day review period** (or 3+ reviewers)
- [ ] Tests included and passing
- [ ] Depends only on Stable/Mature modules
- [ ] CI fully green (all checks)
- [ ] Code formatted

### Mature Modules

All Stable requirements plus:
- [ ] Exists in at least one previous Odoo version
- [ ] Good code coverage in tests
- [ ] No lint beta warnings
- [ ] User documentation (detailed USAGE.rst)
- [ ] Changelog (HISTORY.rst) recommended
- [ ] **2 independent contributors**
- [ ] **At least 1 declared maintainer**
- [ ] Scripts for OpenUpgrade migration if model changes

## Post-Merge

After your PR is merged:

1. **Verify CI passed** after merge (check GitHub Actions)
2. **Bump version** if needed (maintainers typically do this)
3. **Update HISTORY.rst** for Mature modules
4. **Close related issues** (use "Closes #123" in commit or issue)
5. **Thank reviewers** for their time

## Useful Commands

### Pre-commit Hooks

```bash
# Run all pre-commit hooks
pre-commit run --all-files

# Run specific hook
pre-commit run flake8 --all-files

# Update hooks to latest version
pre-commit autoupdate
```

### Import Sorting

```bash
# Sort imports in all Python files
isort .

# Check without making changes
isort --check-only .
```

### Code Quality

```bash
# Check PEP8
flake8 .

# Run pylint-odoo
pylint --load-plugins=pylint_odoo -d all -e odoolint addons/my_module/
```

### Testing

```bash
# Run tests
odoo-bin -d test_db -i my_module --test-enable --stop-after-init

# Run specific test file
odoo-bin -d test_db -u my_module --test-enable --test-tags=my_module.tests.test_my_feature

# Run external tests
odoo-bin -d test_db -u my_module --test-tags=external,external_l10n
```

### Internationalization

```bash
# Export translation terms
odoo-bin -d test_db -i my_module --i18n-export=addons/my_module/i18n/my_module.pot

# Import translations (via Weblate, not direct .po editing)
```

### Module Installation

```bash
# Install module
odoo-bin -d test_db -i my_module --stop-after-init

# Update module
odoo-bin -d test_db -u my_module --stop-after-init

# Install with demo data
odoo-bin -d test_db -i my_module --demo-data=True --stop-after-init
```

## GitHub Tips

### Finding PR Information

```bash
# View PR details
gh pr view 123

# View PR checks status
gh pr checks 123

# List PRs in a repository
gh issue list --label="bug" --state=open
```

### SSH to Runbot

For investigating Travis test failures:

```bash
# Connect to runbot container
ssh -p [port] -L 18080:localhost:18069 odoo@runbot[1 or 2].odoo-community.org
```

Find correct runbot at: https://runbot.odoo-community.org/runbot

### Rebuilding Test Database

```bash
# In runbot container
dropdb [github_username]
createdb -T odoo_template [github_username]
odoo-bin -d [github_username] --db-filter=[github_username] --xmlrpc-port=18069 -i [module_name] --test-enable
```

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-contributing-guide.md` | Complete contributing guidelines |
| `oca-compliance-check.md` | Validate code compliance |
| `oca-commit-messages.md` | Commit message conventions |
| `oca-maturity-levels.md` | Development status levels |
| `oca-code-review.md` | Code review process |
| `oca-chained-pr.md` | Split oversized PRs (>400 lines) into reviewable chunks |
| `/odf-pr-size` | Check PR line count against OCA review budget |
| `/odf-issue-check` | Verify issue has maintainer approval before PR |
