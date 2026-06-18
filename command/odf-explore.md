---
description: "Deep investigation of Odoo codebase. Usage: /odf-explore <topic> [--version N] [--module M]"
triggers: ["/odf-explore"]
agent: odoo_orchestrator
---

# /odf-explore — Explorar Odoo

Investigación profunda del código o funcionalidad de Odoo. **NO es parte del flujo formal ODF**; sirve para decidir si se necesita un cambio.

## Uso

```
/odf-explore <topic> [--version {16|17|18|19}] [--module <name>]
```

## Parámetros

| Parámetro | Requerido | Tipo | Descripción |
|-----------|-----------|------|-------------|
| `topic` | Sí | string | Tema a investigar. Puede ir entre comillas si tiene espacios |
| `--version` | No | number | Versión de Odoo. Default: versión del proyecto o preflight |
| `--module` | No | string | Módulo sobre el que enfocar la búsqueda |

## Ejemplos

- `/odf-explore "inventory valuation methods"`
- `/odf-explore "tax calculation" --version 18`
- `/odf-explore "how discounts work" --module sale`

## Instrucciones para el orquestador

1. **Parsear argumentos**: `topic`, `--version`, `--module`.
2. **Cargar configuración del proyecto** para obtener la versión por defecto.
3. **Seleccionar agente** por dominio del tema:
   - Conceptos backend → `odoo_backend_engineer`
   - Conceptos frontend → `odoo_frontend_engineer`
   - Preguntas funcionales → `odoo_functional_consultant`
   - Integración/API → `odoo_api_integrator`
   - Dominio no claro → `odoo_functional_consultant`
4. **Delegar exploración** vía `odf_delegate(phase=EXPLORE, prompt, context_files)`.
5. **Mostrar reporte** en español con:
   - Resumen de hallazgos
   - Módulos relevantes
   - Cobertura estándar: Sí / No / Parcial
   - Recomendación de siguiente paso
6. Si hay un gap, sugerir `/odf-new <nombre-sugerido>`.

## Contrato de enrutamiento

- Entrada: comando `/odf-explore` con argumentos parseados.
- Salida: prompt conversacional con:
  - `command: odf-explore`
  - `topic: <topic>`
  - `version: <version>`
  - `module: <module|null>`

## Manejo de errores

- **Falta `topic`**: mostrar uso.
- **Versión desconocida**: preguntar o usar la versión del proyecto.
- **Error de `odf_delegate`**: mostrar mensaje y ofrecer reintentar.

## Formato de salida

```
ODF Exploration: "{topic}"

Resumen:
{executive_summary}

Módulos relevantes:
- {module1}: {purpose}

Cobertura estándar: {Sí/No/Parcial}

Recomendación: {next action}
```
