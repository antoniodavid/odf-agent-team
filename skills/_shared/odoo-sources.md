# Odoo Local Sources (shared across all ODF agents)

## Search Priority (CRITICAL)

ALWAYS search in this order. NEVER skip to external sources before checking local.

1. **LOCAL codebase** (fff for files/paths, mgrep for code/concepts — fast, authoritative)
2. **LOCAL docs** (Obsidian — curated knowledge)
3. **Context7** (external docs — when local doesn't have it)
4. **GitHub API** (OCA repos — for PRs, migration status only)

NEVER guess Odoo API behavior. ALWAYS verify against local source.

## Search Tools Guide (mgrep vs fff)

Use the right tool for the job. They complement each other:

| Tool | Best For | When to Use |
|------|----------|-------------|
| **fff** | Finding FILES by name/path | You know the filename or part of it |
| **mgrep** | Finding CODE by meaning/concept | You know what the code does, not where it is |
| **grep** | Simple regex in known files | Quick checks in specific files |

### Decision Tree

```
¿Buscas un ARCHIVO por su NOMBRE o PATH?
  → Usa fff (fuzzy finding, muy rápido)
     Ejemplo: fff "sale_order.py" ~/Workspace/Odoo/O18/

¿Buscas CÓDIGO por su SIGNIFICADO o CONTENIDO?
  → Usa mgrep (búsqueda semántica)
     Ejemplo: mgrep "cómo calculan los descuentos" ~/Workspace/Odoo/O18/

¿Ya sabes en qué archivo buscar y necesitas un patrón específico?
  → Usa grep (regex simple)
     Ejemplo: grep "def _compute" ~/Workspace/Odoo/O18/addons/sale/models/sale_order.py
```

### Complementary Workflow (Recommended)

The most powerful approach combines both tools:

```bash
# Paso 1: Encuentra rápidamente el archivo con fff
fff "sale_order" ~/Workspace/Odoo/O18/addons/sale/
# Result: encuentra sale_order.py en models/

# Paso 2: Busca semánticamente en ese archivo con mgrep
mgrep "discount calculation" ~/Workspace/Odoo/O18/addons/sale/models/sale_order.py
# Result: encuentra el método _compute_discount y sus dependencias
```

## Local Codebase

| Version | Path | Contents |
|---------|------|----------|
| Odoo 19 | `~/Workspace/Odoo/O19/` | odoo + enterprise |
| Odoo 18 | `~/Workspace/Odoo/O18/` | odoo + enterprise |
| Odoo 17 | `~/Workspace/Odoo/O17/` | odoo |
| Odoo 16 | `~/Workspace/Odoo/O16/` | odoo |

### Key Paths Within Each Version

| What | Relative Path |
|------|--------------|
| Core addons | `addons/` |
| Enterprise addons | `enterprise/` (if available) |
| ORM base | `odoo/models.py`, `odoo/fields.py`, `odoo/api.py` |
| Web client (OWL) | `addons/web/static/src/` |
| Base module | `odoo/addons/base/` |

### FFF Advanced Features (Deep Integration)

fff is a fast file finder with **memory built-in** (frecency tracking), three search modes, and powerful constraints.

### Search Modes

By default, fff uses **plain** search (literal match). You can use three modes:

```bash
# Plain (default) - literal match, safe for code with special chars
fff "sale_order.py" ~/path/
fff "compute_discount" ~/path/

# Regex - regular expressions (.*, \d, etc.)
fff "sale.*order.*\.py" ~/path/           # files containing "sale", then "order", then ".py"
fff "test_\d+" ~/path/                     # test_1, test_2, etc.

# Fuzzy - typo-tolerant, Smith-Waterman scoring
fff "sael_ordr" ~/path/                   # finds sale_order.py
fff "cmpt_dscont" ~/path/                 # finds compute_discount
```

**When to use each mode:**
- **Plain**: Most common. Safe for code with regex special chars like `.`, `*`, `(`, etc.
- **Regex**: When you know the pattern structure. Good for `test_\d+`, `.*\.xml`, etc.
- **Fuzzy**: When you have typos or partial names. Good for quick searches.

### FFF Constraints (Powerful Filters)

Constraints are the most powerful feature of fff. They filter results dramatically:

```bash
# Git status filters
fff "." ~/path/ --constraint "git:modified"         # only modified files
fff "." ~/path/ --constraint "git:staged"           # only staged files
fff "." ~/path/ --constraint "git:untracked"       # only new files
fff "." ~/path/ --constraint "git:deleted"           # only deleted files

# Exclusion filters
fff "sale" ~/path/ --constraint "!tests/"          # exclude tests directory
fff "discount" ~/path/ --constraint "!__pycache__/" # exclude cache
fff "." ~/path/ --constraint "!static/src/lib/"      # exclude vendor libs

# Path filters (glob)
fff "*.py" ~/path/ --constraint "models/**"         # only .py in models/
fff "*.xml" ~/path/ --constraint "views/**"         # only .xml in views/

# Combining constraints
fff "." ~/path/ --constraint "git:modified" --constraint "!tests/"
fff "*.py" ~/path/ --constraint "models/**" --constraint "!__pycache__/"
```

### Cross-Mode Suggestions (Automatic)

fff automatically suggests the opposite search type when no results found:

```bash
# Searching for files, but no exact matches
fff "compute_discount" ~/path/
# → If no file found, fff automatically shows grep/content suggestions
# → "No files found. Did you mean to search in content?"

# Searching for content pattern, but no matches
fff --grep "xyz_nonexistent" ~/path/
# → If no content matches, fff suggests file name alternatives
```

This means: **don't give up if the first search fails** — fff will help you find alternatives.

### Frecency (Built-in Memory)

fff tracks which files you open and how often, prioritizing them in future searches:

```bash
# First search: normal results
fff "sale_order.py" ~/Workspace/Odoo/O18/addons/sale/

# Subsequent searches: frequently opened files appear first
# Results are boosted by:
#   - Recency: recently opened files
#   - Frequency: files opened multiple times
#   - Combo boost: same file opened with same query 3+ times
```

**For Odoo**: If you constantly work with `sale_order.py`, `stock_picking.py`, etc., fff will progressively prioritize them.

## How to Search

#### Using fff (Fast File Finder) — For Finding Files by Name

```bash
# Find a specific file by name (fuzzy matching)
fff "sale_order.py" ~/Workspace/Odoo/O18/addons/sale/

# Find all test files in a module
fff "test_" ~/Workspace/Odoo/O18/addons/sale/tests/

# Find manifest files
fff "__manifest__" ~/Workspace/Odoo/O18/addons/

# Find view XML files
fff "_view_.*\.xml" ~/Workspace/Odoo/O18/addons/sale/
```

#### Using mgrep — For Semantic Code Search

```bash
# Search for a specific model definition
mgrep "class SaleOrder" ~/Workspace/Odoo/O18/addons/sale/

# Search for a field in a specific module
mgrep "discount" ~/Workspace/Odoo/O18/addons/sale/models/

# Search for OWL component patterns
mgrep "useService" ~/Workspace/Odoo/O18/addons/web/static/src/

# Search for view inheritance patterns
mgrep "inherit_id" ~/Workspace/Odoo/O18/addons/sale/views/

# Search for concepts (mgrep strength)
mgrep "how to calculate taxes" ~/Workspace/Odoo/O18/addons/account/
mgrep "inventory valuation methods" ~/Workspace/Odoo/O18/addons/stock/
```

#### Combined Workflow Examples

```bash
# Example 1: Find sale module files, then search for discount logic
fff "sale" ~/Workspace/Odoo/O18/addons/ | head -5
mgrep "discount calculation" ~/Workspace/Odoo/O18/addons/sale/

# Example 2: Find all model files, then search for a specific pattern
fff "models/.*\.py" ~/Workspace/Odoo/O18/addons/crm/
mgrep "def _compute" ~/Workspace/Odoo/O18/addons/crm/models/

# Example 3: Locate a view file, then check its inheritance
fff "sale_order_view" ~/Workspace/Odoo/O18/addons/sale/views/
mgrep "inherit_id" ~/Workspace/Odoo/O18/addons/sale/views/sale_order_views.xml
```

### Odoo-Specific Workflows

These workflows combine fff advanced features with Odoo patterns:

#### Workflow 1: Investigate a Field Implementation

```bash
# Step 1: Find the model file with fuzzy search
fff "sale_order.py" ~/Workspace/Odoo/O18/addons/sale/models/
# Result: sale_order.py quickly appears (frecency helps if used before)

# Step 2: Find how a specific field is computed
grep "_compute_discount" ~/Workspace/Odoo/O18/addons/sale/models/sale_order.py

# Step 3: Check what fields it depends on
mgrep "depends.*discount" ~/Workspace/Odoo/O18/addons/sale/models/sale_order.py
```

#### Workflow 2: Find Changes in a Module (Git Integration)

```bash
# See what files changed in the sale module
fff "." ~/Workspace/Odoo/O18/addons/sale/ --constraint "git:modified"

# Focus on Python files only
fff "*.py" ~/Workspace/Odoo/O18/addons/sale/ --constraint "git:modified"

# See staged changes ready to commit
fff "." ~/Workspace/Odoo/O18/addons/sale/ --constraint "git:staged"
```

#### Workflow 3: Compare Across Odoo Versions

```bash
# Find a file in Odoo 18
fff "account_move" ~/Workspace/Odoo/O18/addons/account/models/

# Compare with Odoo 17
fff "account_move" ~/Workspace/Odoo/O17/addons/account/models/

# Or use fuzzy for version differences
fff "account" ~/Workspace/Odoo/O18/addons/ | head -10
fff "account" ~/Workspace/Odoo/O17/addons/ | head -10
```

#### Workflow 4: Find Test Patterns

```bash
# Find all test files in a module
fff "test_" ~/Workspace/Odoo/O18/addons/sale/tests/

# Find test for a specific model
fff "test_sale" ~/Workspace/Odoo/O18/addons/sale/tests/

# Find tests excluding fixtures
fff "test_" ~/Workspace/Odoo/O18/addons/sale/tests/ --constraint "!__pycache__/"
```

#### Workflow 5: Find OWL Components Fast

```bash
# Find frontend files with fuzzy search
fff "dashboard" ~/Workspace/Odoo/O18/addons/web/static/src/

# Find only JavaScript files in views
fff "*.js" ~/Workspace/Odoo/O18/addons/web/static/src/views/ --constraint "!**/lib/**"

# Find QWeb templates
fff "*.xml" ~/Workspace/Odoo/O18/addons/web/static/src/views/ | grep -i kanban
```

#### Workflow 6: Find Security Rules

```bash
# Find access control files
fff "access" ~/Workspace/Odoo/O18/addons/sale/security/

# Find ir.model.access.csv files
fff "ir.model.access.csv" ~/Workspace/Odoo/O18/addons/

# Find record rules
fff "*rule*" ~/Workspace/Odoo/O18/addons/base/security/
```

#### Workflow 7: Debug with Cross-Mode Suggestions

```bash
# Try to find by filename (may not exist)
fff "compute_tax" ~/Workspace/Odoo/O18/addons/account/
# → If not found, fff suggests: "Search in content?"

# Accept suggestion to search in content
fff --grep "compute_tax" ~/Workspace/Odoo/O18/addons/account/
# → fff searches file contents and finds the method
```

### Constraints Quick Reference for Odoo

```bash
# Git status
--constraint "git:modified"    # Changed files
--constraint "git:staged"      # Ready to commit
--constraint "git:untracked"   # New files

# Common exclusions
--constraint "!tests/"          # Skip test directories
--constraint "!__pycache__/"    # Skip cache
--constraint "!static/src/lib/" # Skip vendor libs

# Path filters
--constraint "models/**"       # Only in models/
--constraint "views/**"        # Only in views/
```

#### Quick Reference: Which Tool to Use?

| Scenario | Tool | Command Example |
|----------|------|----------------|
| Basic file search | fff | `fff "sale_order.py" ~/path/` |
| Search by content meaning | mgrep | `mgrep "tax calculation" ~/path/` |
| Search with typos | fff fuzzy | `fff "sael_ordr" ~/path/` |
| Regex pattern | fff regex | `fff "sale.*order.*\.py" ~/path/` |
| Only modified files | fff + git | `fff "." ~/path/ --constraint "git:modified"` |
| Exclude tests | fff + constraint | `fff "sale" ~/path/ --constraint "!tests/"` |
| Only in models/ | fff + path | `fff "*.py" ~/path/ --constraint "models/**"` |
| Debug: no results | fff cross-mode | `fff "method" ~/path/` → suggestions auto-shown |
| Specific method in known file | grep | `grep "def _compute" file.py` |
| Test files | fff | `fff "test_" ~/path/tests/` |
| OWL components | fff | `fff "dashboard" ~/path/web/static/src/` |

## Local Documentation (Obsidian)

| Topic | Path |
|-------|------|
| OCA Guidelines | `~/Documents/obsidian-vault/02-Areas/OCA/` |
| OCA Contributing Guide | `~/Documents/obsidian-vault/02-Areas/OCA/OCA-Contributing-Guidelines.md` |
| OWL Documentation | `~/Documents/obsidian-vault/02-Areas/OWL/` |
| Odoo Patterns | `~/Documents/obsidian-vault/03-Resources/Odoo-Patterns/` |

## OCA Skills (for specialized lookups)

When you need OCA-specific analysis, load the appropriate skill from `/home/adruban/.config/opencode/skills/oca/`:

| Need | Skill File |
|------|-----------|
| Code compliance check | `/home/adruban/.config/opencode/skills/oca/oca-compliance-check.md` |
| Pattern search in Odoo/OCA source | `/home/adruban/.config/opencode/skills/oca/oca-pattern-match.md` |
| API/model documentation | `/home/adruban/.config/opencode/skills/oca/oca-api-lookup.md` |
| Code review | `/home/adruban/.config/opencode/skills/oca/oca-code-review.md` |
| Migration assistance | `/home/adruban/.config/opencode/skills/oca/oca-migration-assist.md` |
| OpenUpgrade analysis | `/home/adruban/.config/opencode/skills/oca/oca-upgrade-analysis.md` |
| OCA guideline lookup | `/home/adruban/.config/opencode/skills/oca/oca-lookup-guideline.md` |

## Odoo UI Core (per version)

For OWL components and frontend patterns, always check the actual Odoo implementation:

```
~/Workspace/Odoo/O{VER}/addons/web/static/src/
  core/           <- registries, services, utils
  views/          <- view controllers, renderers, models
  search/         <- search bar, facets, filters
  webclient/      <- main WebClient, action manager
  legacy/         <- legacy widget bridge (avoid for new code)
```

## Version Detection

To auto-detect the Odoo version of the current project:

```bash
# Check __manifest__.py for version field
grep "version" __manifest__.py
# Format: "18.0.1.0.0" -> Odoo 18

# Check odoo-bin version
odoo-bin --version

# Check requirements.txt or setup.py for odoo dependency
```
