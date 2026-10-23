# Workflow status discovery and Engram error fixes

Objective: make `odf_workflow_status` active discovery ignore non-resumable artifact-only changes, let local OpenSpec canonical changes be discovered when Engram is unavailable or malformed, and surface Engram read failures for hybrid and Engram-only named changes instead of silently omitting them or reporting a false "not found".
Branch: `fix/workflow-status-discovery` (work-unit commits). Test runner `npm test` (Vitest + YAML scenarios).

## Specs

### S1 — Active discovery contains only canonical changes

Acceptance:
- `discoverActiveWorkflowCandidates` excludes `state_kind: "none"` and `state_kind: "expectations-only"` from `candidates`.
- A local state file that exists but is unreadable still produces a candidate with `blocker: "workflow-state-unreadable"` so it blocks safely.
- Artifact-only changes are returned separately in `active_change_resolution.artifact_only` (bounded), not counted toward ambiguity.
- A workspace with one canonical change and one artifact-only change is `unambiguous` and selects the canonical change.
- The tool message for `none` distinguishes “no active canonical change” from artifact-only changes when the list is non-empty.

### S2 — Local OpenSpec authority when Engram fails

Acceptance:
- If at least one local canonical OpenSpec change exists, an Engram export failure or malformed observation is a warning (`engram-export-failed`, `engram-export-invalid`, etc.) and discovery proceeds with the local candidates.
- Discovery is `incomplete` only when there is no local canonical candidate and Engram cannot be read, or when local state is unreadable/truncated, or when the active candidate count exceeds the cap.
- A sole local OpenSpec canonical change with a failing Engram is `unambiguous` and the tool returns `status: "found"` with the Engram warning.
- Engram-only changes remain discoverable when the export succeeds; the local authority rule does not hide them.

### S3 — Named Engram and hybrid errors are visible

Acceptance:
- A named `artifact_store: hybrid` change with an unreadable Engram mirror returns `status: "found"` and includes the Engram error as a warning; it does not silently omit the mirror.
- A named Engram-only change with an unreadable Engram export returns `status: "blocked"` with `reason` equal to the Engram error (`engram-export-failed`, `engram-export-invalid`, `engram-export-too-large`, `engram-export-timeout`, or `engram-cli-unavailable`) and a message that names the requested change.
- A named change that is genuinely absent from a readable Engram export still returns `status: "not-found"`.
- The explicit path never claims “No ODF changes found in Engram” when the export itself failed.

### S4 — Tests and no behavior change outside status

Acceptance:
- Tests cover: one canonical + one artifact-only; unreadable local state; local canonical + failing Engram; local canonical + malformed Engram observation; Engram-only discovery still works; hybrid warning; Engram-only blocked; genuine not-found.
- `npm run typecheck`, focused status tests, `npm run test:unit`, `npm run test:yaml`, registry validation, and `git diff --check <base>..HEAD` pass.
- No workflow state, receipt, gate, or delegation behavior changes.

## Tasks

- [x] T1 — S1 — route: inline — filter artifact-only discovery and expose the separate list; tests.
- [x] T2 — S2 — route: inline — local-authority discovery when Engram fails; tests.
- [x] T3 — S3 — route: inline — surface named hybrid/Engram errors; tests.
- [x] T4 — S4 — route: inline — full verification and documentation/description cleanup.

## Log

### L1 — Original request (verbatim)

> revisar el odf_workflow_status

### L2 — Fix scope (verbatim option and description)

> H1 + H2 + H3/H4

> Además de H1/H3/H4, cambio H2 para que un workspace con estados OpenSpec pueda descubrir localmente aunque Engram falle, dejando un warning en vez de bloquear. Es un cambio de contrato más amplio.

### L3 — Evidence (2026-10-23)

- One canonical + one artifact-only change → `ambiguous` / `multiple-active-changes` despite only one resumable change.
- The repo discovery lists 20 candidates: 17 `state_kind: none`, 3 canonical; it is `incomplete` because of `engram-export-invalid`.
- A sole local OpenSpec change with a failing Engram returns `active-change-discovery-incomplete`.
- A named `artifact_store: hybrid` change with a failing Engram returns `found`, `source: openspec`, and no mirror warning.
- A named Engram-only change with a failing Engram returns `not-found` / “No ODF changes found in Engram”.

### L4 — Implementation evidence (2026-10-23)

Implementation:
- `discoverActiveWorkflowCandidates` now separates canonical `candidates` from bounded `artifact_only`; artifact-only changes are not counted toward ambiguity.
- `unreadableLocalStates` remains a blocking active candidate with `blocker: "workflow-state-unreadable"`.
- `incomplete` is driven by local unreadable/truncated discovery, an unreadable Engram export when no local canonical candidate exists, or the active-candidate cap. Engram warnings do not block when a local canonical OpenSpec candidate exists.
- A local state with `artifact_store: engram` is not treated as local authority; if Engram fails, discovery stays fail-closed. `openspec`, `hybrid`, and undeclared stores count as local authority.
- `loadCombinedWorkflowStatus` returns `{status, error}`; named hybrid/Engram states add `engram-export-failed`/`engram-export-invalid` warnings, and a missing Engram-only change returns `blocked` with the Engram error instead of `not-found`.
- Malformed observations are detected for named status too: a readable change is returned with `engram-export-invalid`; a missing change is blocked, never reported as a genuine not-found.
- Tool description no longer advertises removed legacy compatibility fields.

Tests added/updated in `odf-plugin/odf-delegation.test.ts`:
- sole OpenSpec change + failing Engram is unambiguous with `engram-export-failed`;
- one canonical + one artifact-only is unambiguous, artifact-only listed separately;
- artifact-only-only discovery returns `no-active-change` with the separate list and message;
- unreadable local state remains a blocking candidate;
- local canonical + malformed Engram observation proceeds with `engram-export-invalid`;
- named hybrid + failing Engram returns found with the mirror warning;
- named Engram-only + failing Engram returns blocked with the error and change name;
- named Engram-only + malformed export returns blocked with `engram-export-invalid`;
- readable Engram change + malformed unrelated observation returns found with a warning;
- genuine not-found on a readable export remains `not-found`;
- local `artifact_store: engram` + failing Engram stays incomplete.

Verification:
- `npm run typecheck`: clean.
- `npx vitest run odf-plugin/odf-delegation.test.ts`: 487/487 passed.
- `npx vitest run odf-plugin/odf-workflow-status.test.ts odf-plugin/odf-workflow-handoff.test.ts`: 45/45 passed.
- `npm run test:unit`: 48 files, 1321/1321 passed. A prior run of the same suite reported the pre-existing `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error; it is not a failing test.
- `npm run test:yaml`: 331/331 passed.
- `ODF_CONFIG_DIR=<repo> node scripts/odf-registry-validate.js`: all registered paths valid.
- `git diff --check`: clean.
- Repo discovery after the fix: 4 canonical candidates + 17 artifact-only, `ambiguous` with `engram-export-invalid` warning; no longer `incomplete` solely because of Engram.

Scope notes:
- H5 (`resumable` vs `recovery_work_type_required`) and H7 (dead no-name newest branch) were not changed; they are outside the chosen H1/H2/H3/H4 scope.
