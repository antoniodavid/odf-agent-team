# ODF follow-ups A7-A9 and A11

Objective: finish the non-breaking follow-ups from the ODF tool audit: bounded inputs, profile validation and advisory labeling, community tool detection/install corrections, and the minor skill/registry/receipt/status refinements.

Branch: `fix/odf-followups` (on top of `main`). Test runner `npm test`.

## Specs

### A7 — Bounded tool inputs

- Delegation, parallel delegation, context manifest, entry triage, Policy Gate, Receipt, Governance, skill preview, registry query, workflow status/archive/bind/override, and community tool schemas bound arrays, strings, identifiers, versions, and timeouts.
- `context_files` is capped at 64 entries of 512 characters; branch arrays remain 2-3; `prompt` is capped at 200,000 characters; timeouts are 1 ms-1 hour; `max_skills` is 1-5.
- Change names use the safe token pattern; workspace/source roots are capped at 4096 characters; Odoo versions are 16-19.
- Bounds are schema contracts; existing direct unit tests are unchanged.

### A8 — Profiles are validated and explicit

- `odf_delegate` and `odf_delegation_prepare` block an unknown explicit profile with `profile-not-found` before delegation.
- `odf_profile_select` and `odf_skill_resolve` accept an optional `profile` and validate it.
- The profile block and preview state that the host inherits its model/runtime settings; the profile is prompt guidance unless the host applies it.
- The active/default fallback remains for omitted profiles.

### A9 — Community tools are truthful

- `odf_community_tool_detect` no longer claims to check agent guidance; it reports CLI and local package status only.
- `odf_community_tool_install` no longer claims to write agent instructions; it installs the package and optionally runs a resolved `codegraph init`.
- Scoped npm packages resolve to the correct `node_modules/@scope/package` path; CLI detection and version probes have bounded timeouts.
- The unused in-memory `installed` mutation and `installed` registry field are removed.

### A11 — Minor tool/status refinements

- `odf_skill_inject` bounds `max_skills` to 1-5 and bounds context/task input.
- `odf_registry_read` can list profiles, uses case-insensitive matching, and no longer claims to return the full registry.
- `odf_receipt` treats `action: "none"` as no committed action instead of a terminal action.
- `odf_workflow_status` warns when a canonical state has no valid `work_type`; the existing `resumable` compatibility is preserved.
- `findLocalWorkflowChange` no longer contains the dead no-name/newest branch.

### A12 — Verification

- `npm run typecheck`, `npm run test:unit`, `npm run test:yaml`, registry validation, and `git diff --check` pass.
- Tests cover unknown profile blocking, `action: "none"`, the no-work-type warning, and the longer native-session test timeout.
- No workflow, policy, receipt, delegation, OCA, fast-lane, or delivery semantics change outside these inputs and labels.

## Tasks

- [x] T1 — A7 — add schema bounds across the audited tools.
- [x] T2 — A8 — add profile validation and advisory text; tests.
- [x] T3 — A9 — correct community tool detect/install behavior and registry field.
- [x] T4 — A11 — bound skills, extend registry previews, fix receipt action, warn on missing work type, remove the dead branch.
- [x] T5 — A12 — full verification.

## Log

### L1 — Original request (verbatim)

> si

### L2 — Scope

> A7-A9/A11 del audit

### L3 — Implementation

- Added schema bounds to delegation, parallel, context, triage, policy, receipt, governance, skills, registry, workflow, and community tools.
- Added `profileExists`, unknown-profile blocking in delegate/prepare, optional profile parameters in profile/skill previews, and advisory profile text.
- Removed the community guidance claim/field, fixed scoped package resolution, added probe timeouts, resolved the CodeGraph workspace, and removed the unused installed field.
- Added `max_skills` bounds, profile output for `odf_registry_read`, `action: "none"` handling, the missing-work-type warning, and removed the dead no-name discovery branch.

### L4 — Verification

- `npm run typecheck`: clean.
- `npm run test:unit`: 1346/1346.
- `npm run test:yaml`: 331/331.
- `odf-delegation.test.ts`: 505/505.
- `odf-delegation-prepare-seal.test.ts`: 45/45.
- Registry validation: all registered paths valid.
- `git diff --check`: clean.
- Vitest reports the pre-existing intermittent `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error; it is not a failing test.

### Risk

Risk: item 3 — requested changes to public tool input contracts, profile behavior, and community tool output. The local suite is green; an independent verifier is unavailable in this runtime, so this is not a native PASS claim.

### Remaining follow-ups

- Community tools still have no uninstall/rollback path.
- A few deeply nested expectation fields rely on the registry/expectation validator rather than individual schema bounds.
- Delegate H7-H13 (block-envelope context, child session ID in timeout/cancel, etc.) remain separate from this A7-A9/A11 pass.
