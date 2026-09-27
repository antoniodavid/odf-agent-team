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
- [x] T2 Add the official V2 `Plugin.define`/`setup` adapter for all ODF tools and V2 hook mappings.
- [x] T3 Wire V2 session delegation, cancellation, cleanup, and health diagnostics; preserve V1 native/SDK fallback order.
- [x] T4 Update installer/config handling for V2-native `plugins`, JSONC, MCP, and duplicate-load prevention.
- [ ] T5 Add V1/V2 contract fixtures, live-host smoke coverage, documentation, and support matrix (contract/docs slice complete; live-host gate pending).

## Acceptance criteria

- V1 continues to load and pass the existing test suite.
- V2 loads exactly one ODF plugin with the stable ID `odf-delegation`.
- All registered ODF tools are available through the V2 adapter with equivalent validation and result semantics.
- V2 hooks preserve loop guards, system/context injection, delegation lifecycle, and cleanup behavior.
- Installer works for global and project-local layouts without duplicating the plugin.
- V2 native configuration is supported without breaking legacy V1 configuration.
- [ ] A real OpenCode V2 smoke test exercises load, tools, hooks, delegation, cancellation, and reload before V2 becomes the default.

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
- [x] T2 implemented as an independently reviewable work unit; V1 tool factories remain the single tool-definition source.
- [x] T3 implemented as an independently reviewable work unit; official V2 session APIs are used for child delegation while V1 native task and SDK fallback paths remain available.
- [x] T4 implemented as an independently reviewable work unit; the installed entrypoint is dual-runtime, installer layouts stay single-plugin, and MCP configuration is schema-aware and JSONC-safe.
- [x] T5 contract/docs slice implemented as an independently reviewable work unit; host-independent V1/V2 fixtures cover the dual entrypoint, stable ID, complete tool surface, schema/validation parity, supported hook mappings, and cleanup semantics.
- [x] Corrected the V2 load-time TDZ: the adapter no longer runtime-imports V1 exports during module initialization; `setupODFV2` imports them immediately before V2 registration and passes the system rules into the hook registrar.
- [ ] T5 live-host slice remains open; `opencode2` is available, but provider execution is blocked by the reported host-version compatibility error, so no fabricated smoke harness was added.

## Verification evidence

