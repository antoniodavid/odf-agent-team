---
description: "Continue ODF workflow from last completed phase. Usage: /odf-continue [change-name]"
triggers: ["/odf-continue"]
agent: odoo_orchestrator
---

# /odf-continue — Continuar cambio ODF

Reanuda el flujo de trabajo ODF desde la última fase completada del cambio activo más reciente o de un cambio nombrado.

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
5. **Determinar la siguiente fase** desde `state.artifacts`:
   - preflight incompleto → `preflight`
   - assess=false → `ASSESS`
   - design=false → `DESIGN`
   - implement=false → `IMPLEMENT`
   - verify=false → `VERIFY`
   - todos true → sugerir archivar
6. **Delegar la siguiente fase** vía `odf_delegate(phase, prompt, context_files)`.
7. **Mostrar puerta de aprobación** después de la fase.

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

Última fase: {phase}
Siguiente fase: {next-phase}
Agente: {agent}
...
```
