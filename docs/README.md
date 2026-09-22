# ODF Documentation Index

Everything about ODF (Odoo Development Framework), organized by audience.

## Start here

| Doc | Read if you… |
|-----|--------------|
| [Intended usage](intended-usage.md) | are new and want the mental model + entry points |
| [Architecture](architecture.md) | need the thin-spine vocabulary, components, and data flow |
| [Plugin reference](plugin.md) | are extending the plugin or calling `odf_delegate` |

## Diagrams (interactive HTML)

| Diagram | Shows |
|---------|-------|
| [Phase flow & agent routing](odf-agent-phase-flow.html) | full pipeline, fast routes, capability routing |
| [Harness architecture](harness-architecture.html) | operator → orchestrator → plugin → fleet → Odoo |
| [One-call delegation efficiency](delegation-flow.html) | ODF single round-trip vs naive context loop |

Sources: `*.workflow.json` / `*.spec.json` next to each HTML (Archify schema).

## Contracts

| Doc | Governs |
|-----|---------|
| [Design contract](design-contract.md) | closed-design rules before BUILD |
| [Expectations contract](expectations-contract.md) | human-owned Expectations, revisions |
| [Safety contract](safety-contract.md) | pre-tool safety, DB guardrails |
| [Judge shadow contract](judge-shadow-contract.md) | adversarial review shadow |
| [Learning loop contract](learning-loop-contract.md) | Engram learning loop |

## Style & conventions

| Doc | Covers |
|-----|--------|
| [Skill style guide](skill-style-guide.md) | writing LLM-first skills |
| [Metrics & Engram maintenance](metrics-and-engram-maintenance.md) | telemetry upkeep |

## Roadmaps & plans

| Doc | Status |
|-----|--------|
| [Harness roadmap](harness-roadmap.md) | long-range plan |
| [Fast-lane plan](odf-fast-lane-plan.md) / [tasks](odf-fast-lane-tasks.md) | fast-lane build |
| [Fast-lane baselines](odf-fast-lane-baseline-2026-09-16.md) | measured baselines |
