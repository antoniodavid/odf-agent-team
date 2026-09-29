# ODF 1.5.0 Release

## Objective

Publish the native-delegation line as `v1.5.0` with synchronized metadata, an
accurate changelog and a verifiable GitHub release.

## Problem

The migration changes delegation UX and adds four tools, so metadata, docs and
changelog must move together. `v1.4.0` is already published (tag `v1.4.0`), so
this release contains only the changes merged since.

## Decision (R0, resolved)

Release `v1.5.0` from `main` after the native-path end-to-end evidence is
recorded. Tracked in issue #69; the `v1.4.0` line stays immutable.

## Scope

- Synchronize `1.5.0` across release metadata, installer references and docs.
- Write the `1.5.0` changelog section covering the native delegation (single and
  parallel), the chokepoint guard, the heavy-phase audit fix, and every fix
  merged after `v1.4.0`.
- Record the verification evidence, including the real native VERIFY run.
- Create the local release commit and annotated tag, then publish the GitHub
  release after explicit authorization.

## Constraints

- Minimal release diff; do not touch unrelated untracked files.
- Do not publish remotely without explicit authorization naming destination and
  operation.
- Historical tags stay immutable.

## Authorized scope

- `VERSION`, `package.json`, `package-lock.json`, `odf-registry.json`,
  `install.sh`, `README.md`, `AGENTS.md`, `CHANGELOG.md`,
  `scripts/lib/installer.test.ts`
- `odd/tasks/odf-1-5-0-release.md`

## Checklist

- [x] R0 — Version decision resolved: `1.5.0` (after `v1.4.0`).
- [x] R1 — Release metadata synchronized to `1.5.0`: `VERSION`, `package.json`,
  `package-lock.json`, `odf-registry.json`, `install.sh` (VERSION + curl
  example), `README.md` (badge + curl example + test counts), `AGENTS.md`
  (test counts), `scripts/lib/installer.test.ts` (installer lock expectation),
  and `README.md`/`AGENTS.md` counts updated to the current suite.
- [x] R2 — `CHANGELOG.md` `1.5.0` section written (native delegation, guard,
  audit fix, join recovery, funnel breakdown, legacy progress states, test
  stability) with the verification boundary.
- [x] R3 — Documentation: native single/parallel flows in
  `agent/odoo_orchestrator.md`, `docs/plugin.md` and the phase commands; tool
  inventory at 26.
- [x] R4 — Verification evidence: full matrix green (998 unit / 325 YAML / 18
  harness; PR #81 CI passed, and merge commit `1185b69` checks succeeded) plus
  the real native VERIFY run on `barcode-cycle-count-list-ux`: PASS WITH
  WARNINGS, 7/7 expectations; authorized `devel` module suite 39/39 and HOOT
  20/20; final
  seal/evidence/policy/receipt consistent; canonical state ARCHIVED. Candidate
  files remain staged and uncommitted by design; archival did not commit them.
- [x] R5 — Release commit `03130f9` with annotated tag `v1.5.0`.
- [x] R6 — Pushed `v1.5.0`, published the GitHub release from the changelog,
  verified the target/metadata and Latest status, and closed #69.

## Acceptance criteria

- All release metadata resolves to `1.5.0`.
- The changelog describes the actual verified behavior, including the native
  path and the audit fix.
- No unrelated untracked file is deleted or modified.
- Required checks pass and the release commit/tag are reproducible.
- The final report records the authorized remote publication and verifies the
  release target and metadata.

## Checks

- `npm run typecheck`
- `ODF_CONFIG_DIR="$PWD" npm run test:unit -- --testTimeout=30000`
- `ODF_CONFIG_DIR="$PWD" npm run test:yaml`
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js`
- `npm run test:harness`
- `git diff --check`
- `bash -n install.sh`
- Release metadata consistency assertion for `1.5.0`

## Progress

- 2026-09-29: R1–R3 merged via PR #81 (`1185b69`). R4 complete: PR #81/#82 CI
  passed; local matrix is 998 unit / 325 YAML / 18 harness; the native
  `barcode-cycle-count-list-ux` VERIFY closed PASS WITH WARNINGS (7/7), with the
  real module suite 39/39 and HOOT 20/20. Candidate files remain staged and
  uncommitted. The change is archived; nonblocking warnings are documented in
  its archive report. R5/R6 complete: annotated tag `v1.5.0` points to
  `03130f9`; GitHub release is published at
  https://github.com/antoniodavid/odf-agent-team/releases/tag/v1.5.0 and #69 is
  closed.
- Post-archive status-reader caveat: once the OpenSpec folder was moved under
  `archive/`, `odf_workflow_status` fell back to an older Engram record and
  displayed `DECIDE`; the authoritative archived `state.yaml` remains
  `ARCHIVED` with DECIDE/PLAN/BUILD/VERIFY complete. No active attempts, pending
  receipt, or parallel join were present.

## Next step

- No further release action. Keep the barcode candidate staged and uncommitted;
  review its documented nonblocking warnings separately if needed.
