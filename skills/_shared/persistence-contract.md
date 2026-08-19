# Persistence Contract (shared across all ODF skills and agents)

## Selected Store

Preflight selects `artifact_store: openspec | engram | hybrid`. Every phase MUST
read and write artifacts through that selected store. `mem_*` is an Engram
implementation detail, not a phase requirement, and phases MUST NOT silently
fall back to another store.

| Store | Read/write branch |
|---|---|
| `openspec` | Use the OpenSpec change files, normally `openspec/changes/{change}/` (including `state.yaml`, proposal, specs, design, and tasks). |
| `engram` | Use the Engram artifact identified by its deterministic topic/ref; `mem_save`, `mem_search`, and `mem_get_observation` are valid adapters for that store. |
| `hybrid` | Keep the OpenSpec change files and the matching Engram artifact synchronized; neither side may be omitted or treated as an implicit fallback. |

The canonical reference for every persisted artifact is:

```yaml
artifact_ref:
  store: openspec | engram | hybrid
  ref: path-or-topic-reference
```

`engram_topic_key` MAY be included only as an optional compatibility field for
older consumers. It is never the canonical reference. If the selected store is
unavailable, return the result inline and warn; proof-backed lifecycle state
must fail closed without advancing.

## Artifact Classes

The selected store applies equally to all ODF artifacts: immutable human
`Expectations` (`EXP-XX`), proposals/specs/design/implementation/verification,
the design library, learning/retrospectives, receipts, and `artifacts_saved`.
Preserve their semantics and references when moving between stores.

## State Persistence (Orchestrator)

The orchestrator persists canonical workflow state after each proof-backed BUILD
or VERIFY transition. It re-reads the selected store before commit and remains
the only source of truth for that transition. The store branches above define
the write and recovery behavior; no phase invents a separate persistence path.

## Detail Level

The orchestrator may pass `detail_level`: `concise | standard | deep`.
This controls output verbosity but does NOT affect what gets persisted — always
persist the full artifact.

## Common Rules for All Agents

- When invoked as a sub-agent for an ODF phase, ALWAYS read the relevant shared conventions before starting work
- ALWAYS return the structured result envelope defined in `result-contract.md`
- ALWAYS use the selected store and return an `artifact_ref` for each persisted artifact
- Use deterministic names/paths appropriate to that store; `engram-convention.md` applies only to Engram refs
- ALWAYS use the local source paths from `odoo-sources.md` when searching Odoo code
