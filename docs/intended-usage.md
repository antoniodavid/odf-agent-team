# ODF Intended Usage

This document describes the mental model for using ODF (Odoo Development Framework) inside OpenCode.

## What ODF Is

ODF is an OpenCode skill/agent pack that turns a generic AI assistant into a structured Odoo development team. It provides:

- A **registry** of 31 skills and 12 agents.
- A **conversational orchestrator** that runs a preflight gate, resolves the thin-spine workflow route, and delegates work stages.
- A **plugin** (`odf-delegation.ts`) that resolves skills/agents, enforces the Policy Gate and validation evidence, invokes OpenCode's native `task()` API, and derives canonical status from OpenSpec/Engram.
- An **installer** that deploys the pack idempotently into `~/.config/opencode`.

## When to Use Each Entry Point

| Entry point | Use when |
|-------------|----------|
| `/odf-init` | You opened a new Odoo project and want ODF to detect version, modules, test runner, etc. |
| `/odf-new <name>` | You want to start a formal change (feature, refactor, migration). Runs preflight first. |
| `/odf-continue [name]` | You want to resume an active change from the last completed stage. |
| `/odf-status [name]` | You want to see active changes or inspect one in detail (canonical thin-spine status). |
| `/odf-explore <topic>` | You want to research a topic without creating a formal change. |
| `/odf-fix <topic>` | You have a focused bug: diagnose → BUILD → VERIFY, escalating to full ODF when architecture changes are needed. |
| `/odf-apply` | BUILD alias for an existing planned change (legacy IMPLEMENT adapter). |
| `/odf-verify` | You finished implementation and want the quality gate. |
| `/odf-qa` | QA lens inside PLAN/BUILD/VERIFY, not a mandatory standalone stage. |

## The Workflow

A normal ODF change follows the thin-spine flow:

```
/odf-new my-feature
   │
   ▼
Preflight gate ──► asks for Odoo version, artifact store, delivery strategy, TDD mode, etc.
   │
   ▼
DECIDE (PROPOSE + ASSESS) ──► business framing, scope approval, standard vs custom
   │
   ▼
optional PLAN (QA lens + DESIGN) ──► architecture + task breakdown, when routing requires it
   │
   ▼
BUILD (IMPLEMENT) ──► code changes, tests, docs
   │
   ▼
VERIFY ──► tests, lint, compliance, Judgment Day review
   │
   ▼
ARCHIVED
```

Routing decides how much of the spine a change needs:

- **Standard config** (custom module on a known pattern): can stop after DECIDE with optional verification.
- **Small change**: inline PLAN before BUILD, no separate design stage.
- **Normal / cross-domain / migration / security**: full DECIDE → PLAN → BUILD → VERIFY.
- **Bugfix** (`/odf-fix`): diagnose → BUILD → VERIFY, escalating only when architecture changes appear.
- **Investigation**: `/odf-explore`, no formal change created.

`QA-PLAN`/`QA-REVIEW`/`QA-AGGREGATE`/`QA-REPORT` are QA lenses embedded in
PLAN, BUILD, and VERIFY — they are not mandatory top-level stages. Legacy
phase names still work as adapters (`DECIDE = PROPOSE + ASSESS`,
`PLAN = QA-PLAN + DESIGN`, `BUILD = IMPLEMENT`).

Approval gates pause after each stage unless `--fast` was used. The selected
artifact store is `openspec`, `engram`, or `hybrid`; the current
state-machine helpers persist runtime state to
`openspec/changes/{change}/state.yaml`, while Engram stores phase artifacts
and status observations.

## State Persistence

With an `openspec`/`hybrid` store, each change gets a folder under
`openspec/changes/{change-name}/` containing:

- `state.yaml` — runtime preflight and canonical stage state (authoritative)
- `decision.yaml` — business scope + standard/custom decision (DECIDE)
- `plan.yaml` — design/architecture + tasks when PLAN is used
- `build.yaml` — implementation progress when BUILD is used
- `verify-report-slice*.yaml` — verification evidence

Engram keeps legacy observations (`odf/{change}/{artifact-type}`) and
semantic recovery data; it completes groups missing from OpenSpec and
surfaces conflicts as warnings. Runtime seals live in `.odf/*.json`:

- `gate-{change}.json` — Policy Gate result
- `validation-evidence-{change}.json` — stop-validation evidence seal
- `receipt-{change}.json` — failure disposition receipt

Use `engram` for Engram-backed artifacts/status only, or `hybrid` to retain
both representations where the runtime supports mirroring. Old changes keep
their legacy state/artifacts dual-read for migration; they are never
rewritten automatically.

## Backward Compatibility

Existing ODF users keep working:

- Absolute paths in old `odf-registry.json` entries still resolve.
- The plugin returns a structured `blocked` envelope with `reason: task-api-unavailable` when `task()` is unavailable; it never returns an executable fallback prompt.
- Older slash commands (`/odf-init`, `/odf-fix`, etc.) remain unchanged.
- Legacy phase IDs (`PROPOSE`, `ASSESS`, `QA-PLAN`, `DESIGN`, `IMPLEMENT`, `VERIFY`) map to the thin-spine adapters.

## Quick Checks

```bash
# Validate the installed registry
node scripts/odf-registry-validate.js

# Run the full test suite
npm test

# Run only YAML scenarios
node scripts/odf-test-runner.js
```
