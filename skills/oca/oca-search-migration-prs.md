---
trigger: buscar migración|hay PR para|existe migración|migration PR|oca-port
---

# Search OCA Migration PRs

Find open migration PRs for OCA modules.

## Tools

### oca-port (preferred, in cloned repo)
```bash
cd /path/to/oca-repo
oca-port origin/{from_version} origin/{to_version} {module} --dry-run --non-interactive --output json
```

**JSON Output:**
```json
{"process": "migrate", "results": {"existing_pr": {"url": "...", "author": "...", "title": "...", "ref": "OCA/repo#123"}}}
```

### gh CLI (anywhere)
```bash
# Search by repo + version
gh search prs --repo OCA/{repo} --base {version} "mig" --state open --json number,title,author,url

# Search specific module
gh api "search/issues?q=is:pr+is:open+repo:OCA/{repo}+base:{version}+mig+{module}+in:title" \
  --jq '.items[] | {number, title, user: .user.login, html_url}'
```

## Parse Module from PR Title

Patterns:
- `[MIG] module_name: Migration to X.0`
- `[X.0][MIG] module_name`
- `[MIG] \`module_name\`: Migration to X.0`

```bash
# Extract module name
echo "$title" | sed -E 's/.*\[MIG\]\s*`?([a-z_]+)`?.*/\1/'
```

## Output Format

```
🔍 Migration PRs for OCA/{repo} → {version}

| # | Module | PR | Author | Status |
|---|--------|-----|--------|--------|
| 1 | {module} | #{number} | {author} | OPEN |

💡 Use: /oca-use-pr OCA/{repo}#{number}
```

## Error Handling

- No PRs found → Report "No open migration PRs"
- API rate limit → Suggest using --github-token
- Module not in source → "Module doesn't exist in {from_version}"
