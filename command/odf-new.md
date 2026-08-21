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
| `--fast` | No | flag | Salta puertas de aprobación intermedias hasta IMPLEMENT. Elegir `execution_mode: auto` en el preflight hace las aprobaciones intermedias automáticas sin dejar de aplicar las puertas obligatorias |

## Ejemplos

- `/odf-new sale-discount-field`
- `/odf-new sale-discount-field "Add configurable discount per partner category"`
- `/odf-new pos-custom-receipt --fast`
- `/odf-new sale-discount-field "Add configurable discount per partner category"` — en el preflight responder `execution_mode: auto` para piloto automático

## Instrucciones para el orquestador

1. **Run `odf_health` first**: this MUST be the first ODF operation, before `question`, status/triage/route tools, Engram writes, artifact/state creation, or delegation. Continue only for `warning` with required checks present (or future `ok`). If the tool is missing, throws, returns malformed output, `failed`, or `blocked`, stop immediately with no later side effects.
2. **Parsear argumentos**: extraer `change-name`, `description` opcional y flag `--fast`.
3. **Sanitizar** el nombre a kebab-case.
4. **Verificar cambio existente** con `odf_workflow_status`: si `state_present: true` y el estado seleccionado está activo, ofrecer `/odf-continue {change}` o pedir renombrar. Expectations sin state no son un workflow activo ni resumable.
5. **Cargar configuración del proyecto** desde `odf-init/{project}` si existe.
6. **Ejecutar preflight gate**: si no está completo, preguntar los campos faltantes en español y validarlo, pero mantenerlo en memoria; no persistirlo todavía.
7. **Clasificar la entrada** con `odf_entry_triage`: pasar el `description` parseado y los campos opcionales disponibles (`module`, `domain`, `expected_files`, `expectations_clear`, `risk_signals`). Si `needs_question` es `true`, hacer UNA pregunta agrupada y re-ejecutar el triage. Usar su `work_type`; no elegirlo libremente. Migration/security/payment/public API/data-loss nunca son micro.
8. **Resolver Expectations**: leer primero el artefacto existente del mismo store. Si está aprobado, es válido y coincide exactamente con el contrato humano, reutilizar sus IDs y contenido sin preguntar, renumerar ni guardar de nuevo. Si difiere o está invalid/tampered, bloquear. Si no existe, destilar intent y Expectations del USUARIO (descripción + UNA aclaración), reformular `EXP-01…EXP-N` con `owned_by: "human"`, pedir confirmación explícita y mantener el documento aprobado en memoria.
9. **Resolve the route** with `odf_workflow_route(work_type)`.
10. **Start atomically through `odf_workflow_bind`**: pass `change_name`, `work_type`, the complete preflight, and the exact approved `expectations` document. Missing-state creation is accepted only under the runtime authorization issued for this exact `/odf-new` command/change after health; an ordinary bind cannot create state. Use `artifact_store: openspec` for OpenSpec or hybrid authority and `artifact_store: engram` for Engram-only. For `small-change`/`standard-config`, also pass `terminal_stage: DECIDE`; for all others bind before the first phase. The tool persists canonical state before Expectations. Never persist either artifact directly. Stop on any blocked/failure result.
11. **Run DECIDE** through `PROPOSE` and `ASSESS` only for non-micro routes. Micro routes use the terminal DECIDE materialized by the bind; `standard-config` ends there.
12. **Run optional PLAN**, then BUILD and VERIFY according to the resolved route. Do not reintroduce skipped legacy adapters.
13. If `--fast`, skip voluntary approval gates only where existing compatibility permits; never skip health, preflight, Expectations approval/reuse validation, Policy Gate, validation evidence, route-required VERIFY, or failure disposition. If `execution_mode` is `auto`, the voluntary approval gates are skipped automatically under the same rules as `--fast`, and the mandatory gates listed here still apply: health, preflight, Expectations approval/reuse validation, Policy Gate, validation evidence, route-required VERIFY, and failure disposition.

For BUILD (`IMPLEMENT`) and VERIFY starts, pass the persisted `work_type`, exact transition input as `workflow_advance`, explicit authoritative `artifact_store`, and a fresh opaque `attempt_id` for each launch. Reusing an ID or relaunching a completed phase is blocked; an already committed desired state returns `already-committed` without relaunching. `odf_workflow_advance` is read-only and store-independent; the delegate re-reads, validates, and commits only the selected store before settling the attempt. Evidence or persistence failure leaves canonical state unchanged and blocks. A `/odf-new` run without a persisted binding must stop; never forward an unbound caller default. Legacy calls that omit `workflow_advance` are blocked unless `flags.strict_workflow` is explicitly `false` (opt-out); they never auto-commit.

For cross-domain BUILD, use `odf_parallel_delegate` instead of `odf_delegate`: pass one shared `change`, explicit `artifact_store`, `work_type: cross-domain`, `phase: IMPLEMENT`, and the exact shared `workflow_advance` proof that advances to `BUILD`. Provide 2-3 independent branches, each with a unique safe `branch_id`, fresh safe `attempt_id`, prompt, and non-overlapping `context_files`; the scheduler has a fixed concurrency cap of 3. Branches do not commit workflow state individually. BUILD closes only after the aggregate `join.status: complete`, every branch returns a successful delegated envelope, and every branch has `validation.status: verified`; then the selected store is committed once. Any blocked/failed branch or unverified validation blocks BUILD and produces one aggregate receipt. VERIFY always runs sequentially after a complete join.

Standard configuration terminates after DECIDE and has no BUILD or VERIFY stage. Small changes
may use an inline plan before BUILD. Existing public phase commands and legacy phase IDs remain
available for compatibility; they have not disappeared.

## Contrato de enrutamiento

- Entrada: comando `/odf-new` con argumentos parseados.
- Salida: prompt conversacional para el orquestador con los campos:
  - `command: odf-new`
  - `change: <change-name>`
  - `description: <description>`
  - `fast: true|false`
- `work_type`: resultado determinista de `odf_entry_triage(description + campos opcionales)`; nunca se elige a criterio libre.

## Manejo de errores

- **Falta `change-name`**: mostrar uso y abortar.
- **Nombre duplicado**: advertir y ofrecer continuar o renombrar.
- **Preflight inválido**: re-preguntar campos con valores permitidos.
- **Error de `odf_delegate`**: mostrar mensaje, mantener estado, ofrecer reintentar.

## Formato de salida

```
ODF: Iniciando cambio "{change-name}"

Fase: PROPOSE
Agente: odoo_proposer
...

Evaluación completada:
  Estrategia: {standard | custom}
  Resumen: {executive_summary}

¿Querés ajustar algo o continuamos?
```
