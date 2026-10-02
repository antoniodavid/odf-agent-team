# ODF 1.5.1 Release Preparation

## Objective

Prepare a patch release for the merged reliability and validation fixes tracked
by issue #103, with synchronized metadata, an accurate changelog, and evidence
for a later publication decision.

## Decision

Use `1.5.1`, the patch increment after `v1.5.0`. Prepare the release PR only;
do not create or push a tag or GitHub release without explicit authorization.

## Scope

- Synchronize `1.5.1` across package, registry, installer, README, and test
  fixtures.
- Update the README and contributor guide to the CI-verified suite counts.
- Summarize the changes merged since `v1.5.0` in `CHANGELOG.md`.
- Preserve CI run evidence and prepare a draft release PR.

## Constraints

- Keep the release diff limited to release metadata, changelog, fixtures, and
  this preparation record.
- Do not edit or remove unrelated untracked files in `docs/` or `odd/tasks/`.
- Do not create, push, or publish `v1.5.1` without explicit authorization.

## Implementation evidence

The issue #103 implementation PRs #104 and #106–#112 were merged in sequence;
each PR's CI test job and test-gated auto-merge job passed. The final merged
tree contains 1,050 unit tests, 330 YAML scenarios, and 18 harness checks. PR
and CI run records are the primary publication evidence; rerun the complete
matrix for this release candidate before promoting the release PR.

## Checklist

- [x] Version decision: `1.5.1` after `v1.5.0`.
- [x] Synchronize version metadata, install references, and test fixtures.
- [x] Update documented test counts to the CI-verified baseline.
- [x] Add a `1.5.1` changelog section covering merged changes since `v1.5.0`.
- [x] Run the release-preparation validation matrix on this branch.
- [ ] Open a draft release PR with non-closing `Refs #103` and `type:chore`.
- [ ] Publish tag/release only after explicit authorization.

## Validation matrix

- `npm run typecheck`
- `ODF_CONFIG_DIR="$PWD" npm run test:unit -- --pool=threads --maxWorkers=4 --reporter=dot --testTimeout=90000`
- `ODF_CONFIG_DIR="$PWD" npm run test:yaml`
- `npm run test:harness`
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js`
- `shellcheck install.sh` (attempted; blocked because mise has no shellcheck version configured)
- `bash -n install.sh`
- Release metadata consistency assertion for `1.5.1`
- `git diff --check`

## Publication boundary

No tag or GitHub release has been created. Publication remains pending explicit
authorization for the destination and operation.

## Progress

- 2026-10-01: Metadata consistency, typecheck, 1,050 unit tests, 330 YAML
  scenarios, 18 harness tests, registry validation, `bash -n install.sh`, and
  `git diff --check` passed. The unit run used four Vitest workers with a 90s
  per-test timeout to avoid a transient installer-test timeout under serial
  load. ShellCheck could not run because no mise version is configured. No tag
  or release was created.
