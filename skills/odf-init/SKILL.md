---
name: odf-init
description: "Detect + persist Odoo project context: version, modules, test runner, lint tools, conventions. Trigger: /odf-init, first time in a project."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## When to Use

Use when entering a new Odoo project, or when project tooling changes (new test runner, new dependencies). Persists to Engram so all ODF phases reuse the config without re-detecting.

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
| Docker Compose present (docker-compose.yml / compose.yml / compose.yaml with an odoo service) | Build template `docker compose run --rm <service> odoo -d {test_db} -i {module} --test-enable --stop-after-init`; require an explicit disposable `{test_db}` |
| Local odoo-bin found with a disposable database detected | Build template `odoo-bin -d {test_db} -i {module} --test-enable --stop-after-init` |
| No disposable test database name/config detected | Block and ask the user; never guess a database or use a developer/production database |
| No test runner detected | Flag WARNING, set runner: none |

## Execution Steps

1. **Detect version**: __manifest__.py → odoo-bin → Dockerfile → ask
2. **Detect modules**: Find all __manifest__.py, classify as custom/oca/core-override
3. **Detect test runner**: Priority: Docker Compose → local odoo-bin → pytest-odoo
   - **Docker Compose**: if `docker-compose.yml`/`compose.yml`/`compose.yaml` exists at the project root and defines an `odoo` service (or `web`/`odoo-<name>`), the canonical run command is:
     ```
      docker compose run --rm odoo odoo -d {test_db} -i {module} --test-enable --stop-after-init
     ```
     Replace `{module}` with the module under test and `odoo` with the real service name if it differs. This is the `test_command` to persist — do NOT persist a bare `odoo-bin` invocation for a Docker Compose project.
    - **Local odoo-bin**: if a local `odoo-bin` is on PATH (or in the repo) and a disposable database name/config is detected, persist `odoo-bin -d {test_db} -i {module} --test-enable --stop-after-init`.
    - **Database safety**: a test command without explicit `-d {test_db}` is invalid for Odoo DB tests. Never document or generate `dropdb`, `DROP DATABASE`, `TRUNCATE`, or destructive re-initialization as automatic setup. If no disposable test database can be detected, return `blocked` and ask the user for the exact isolated database.
   - **pytest-odoo**: only when a `pytest.ini`/`setup.cfg` configures pytest-odoo.
4. **Detect linting**: pre-commit config, pylint-odoo availability, OCA compliance flags
5. **Detect conventions**: Module prefix patterns, git workflow, CI platform, README conventions
6. **Build config**: Assemble YAML with project_name, odoo_version, modules[], environment{}, testing{}, linting{}, flags{}, conventions{}
7. **Persist**: `mem_save(title: "odf-init/{project}", topic_key: "odf-init/{project}", type: "config", ...)`
    - Persist the resolved command under `testing.test_command` with literal `{test_db}` and `{module}` placeholders so IMPLEMENT/VERIFY can substitute the exact isolated database and module under test.

## Output Contract

Return ODF Result envelope with: status (ok|warning|blocked), executive_summary ("{project}: Odoo {ver}, {N} modules, {env}, {runner} tests"), artifacts_saved, risks (missing tooling warnings), odoo_version, modules_affected. Use `blocked` when no disposable test database name/config can be detected for DB tests.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
