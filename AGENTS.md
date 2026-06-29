# ODF Agent Team — AGENTS.md

This repo is **the source for the ODF Agent Team**, an OpenCode skill/agent pack for
structured Odoo development. It is **not** an Odoo project itself. It installs into `~/.config/opencode/` via `install.sh` and is used from Odoo worktrees.

---

## ODF Overview — What It Does

ODF (Odoo Development Framework) is a spec-driven pipeline for building Odoo modules:

```
init → preflight → assess → qa-plan → design → implement → verify → archived
```

Each phase is a sub-agent with a defined input/output contract. The orchestrator never writes code — it delegates everything, tracks state, and gates progression.

### What you can do

| Command | Purpose |
|---------|---------|
| `/odf-new <name>` | Start a new change: preflight → full pipeline |
| `/odf-continue [name]` | Resume a change from its last completed phase |
| `/odf-status [name]` | Show change state, artifacts, task progress |
| `/odf-explore <topic>` | Investigate Odoo patterns before committing to a change |
| `/odf-fix <description>` | Lightweight 3-step bugfix: diagnose → fix → verify |
| `/odf-agent-new <description>` | Create custom Odoo sub-agents from natural language |
| `/odf-profile switch` | Toggle between `default` (r1 for ASSESS/VERIFY, kimi for others) and `cheap` (kimi for all) |
| `/odf-registry-refresh` | Pick up skill/agent changes after install |
| `/odf-tdd on/off` | Toggle strict test-before-code enforcement |
| `/odf-health` | Verify installation and project detection |

### Pipeline phases

| Phase | Agent | Output | Gate |
|-------|-------|--------|------|
| **ASSESS** | `odoo_functional_consultant` | Strategy (standard vs custom) + functional spec | `question` tool — proceed/adjust/cancel |
| **QA-PLAN** | `odoo_qa_engineer` | Test plan, scenarios, coverage targets | `question` tool — approve/adjust |
| **DESIGN** | `odoo_backend_engineer` / `odoo_frontend_engineer` | Technical design + tasks | `question` tool — approve & implement |
| **IMPLEMENT** | Agent by task domain | Code + tests, in batches | `question` tool — continue/adjust |
| **VERIFY** | `odoo_qa_engineer` | Test run, lint, spec compliance | PASS or FAIL |
| **ARCHIVED** | (auto) | Retrospective saved to Engram | — |

---

## Architecture

```
                   ┌──────────────────────┐
                   │   odoo_orchestrator   │  ← NEVER writes code, only delegates
                   │   (AGENT)             │
                   └──────┬───────┬───────┘
                          │       │
              ┌───────────┘       └───────────┐
              ▼                               ▼
   ┌──────────────────────┐       ┌──────────────────────┐
   │   odf-delegation.ts  │       │   12 sub-agents       │
   │   (PLUGIN)           │──────▶│   (via task())        │
   │                      │       │                       │
   │   Registry cache     │       │  odoo_backend_engineer │
   │   Profile resolution │       │  odoo_frontend_enginee │
   │   Skill injection    │       │  odoo_qa_engineer      │
   │   Status resolver    │       │  odoo_functional_con.  │
   │   Community tools    │       │  odoo_code_reviewer    │
   └──────────────────────┘       │  odoo_api_integrator   │
                                  │  odoo_context_gatherer │
                                  │  odoo_skill_finder     │
                                  │  odoo_dba_devops       │
                                  │  odoo_stock_lot_spec.  │
                                  │  odoo_upgrade_migrator │
                                  └──────────────────────┘
```

### Plugin tools (`odf-delegation.ts`)

10 tools injected at runtime into the orchestrator's tool list:

| Tool | Purpose |
|------|---------|
| `odf_delegate` | Route phase + prompt to the right sub-agent with skill injection |
| `odf_skill_inject` | Match and inject relevant skill compact rules into a prompt |
| `odf_skill_resolve` | Preview which skills match a task WITHOUT executing |
| `odf_registry_read` | Read and cache `odf-registry.json` with TTL and file watcher |
| `odf_profile_select` | Preview which model profile applies to a phase |
| `odf_notebooklm_lookup` | Search NotebookLM notebooks for reference material |
| `odf_community_tool_detect` | Check if a community tool (e.g., CodeGraph) is available |
| `odf_community_tool_install` | Install and wire a community tool |
| `odf_status` | Resolve ODF change status from Engram observations |

### Skills system

31 skills covering:

- **OCA governance**: PR workflow, maturity levels, commit messages, contribution guidelines
- **OCA style**: Python, XML, JavaScript/CSS standards
- **Odoo patterns**: field types, computed fields, inheritance, constraints, domains, onchange, context/env, security, data migration, API integration, migration guides, debug patterns
- **ODF phases**: assess, design, implement, verify, fix, TDD, QA, exploration, agent builder, chained PR
- **Shared conventions**: Engram persistence, result contract, skill resolver, Odoo source paths
- **ODF onboarding**: guided walkthrough of the full pipeline on a real codebase

Max 5 skills per delegation via compact rules.

### Model profiles

