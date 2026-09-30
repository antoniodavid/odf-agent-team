# ODF Intended Usage

This document describes the mental model for using ODF inside OpenCode.

> Visual version: [phase flow](odf-agent-phase-flow.html) · [harness architecture](harness-architecture.html) · [delegation efficiency](delegation-flow.html) (interactive HTML).

## What ODF Is

ODF is an OpenCode skill/agent pack that turns a generic AI assistant into a structured Odoo delivery team. It provides:

- A **registry** of 87 skills and 11 agents.
- A **conversational orchestrator** that runs a preflight gate, resolves the thin-spine workflow route, and delegates work stages.
- A **plugin** (`odf-delegation.ts`) that resolves skills/agents, enforces the Policy Gate and validation evidence, uses a native task adapter when the host exposes one, falls back to an SDK child session, and derives canonical status from OpenSpec/Engram.
- An **installer** that deploys the pack idempotently into `~/.config/opencode`.

## When to Use Each Entry Point

| Entry point | Use when |
|-------------|----------|
| `/odf-init` | You opened a new Odoo project and want ODF to detect version, modules, test runner, etc. |
| `/odf-new <name>` | You want to start a change on its resolved route. Runs health/preflight first and shows one route. |
| `/odf-continue [name]` | You want to resume an active change from the last completed stage. |
| `/odf-status [name]` | You want to see active changes or inspect one in detail (canonical thin-spine status). |
| `/odf-explore <topic>` | You want to research a topic without creating a formal change. |
| `/odf-fix <topic>` | You have a focused bug: diagnose → BUILD → VERIFY, escalating to full ODF when architecture changes are needed. |
| `/odf-apply` | BUILD alias for an existing planned change (legacy IMPLEMENT adapter). |
| `/odf-verify` | You finished implementation and want the quality gate. |
| `/odf-qa` | Formal QA lens when routed; small changes keep focused QA inline. |

## The Workflow

A change follows one resolved route; the orchestrator does not show every
adapter phase as a separate handoff:

```
/odf-new my-feature
   │
   ▼
Health + one intake ──► show the resolved route and next action
   ├── EXPLORE                         question / investigation
   ├── DECIDE                          standard configuration
   ├── DECIDE → BUILD → VERIFY         small change (inline QA)
   ├── FIX → BUILD → VERIFY            bugfix (inline regression QA)
   ├── DECIDE → PLAN → BUILD → VERIFY  feature / cross-domain / elevated risk
   └── VERIFY                          verify-only
```

Routing decides how much of the spine a change needs:

- **Standard config** (known standard feature): ends after DECIDE; no custom BUILD.
- **Small change**: inline plan and focused QA before BUILD; no separate QA-PLAN/design handoffs.
- **Feature / cross-domain / migration / security**: formal DECIDE → PLAN → BUILD → VERIFY, with QA-PLAN when the route or escalation requires it.
- **Bugfix** (`/odf-fix`): diagnose → BUILD → VERIFY, escalating only when architecture changes appear.
- **Investigation**: `/odf-explore`, no formal change created.

Show one user-facing route selected by `work_type`; triage level
(`micro/standard/full`) and legacy phase names are internal mappings. Every
code-changing route carries focused QA tied to approved Expectations. Small
changes and bugfixes keep the test/check plan inline and need no separate
`qa-plan` artifact; formal QA-PLAN is used when the resolved route requires PLAN
or risk/complexity explicitly escalates it. QA-REVIEW/QA-AGGREGATE/QA-REPORT are
conditional lenses, not universal handoffs. Legacy phase names remain adapters
(`DECIDE = PROPOSE + ASSESS`, `PLAN = QA-PLAN + DESIGN`, `BUILD = IMPLEMENT`).

Ask for a human decision only at a required approval or when scope/Expectations
are unresolved; adapter transitions do not add approval pauses. The selected
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
- The plugin adapts a native-shaped `toolCtx.task` only when the host exposes it; otherwise the supported current fallback uses SDK child sessions. If neither is available, it returns a structured `blocked` envelope with `reason: task-api-unavailable` and never returns an executable fallback prompt.
- SDK child sessions receive the parent session, agent, known model, and validated workspace-relative context references. SDK transport cannot reproduce native task permission derivation, so native host permissions remain authoritative when available.
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
