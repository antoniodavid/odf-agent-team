---
description: "Start new Odoo feature/module with ODF workflow. Usage: /odf-new <name> [description] [--fast]"
triggers: ["/odf-new"]
agent: odoo_orchestrator
---

# /odf-new — Iniciar cambio ODF

Inicia un nuevo cambio de desarrollo Odoo con el flujo de trabajo ODF completo (ASSESS → DESIGN → IMPLEMENT → VERIFY).

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
7. **Delegar ASSESS** vía `odf_delegate(phase=ASSESS, prompt, context_files)`.
8. **Mostrar puerta de aprobación** con resumen, estrategia y riesgos.
9. Si `--fast`, saltar puertas intermedias excepto la de IMPLEMENT.

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

Fase: ASSESS
Agente: odoo_functional_consultant
...

Evaluación completada:
  Estrategia: {standard | custom}
  Resumen: {executive_summary}

¿Querés ajustar algo o continuamos?
```
