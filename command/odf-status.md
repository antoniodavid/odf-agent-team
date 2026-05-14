---
description: "Show status of active ODF changes. Usage: /odf-status"
---

# ODF: Show Status

Show all active ODF changes and their current phase.

## Parse Arguments

```
/odf-status              — Show all active changes
/odf-status sale-discount — Show detail for a specific change
```

## Orchestrator Instructions

1. `mem_search(query: "odf/", project: "{current}")` — find all ODF artifacts
2. Filter for `state` artifacts to find active changes
3. For each change, parse the state YAML to determine:
   - Current phase (last completed)
   - Next phase (what's ready to run)
   - Task progress (if in IMPLEMENT phase)
   - Odoo version and module name
4. Display summary table

## Output (Multiple Changes)

```
ODF Status

  Active Changes:
  | Change              | Phase     | Tasks    | Version | Module              |
  |---------------------|-----------|----------|---------|---------------------|
  | sale-discount-field  | IMPLEMENT | 3/8 done | 18.0    | sale_discount_cat   |
  | pos-custom-receipt   | ASSESS    | --       | 18.0    | pos_custom_receipt  |

  Commands:
    /odf-continue sale-discount-field  — Resume implementation
    /odf-apply sale-discount-field     — Implement next batch
    /odf-verify sale-discount-field    — Run verification
    /odf-continue pos-custom-receipt   — Continue to DESIGN
```

## Output (Single Change Detail)

```
ODF Status: sale-discount-field

  Module: sale_discount_category
  Version: 18.0
  Strategy: custom

  Phase Progress:
    [x] ASSESS  — Custom strategy, 3 requirements identified
    [x] DESIGN  — 2 models, 3 views, 8 tasks in 3 phases
    [~] IMPLEMENT — 3/8 tasks complete (Phase 1 done, Phase 2 in progress)
    [ ] VERIFY  — Not started

  Pending Tasks:
    - [ ] 2.1 Create form and tree views for sale.discount.rule
    - [ ] 2.2 Add menu item under Sales > Configuration
    - [ ] 2.3 Inherit sale.order form to show discount field
    - [ ] 2.4 Add onchange/compute logic for automatic discount
    - [ ] 3.1 Write test: discount rule applies correctly

  Commands:
    /odf-apply           — Implement next batch (Phase 2)
    /odf-apply all       — Implement all remaining tasks
    /odf-verify          — Run verification (when ready)
```
