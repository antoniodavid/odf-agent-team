---
description: "Flujo compuesto de bugfix: diagnose, BUILD y VERIFY. Uso: /odf-fix <name> [description]"
---

# ODF: Corregir bug

**Parse command:** `/odf-fix <fix-name> ["description"]`

Examples:
- `/odf-fix sale-tax-rounding` -- Iniciar diagnóstico
- `/odf-fix sale-tax-rounding "Tax rounding off by 1 cent on multi-line orders"` -- Contexto completo
- `/odf-fix stock-move-error "ValueError in stock.move when qty is zero"` -- Con mensaje de error

## Qué hace

Compone el flujo `diagnose -> BUILD -> VERIFY`. `FIX` es la entrada/adaptador de
diagnóstico y `BUILD` usa el adaptador legacy `IMPLEMENT`; no existe un bypass
válido mediante una tarea directa fuera del workflow.

## Instrucciones para el orquestador

1. **Comprobar configuración**: `mem_search("odf-init/{project-name}")` para comandos de test/lint.
2. **Analizar el nombre y la descripción** del fix desde los argumentos.
3. **Detectar la versión de Odoo** desde la configuración o `__manifest__.py`.
4. **Resolver** `odf_workflow_route("bugfix")` y delegar el diagnóstico mediante `odf_delegate` al agente adecuado:
   - Bug de backend → `odoo_backend_engineer`
   - Bug de frontend → `odoo_frontend_engineer`
   - Bug de integración → `odoo_api_integrator`
   - Bug de base de datos/rendimiento → `odoo_dba_devops`
   - Sin dominio claro → `odoo_backend_engineer` (predeterminado)
5. **Elegir el plan**: un bugfix pequeño y localizado puede usar un plan inline y continuar a `BUILD`. Si el diagnóstico revela un cambio arquitectónico, multi-file o de riesgo elevado, escalar a `DECIDE -> PLAN`; no continuar como tarea directa.
6. **Ejecutar BUILD** mediante `odf_delegate` con el adaptador legacy `IMPLEMENT`. Antes de cada lote, aplicar `odf_policy_gate`; cerrar solo con validation evidence verificada y actualizar `implement-progress`.
7. **Ejecutar VERIFY** mediante `odf_delegate`, conservando el frozen ref, el correction budget y la selección de riesgo/lentes.
8. **Mostrar resultados** al usuario, preservando receipt y garantías de verificación:

```
ODF: Fix completado — "{fix-name}"

  Diagnóstico: {root cause summary}
  Archivos modificados: {count}
  Tests: {pass/fail}
  Verificación: {pass/fail}

  Detalles guardados en Engram: odf/{fix-name}/fix-report
```

9. **Si se bloquea**: persistir o redescubrir el receipt con causa, evidencia y
   acción pendiente. Si el fix requiere arquitectura, mostrar:

```
ODF: Fix bloqueado — "{fix-name}"

  Este bug requiere cambios arquitectónicos más allá de un fix localizado.
  Recomendación: continuar con DECIDE/PLAN o ejecutar /odf-new {fix-name}.
```

## Detección implícita

El orquestador también dirige a este flujo cuando detecta lenguaje de bugfix:
- "Fix this bug..."
- "There's an error in..."
- "This is broken..."
- "Getting a traceback when..."
- "ValueError / TypeError / ValidationError in..."

En estos casos, generar automáticamente un fix-name a partir del contexto (por
ejemplo, "sale-validation-error") y proceder como si se hubiera llamado
`/odf-fix`.
