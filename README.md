# ODF Agent Team

> **Spec-driven Odoo delivery on OpenCode** — a phase pipeline, 11 specialized agents, 87 skills, and deterministic CLIs so your AI team *finds* the codebase instead of inventing it.

[![Tests](https://img.shields.io/badge/tests-844%20unit%20%2B%20154%20YAML%20%2B%2017%20harness-brightgreen)](#development)
[![Registry](https://img.shields.io/badge/registry-87%20skills%20%C2%B7%2011%20agents-blue)](odf-registry.json)
[![Odoo](https://img.shields.io/badge/Odoo-16%20%E2%80%93%2019-EE7048)](docs/intended-usage.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-informational)](CHANGELOG.md)

**ODF** — spec-driven Odoo delivery on OpenCode. Turns a generic AI assistant into a structured Odoo delivery team. An orchestrator routes every phase through a plugin that resolves the right agent, injects at most five skill rules, enforces Policy Gates, and seals evidence — so nothing ships on a guess.

```
odf-delegation plugin ──► task() ──► specialist agent ──► Odoo worktree
        │                                                          │
   registry · skills · gates                                tests · lint · refs
```

## Quickstart

```bash
# 1. Install into ~/.config/opencode (release-pinned)
curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/v1.3.0/install.sh | BRANCH=v1.3.0 bash

# 2. Inside OpenCode, from any Odoo worktree:
/odf-init           # detect version, modules, test runner
/odf-new my-feature # preflight → DECIDE → PLAN → BUILD → VERIFY
```

Need CodeGraph structural queries? Add `-- --with-codegraph`. Non-interactive CI? Add `-- --yes`.

## How it works

```
init → preflight → DECIDE → optional PLAN → BUILD → VERIFY → archived
```

| Stage | Legacy phases | When |
|-------|---------------|------|
| `DECIDE` | `PROPOSE` + `ASSESS` | always (non-micro) |
| `PLAN` | `QA-PLAN` + `DESIGN` | optional per routing |
| `BUILD` | `IMPLEMENT` | plan is closed |
| `VERIFY` | `VERIFY` | verification required |

Routing is deterministic: standard config can stop after DECIDE, a bugfix runs diagnose → BUILD → VERIFY, investigations use `/odf-explore` with no formal change. Full vocabulary: [docs/architecture.md](docs/architecture.md).

**Interactive diagram →** [Phase flow & agent routing](docs/odf-agent-phase-flow.html) · [Harness architecture](docs/harness-architecture.html)

## Commands

| Command | Purpose |
|---------|---------|
| `/odf-new <name>` | Start a formal change (preflight → full pipeline) |
| `/odf-continue [name]` | Resume from last completed stage |
| `/odf-status [name]` | Canonical thin-spine status |
| `/odf-explore <topic>` | Research without creating a change |
| `/odf-fix <description>` | Lightweight bugfix: diagnose → BUILD → VERIFY |
| `/odf-verify` | Quality gate: tests, lint, spec compliance |
| `/odf-health` | Installation + project detection check |

22 commands total — full list in [AGENTS.md](AGENTS.md).

## Why developers use it

- **One round-trip, not fifty.** The plugin resolves agent + skills + profile in a single `odf_delegate` call — no grep/read loops to assemble context.
- **Evidence over vibes.** Policy Gate, validation seals, attempt ledgers, and receipts run silently before IMPLEMENT/VERIFY.
- **Never invent IDs.** `odf-toolkit lookup` / `verify-refs` resolve every view XML ID and model against local Odoo source (exit 1 otherwise).
- **OCA-ready.** Governance skill enforces PR workflow, commit style, and maturity gates before publication.

## What's inside

| Piece | Count / location |
|-------|------------------|
| Skills | 87 (`skills/` — OCA governance/style, Odoo patterns, ODF phases) |
| Agents | 11 (`agent/` — orchestrator + 10 specialists) |
| Commands | 22 (`command/`) |
| Plugin tools | 19 injected at runtime (`plugins/odf-delegation.ts` + `odf-plugin/`) |
| Deterministic CLIs | `odf-project-scan`, `odf-toolkit` (`scripts/`) |

## Documentation

**[docs/README.md](docs/README.md)** — full index. Start here:

- [Intended usage](docs/intended-usage.md) — mental model, entry points, when to use what
- [Architecture](docs/architecture.md) — thin-spine vocabulary, components, data flow
- [Plugin reference](docs/plugin.md) — the 19 tools, modules, `odf_delegate` path
- [Archive](docs/archive/README.md) — completed roadmaps and plans

## Honest status

- **Mature and tested locally**: 844 unit tests + 154 YAML scenarios + 17 harness checks. Representative Odoo validation and end-to-end telemetry remain ODF 2.0 gates.
- **Portable**: Linux/macOS/Windows (Git Bash/WSL), `XDG_CONFIG_HOME` resolution, author-path rewriting at install time.
- **Known limitations**:
  - `plugins/odf-delegation.ts` (~6k lines) is still a monolith for the delegation/workflow core; cohesive sections already live in `odf-plugin/`.
  - The `engram` store needs the **Engram MCP** (or CLI); OpenSpec-only flows work without it.
  - `codegraph` / `fff` / `context7` are **optional** and degrade gracefully.
  - The phase model is strict by design; the escape hatch is audited `odf_workflow_override`, not a bypass.

## Dependencies

| Dependency | Missing | Impact |
|---|---|---|
| Node.js 18+ | — | pack does not run |
| `engram` (CLI/MCP) | Engram-only flows block; OpenSpec OK | optional |
| `codegraph` | context packs → FFF/native | optional |
| `git` / `docker` | digests/evidence, test detection off | recommended |

Full matrix: `node <pack>/scripts/odf-toolkit.js deps`

## Development

```bash
npm test              # full suite: unit + YAML + plugin
npm run test:unit     # 844 Vitest
npm run test:yaml     # 154 YAML scenarios
npm run test:harness  # 17 harness checks
npm run typecheck     # tsc --noEmit
ODF_CONFIG_DIR=$PWD node scripts/odf-registry-validate.js
```

Versioning: `VERSION` + `package.json` + `package-lock.json` + `odf-registry.json` + `CHANGELOG.md` must stay in sync. Releases: semver tag + `gh release create`.

## Repository layout

```
agent/            11 agent instructions (orchestrator + 10 specialists)
command/          22 slash commands
skills/           87 skills (OCA + ODF + shared)
odf-plugin/       deterministic modules (workflow, triage, policy, …)
plugins/          odf-delegation.ts — plugin entrypoint, 19 tools
scripts/          CLIs + test runner + registry validator
docs/             architecture, usage, plugin reference, diagrams
install.sh        idempotent installer (backup, TUI, --force, --with-codegraph)
odf-registry.json single source of truth
```

## License

MIT
