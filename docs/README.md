# ODF Docs

Everything about ODF (Odoo Development Framework). Pick what you need:

| I want to… | Read |
|------------|------|
| **Start using ODF** — mental model, commands, workflow | [Intended usage](intended-usage.md) |
| **Understand the system** — stages, components, data flow | [Architecture](architecture.md) |
| **Extend the plugin** — the 19 tools, `odf_delegate` path | [Plugin reference](plugin.md) |
| **Write a skill** — structure, frontmatter, compact rules | [Skill style guide](skill-style-guide.md) |

## Diagrams

Interactive, self-contained HTML (open locally or via [GitHub Pages](https://antoniodavid.github.io/odf-agent-team/)):

| Diagram | Shows |
|---------|-------|
| [Phase flow & agent routing](odf-agent-phase-flow.html) | full pipeline, fast routes, capability routing |
| [Harness architecture](harness-architecture.html) | operator → orchestrator → plugin → fleet → Odoo |
| [One-call delegation efficiency](delegation-flow.html) | ODF single round-trip vs naive context loop |

Sources next to each HTML: `*.workflow.json` / `*.spec.json` (Archify schema).

## Contracts

Normative rules enforced by the pipeline — agents and tests read these.

| Doc | Governs |
|-----|---------|
| [Design contract](design-contract.md) | closed-design rules before BUILD |
| [Expectations contract](expectations-contract.md) | human-owned Expectations, revisions |
| [Safety contract](safety-contract.md) | pre-tool safety, DB guardrails |
| [Judge shadow contract](judge-shadow-contract.md) | adversarial review shadow |
| [Learning loop contract](learning-loop-contract.md) | Engram learning loop |

## Operations

| Doc | Covers |
|-----|--------|
| [Metrics & Engram maintenance](metrics-and-engram-maintenance.md) | telemetry upkeep, evaluation commands |

## History

| Doc | Was |
|-----|-----|
| [Archive](archive/README.md) | completed roadmaps, fast-lane plans, baselines |
