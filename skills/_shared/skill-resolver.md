# Skill Resolver — ODF Universal Protocol

Any agent that **delegates work to sub-agents** MUST follow this protocol to resolve and inject relevant skills. This applies to the ODF orchestrator, judgment-day, pr-review, and ANY future skill or workflow that launches sub-agents.

## Why This Exists

Sub-agents are born with NO context about what skills exist. Without skill injection, a backend engineer reviewing an accounting module won't know Argentine AFIP patterns, a fix agent won't follow project conventions, and a PR creator won't use the project's PR template.

## When to Apply

Before EVERY sub-agent launch that involves **reading, writing, or reviewing Odoo code**. Skip only for purely mechanical delegations (e.g., "run this test command").

## The Protocol

### Step 1: Obtain the ODF Registry (once per session)

The registry contains a **Compact Rules** section with pre-digested rules per skill (5-15 lines each). This is what you inject — NOT full SKILL.md paths.

Resolution order:
1. Already cached from earlier in this session? → use cache
2. Read `~/.config/opencode/odf-registry.json` → extract skills array
3. Fallback: `mem_search(query: "odf/registry/", project: "{project}")` → `mem_get_observation(id)` for each
4. No registry found? → proceed without skills (but warn the user: "No skill registry found — sub-agents will work without project-specific standards. Run `skill-registry` to fix this.")

### Step 2: Match Relevant Skills

Match skills on TWO dimensions:

**A. Code Context** — what files will the sub-agent touch or review?

