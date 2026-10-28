# ODF Intended Usage

This document describes the mental model for using ODF inside OpenCode.

> Visual version: [phase flow](odf-agent-phase-flow.html) · [harness architecture](harness-architecture.html) · [delegation efficiency](delegation-flow.html) (interactive HTML).

## What ODF Is

ODF is an OpenCode skill/agent pack that turns a generic AI assistant into a structured Odoo delivery team. It provides:

- A **registry** of 51 skills and 11 agents.
- A **conversational orchestrator** that runs a preflight gate, resolves the thin-spine workflow route, builds one bounded Context Manifest, and delegates work stages.
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
   ├── DECIDE → BUILD → VERIFY         feature-inline (bounded ASSESS only when gated)
   ├── FIX → BUILD → VERIFY            bugfix (inline regression QA)
   ├── DECIDE → PLAN → BUILD → VERIFY  feature / cross-domain / elevated risk
   └── VERIFY                          verify-only
```

Routing decides how much of the spine a change needs:

- **Standard config** (known standard feature): ends after DECIDE; no custom BUILD.
- **Small change**: inline plan and focused QA before BUILD; no separate QA-PLAN/design handoffs.
- **Feature inline**: the default standard-feature route. It keeps Intent +
  Expectations and drops the formal PLAN; DECIDE is terminal when the entry gate
  reads `skip`, runs one bounded ASSESS when it reads `assess`, and escalates to
  the formal `feature` route when it reads `escalate`.
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
For DECIDE artifacts, `status: assessed` is terminal only on canonical `decision`
and `assess` artifacts. Expectations remain shared context: they inform the
decision but do not complete a workflow stage.

Ask for a human decision only at a required approval or when scope/Expectations
are unresolved; adapter transitions do not add approval pauses. The selected
artifact store is `openspec`, `engram`, or `hybrid`; state-machine helpers
persist workflow state and phase artifacts to that selected store. In `hybrid`,
OpenSpec remains canonical and matching Engram references are mirrored;
conflicting artifacts are never silently merged.

After the entry gate and approved Expectations, `/odf-new` builds **one** bounded,
reference-only Context Manifest and forwards it unchanged to the ASSESS and BUILD
roles. Redundancy is a gate signal for `feature-inline`, not a blocking question.
See [Context contract](context-contract.md).

## Project activation

ODF is scoped to initialized Odoo projects. `/odf-init` writes
`.odf/project.json`; that manifest is what makes the harness available in the
project, and re-running the scan for the same canonical root and project is
idempotent (`initialized_at` keeps the first activation).

The plugin registers its tools per project when the runtime boots, so a project
activated afterwards stays inert for that runtime. When the scan prints
`ODF runtime reload required:`, fully restart OpenCode — every window **and** the
`opencode serve --service` daemon — then verify with `/odf-health`. Do not
reinstall the pack: the manifest is already persisted and the installed bytes are
unchanged.

## Stopping safely

Every `blocked` or `failed` envelope carries a `stop_disposition` with `kind`,
`user_action_required`, `automatic_recovery`, `reason`, and `next_action`, so a
stop names its continuation instead of dead-ending the chat:

| `kind` | Meaning | Automatic recovery |
|---|---|---|
| `safety` | A safety, policy, digest, or database invariant failed | `none` — never retried around |
| `human-decision` | Expectations, receipts, governance, scope, or change selection needs a human | `none` |
| `repairable` | A missing or non-terminal artifact, or an invalid ODF Result, inside the approved scope | `repair-in-phase` |
| `dependency` | Transport timeout/unavailable (retry once if the child is idle) or a missing registry/Engram | `retry-once` / `wait` |
| `terminal` | Cancellation, empty result, seal error, or attempt-settlement failure | `none` — explain and ask for a disposition |
| `unclassified` | The reason could not be matched safely | `none` — fail closed |

Ordinary REPL output is not a stop; ODF never auto-continues an unclassified
reason.

## State Persistence

With an `openspec` store, each change gets a folder under
`openspec/changes/{change-name}/` containing:

- `state.yaml` — runtime preflight and canonical stage state (authoritative
  when OpenSpec is selected)
- `decision.yaml` — business scope + standard/custom decision (DECIDE)
- `plan.yaml` — design/architecture + tasks when PLAN is used
- `build.yaml` — implementation progress when BUILD is used
- `verify-report-slice*.yaml` — verification evidence

With an `engram` store, state and phase artifacts use deterministic
`odf/{change}/{artifact-type}` refs and Engram is authoritative. With `hybrid`,
OpenSpec is canonical and matching Engram state/artifacts are mirrored on
commits; both writes must succeed. Status prefers OpenSpec and can recover
missing state from the Engram mirror without merging conflicting artifact
content. Runtime seals live in `.odf/*.json`:

- `policy-gate-{change}.json` — Policy Gate result
- `validation-evidence-{change}.json` — stop-validation evidence seal
- `receipt-{change}.json` — failure disposition receipt

Legacy state/artifacts remain readable for migration, but old changes are never
rewritten automatically.

## Compatibility

Existing ODF users keep working:

- Absolute paths in old `odf-registry.json` entries still resolve.
- The plugin uses a native-shaped `toolCtx.task` when the host exposes it;
  otherwise the supported current fallback uses SDK child sessions. If neither is
  available, it returns a structured `blocked` envelope with
  `reason: task-api-unavailable` and never returns an executable fallback prompt.
- SDK child sessions receive the parent session, agent, known model, and validated
  workspace-relative context references. SDK transport cannot reproduce native
  task permission derivation, so native host permissions remain authoritative
  when available.
- Existing slash commands and persisted canonical workflow artifacts keep working
  across upgrades.

The legacy read path is gone. `odf_workflow_status` reports canonical state only:
it no longer emits `phase`, `artifacts`, `applyProgress`, `lastUpdated`, or a
`legacy_phase`, and the deprecated `odf_status` tool was removed in favor of
`odf_workflow_status`. States bound by an older release keep their
`route.legacy_phases` alias only for bind comparison; new states do not project
it. Changes that exist only as loose artifacts report `state_kind: none` and stay
non-resumable — artifacts alone are not a resumable workflow. Delegation tokens
must carry the current prepare/launch shape; legacy launch tokens are rejected
instead of silently upgraded.

## Quick Checks

```bash
# Validate the installed registry
node scripts/odf-registry-validate.js

# Run the full test suite
npm test

# Run only YAML scenarios
node scripts/odf-test-runner.js
```
