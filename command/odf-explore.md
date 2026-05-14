---
description: "Deep investigation of Odoo codebase. Usage: /odf-explore <topic> [--version N]"
---

# ODF: Explore Topic

**Parse command:** `/odf-explore <topic> [--version {16|17|18|19}] [--module <name>]`

Examples:
- `/odf-explore "inventory valuation methods"` — Understand how Odoo handles costing
- `/odf-explore "tax calculation" --version 18` — Research tax engine in O18
- `/odf-explore "how discounts work" --module sale` — Focus on sales discounts
- `/odf-explore "payment terms" --version 17` — Compare with O18

## What This Does

Launches a deep investigation into the Odoo codebase to understand:
- How Odoo implements a feature
- Which modules are involved
- What patterns are used
- Whether standard Odoo covers the requirement
- Differences between versions

**This is NOT part of the formal ODF workflow.** Use this BEFORE `/odf-new` when you need to understand something before deciding what to build.

## Orchestrator Instructions

1. **Parse arguments:**
   - Topic (required)
   - Version (default: from project config or ask user)
   - Module (optional: focus search)

2. **Check project config:** `mem_search("odf-init/{project}")` for Odoo version

3. **Launch exploration:**
   - Read `/home/adruban/.config/opencode/skills/odf-explore/SKILL.md`
   - Delegate to appropriate agent based on topic:
     - Backend concepts → `odoo_backend_engineer`
     - Frontend concepts → `odoo_frontend_engineer`
     - Functional questions → `odoo_functional_consultant`
     - Integration/API → `odoo_api_integrator`

4. **Show results:**

```
ODF Exploration: "{topic}"

  Summary:
  {executive_summary}

  Key Modules:
  - {module1}: {purpose}
  - {module2}: {purpose}

  Standard Coverage: {Yes/No/Partial}
  
  Recommendation: {next action}

  Full exploration saved to: odf/explore/{topic-slug}
```

5. **Suggest next steps:**
   - If standard covers it → "No custom code needed. Configuration guide: ..."
   - If gap exists → "Run `/odf-new {suggested-name}` to implement"
   - If needs more research → "Explore related topic: ..."

## When to Use vs Skip

**Use when:**
- "How does Odoo handle X?"
- "I need to understand before deciding"
- "Which module should I extend?"
- "What changed between versions?"

**Skip when:**
- User knows exactly what they want → `/odf-new` directly
- Simple question → Answer directly or search
- Bug fix → `/odf-fix`

## Integration with Workflow

After exploration:
- `/odf-new` — Start formal change (if custom code needed)
- Configuration — If standard covers it
- Another exploration — If related topics need research
