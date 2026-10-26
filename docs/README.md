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

## What changed in 1.6.2

| Area | Change |
|------|--------|
| Docs site | Every documentation link renders as a styled page with a grouped sidebar, in-page TOC, breadcrumbs, prev/next, reading time, search palette, 404, sitemap, and robots. |
| Generation | `npm run docs:build` renders 25 sources; `npm run docs:check` runs in CI and fails on stale output. |
| Privacy | No personal paths in shipped files: the installers rewrite any `/home/<user>/.config/opencode`, skill metadata uses the project handle, and the timesheet binary is rebuilt with `-trimpath`. |
| Guardrails | A privacy test fails the suite when a published file gains a home path, provider email, private key, token format, URL with credentials, or literal password. |

1.6.1 introduced `feature-inline` with its conditional ASSESS gate, the Context Manifest, decision-quality evaluation, `stop_disposition`, persisted `next_handoff`, and project-scoped activation. Full detail: [CHANGELOG.md](../CHANGELOG.md).

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
