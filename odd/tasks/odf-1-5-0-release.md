# ODF 1.5.0 Release

## Objective

Publish the native-delegation line as a new ODF version with synchronized metadata, a changelog that describes the real behavior, and a verifiable GitHub release.

## Problem

The migration changes delegation UX and adds the prepare/seal surface, so `VERSION`, `package.json`, `package-lock.json`, `odf-registry.json`, `install.sh`, `README.md`, `AGENTS.md` and `CHANGELOG.md` must move together. Two open facts:

- `v1.4.0` is currently **unreleased**: `main` says 1.4.0 but the latest tag/GitHub release is `v1.3.1` (see `odd/tasks/odf-1-3-0-release.md` for the previous release trail).
- The migration's target version must be decided once the work lands.

## Why

Ship one coherent, reproducible release after the migration and keep the release trail auditable (annotated tag + GitHub release pointing at the release commit).

## Scope

- Decide and synchronize the release version across the metadata files and installer references.
- Write the changelog covering: the source-authority `not_applicable` fix (#50/#52), the ODF Result parser/serialization fix (#50/#53), V2 delegation visibility (#54/#56), the migration itself, and any fixes merged since #56.
- Update `README.md`/`AGENTS.md`/`docs/` claims that the migration changes (delegation behavior, tool surface, verification counts).
- Run the full verification matrix; create the local release commit and annotated tag; publish the GitHub release only after explicit authorization.

## Constraints

- Minimal release diff; do not touch unrelated untracked files.
- Do not publish remotely without explicit authorization naming destination and operation.
- Historical tags (`v1.3.x`, existing `v1.4.0` decision) stay immutable.

## Authorized scope

- `VERSION`, `package.json`, `package-lock.json`, `odf-registry.json`, `install.sh`, `README.md`, `AGENTS.md`, `CHANGELOG.md`
- `odd/tasks/odf-1-5-0-release.md`

## Decision pending

- **Release `v1.4.0` first** (recommended): tag the current `main` as 1.4.0 so the hotfix line since `v1.3.1` is published, and let the migration ship as `v1.5.0`.
- **Single release**: fold everything since `v1.3.1` into `v1.5.0` and skip a 1.4.0 tag.

## Checklist

- [ ] R0 — Confirm the version decision with the maintainer (1.4.0-then-1.5.0 vs single 1.5.0).
- [ ] R1 — Synchronize release metadata and installer references to the decided version.
- [ ] R2 — Write the changelog entry covering the migration and the fixes since the previous release.
- [ ] R3 — Update README/AGENTS/architecture documentation for the native delegation path.
- [ ] R4 — Run the verification matrix and record evidence.
- [ ] R5 — Review the final diff, create the local release commit, and tag the version (annotated).
- [ ] R6 — Push the tag, publish the GitHub release, and verify its target and metadata.

## Acceptance criteria

- All release metadata resolves to the decided version.
- README/changelog describe the actual verified behavior without claiming more than the evidence supports.
- No unrelated untracked file is deleted or modified.
- Required checks pass and the release commit/tag are reproducible.
- The final report records the authorized remote publication and verifies the release target and metadata.

## Checks

- `npm run typecheck`
- `npm run test:unit -- --testTimeout=30000`
- `ODF_CONFIG_DIR="$PWD" npm run test:yaml`
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js`
- `npm run test:harness`
- `git diff --check`
- `bash -n install.sh`
- Release metadata consistency assertion for the decided version

## Progress

- Prepared (2026-09-28): scope, checklist and the version decision pending; blocked on the migration (M2/M3) and on R0.

## Next step

Resolve R0, then execute R1–R6 after the migration verification completes.
