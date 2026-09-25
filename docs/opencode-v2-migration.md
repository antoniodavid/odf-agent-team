# OpenCode V2 migration support

ODF ships **one V2-only `odf-delegation` entrypoint**: the official
`Plugin.define({ id, setup })` shape. The V1 `server` export has been retired —
OpenCode V2 has no V1 runtime, and the dual `{ id, setup, server }` object
existed only for the transition window. Runtime code no longer imports
`@opencode-ai/plugin`; the shared `tool` helper lives in `odf-plugin/odf-tool.ts`
on top of the declared `zod` dependency, so the plugin graph carries only
host-provided `@opencode/plugin` plus `zod` and `yaml`.

> V1 references in this document describe the historical mapping that shaped the
> V2 seams. They are no longer a supported surface.

## Support matrix

| Surface | V1 | V2 | Support boundary |
|---|---|---|---|
| Host floor | OpenCode `1.18.29+` | OpenCode V2 beta `0.0.0-beta-19059` in the isolated harness | Plugin loading and resource discovery pass; full tool/delegation validation remains pending. |
| Package/runtime | `@opencode-ai/plugin` and `@opencode-ai/sdk` `^1.15.0` | `@opencode/plugin` `^2.0.12` with `Plugin.define`/`setup` | Node.js `18+`; the V2 CLI is not installed or assumed by this repository. |
| Plugin identity | `odf-delegation` | `odf-delegation` | The installed entrypoint is `plugins/odf-delegation.ts`; load it once. |
| Install scope | Global `~/.config/opencode/` or project `.opencode/` | Global `~/.config/opencode/` or project `.opencode/` | Each scope owns one `plugins/odf-delegation.ts`; project launchers prevent a global duplicate. |
| MCP configuration | Legacy `mcp` entries with `enabled: true` | Native `mcp.servers` entries with `disabled: false` | Existing fields are preserved; the installer does not convert the whole file automatically. |
| JSONC | Read by the host | Read by the host | `--configure-mcp` does not rewrite `opencode.jsonc`; edit it manually or convert to strict JSON first. |
| Agent/command discovery | `agent/` and `command/` | `agents/` and `commands/` | The installer copies both layouts from the same source files. |
| Tool contract | V1 tool factories and validation | JSON Schema generated from the V1 factories, with V1 parsing before execution | Contract fixtures cover all registered tools without claiming host execution. |
| Hooks and lifecycle | `command.execute.before`, `chat.message`, tool hooks, system transform, events, dispose | Tool `execute.before/after`, `session.context`, `session.prompt`, event subscription, setup cleanup | `session.prompt` detects both the raw `/odf-new` form and the command-expanded document; the entry capability maps are shared with the registered tools. |

## Hook mapping

| V1 seam | V2 seam | Note |
|---|---|---|
| `tool.execute.before` | `ctx.tool.hook("execute.before")` | Supported. |
| `tool.execute.after` | `ctx.tool.hook("execute.after")` | Supported. |
| `experimental.chat.system.transform` | `ctx.session.hook("context")` | Injects the shared ODF system rules. |
| `command.execute.before` + `chat.message` | `ctx.session.hook("prompt")` | Detects the raw `/odf-new` form and the expanded command document (template body + appended arguments); V2 has no command-before hook, so timing still differs from V1. |
| `event` | `ctx.event.subscribe({ signal })` | Abort the subscription during cleanup. |
| `dispose` | `setup` cleanup function | Disposes registrations, event subscription, and loop-guard state. |

## Resource discovery and startup timing

The source tree keeps the V1-compatible `agent/` and `command/` directories.
`install.sh` also copies them to `agents/` and `commands/`, which are the
resource layouts OpenCode V2 discovers. Both installed layouts therefore share
one source of truth.

V2 loads the command and agent catalog asynchronously after the plugin starts.
An immediate catalog query can show only built-ins or an empty list while the
server is still initializing. Wait for startup to settle or restart the session,
then verify the catalog through the V2 API:

```bash
opencode2 api --standalone GET /api/command
opencode2 api --standalone GET /api/agent
```

