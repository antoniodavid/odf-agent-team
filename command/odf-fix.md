---
description: "Compound bugfix flow: diagnose, BUILD, and VERIFY. Usage: /odf-fix <name> [description]"
---

# ODF: Fix a bug

**Parse command:** `/odf-fix <fix-name> ["description"]`

Examples:
- `/odf-fix sale-tax-rounding` -- Start the diagnosis
- `/odf-fix sale-tax-rounding "Tax rounding off by 1 cent on multi-line orders"` -- Full context
- `/odf-fix stock-move-error "ValueError in stock.move when qty is zero"` -- With the error message

## What it does

Composes the `diagnose -> FIX -> BUILD -> VERIFY` flow. The diagnosis must bind
or create the `bugfix` state and call `odf_workflow_bind` with `terminal_stage: FIX`,
`root_cause`, and `regression` before BUILD. BUILD uses the legacy `IMPLEMENT`
adapter; there is no valid bypass through a direct task outside the workflow.

"No pauses" refers to human phase approvals: the mechanical gates
(`odf_policy_gate`, validation evidence, VERIFY, and risk escalation) remain
mandatory and run silently.

The flow runs in **supervised auto**: no voluntary questions and no per-phase
pauses; the human approves once at entry when intent/Expectations are missing,
then supervises. It stops only for a genuine product/scope decision, a
destructive operation that requires consent, or an unrecoverable failure after
the bounded automatic retry.

## Orchestrator instructions

1. **Check configuration**: `mem_search("odf-init/{project-name}")` for test/lint commands.
2. **Parse the fix name and description** from the arguments.
3. **Detect the Odoo version** from the configuration or `__manifest__.py`.
4. **Resolve** `odf_workflow_route("bugfix")`, bind the `bugfix` state, and delegate the diagnosis through `odf_delegate` to the right agent:
   - Backend bug → `odoo_backend_engineer`
   - Frontend bug → `odoo_frontend_engineer`
   - Integration bug → `odoo_api_integrator`
   - Database/performance bug → `odoo_dba_devops`
   - No clear domain → `odoo_backend_engineer` (default)
5. **Persist the terminal FIX**: require the root-cause analysis and a minimal regression; do not allow BUILD until `fix.yaml` and `completed_canonical_stages: [FIX]` are persisted. A missing state is only created by this bind; a BUILD without state is blocked and offers `/odf-continue <fix-name>`. If the diagnosis reveals an architectural change or elevated risk, escalate to `DECIDE -> PLAN` BEFORE editing; a bounded multi-file change (single root cause, ≤8 files, no schema/security/data-loss signals) continues in the same flow with an inline plan and records it in the result.
6. **Run BUILD** through `odf_delegate` with the legacy `IMPLEMENT` adapter, passing the `odf_workflow_route("bugfix")` transition under `workflow_advance`, an explicit `artifact_store: openspec|engram`, and a fresh opaque `attempt_id` per launch. Strict workflow is active by default; omitting those fields blocks before delegating. Before each batch, apply `odf_policy_gate`; close only with verified validation evidence and update `implement-progress`.
7. **Run VERIFY** through `odf_delegate` with the transition to `VERIFY` under `workflow_advance`, an explicit `artifact_store: openspec|engram`, and a fresh opaque `attempt_id`, preserving the frozen ref, the correction budget, and the risk/lens selection.
8. **Show results** to the user, preserving the receipt and verification guarantees:

```
ODF: Fix completed — "{fix-name}"

  Diagnosis: {root cause summary}
  Files changed: {count}
  Tests: {pass/fail}
  Verification: {pass/fail}

  Details saved in Engram: odf/{fix-name}/fix-report
```

9. **If blocked**: persist or rediscover the receipt with cause, evidence, and
   pending action. If the fix requires architecture, show:

```
ODF: Fix blocked — "{fix-name}"

  This bug requires architectural changes beyond a localized fix.
  Recommendation: continue with DECIDE/PLAN or run /odf-new {fix-name}.
```

## Implicit detection

The orchestrator also routes to this flow when it detects bugfix language:
- "Fix this bug..."
- "There's an error in..."
- "This is broken..."
- "Getting a traceback when..."
- "ValueError / TypeError / ValidationError in..."

In these cases, generate a fix-name automatically from the context (for
example, "sale-validation-error") and proceed as if `/odf-fix` had been called.
