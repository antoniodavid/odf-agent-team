# OCA Commit Messages

> **For Odoo/OCA projects ONLY.** Replaces `caveman-commit` in OCA repositories.
> 
> Use when user says: "write a commit", "commit message", "generate commit", 
> "/commit", or when staging changes in an OCA project.

Complete guide for writing commit messages in OCA repositories.

## Why Commit Messages Matter

Good commit messages are crucial for:
- **Maintainability**: Future developers understand WHY changes were made
- **Code archaeology**: Tracking when/why/who made specific changes
- **Automated processes**: Generating changelogs, release notes
- **Code review**: Understanding intent without reading all the code

## Commit Message Format

### Structure

```
[TAG] module_name: short description (max 50 chars)

Optional longer explanation of WHY the change is needed.
Can span multiple lines, max 80 chars per line.

Closes #123
```

### Example

```markdown
[FIX] sale_order: handle missing partner on confirm

The confirm action was failing when partner_shipping_id
was not set. Added fallback to partner_id to handle
the edge case where shipping address is missing.

Closes #456
```

## The Summary Line

### Rules

1. **Max 50 characters** - Keep it concise
2. **Use imperative mood** - "Fix", "Add", "Remove"
3. **Format**: `[TAG] module_name: description`
4. **No period** at the end
5. **Describe WHAT changed**, not HOW

### Imperative Mood

Use the form "Fix this" not "Fixed this" or "Fixes this".

| Correct | Incorrect |
|---------|-----------|
| Fix handling of empty partner | Fixed handling of empty partner |
| Add new field for tracking | Added new field for tracking |
| Remove deprecated method | Removed deprecated method |
| Update documentation | Updated documentation |

### Summary Examples

| Tag | Good Example | Bad Example |
|-----|-------------|------------|
| `[FIX]` | `[FIX] account: handle zero division` | `[FIX] fixed bug` |
| `[ADD]` | `[ADD] stock_move: add origin field` | `[ADD] new feature` |
| `[IMP]` | `[IMP] sale: optimize order confirmation` | `[IMP] improvement` |
| `[REF]` | `[REF] base: extract validation logic` | `[REF] refactoring` |

## The Body

### Rules

1. **Max 80 characters** per line
2. **Explain WHY**, not just WHAT
3. **Describe the problem** being solved
4. **Mention any tradeoffs** or alternative approaches considered
5. **Leave the HOW to the diff** - reviewers can see what changed

### Template

```
Explain the problem and why this change is needed.

If there were alternative approaches considered,
mention them briefly.

Any important context for reviewers should go here.
```

### Body Examples

```markdown
[FIX] account_invoice: prevent negative amounts

The invoice validation was allowing negative line amounts
when a negative price was entered. This caused issues in
downstream reporting and tax calculations.

Added validation to reject negative unit prices with a
clear error message explaining the constraint.

Closes #789
```

```markdown
[IMP] stock_picking: batch confirm shipments

Before this change, each shipment had to be confirmed
individually, causing performance issues with large
volumes. This change enables batch confirmation which
reduces database roundtrips by 80%.

The approach uses the existing batch processing framework
rather than creating a new mechanism.
```

## Closing Issues

### Syntax

Use "Closes", "Fixes", or "Resolves" followed by the issue number:

```markdown
Closes #123
Closes oca/odoo-community.org#456
```

### Multiple Issues

```markdown
Closes #123
Closes #456
Fixes #789
```

### When Not to Close

Don't auto-close if:
- The fix is partial (issue remains open for remaining parts)
- The issue should be closed manually by someone else
- The PR is for a specific version only (issue applies to others)

## Tag Reference

### Complete List

| Tag | Purpose | Example |
|-----|---------|---------|
| `[FIX]` | Bug fix | `[FIX] sale_order: handle missing partner` |
| `[ADD]` | New feature | `[ADD] stock_move: add tracking field` |
| `[IMP]` | Improvement | `[IMP] account: optimize tax calculation` |
| `[REF]` | Refactoring (no functional change) | `[REF] base: extract common utilities` |
| `[REM]` | Remove feature | `[REM] legacy_report: delete old report` |
| `[MIG]` | Migration to new version | `[MIG] sale_margin: migrate to 17.0` |
| `[MOV]` | Move code | `[MOV] stock: reorganize models directory` |
| `[MERGE]` | Merge commit | `[MERGE]` (rare, for branch merges) |
| `[DOC]` | Documentation | `[DOC] add usage instructions` |
| `[TEST]` | Test changes | `[TEST] add tests for edge cases` |
| `[SEC]` | Security fix | `[SEC] prevent SQL injection` |
| `[PERF]` | Performance improvement | `[PERF] cache computed values` |

### Tag Selection Guidelines

**Use `[FIX]` for**:
- Bug fixes
- Hotfixes
- Corrections to existing behavior

**Use `[ADD]` for**:
- New features
- New models, fields, views
- New functionality

**Use `[IMP]` for**:
- Performance improvements
- UX improvements
- Adding functionality to existing features
- Optimization

**Use `[REF]` for**:
- Code reorganization
- Extracting utilities
- Renaming variables
- No functional change

**Use `[REM]` for**:
- Removing deprecated features
- Cleaning up dead code
- Removing functionality

**Use `[MIG]` for**:
- Porting to new Odoo version
- Migration scripts
- Version-specific changes

## Common Mistakes

### Don't Do These

```markdown
# Too short - no information
[FIX] bug

# Too long - will be truncated
[FIX] sale_order_line_qty: fixed issue where the quantity field was not being properly validated when decimal accuracy was set to 3

# Uses past tense
[FIX] sale_order: fixed the missing partner issue

# Doesn't explain WHY
[FIX] account: changed tax computation

# Includes what the diff shows
[FIX] sale: update line 45 from + to -

# Multiple changes in one commit
[FIX] many modules: various fixes

# Commit before the work is done
[TEMP] testing something
```

### Do This Instead

```markdown
# Concise but informative
[FIX] sale_order: handle missing partner on confirm

# Explains the problem
[IMP] account: optimize tax computation for large invoices

# Describes the change
[MIG] sale_margin: migrate to 17.0 version

# Single logical change
[ADD] stock_move: add source location tracking field
```

## Multi-Module Commits

### When Allowed

Sometimes a change legitimately affects multiple modules:

```markdown
[IMP] sale, sale_stock, sale_management: unify confirmation flow

Consolidated the order confirmation process across all sale
modules to use a common method. This ensures consistent
behavior and reduces code duplication.
```

### When to Split

Avoid commits that touch unrelated modules in different functional areas. If you're fixing a bug in `account` and notice an issue in `stock`, make two separate commits.

## Squash and Rebase

### Before Review

You can freely squash, rebase, and amend commits before review starts.

### After Review

After the first review:
- **Don't force push** without checking with reviewers
- **Ask** before squashing commits
- **Consider** keeping fixup commits if they help track the evolution of a fix

### When to Squash

Squash commits like these:
- "Fix pep8"
- "Add test"
- "Address feedback"
- "Typo fix"

Into the logical commit they belong to.

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-contributing-guide.md` | Complete contributing guidelines |
| `oca-pr-workflow.md` | PR submission workflow |
| `oca-compliance-check.md` | Validate commit compliance |
| `oca-maturity-levels.md` | Development status levels |
