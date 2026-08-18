---
description: "Ejecutar lentes QA para un cambio ODF. Uso: /odf-qa <change-name> [--plan|--review|--coverage|--report]"
---

# ODF: QA (utilidad y lente)

QA es una utilidad/lente del workflow, no una etapa canónica del DAG. Puede
producir intención de pruebas para `PLAN`, evidencia de revisión por lote para
`BUILD` o agregación de cobertura para `VERIFY`, según la ruta, el riesgo y el
tipo de trabajo.

## Parsear comando

```
/odf-qa <change-name>              — Run full QA suite (all activities)
/odf-qa <change-name> --plan      — Generate test plan (after ASSESS)
/odf-qa <change-name> --review     — Review tests (during/after IMPLEMENT)
/odf-qa <change-name> --coverage  — Run coverage analysis
/odf-qa <change-name> --report    — Generate final QA report
```

## Opciones

| Option | Description | When to Use |
|--------|-------------|-------------|
| (none) | Lentes QA aplicables | Ejecuta la cobertura QA seleccionada por ruta/riesgo/tipo de trabajo |
| `--plan` | Intención de pruebas | Dentro de `PLAN`, después de `DECIDE` cuando aplica |
| `--review` | Evidencia de revisión de tests | Dentro de `BUILD`, por lote de implementación |
| `--coverage` | Agregación de cobertura | Dentro de `VERIFY` o como lectura previa |
| `--report` | Informe QA auxiliar | Durante o después de `VERIFY`, cuando se solicite |

## Instrucciones para el orquestador

### 1. Detectar la lente QA

Usar el flag explícito si existe. Sin flag, consultar `odf_workflow_route`, el
riesgo y el tipo de trabajo para seleccionar solo las lentes aplicables. No
crear una etapa `QA` ni hacer obligatorios `QA-REVIEW` o `QA-AGGREGATE` antes de
`VERIFY`.

```
--plan      → PLAN: test intent; legacy artifact qa-plan
--review    → BUILD: batch review evidence; legacy artifact qa-review
--coverage  → VERIFY: coverage aggregation; legacy artifact qa-aggregate
--report    → QA report utility; legacy artifact qa-report
```

### 2. Comprobar configuración del proyecto

```
mem_search("odf-init/{project}") → project config
Usar para:
   - Plantilla del comando de tests
   - Configuración de la herramienta de cobertura
   - Versión de Odoo
```

### 3. Ejecutar la actividad QA

Cuando la actividad delegue trabajo ODF, usar `odf_delegate` y su resolución de
skills; no llamar `task()` directamente. Los nombres legacy de los artefactos
se conservan como adaptadores de compatibilidad. Con strict workflow activo por
defecto, toda delegación con fase `IMPLEMENT`/`VERIFY` debe pasar la transición
bajo `workflow_advance`, `artifact_store: openspec|engram` y un `attempt_id`
opaco y nuevo; QA-REVIEW/AGGREGATE/REPORT son sub-pasos dentro de un intento
BUILD/VERIFY ya abierto, no inicios gateados frescos.

**QA-PLAN** (lente de `PLAN`; nombre legacy):
```
Leer: /home/adruban/.config/opencode/skills/odf-qa/SKILL.md
Ejecutar: odoo_qa_engineer mediante odf_delegate
Entrada: artefacto de assess + requisito del usuario
Salida: artefacto qa-plan.md
Rol: intención de pruebas dentro de PLAN; la aprobación sigue el modo activo
```

**QA-REVIEW** (lente de `BUILD`; nombre legacy):
```
Leer: /home/adruban/.config/opencode/skills/odf-qa/SKILL.md
Ejecutar: odoo_qa_engineer mediante odf_delegate
Entrada: tests escritos en el último lote
Salida: artefacto qa-review.md
Rol: evidencia del lote dentro de BUILD; opcional según ruta/riesgo/tipo de trabajo
```

**QA-AGGREGATE** (lente de `VERIFY`; nombre legacy):
```
Leer: /home/adruban/.config/opencode/skills/odf-qa/SKILL.md
Ejecutar: odoo_qa_engineer mediante odf_delegate
Entrada: todos los artefactos implement-progress
Salida: artefacto qa-aggregate.md
Rol: agregación de cobertura dentro de VERIFY; no convertirla en gate universal
```

**QA-REPORT** (utilidad de `VERIFY`; nombre legacy):
```
Leer: /home/adruban/.config/opencode/skills/odf-qa/SKILL.md
Ejecutar: odoo_qa_engineer mediante odf_delegate
Entrada: todos los artefactos (assess, design, implement, verify)
Salida: artefacto qa-report.md
Rol: utilidad de informe opcional; VERIFY sigue siendo el gate de calidad independiente
```

### 4. Persist QA Artifacts

```
QA-PLAN:  mem_save("odf/{change}/qa-plan")
QA-REVIEW: mem_save("odf/{change}/qa-review")
QA-AGGREGATE: mem_save("odf/{change}/qa-aggregate")
QA-REPORT: mem_save("odf/{change}/qa-report")
```

## Output Format

### QA-PLAN Output

```
ODF: Test Plan Generated

  Change: {change-name}
  Requirements: {N}
  Test Scenarios: {N}
  Coverage Target: {X}%

  Test Scenarios:
  | ID | Requirement | Test Type | Priority |
  |----|-------------|-----------|----------|
  | TS-01 | REQ-01 | Unit | High |

  Next: DESIGN — Proceed? (or review test plan)
```

### QA-REVIEW Output

```
ODF: Test Review Complete

  Change: {change-name}
  Batch: {N}
  Tests Reviewed: {N}
  Coverage: {X}%

  Issues Found:
  | File | Test | Issue | Severity |
  |------|------|-------|----------|

  Next: Continue IMPLEMENT or run VERIFY
```

### QA-COVERAGE Output

```
ODF: Coverage Analysis

  Change: {change-name}
  Current Coverage: {X}%
  Target Coverage: {Y}%
  Status: {PASS|WARN|FAIL}

  Uncovered Code Paths:
  - models/sale_order.py:45-52
  - models/sale_order.py:78-85

  Next: Add tests for uncovered paths
```

### QA-REPORT Output

```
ODF: QA Report

  Change: {change-name}
  Final Coverage: {X}%
  Tests: {N} total ({P} passed, {F} failed)

  Coverage by Module:
  | Module | Coverage | Target | Status |
  |--------|----------|--------|--------|
  | module_a | 85% | 80% | PASS |

  Requirements Traceability:
  | Requirement | Tests | Status |
  |-------------|-------|--------|
  | REQ-01 | TS-01, TS-02 | COVERED |

  Verdict: {PASS|PASS WITH WARNINGS|FAIL}
```
