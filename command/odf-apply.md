---
description: "Alias de BUILD para implementar tareas del cambio ODF. Uso: /odf-apply [batch]"
---

# ODF: BUILD (alias /odf-apply)

`/odf-apply` es un alias de la etapa canónica `BUILD`. Ejecuta el adaptador
legacy `IMPLEMENT` para un lote, pero no salta silenciosamente preflight,
decisión de ruta ni el `PLAN`/`DESIGN` requerido.

## Parse Arguments

```
/odf-apply              — Implement next batch of pending tasks
/odf-apply all          — Implement all remaining tasks
/odf-apply 1.1-1.3      — Implement specific tasks by ID
/odf-apply phase-2      — Implement all tasks in Phase 2
```

## Orchestrator Instructions

1. **Recuperar estado y preflight** desde OpenSpec `state.yaml`, Engram `odf/{change}/state`, o ambos en modo híbrido.
2. **Resolver la ruta** con `odf_workflow_route(work_type)`. La ruta debe incluir `BUILD`; si falta la decisión de ruta, detenerse y continuar con `/odf-continue`.
3. **Verificar el PLAN requerido**: leer el diseño/tareas canónicas o el artefacto legacy `odf/{change}/design`. Si no está completo, detenerse y sugerir `/odf-continue`; no hacer bypass directo.
4. **Determinar las tareas pendientes** desde el desglose de tareas, fusionando el progreso existente sin sobrescribirlo.
5. **Antes de cada lote**, ejecutar `odf_policy_gate(change, phase="IMPLEMENT")`; su decisión es autoritativa.
6. **Delegar el lote** mediante `odf_delegate` usando el adaptador legacy `IMPLEMENT` para `BUILD`. No llamar `task()` directamente.
7. **Seleccionar el agente** según el dominio de la tarea:
   - Modelos Python, vistas y seguridad — `odoo_backend_engineer`
   - Componentes JS/OWL/QWeb — `odoo_frontend_engineer`
   - Controladores API/webhook — `odoo_api_integrator`
   - Múltiples dominios — ejecutar en paralelo solo si las tareas son independientes
8. **Cerrar el lote solo con evidencia válida**: la validation seal debe ser `validation.status === "verified"`; persistir la evidencia del lote y actualizar `odf/{change}/implement-progress` mediante merge, nunca overwrite. Si falta o es inválida, detenerse para corrección.
9. **Mostrar progreso** después de cada lote y respetar la aprobación/disposición del modo activo.

## Output

```
ODF: Implementando "{change-name}"

  Tareas: {completed}/{total}
  Lote: {current batch description}
  Agente: {agent used}

  [x] 1.1 Modelo sale.discount.rule creado
  [x] 1.2 Vistas de configuración creadas
  [ ] 1.3 Reglas de seguridad (siguiente lote)

   Evidencia: validation verificada; implement-progress fusionado
   Progreso: 2/8 tareas completadas. ¿Continuar con el siguiente lote?
```
