# ODF Architecture

This document maps the components of ODF and explains how they interact.

## Workflow Model

ODF runs the thin-spine workflow:

```
preflight → DECIDE → optional PLAN → BUILD → VERIFY → archived
```

Legacy phases remain as compatible adapters:

- `DECIDE` = `PROPOSE` + `ASSESS`
- `PLAN` = `QA-PLAN` + `DESIGN` (optional per routing)
- `BUILD` = `IMPLEMENT`
- `VERIFY` stays independent

`QA-PLAN`/`QA-REVIEW`/`QA-AGGREGATE`/`QA-REPORT` are QA lenses nested inside
`PLAN`, `BUILD`, and `VERIFY` — not mandatory top-level stages. The concrete
route is resolved per work type (standard config can stop after DECIDE; a
small change can use an inline PLAN before BUILD; normal/cross-domain/
migration/security work uses PLAN; a bugfix is diagnose → BUILD → VERIFY;
investigation uses EXPLORE).

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
│  agent/odoo_orchestrator.md  │  ← preflight gate, thin-spine state,
│                              │    policy gate, receipts
└──────────────┬───────────────┘
               │ odf_delegate(phase, prompt, context_files)
               ▼
┌──────────────────────────────┐
│  plugins/odf-delegation.ts   │  ← resolve agent/skills, call task(),
│                              │    route + status adapters, gates
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

## Persistence Roles

Three stores cooperate:

- **OpenSpec** (`openspec/changes/{change}/`): authoritative, versioned state
  (`state.yaml`) and canonical artifacts (`decision`, `plan`, `build`,
  `verify-report-*`). Wins on conflicts.
- **Engram**: semantic recovery/learning and legacy observations
  (`odf/{change}/{artifact-type}`). Fills groups missing from OpenSpec;
  conflicts are surfaced as warnings, never silently overwritten.
- **`.odf/*.json`**: runtime seals — Policy Gate (`gate-{change}.json`),
  validation evidence (`validation-evidence-{change}.json`), and failure
  receipts (`receipt-{change}.json`).

The status adapter (`odf_workflow_status`) reads all three read-only and
merges conservatively. Legacy state/artifacts remain dual-read for
migration; old changes are never rewritten automatically.

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

The ODF-specific delegation engine. Exposes tools such as `odf_delegate`, `odf_workflow_route`, `odf_workflow_status`, `odf_skill_inject`, `odf_skill_resolve`, `odf_registry_read`, `odf_profile_select`, `odf_notebooklm_lookup`, `odf_policy_gate`, `odf_receipt`, and `odf_status`.

`odf_delegate` does the following:

1. Loads the registry.
2. Resolves the target agent from the phase and task keywords.
3. Matches up to 5 relevant skills.
4. Injects compact rules and the active SDD profile into the prompt.
5. Enforces the authoritative TDD Policy Gate for IMPLEMENT/VERIFY and the stop-validation evidence seal.
6. Invokes OpenCode's native `task()` API.
7. Returns a result envelope with `status` (`ok`, `fallback`, `error`, `timeout`), `agent`, `skills`, and `result`; on failure it auto-seals a receipt.

`odf_workflow_route` resolves the canonical thin-spine route for a work type; `odf_workflow_status` derives canonical status (read-only) from OpenSpec/Engram/`.odf` with OpenSpec as authority.

### `agent/odoo_orchestrator.md`

Conversational state machine. It:

- Runs the preflight gate before delegating any phase.
- Loads and persists change state to OpenSpec/Engram.
- Resolves the thin-spine route (`DECIDE` → optional `PLAN` → `BUILD` → `VERIFY`) via the workflow route tool.
- Shows approval gates after each phase.
- Consults `odf_workflow_status` for canonical stage/resumable state.
- Decides the next stage and calls `odf_delegate`.
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
5. Orchestrator resolves the thin-spine route for the work type.
6. It runs DECIDE through the compatible PROPOSE/ASSESS adapters via `odf_delegate`.
7. Plugin resolves agent/skills, enforces gates, invokes `task()`, and returns the result.
8. Orchestrator updates state and shows an approval gate.
9. Optional PLAN, then BUILD, then VERIFY repeat the delegate-update-gate cycle according to the resolved route.

### `/odf-continue`

1. `command/odf-continue.md` parses optional change name.
2. Orchestrator consults `odf_workflow_status` for the canonical stage, pending stage, resumable flag, and receipt.
3. If no name is given, picks the most recently updated active change.
4. If the receipt is pending, it re-presents the failure disposition with evidence and stops.
5. Determines the next pending canonical stage from status.
6. Calls `odf_delegate` for that stage (via legacy adapters where needed).
7. Updates state and shows the gate.

### `/odf-status`

1. `command/odf-status.md` parses optional change name.
2. Orchestrator calls `odf_workflow_status` (read-only); OpenSpec state is authority, Engram completes missing groups with warnings.
3. Renders a table or single-change detail including `canonical_stage`, `pending_stage`, `resumable`, `receipt`, `progress`, and `source`.

### `/odf-explore`

1. `command/odf-explore.md` parses topic, `--version`, and `--module`.
2. Orchestrator delegates a short research task via `odf_delegate(phase=EXPLORE)`.
3. Returns an exploration report and suggests `/odf-new` if needed.

## State Shape

Runtime state for a change is stored in `openspec/changes/{change}/state.yaml`. OpenSpec is the authoritative state source; Engram keeps legacy observations and semantic recovery data. Canonical artifacts live in the same change folder (`decision`, `plan`, `build`, `verify-report-*`), and runtime seals live in `.odf/*.json`.

```yaml
change: my-feature
canonical_stage: PLAN            # DECIDE | PLAN | BUILD | VERIFY | ARCHIVED
legacy_phase: design             # last completed legacy phase for compatibility
preflight:
  change: my-feature
  execution_mode: interactive
  artifact_store: hybrid
  delivery_strategy: ask-on-risk
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
  decision: true
  plan: false
  build: false
  verify: false
tasks_progress:
  completed: ["1.1", "1.2"]
  pending: ["1.3"]
```
