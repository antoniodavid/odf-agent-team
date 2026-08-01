---
description: "Continuar el flujo ODF desde la última etapa completada. Uso: /odf-continue [change-name]"
triggers: ["/odf-continue"]
agent: odoo_orchestrator
---

# /odf-continue — Continuar cambio ODF

Reanuda el flujo ODF desde la última etapa completada del cambio activo más reciente o de un cambio nombrado. La ruta canónica es `DECIDE -> optional PLAN -> BUILD -> VERIFY`; las fases legacy solo se leen mediante su adaptador.

## Uso

```
/odf-continue              — Reanuda el cambio activo más reciente
/odf-continue <change-name> — Reanuda un cambio específico
```

## Parámetros

| Parámetro | Requerido | Tipo | Descripción |
|-----------|-----------|------|-------------|
| `change-name` | No | string | Nombre del cambio a continuar. Si se omite, se usa el más reciente |

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
5. **Resolver la ruta** con `odf_workflow_route(work_type)` y usar sus etapas canónicas: `DECIDE -> optional PLAN -> BUILD -> VERIFY`.
6. **Leer estado y artefactos legacy mediante el adaptador**, sin reinterpretarlos como etapas nuevas:
   - `PROPOSE` + `ASSESS` → `DECIDE`
   - `QA-PLAN` + `DESIGN` → `PLAN`
   - `IMPLEMENT` → `BUILD`
   - `VERIFY` → `VERIFY`
7. **Redescubrir el receipt pendiente** en `<worktree>/.odf/receipt-{change}.json`. Si está `failed` o `blocked` con `action: null`, detenerse y volver a presentar su disposición con la evidencia.
8. **Seleccionar la primera etapa canónica pendiente**. No inventar una fase, no repetir trabajo ya completado y no relanzar un adaptador cuyo artefacto ya esté confirmado.
9. **Delegar** la siguiente etapa mediante `odf_delegate`; usar el adaptador legacy solo para ejecutar o leer contratos históricos.
10. **Mostrar la puerta de aprobación** después de la etapa cuando el modo de interacción la requiera.

## Contrato de enrutamiento

- Entrada: comando `/odf-continue` con nombre opcional.
- Salida: prompt conversacional con:
  - `command: odf-continue`
  - `change: <change-name|latest>`

## Manejo de errores

- **Cambio nombrado no activo**: listar activos y sugerir `/odf-new`.
- **Sin cambios activos**: informar y sugerir `/odf-new <nombre>`.
- **Error de `odf_delegate`**: mostrar mensaje, mantener estado, ofrecer reintentar.

## Formato de salida

```
ODF: Continuando "{change-name}"

Última etapa: {stage}
Siguiente etapa: {next-stage}
Agente: {agent}
...
```
