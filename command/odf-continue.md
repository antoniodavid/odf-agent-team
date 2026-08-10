---
description: "Continuar el flujo ODF desde la última etapa completada. Uso: /odf-continue [change-name]"
triggers: ["/odf-continue"]
agent: odoo_orchestrator
---

# /odf-continue — Continuar cambio ODF

Reanuda el flujo ODF desde la última etapa completada del cambio activo más reciente o de un cambio nombrado. La ruta canónica es `DECIDE -> optional PLAN -> BUILD -> VERIFY`; las fases legacy solo se leen mediante su adaptador.

## Uso

```
/odf-continue                         — Reanuda el cambio activo más reciente
/odf-continue <change-name>           — Reanuda un cambio específico
/odf-continue <change-name> --work-type <type> — Recuperación explícita sin binding
```

## Parámetros

| Parámetro | Requerido | Tipo | Descripción |
|-----------|-----------|------|-------------|
| `change-name` | No | string | Nombre del cambio a continuar. Si se omite, se usa el más reciente |
| `--work-type` | No | canonical work type | Elección explícita requerida si el estado legacy no tiene binding |

## Ejemplos

- `/odf-continue`
- `/odf-continue sale-discount-field`

## Instrucciones para el orquestador

1. **Cargar cambios activos** desde `openspec/changes/*/state.yaml` (y/o Engram `odf/*/state`).
2. **Ordenar** por `last_updated` descendente.
3. **Seleccionar cambio**:
   - Si se proporciona nombre: cargar ese cambio; error si no está activo.
   - Si no hay nombre: elegir el más reciente.
   - Si hay varios activos y no hay nombre: listarlos y pedir al usuario.
4. **Verificar preflight**: si está incompleto, ejecutar el preflight gate primero.
5. **Consultar `odf_workflow_status`** y leer su `work_type`. Si existe un valor válido, usarlo como autoridad; nunca inferirlo desde `legacy_phase`, artefactos o `solution_strategy`.
6. Si no existe un binding persistido, exigir `--work-type <type>` antes de resolver la ruta o pasar cualquier puerta BUILD/VERIFY. Con un estado OpenSpec existente, llamar `odf_workflow_bind` con `artifact_store: openspec` para la recuperación explícita. Si el cambio es Engram-only, llamar `odf_workflow_bind` con `artifact_store: engram`; después `odf_workflow_status` puede redescubrir el `work_type` desde el estado persistido en Engram. Nunca afirmar persistencia OpenSpec para un cambio Engram-only. Sin binding ni elección explícita, fallar cerrado y detenerse.
7. **Resolver la ruta** con el work type persistido o explícitamente seleccionado mediante `odf_workflow_route(work_type)` y usar sus etapas canónicas: `DECIDE -> optional PLAN -> BUILD -> VERIFY`.
8. **Consultar `odf_workflow_status`** y usar `canonical_stage`, `pending_stage`, `resumable` y `receipt` como estado canónico; después despachar la siguiente etapa mediante el adaptador legacy, sin reinterpretar las fases históricas como etapas nuevas:
   - `PROPOSE` + `ASSESS` → `DECIDE`
   - `QA-PLAN` + `DESIGN` → `PLAN`
   - `IMPLEMENT` → `BUILD`
   - `VERIFY` → `VERIFY`
9. **Redescubrir el receipt pendiente** en `<worktree>/.odf/receipt-{change}.json` o mediante el estado adaptado. Si `receipt.state` es `pending`, detenerse y volver a presentar su disposición con la evidencia; nunca reanudar aunque el artefacto OpenSpec/Engram sugiera una etapa pendiente.
10. **Seleccionar la primera etapa canónica pendiente**. No inventar una fase, no repetir trabajo ya completado y no relanzar un adaptador cuyo artefacto ya esté confirmado.
11. **Delegar** la siguiente etapa mediante `odf_delegate`; usar el adaptador legacy solo para ejecutar o leer contratos históricos.
12. **Mostrar la puerta de aprobación** después de la etapa cuando el modo de interacción la requiera.

Para los inicios BUILD (`IMPLEMENT`) y VERIFY, incluir el `work_type` persistido o seleccionado explícitamente, la entrada de transición de `odf_workflow_advance` bajo `workflow_advance`, `artifact_store: openspec|engram` explícito y un `attempt_id` opaco y nuevo. Reutilizar un ID o relanzar una etapa completada se bloquea; un estado final ya comprometido devuelve `already-committed` sin relanzar. La herramienta independiente es consultiva y store-independent; el delegado re-lee, valida y compromete solo el store seleccionado antes de cerrar el intento. Un fallo de evidencia o persistencia no avanza el estado canónico. Nunca sustituir un valor predeterminado ni inferirlo del estado legacy. El binding debe recibir explícitamente `artifact_store: openspec` o `artifact_store: engram`; los callers Engram-only deben usar el estado persistido recuperado por status. Nunca afirmar persistencia OpenSpec para Engram-only. Las omisiones legacy de `workflow_advance` solo son compatibles cuando `flags.strict_workflow` es `false` (valor predeterminado), permanecen sin auto-commit; con `true`, se bloquean antes de delegar.

For a persisted `work_type: cross-domain` at BUILD, use `odf_parallel_delegate` instead of `odf_delegate`. Pass one shared `change`, explicit selected `artifact_store`, `phase: IMPLEMENT`, and the exact shared `workflow_advance` proof that advances to `BUILD`. Supply 2-3 independent branches with unique safe `branch_id` and fresh safe `attempt_id` values plus non-overlapping `context_files`; concurrency is fixed at 3. Branches never commit individually. A `parallel_join` with `join.status: running` exposes active branch statuses and running/completed/failed counts; do not close BUILD or relaunch those branches. Do not close BUILD unless the aggregate `join.status` is `complete`, every branch returned a successful delegated envelope, and every branch `validation.status` is `verified`; then commit the selected store once. A blocked/failed branch or unverified validation blocks BUILD and writes one aggregate receipt. After the complete join, run VERIFY sequentially.

For a cross-domain BUILD continuation, read the supplemental `.odf/parallel-join-{change}.json` evidence through `odf_workflow_status`. If its `join.status` is `running`, stop: active branches are visible, and `resume_from_join: true` must fail closed with `reason: parallel-join-running` rather than relaunching them. Otherwise call `odf_parallel_delegate` with `resume_from_join: true`, the exact `workflow_advance` proof, and no `branches` or conversation-derived prompts. Reuse every completed and verified branch without relaunching it. The scheduler creates fresh attempt IDs only for retryable or incomplete branches, keeps the original aggregate `join.expected` and completed count semantics, and permits one remaining retry branch only in this continuation path. A malformed, mismatched, oversized, or unsafe join blocks closed; fresh calls still require 2-3 branches.

## Contrato de enrutamiento

- Entrada: comando `/odf-continue` con nombre y `--work-type` opcionales.
- Salida: prompt conversacional con:
  - `command: odf-continue`
  - `change: <change-name|latest>`
  - `work_type: <canonical type>` solo cuando se proporciona recuperación explícita

## Manejo de errores

- **Cambio nombrado no activo**: listar activos y sugerir `/odf-new`.
- **Sin cambios activos**: informar y sugerir `/odf-new <nombre>`.
- **Error de `odf_delegate`**: mostrar mensaje, mantener estado, ofrecer reintentar.

## Formato de salida

```
ODF: Continuando "{change-name}"

Última etapa: {stage}
Siguiente etapa: {next-stage}
Etapa canónica: {canonical_stage}
Etapa canónica pendiente: {pending_stage}
Agente: {agent}
...
```
