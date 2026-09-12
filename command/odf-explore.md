---
description: "Deep investigation of Odoo codebase. Usage: /odf-explore <topic> [--version N] [--module M]"
triggers: ["/odf-explore"]
agent: odoo_orchestrator
---

# /odf-explore — Explore Odoo

Deep investigation of Odoo code or functionality. **It is NOT part of the formal ODF flow**; it serves to decide whether a change is needed.

## Usage

```
/odf-explore <topic> [--version {16|17|18|19}] [--module <name>]
```

## Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `topic` | Yes | string | Topic to investigate. It can be quoted if it has spaces |
| `--version` | No | number | Odoo version. Default: project version or preflight |
| `--module` | No | string | Module to focus the search on |

## Examples

- `/odf-explore "inventory valuation methods"`
- `/odf-explore "tax calculation" --version 18`
- `/odf-explore "how discounts work" --module sale`

## Orchestrator Instructions

1. **Parse arguments**: `topic`, `--version`, `--module`.
2. **Load project configuration** to get the default version.
3. **Select the agent** by topic domain:
   - Backend concepts → `odoo_backend_engineer`
   - Frontend concepts → `odoo_frontend_engineer`
   - Functional questions → `odoo_functional_consultant`
   - Integration/API → `odoo_api_integrator`
   - Unclear domain → `odoo_functional_consultant`
4. **Delegate the exploration** via `odf_delegate(phase=EXPLORE, prompt, context_files)`.
5. **Show the report** in English with:
   - Summary of findings
   - Relevant modules
   - Standard coverage: Yes / No / Partial
   - Recommended next step
6. If there is a gap, suggest `/odf-new <suggested-name>`.

## Routing Contract

- Input: `/odf-explore` command with parsed arguments.
- Output: conversational prompt with:
  - `command: odf-explore`
  - `topic: <topic>`
  - `version: <version>`
  - `module: <module|null>`

## Error Handling

- **Missing `topic`**: show usage.
- **Unknown version**: ask or use the project version.
- **`odf_delegate` error**: show the message and offer to retry.

## Output Format

```
ODF Exploration: "{topic}"

Summary:
{executive_summary}

Relevant modules:
- {module1}: {purpose}

Standard coverage: {Yes/No/Partial}

Recommendation: {next action}
```
