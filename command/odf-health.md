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
- Native task bridge presence, when the host exposes `toolCtx.task`, or SDK
  child-session capability. It does not call either transport; usability is
  therefore `unverified`.
- The V2 session attached to the tool context. The native prepare/subagent/seal
  protocol requires this API to read and validate the child session; an SDK
  fallback reported for diagnostics does not satisfy the seal requirement.
- Engram executable path/version when safely discoverable. `export_probe` must
  remain `not-run`; Engram is optional for OpenSpec-only workflows.

Never use this check to execute Odoo, PostgreSQL, a sub-agent task, or
`engram export`.

The native task bridge is preferred when present. Health reports transport
capability only and never infers usability or runtime permission parity. For
native delegation, the context-attached V2 session must expose the complete
supported operation set; the seal specifically uses `session.get` and
`session.context`.

Status semantics:

- `failed`: malformed/missing registry or required installed files.
- `blocked`: permission denied, runtime timeout, unavailable task API, or
  missing context-attached V2 session required by the native seal.
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
   appropriate for the change. The installed pack ships a narrowed
   `tsconfig.json` (ODF-owned files only) and excludes the repo-only
   doc-consistency test, so both checks are meaningful from the pack root.
4. Inspect backups and metrics only as filesystem metadata; do not mutate them.

Report the `odf_health` result separately from test-runner evidence.
