# ODF Agent Team

> AI agents and skills for **Odoo** development on OpenCode — spec-driven pipeline, deterministic CLIs, and precision gates.

**ODF (Odoo Development Framework)** orchestrates Odoo module development through a phase pipeline delegated to specialized agents, backed by **deterministic CLI logic** (environment scan, ID lookup, test evidence) so agents *find* the codebase instead of inventing it.

## Honest status

- **Mature and tested**: 619 Vitest tests + 150 YAML scenarios + an end-to-end harness smoke suite (`npm run test:harness`). Every release is verified end to end.
- **Portable**: installs into any OpenCode environment (Linux/macOS/Windows via Git Bash/WSL), with `XDG_CONFIG_HOME` resolution and author-path rewriting at install time.
- **Known limitations**:
  - The plugin entrypoint (`plugins/odf-delegation.ts`, ~6k lines) is still a monolith for the delegation/workflow core; the self-contained sections already live in modules (`odf-plugin/odf-delegation-{shared,metrics,health,policy,loopguard}.ts`).
  - The `engram` store requires the **Engram MCP** (or the CLI for state); without it, OpenSpec flows work and Engram-only flows block early with a clear message.
  - `codegraph` / `fff` / `context7` are **optional**: they degrade to native/FFF search with warnings (see the matrix below).
  - The phase model is strict by design; the escape hatch is `odf_workflow_override` (audited skip/re-enter/re-plan), not a bypass.

## Install

```bash
# Release-pinned (recommended)
curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/v1.2.1/install.sh | BRANCH=v1.2.1 bash
# Or with flags: --yes (non-interactive) --force --with-codegraph --configure-mcp

# Interactive TUI (mode, components, profile, MCP)
./install.sh --tui

# From a local checkout
./install.sh --yes --force
```

Useful env vars: `ODF_DIR` / `ODF_CONFIG_DIR` / `XDG_CONFIG_HOME` (target), `ODF_SOURCE_DIR` (local source), `ODF_SKIP_NPM=1`, `ODF_SKIP_SELFTEST=1`, `BRANCH=<tag>` (pinned installs).

### Dependencies and degradation

| Dependency | Missing | Impact |
|---|---|---|
| Node.js 18+ | — | The pack does not run |
| `engram` (CLI) | OpenSpec OK; Engram-only blocks with `engram-cli-unavailable` | Optional |
| `engram` (MCP) | Engram-store workflows block early (install the MCP or use `openspec`) | Optional |
| `codegraph` | Context packs disabled → FFF/native | Optional |
| `fff` / `context7` | Falls back to native search / local sources | Optional |
| `git` / `docker` | Digests/evidence or test-command detection disabled | Recommended |

Full matrix: `node <pack>/scripts/odf-toolkit.js deps`

## Pipeline

```
init → preflight → DECIDE → optional PLAN → BUILD → VERIFY → archived
```

- `execution_mode`: `interactive` · `batch` · **`auto`** (autopilot: chained phases, mandatory gates intact).
- Legacy phases are adapters: `DECIDE`=PROPOSE+ASSESS, `PLAN`=QA-PLAN+DESIGN, `BUILD`=IMPLEMENT, `VERIFY` stays independent.
- **Audited override**: `odf_workflow_override` — skip (DECIDE/PLAN only), re-enter (invalidates later stages), re-plan (with human-approved Expectations revisions `revision/supersedes/replan_from`). Every call is appended to `.odf/override-{change}.jsonl`.
- **Preflight**: `artifact_store` (openspec/engram/hybrid), `delivery_strategy`, `review_budget_lines`, `validation_mode` (automated/manual-acceptance), `odoo_version`, TDD, chain strategy.

## Deterministic CLIs (the brain outside the LLM)

| CLI | Subcommands |
|---|---|
| `odf-project-scan` | Full Doodba environment scan (addons.yaml sources, compose, linting, git, CodeGraph, dependency matrix) + verified persistence, checksum cache, `--diff`, `--deep`, exit codes |
| `odf-toolkit` | `context` (CodeGraph explore) · `state` · `result` · `resolve` · `evidence` · `metrics` · `manual-evidence` · `redundancy` · `deps` · **`lookup`** · **`verify-refs`** |

### Precision gate (never invent IDs)

```bash
# Find a view XML ID / model / field in the local source (file:line)
odf-toolkit lookup --source <odoo-src-root> [--repos <src-dir>] --id <xmlid> | --model <model>

# VERIFY: every ref=/model= in the module must resolve (exit 1 otherwise)
odf-toolkit verify-refs --repo <module-dir> --source <odoo-src-root> [--repos <src-dir>]
```

Design and implementation **must** verify every view ID, model, and `_inherit` against the local source; an unresolved ID is an open decision, never a guess.

## What's inside

- **32 skills** (OCA governance/style, Odoo patterns, ODF phases, shared conventions), **13 specialized agents** (backend, frontend, QA, functional, DBA, APIs, migrations, stock-lot, proposer, etc.), `/odf-*` commands.
- **Plugin** (`plugins/odf-delegation.ts` + 5 modules in `odf-plugin/`): delegation via `task()`, policy gate, evidence seal, receipts, override, bind, loop guard.
- **Idempotent installer** with backup, TUI, `--configure-mcp`, dependency probe.
- **Tests**: `npm test` (Vitest + YAML scenarios), `npm run test:harness` (end-to-end smoke), `node scripts/odf-registry-validate.js`.

## Development

```bash
npm test                 # 619 vitest + 150 scenarios
npm run test:harness     # end-to-end harness smoke
npm run typecheck        # tsc --noEmit
node scripts/odf-registry-validate.js   # registry paths
```

Versioning: `VERSION` + `odf-registry.json` + `CHANGELOG.md` must stay in sync. Releases: semver tag + `gh release create`.

## Repository layout

- `agent/` — agent instructions.
- `skills/` — skills (OCA + ODF + shared).
- `command/` — slash commands.
- `odf-plugin/` — deterministic modules (workflow, status, triage, expectations, candidate-manifest, delegation-*).
- `scripts/` — CLIs and tests.
- `plugins/odf-delegation.ts` — plugin entrypoint.
- `docs/` — architecture, design/expectations contracts.
