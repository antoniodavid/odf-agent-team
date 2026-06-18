# ODF Architecture

This document maps the components of ODF and explains how they interact.

## Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User / OpenCode Chat                         │
└──────────────┬──────────────────────────────────────────────────────┘
               │ /odf-new, /odf-continue, /odf-status, /odf-explore
               ▼
┌──────────────────────────────┐
│   command/*.md definitions   │  ← parse args, route to orchestrator
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  agent/odoo_orchestrator.md  │  ← preflight gate, state machine, gates
└──────────────┬───────────────┘
               │ odf_delegate(phase, prompt, context_files)
               ▼
┌──────────────────────────────┐
│  plugins/odf-delegation.ts   │  ← resolve agent/skills, call task()
└───────┬──────────────┬───────┘
        │              │
        ▼              ▼
┌──────────────┐ ┌──────────────┐
│ odf-registry │ │  OpenCode    │
│    .json     │ │   task()     │
└──────────────┘ └──────┬───────┘
                        │
                        ▼
               ┌─────────────────┐
               │  phase agents  │  ← odoo_backend_engineer, etc.
               └────────┬────────┘
                        │
                        ▼
               ┌─────────────────┐
               │  skills/*.md    │  ← injected compact rules
               └─────────────────┘
```

## Component Responsibilities

### `odf-registry.json`

Source of truth for:

- Skills with triggers, compact rules, paths, and Odoo version support.
- Agents with phases, descriptions, and paths.
- Profiles with per-phase model/temperature settings.
- Commands registered for native orchestrator routing.
- Package metadata (name, version, repository, dependencies).
- Flags such as `use_relative_paths` and `pr_size_budget`.

Relative paths are resolved against the directory containing `odf-registry.json`. Absolute legacy paths keep working.

### `plugins/odf-delegation.ts`

The ODF-specific delegation engine. Exposes tools such as `odf_delegate`, `odf_skill_inject`, `odf_skill_resolve`, `odf_registry_read`, `odf_profile_select`, and `odf_notebooklm_lookup`.

`odf_delegate` does the following:

1. Loads the registry.
2. Resolves the target agent from the phase and task keywords.
3. Matches up to 5 relevant skills.
4. Injects compact rules and the active SDD profile into the prompt.
5. Invokes OpenCode's native `task()` API.
6. Returns a result envelope with `status` (`ok`, `fallback`, `error`, `timeout`), `agent`, `skills`, and `result`.

### `agent/odoo_orchestrator.md`

Conversational state machine. It:

- Runs the preflight gate before delegating any phase.
- Loads and persists change state to OpenSpec/Engram.
- Shows approval gates after each phase.
- Decides the next phase and calls `odf_delegate`.
- Handles `/odf-continue` and `/odf-status` logic.

### `command/*.md`

Slash command definitions. They parse arguments and route to the orchestrator. They contain no business logic. The native orchestrator commands are:

- `/odf-new`
- `/odf-continue`
- `/odf-status`
- `/odf-explore`

### `install.sh` + `package.json`

`install.sh` deploys the ODF pack idempotently. It:

- Validates prerequisites (python3, curl/wget, Node.js 18+).
- Creates a timestamped backup.
- Merges files into `ODF_DIR`.
- Runs `npm install` if `package.json` exists.
- Runs the ODF self-test.

`package.json` declares Node dependencies, test scripts, and peer dependencies for the OpenCode plugin SDK.

### `scripts/odf-test-runner.js`

Regression runner. It:

- Runs Vitest unit tests when `--plugin-tests` is passed.
- Discovers and runs YAML scenario suites from `scripts/odf-agent-tests/`.
- Supports suite types: agent, preflight, orchestrator, cli, installer, registry.

## Data Flow

### `/odf-new`

1. `command/odf-new.md` parses change name, optional description, and `--fast`.
2. Orchestrator loads existing change state if any.
3. If preflight is missing/invalid, the orchestrator asks preflight questions.
4. Preflight record is written to `openspec/changes/{change}/state.yaml`.
5. Orchestrator builds an ASSESS prompt and calls `odf_delegate(phase=ASSESS)`.
6. Plugin resolves agent/skills, invokes `task()`, and returns the result.
7. Orchestrator updates state and shows an approval gate.
8. DESIGN/IMPLEMENT/VERIFY repeat the delegate-update-gate cycle.

### `/odf-continue`

1. `command/odf-continue.md` parses optional change name.
2. Orchestrator loads active changes.
3. If no name is given, picks the most recently updated active change.
4. Determines the next pending phase from state.
5. Calls `odf_delegate` for that phase.
6. Updates state and shows the gate.

### `/odf-status`

1. `command/odf-status.md` parses optional change name.
2. Orchestrator reads active changes.
3. Renders a table or single-change detail.

### `/odf-explore`

1. `command/odf-explore.md` parses topic, `--version`, and `--module`.
2. Orchestrator delegates a short research task via `odf_delegate(phase=EXPLORE)`.
3. Returns an exploration report and suggests `/odf-new` if needed.

## State Shape

Runtime state for a change is stored in `openspec/changes/{change}/state.yaml`:

```yaml
change: my-feature
phase: design
preflight:
  change: my-feature
  execution_mode: interactive
  artifact_store: openspec
  delivery_strategy: ask-always
  review_budget_lines: 400
  odoo_version: 18
  tdd_mode: false
  solution_strategy: custom
  chain_strategy: feature-branch
  persisted_at: "2026-06-18T00:00:00Z"
project:
  name: my-project
  odoo_version: 18
  test_command: npm test
  lint_command: npx tsc --noEmit
artifacts:
  assess: true
  qa_plan: false
  design: true
  implement: false
  verify: false
tasks_progress:
  completed: ["1.1", "1.2"]
  pending: ["1.3"]
```
