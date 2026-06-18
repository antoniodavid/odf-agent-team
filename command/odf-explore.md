---
description: "Deep investigation of Odoo codebase. Usage: /odf-explore <topic> [--version N] [--module M]"
---

# ODF: Explore Topic

**Parse command:** `/odf-explore <topic> [--version {16|17|18|19}] [--module <name>]`

Examples:
- `/odf-explore "inventory valuation methods"` — Understand how Odoo handles costing
- `/odf-explore "tax calculation" --version 18` — Research tax engine in O18
- `/odf-explore "how discounts work" --module sale` — Focus on sales discounts

## What This Does

Launches a deep investigation into the Odoo codebase. **This is NOT part of the formal ODF workflow.**

## Orchestrator Instructions

1. **Parse arguments**: topic, optional `--version`, optional `--module`.
2. **Route to orchestrator**: delegate to `odoo_orchestrator` with command `odf-explore`.
3. The orchestrator will:
   - Load project config for the Odoo version if available.
   - Select the appropriate agent by topic domain.
   - Call `odf_delegate(phase=EXPLORE, prompt, context_files)`.
   - Show the exploration report and recommend `/odf-new` if a custom gap is found.

## Output

```
ODF Exploration: "{topic}"

  Summary:
  {executive_summary}

  Key Modules:
  - {module1}: {purpose}

  Standard Coverage: {Yes/No/Partial}

  Recommendation: {next action}
```
