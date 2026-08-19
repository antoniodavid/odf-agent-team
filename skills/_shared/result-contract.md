# Result Contract (shared across ODF skills and agents)

ODF has two compatible result layers. The plugin owns the outer delegation
envelope. The invoked agent owns the inner `## ODF Result` envelope. The
plugin does not invent or rewrite the inner result; the orchestrator reads both.

## Outer Plugin Envelope

`odf_delegate` returns an outer envelope with these compatible statuses:

```json
{
  "status": "delegated | blocked | error | timeout",
  "phase": "IMPLEMENT",
  "agent": "odoo_backend_engineer",
  "skills_injected": [],
  "profile": null,
  "policy_gate": null,
  "validation": null,
  "receipt": null,
  "task_api_source": "toolCtx.task",
  "result": {}
}
```

| Field | Meaning |
|---|---|
| `status` | Delegation transport outcome, not the agent's phase verdict. `blocked` means no executable delegation occurred. |
| `policy_gate` | Authoritative gate decision for IMPLEMENT/VERIFY, or `null` |
| `validation` | Plugin seal for IMPLEMENT evidence: `verified`, `missing`, or `invalid`, or `null` |
| `receipt` | Optional receipt or receipt reference; failure persistence may also be on disk |
| `result` | Raw return value from `task()`; the plugin does not synthesize its inner fields |
| Other fields | Existing phase, agent, skill, profile, and task-source metadata remain compatible |

When `task()` is unavailable, the plugin returns a structured `blocked` envelope
with `reason: task-api-unavailable`; it never returns an executable fallback
prompt. Empty, cancelled, or unusable task results are terminal errors/blocked
outcomes and are never retried implicitly. Errors and timeouts may persist a
failure receipt, but that does not change their outer transport status.

## Inner Agent Envelope

Every sub-agent invoked by the orchestrator MUST return this structured section
as the LAST part of its response. The orchestrator uses it for phase decisions.

```markdown
## ODF Result
- **status**: ok | warning | blocked | failed
- **executive_summary**: {1-2 sentence decision-grade summary}
- **strategy**: standard | custom | migration | integration
- **artifacts_saved**: [{name, artifact_ref: {store, ref}, engram_topic_key?}]
- **next_recommended**: [{phase or agent to invoke next}]
- **risks**: [{risk description}]
- **odoo_version**: {16|17|18|19}
- **modules_affected**: [{module_name}]
```

| Field | Required | Description |
|---|---|---|
| `status` | YES | Overall outcome of this phase |
| `executive_summary` | YES | Short summary shown to the user; under two sentences |
| `strategy` | YES | Kind of work: standard, custom, migration, or integration |
| `artifacts_saved` | YES | Persisted artifacts in the selected store; each item uses canonical `artifact_ref: {store, ref}`. Optional `engram_topic_key` is compatibility-only; `[]` if none. |
| `next_recommended` | YES | Next phase/agent; `[]` if complete |
| `risks` | NO | Identified risks; `[]` if none |
| `odoo_version` | YES | Target Odoo version |
| `modules_affected` | YES | Affected technical module names |
| `validation_evidence` | NO (IMPLEMENT) | Path to `.odf/validation-evidence-{change}.json` plus command/exit-code summary. The plugin validates the artifact; prose never counts. |
| `receipt` | NO (FAIL/blocked) | Reference to `.odf/receipt-{change}.json`; `action: null` means pending disposition. |

## Failure Disposition

For a `blocked` or `failed` phase, persist:

- `cause`: `validation-failed`, `error`, or `timeout`.
- `evidence`: summary, frozen ref, failing commands/tests, and topic/path refs.
- `action`: user decision `scope-change`, `re-plan`, `abandon`, or `retry`; `null` remains pending.

The orchestrator writes the receipt with `odf_receipt` before escalating and
updates its action after the user decides. `/odf-continue` must rediscover a
receipt whose `action` is still `null` before resuming.

## Status Semantics

| Inner status | Orchestrator action |
|---|---|
| `ok` | Show summary and continue to the next gate |
| `warning` | Show summary and warnings, then continue to the next gate |
| `blocked` | Pause and ask the user for clarification or disposition |
| `failed` | Stop, report the error, and suggest recovery |

The outer status answers "did delegation run?"; the inner status answers "what
did the phase produce?". A successful outer `delegated` status is not proof of
an inner `ok` result. `blocked` means the next transition cannot happen without
user input; `ok` means the phase handoff is approved/complete enough for the
next gate.
