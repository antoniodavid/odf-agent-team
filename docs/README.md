# ODF Docs

Everything about ODF — spec-driven Odoo delivery on OpenCode. Pick what you need:

| I want to… | Read |
|------------|------|
| **Start using ODF** — mental model, commands, workflow, stopping safely | [Intended usage](intended-usage.md) |
| **Understand the system** — stages, components, data flow | [Architecture](architecture.md) |
| **Check a route** — every work type, stage, artifact, and gate | [Route & stage contract](route-contract.md) |
| **Extend the plugin** — the 29 tools, `odf_delegate` path | [Plugin reference](plugin.md) |
| **Write a skill** — structure, frontmatter, compact rules, validation | [Skill style guide](skill-style-guide.md) |
| **Measure routing quality** — decision report, local reviews, cadence | [Decision evaluation](decision-evaluation.md) |

## What changed in 1.6.1

| Area | Change |
|------|--------|
| Routes | `feature-inline` is the default standard-feature route with a deterministic `skip` / `assess` / `escalate` gate. |
| Context | One bounded, reference-only Context Manifest is built at entry and forwarded unchanged to ASSESS and BUILD. |
| Delegation | Native children are bound to parent/agent/model/workspace, cancellation propagates, and expired tokens recover through `odf_delegation_late_seal_prepare`. |
| Stops | Every blocked/failed envelope names a `stop_disposition` with the only allowed recovery. |
| Status | Canonical only: the legacy projection, legacy state read path, and `odf_status` are gone; `odf_workflow_status` exposes a persisted `next_handoff`. |
| Skills | Agent Skills validation (`npm run validate:skills`) plus all 87 `compact_rules` regenerated. |
| Evaluation | Decision-quality report, local decision reviews, human/judge agreement, period comparison, cadence, and improvement proposals. |
| Activation | ODF is scoped to initialized projects (`.odf/project.json`) with an explicit reload requirement. |

Full detail: [CHANGELOG.md](../CHANGELOG.md).

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
| [Route & stage contract](route-contract.md) | work types, route matrix, stage/artifact/gate requirements |
| [Design contract](design-contract.md) | closed-design rules before BUILD |
| [Expectations contract](expectations-contract.md) | human-owned Expectations, revisions |
| [Context contract](context-contract.md) | bounded, reference-only Context Manifest |
| [Safety contract](safety-contract.md) | pre-tool safety, DB guardrails |
| [Judge shadow contract](judge-shadow-contract.md) | adversarial review shadow |
| [Learning loop contract](learning-loop-contract.md) | Engram learning loop |

## Operations

| Doc | Covers |
|-----|--------|
| [Metrics & Engram maintenance](metrics-and-engram-maintenance.md) | telemetry upkeep, evaluation commands |
| [Decision evaluation](decision-evaluation.md) | decision-quality report, local reviews, agreement, cadence, proposals |

## History

| Doc | Was |
|-----|-----|
| [Archive](archive/README.md) | completed roadmaps, fast-lane plans, baselines |
