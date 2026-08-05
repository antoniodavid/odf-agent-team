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
6. Si no existe un binding persistido, exigir `--work-type <type>` antes de resolver la ruta o pasar cualquier puerta BUILD/VERIFY. Con un estado OpenSpec existente, llamar `odf_workflow_bind` para la recuperación explícita. Si solo existe Engram o no existe `state.yaml`, `odf_workflow_bind` no aplica: continuar reenviando la elección explícita del caller, sin afirmar que quedó persistida en Engram. Sin binding ni elección explícita, fallar cerrado y detenerse.
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

For BUILD (`IMPLEMENT`) and VERIFY starts, embed the exact persisted or explicitly selected `work_type` and transition input from `odf_workflow_advance` under `workflow_advance` in `odf_delegate`, plus a fresh opaque `attempt_id`. Reusing an ID or relaunching a completed phase is blocked; after failure, retry only with a new explicit ID. The standalone tool is advisory; delegate-side validation is authoritative. Never substitute a default or infer from legacy state. The binding tool is OpenSpec-only; Engram-only callers must keep forwarding the explicit work type without claiming Engram persistence. Legacy calls that omit `workflow_advance` remain compatible.

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
