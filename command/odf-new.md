---
description: "Start new Odoo feature/module with ODF workflow. Usage: /odf-new <name> [description] [--fast]"
triggers: ["/odf-new"]
agent: odoo_orchestrator
---

# /odf-new — Iniciar cambio ODF

Starts a new ODF change using the canonical flow `DECIDE -> optional PLAN -> BUILD -> VERIFY`.
Legacy mapping remains compatible: `DECIDE = PROPOSE + ASSESS`, `PLAN = QA-PLAN + DESIGN`,
and `BUILD = IMPLEMENT`.

## Uso

```
/odf-new <change-name> ["description"] [--fast]
```

## Parámetros

| Parámetro | Requerido | Tipo | Descripción |
|-----------|-----------|------|-------------|
| `change-name` | Sí | string | Identificador del cambio en kebab-case. Ej: `sale-discount-field` |
| `description` | No | string | Descripción corta entre comillas. Si se omite, se usa el nombre del cambio |
| `--fast` | No | flag | Salta puertas de aprobación intermedias hasta IMPLEMENT |

## Ejemplos

- `/odf-new sale-discount-field`
- `/odf-new sale-discount-field "Add configurable discount per partner category"`
- `/odf-new pos-custom-receipt --fast`

## Instrucciones para el orquestador

1. **Parsear argumentos**: extraer `change-name`, `description` opcional y flag `--fast`.
2. **Sanitizar** el nombre a kebab-case.
3. **Verificar cambio existente**: si `openspec/changes/{change}/state.yaml` ya existe y está activo, ofrecer `/odf-continue {change}` o pedir renombrar.
4. **Cargar configuración del proyecto** desde `odf-init/{project}` si existe.
5. **Ejecutar preflight gate**: si el preflight no está completo, preguntar los campos faltantes en español.
6. **Persistir preflight** en `openspec/changes/{change}/state.yaml` antes de delegar.
7. **Resolve the route** with `odf_workflow_route(work_type)` before selecting workflow depth.
8. **Run DECIDE** through the compatible `PROPOSE` and `ASSESS` adapters.
9. **Run optional PLAN**, then BUILD and VERIFY according to the resolved route.
10. If `--fast`, skip voluntary approval gates only where existing compatibility permits; never skip preflight, Policy Gate, validation evidence, VERIFY, or failure disposition.

For BUILD (`IMPLEMENT`) and VERIFY starts, pass the resolved `work_type` and exact transition input as `workflow_advance` inside `odf_delegate`. `odf_workflow_advance` is read-only advisory; delegate-side validation is authoritative. `work_type` is caller-supplied, not persisted by the delegate, and legacy compatibility calls may omit this field.

Standard configuration may stop after DECIDE with optional verification. Small changes may
use an inline plan before BUILD. Existing public phase commands and legacy phase IDs remain
available for compatibility; they have not disappeared.

## Contrato de enrutamiento

- Entrada: comando `/odf-new` con argumentos parseados.
- Salida: prompt conversacional para el orquestador con los campos:
  - `command: odf-new`
  - `change: <change-name>`
  - `description: <description>`
  - `fast: true|false`

## Manejo de errores

- **Falta `change-name`**: mostrar uso y abortar.
- **Nombre duplicado**: advertir y ofrecer continuar o renombrar.
- **Preflight inválido**: re-preguntar campos con valores permitidos.
- **Error de `odf_delegate`**: mostrar mensaje, mantener estado, ofrecer reintentar.

## Formato de salida

```
ODF: Iniciando cambio "{change-name}"

Fase: PROPOSE
Agente: odoo_functional_consultant
...

Evaluación completada:
  Estrategia: {standard | custom}
  Resumen: {executive_summary}

¿Querés ajustar algo o continuamos?
```
