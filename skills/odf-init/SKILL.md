---
name: odf-init
description: "Detect + persist Odoo project context: version, modules, test runner, lint tools, conventions. Trigger: /odf-init, first time in a project."
license: MIT
metadata:
  author: adruban
  version: "2.2"
---

## Activation Contract

Use at project entry or when Odoo tooling changes, before phases that consume
project context. Detect locally and persist the result; do not guess missing
values.

## When to Use

Use when entering a new Odoo project, or when project tooling changes (new test runner, new dependencies). Persist to the selected store so all ODF phases reuse the config without re-detecting.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Never ask what can be detected | Try all detection methods before asking the user |
| Never guess | If detection fails for a field, set it to null — don't invent |
| Partial is better than none | Persist even partial detection |
| Upsert | Running /odf-init again updates the existing config |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Version in prompt | Use it directly |
| No version in prompt | Try: __manifest__.py → odoo-bin --version → Dockerfile → ask user |
| Test runner found via detection | Use detected command template with {module} placeholder |
| Docker Compose present (docker-compose.yml / compose.yml / compose.yaml with an odoo service) | Build template `docker compose run --rm <service> odoo -d {test_db} -i {module} --test-enable --stop-after-init`; disposable `{test_db}` is preferred |
| Local odoo-bin found with a named database | Build template `odoo-bin -d {test_db} -i {module} --test-enable --stop-after-init`; a non-isolated development database is allowed only for this run when the current user-approved scope names that exact `{test_db}` and authorizes its use |
| No exact database or current authorization for a non-isolated database | Block and ask the user; never guess a database or use a developer/production database without current authorization |
| No test runner detected | Flag WARNING, set runner: none |
| Doodba `odoo/custom/src/addons.yaml` present | Parse sources (active/commented), classify declared-absent and undeclared repos, and resolve project module dependencies against active sources |
| CodeGraph CLI available and `<repo>/.codegraph/` missing | Initialize the project index (default) or the active sources (`--deep`, opt-in, with a cost warning) |

## Execution Steps

0. **Deterministic scan (preferred)**: run the CLI once instead of hand-scanning:
   ```
   node <pack>/scripts/odf-project-scan.js --root <doodba-workspace-root> --repo <repo-dir> --persist --format json
   ```
   `<pack>` is the ODF pack directory (this repo or `$ODF_CONFIG_DIR`). The CLI assembles the full config (sources, compose, linting, git, CodeGraph, dependency matrix), persists it to Engram under `odf-init/{project}`, and exits `0` (ok), `1` (warnings), or `2` (blocked). Use `--diff` on re-detection to show changes vs the persisted config, `--fresh` to bypass the checksum cache, and flags for overrides (`--odoo-version`, `--docker-container`, `--codegraph` for CodeGraph init opt-in). The orchestrator relays the summary and interprets warnings only; it never re-derives the config. If the CLI cannot run (no node/script), fall back to the manual steps below — never guess.
1. **Detect version**: __manifest__.py → odoo-bin → Dockerfile → ask
2. **Detect modules**: Find all __manifest__.py, classify as custom/oca/core-override
3. **Environment Context (Doodba)**: When the workspace is a Doodba layout, detect the source manifest and resolve project module dependencies:
   - Locate the workspace root (where `odoo/custom/src/addons.yaml` lives) and run:
     ```
     node <pack>/scripts/odf-env-detect.js --root <root> --repo <repo> --json
     ```
     `<pack>` is the directory where ODF is installed (this repo or `$ODF_CONFIG_DIR`).
   - Persist under the config: `environment: { type: doodba, addons_yaml, sources: { active, declared_absent, undeclared, active_repos } }` and `dependency_matrix`.
   - Interpret `dependency_matrix.unresolved_in_sources` deps as `core-assumed` when they are standard Odoo addons (web, stock, sale, base, etc.) — they come from the Docker image. When an unresolved dep looks like a custom/OCA module not present in any active source, flag it as a WARNING/risk (missing repo, wrong branch, or undeclared source).
4. **CodeGraph Index**:
   - Call `odf_community_tool_detect("codegraph")`. If unavailable, warn and suggest `odf_community_tool_install("codegraph", workspace_dir)` — never install silently.
   - If `<repo>/.codegraph/` is missing → run `codegraph init` on the project repo. If present → run `codegraph status`, and run `codegraph sync` only when the watcher is disabled or the index is stale.
   - Default indexes ONLY the project repo (fast). `--deep` (opt-in flag) additionally indexes each active repo from addons.yaml, bounded, with a cost warning.
   - Persist `codegraph: { indexed: boolean, root, paths: [], last_sync: <iso|null> }`.
5. **Detect test runner**: Priority: Docker Compose → local odoo-bin → pytest-odoo
   - **Docker Compose**: if `docker-compose.yml`/`compose.yml`/`compose.yaml` exists at the project root and defines an `odoo` service (or `web`/`odoo-<name>`), the canonical run command is:
     ```
      docker compose run --rm odoo odoo -d {test_db} -i {module} --test-enable --stop-after-init
     ```
     Replace `{module}` with the module under test and `odoo` with the real service name if it differs. This is the `test_command` to persist — do NOT persist a bare `odoo-bin` invocation for a Docker Compose project.
     - **Local odoo-bin**: if a local `odoo-bin` is on PATH (or in the repo) and a disposable or explicitly authorized named database is detected, persist `odoo-bin -d {test_db} -i {module} --test-enable --stop-after-init`.
     - **Database safety**: a test command without the exact `-d {test_db}` is invalid for Odoo DB tests. Disposable databases remain preferred. A non-isolated development database is allowed only when the current user-approved scope names that exact database and authorizes its use. The phase result/evidence must state `database: {test_db}`, `database_isolation: non-isolated`, `database_authorization: current-user-approved`, and warn that tests may mutate module, schema, and test data. Consent to use the database does not authorize `dropdb`, `createdb`/reset/restore, `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, `DROP SCHEMA`, or destructive re-initialization; those require separate current consent for the exact operation and database and are not test setup. If the exact database or authorization is absent, return `blocked` and ask the user.
    - **pytest-odoo**: only when a `pytest.ini`/`setup.cfg` configures pytest-odoo.
6. **Detect linting**: pre-commit config, pylint-odoo availability, OCA compliance flags
7. **Detect conventions**: Module prefix patterns, git workflow, CI platform, README conventions
8. **Build config**: Assemble YAML with project_name, odoo_version, modules[], environment{}, testing{}, linting{}, flags{}, conventions{}
9. **Persist** the config in the selected store and return its canonical `artifact_ref`.
     - Persist the resolved command under `testing.test_command` with literal `{test_db}` and `{module}` placeholders so IMPLEMENT/VERIFY can substitute the exact authorized database and module under test.

## Output Contract

Return ODF Result envelope with: status (ok|warning|blocked), executive_summary ("{project}: Odoo {ver}, {N} modules, {env}, {runner} tests"), artifacts_saved, risks (missing tooling warnings), odoo_version, modules_affected. For a non-isolated database, include its exact name, `database_isolation: non-isolated`, `database_authorization: current-user-approved`, and the warning that tests may mutate module, schema, and test data. Use `blocked` when the exact database or required current authorization is missing.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/persistence-contract.md` — selected store and artifact references
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
