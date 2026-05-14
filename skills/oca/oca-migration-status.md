---
trigger: estado de migración|qué módulos faltan|migration status|progreso
---

# OCA Migration Status

Get complete migration status for an OCA repository.

## List Modules in Branch

```bash
# Via GitHub API
gh api "repos/OCA/{repo}/contents?ref={version}" \
  --jq '.[] | select(.type=="dir") | .name' | grep -v "^\." | grep -v "^setup$"
```

## Get Open Migration PRs

```bash
gh search prs --repo OCA/{repo} --base {version} "mig" --state open \
  --json number,title,author --limit 100
```

## Compare Versions

```bash
# Modules in source (e.g., 18.0)
source_modules=$(gh api "repos/OCA/{repo}/contents?ref=18.0" --jq '.[].name')

# Modules in target (e.g., 19.0)  
target_modules=$(gh api "repos/OCA/{repo}/contents?ref=19.0" --jq '.[].name')

# Diff
comm -23 <(echo "$source_modules" | sort) <(echo "$target_modules" | sort)
```

## Classify Modules

1. **MIGRATED**: Exists in target branch
2. **IN_PR**: Not in target, but has open [MIG] PR
3. **MISSING**: Not in target, no PR found

## Output Format

```
📊 Migration Status: OCA/{repo}

   Source: {from_version} ({source_count} modules)
   Target: {to_version} ({target_count} modules)

📈 Progress: [{progress_bar}] {percent}%

✅ MIGRATED ({count}):
   {module1}, {module2}, ...

⏳ IN PRs ({count}):
   | Module | PR | Author |
   |--------|-----|--------|

❌ MISSING ({count}):
   {module1}, {module2}, ...

💡 To find specific module:
   /oca-find-migration {repo} {version} {module}
```

## Progress Calculation

```
migrated = modules in target branch
in_pr = modules with open MIG PR
total = modules in source branch
percent = ((migrated + in_pr) / total) * 100
```
