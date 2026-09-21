# ODF 1.3.0 Release

## Objective

Prepare the current ODF 1.x line as `v1.3.0`, freeze it as the final 1.x release candidate, and document why ODF 2.0 rollout remains gated on real-Odoo evidence.

## Problem

`v1.2.1` predates 38 commits of feature, contract, installer, governance, observability, and documentation changes. The repository is green locally, but release metadata is stale and ODF 2.0 lacks representative deployment evidence.

## Why

Ship one coherent, reproducible ODF 1.x release before moving the product line to ODF 2.0 readiness work.

## Scope

- Synchronize `v1.3.0` across release metadata and installer references.
- Add a concise changelog entry covering the post-`v1.2.1` changes and readiness boundary.
- Correct stale README verification counts and the one regional Spanish artifact string.
- Run release verification without modifying unrelated untracked diagrams or task files.
- Create a reproducible release commit and tag, then publish the GitHub release only after explicit authorization.

## Constraints

- Do not delete or rewrite unrelated untracked files.
- Do not claim ODF 2.0 rollout readiness without representative Odoo, canary, cohort, and end-to-end evidence.
- Do not publish remotely without explicit authorization for destination, operation, and credential/session.
- Keep the release diff minimal; no new dependencies or abstractions.

## Authorized scope and route

- Authorized files: `VERSION`, `package.json`, `package-lock.json`, `odf-registry.json`, `install.sh`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, `odf-plugin/entry-triage.ts`, `odf-plugin/entry-triage.test.ts`, `scripts/lib/installer.test.ts`, `scripts/odf-agent-tests/odf-installer.yaml`, `scripts/odf-agent-tests/registry.yaml`, and this task document.
- Route: delegated direct writer for the multi-file metadata/documentation change; parent runs verification and local release commit/tag.
- TDD mode: standard functional checks; no strict-TDD setting was established for this repository.

## Checklist

- [x] R1 — Synchronize release metadata and installer references to `1.3.0`.
- [x] R2 — Write changelog and correct README release/test-count documentation.
- [x] R3 — Normalize the regional Spanish artifact string to the repository language convention.
- [x] R4 — Update stale release assertions and stale repository test-count documentation discovered by verification.
- [x] R5 — Run typecheck, unit/YAML/harness tests, registry validation, whitespace checks, shell syntax, and metadata consistency checks.
- [x] R6 — Review the final diff, create the local release commit, and tag `v1.3.0`.
- [x] R7 — Push `v1.3.0`, create the GitHub release, and verify its target and published metadata.

## Acceptance criteria

- All release metadata resolves to `1.3.0`.
- README and changelog describe the actual verified checks without claiming ODF 2.0 rollout readiness.
- No unrelated untracked file is deleted or modified.
- Required release checks pass and the local commit/tag are reproducible.
- The final report records the authorized remote publication and verifies the release target and metadata.

## Verification

- `npm run typecheck`
- `npm run test:unit`
- `ODF_CONFIG_DIR="$PWD" npm run test:yaml`
- `npm run test:harness`
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js`
- `git diff --check`
- `bash -n install.sh`
- release metadata consistency assertion for `1.3.0`

## Progress

- Route selected: delegated direct writer for R1–R3; parent applied mechanical release assertion corrections.
- Release decision: user selected `v1.3.0`.
- Completed: applied release metadata, documentation, prompt-language, and stale test expectation edits.
- Verification note: the first full run found 2 stale unit assertions and 3 stale YAML assertions; all five are now corrected. A repository instruction file also contained stale test counts and was corrected.
- Final checks: typecheck passed; unit 844/844 passed with a 30-second per-test timeout; YAML 154/154 passed against the repository registry; harness 17/17 passed; registry validation, shell syntax, metadata consistency, and whitespace checks passed.
- Release evidence: annotated tag `v1.3.0` and the GitHub release point at commit `69871db` (`refactor(odf): clarify design prompt contract`). The release commit intentionally excludes unrelated tracked changes and untracked diagrams/task files.
- Remote evidence: GitHub release `https://github.com/antoniodavid/odf-agent-team/releases/tag/v1.3.0` is published, non-draft, non-prerelease, and its tag dereferences to `69871db`; remote `VERSION`, `package.json`, `package-lock.json`, `odf-registry.json`, and `install.sh` all report `1.3.0`.
- Next step: leave historical `v1.2.1` immutable unless separately authorized; ODF 2.0 work continues only after representative Odoo/canary/cohort evidence is available.
