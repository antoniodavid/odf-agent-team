---
description: "Show status of active ODF changes. Usage: /odf-status [change-name]"
triggers: ["/odf-status"]
agent: odoo_orchestrator
---

# /odf-status — Estado de cambios ODF

Muestra todos los cambios ODF activos o el detalle de un cambio específico.

## Uso

```
/odf-status              — Muestra todos los cambios activos
/odf-status <change-name> — Muestra detalle de un cambio
```

## Parámetros

| Parámetro | Requerido | Tipo | Descripción |
|-----------|-----------|------|-------------|
| `change-name` | No | string | Nombre del cambio a mostrar en detalle |

## Ejemplos

- `/odf-status`
- `/odf-status sale-discount-field`

## Instrucciones para el orquestador

1. **Consultar `odf_workflow_status` en modo read-only**. Para un cambio nombrado, lee primero `openspec/changes/{change}/state.yaml` y sus artefactos; Engram completa grupos ausentes y conserva los conflictos como warnings.
2. Si no existe un `state.yaml` OpenSpec válido, usar Engram como fallback, mostrar `source.state: engram` y su advertencia, sin presentarlo como autoridad OpenSpec. Sin nombre, conservar la selección Engram existente y consultar OpenSpec solo para ese cambio seleccionado.
3. Si hay nombre, renderizar **detalle del cambio** usando `renderStatusDetail(change, state)`.
4. Si no hay nombre, renderizar **tabla resumen** usando `renderStatusTable(states)`.
5. Incluir el comando sugerido para continuar cada cambio.

## Campos canónicos

En el detalle, mostrar estos campos además de los legacy (`phase`, `artifacts`, `applyProgress`, `lastUpdated`):

- `canonical_stage`
- `legacy_phase`
- `completed_canonical_stages`
- `pending_stage`
- `progress` (`completed`, `total`, `known`, `source`)
- `artifact_refs`
- `receipt` (`state`, `status`, `action`, `ref`)
- `resumable`
- `source` (`state`, `artifacts`)
- `warnings`

OpenSpec es la autoridad de estado y de los artefactos canónicos cuando está disponible. El comando no escribe `state.yaml`, artefactos ni receipts.

## Contrato de enrutamiento

- Entrada: comando `/odf-status` con nombre opcional.
- Salida: estado renderizado en español.

## Manejo de errores

- **Sin cambios activos**: mostrar mensaje vacío y sugerir `/odf-new`.
- **Cambio no encontrado**: listar activos.
- **Fallo al leer estado**: mostrar error y sugerir `/odf-init`.

## Formato de salida (tabla)

```
ODF Status

| Cambio              | Fase     | Siguiente | Versión | Estrategia |
|---------------------|----------|-----------|---------|------------|
| sale-discount-field | ASSESS   | design    | 18      | custom     |
| pos-custom-receipt  | init     | preflight | 18      | pending    |

Comandos:
  /odf-continue sale-discount-field  — Continuar implementación
  /odf-continue pos-custom-receipt   — Continuar a DESIGN
```

## Formato de salida (detalle)

```
## Estado ODF: sale-discount-field

- **Cambio**: sale-discount-field
- **Versión Odoo**: 18
- **Estrategia**: custom
- **Fase actual**: ASSESS
- **Siguiente fase**: design
- **Etapa canónica**: DECIDE
- **Etapa canónica pendiente**: PLAN
- **Etapas canónicas completadas**: DECIDE
- **Progreso**: 0/0 (desconocido; source: null)
- **Refs de artefactos**: DECIDE=[odf/sale-discount-field/assess]
- **Receipt**: none (resumable: true)
- **Fuente**: engram
- **Warnings**: []

**Artefactos**:
- [x] assess
- [ ] qa-plan
- [ ] design
- [ ] implement
- [ ] verify

Continuar: /odf-continue sale-discount-field
```
