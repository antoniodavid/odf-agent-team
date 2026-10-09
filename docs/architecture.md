# ODF Architecture

This document maps the components of ODF and explains how they interact.

> Visual version: [phase flow](odf-agent-phase-flow.html) · [harness architecture](harness-architecture.html) · [delegation efficiency](delegation-flow.html) (interactive HTML).

## Workflow Model

ODF runs the thin-spine workflow:

```
health/preflight → one resolved route → only its required stages → archive when applicable
```

Legacy phases remain as compatible adapters. This is the single vocabulary table:

| Canonical stage | Legacy phases | Applies when | Phase artifacts |
|-----------------|---------------|--------------|-----------------|
| `DECIDE` | `PROPOSE` + `ASSESS` | routes that include DECIDE; terminal for standard config | `proposal`, `assess`, `expectations` when delegated |
| `PLAN` | `QA-PLAN` + `DESIGN` | only when the resolved route or risk requires formal planning | `qa-plan`, `design` when routed |
| `BUILD` | `IMPLEMENT` | the plan is closed | `implement-progress` |
| `VERIFY` | `VERIFY` | verification is required | `verify-report` |
| `FIX` | `FIX` | bugfix route (terminal FIX, then BUILD/VERIFY) | `fix` |
| `EXPLORE` | `EXPLORE` | investigation | `explore` |

Rules: `state.yaml` (or `odf/{change}/state`) persists the canonical stage; legacy
names are adapter-facing (commands, prompts, agent names) and are normalized by
`odf_workflow_status`. A legacy name in a result or prompt is an alias, never a
separate stage — when both appear, the canonical stage wins.

The user sees one route selected by `work_type`; triage level (`micro`,
`standard`, `full`), canonical stages, and legacy phases are internal mappings,
not extra user-facing stages. The optional shadow prediction is advisory and
does not change execution.

Every code-changing route carries focused QA tied to approved Expectations.
Small changes and bugfixes keep a compact test/check plan inline and do not
require a separate `qa-plan` artifact. Routes requiring PLAN, or an explicit
risk/complexity escalation, use formal QA-PLAN. QA-REVIEW/QA-AGGREGATE/QA-REPORT
run only when routed. The concrete route is resolved per work type (standard
config can stop after DECIDE; small change is DECIDE → BUILD → VERIFY; a bugfix
is FIX → BUILD → VERIFY; feature/cross-domain/migration/security use DECIDE →
PLAN → BUILD → VERIFY; investigation uses EXPLORE). Required VERIFY and evidence
gates are never removed by inline QA.

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
│  plugins/odf-delegation.ts   │  ← resolve agent/skills, select transport,
│                              │    route + status adapters, gates
└───────┬──────────────┬───────┘
        │              │
        ▼              ▼
┌──────────────┐ ┌──────────────┐
│ odf-registry │ │  Transport   │
│    .json     │ │ adapter/SDK  │
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

The ODF delegation engine and plugin entrypoint. Exposes tools such as
`odf_delegate`, `odf_delegation_prepare`, `odf_delegation_launch`, `odf_delegation_seal`,
`odf_workflow_route`, `odf_workflow_status`,
`odf_workflow_override`, `odf_workflow_bind`, `odf_entry_triage`,
`odf_skill_inject`, `odf_skill_resolve`, `odf_registry_read`,
`odf_profile_select`, `odf_notebooklm_lookup`, `odf_policy_gate`,
`odf_receipt`, and `odf_status`.

