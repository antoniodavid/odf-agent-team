---
trigger: dependencias del PR|qué necesita|depends on|PR dependencies
---

# Analyze PR Dependencies

Extract and verify dependencies from OCA migration PRs.

## Get PR Body

```bash
gh pr view {number} --repo OCA/{repo} --json body,title,state,mergeable
```

## Parse Dependencies

Look for patterns in PR body:
- `Depends on:` followed by PR links
- `And indirectly on:` for transitive deps
- URLs: `https://github.com/OCA/{repo}/pull/{number}`
- Refs: `OCA/{repo}#{number}`

```bash
# Extract dependency URLs
gh pr view {number} --repo OCA/{repo} --json body \
  --jq '.body' | grep -oE 'https://github.com/OCA/[^/]+/pull/[0-9]+' | sort -u
```

## Verify Each Dependency

```bash
# Check status of each dependency PR
gh pr view {dep_number} --repo OCA/{dep_repo} --json state,merged,title
```

## Build Dependency Tree

```
PR #1103 (delivery_carrier_picking_valid_dangerous_goods)
├── PR #1102 (delivery_carrier_picking_valid) - OPEN
├── OCA/community-data-files#259 - OPEN
└── Indirect:
    ├── OCA/stock-logistics-warehouse#2441 - OPEN
    └── OCA/product-attribute#2089 - OPEN
```

## Output Format

```
📦 PR: OCA/{repo}#{number}
   {title}

⚠️ DEPENDENCIAS DIRECTAS:
| # | PR | Módulo | Estado |
|---|-----|--------|--------|
| 1 | OCA/{repo}#{dep} | {module} | {state} |

🔗 DEPENDENCIAS INDIRECTAS:
| # | PR | Repo | Estado |
|---|-----|------|--------|

✅ Todas las dependencias mergeadas: {yes/no}
⚠️ Dependencias pendientes: {count}
```

## Dependency States

| State | Meaning | Action |
|-------|---------|--------|
| MERGED | Ready | ✅ Can use |
| OPEN | Pending | ⚠️ Need to checkout too |
| CLOSED | Rejected/Abandoned | ❌ May not work |
