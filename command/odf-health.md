---
description: "Check ODF agent system health. Usage: /odf-health [--quick|--full]"
---

# ODF: Health Check

**Parse command:** `/odf-health [--quick|--full]`

`/odf-health` is a read-only installation check. The quick path calls the
runtime-registered `odf_health` tool and returns its JSON result.

## Quick (Default)

Call `odf_health` with no arguments and report the returned `schema_version: 1`
result without rewriting it. It checks:

- The configured registry JSON and every registered skill/agent file.
- The installed plugin and `/odf-health` command file.
- Task API presence only. It does not call `task()`; usability is therefore
  `unverified` and the overall status is normally `warning`.
- Engram executable path/version when safely discoverable. `export_probe` must
  remain `not-run`; Engram is optional for OpenSpec-only workflows.

Never use this check to execute Odoo, PostgreSQL, a sub-agent task, or
`engram export`.

Status semantics:

- `failed`: malformed/missing registry or required installed files.
- `blocked`: permission denied, runtime timeout, or unavailable task API.
- `warning`: static installation is valid but task usability remains
  unverified, or optional Engram is unavailable.
- `ok`: all required checks pass and no unverified runtime dependency remains.

## Full (Static Validation)

Run the quick `odf_health` check first, then perform the non-runtime validation
below. Do not replace static evidence with a runtime smoke test:

1. Validate every registered skill and agent path, including unregistered files
   under `skills/` and `agent/`.
2. Run the deterministic test runner: `node scripts/odf-test-runner.js`.
3. Run focused plugin tests, `npm run typecheck`, and `git diff --check` as
   appropriate for the change.
4. Inspect backups and metrics only as filesystem metadata; do not mutate them.

Report the `odf_health` result separately from test-runner evidence.