Map file patterns to skills from the registry (common examples — always defer to the registry's Trigger field as the source of truth):
- `models/*.py`, `*.py` → python skills, model patterns
- `views/*.xml`, `data/*.xml` → xml view patterns
- `security/*.csv`, `ir.model.access` → security skills
- `static/src/**/*.js`, `*.xml` (OWL) → OWL/frontend skills
- `tests/*.py`, `test_` → testing skills
- `controllers/*.py` → API/controller skills
- `wizard/` → wizard patterns
- `report/` → report/QWeb patterns
- `__manifest__.py` → manifest/module skills

Use the `triggers` field in the registry to match. Skills whose triggers mention the relevant technology or file type are matches.

**B. Task Context** — what ACTIONS will the sub-agent perform?

| Sub-agent action | Match skills with triggers mentioning... |
|-----------------|------------------------------------------|
| Create a model/field | "model", "field", "inherit", "computed" |
| Write views | "view", "form", "tree", "kanban" |
| Add security | "security", "access", "rule", "group" |
| Write tests | "test", "TransactionCase", "coverage" |
| API/integration | "controller", "API", "webhook", "REST" |
| Migration | "migration", "upgrade", "OpenUpgrade" |
| Performance optimization | "performance", "N+1", "index", "compute" |

### Step 3: Inject into Sub-Agent Prompt

From the registry's **Compact Rules**, copy the matching skill blocks directly into the sub-agent's prompt:

```
## Project Standards (auto-resolved)

{paste compact rules blocks for each matching skill}
```

This goes BEFORE the sub-agent's task-specific instructions, so standards are loaded before work begins.

**Key rule**: inject the COMPACT RULES text, not paths. The sub-agent should NOT read any SKILL.md files — the rules arrive pre-digested in its prompt.

### Step 4: Include Project Conventions

If the registry has a **Project Conventions** section, and the sub-agent will work on the project's code, also add:

```
## Project Conventions
Read these files for project-specific patterns:
- {path1} — {notes}
- {path2} — {notes}
```

Project conventions are short references (paths + notes), so passing them is cheap. The sub-agent reads them only if relevant to its task.

## Token Budget

The compact rules section should add **50-150 tokens per skill** to a sub-agent's prompt. For a typical delegation matching 3-4 skills, that's ~400-600 tokens — negligible compared to the code the sub-agent will read.

If more than **5 skill blocks** match, keep only the 5 most relevant (prioritize code context matches over task context matches).

## Compaction Safety

This protocol is compaction-safe because:
- The registry lives in filesystem + Engram, not in the orchestrator's memory
- Each delegation re-reads the registry if needed (Step 1 handles cache miss)
- Compact rules are copied into each sub-agent's prompt at launch time — even if the orchestrator forgets, the sub-agents already have the rules

## Self-Discovery Protocol for Sub-Agents (MANDATORY)

Every ODF sub-agent MUST perform self-discovery at startup:

```
AT STARTUP:
1. Check if "## Project Standards (auto-resolved)" is already in your prompt
   ├── YES → Use those standards. Report: skill_resolution: injected
   └── NO  → Self-discover:
       ├── Read ~/.config/opencode/odf-registry.json → skills array
       ├── Match skills by:
       │   ├── Task context: what actions will you perform? (commit, model, test, etc.)
       │   └── File context: what files will you touch? (.py, views/, etc.)
       ├── Inject top 5 matching compact_rules blocks into your context
       └── Report: skill_resolution: self-discovered
```

**Why this matters**: The orchestrator may forget to inject skills after compaction,
or your specific task may need skills the orchestrator didn't anticipate
(e.g., you need `oca-commit-messages` but the orchestrator only injected model patterns).

### Self-Discovery Example

If tasked to create a commit in an OCA project:
```
Task: "Create a commit for the sale_order fix"
→ Skills matching "commit" in registry:
  - oca-governance-commit-messages (score: 2)
  - ...
→ Inject compact_rules from oca-governance-commit-messages
→ Follow OCA commit format: [FIX] sale_order: handle missing partner
```

## Feedback Loop

Sub-agents MUST report their skill resolution status in their return envelope:

- `injected` — received `## Project Standards (auto-resolved)` from the orchestrator (ideal path)
- `self-discovered` — no standards received, self-loaded from odf-registry.json
- `none` — no skills loaded at all

**Orchestrator self-correction rule**: if a sub-agent reports `self-discovered` or `none`, the orchestrator MUST:
1. Re-read the skill registry immediately (it may have been lost to compaction)
2. Ensure ALL subsequent delegations include `## Project Standards (auto-resolved)`
3. Log a warning to the user: "Skill cache miss detected — reloaded registry for future delegations."

This prevents silent degradation where the orchestrator forgets skills after compaction and all subsequent sub-agents work without standards.

## ODF-Specific Integration Points

- **ODF Orchestrator**: follows this protocol for ALL delegations (ASSESS, DESIGN, IMPLEMENT, VERIFY)
- **odoo_backend_engineer**: receives compact rules for ORM, views, security, testing based on task
- **odoo_frontend_engineer**: receives OWL, QWeb, JS patterns based on file context
- **odoo_qa_engineer**: receives test patterns, coverage rules based on module type
- **odoo_code_reviewer**: receives OCA compliance, version-specific rules based on target version
- **Any custom agent created via /odf-agent-new**: automatically registered in registry and included in matching

## How to Manually Maintain Compact Rules

When you create or update a skill, follow this format in `odf-registry.json`:

```json
{
  "name": "oca-python-style",
  "compact_rules": "- Import order: stdlib, third-party, odoo, odoo.addons\\n- Use _() for all user-facing strings\\n- No bare except clauses\\n- Max line length 88 chars"
}
```

Keep compact rules to **3-7 bullet points**. They should be actionable constraints, not explanations. The full SKILL.md contains the detailed reasoning.

## Example Execution

**Input:** Delegate to odoo_backend_engineer to add a computed field to sale.order

**Step 1:** Read registry → find skills matching `models/*.py` + "computed" + "field"

**Step 2:** Matches:
- `computed-field-patterns` (triggers: computed, depends, store)
- `field-type-reference` (triggers: field, char, float, selection)
- `oca-python-style` (triggers: .py, models/)

**Step 3:** Inject into prompt:
```
## Project Standards (auto-resolved)

### Computed Fields
- Use @api.depends with explicit field paths
- Set store=True if field is searched or grouped
- Use compute_sudo=True if computation needs elevated privileges
- Always handle empty recordsets (for record in self:)

### Field Types
- Use Monetary for currency amounts (not Float)
- Use Html for rich text, Text for long plain text
- Reference fields must have comodel_name or related

### Python Style
- Import order: stdlib, third-party, odoo, odoo.addons
- All strings user-facing: _()
- No bare except clauses
```

**Result:** The backend engineer receives these constraints BEFORE starting work, ensuring consistent output.
