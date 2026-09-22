# OpenCode V2 Dual-Runtime Migration

## Objective

Add official OpenCode V2 support to ODF without breaking the existing OpenCode V1 runtime.

## Problem

ODF currently exposes a V1 plugin entrypoint and V1 tool/hook contracts. It already contains a V2-shaped child-session transport adapter, but OpenCode V2 requires a separate `Plugin.define`/`setup` implementation, V2 tool schemas, V2 hooks, and updated configuration/install handling.

## Why

OpenCode V2 is stable, but ODF must keep V1 support while the V2 adapter is validated in a real host. A dual-runtime package allows incremental rollout and rollback.

## Constraints

- Preserve the V1 adapter and existing workflow behavior.
- Do not load both adapters for one OpenCode process.
- Keep workflow gates, receipts, metrics, cancellation, result validation, and permissions fail-closed.
- Do not convert the entire configuration to native V2 automatically.
- Do not touch unrelated pre-existing worktree changes from the source checkout.
- Use work-unit commits with tests and documentation for each behavior slice.
- Current repository strict TDD flag is disabled; use standard test-before/after evidence where practical.

## Authorized scope and route

- Worktree: `/home/adruban/Workspace/Personal/odf-agent-team-worktrees/opencode-v2-migration`
- Branch: `feat/opencode-v2-migration`
- Route: delegated direct writer for multi-file host adapter and harness changes.
- V1 support floor decision: validate and document OpenCode `1.18.29+`; retain a separate legacy entrypoint only if older V1 support is explicitly required.
- Delivery strategy: `ask-on-risk`; monitor authored changes against the repository's 400-line review heuristic.

## Tasks

- [x] T1 Establish a host-neutral runtime boundary and dual entrypoint skeleton without changing V1 behavior.
- [ ] T2 Add the official V2 `Plugin.define`/`setup` adapter for all ODF tools and V2 hook mappings.
- [ ] T3 Wire V2 session delegation, cancellation, cleanup, and health diagnostics; preserve V1 native/SDK fallback order.
- [ ] T4 Update installer/config handling for V2-native `plugins`, JSONC, MCP, and duplicate-load prevention.
- [ ] T5 Add V1/V2 contract fixtures, live-host smoke coverage, documentation, and support matrix.

## Acceptance criteria

- V1 continues to load and pass the existing test suite.
- V2 loads exactly one ODF plugin with the stable ID `odf-delegation`.
- All registered ODF tools are available through the V2 adapter with equivalent validation and result semantics.
- V2 hooks preserve loop guards, system/context injection, delegation lifecycle, and cleanup behavior.
- Installer works for global and project-local layouts without duplicating the plugin.
- V2 native configuration is supported without breaking legacy V1 configuration.
- A real OpenCode V2 smoke test exercises load, tools, hooks, delegation, cancellation, and reload before V2 becomes the default.

## Applicable checks

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:yaml`
- `npm run test:harness`
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js`
- `git diff --check`
- OpenCode V1 host smoke test
- OpenCode V2 host smoke test

## Progress

- [x] Created isolated worktree and branch from the latest `main` commit.
- [x] Completed read-only compatibility audit and recorded the baseline.
- [x] T1 implemented as an independently reviewable work unit.

## Verification evidence

- Baseline before implementation: 858 unit tests, 154 YAML scenarios, 17 harness tests, typecheck, registry validation, and `git diff --check` passed on the source checkout.
- T1 evidence: focused V1/V2 boundary tests passed (3 tests); full unit/plugin suite passed (860 tests across 30 files); YAML scenarios passed (154/154); typecheck and `git diff --check` passed. Added peer package `@opencode/plugin@2.0.12`; installed peers resolve to `@opencode-ai/plugin@1.17.8` and `@opencode-ai/sdk@1.17.8`.
- The V2 skeleton stays under `odf-plugin/` support files; the installer continues to emit only the existing V1 file under `plugins/` so T1 does not create duplicate auto-discovered plugins.
- Runtime baseline: local `opencode --version` reports `1.18.29`; V2 host validation is pending.

## Next step

T1 is complete. T2 remains responsible for registering V2 tools/hooks and must not be inferred from this lifecycle-only skeleton.
