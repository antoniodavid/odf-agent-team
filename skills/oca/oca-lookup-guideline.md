# OCA Guideline Lookup

Quick reference from Obsidian OCA documentation.

## Knowledge Base

Path: `~/Documents/obsidian-vault/02-Areas/OCA/`

| Document | Content |
|----------|---------|
| `OCA-Commit-Messages.md` | [TAG] format |
| `OCA-Contributing-Guidelines.md` | Code standards |
| `OCA-PR-Checklist.md` | PR requirements |
| `OCA-Development-Status.md` | Alpha/Beta/Stable |
| `OCA-Maintainer-Role.md` | Maintainer duties |
| `OCA-Repository-Policy.md` | Branch/version policy |

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
