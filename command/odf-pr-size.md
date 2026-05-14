---
description: "Check PR size against OCA review budget (400 lines). Usage: /odf-pr-size [--check] [--lines N]"
---

# ODF: PR Size Check

**Parse command:** `/odf-pr-size [--check] [--lines N]`

Examples:
- `/odf-pr-size` — Calculate changed lines for current branch vs main
- `/odf-pr-size --check` — Check if current branch meets budget
- `/odf-pr-size --lines 520` — Check if 520 lines is within budget

## What This Does

OCA recommends PRs ≤400 changed lines for healthy review. This command calculates the diff size and recommends split or `size:exception` if over budget.

## Orchestrator Instructions

### Default (no flags)

```
1. Run: git diff --stat main...HEAD
2. Extract total additions + deletions
3. If total > 400:
   Show: "⚠️  PR is {N} lines over budget. Recommended: split into chained PRs.
          Use /odf-pr-size --check for details."
4. If total <= 400:
   Show: "✅ PR is {N} lines — within OCA review budget."
```

### --check

```
1. Run git diff --stat main...HEAD
2. Report:

ODF: PR Size Report

  Changes: {N} files, +{A}/-{D} lines
  Budget:  400 lines (OCA recommended max)
  Status:  {WITHIN | OVER by N lines}

  Recommendation:
  WITHIN → "PR is reviewable as-is."
  OVER   → "Split into chained PRs. Use oca-chained-pr skill.
             If split is impossible, request size:exception from maintainer."
```

### --lines N

```
1. Compare N against 400
2. Show: "{N} lines — {WITHIN | OVER} OCA review budget"
```
