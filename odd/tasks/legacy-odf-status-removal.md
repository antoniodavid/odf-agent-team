# Legacy `odf_status` Removal (D1)

Objective: delete the deprecated `odf_status` tool and its Engram-only status builder after moving the `odf_workflow_status` fallback onto the canonical merged builder.
Branch: `feature/legacy-odf-status-removal` (two work-unit commits). Delivery strategy `ask-on-risk`; test runner `npm test` (Vitest + YAML scenarios).
Status: implemented, verified locally, and committed.

## Specs

### S1 — Engram-only changes stay readable through `odf_workflow_status`

A change whose artifacts exist only as Engram observations (`odf/<change>/<type>`) must keep resolving through the canonical tool after `buildEngramStatus` is deleted.

Acceptance:
- An explicit Engram-only change returns `status: "found"`, `source.state: "engram"`, and the warning `OpenSpec state was not read; status is derived from Engram artifacts.`
- `applyProgress`, the `artifacts` compatibility map, `phase`, and `lastUpdated` keep the same values the deprecated tool produced for the same observations.
- A change with an Engram `state` artifact keeps `state_kind: "canonical"`; an artifact-only change keeps `state_kind: "legacy-artifacts"`.
- Unnamed discovery keeps its current behavior: archived Engram-only changes are excluded, several active changes report `ambiguous`, and an incomplete export blocks instead of selecting.
- The Engram-only path is built by the same merged builder as every other source; no second status derivation remains.

### S2 — Remove the deprecated tool and its builder

Acceptance:
- `odf_status` is absent from `ODF_REGISTERED_TOOLS`, from `createODFRegisteredTools()`, and from the loop-guard read set.
- `createODFStatus`, `loadEngramStatus`, and `buildEngramStatus` are deleted; the plugin export list no longer exposes them.
- No command, agent, or doc instructs calling `odf_status`.
- `legacyArtifactState` stays: the canonical tool still emits the documented `artifacts` compatibility map (`command/odf-status.md` requires it), so the helper is live. Its removal belongs to a separate change that drops `phase`/`artifacts` from the canonical output.

### S3 — Documentation and inventory follow the new surface

Acceptance:
- The registered tool count drops from 31 to 30 everywhere it is stated (`README.md`, `AGENTS.md`, `docs/README.md`, `docs/plugin.md`).
- `docs/architecture.md`, `docs/plugin.md`, `AGENTS.md`, and `agent/odoo_orchestrator.md` describe `odf_workflow_status` as the only status surface.
- `odf-plugin/opencode-v2-contract.test.ts` asserts `odf_status` is gone instead of asserting its deprecation text.

### S4 — No behavior change outside the removed surface

Acceptance:
- Local OpenSpec, hybrid, archived-change resolution, receipts, resumability, handoff, and observability outputs are unchanged.
- The removed tool is the only functional deletion; no route, stage, store, or delegation contract changes.
- Verification: focused tests, `npm run test:unit`, `npm test`, `npm run typecheck`, registry validation.

## Tasks

- [x] T1 — S1 — route: inline — added the Engram-only canonical pin tests and recorded RED for the removal assertion. Evidence in L2.
- [x] T2 — S1, S2 — route: inline — migrated the fallback to the merged builder and deleted `odf_status`/`loadEngramStatus`/`buildEngramStatus` in `39de30c`. Evidence in L3.
- [x] T3 — S3 — route: inline — updated docs, tool counts, and contract tests in `9c9da77`. Evidence in L4.
- [x] T4 — S1–S4 — route: inline — full verification. Evidence in L5.
- [ ] D4 — deferred (not authorized) — drop the legacy `phase`/`artifacts`/`applyProgress`/`lastUpdated` fields from the `odf_workflow_status` output; that is what would make `legacyArtifactState` dead and removable. `command/odf-status.md` documents those fields as part of the canonical output, so this is a consumer-visible contract change.

Route evidence: one understood change across plugin, tests, and docs; no parallel units and no writer reason. File count does not fire the writer trigger.

## Log

### L1 — Original request (verbatim)

> sigue con D1

D1 was recorded in `odd/tasks/legacy-route-removal.md:95` as: remove `odf_status`, `loadEngramStatus`, `buildEngramStatus`, `legacyArtifactState` after the `odf_workflow_status` fallback is migrated. This document applies the authorization to that deferred item only.

### L2 — Baseline and RED evidence (2026-10-21)

