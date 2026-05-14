---
trigger: usar PR|checkout PR|obtener código|get PR code
---

# Checkout OCA PR Code

Get code from a pending migration PR.

## Methods

### Method 1: gh pr checkout (in cloned repo)

```bash
cd /path/to/oca-repo
gh pr checkout {number}
```

### Method 2: Manual fetch

```bash
cd /path/to/oca-repo
git fetch origin pull/{number}/head:pr-{number}
git checkout pr-{number}
```

### Method 3: Copy single module

```bash
# Fetch without checkout
git fetch origin pull/{number}/head:pr-{number}

# Copy specific module to addons
git show pr-{number}:{module}/ | tar -xf - -C /path/to/addons/
```

### Method 4: Sparse checkout (large repos)

```bash
git clone --depth=1 --filter=blob:none --sparse \
  https://github.com/OCA/{repo}.git
cd {repo}
git sparse-checkout set {module}
gh pr checkout {number}
```

## Get PR Info First

```bash
gh pr view {number} --repo OCA/{repo} \
  --json headRefName,author,title,state,mergeable,files
```

## Output Format

```
📦 Checkout: OCA/{repo}#{number}

   Branch: {headRefName}
   Author: {author}
   State: {state}
   Mergeable: {mergeable}

📁 Files ({count}):
   {file1}
   {file2}
   ...

🔧 Commands:

   # In existing clone:
   gh pr checkout {number}

   # Or manual:
   git fetch origin pull/{number}/head:pr-{number}
   git checkout pr-{number}

⚠️ WARNING:
   This code is NOT officially approved.
   Review before using in production.
```

## Handle Dependencies

If PR has dependencies, checkout them first:

```bash
# Checkout dependency PRs in order
gh pr checkout {dep1_number} --repo OCA/{dep1_repo}
gh pr checkout {dep2_number} --repo OCA/{dep2_repo}
# Then main PR
gh pr checkout {number} --repo OCA/{repo}
```
