---
description: "Show status of active ODF changes. Usage: /odf-status [change-name]"
---

# ODF: Show Status

Show all active ODF changes and their current phase.

## Parse Arguments

```
/odf-status              — Show all active changes
/odf-status sale-discount — Show detail for a specific change
```

## Orchestrator Instructions

1. Load active changes from `openspec/changes/*/state.yaml` (and/or Engram `odf/*/state`).
2. If a change name is provided, render single-change detail.
3. Otherwise render a summary table.

## Output (Multiple Changes)

```
ODF Status

  Active Changes:
  | Cambio              | Fase     | Siguiente | Versión | Estrategia |
  |---------------------|----------|-----------|---------|------------|
  | sale-discount-field | ASSESS   | design    | 18      | custom     |
  | pos-custom-receipt  | init     | preflight | 18      | pending    |

  Comandos:
    /odf-continue sale-discount-field  — Continuar implementación
    /odf-continue pos-custom-receipt   — Continuar a DESIGN
```

## Output (Single Change Detail)

```
ODF Status: sale-discount-field

  Cambio: sale-discount-field
  Versión Odoo: 18
  Estrategia: custom
  Fase actual: ASSESS
  Siguiente fase: design

  Artefactos:
    [x] assess
    [ ] qa-plan
    [ ] design
    [ ] implement
    [ ] verify

  Comandos:
    /odf-continue sale-discount-field  — Continuar a DESIGN
```
