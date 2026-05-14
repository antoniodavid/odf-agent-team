---
name: odf-agent-builder
description: "Create custom Odoo sub-agents from natural language. Trigger: /odf-agent-new, 'create agent', 'new specialist', 'custom agent'."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## When to Use

Use when user describes a specialized Odoo domain expert (accounting, inventory, manufacturing) that should be a dedicated sub-agent. The builder generates SKILL.md + AGENT.md, installs to `skills/odoo_{name}/` and `agent/odoo_{name}.md`, and registers in the registry.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Check duplicates first | Search registry + Engram before generating. Ask user if similar exists. |
| Never overwrite without confirm | If agent name exists, ask before overwriting |
| Validate output | Generated SKILL.md + AGENT.md must have all required sections |
| Register in both places | odf-registry.json AND Engram |
| NotebookLM enrichment | Query official docs for the domain before generating |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Duplicate agent found with overlapping triggers | Ask user: "Create anyway?" |
| NotebookLM unavailable | Proceed without enrichment, flag warning |
| Generation timeout (120s) | Retry once with shorter prompt |
| Parsed output missing required sections | Show error, ask user to edit or regenerate |

## Execution Steps

1. **Parse input**: Extract Domain, Specific expertise, Trigger context, Target phase
2. **Check duplicates**: Search registry + Engram for overlapping triggers
3. **Enrich**: Query NotebookLM for the domain — extract models, fields, workflows, version diffs
4. **Compose prompt**: Build generation prompt with ODF context + NotebookLM data + required sections
5. **Generate**: `opencode run "{prompt}"` (120s timeout)
6. **Parse result**: Split on `---AGENT---` → SKILL.md + AGENT.md. Validate required sections.
7. **Preview**: Show user Name, Title, Description, Trigger, files to create
8. **Install**: On approval → write SKILL.md + AGENT.md → update registry.json → persist to Engram

## Output Contract

Return ODF Result envelope with: status (ok|warning|blocked|failed), executive_summary, artifacts_saved ({"name": "agent-{name}", ...}), next_recommended, risks, odoo_version, modules_affected.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/odf-registry.json` — Registry to update
