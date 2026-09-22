# OpenCode V2 migration support

ODF ships one `odf-delegation` entrypoint that exposes the existing V1 server and the official V2 `Plugin.define({ id, setup })` adapter. V2 is not the default until the live-host checklist below passes.

## Support matrix

| Surface | V1 | V2 | Support boundary |
|---|---|---|---|
| Host floor | OpenCode `1.18.29+` | A real V2 host/runtime | The local host is V1 `1.18.29`; V2 live validation is pending. |
| Package/runtime | `@opencode-ai/plugin` and `@opencode-ai/sdk` `^1.15.0` | `@opencode/plugin` `^2.0.12` with `Plugin.define`/`setup` | Node.js `18+`; the V2 CLI is not installed or assumed by this repository. |
| Plugin identity | `odf-delegation` | `odf-delegation` | The installed entrypoint is `plugins/odf-delegation.ts`; load it once. |
| Install scope | Global `~/.config/opencode/` or project `.opencode/` | Global `~/.config/opencode/` or project `.opencode/` | Each scope owns one `plugins/odf-delegation.ts`; project launchers prevent a global duplicate. |
| MCP configuration | Legacy `mcp` entries with `enabled: true` | Native `mcp.servers` entries with `disabled: false` | Existing fields are preserved; the installer does not convert the whole file automatically. |
| JSONC | Read by the host | Read by the host | `--configure-mcp` does not rewrite `opencode.jsonc`; edit it manually or convert to strict JSON first. |
| Tool contract | V1 tool factories and validation | JSON Schema generated from the V1 factories, with V1 parsing before execution | Contract fixtures cover all registered tools without claiming host execution. |
| Hooks and lifecycle | `command.execute.before`, `chat.message`, tool hooks, system transform, events, dispose | Tool `execute.before/after`, `session.context`, `session.prompt`, event subscription, setup cleanup | `session.prompt` is the narrowest V2 substitute for command-before; exact command-expanded timing is not equivalent. |

## Hook mapping

| V1 seam | V2 seam | Note |
|---|---|---|
| `tool.execute.before` | `ctx.tool.hook("execute.before")` | Supported. |
| `tool.execute.after` | `ctx.tool.hook("execute.after")` | Supported. |
| `experimental.chat.system.transform` | `ctx.session.hook("context")` | Injects the shared ODF system rules. |
| `command.execute.before` + `chat.message` | `ctx.session.hook("prompt")` | Best-effort raw prompt observation; V2 has no command-before hook. |
| `event` | `ctx.event.subscribe({ signal })` | Abort the subscription during cleanup. |
| `dispose` | `setup` cleanup function | Disposes registrations, event subscription, and loop-guard state. |

## Live-host gate before V2 becomes default

Run this checklist only with an actual V2 host. The current V1 host and Vitest fixtures are not substitutes.

- [ ] Record a V2 host version and confirm it loads `@opencode/plugin` `2.x` and Node.js `18+`.
- [ ] Test a global install and a project-local install in isolated config directories; confirm each has exactly one ODF plugin entry.
- [ ] Start the V2 host and confirm one plugin load with ID `odf-delegation`, no duplicate-registration warning, and no startup error.
- [ ] Enumerate all 22 registered ODF tools; invoke representative valid and invalid inputs and confirm schema rejection plus V1-equivalent result envelopes.
- [ ] Exercise context injection, tool-before/after hooks, raw `/odf-new` prompt handling, event subscription, and cleanup.
- [ ] Run one real delegation, cancel it, and confirm the child session is interrupted without a fabricated success result.
- [ ] Reload the host and repeat the load/tool checks; confirm no duplicate tools, hooks, or event subscriptions.
- [ ] Re-run the V1 host smoke and the repository checks before changing the default runtime.

**Current result:** live V2 smoke is pending because this environment only provides OpenCode V1 `1.18.29`. No V2 smoke command or fake host harness was added.
