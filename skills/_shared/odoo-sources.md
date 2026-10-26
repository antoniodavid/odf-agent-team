# Odoo Local Sources (shared across all ODF agents)

## Search Priority

Always inspect local Odoo source before external references. For structural or
codebase questions, use CodeGraph first, then FFF (`fff_find_files` /
`fff_grep`) for search, then `Read`. Do not assume additional search
dependencies are installed.

**VERIFY before you write (precision gate)**: every view XML ID (`inherit_id ref="module.id"`), model name, and `_inherit` used in design or code MUST be found in the local source first — never written from memory. Run:
```
PACK="${ODF_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
node "$PACK/scripts/odf-toolkit.js" lookup --source <odoo-src-root> [--repos <src-dir>] --id <xmlid> | --model <model>
node "$PACK/scripts/odf-toolkit.js" verify-refs --repo <module-dir> --source <odoo-src-root> [--repos <src-dir>]
```
Record the defining file:line in the artifact. If the ID/model does not resolve, treat it as an OPEN decision — never guess.

**NEVER use `mgrep` for searches.** It is denied for ODF agents. Use
`fff_find_files`, `fff_grep`, or `fff_multi_grep` (faster, project-native), and
CodeGraph for structural questions.

1. **CodeGraph**: repo maps, architecture, call flow, dependencies, symbols, and impact.
2. **Local codebase**: FFF to search — `fff_find_files` to find paths, `fff_grep` / `fff_multi_grep` for known text patterns, then `Read` for the actual files.
3. **Local docs**: Obsidian curated knowledge.
4. **Context7**: external documentation when local sources are insufficient.
5. **GitHub API**: OCA repositories for PRs and migration status only.

Never guess Odoo API behavior. Verify it against the target version's source
and tests.

## Local Codebase

The source root is resolved per project by `odf-init` and exposed as
`<odoo-source-root>`. Typical layout:

| What | Relative path |
|------|---------------|
| Core addons | `<odoo-source-root>/odoo/addons/` |
| Enterprise addons | `<odoo-source-root>/enterprise/` |
| ORM base | `<odoo-source-root>/odoo/odoo/models.py`, `fields.py`, `api.py` |
| Web client (OWL) | `<odoo-source-root>/odoo/addons/web/static/src/` |
| Base module | `<odoo-source-root>/odoo/odoo/addons/base/` |

### Native Investigation Workflow

```text
1. Resolve the target version and local source root.
2. Use CodeGraph for structural questions when an index is available.
3. Use `fff_find_files` to locate modules, manifests, models, views, and tests.
4. Use `fff_grep` / `fff_multi_grep` for a specific symbol, field, XML ID, or API pattern.
5. Read the manifest, implementation, views, and tests before concluding.
```

## Local Documentation

Use the bundled skills as the curated reference:

| Topic | Skill |
|-------|-------|
| OCA governance and PR rules | `../oca-governance-pr-workflow/SKILL.md` |
| OCA style | `../oca-python-style/SKILL.md`, `../oca-xml-style/SKILL.md` |
| OWL components | `../owl-components/SKILL.md` |
| Odoo patterns | `../computed-field-patterns/SKILL.md` and sibling pattern skills |

## OCA Skills

When specialized OCA analysis is needed, load the matching skill:

| Need | Skill File |
|------|------------|
| Code compliance check | `../oca-compliance-check/SKILL.md` |
| Pattern search in Odoo/OCA source | `../oca-pattern-match/SKILL.md` |
| API/model documentation | `../oca-api-lookup/SKILL.md` |
| Code review | `../oca-code-review/SKILL.md` |
| Migration assistance | `../oca-migration-assist/SKILL.md` |
| OpenUpgrade analysis | `../oca-upgrade-analysis/SKILL.md` |
| OCA guideline lookup | `../oca-lookup-guideline/SKILL.md` |

## Odoo UI Core

For OWL components and frontend patterns, inspect the actual target version:

```text
<odoo-source-root>/odoo/addons/web/static/src/
  core/           registries, services, utils
  views/          view controllers, renderers, models
  search/         search bar, facets, filters
  webclient/      main WebClient, action manager
  legacy/         legacy widget bridge (avoid for new code)
```

## Version Detection

To detect the Odoo version of the current project, inspect `__manifest__.py`
for a version such as `18.0.1.0.0`, then confirm with `odoo-bin --version` or
the project's requirements/configuration when available.
