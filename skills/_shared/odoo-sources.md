# Odoo Local Sources (shared across all ODF agents)

## Search Priority

Always inspect local Odoo source before external references. For structural or
codebase questions, use CodeGraph first, then native OpenCode `Glob`, `Grep`,
and `Read`. Do not assume additional search dependencies are installed.

1. **CodeGraph**: repo maps, architecture, call flow, dependencies, symbols, and impact.
2. **Local codebase**: native `Glob` to find paths, `Grep` for known text patterns, and `Read` for the actual files.
3. **Local docs**: Obsidian curated knowledge.
4. **Context7**: external documentation when local sources are insufficient.
5. **GitHub API**: OCA repositories for PRs and migration status only.

Never guess Odoo API behavior. Verify it against the target version's source
and tests.

## Local Codebase

| Version | Path | Contents |
|---------|------|----------|
| Odoo 19 | `~/Workspace/Doodba_ENV/O19/odoo/custom/src/odoo/` | odoo + enterprise |
| Odoo 18 | `~/Workspace/Doodba_ENV/O18/odoo/custom/src/odoo/` | odoo + enterprise |
| Odoo 17 | `~/Workspace/Doodba_ENV/O17/odoo/custom/src/odoo/` | odoo |
| Odoo 16 | `~/Workspace/Doodba_ENV/O16/odoo/custom/src/odoo/` | odoo |

### Key Paths Within Each Version

| What | Relative Path |
|------|--------------|
| Core addons | `addons/` |
| Enterprise addons | `enterprise/` (if available) |
| ORM base | `odoo/models.py`, `odoo/fields.py`, `odoo/api.py` |
| Web client (OWL) | `addons/web/static/src/` |
| Base module | `odoo/addons/base/` |

### Native Investigation Workflow

```text
1. Resolve the target version and local source root.
2. Use CodeGraph for structural questions when an index is available.
3. Use Glob to locate modules, manifests, models, views, and tests.
4. Use Grep for a specific symbol, field, XML ID, or API pattern.
5. Read the manifest, implementation, views, and tests before concluding.
```

## Local Documentation

| Topic | Path |
|-------|------|
| OCA Guidelines | `~/Documents/obsidian-vault/02-Areas/OCA/` |
| OCA Contributing Guide | `~/Documents/obsidian-vault/02-Areas/OCA/OCA-Contributing-Guidelines.md` |
| OWL Documentation | `~/Documents/obsidian-vault/02-Areas/OWL/` |
| Odoo Patterns | `~/Documents/obsidian-vault/03-Resources/Odoo-Patterns/` |

## OCA Skills

When specialized OCA analysis is needed, load the matching skill from
`skills/oca/`:

| Need | Skill File |
|------|------------|
| Code compliance check | `skills/oca/oca-compliance-check.md` |
| Pattern search in Odoo/OCA source | `skills/oca/oca-pattern-match.md` |
| API/model documentation | `skills/oca/oca-api-lookup.md` |
| Code review | `skills/oca/oca-code-review.md` |
| Migration assistance | `skills/oca/oca-migration-assist.md` |
| OpenUpgrade analysis | `skills/oca/oca-upgrade-analysis.md` |
| OCA guideline lookup | `skills/oca/oca-lookup-guideline.md` |

## Odoo UI Core

For OWL components and frontend patterns, inspect the actual target version:

```text
~/Workspace/Doodba_ENV/O{VER}/odoo/custom/src/odoo/addons/web/static/src/
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
