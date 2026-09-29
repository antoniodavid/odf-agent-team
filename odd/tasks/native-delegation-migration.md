# Native Subagent Delegation Migration

## Objective

Move ODF phase delegation in OpenCode V2 from the plugin's raw session bridge to host-rendered child sessions: the delegated specialist must appear as a native subtask (agent + description, live status, child navigation, background-capable) while every existing ODF gate stays deterministic and plugin-side. Ship the result as a new ODF release.

## Problem

Under OpenCode V2 the plugin delegates through `createV2SessionTaskApi` (`ctx.session.create/prompt/wait/context`). V2 exposes no subagent/task capability to plugins and `session.create` cannot set `parentID` (reproduced on 2.0.18; upstream `anomalyco/opencode#49389`), so:

- the child session is a top-level session with no `parentID` — no subtask row, no child navigation;
- background delegation (`subagent` supports `background: true`) and host-managed lifecycle/permission surfaces are unavailable;
- the plugin keeps a duplicated transport layer (~90 lines plus abort/model/context plumbing) with its own defect history.

V1 rendered delegations as native subtasks (`ODF delegation: <agent>`, `parentID` set by the host), so this is a usability regression for harness users. The immediate mitigations shipped in #54/#56 (descriptive `ODF <phase> → <agent> · <change>` child title, progress emission, `task_session_id` in the envelope) reduce the gap but do not create a subtask.

Tracked as roadmap issue #55. Upstream capability threads: `#49389` (`parentID` forwarding is one call site), `#49801` (task-style rows for child sessions), `#48409` (metadata opt-in for plugin tools).

## Why

Usability is part of harness quality: a delegation the user cannot see is a delegation the user cannot trust. The native path also removes duplicated transport code, gains host lifecycle (abort/archive/depth/per-child cost) and enforces the `subagent` permission surface, which the raw bridge bypasses.

## Scope

- **Phase 1 — Host capability / linked child sessions**: when `parentID` is forwardable (upstream `#49389` or a documented alternative), the V2 bridge creates true child sessions; keep the #56 title/progress; adopt the `#48409` metadata marker (`{subagent: true, sessionId}`) or generic child rendering (`#49801`) when available.
- **Phase 2 — Prepare/seal native delegation (works even without Phase 1)**: split delegation into `odf_delegation_prepare` (resolve agent, skills, profile, policy gate, source-authority contract; return the enriched prompt plus a bounded delegation token) and `odf_delegation_seal` (verify token + child session binding; read the child result by `sessionID`; run source-authority, `design_closed`, artifact-ref and boundary validations; materialize PLAN; commit BUILD/VERIFY; settle attempts; write receipts/metrics; return the standard envelope). The orchestrator calls the native `subagent` tool between the two.
- **Phase 3 — Parallel BUILD (stretch)**: background subagents plus an aggregate seal, preserving `resume_from_join` semantics.
- **Release**: version bump, changelog, tag and GitHub release (see `odd/tasks/odf-1-5-0-release.md`).

## Constraints

- Policy Gate, attempt ledger, validation-evidence seal, receipts, source authority, materialization and metrics stay plugin-side, deterministic and fail-closed.
- One delegation chokepoint: the orchestrator never calls `task()`/`subagent` outside the ODF path; an ODF-agent `subagent` call without a valid token blocks, and an unconsumed token is detected (no orphan silent success).
- No reliance on undocumented host internals without a tracked upstream issue.
- No new dependencies; outer envelope compatibility preserved (`task_session_id` included).
- `odf_delegate` keeps working until the native path proves parity; deprecate only with evidence.
- Strict TDD is not enabled for this repository; use the existing Vitest/YAML/harness checks.

## Authorized scope

- `plugins/odf-delegation.ts`
- `odf-plugin/odf-delegation-health.ts`
- `odf-plugin/opencode-v2-adapter.ts`
- `odf-plugin/odf-delegation.test.ts`
- `odf-plugin/opencode-v2-adapter.test.ts`
- `agent/odoo_orchestrator.md`, `command/odf-*.md`
- `skills/_shared/result-contract.md`, `docs/architecture.md`, `docs/intended-usage.md`
- `odd/tasks/native-delegation-migration.md`, `odd/tasks/odf-1-5-0-release.md`
- Release metadata only in the release task: `VERSION`, `package.json`, `package-lock.json`, `odf-registry.json`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, `install.sh`

## Acceptance criteria

