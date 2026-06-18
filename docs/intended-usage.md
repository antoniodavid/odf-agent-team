# ODF Intended Usage

This document describes the mental model for using ODF (Odoo Development Framework) inside OpenCode.

## What ODF Is

ODF is an OpenCode skill/agent pack that turns a generic AI assistant into a structured Odoo development team. It provides:

- A **registry** of 31 skills and 12 agents.
- A **conversational orchestrator** that runs a preflight gate and delegates work phases.
- A **plugin** (`odf-delegation.ts`) that resolves skills/agents and invokes OpenCode's native `task()` API.
- An **installer** that deploys the pack idempotently into `~/.config/opencode`.

## When to Use Each Entry Point

| Entry point | Use when |
|-------------|----------|
| `/odf-init` | You opened a new Odoo project and want ODF to detect version, modules, test runner, etc. |
| `/odf-new <name>` | You want to start a formal change (feature, refactor, migration). Runs preflight first. |
| `/odf-continue [name]` | You want to resume an active change from the last completed phase. |
| `/odf-status [name]` | You want to see active changes or inspect one in detail. |
| `/odf-explore <topic>` | You want to research a topic without creating a formal change. |
| `/odf-fix <topic>` | You have a focused bug that fits in ≤3 files and does not need architecture changes. |
| `/odf-verify` | You finished implementation and want the quality gate. |

## The Workflow

A normal ODF change follows this flow:

```
/odf-new my-feature
   │
   ▼
Preflight gate ──► asks for Odoo version, artifact store, delivery strategy, TDD mode, etc.
   │
   ▼
ASSESS ──► standard vs custom decision
   │
   ▼
DESIGN ──► architecture + task breakdown
   │
   ▼
IMPLEMENT ──► code changes, tests, docs
   │
   ▼
VERIFY ──► tests, lint, compliance, Judgment Day review
   │
   ▼
ARCHIVED
```

Approval gates pause after each phase unless `--fast` was used. State is persisted to `openspec/changes/{change}/state.yaml` by default.

## State Persistence

ODF stores change state in OpenSpec files by default. Each change gets a folder under `openspec/changes/{change-name}/` containing:

- `proposal.yaml` — intent and scope
- `spec.yaml` — requirements and scenarios
- `design.yaml` — architecture and decisions
- `tasks.yaml` — task breakdown and progress
- `state.yaml` — runtime preflight and phase state
- `apply-progress.yaml` — implementation progress
- `verify-report-slice*.yaml` — verification evidence

You can also mirror state to Engram using the `hybrid` artifact store option.

## Backward Compatibility

Existing ODF users keep working:

- Absolute paths in old `odf-registry.json` entries still resolve.
- The plugin returns a fallback envelope when `task()` is unavailable.
- Older slash commands (`/odf-init`, `/odf-fix`, etc.) remain unchanged.

## Quick Checks

```bash
# Validate the installed registry
node scripts/odf-registry-validate.js

# Run the full test suite
npm test

# Run only YAML scenarios
node scripts/odf-test-runner.js
```
