# Expectations Contract (T9)

Separates **human intent** (Expectations, `EXP-XX`) from the **AI-generated
technical plan** (Requirements, `REQ-XX`). The goal is to break circular
self-evaluation: previously the same system wrote the `REQ-XX` in ASSESS and
then judged them in VERIFY. Now VERIFY evaluates against the approved human
`EXP-XX`, and uses the plan/REQ only as technical context.

## Canonical `expectations` artifact

An artifact persisted in the selected store (`openspec/changes/{change}/expectations.yaml`
or Engram `odf/{change}/expectations`), separate from `assess`/`propose`.

```yaml
change: sale-discount-field
intent: "Apply a configurable percentage discount by partner category on sales orders"
expectations:
  - id: "EXP-01"
    statement: "The discount applies to the order total on confirmation."
    testable: true
    owned_by: "human"
  - id: "EXP-02"
    statement: "The maximum discount is limited by company-level configuration."
    testable: true
    owned_by: "human"
  - id: "EXP-03"
    statement: "The configuration is only editable by the sales manager."
    testable: true
    owned_by: "human"
constraints:
  - "Do not modify invoice totals."
success_scenarios:
  - { id: "SUC-01", statement: "A valid discount is applied on order confirmation.", testable: true, owned_by: "human" }
failure_scenarios:
  - { id: "FAL-01", statement: "An invalid discount is rejected.", testable: true, owned_by: "human" }
connections:
  - { id: "CON-01", relation: "supports", reference: "EXP-01" }
approved: true
approved_by: "user"
approved_at: "2026-08-17T00:00:00Z"
immutable_since: "2026-08-17T00:00:00Z"
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `change` | string | Kebab-case change name. |
| `intent` | string | Human phrase stating the change goal (from the user, not the model). |
| `expectations` | array | List of `EXP-XX`. |
| `expectations[].id` | string | `EXP-01`, `EXP-02`, … (never `REQ-XX`). |
| `expectations[].statement` | string | Verifiable criterion written as a user assertion. |
| `expectations[].testable` | boolean | Whether it is checkable by tests/evidence. |
| `expectations[].owned_by` | string | Always `"human"`. Never `"model"`/`"ai"`. |
| `constraints` | string array | Optional; at most 32 non-empty strings, no control characters, up to 512 characters each. Duplicates not allowed. |
| `success_scenarios` | array | Optional; at most 32 exact entries with unique IDs `SUC-1`–`SUC-999`. |
| `failure_scenarios` | array | Optional; at most 32 exact entries with unique IDs `FAL-1`–`FAL-999`. |
| `success_scenarios[]` / `failure_scenarios[]` | object | Exactly `{ id, statement, testable, owned_by }`; `owned_by` always `"human"`. |
| `connections` | array | Optional; at most 32 exact entries with unique IDs `CON-1`–`CON-999`. |
| `connections[].relation` | string | Lowercase hyphenated relation, up to 32 characters. |
| `connections[].reference` | string | ASCII-safe reference, up to 256 characters, no `..`. |
| `approved` | boolean | `true` only after explicit user confirmation. |
| `approved_by` | string | Identifier of who approved (the user). |
| `approved_at` | ISO date | When it was approved. |
| `immutable_since` | ISO date | Since when `statement` cannot be rewritten. |
| `revision`, `supersedes`, `replan_from` | optional metadata | Existing revision metadata; this extension adds no history. |

Scenario entries have exactly `{ id, statement, testable, owned_by }`;
connections have `{ id, relation, reference }`. Unknown keys, null or
malformed values, unsafe IDs/references, duplicates and out-of-limit values
are rejected. Omitting optional fields keeps legacy artifacts valid.

Protected human content includes `change`, `intent`, `expectations`,
`constraints`, `success_scenarios`, `failure_scenarios` and `connections`.
Approval and revision metadata keep their current behavior.

## Origin (who writes the EXP)

`EXP-XX` are captured in PROPOSE/entry from:

1. The command description (`/odf-new sale-discount-field "..."`), and
2. **ONE clarification round** asked to the user (via `question`), never from
   the model.

The orchestrator does NOT author `EXP-XX` from its own analysis; it only
rephrases them as verifiable assertions and asks for explicit confirmation.

## Immutability rule

Once `approved: true`:

- No agent may rewrite an `EXP` `statement` or its optional fields.
- Only a later explicit **human approval** may modify an `EXP` or optional
  field: set `approved: false`, edit, then re-approve with new timestamps.

The mechanism is a **documented contract** in agent instructions
(orchestrator, QA, assess) — no DB or infrastructure-level write lock is
built. The QA engineer (VERIFY) is the guardian: if it detects that an
approved `statement` was rewritten, it marks `blocked`.

## REQ vs EXP

| | `EXP-XX` (Expectations) | `REQ-XX` (Requirements) |
|---|---|---|
| Author | Human (user) | Model (ASSESS technical plan) |
| Role | Immutable contract to evaluate | Technical plan / context |
| Mutability | Immutable after approval | Revisable in ASSESS/DESIGN |
| Used in VERIFY | Primary criterion | Technical context |

`skills/odf-assess/SKILL.md` generates `REQ-XX` as a technical plan and
**references** the `EXP-XX` (each `REQ` states which `EXP` it covers), but
does not replace them.

## Backward compatibility (legacy changes)

If no `expectations` artifact exists (changes started before T9):

- VERIFY keeps evaluating against the `REQ-XX` as before.
- VERIFY adds an **explicit warning**: `missing-expectations` — human
  Expectations are missing; evaluation is against the generated plan and may
  suffer circular self-evaluation.

Omission of optional fields, approval handling, revisions, fallback and
canonical paths do not change.

## Golden evaluation

The reference corpus lives in `scripts/fixtures/golden-trajectories.json` and
is validated with `evaluateGoldens()` in `scripts/odf-evaluation.js`. See
`scripts/odf-evaluation.js` for the signature and shape.
