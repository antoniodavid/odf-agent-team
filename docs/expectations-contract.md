# Expectations Contract (T9)

Separa el **intento humano** (Expectations, `EXP-XX`) del **plan técnico
generado por la IA** (Requisitos, `REQ-XX`). El objetivo es romper la
autoevaluación circular: antes, el mismo sistema escribía los `REQ-XX` en
ASSESS y luego los juzgaba en VERIFY. Ahora VERIFY evalúa contra las
`EXP-XX` humanas aprobadas, y usa el plan/REQ solo como contexto técnico.

## Artefacto canónico `expectations`

Un artefacto persistido en el store seleccionado (`openspec/changes/{change}/expectations.yaml`
o Engram `odf/{change}/expectations`), separado de `assess`/`propose`.

```yaml
change: sale-discount-field
intent: "Aplicar un descuento porcentual configurable por categoría de partner en las órdenes de venta"
expectations:
  - id: "EXP-01"
    statement: "El descuento se aplica sobre el total de la orden al confirmar."
    testable: true
    owned_by: "human"
  - id: "EXP-02"
    statement: "El descuento máximo está limitado por configuración a nivel de compañía."
    testable: true
    owned_by: "human"
  - id: "EXP-03"
    statement: "La configuración solo es editable por el manager de ventas."
    testable: true
    owned_by: "human"
approved: true
approved_by: "user"
approved_at: "2026-08-17T00:00:00Z"
immutable_since: "2026-08-17T00:00:00Z"
```

### Campos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `change` | string | Nombre del cambio en kebab-case. |
| `intent` | string | Frase humana del objetivo del cambio (del usuario, no del modelo). |
| `expectations` | array | Lista de `EXP-XX`. |
| `expectations[].id` | string | `EXP-01`, `EXP-02`, … (nunca `REQ-XX`). |
| `expectations[].statement` | string | Criterio verificable redactado como afirmación del usuario. |
| `expectations[].testable` | boolean | Si es comprobable por tests/evidencia. |
| `expectations[].owned_by` | string | Siempre `"human"`. Nunca `"model"`/`"ai"`. |
| `approved` | boolean | `true` solo tras confirmación explícita del usuario. |
| `approved_by` | string | Identificador de quién aprobó (el usuario). |
| `approved_at` | ISO date | Cuándo se aprobó. |
| `immutable_since` | ISO date | Desde cuándo los `statement` no pueden reescribirse. |

## Origen (quién redacta las EXP)

Las `EXP-XX` se capturan en PROPOSE/entrada desde:

1. La descripción del comando (`/odf-new sale-discount-field "..."`), y
2. **UNA ronda de aclaración** hecha al usuario (vía `question`), nunca del
   modelo.

El orquestador NO redacta las `EXP-XX` a partir de su propio análisis; solo
las reformula como afirmaciones verificables y pide confirmación explícita.

## Regla de inmutabilidad

Una vez `approved: true`:

- Ningún agente puede reescribir el `statement` de una `EXP`.
- Solo una **aprobación humana posterior explícita** puede modificar una
  `EXP`: se marca `approved: false`, se edita el `statement`, y se vuelve a
  aprobar con nuevo `approved_at` / `immutable_since`.

El mecanismo es un **contrato documentado** en las instrucciones de los
agentes (orquestador, QA, assess) — no se construye ninguna DB ni lock de
escritura a nivel de infraestructura. El QA engineer (VERIFY) es el guardián:
si detecta que un `statement` aprobado fue reescrito, marca `blocked`.

## REQ vs EXP

| | `EXP-XX` (Expectations) | `REQ-XX` (Requirements) |
|---|---|---|
| Autor | Humano (usuario) | Modelo (plan técnico ASSESS) |
| Rol | Contrato inmutable a evaluar | Plan técnico / contexto |
| Mutabilidad | Inmutable tras aprobación | Revisable en ASSESS/DESIGN |
| Usado en VERIFY | Criterio principal | Contexto técnico |

`skills/odf-assess/SKILL.md` genera `REQ-XX` como plan técnico y **referencia**
las `EXP-XX` (cada `REQ` indica qué `EXP` cubre), pero no las sustituye.

## Retrocompatibilidad (cambios legacy)

Si no existe artefacto `expectations` (cambios iniciados antes de T9):

- VERIFY sigue evaluando contra los `REQ-XX` como antes.
- VERIFY añade un **warning explícito**: `missing-expectations` — faltan
  Expectations humanas; la evaluación es sobre plan generado y puede tener
  autoevaluación circular.

## Evaluación de goldens

El corpus de referencia vive en `scripts/fixtures/golden-trajectories.json` y
se valida con `evaluateGoldens()` en `scripts/odf-evaluation.js`. Ver
`scripts/odf-evaluation.js` para la firma y shape.
