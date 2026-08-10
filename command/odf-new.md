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
3. **Verificar cambio existente**: si el estado seleccionado (`openspec/changes/{change}/state.yaml` o `odf/{change}/state`) ya existe y está activo, ofrecer `/odf-continue {change}` o pedir renombrar.
4. **Cargar configuración del proyecto** desde `odf-init/{project}` si existe.
5. **Ejecutar preflight gate**: si el preflight no está completo, preguntar los campos faltantes en español.
6. **Persistir preflight** en el artifact store seleccionado antes de delegar.
7. **Resolve the route** with `odf_workflow_route(work_type)` before selecting workflow depth.
8. **Bind the route** with `odf_workflow_bind(change_name, work_type, artifact_store: openspec)` before the first phase when the existing OpenSpec `state.yaml` is available. For an Engram-only change, call it with `artifact_store: engram`; status may then use the persisted Engram state. Stop if the binding fails.
9. **Run DECIDE** through the compatible `PROPOSE` and `ASSESS` adapters.
10. **Run optional PLAN**, then BUILD and VERIFY according to the resolved route.
11. If `--fast`, skip voluntary approval gates only where existing compatibility permits; never skip preflight, Policy Gate, validation evidence, VERIFY, or failure disposition.

For BUILD (`IMPLEMENT`) and VERIFY starts, pass the persisted or explicitly resolved `work_type`, exact transition input as `workflow_advance`, explicit `artifact_store: openspec|engram`, and a fresh opaque `attempt_id` for each launch. Reusing an ID or relaunching a completed phase is blocked; an already committed desired state returns `already-committed` without relaunching. `odf_workflow_advance` is read-only and store-independent; the delegate re-reads, validates, and commits only the selected store before settling the attempt. Evidence or persistence failure leaves canonical state unchanged and blocks. For Engram-only changes, bind with `artifact_store: engram` and use the persisted Engram state; do not claim OpenSpec persistence. When no binding exists, keep forwarding the caller-resolved `work_type` on every gated delegation. Legacy calls that omit `workflow_advance` remain compatible and do not auto-commit.

For cross-domain BUILD, use `odf_parallel_delegate` instead of `odf_delegate`: pass one shared `change`, explicit `artifact_store`, `work_type: cross-domain`, `phase: IMPLEMENT`, and the exact shared `workflow_advance` proof that advances to `BUILD`. Provide 2-3 independent branches, each with a unique safe `branch_id`, fresh safe `attempt_id`, prompt, and non-overlapping `context_files`; the scheduler has a fixed concurrency cap of 3. Branches do not commit workflow state individually. BUILD closes only after the aggregate `join.status: complete`, every branch returns a successful delegated envelope, and every branch has `validation.status: verified`; then the selected store is committed once. Any blocked/failed branch or unverified validation blocks BUILD and produces one aggregate receipt. VERIFY always runs sequentially after a complete join.

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
