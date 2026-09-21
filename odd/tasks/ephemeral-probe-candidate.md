# Ephemeral Probe Candidate Scope

## Objective

Allow ODF to verify explicitly authorized, Gitignored probe sources without
pretending those sources are deliverable Git changes or mixing unrelated dirty
worktree changes into the frozen candidate.

## Problem

`candidate-manifest.ts` derives candidates only from Git porcelain status. The
disposable O19 probe is intentionally Gitignored, so it is absent from the
policy-gate candidate while the gate still freezes unrelated dirty changes.

## Authorized scope

- ODF candidate-manifest and policy-gate plumbing only.
- Per-change, explicit external-validation scope; ordinary worktree behavior
  remains unchanged.
- Relative paths only, bounded to the selected workspace.
- No force-add, `.gitignore` change, source-module change, database reset, or
  remote operation.

## Tasks

- [x] T1 Add a validated per-change external-validation scope to candidate
  manifest construction and policy-gate persistence.
- [x] T2 Keep receipt/digest mismatch checks on the same persisted scope.
- [x] T3 Record and validate an external subject manifest for ignored probe
  files without including those files in the deliverable candidate.
- [x] T4 Add focused tests for default Git behavior, ignored external files,
  path traversal rejection, digest stability, and evidence mismatch.
- [x] T5 Re-run the focused test suite and typecheck.

## Acceptance criteria

- Default candidate behavior is unchanged when no scope is supplied.
- An explicit external-validation scope excludes unrelated dirty paths from
  the frozen candidate and never force-adds ignored files.
- External probe files are hash-bound in validation evidence and changes are
  rejected when the subject mutates after capture.
- Unsafe absolute/traversal paths are rejected.
- Existing ODF unit tests and typecheck pass.

## Current progress

- T1/T2 complete in candidate-manifest, policy-gate, receipt, and delegation
  plumbing.
- T3/T4 complete: subject declarations are bounded, deterministically expanded,
  SHA-256 bound in evidence, and excluded from candidate/risk paths.
- Default Git candidates remain unchanged; explicit scoped candidates reject
  unsafe paths, fail closed on malformed persisted scopes, and count scoped
  untracked lines deterministically.
- Typecheck passes and the focused candidate/delegation/harness suite has 421
  passing tests; the full unit suite has one unrelated pre-existing `resolveAgent`
  failure because the staged `scripts/lib/agent-resolve.js` changes alter ASSESS
  fallback behavior.
- O19 evidence confirms the ignored-probe and polluted-candidate failure mode.

## Next step

Preserve the known baseline resolver failure, keep the ignored probe outside the
candidate, and commit this work unit on the feature branch.