- Baseline before implementation: 858 unit tests, 154 YAML scenarios, 17 harness tests, typecheck, registry validation, and `git diff --check` passed on the source checkout.
- T1 evidence: focused V1/V2 boundary tests passed (3 tests); full unit/plugin suite passed (860 tests across 30 files); YAML scenarios passed (154/154); typecheck and `git diff --check` passed. Added peer package `@opencode/plugin@2.0.12`; installed peers resolve to `@opencode-ai/plugin@1.17.8` and `@opencode-ai/sdk@1.17.8`.
- The V2 skeleton stays under `odf-plugin/` support files; the installer continues to emit only the existing V1 file under `plugins/` so T1 does not create duplicate auto-discovered plugins.
- Runtime baseline: local `opencode --version` reports `1.18.29`; V2 host validation is pending.
- T2 evidence: the focused V2 adapter suite passes 6 tests. It registers all 22 `ODF_REGISTERED_TOOLS` names through V2 `ctx.tool.transform`, converts the existing Zod schemas to JSON Schema, re-parses inputs before invoking the shared V1 execute functions, maps tool/session/event hooks, injects the shared system rules, and disposes registrations plus the event subscription.
- T2 intentionally uses V2 `session.hook("prompt")` as the narrowest available substitute for V1 `command.execute.before`; V2 has no command-before hook, so command-expanded parts and exact pre-dispatch timing are not equivalent. No unsupported hook is fabricated.
- T2 unit tests do not claim live-host compatibility. V2 session delegation/cancellation remains T3 work.
- Post-T2 checks: `npm run typecheck` passed; `npm run test:unit` passed with 863/863 tests across 31 files; `npm run test:yaml` passed with 154/154 scenarios; `npm run test:harness` passed with 17/17 tests; registry validation passed; `git diff --check` passed.
- T3 evidence: official `@opencode/plugin@2.0.12` `SessionDomain` operations (`create`, `get`, `prompt`, `wait`, `context`, `interrupt`) now back V2 child-session delegation. The adapter preserves validated V1 tool execution, context-file propagation, parent-model selection, cleanup, timeout/cancellation interrupts, and empty/malformed/error result handling. Health reports V2 session source/capabilities without executing a task.
- T3 focused evidence: `npx vitest run odf-plugin/odf-delegation.test.ts odf-plugin/opencode-v2-adapter.test.ts --reporter=dot` passed 398/398 tests across 2 files. The focused coverage includes official V2 request shapes, source selection, context files, timeout/cancellation, health diagnostics, and result/error semantics.
- Post-T3 checks: `npm run typecheck` passed; `npm run test:unit` passed with 871/871 tests across 31 files; `npm run test:yaml` passed with 154/154 scenarios; `npm run test:harness` passed with 17/17 tests; `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` passed; `git diff --check` passed.
- T4 evidence: `plugins/odf-delegation.ts` now exports the official dual-runtime object (`...Plugin.define({ id, setup })` plus the V1 `server`) with stable ID `odf-delegation`; the installer remains the sole writer of that auto-discovered plugin under both global `~/.config/opencode/plugins/` and project-local `.opencode/plugins/`.
- T4 installer evidence: stale ODF V2 adapter filenames are removed without touching foreign plugins; project launchers refuse global ODF duplicates; `scripts/lib/configure-mcp.mjs` preserves existing fields, writes legacy V1 `mcp` entries with `enabled: true`, writes native V2 `mcp.servers` entries with `disabled: false`, and refuses JSONC without creating a conflicting `opencode.json`, reporting the manual path instead.
- T4 focused evidence: `npx vitest run scripts/lib/installer.test.ts odf-plugin/plugin-entrypoint.test.ts --reporter=dot` passed 16/16 tests across 2 files.
- Post-T4 checks: `npm run typecheck` passed; `npm run test:unit` passed with 874/874 tests across 31 files; `npm run test:yaml` passed with 154/154 scenarios; `npm run test:harness` passed with 17/17 tests; `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` passed; `git diff --check` passed.
- T5 focused evidence: `npx vitest run odf-plugin/opencode-v2-contract.test.ts odf-plugin/opencode-v2-adapter.test.ts odf-plugin/plugin-entrypoint.test.ts --reporter=dot` passed 15/15 tests across 3 files; the new contract fixture suite passed 4/4 tests.
- T5 documentation evidence: `docs/opencode-v2-migration.md` records the V1 `1.18.29+` floor, V2 package/runtime assumptions, global/project paths, legacy `mcp` versus native `mcp.servers`, JSONC manual handling, the V2 command-before limitation, and the exact live-host checklist.
- T5 environment evidence: `opencode --version` reports V1 `1.18.29`; `npm ls @opencode/plugin @opencode-ai/plugin @opencode-ai/sdk --depth=0` resolves `@opencode/plugin@2.0.12`, `@opencode-ai/plugin@1.17.8`, and `@opencode-ai/sdk@1.17.8`. No real V2 host smoke ran.
- Post-T5 checks: `npm run typecheck` passed; `npm run test:unit` passed with 878/878 tests across 32 files; `npm run test:yaml` passed with 154/154 scenarios; `npm run test:harness` passed with 17/17 tests; `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` passed; `git diff --check` passed.
- TDZ bug evidence: the isolated V2 server log `/tmp/opencode/odf-opencode2-v2.nn5oGr/xdg-data/opencode/log/opencode.log` recorded server reference `err_1d7cca1c` and `ReferenceError: Cannot access 'OdfDelegationPluginV2' before initialization.` The Bun loader exposed the circular dependency between the V1 entrypoint's static V2 import and the adapter's static imports of `createODFRegisteredTools`/`ODF_SYSTEM_RULES`.
- TDZ fix evidence: `odf-plugin/opencode-v2-adapter.ts` has no runtime import from the V1 entrypoint; `setupODFV2` dynamically imports the V1 exports before `context.tool.transform` and `registerV2Hooks`, and `ODF_SYSTEM_RULES` is passed into the hook registrar. The public entrypoint shape remains `{ id, setup, server }` and V1 behavior is unchanged.
- TDZ regression evidence: `npx vitest run odf-plugin/opencode-v2-adapter.test.ts odf-plugin/plugin-entrypoint.test.ts --reporter=dot` passed 12/12 tests across 2 files. `odf-plugin/plugin-entrypoint.test.ts` now guards the import ordering that prevents the Bun load-time TDZ; it does not fake a V2 host.
- Post-TDZ checks: `npm run typecheck` passed; `npm run test:unit` passed with 879/879 tests across 32 files; `npm run test:yaml` passed with 154/154 scenarios; `npm run test:harness` passed with 17/17 tests; `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` passed; `git diff --check` passed.
- Remaining live-host blocker: `opencode2 v0.0.0-beta-19059` is available, but the Console free tier rejects that V2 host version and requires OpenCode `1.18.0+` for provider execution. No live V2 load/tools/hooks/delegation smoke success is claimed until provider compatibility is resolved.

