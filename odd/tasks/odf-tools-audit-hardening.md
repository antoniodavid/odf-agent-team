# ODF tool audit hardening (A1-A6)

Objective: close the highest-risk findings from the `odf_*` tool audit: path traversal through raw change names, inconsistent workspace resolution, missing proof admission in native parallel prepare, unvalidated registry shape, non-atomic receipt/policy writes, and plain-text validation failures in delegation tools.

Branch: `fix/odf-delegate-hardening` (second commit; the delegate H1-H6 hardening is the first). Test runner `npm test` (Vitest + YAML scenarios).

## Specs

### S1 — Change names are safe at every write boundary

- Every public tool that interpolates a change name into a filesystem path validates it as a safe change token.
- `odf_receipt` and `odf_policy_gate` block `unsafe-change-name` before reading or writing outside `.odf`.
- `odf_parallel_prepare` validates the shared change before Policy Gate resolution or attempt acquisition.
- Delegation prepare/launch/seal/late-seal/parallel schemas expose the safe change pattern and keep token-bound validation.
- `readReceiptFile`, `saveReceiptJson`, `mergeReceipt`, `savePolicyGateJson`, and persisted policy readers use a safe change path.

### S2 — Workspace resolution is consistent

- A single resolver prefers `workspace_dir`, then the current session directory (`toolCtx.directory`), then the canonical plugin directory, then cwd.
- An explicit `workspace_dir` is strict: an invalid value blocks rather than silently falling back.
- Delegation tools, Policy Gate, Receipt, Governance, Workflow Override, and Skill Resolution use the shared resolver.
- Existing native prepare/seal tests keep their token-bound workspace behavior.

### S3 — Parallel prepare admits the proof before work

- `odf_parallel_prepare` calls `resolveProofBackedAdmission` before Policy Gate resolution, attempt acquisition, or token creation.
- A stale, mismatched, already-committed, or fast-lane proof blocks before any child can be launched.
- The token stores the canonical proof returned by admission.

### S4 — Registry shape fails closed

- `loadRegistry` returns null for a JSON-valid registry whose `skills`/`agents` are not arrays, or whose `profiles`/`community_tools` are present but not arrays.
- `getProfileByPhase` returns null for a malformed profiles shape instead of throwing.
- `matchSkills` tolerates malformed skill entries/triggers/version lists without throwing.
- Tools return a typed registry error/block instead of an unhandled TypeError.

### S5 — Receipt and Policy Gate persistence is atomic and serialized

- `saveReceiptJson` and `savePolicyGateJson` write a temp file and rename it.
- `mergeReceipt` and `computePolicyGate` hold a per-change exclusive lock during read/merge/write.
- Lock files are removed on success and stale locks are reclaimed after a bounded age.
- `.odf` that is not a readable directory still fails with the existing receipt read error.

### S6 — Delegation validation failures are JSON

- `odf_delegation_prepare`, `odf_delegation_seal`, `odf_parallel_prepare`, and `odf_parallel_seal` return a JSON blocked envelope for missing session/registry/context failures.
- `odf_receipt` catches persistence errors and returns a JSON error.
- `computePolicyGate` returns a blocked decision for lock/persistence/unsafe-change failures.
- Existing human preview tools keep their Markdown/text output by design.

### S7 — Verification and scope

- Tests cover unsafe receipt/policy/parallel changes, the shared workspace selection, stale parallel proof admission, malformed registry shapes, profile defensive reads, JSON native-session envelopes, and lock cleanup.
- `npm run typecheck`, focused tests, `npm run test:unit`, `npm run test:yaml`, registry validation, and `git diff --check` pass.
- No policy, validation, workflow, receipt, OCA, fast-lane, or attempt semantics change outside these boundaries.

## Tasks

- [x] T1 — S1 — route: inline — safe change names and path enforcement; tests.
- [x] T2 — S2 — route: inline — shared workspace resolver and call-site migration; tests.
- [x] T3 — S3 — route: inline — parallel proof admission before preparation; test.
- [x] T4 — S4 — route: inline — registry shape validation and defensive profile/skill reads; tests.
- [x] T5 — S5 — route: inline — atomic receipt/policy writes and per-change locks; tests.
- [x] T6 — S6 — route: inline — JSON validation envelopes for delegation/receipt/policy; tests.
- [x] T7 — S7 — route: inline — full verification and feature record.

## Log

### L1 — Original request (verbatim)

> haz una revision de los metodos odf_, primero los listas y auditalos buscando en ellos puntos flojos y mejorables.

### L2 — Fix scope (verbatim option and description)

> A1-A6

> Añado a A1-A3 la validación del registry, el contrato JSON de los tools de workflow y locks/atomicidad para receipt/policy gate.

### L3 — Audit evidence (2026-10-23)

- `odf_receipt` wrote outside `.odf` for a `change` containing `x/../../../../tmp/...`; reproduced with a temp test outside the repo.
- `odf_policy_gate` used the same raw `change` path pattern.
- `odf_parallel_prepare` resolved Policy Gate and acquired attempts before any proof admission or safe change validation.
- Native delegation tools used `canonicalDirectory` while Policy Gate/Receipt/Governance/Override/Skill Resolve used `process.cwd()`.
- A JSON-valid registry with `profiles: {}` threw `TypeError: profiles.find is not a function`.
- Receipt merge was a lockless read/merge/write; Policy Gate wrote directly to the final path.
- Delegation session/registry/context failures returned plain text while other failures returned JSON.

### L4 — Implementation evidence

- Added `resolveToolWorkspaceRoot` and `withExclusiveFileLock` to the shared delegation module.
- Migrated delegation, Policy Gate, Receipt, Governance, Override, and Skill Resolve to the shared workspace resolver; explicit workspace paths remain strict.
- Added safe change schemas and handler checks; `saveReceiptJson`/`mergeReceipt`/`savePolicyGateJson`/persisted policy readers use safe change paths.
- `odf_parallel_prepare` now calls `resolveProofBackedAdmission` before Policy Gate/attempts/token and stores the canonical proof.
- `loadRegistry` validates array/object shapes; `getProfileByPhase` and `matchSkills` are defensive.
- Receipt and Policy Gate writes are atomic; reads/merges are serialized per change; locks are removed.
- Native prepare/seal/parallel validation failures now return JSON blocked envelopes; receipt persistence failures return JSON errors.
- Added regression tests in `odf-delegation.test.ts`, `odf-delegation-prepare-seal.test.ts`, and `odf-registry-shape.test.ts`.

### L5 — Verification

- `npm run typecheck`: clean.
- `npm run test:unit`: 1342/1342 passed; the pre-existing intermittent `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error was reported, not a failing test.
- `npm run test:yaml`: 331/331 passed.
- `ODF_CONFIG_DIR=<repo> node scripts/odf-registry-validate.js`: all registered paths valid.
- `git diff --check`: clean.
- Focused: `odf-delegation.test.ts` 502/502, `odf-delegation-prepare-seal.test.ts` 45/45, `odf-registry-shape.test.ts` 4/4.

### Risk

Risk: item 3 — requested changes to public tool contracts, filesystem path boundaries, and concurrency behavior. The local suite is green; an independent verifier is unavailable in this runtime, so this is not a native PASS claim.

### L6 — Follow-ups not in this scope

- A7 input bounds: context_files/branches/refs/files/prompts/timeouts.
- A8 profile model application or explicit advisory labeling.
- A9 community tool guidance/persistence/timeout/scope.
- A10 notebook lookup: removed in `odd/tasks/notebooklm-lookup-removal.md`; community tools remain.
- A11 minor skill/registry/receipt/status follow-ups.
