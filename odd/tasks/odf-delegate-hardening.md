# odf_delegate boundary and error hardening

Objective: close the six highest-impact `odf_delegate` findings from the review: current-session workspace selection, artifact-ref containment, typed timeout/cancel classification, JSON validation envelopes, safe change names, and persisted artifact-store agreement.

Branch: `fix/odf-delegate-hardening` (work-unit commit). Test runner `npm test` (Vitest + YAML scenarios).

## Specs

### S1 — Current-session workspace selection

- `odf_delegate` resolves the workspace from `workspace_dir`, then `toolCtx.directory`, then the canonical plugin directory.
- Omitting `workspace_dir` in a moved session must delegate in the current session directory, not the plugin's original directory.
- Native prepare/seal tools keep their token-bound workspace resolution; this spec covers the direct delegate call.

### S2 — Artifact refs are bounded and store-consistent

- `artifacts_saved` refs are accepted only when the normalized path is relative and contains no `..`, NUL, or absolute prefix.
- An `openspec` ref must resolve through realpath inside the workspace `openspec` directory and be a file.
- An `engram` ref must match `odf/<change>/<artifact>`, belong to the delegated change when a change is named, and exist in the readable Engram export.
- A declared ref store must agree with the ref prefix and with the selected `artifact_store`; `hybrid` may use either canonical ref.
- Malformed ref entries, unsafe paths, store mismatches, and unverifiable Engram refs block with `artifact-ref-invalid`; missing files/topics block with `artifact-ref-missing`.

### S3 — Typed timeout and cancellation

- `invokeTask` raises typed timeout/cancel errors.
- A child error whose message merely contains `timed out` or `aborted` remains a `task-error`, not a parent timeout or cancellation.
- The existing real timeout and parent-abort paths keep their `timeout`/`blocked` status and ledger settlement.
- The parallel branch catch uses the same typed/exact-prefix classification.

### S4 — JSON validation envelopes

- Missing `sessionID`, invalid stage/role, missing registry, and invalid `context_files` return a JSON `blocked` envelope with a stable reason.
- No validation path returns the legacy `❌ ...` plain string from `odf_delegate`.
- Existing context-file tests continue to find the actionable message.

### S5 — Safe change names and lock containment

- Any explicit `change` must be a safe token of 1-64 letters, numbers, hyphens, or underscores, for every stage, before state or attempt work.
- The workflow lock path must resolve inside the workspace `.odf` directory; otherwise the lock acquisition blocks with `workflow-lock-unsafe-path`.
- Prompt-extracted change names keep their existing safe pattern.

### S6 — Persisted artifact-store agreement

- Proof-backed admission reads the OpenSpec state's declared `artifact_store` and blocks `artifact-store-mismatch` when it disagrees with the requested store.
- `commitWorkflowTransition` rechecks the same agreement under the workflow lock.
- Legacy states without a declared store remain allowed.

### S7 — Verification and scope

- Tests cover the current-session workspace, escaping/symlinked/store-mismatched/valid artifact refs, child timeout/cancel text, JSON session/registry/stage errors, non-gated unsafe changes, and artifact-store mismatch.
- `npm run typecheck`, the focused delegation tests, `npm run test:unit`, `npm run test:yaml`, registry validation, and `git diff --check` pass.
- No policy gate, validation evidence, workflow transition, receipt, OCA, fast-lane, or attempt-ledger semantics change outside the six boundaries.

## Tasks

- [x] T1 — S1 — route: inline — prefer the current tool session directory; regression test.
- [x] T2 — S2 — route: inline — artifact-ref normalization, realpath containment, store/ref checks, Engram existence; tests.
- [x] T3 — S3 — route: inline — typed task timeout/cancel; preserve child errors; tests.
- [x] T4 — S4 — route: inline — JSON validation envelopes; tests.
- [x] T5 — S5 — route: inline — safe change names and lock containment; tests.
- [x] T6 — S6 — route: inline — persisted artifact-store agreement in admission and commit; test.
- [x] T7 — S7 — route: inline — full verification and feature record.

## Log

### L1 — Original request (verbatim)

> revisar el odf_delegate

### L2 — Fix scope (verbatim option and description)

> H1-H6 (Recomendado)

> Corrijo workspace, artifact refs, timeout/cancel, contrato JSON, change seguro y mismatch de artifact_store, con tests. Es el bloque de robustez recomendado.

### L3 — Review evidence (2026-10-23)

- `odf_delegate` called the task in the canonical directory when `toolCtx.directory` pointed at the current session directory.
- A child error `"database connection timed out"` was reported as `timeout`; `"operation aborted by the database"` was reported as `task-cancelled`/blocked.
- An artifact ref `openspec/../../<marker outside the workspace>` was accepted with `status: "delegated"`; the claimed ref remained in `result`.
- Invalid stage returned a plain `❌` string while other failures returned JSON.
- A non-gated explicit change could carry `/` or `..` into stage materialization; `workflowLockPath` could resolve outside `.odf`.
- A JSON-valid registry with `profiles: {}` threw `TypeError: profiles.find is not a function` (outside the chosen H1-H6 scope; remains a follow-up).
- The pre-fix suite was 1321 unit / 331 YAML / 487 delegation tests.

### L4 — Implementation evidence (2026-10-23)

- Workspace selection now uses `toolCtx?.directory || canonicalDirectory` in `odf_delegate`; a regression test uses distinct canonical/current directories.
- Artifact refs now parse store/ref pairs, normalize paths, reject `..`/NUL/absolute paths, realpath-check OpenSpec files inside `openspec`, verify Engram topics, and compare the declared and selected stores. Tests cover traversal, symlink escape, store mismatch, and a valid OpenSpec ref.
- `invokeTask` throws `TaskTimeoutError`/`TaskCancelledError`; the delegate and parallel catches use error codes or exact prefixes. Tests cover child messages containing `timed out` and `aborted`, while the real timeout/cancel suite stays green.
- Session, target, registry, and context-file validation now return JSON blocked envelopes; the invalid-stage test asserts the typed envelope.
- Explicit change names are validated for all stages; the workflow lock path is checked against `.odf`. A non-gated unsafe-change test runs before task execution.
- Proof-backed admission and `commitWorkflowTransition` block when the persisted `artifact_store` differs from the requested store; a delegate regression test covers it.

### L5 — Verification

- `npm run typecheck`: clean.
- `npx vitest run odf-plugin/odf-delegation.test.ts`: 498/498 passed.
- `npm run test:unit`: 1332/1332 passed; one pre-existing intermittent `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error was reported by Vitest, not a failing test.
- `npm run test:yaml`: 331/331 passed.
- `ODF_CONFIG_DIR=<repo> node scripts/odf-registry-validate.js`: all registered paths valid.
- `git diff --check`: clean.

### Risk

Risk: item 3 — requested change to the `odf_delegate` output/validation contract and path boundaries. The full local suite is green; an independent verifier is unavailable in this runtime, so this is not a native PASS claim.

### L6 — Follow-ups not in this scope

- Timeout/cancel envelopes still do not expose the child session ID; the SDK fallback does not wait for terminal idle.
- Profiles remain advisory prompt metadata; model/temperature/reasoning are not applied to the task API.
- A malformed registry `profiles` shape still throws instead of returning a block.
- A terminal DECIDE/PLAN role without a change name still skips stage materialization.
- Policy-gate blocks still use the gate's human reason as the envelope reason.
