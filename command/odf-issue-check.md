---
description: "Verify a GitHub issue has maintainer approval before starting work. Usage: /odf-issue-check <N> --repo OCA/<name>"
---

# ODF: Issue Check

**Parse command:** `/odf-issue-check <N> --repo OCA/<name>`

Examples:
- `/odf-issue-check 42 --repo OCA/sale-workflow` — Check issue #42 in OCA/sale-workflow
- `/odf-issue-check --current-branch` — Extract issue number from current branch name

## What This Does

OCA requires that every PR is linked to an approved issue (`status:approved`). This command verifies the issue exists, has been approved, and is ready to work on.

## Orchestrator Instructions

### With --repo

```
1. gh issue view <N> --repo <repo> --json title,labels,state
2. Check:
   - state is "open"?
   - labels include "status:approved"?
3. Report:

ODF: Issue Check

  Issue: #{N} — {title}
  Repo:  {repo}
  State: {open | closed}
  Label: {has status:approved | missing status:approved}

  Verdict:
  ✅ APPROVED → "Issue is ready. You can start work."
  ❌ NOT APPROVED → "Issue {N} is not yet approved. Wait for a maintainer to add status:approved before starting work."
  ❌ CLOSED → "Issue #{N} is closed. Cannot start work on a closed issue."
```

### Without --repo (extract from current branch)

```
1. git branch --show-current → e.g., "fix/sale_order-missing-partner-42"
2. Extract number at the end: "-42" → 42
3. Find repo from git remote: git remote get-url origin
   Extract OCA/<repo> from URL
4. If number found: proceed with check
5. If no number found: ask user for issue number and repo
```
