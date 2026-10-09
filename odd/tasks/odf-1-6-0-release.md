# ODF 1.6.0 Release Preparation

## Objective

Prepare and publish the 1.6.0 release containing the diagnostics, safe recovery,
conversational workflow, and opt-in feedback work completed for issue #122.

## Decision

Use `1.6.0`, the minor increment after `v1.5.1`, matching the issue's release
target. The user explicitly authorized creating the release related to PR #137.

## Scope

- Synchronize version metadata, installer references, and release fixtures.
- Record merged issue #122 work in `CHANGELOG.md` and refresh test counts.
- Validate the release candidate, merge its metadata PR, and publish `v1.6.0`.

## Constraints

- Preserve the completed implementation PRs #136 and #137.
- Publish only after the release metadata PR passes CI and merges to `main`.
- No npm package publication is included.

## Implementation evidence

- PR #136 and PR #137 are merged to `main`; PR #137 CI passed on Node 22.
- PR #137 completed the final issue #122 checklist item and the issue is closed.
- Local release validation passed: 1,182 Vitest tests, 331 YAML scenarios,
  18 dedicated harness checks, typecheck, registry validation, `bash -n`, and
  `git diff --check`.

## Checklist

- [x] Confirm `1.6.0` version after `v1.5.1` and user publication authorization.
- [x] Synchronize version metadata, release docs, and installer fixtures.
- [x] Add a changelog section linked to implementation PR #137.
- [x] Pass the local release-candidate validation matrix.
- [ ] Pass release metadata PR CI.
- [ ] Merge the release metadata PR.
- [ ] Publish GitHub tag/release `v1.6.0` on the merged `main` commit.

## Validation matrix

- `npm run typecheck`
- `ODF_CONFIG_DIR="$PWD" npm run test:unit -- --pool=threads --maxWorkers=4 --reporter=dot --testTimeout=90000`
- `ODF_CONFIG_DIR="$PWD" npm run test:yaml`
- `npm run test:harness`
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js`
- `bash -n install.sh`
- `git diff --check`

## Publication boundary

The user authorized publication. Create the GitHub release after the release
metadata PR merges; target its merge commit and link PR #137 in the notes. Do not
publish the package to npm.
