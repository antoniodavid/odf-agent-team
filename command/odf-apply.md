---
description: "BUILD alias to implement ODF change tasks. Usage: /odf-apply [batch]"
---

# ODF: BUILD (alias /odf-apply)

`/odf-apply` is an alias of the canonical `BUILD` stage. It runs the legacy
`IMPLEMENT` adapter for one batch, but it does not silently skip preflight,
route resolution, or the required `PLAN`/`DESIGN`.

## Parse Arguments

```
/odf-apply              — Implement next batch of pending tasks
/odf-apply all          — Implement all remaining tasks
/odf-apply 1.1-1.3      — Implement specific tasks by ID
/odf-apply phase-2      — Implement all tasks in Phase 2
```

## Orchestrator Instructions

1. **Recover state and preflight** from OpenSpec `state.yaml`, Engram `odf/{change}/state`, or both in hybrid mode.
2. **Resolve the route** with `odf_workflow_route(work_type)`. The route must include `BUILD`; if the route decision is missing, stop and continue with `/odf-continue`.
3. **Verify the required PLAN**: read the canonical design/tasks or the legacy artifact `odf/{change}/design`. If it is incomplete, stop and suggest `/odf-continue`; do not bypass directly.
4. **Determine pending tasks** from the task breakdown, merging existing progress without overwriting it.
5. **Before each batch**, run `odf_policy_gate(change, phase="IMPLEMENT")`; its decision is authoritative.
6. **Delegate the batch** through `odf_delegate` using the legacy `IMPLEMENT` adapter for `BUILD`, passing the transition to `BUILD` under `workflow_advance`, an explicit `artifact_store: openspec|engram`, and a fresh opaque `attempt_id`; strict workflow is active by default and omitting those fields is blocked. Do not call `task()` directly.
7. **Select the agent** by task domain:
   - Python models, views, and security — `odoo_backend_engineer`
   - JS/OWL/QWeb components — `odoo_frontend_engineer`
   - API/webhook controllers — `odoo_api_integrator`
   - Multiple domains — run in parallel only if the tasks are independent
8. **Close the batch only with valid evidence**: the validation seal must be `validation.status === "verified"`; persist the batch evidence and update `odf/{change}/implement-progress` through merge, never overwrite. If it is missing or invalid, stop for correction.
9. **Show progress** after each batch and respect the approval/disposition of the active mode.

## Output

```
ODF: Implementing "{change-name}"

  Tasks: {completed}/{total}
  Batch: {current batch description}
  Agent: {agent used}

  [x] 1.1 Model sale.discount.rule created
  [x] 1.2 Configuration views created
  [ ] 1.3 Security rules (next batch)

   Evidence: validation verified; implement-progress merged
   Progress: 2/8 tasks completed. Continue with the next batch?
```
