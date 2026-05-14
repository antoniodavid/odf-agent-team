---
description: "Implement tasks from current ODF change. Usage: /odf-apply [batch]"
---

# ODF: Implement Tasks

Jump directly to the IMPLEMENT phase. Requires DESIGN to be completed.

## Parse Arguments

```
/odf-apply              — Implement next batch of pending tasks
/odf-apply all          — Implement all remaining tasks
/odf-apply 1.1-1.3      — Implement specific tasks by ID
/odf-apply phase-2      — Implement all tasks in Phase 2
```

## Orchestrator Instructions

1. **Recover state** from Engram (`odf/{change}/state`)
2. **Verify DESIGN is complete** — if not, warn and suggest `/odf-continue`
3. **Load design artifact** from Engram (`odf/{change}/design`)
4. **Determine which tasks are pending** from the design's task breakdown
5. **Launch IMPLEMENT phase**: Read `/home/adruban/.config/opencode/skills/odf-implement/SKILL.md`
6. **Delegate to appropriate agent(s)** based on task domain:
   - Python models, views, security — `odoo_backend_engineer`
   - JS/OWL/QWeb components — `odoo_frontend_engineer`
   - API/webhook controllers — `odoo_api_integrator`
   - Multiple domains — launch in parallel if tasks are independent
7. **Show progress** after each batch
8. **Update state** in Engram

## Output

```
ODF: Implementing "{change-name}"

  Tasks: {completed}/{total}
  Batch: {current batch description}
  Agent: {agent used}

  [x] 1.1 Created model sale.discount.rule
  [x] 1.2 Added views for discount configuration
  [ ] 1.3 Security rules (next batch)

  Progress: 2/8 tasks complete. Continue with next batch?
```
