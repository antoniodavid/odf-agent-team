# OCA Maturity Levels

Complete guide to OCA module development status levels, requirements, and promotion workflow.

## Overview

OCA modules have four maturity levels that indicate their stability and readiness for production use:

| Level | Badge | CI | Reviews | Tests | Usage |
|-------|-------|-----|---------|-------|-------|
| **Alpha** | 🔴 Red | Green | 1 | Optional | Development only |
| **Beta** | 🟡 Yellow | Green | 1 | Optional | Pre-production |
| **Stable** | 🟢 Green | Green | 2 + 5 days | Required | Production |
| **Mature** | 🔵 Blue | Green | 2 | Good coverage | Production+ |

## Quick Comparison

### Alpha/Beta (Incubation)

- ✅ CI green (coverage can fail)
- ✅ 1 peer review
- ✅ Code formatted
- ✅ Installs correctly in Runboat
- ✅ WIP issues encouraged for coordination

### Stable (Production)

All Alpha/Beta requirements plus:
- ✅ 2 peer reviews
- ✅ 5-day review period (or 3+ reviewers)
- ✅ Tests included
- ✅ Depends only on Stable/Mature modules

### Mature (Production Guaranteed)

All Stable requirements plus:
- ✅ Exists in previous Odoo version
- ✅ Good test coverage
- ✅ No lint beta warnings
- ✅ User documentation (USAGE.rst)
- ✅ 2+ independent contributors
- ✅ 1+ declared maintainer
- ✅ OpenUpgrade migration scripts

## Alpha Level

### Badge
🔴 **Alpha**

### Description
"Unstable, for development or testing purpose"

### Requirements

| Requirement | Status |
|-------------|--------|
| CI green | ✅ Mandatory |
| 1 peer review | ✅ Required |
| Code formatted | ✅ Required |
| Installs in Runboat | ✅ Required |
| Test coverage | ❌ Optional |
| Tests pass | ❌ Optional |

### Characteristics

- Work in progress
- Design may change without notice
- May be abandoned or deleted
- **Not suitable for production**
- Coverage CI check can fail

### When to Use

- Module in initial development
- Testing a new concept
- Waiting for design feedback
- Prototyping features

### Incubation Workflow

```
1. Create "WIP" Issue for module coordination
2. Create PRs implementing work units
3. PRs must pass CI and peer review
4. When complete, propose promotion to Stable
```

## Beta Level

### Badge
🟡 **Beta**

### Description
"Pre-production quality but with potential instability"

### Requirements

| Requirement | Status |
|-------------|--------|
| CI green | ✅ Mandatory |
| 1 peer review | ✅ Required |
| Code formatted | ✅ Required |
| Installs in Runboat | ✅ Required |
| Test coverage | ❌ Optional |
| Tests pass | ⚠️ CI must pass |

### Characteristics

- Functional and testable
- May still have breaking changes
- Path toward Stable status
- Should be usable for testing
- Coverage optional but encouraged

### When to Use

- Module ready for functional testing
- Waiting for additional reviews
- Adding tests and documentation
- Preparing for Stable promotion

### Best Practices

- Have a WIP Issue listing pending tasks
- Coordinate work through the WIP Issue
- Respond to reviews in a timely manner
- Keep the module installable at all times

## Stable Level

### Badge
🟢 **Stable** (or "Production/Stable")

### Description
"Adequate for production environment"

### Requirements

| Requirement | Status |
|-------------|--------|
| CI green | ✅ Mandatory |
| 2 peer reviews | ✅ Required |
| 5-day review period | ✅ Required (or 3+ reviewers) |
| Tests included | ✅ Required |
| Depends only on Stable/Mature | ✅ Required |
| Code formatted | ✅ Required |
| Test coverage | ⚠️ CI must pass |

### Characteristics

- API stable (won't break extensions)
- Backward compatible additions allowed
- Active maintenance expected
- Peer reviewed by community
- Suitable for production deployments

### Stability Policy

```
✅ ALLOWED:
- Add optional fields
- Add methods
- Add optional parameters
- Bug fixes
- Performance improvements

❌ NOT ALLOWED:
- Rename fields/methods
- Change method signatures
- Change existing behavior
- Remove fields/methods
- Breaking changes
```

### For Breaking Changes

If you need breaking changes:
1. Increment major version number
2. Provide migration script
3. Document breaking changes clearly

## Mature Level

### Badge
🔵 **Mature**

### Description
"In production since multiple versions and actively maintained"

### Requirements

| Requirement | Status |
|-------------|--------|
| All Stable requirements | ✅ Required |
| Exists in previous version | ✅ Required |
| Good test coverage | ✅ Required |
| No lint beta warnings | ✅ Required |
| User documentation | ✅ Required (USAGE.rst) |
| Changelog | 📝 Recommended |
| 2+ independent contributors | ✅ Required |
| 1+ declared maintainer | ✅ Required |
| Depends only on Mature | ✅ Required |
| OpenUpgrade scripts | ✅ If model changes |

### Characteristics

- Used in multiple deployments
- Maintained by multiple parties
- Survived version changes
- Expected to port to future versions
- Highest reliability level

### Documentation Requirements

For Mature status, documentation must include:

1. **USAGE.rst** - Detailed user instructions
2. **HISTORY.rst** - Changelog with version history
3. **DESCRIPTION.rst** - Clear feature description

## Declaring Maturity in Manifest

```python
{
    'name': 'My Module',
    'version': '17.0.1.0.0',
    'development_status': 'Beta',  # Alpha, Beta, Production/Stable, Mature
    'maintainers': ['github_username'],
    ...
}
```

If not specified, **Beta is assumed**.

## Promotion Workflow

### Alpha → Beta

1. Ensure CI is green
2. Ensure module installs correctly
3. Get 1 peer review
4. Format code (pre-commit)
5. Update manifest to `development_status: 'Beta'`

### Beta → Stable

1. Add tests if missing
2. Complete user documentation
3. Get 2 peer reviews
4. Wait 5-day review period (or get 3+ reviewers)
5. Ensure no Stable/Mature dependencies
6. Update manifest to `development_status: 'Production/Stable'`

### Stable → Mature

1. Ensure module exists in previous version
2. Verify good test coverage
3. Complete detailed USAGE.rst
4. Create HISTORY.rst with changelog
5. Verify 2+ independent contributors
6. Declare maintainer in manifest
7. Ensure all dependencies are Mature
8. Update manifest to `development_status: 'Mature'`

## Coexistence in Repositories

**Important**: All maturity levels coexist in the same repository and branches.

Always check:
1. The `development_status` in `__manifest__.py`
2. The README for current status
3. The Odoo version (may differ between versions)

A module can be:
- Mature in 16.0
- Stable in 17.0
- Beta in 18.0

## All Modules Published

Regardless of maturity level, **all modules are published to**:
- PyPI
- Odoo App Store

This means even Alpha modules are installable, but users should check maturity before production use.

## WIP Issue Template

For Alpha/Beta modules, create a WIP Issue:

```markdown
## Goal
[Describe the final goal of this module]

## Work Units
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

## Current Status
[What's done, what's pending]

## Help Wanted
[Any specific areas where help is needed]
```

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-contributing-guide.md` | Contributing guidelines |
| `oca-pr-workflow.md` | PR submission workflow |
| `oca-maintainer-role.md` | Maintainer responsibilities |
| `oca-repository-policy.md` | Repository policies |
| `oca-lookup-guideline.md` | Quick reference |