## V2-only cut-over (2026-09-24)

The dual-runtime window was closed: OpenCode V2 is the only runtime.

- [x] Diagnosed the real load failure. `Cannot find package '@opencode-ai/plugin'` was **not** a code defect: the running service (PID 118614, started 11:28) predates `~/.config/opencode/node_modules` (installed 11:39), and a plugin that fails once stays `failed` until the service restarts. Reproduced the host's exact loader (`prepareSource` + `Host.load`) in a fresh process: scan tracks no missing npm packages and the entrypoint loads with `default` keys `[id, setup, server]`. The 2 uninstalled commits (#26, #27) were ruled out — the installed v1.3.0 import block is identical to `main`, and `main` was the build that passed.
- [x] Isolated v2 smoke harness: `XDG_CONFIG_HOME/DATA/STATE/CACHE` under `/tmp/opencode/odf-v2-smoke` with `opencode serve --service` on its own port. Result: 88 plugins, 88 active, **0 failed**; catalog exposes 22 `odf-*` commands + 11 `odoo_*` agents; `odf_health` executed in-session with `plugin.loaded: true` and all 22 registered tools.
- [x] V2-only entrypoint: removed `server`, `OdfDelegationPlugin` and `createODFRuntimeHooks`; `plugins/odf-delegation.ts` default-exports `OdfDelegationPluginV2`.
- [x] Dependency cut: new `odf-plugin/odf-tool.ts` supplies the `tool` helper on `zod`; 9 files moved off `@opencode-ai/plugin` at runtime. `package.json`: `dependencies` = `yaml` + `zod`; `devDependencies` = `@opencode-ai/plugin` + `@opencode-ai/sdk` (types/fixtures); `peerDependencies` = `@opencode/plugin`.
- [x] Preserved behavior that lived only in V1: extracted the registry/telemetry warm-up into `startOdfRuntime()`, awaited by `setupODFV2`.
- [x] Closed a parity gap: the V2 `session.context` hook now injects the one-shot context-pressure notice (V1 did this through `experimental.chat.system.transform`; V2 never did).
- [x] Installer: dependencies install before the plugin entrypoint is exposed, plus a restart reminder with an opt-in `--restart-service` / `ODF_RESTART_SERVICE=1` (dry-run never touches the filesystem).
- [x] Evidence: typecheck, 899 unit, 325 YAML, 18 harness, registry validation and `git diff --check` all pass.

## Next step

- [ ] Global deployment (backup + copy + `npm install` + service restart) is **deferred by decision**; `~/.config/opencode` still runs the 1.3.0 pack with `odf-delegation` in state `failed`.
- [ ] Live delegation + cancellation smoke against a real v2 session.
- [ ] Fix `getOdfConfigDir()` to honour `XDG_CONFIG_HOME` (README claims it; the resolver hardcodes `~/.config/opencode`).
