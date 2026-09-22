# Testing & Database Safety (shared across ODF agents)

## Test Command Templates

Use the project's `testing.test_command` from `odf-init/{project}` (substitute
`{module}`) whenever it exists. Canonical templates:

- Docker Compose: `docker compose run --rm odoo odoo -d {test_db} -i {module} --test-enable --stop-after-init`
- Local: `odoo-bin -d {test_db} -i {module} --test-enable --stop-after-init`
- Targeted inner-loop evidence: `odoo-bin -d {test_db} --test-tags /<module> --stop-after-init` or `odoo-bin -d {test_db} --test-file <path> --stop-after-init`

Rules:

- A command without the exact `-d {test_db}` is invalid for Odoo DB tests.
- If the project config is missing, look for `docker-compose.yml`/`compose.yml`
  first — a Docker project must run tests through compose, never a bare `odoo-bin`.
- Disposable databases are preferred. A named non-isolated development database
  is allowed only for the current run when the current user-approved scope
  explicitly names that exact database and authorizes its use. State that
  authorization and warn that tests may mutate module, schema, and test data.
- If the exact database or authorization is missing, block; never guess.

## Database Safety (NON-NEGOTIABLE)

- **NEVER drop, destroy, truncate, or reset a database, schema, or table without the user's explicit, current consent.** This includes `dropdb`, `createdb`/reset/restore, `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, `DROP SCHEMA`, and destructive re-initialization. Consent to use a named non-isolated database for tests is NOT consent for any of them. Separate current consent must name the exact operation and database; none of these operations is test setup.
- `dropdb`/`createdb -T` patterns belong ONLY to the OCA runbot CI flow inside its isolated sandbox databases named after the GitHub username. They never apply to the developer's local/remote project databases.
- If a destructive operation is requested or needed, STOP, surface exactly which database would be destroyed (name, host, environment), and require separate current user consent for that exact operation and database before proceeding.
- SQL, Docker, database, and data-changing commands require current user confirmation before execution. If confirmation is unavailable, return the proposed command and mark the result `blocked`; do not execute it.