- [ ] In the parent timeline, a phase delegation is a native subtask with agent + description (or a linked child session carrying the #56 title/progress until rendering lands).
- [ ] Gate outputs for identical inputs are equivalent to today's `odf_delegate` envelope: `policy_gate`, `validation`, `receipt`, `workflow_commit`, `workflow_materialization`, `task_session_id`, `result`.
- [ ] The child result is read only from the session bound to the token; token/session mismatch or a missing seal blocks; no silent phase success without a seal.
- [ ] `subagent` is the only native entry point; ODF never calls `task()` directly.
- [ ] Focused + full unit suites, YAML scenarios, registry validation, harness tests, typecheck and diff checks pass.
- [ ] The release is published (see the release task document).

## Milestones

### M0 — Preparation (this document)

- [x] Worktree `native-delegation` on `feat/native-delegation`.
- [x] CodeGraph index and dependencies in the worktree.
- [x] Upstream evidence recorded (#49389 and #49801 comments; parentID ignored on 2.0.18).
- [x] Visibility mitigations shipped (#54/#56).
- [x] Entry point decided (2026-09-28): **Phase 2 (prepare/seal first)**; Phase 1 depends on the host and stays opportunistic.
- [ ] Re-run the `parentID` probe against the latest installed OpenCode release when the service updates.

### M1 — Host capability / linked child sessions

- [ ] If `session.create` forwards `parentID` (or an API exists), set it in the V2 bridge; verify child navigation and the session tree.
- [ ] Adopt the metadata marker (#48409) or generic child rendering (#49801) when available.

### M2 — Prepare/seal design + implementation

- [x] ADR-lite design: `odd/tasks/native-delegation-prepare-seal-design.md` (token shape, binding fields, `.odf/` storage, TTL, supersede/replay behavior).
- [x] Token module: `odf-plugin/odf-delegation-tokens.ts` (mint, atomic write, read, expiry, seal-once, delete; bounded and workspace-contained) with its test file.
- [x] `odf_delegation_prepare`: agent/skills/profile/source-authority prompt plus the policy gate and attempt acquisition for proof-backed phases; bounded token; writes no workflow state.
- [x] `odf_delegation_seal`: token and child-session binding (agent, prompt digest, workspace, `parentID` when present), ODF Result parsing, composite gates and PLAN materialization, and proof-backed replay (proof revalidation, prepared policy gate, validation-evidence seal, workflow commit, attempt settlement, failure receipts); metrics with `task_api_source: "subagent"`.
- [x] Register both tools (map, `ODF_REGISTERED_TOOLS`, V2 adapter tool-list test), extend `task_api_source` with `"subagent"`, and update the operator docs.
- [x] Proof-backed BUILD/VERIFY parity: the attempt is acquired in prepare (liveness tracking off so `settle-attempt` can recover orphans) and settled by the seal; the prepared policy gate is reused (no post-build recompute); validation evidence, workflow commit and failure receipts verified end to end in tests. Fast-lane and parallel BUILD stay excluded with explicit blocks.
- [x] Orchestrator and command instructions: native flow (`prepare → subagent → seal`) documented in `agent/odoo_orchestrator.md` and the phase commands, with recovery reasons; the V2 `execute.before` hook blocks direct `subagent` calls to ODF specialists from the orchestrator without the prepared marker.
- [x] Parity test matrix: delegate vs seal envelopes for DESIGN success, design-not-closed, source-authority-invalid, proof-backed IMPLEMENT success/failure and inner-failed results (full shape parity, with the state file compared for the BUILD commit).
- [ ] Real end-to-end run in an Odoo worktree as release evidence.
- [ ] Parallel BUILD (stretch): background subagents + aggregate seal.

### M3 — Verification

- [ ] Parity matrix: current delegate vs native path for DESIGN/IMPLEMENT/VERIFY envelopes, source authority, BUILD/VERIFY commit, failure receipts.
- [ ] Regression suites + YAML scenarios + registry validation.

### M4 — Release

- [ ] Execute `odd/tasks/odf-1-5-0-release.md`.

## Checks

- `npm run typecheck`
- `npm run test:unit -- --testTimeout=30000`
- `ODF_CONFIG_DIR="$PWD" npm run test:yaml`
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js`
- `npm run test:harness`
- `git diff --check`

## Progress

- Prepared (2026-09-28): worktree, CodeGraph, dependencies, this plan and the release plan; roadmap issue #55 linked to upstream evidence.
- Probe (2026-09-28, OpenCode 2.0.18): `POST /api/session` with `parentID` returns a session without `parentID`; the plugin projection cannot pass it either (`#49389`). The probe session was deleted.

## Next step

Confirm the entry point with the maintainer (Phase 1 host capability first, or Phase 2 prepare/seal immediately) and write the M2 ADR-lite design in this worktree.
