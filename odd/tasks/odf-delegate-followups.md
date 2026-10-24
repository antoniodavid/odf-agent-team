# Delegate follow-ups and community rollback

Objective: finish the remaining high-value follow-ups from the ODF audit: preserve resolved context in `odf_delegate` blocked envelopes, make the policy-gate reason stable, surface the missing-change materialization warning, correct the cancellation contract text, add community package uninstall, and bound the nested Expectations schema.

Branch: `fix/odf-delegate-followups` (on top of `main`). Test runner `npm test`.

## Specs

### S1 — Blocked envelopes preserve resolved context

- After agent/skill/profile resolution, `odf_delegate` blocked envelopes report the resolved agent, skills, profile and Policy Gate instead of `null`/empty values.
- Early blocks before resolution keep null/empty fields.
- The block metric uses the resolved agent, skills and skill-resolution state.
- A Policy Gate block uses the stable `policy-gate-blocked` reason; the decision stays in `policy_gate` and the human detail in `message`.

### S2 — Terminal role without a change warns

- A successful terminal DECIDE/PLAN role without a change name still returns `delegated` for compatibility, but the warnings include `stage-not-materialized`.
- The canonical stage is not silently assumed to be committed.

### S3 — Cancellation contract is truthful

- The `odf_delegate` description no longer promises a child session ID when the transport cannot expose one.
- It reports the ID when available and explicitly allows an unknown ID on a failed/interrupted transport.
- The existing interrupt/wait confirmation and SIGKILL/no-op limits remain.

### S4 — Community package rollback

- `odf_community_tool_install` accepts `action: "uninstall"` and runs `npm uninstall` for the scoped package name.
- Uninstall does not delete project indexes or modify agent instructions.
- The default action remains install; install behavior is unchanged.

### S5 — Nested Expectations bounds

- Expectation IDs and statements are bounded; constraints, success/failure scenarios and connections have explicit array/item bounds.
- Existing Expectations validation and revisions remain authoritative.

### S6 — Verification

- Tests cover resolved block context, the Policy Gate stable reason, the terminal-role warning, and the truthful cancellation description.
- `npm run typecheck`, `npm run test:unit`, `npm run test:yaml`, registry validation, and `git diff --check` pass.
- No delegation, workflow, policy, receipt, OCA, or delivery behavior changes outside these boundaries.

## Tasks

- [x] T1 — S1 — preserve resolved context and stable Policy Gate reason; tests.
- [x] T2 — S2 — warn when a terminal role has no change; test.
- [x] T3 — S3 — correct the cancellation contract description; test.
- [x] T4 — S4 — add community package uninstall.
- [x] T5 — S5 — bound nested Expectations fields.
- [x] T6 — S6 — full verification.

## Log

### L1 — Original request (verbatim)

> continue

### L2 — Implementation

- Added a resolved-context holder to `odf_delegate` and used it in blocked metrics/envelopes; the Policy Gate block now uses `policy-gate-blocked` while retaining the decision and message.
- Added the `stage-not-materialized` warning for terminal roles without a change.
- Rewrote the cancellation paragraph to match the transport-dependent child-ID behavior.
- Added `action: "uninstall"` to community tools and bounded nested Expectations fields.

### L3 — Verification

- `npm run typecheck`: clean.
- `npm run test:unit`: 1346/1346.
- `npm run test:yaml`: 331/331.
- Registry validation: all registered paths valid.
- `git diff --check`: clean.
- Vitest reports the pre-existing intermittent `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error; it is not a failing test.

### Risk

Risk: item 3 — requested changes to blocked-envelope contracts, a Policy Gate reason code, community tool actions, and nested input bounds. The local suite is green; an independent verifier is unavailable in this runtime, so this is not a native PASS claim.

### Remaining follow-ups

- Timeout/cancel envelopes still cannot expose a child session ID when the transport does not provide one; the description now states this explicitly.
- Community tools still have no project-index rollback; uninstall removes the package only.
