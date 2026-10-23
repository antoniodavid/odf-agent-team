# Remove the NotebookLM lookup tool

Objective: remove `odf_notebooklm_lookup` and the `notebooklm_sources` registry map, which were convenience-only and are not called by the ODF runtime. Community tools and CodeGraph remain available.

Branch: `fix/odf-tools-audit-hardening` (follow-up commit to the A1-A6 audit hardening). Test runner `npm test`.

## Specs

### S1 — Tool removal

- `odf_notebooklm_lookup` is not present in `ODF_REGISTERED_TOOLS`, the registered tool map, or the plugin system rules.
- `createODFNotebookLMLookup` is deleted.
- The read-only loop guard no longer lists the removed tool.
- The exposed tool count is 29, not 30.

### S2 — Registry cleanup

- `odf-registry.json` no longer contains `notebooklm_sources`.
- `ODFRegistry` no longer declares `notebooklm_sources`.
- `loadRegistry` no longer validates that field.
- A stale registry containing the removed field remains loadable; the field is simply ignored.

### S3 — Documentation and specs

- `AGENTS.md`, `docs/plugin.md`, `docs/README.md`, and `docs/architecture.md` no longer list the tool and show 29 tools.
- Current OpenSpec specs no longer require the tool or the registry field.
- `CHANGELOG.md` has an Unreleased Removed entry.
- NotebookLM enrichment in skills/agents remains an external capability; this change removes only the ODF lookup.

### S4 — Tests and verification

- A regression assertion proves `ODF_REGISTERED_TOOLS` does not contain `odf_notebooklm_lookup`.
- A registry fixture with a legacy `notebooklm_sources` map still loads (ignored field).
- `npm run typecheck`, `npm run test:unit`, `npm run test:yaml`, registry validation, and `git diff --check` pass.
- Community tools, CodeGraph installation via `install.sh --with-codegraph`, and all unrelated behavior remain unchanged.

## Tasks

- [x] T1 — S1 — remove the creator, registration, system-rules entry, and loop-guard entry.
- [x] T2 — S2 — remove the registry field, type, and loader validation.
- [x] T3 — S3 — update docs, current specs, and changelog.
- [x] T4 — S4 — add regression assertions and run full verification.

## Log

### L1 — Original request (verbatim)

> continue, las community tools y notebook lookup se pueden eliminar??,no creo que las este usando actualmente, por lo cual no estaria extranandolas

### L2 — Scope decision (verbatim option)

> Solo NotebookLM

> Elimino solo odf_notebooklm_lookup y notebooklm_sources; conservo detect/install de community tools.

### L3 — Evidence

- The lookup only read `notebooklm_sources` from the registry; no runtime code called it.
- Community tools remain referenced by the `odf-init` CodeGraph step, so they are intentionally retained.
- Current references were limited to the plugin, registry type/loader, loop guard, docs/specs, and a changelog entry.

### L4 — Verification

- `npm run typecheck`: clean.
- `npm run test:unit`: 1344/1344.
- `npm run test:yaml`: 331/331.
- `odf-plugin/odf-registry-shape.test.ts`: 5/5.
- Registry validation: all registered paths valid.
- `git diff --check`: clean.

### Risk

Risk: item 3 — requested removal of a public tool and registry field. The local suite is green; an independent verifier is unavailable in this runtime, so this is not a native PASS claim.
