---
description: "Lightweight bugfix flow. Diagnose, fix, verify — no gates. Usage: /odf-fix <name> [description]"
---

# ODF: Fix Bug

**Parse command:** `/odf-fix <fix-name> ["description"]`

Examples:
- `/odf-fix sale-tax-rounding` -- Start diagnosis
- `/odf-fix sale-tax-rounding "Tax rounding off by 1 cent on multi-line orders"` -- Full context
- `/odf-fix stock-move-error "ValueError in stock.move when qty is zero"` -- With error message

## What This Does

Triggers a lightweight 3-step bugfix flow: DIAGNOSE → FIX → VERIFY.
No approval gates between steps. Faster than the full ODF DAG.

## Orchestrator Instructions

1. **Check project config**: `mem_search("odf-init/{project-name}")` for test/lint commands
2. **Parse the fix name and description** from the command arguments
3. **Detect Odoo version** from project config or `__manifest__.py`
4. **Launch fix flow**: Read `/home/adruban/.config/opencode/skills/odf-fix/SKILL.md` and delegate to the appropriate sub-agent:
   - Backend bug → `odoo_backend_engineer`
   - Frontend bug → `odoo_frontend_engineer`
   - Integration bug → `odoo_api_integrator`
   - DB/performance bug → `odoo_dba_devops`
   - Unclear → `odoo_backend_engineer` (default, most common)
5. **Show results** to user (no gate — show final report directly):

```
ODF: Fix Complete — "{fix-name}"

  Diagnosis: {root cause summary}
  Files changed: {count}
  Tests: {pass/fail}
  Verification: {pass/fail}

  Details saved to Engram: odf/{fix-name}/fix-report
```

6. **If blocked**: The sub-agent returns `status: blocked` when the fix
   turns out to need architectural changes. Show:

```
ODF: Fix Blocked — "{fix-name}"

  This bug requires architectural changes beyond a simple fix.
  Recommendation: Run /odf-new {fix-name} to start a full ODF workflow.
```

## Implicit Detection

The orchestrator also routes to this flow when it detects bugfix language:
- "Fix this bug..."
- "There's an error in..."
- "This is broken..."
- "Getting a traceback when..."
- "ValueError / TypeError / ValidationError in..."

In these cases, auto-generate a fix-name from the context (e.g., "sale-validation-error")
and proceed as if `/odf-fix` was called.
