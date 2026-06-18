---
description: "Start new Odoo feature/module with ODF workflow. Usage: /odf-new <name> [description] [--fast]"
---

# ODF: Start New Change

**Parse command:** `/odf-new <change-name> ["description"] [--fast]`

Examples:
- `/odf-new sale-discount-field` — Start with assessment
- `/odf-new sale-discount-field "Add configurable discount per partner category"` — Full context
- `/odf-new pos-custom-receipt --fast` — Skip approval gates until tasks ready

## What This Does

Triggers the ODF orchestrator (`odoo_orchestrator`) to start a new change from Phase 1 (ASSESS).
The orchestrator runs the preflight gate before delegating any phase.

## Orchestrator Instructions

1. **Parse arguments**: change-name, optional quoted description, optional `--fast`.
2. **Route to orchestrator**: delegate to `odoo_orchestrator` with command `odf-new` and parsed args.
3. The orchestrator will:
   - Check for an existing preflight record in `openspec/changes/{change}/state.yaml` (or Engram `odf/{change}/state`).
   - If missing or incomplete, run the preflight gate and persist answers.
   - Load project config from `odf-init/{project}` if available.
   - Launch **ASSESS** via `odf_delegate(phase=ASSESS, prompt, context_files)`.
   - Show the phase summary and ask for approval before continuing.
   - In `--fast` mode, skip intermediate approval gates but still pause before IMPLEMENT.

## Quick Mode (--fast)

If user appends `--fast`:
- Skip approval gates between ASSESS and DESIGN
- Auto-continue until tasks are ready
- Pause before IMPLEMENT for approval

## Output

```
ODF: Starting change "{change-name}"

Phase: ASSESS
  Delegating to: odoo_functional_consultant
  ...

Assessment Complete:
  Strategy: {standard | custom}
  Summary: {executive_summary from sub-agent}

¿Querés ajustar algo o continuamos?
```
