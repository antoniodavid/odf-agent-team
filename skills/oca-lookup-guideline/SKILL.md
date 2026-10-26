---
name: oca-lookup-guideline
description: "Oca Lookup Guideline. Trigger: oca guideline lookup, quick reference, policy lookup."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# OCA Guideline Lookup

Quick reference from the OCA skills bundled in this pack.

## Knowledge Base

Load the specific skill instead of an external vault:

| Topic | Skill |
|-------|-------|
| Commit messages | `../oca-governance-commit-messages/SKILL.md` |
| Contributing guidelines | `../oca-contributing-guidelines/SKILL.md` |
| PR workflow | `../oca-governance-pr-workflow/SKILL.md` |
| Maturity levels | `../oca-maturity-levels/SKILL.md` |
| Maintainer role | `../oca-maintainer-role/SKILL.md` |
| Repository policy | `../oca-repository-policy/SKILL.md` |

## Commit Tags

| Tag | Use |
|-----|-----|
| `[FIX]` | Bug fix |
| `[ADD]` | New feature |
| `[IMP]` | Improvement |
| `[REF]` | Refactoring |
| `[REM]` | Remove feature |
| `[MIG]` | Migration |
| `[DOC]` | Documentation |

## Format

```
[TAG] module: message (max 50 chars)

Optional body explaining WHY.

Closes #123
```

## Quick Rules

- **Manifest:** version X.Y.Z, license LGPL-3/AGPL-3, author contains "OCA"
- **Python:** PEP8, no SQL injection, proper imports
- **XML:** 4-space indent, semantic IDs
- **Security:** ir.model.access.csv for all models
- **Tests:** TransactionCase/HttpCase with proper tags
