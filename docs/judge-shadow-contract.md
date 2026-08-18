# Judge Shadow Contract (T10)

El **judge shadow** mide la corrección semántica de un candidato (su
`candidate_digest`) contra las **Expectations humanas aprobadas** (`EXP-XX`) y
el plan técnico (`REQ-XX`), SIN asumir autoridad de entrega. Es un sensor de
calibración, no un gate.

## Qué es shadow

- El judge corre **en paralelo** y su resultado se **registra** (JSONL), nunca
  altera el estado del workflow (no toca `commitWorkflowTransition` ni VERIFY).
- Un juicio `unavailable` NO es un juicio: es honestidad sobre falta de datos
  (coherente con T7/T8 — no se sintetiza un verdict sin proveedor).

## Schema version

`JUDGE_SCHEMA_VERSION = 1`. Toda salida lleva `schema_version`. Cualquier
cambio de contrato (rubric, shape, telemetría) incrementa la versión.

## Rubric

`defaultJudgeRubric()` devuelve criterios versionados (JSON-serializable):

| id | weight | qué evalúa |
|----|--------|-----------|
| `correctness_vs_expectations` | 0.60 | El candidato satisface las `EXP-XX` que declara cubrir, con evidencia verificable por EXP. |
| `regression_risk` | 0.25 | Riesgo de romper comportamiento existente / invariantes / la traza. |
| `evidence_quality` | 0.15 | Evidencia completa, reproducible y ligada al digest. |

Política: `pass` solo con corrección satisfecha + riesgo aceptable + evidencia
adecuada; si no, `fail`. Nunca fabricar verdict sin proveedor.

## Ligadura (binding)

Cada juicio se liga a identidad trazable vía `bound_to`:

```json
{ "expectation_ids": ["EXP-01", "EXP-02"], "candidate_digest": "…", "trace_ref": "…" }
```

## Métricas

`compareHumanJudge({ human, judge })` devuelve:

| campo | definición |
|-------|-----------|
| `agreement` | `true` si ambos pass/fail y coinciden; `false` si difieren; `null` si judge `unavailable`. |
| `false_pass` | human `fail` y judge `pass`. |
| `false_block` | human `pass` y judge `fail`. |
| `unavailable` | judge `unavailable` (no hay opinión). |
| `cost` | telemetría ausente → `null` (T7); un proveedor real la poblaria. |

Agregación acumulada: `agreement rate` y `false_pass rate` sobre juicios
comparados; `unavailable rate` separado. KPI del roadmap: **agreement humano/judge
medido y tasa de false-pass; sin impacto de gate.**

## Shadow NUNCA bloquea

- El judge shadow es **solo lectura**: registra, no gatea.
- `judge: "fail"` en shadow no detiene nada; alimenta calibración.
- Los verificadores deterministas (`evaluateGoldens`/`evaluateOffline`) y el
  VERIFY humano (`odoo_qa_engineer`) siguen siendo los únicos gate.

## Promoción a rol bloqueante (activador)

Promover el judge a **cualquier rol que bloquee entrega** es una **decisión
humana explícita** respaldada por **calibración medida**:

1. Umbral de acuerdo humano/judge y techo de false-pass acordados con el
   operador (p.ej. `agreement >= 0.9` y `false_pass <= 0.02` sobre N muestras).
2. `unavailable` rate bajo (un judge que no opina no puede gatear).
3. Revisión del operador sobre un sample de discrepancias.
4. Decisión registrada por humano (nunca por el propio judge) antes de activar
   cualquier gate.

Sin esa decisión, el judge permanece en shadow. El repo no promueve a gate.

## Punto de extensión del proveedor

`evaluateShadow` lee `ODF_JUDGE_MODEL` (y opcional `ODF_JUDGE_PROVIDER`) para
poblar `judge_version.model/provider`. Sin `ODF_JUDGE_MODEL` devuelve
`verdict: "unavailable"`, `verdict_label: "N/A"`, `data_status: "no_data"`.

Un operador cablea un proveedor real reemplazando el cuerpo de `runJudge` (en
`scripts/odf-judge.js`) por una llamada a su LLM configurado, devolviendo
`{ verdict, verdict_label, rationale }`. El adaptador conserva el contrato:
schema, rubric, binding y telemetría.
