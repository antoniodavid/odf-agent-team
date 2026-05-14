---
description: "Start new Odoo feature/module with ODF workflow. Usage: /odf-new <name> [description]"
---

# ODF: Start New Change

**Parse command:** `/odf-new <change-name> ["description"]`

Examples:
- `/odf-new sale-discount-field` — Start with assessment
- `/odf-new sale-discount-field "Add configurable discount per partner category"` — Full context
- `/odf-new pos-custom-receipt --fast` — Skip approval gates until tasks ready

## What This Does

Triggers the ODF orchestrator to start a new change from Phase 1 (ASSESS).

## Orchestrator Instructions

1. **Check project config**: Search Engram for `odf-init/{project-name}`
   - If found: Use cached Odoo version, test runner, lint config from project config
   - If not found: Show "Tip: Run /odf-init first for better results." then fall back to manual detection
   - **Search past learnings**: `mem_search("odf-learned/{project-name}/")` — if relevant learnings found, include them in ASSESS prompt context
2. **Detect Odoo version** (if no project config): Check current project for `__manifest__.py` version field, or ask the user
3. **Persist initial state** to Engram:
   ```
   mem_save(
     title: "odf/{change-name}/state",
     topic_key: "odf/{change-name}/state",
     type: "architecture",
     content: "change: {name}\nphase: init\nodoo_version: {detected}\nstrategy: pending\nartifacts:\n  assess: false\n  design: false\n  implement: false\n  verify: false"
   )
   ```
3. **Launch ASSESS phase**: Read `/home/adruban/.config/opencode/skills/odf-assess/SKILL.md` and delegate to `odoo_functional_consultant` via Task tool
4. **Show assessment summary** to user (use `executive_summary` from ODF Result)
5. **GATE**: "Strategy: {standard|custom}. Proceed to DESIGN?"

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

Approve to continue to DESIGN? (or review details first)
```
