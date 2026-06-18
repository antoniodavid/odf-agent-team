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

1. **Cargar cambios activos** desde `openspec/changes/*/state.yaml` (y/o Engram `odf/*/state`).
2. Si hay nombre, renderizar **detalle del cambio** usando `renderStatusDetail(change, state)`.
3. Si no hay nombre, renderizar **tabla resumen** usando `renderStatusTable(states)`.
4. Incluir el comando sugerido para continuar cada cambio.

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

**Artefactos**:
- [x] assess
- [ ] qa-plan
- [ ] design
- [ ] implement
- [ ] verify

Continuar: /odf-continue sale-discount-field
```
