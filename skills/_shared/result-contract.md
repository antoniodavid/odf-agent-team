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
| `workflow_commit.status` | `batch-verified` means this IMPLEMENT batch passed validation but BUILD remains pending; continue with the next bounded batch. It is not a completed-stage commit. |
| `receipt` | Optional receipt or receipt reference; failure persistence may also be on disk |
| `result` | Raw return value from `task()`; the plugin does not synthesize its inner fields |
| `task_session_id` | Child session id when the plugin created one (OpenCode V2 bridge); absent with the host native task API |
| Other fields | Existing phase, agent, skill, profile, and task-source metadata remain compatible |

On OpenCode V2 the plugin creates the child session with a descriptive title
(`ODF <phase> → <agent> · <change>`), emits it through tool progress, and
reports its id as `task_session_id`, so the delegation stays identifiable even
though plugin-created sessions are not host-rendered subtasks.

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
- **artifacts_saved**: [{"name": "design", "artifact_ref": {"store": "openspec", "ref": "openspec/changes/<change>/design/design.md"}}]
- **next_recommended**: [{phase or agent to invoke next}]
- **risks**: [{risk description}]
- **odoo_version**: {16|17|18|19}
- **modules_affected**: [{module_name}]
- **skill_resolution**: injected | self-discovered | none
```

| Field | Required | Description |
|---|---|---|
| `status` | YES | Overall outcome of this phase |
| `executive_summary` | YES | Short summary shown to the user; under two sentences |
| `strategy` | YES | Kind of work: standard, custom, migration, or integration. A specialist may emit only its supported subset (consultant: `standard\|custom`; api: `integration`; migrator: `migration`) |
| `artifacts_saved` | YES | Persisted artifacts in the selected store; each item uses canonical `artifact_ref: {store, ref}`. Optional `engram_topic_key` is compatibility-only; `[]` if none. |
| `next_recommended` | YES | Next phase/agent; `[]` if complete |
| `risks` | NO | Identified risks; `[]` if none |
| `odoo_version` | YES | Target Odoo version |
| `modules_affected` | YES | Affected technical module names |
| `skill_resolution` | YES | Whether compact rules were `injected`, `self-discovered`, or `none` |
| `phase` | Phase agents | The phase executed (`DESIGN`, `IMPLEMENT`, `ASSESS`, ...) when the agent serves multiple phases |
| `validation_evidence` | NO (IMPLEMENT) | Path to `.odf/validation-evidence-{change}.json` plus command/exit-code summary. The plugin validates the artifact; prose never counts. |
| `receipt` | NO (FAIL/blocked) | Reference to `.odf/receipt-{change}.json`; `action: null` means pending disposition. |

### Serialization Rules

The host parses this envelope from the agent's final text, so serialization is
part of the contract:

- One `- **key**: value` line per field. A bold line without the list marker
  (`**key**: value`) is also accepted.
- Structured values (objects, arrays) MUST be single-line JSON, e.g.
  `- **source_authority**: {"ok": true, "verified": true, "relation": "inherit_id", ...}`.
  Nested `- key: value` bullet lists are parsed as objects, but single-line JSON
  is the only shape guaranteed for deep structures.
- `true`, `false`, and `null` are parsed as their JSON values.
- The `## ODF Result` section is authoritative when present: the parser reads it
  first and never replaces it with an unrelated fenced JSON block. Without that
  section, the first fenced JSON block or the whole message is parsed as JSON.
- A section without a `status` line is an invalid task result.
- `status` must be exactly `ok`, `warning`, `blocked`, or `failed`; unresolved template text such as `ok | warning | blocked | failed` is invalid.
- Do not add fenced code blocks to the final message unless the whole message is
  the JSON result.

### Phase-Conditional Fields

Agents declare ONLY the extra fields for their phase, not a full copy of this envelope:

| Agent / phase | Extra fields |
|---|---|
| DESIGN (backend, frontend, dba, migrator) | `design_closed`, `design_path`, `design_meta`; view/XML work also returns the structured `source_authority` envelope (a verified view/action relation, or `relation: "not_applicable"` + bounded `reason` when the task references nothing); `source_authority_required` + `source_authority_refs`; `required_evidence` (dba); `migration_context` (migrator) |
| IMPLEMENT (backend, frontend, batch) | consumed `design_closed`/`design_path`/`design_meta`; `source_authority_*` when applicable; `batch_summary` + `validation_evidence` (batch) |
| IMPLEMENT (dba, migrator) | `implementation_evidence`; `rollback_authorized` (migrator) |
| ASSESS (migrator) | `migration_path`, `compatibility_evidence` |
| QA-PLAN / VERIFY (qa) | `test_results` |
| VERIFY advisory (reviewer) | `review_findings`; never a VERIFY verdict |

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