| Profile | ASSESS | VERIFY | Other phases |
|---------|--------|--------|--------------|
| `default` | deepseek-r1 | deepseek-r1 | kimi-k2.6 |
| `cheap` | kimi-k2.6 | kimi-k2.6 | kimi-k2.6 |

Profiles apply ONLY to SDD pipeline phases. General queries and non-SDD tasks use the default runtime model.

### Community tools

ODF can install and detect optional tools:

- **CodeGraph** (`npm install -g @colbymchenry/codegraph`): SQLite knowledge graph for structural queries — one round-trip instead of grep + Read loops. Install with `--with-codegraph` flag or via `odf_community_tool_install`.

### Persistence

Two backends:

- **Engram** (default, always-on): `odf/{change}/{artifact-type}` topic keys. State flows through Engram, never inferred from conversation.
- **OpenSpec** (optional, file-based): `openspec/changes/{change}/` files for team sharing.

Configurable via preflight `artifact_store` field (engram | openspec | hybrid).

### Preflight gate

9 fields required before any phase runs:

- `change` (kebab-case name)
- `execution_mode` (interactive | batch)
- `artifact_store` (engram | openspec | hybrid)
- `delivery_strategy` (ask-always | ask-on-risk | auto-chain | single-pr)
- `review_budget_lines` (100-5000)
- `odoo_version` (16 | 17 | 18 | 19)
- `tdd_mode` (true | false)
- `solution_strategy` (standard | custom | pending)
- `chain_strategy` (none | chained | feature-branch)

Missing fields are collected via `question` tool.

### Orchestrator safety checks (gentle-ai inspired)

- **Sub-agent launch deduplication**: same (phase, fingerprint) never launched twice
- **Fresh review rule**: adversarial review gets a fresh context for independent judgment
- **Incident rule**: after state corruption, stop and audit before continuing
- **Long-session rule**: after ~20 tool calls or 5 file reads without delegation, delegate instead of accumulating context
- **Apply-progress continuity**: continuation batches merge with existing progress, never overwrite
- **Model routing scope**: profiles only apply to SDD pipeline phases, not general queries

---

## Key structure

```
agent/              — 12 agent instructions (orchestrator + 11 sub-agents)
command/            — 21 slash command definitions (Markdown)
plugins/            — odf-delegation.ts (OpenCode plugin)
scripts/            — test runner (118 tests), CLI wrapper, registry validator
skills/             — 31 skills (OCA governance, ODF phases, patterns)
  _shared/          — conventions (engram persistence, skill-resolver, Odoo sources)
  oca/              — OCA governance, style, patterns
  odf-{phase}/      — phase-specific skills (assess, design, implement, etc.)
openspec/           — SDD change artifacts (when artifact_store=openspec)
docs/               — intended-usage, architecture, skill-style-guide
install.sh          — idempotent installer (backup, --dry-run, --force)
odf-registry.json   — SINGLE SOURCE OF TRUTH (31 skills, 12 agents, 2 profiles, community tools)
```

## Quick start

```bash
# From an Odoo worktree:
curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/main/install.sh | bash
# Or with CodeGraph:
curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/main/install.sh | bash -s -- --with-codegraph

# Then inside OpenCode:
/odf-init           # Detect project context
/odf-new my-feature # Start first change
```

## ODF vs SDD

ODF is a superset of the generic SDD workflow:

| Aspect | SDD (gentle-ai) | ODF |
|--------|-----------------|-----|
| Phases | propose → spec → design → tasks → apply → verify | assess → qa-plan → design → implement → verify |
| Domain | Generic | Odoo-specific |
| Sub-agents | 7 generic agents | 11 specialized Odoo agents (backend, frontend, QA, DBA, etc.) |
| Skills | Code style, commit conventions | OCA governance, Odoo patterns, migration guides |
| Profile system | No | Yes (default/cheap profiles per phase) |
| Community tools | CodeGraph | CodeGraph + extensible via plugin tools |
| Persistence | Engram default | Engram always-on + optional OpenSpec |

## Tests

```bash
npm test              # 118 tests: YAML scenarios + Vitest plugin tests
npm run test:yaml     # YAML scenario runner only
npm run test:unit     # Vitest only
npm run typecheck     # tsc --noEmit
node scripts/odf-registry-validate.js   # validates all registered paths exist
```

**Critical quirk**: the test runner reads the registry from the **installed** location (`~/.config/opencode/odf-registry.json`), NOT from this repo. Set `ODF_CONFIG_DIR=/path/to/repo` to validate against the repo copy.

## Registry lifecycle

1. Update skills/agents/commands in this repo
2. Run `node scripts/odf-registry-validate.js` (with `ODF_CONFIG_DIR` set to repo root) to catch broken paths
3. Publish → install into `~/.config/opencode/` → run `/odf-registry-refresh` from inside an Odoo project

## Gotchas

- `openspec/config.yaml` has `testing.strict_tdd: false` — correct; this repo uses YAML scenarios + Vitest, not a traditional coverage suite
- `scripts/odf-cli.js` is a minimal parser that emits orchestrator routing envelopes, NOT the orchestrator itself
- Plugin tools are injected at runtime into the model's tool list — they are NOT MCP tools
- After modifying an agent or skill file, run `/odf-registry-refresh` from inside an Odoo project to pick up changes
