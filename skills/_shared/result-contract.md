# Result Contract (shared across all ODF skills and agents)

## Structured Envelope

Every sub-agent invoked by the ODF orchestrator MUST return this structured section
as the LAST part of their response. The orchestrator parses this to decide next steps.

```markdown
## ODF Result
- **status**: ok | warning | blocked | failed
- **executive_summary**: {1-2 sentence decision-grade summary}
- **strategy**: standard | custom | migration | integration
- **artifacts_saved**: [{name, engram_topic_key}]
- **next_recommended**: [{phase or agent to invoke next}]
- **risks**: [{risk description}]
- **odoo_version**: {16|17|18|19}
- **modules_affected**: [{module_name}]
```

## Field Definitions

| Field | Required | Description |
|-------|----------|-------------|
| `status` | YES | Overall outcome of this phase |
| `executive_summary` | YES | Short summary the orchestrator shows the user — keep it under 2 sentences |
| `strategy` | YES | What kind of work this is |
| `artifacts_saved` | YES | List of Engram artifacts created/updated (empty list `[]` if none) |
| `next_recommended` | YES | What phase(s) should run next (empty `[]` if workflow is complete) |
| `risks` | NO | List of risks identified (empty `[]` if none) |
| `odoo_version` | YES | Target Odoo version |
| `modules_affected` | YES | List of Odoo module technical names affected |

## Status Values

| Status | Meaning | Orchestrator Action |
|--------|---------|-------------------|
| `ok` | Phase completed successfully | Show summary, proceed to gate/next phase |
| `warning` | Completed with non-blocking issues | Show summary + warnings, proceed to gate |
| `blocked` | Cannot continue without user input | STOP and ask the user for clarification |
| `failed` | Something went wrong | STOP and report the error to the user |

## Orchestrator Behavior

- If status is `ok` or `warning` the orchestrator MAY auto-continue to the next gate
- If status is `blocked` the orchestrator MUST pause and ask the user
- If status is `failed` the orchestrator MUST report error and suggest recovery
- `executive_summary` is what the user sees — make it count
- `next_recommended` drives the DAG — orchestrator uses this to determine the next phase

## Example

```markdown
## ODF Result
- **status**: ok
- **executive_summary**: Custom module needed. Standard Odoo sales doesn't support per-category discounts. Module `sale_discount_category` with 2 new models proposed.
- **strategy**: custom
- **artifacts_saved**: [{"name": "assess", "engram_topic_key": "odf/sale-discount-field/assess"}]
- **next_recommended**: ["design"]
- **risks**: ["Discount computation on large order lines may need performance optimization"]
- **odoo_version**: 18
- **modules_affected**: ["sale_discount_category"]
```