Baseline inventory before edits:
- `plugins/odf-delegation.ts`: `createODFStatus` (8891), `loadEngramStatus` (8537), `buildEngramStatus` (8480), `legacyArtifactState` (8472), registration (10913), export (11045).
- `odf-plugin/odf-delegation-shared.ts:250` and `odf-plugin/odf-delegation-loopguard.ts:24` list `odf_status`.
- `odf-plugin/odf-delegation.test.ts:3768` groups `loadEngramStatus` and canonical discovery tests under one describe.
- `odf-plugin/opencode-v2-contract.test.ts:169` asserts the deprecation text.
- Docs stating the tool surface: `README.md:87`, `README.md:131`, `AGENTS.md:81`, `docs/README.md:9`, `docs/plugin.md:3` (31 tools); status mentions in `docs/plugin.md:33`, `AGENTS.md:108`, `docs/architecture.md:140`, `agent/odoo_orchestrator.md:257`.

RED evidence:
- The new inventory assertion failed against the unchanged plugin: `expected [ 'odf_delegate', …(30) ] to not include 'odf_status'` (`odf-plugin/opencode-v2-contract.test.ts:169`).
- The Engram-only pin test (`derives an Engram-only change through the canonical builder`) passed before the migration, so it pins the pre-migration output rather than a new behavior: `source.state: "engram"`, `state_kind: "legacy-artifacts"`, `artifacts: { propose: "done", "implement-progress": "in-progress" }`, `applyProgress: 1/2`, and the warning `OpenSpec state was not read; status is derived from Engram artifacts.`

### L3 — Fallback migration and deletion (2026-10-21)

Changed:
- `plugins/odf-delegation.ts`: `buildMergedStatus` takes an explicit `StatusSourceState` channel and skips the `state` artifact in the legacy `artifacts` map and in `lastUpdated`. `buildEngramOnlyStatus` feeds the merged builder the Engram state document, an empty artifact list, and the `engram` source channel; the legacy expectations-only case keeps its `none` source. `buildEngramStatus`, `loadEngramStatus`, and `createODFStatus` are deleted, and the registration, the export list, and the loop-guard read set drop `odf_status`.
- `odf-plugin/odf-delegation-shared.ts`, `odf-plugin/odf-delegation-loopguard.ts`: `odf_status` removed from the registered and read-only tool sets.
- `odf-plugin/odf-delegation.test.ts`: the mixed describe is renamed to `odf_workflow_status discovery and Engram fallback`; the `odf_status`-only tests are removed; the export-path, git-remote, and observability tests now assert through `odf_workflow_status`; a new test pins the Engram-only canonical output.
- `odf-plugin/opencode-v2-contract.test.ts`: the deprecation assertion is replaced by absence assertions.

Discovery (failed first attempt): feeding the merged builder an empty OpenSpec snapshot with `state: null` dropped the Engram `state` document from the artifact list, so `deriveWorkflowStatus` could not detect it. Five discovery tests then reported `canonical_stage: "INIT"` and `resumable: false` instead of `BUILD`/`true`. The fix passes the Engram state document to the merged builder as the state input, which restores `state_kind: "canonical"` without reintroducing a second derivation.

GREEN evidence:
- `npx vitest run odf-plugin/odf-delegation.test.ts odf-plugin/opencode-v2-contract.test.ts` → 2 files, 482/482 pass.

### L4 — Documentation and inventory (2026-10-21)

- `README.md` (two places), `AGENTS.md`, `docs/README.md`, `docs/plugin.md`: the registered tool count goes from 31 to 30 and the `odf_status` inventory rows are removed.
- `docs/architecture.md`, `agent/odoo_orchestrator.md`: `odf_workflow_status` is documented as the only status surface, including changes that exist only as Engram observations.
- `plugins/odf-delegation.ts` (`ODF_SYSTEM_RULES`): the injected guidance names `odf_workflow_status` as the single status tool and drops the deprecation sentence.

### L5 — Verification (2026-10-21)

- `npm run test:unit` → 46 files, 1267/1267 tests pass.
- `npm test` → 331/331 YAML scenarios pass.
- `npm run typecheck` → clean.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` → all registered paths valid.
- `git diff --check` → clean.
- Commits: `39de30c` (code + tests), `9c9da77` (docs). Branch `feature/legacy-odf-status-removal`.

Deferred by this change:
- `legacyArtifactState` survives because the canonical tool still emits the documented `artifacts` compatibility map (`command/odf-status.md` lists `phase`, `artifacts`, `applyProgress`, `lastUpdated` as legacy fields of the canonical output). Removing it belongs to a change that drops those fields from `odf_workflow_status`.
- Runtime effect still requires reinstalling the pack into `~/.config/opencode` and running `/odf-registry-refresh` in an Odoo project.