The current registry should expose 22 ODF commands and 11 ODF agents in
addition to the host's built-ins. A provider/model error is independent of this
catalog check; validate discovery before diagnosing model connectivity.

## Live-host gate before V2 becomes default

Run this checklist only with an actual V2 host. The current V1 host and Vitest fixtures are not substitutes.

- [x] Record a V2 host version and confirm it loads `@opencode/plugin` `2.x` and Node.js `18+`. — OpenCode `2.0.16`, `@opencode/plugin@2.0.16`, Node `v24.15.0`.
- [x] Test a global install and a project-local install in isolated config directories; confirm each has exactly one ODF plugin entry. — isolated config under an isolated `XDG_*` set yields exactly one `odf-delegation` entry.
- [x] Start the V2 host and confirm one plugin load with ID `odf-delegation`, no duplicate-registration warning, and no startup error. — 88 plugins, 88 active, **0 failed**, no `failed to load plugin` in the log.
- [ ] Enumerate all 22 registered ODF tools; invoke representative valid and invalid inputs and confirm schema rejection plus V1-equivalent result envelopes. — `odf_health` executed live and reported all 22 registered tools; invalid-input/schema-rejection coverage is Vitest-only (`opencode-v2-contract.test.ts`), and there is no HTTP endpoint for tool enumeration (`/api/tool` → 404), so the remaining 21 need model round trips.
- [ ] Exercise context injection, tool-before/after hooks, raw `/odf-new` prompt handling, event subscription, and cleanup. — context/system injection confirmed live and asserted by fixtures; tool hooks, `/odf-new` detection, event subscription and cleanup are fixture-covered but not yet exercised against a real host session.
- [x] Run one real delegation, cancel it, and confirm the child session is interrupted without a fabricated success result. — the first live run **failed** and exposed a real bug: `findTaskApi` re-wrapped the adapter's own V2 task bridge in `createNativeTaskApi`, so the promise the bridge's abort keys on was replaced, `pending.get()` missed and the interrupt was silently dropped. The child ran past the timeout and finished on its own (`outcome: succeeded`, 63 output tokens, 1.0s after the parent gave up). Fixed by using an ODF-owned bridge as is; re-run: envelope `status: "timeout"`, `result: null` (no fabricated success), child `outcome: interrupted`, `finish: error`, **0 tokens**, and `/api/session/active` empty.
- [x] Reload the host and repeat the load/tool checks; confirm no duplicate tools, hooks, or event subscriptions. — service restarted clean after the changes; single `odf-delegation`, 88/88 active, no duplicates.
- [ ] Re-run the V1 host smoke and the repository checks before changing the default runtime. — moot: V1 is retired. Repository checks re-run green after the change.

**Current result:** the plugin loads and validates end-to-end on a real V2 host
(`OpenCode 2.0.16`): `odf-delegation` is `active`, the catalog exposes 22 ODF
commands and 11 ODF agents, and `odf_health` executed in-session reporting
`plugin.loaded: true` with all 22 tools. Remaining unchecked items are live
delegation/cancellation and per-tool schema-rejection round trips.

## Pack discovery

`scripts/lib/config-dir.js` resolves the pack directory in this order:

1. `ODF_CONFIG_DIR` (absolute) — the explicit override, and the channel the
   project launcher exports.
2. The pack the running module ships in, when it carries `odf-registry.json`.
3. `$XDG_CONFIG_HOME/opencode`.
4. `~/.config/opencode`.

Step 2 is what makes a global install work under `XDG_CONFIG_HOME` and a
project-local `<project>/.opencode` work without the launcher: the plugin and
every CLI live inside the pack, so they locate themselves. `getOdfConfigDir()`
and the five CLI copies of the logic share this resolver, and `install.sh`
already ordered its own default the same way.

`REGISTRY_PATH` and the registry cache are module-level constants evaluated at
import time, when the workspace is not known yet — that is why self-location and
environment variables are the only mechanisms that can work at this layer, and a
workspace-driven fallback could not have fixed the project-local case.

The `/odf-*` prompts default `PACK` to steps 1, 3 and 4
(`ODF_CONFIG_DIR` → XDG → home). For a project-local pack, prefer the project
launcher, which exports `ODF_CONFIG_DIR`.