`odf_delegation_prepare`/`odf_delegation_launch`/`odf_delegation_seal` implement
the native prepare/launch/seal route (roadmap #55): prepare resolves the agent,
skills, profile and source-authority contract and returns the enriched prompt
plus a bounded `odf-tok-…` token under `.odf/`; launch verifies the prompt
digest and submits it through the V2 session API; seal independently verifies
the child transcript, reads its ODF Result, runs composite gates and returns the
standard delegation envelope. Fast-lane BUILD/VERIFY still use `odf_delegate`.

The entrypoint stays a monolith for the delegation/workflow core but its
self-contained sections live in cohesive modules under `odf-plugin/`:

- `odf-delegation-shared.ts` — safe paths, registry path resolution, the
  registry type model, `ODF_REGISTERED_TOOLS`.
- `odf-delegation-metrics.ts` — telemetry records, flush loop, token
  estimation.
- `odf-delegation-health.ts` — read-only health inspection, the native task
  adapter (when exposed), SDK session fallback, and result normalization
  helpers.

The entrypoint re-exports their public names, so imports and tests keep
working unchanged.

`odf_delegate` does the following:

1. Loads the registry.
2. Resolves the target agent from the phase and task keywords (shared logic in
   `scripts/lib/agent-resolve.js` — single source of truth also used by the
   test runner and `odf-toolkit`; `matchSkills` stays per-consumer because the
   plugin uses a phase-aware canonical variant).
3. Matches up to 5 relevant skills.
4. Injects compact rules and the active SDD profile into the prompt.
5. Enforces the authoritative TDD Policy Gate for IMPLEMENT/VERIFY, the
   stop-validation evidence seal, `design_closed` coercion, and claimed
   `artifact_ref` existence.
6. Uses the explicit native task adapter when the host exposes `toolCtx.task`;
   otherwise creates an isolated child with `client.session.create` and sends
   `client.session.prompt` with the agent, known model, and relative context
   references. SDK metadata binding is best-effort.
7. Returns a result envelope with `status` (`delegated`, `blocked`, `error`,
   `timeout`), `agent`, `skills`, and `result`; unavailable task APIs block
   without an executable fallback prompt, and task failures auto-seal a
   receipt.

The SDK session fallback is the supported current-runtime transport because the
official `ToolContext` does not expose `task`. It preserves ODF's gates,
receipts, metrics, timeout, cancellation, and result validation, but it cannot
reproduce native task permission derivation; native host permissions remain the
authority when the adapter is available.

`odf_workflow_route` resolves the canonical thin-spine route for a work type;
`odf_workflow_status` derives canonical status (read-only) from
OpenSpec/Engram/`.odf` with OpenSpec as authority, including nested OpenSpec
artifact discovery, the `binding_pending` marker, and `recovery_work_type_required`
for canonical states without a work type. `odf_workflow_override` is the
audited escape hatch (skip DECIDE/PLAN, re-enter, re-plan with Expectations
revisions); BUILD/VERIFY can never be skipped.

### `scripts/lib/`

Shared deterministic libraries consumed by the plugin, the CLIs, and the test
runner:

- `preflight.js` — preflight validation/defaults (including `validation_mode`).
- `agent-resolve.js` — STOP_WORDS, filterStopWords, and score-based
  `resolveAgent` (single source of truth; the scoring fix lives in exactly
  one place).
- `orchestrator.js` — legacy state-machine helpers for the YAML scenario
  runner.

### Deterministic CLIs (`scripts/`)

- `odf-project-scan.js` — full Doodba environment scan (addons.yaml sources,
  compose, linting, git, CodeGraph, dependency matrix), verified persistence,
  checksum cache, `--diff`, `--deep`, exit codes.
- `odf-toolkit.js` — read-side subcommands: `context` (CodeGraph explore),
  `state`, `result`, `resolve`, `evidence`, `metrics`, `manual-evidence`,
  `redundancy`.
- `odf-env-detect.js` — Doodba addons.yaml parser + dependency matrix (lib
  used by the scan).
- `odf-safety.js` — pre-tool safety inspection.
- `odf-metrics.js`, `odf-estimator.js`, `odf-design-library.js`,
  `odf-learning-bridge.js`, `odf-engram-maintenance.js` — observability and
  learning helpers.
- `odf-harness.test.ts` (`npm run test:harness`) — integral smoke test: real
  registry, triage/workflow/status/expectations/resolve, every CLI subcommand
  end-to-end, safety inspection, and registry path integrity.

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
7. Plugin resolves agent/skills, enforces gates, selects the native adapter or
   SDK child-session transport, and returns the result.
8. Orchestrator updates state and shows an approval gate.
9. Optional PLAN, then BUILD, then VERIFY repeat the delegate-update-gate cycle according to the resolved route.

### `/odf-continue`

1. `command/odf-continue.md` parses optional change name.
2. Orchestrator consults `odf_workflow_status` for the canonical stage, pending stage, resumable flag, and receipt.
3. If no name is given, continues only when discovery is complete and exactly
   one active change exists; otherwise it asks the user to choose or reports
   the discovery blocker. It never selects by recency.
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

When `completed_canonical_stages` is present, it is the completion record used
by workflow status. A stage omitted from the list stays pending even if a fresh
artifact exists: a child can write artifact bytes before its parent seal
commits the stage. Those bytes remain visible, but do not advance the workflow.
Legacy states without this list retain compatibility-based status derivation.

```yaml
change: my-feature
canonical_stage: PLAN            # DECIDE | PLAN | BUILD | VERIFY | ARCHIVED
completed_canonical_stages: [DECIDE] # stages committed by workflow transitions
legacy_phase: design             # last completed legacy phase for compatibility
preflight:
  change: my-feature
  execution_mode: auto
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
