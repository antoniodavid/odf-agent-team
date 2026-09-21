# OCA Governance Publication Gate

## Objective

Ensure every OCA-targeted delivery boundary requires a successful governance
check and explicit human acknowledgment, without adding an ODF phase, agent, or
parallel governance workflow.

## Problem

`odf_governance_check` exists and the OCA skill requires it, but `target=oca`
is currently used for skill selection rather than persisted in workflow proofs.
Common workflow transitions, fast-lane transitions, parallel aggregation, and
ARCHIVE therefore have no code-level invariant connecting OCA delivery to
governance evidence.

## Scope

- Make the existing common transition boundary fail closed for OCA governance.
- Reuse the existing governance check semantics and human acknowledgment state.
- Make ARCHIVE honor the existing VERIFY artifact and validation evidence gates.
- Convert `policies/oca/rules.yaml` into an explicit requirement-to-enforcement
  traceability profile without duplicating workflow state.
- Add focused invariant tests for sequential, fast-lane, parallel, archive, and
  non-OCA behavior.

## Constraints

- Preserve the existing 11-agent model and canonical workflow phases.
- Do not introduce an `ExecutionPlan` abstraction or a governance agent.
- Put enforcement at the common transition boundary, not in individual callers.
- Missing governance evidence and missing acknowledgment must fail closed.
- Preserve unrelated working-tree changes.
- Effective strict TDD is disabled; use focused tests and repository validation.

## Authorized scope and route

- Authorized source scope: `plugins/odf-delegation.ts`,
  `odf-plugin/odf-workflow.ts`, `odf-plugin/odf-governance.ts`,
  `odf-plugin/odf-delegation-policy.ts`, `policies/oca/rules.yaml`, and focused
  tests under `odf-plugin/`.
- Route: delegated direct writer, because the common transition contract and
  its tests span multiple non-trivial files.
- Trigger evidence: the read-only path audit confirmed OCA bypasses in normal,
  fast-lane, parallel, and ARCHIVE transitions; ARCHIVE also precedes the
  existing VERIFY artifact/evidence gates.

## Tasks

- [x] T1 Define the minimal persisted OCA governance proof/acknowledgment input
  for the common transition boundary.
- [x] T2 Enforce the OCA governance invariant and correct ARCHIVE gate ordering.
- [x] T3 Make `policies/oca/rules.yaml` declarative and traceable to canonical
  OCA requirements.
- [x] T4 Add focused regression tests and run validation.

## Acceptance criteria

- OCA transition with governance PASS and human acknowledgment succeeds.
- OCA transition with governance FAIL or missing governance blocks and leaves
  workflow state unchanged.
- OCA transition with missing human acknowledgment blocks.
- Fast-lane and parallel aggregate transitions cannot bypass the same gate.
- ARCHIVE cannot bypass VERIFY artifact or validation evidence requirements.
- Non-OCA behavior remains unchanged.
- Policy rules identify requirement, enforcement, evidence, control owner, and
  blocking behavior.

## Checks

- Focused governance and delegation tests.
- `npm test -- --runInBand` or the repository's supported targeted equivalent.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js`
- `git diff --check`

## Progress

- T1: complete — `target: oca` is persisted by workflow binding/proofs and the
  common transition boundary requires a separate typed final acknowledgment
  bound to the current candidate digest.
- T2: complete — `commitWorkflowTransition` gates OCA BUILD, VERIFY, and
  ARCHIVE, preserves the public unresolved-human status, keeps machine
  failures separate from non-blocking governance warnings, and only inspects
  optional fast-lane policy during OCA ARCHIVE.
- T3: complete — every OCA rule declares requirement, enforcement, evidence,
  control owner, and blocking behavior; human review, rate, and quality actions
  remain explicitly non-blocking.
- T4: complete — focused coverage includes bind-time target persistence and
  conflict rejection, sequential, fast-lane, parallel, stale acknowledgment,
  OCA ARCHIVE report/evidence failures, AI Co-authored-by failure, and malformed
  non-OCA ARCHIVE fast-lane compatibility.

## Evidence

- `npm test -- --run odf-plugin/odf-delegation.test.ts` — 858 unit tests and
  154 YAML scenarios passed (the repository runner executes its full unit
  suite when plugin tests are enabled).
- `npm exec -- vitest run odf-plugin/odf-delegation.test.ts` — 386 focused
  delegation tests passed.
- `npm run typecheck` — passed.
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` — passed.
- `git diff --check` — passed.
- Focused OCA delegation cases — pass, including all five added direct
  regressions.
- Independent verification — resolved: malformed optional fast-lane policy no
  longer changes non-OCA ARCHIVE behavior; required direct invariant tests now
  pass.
- Native RDD assessment — high; candidate-scoped review was explicitly declined,
  so no review receipt or approval exists and delivery remains ordinary-policy
  managed.

## Next step

Bounded correction complete; remaining risk is limited to the repository's
existing absence of a `.pre-commit-config.yaml` for a pre-commit run. Preserve
unrelated working-tree changes; no commit, push, or PR was created.
