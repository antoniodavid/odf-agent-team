# Persistence Contract (shared across all ODF skills and agents)

## Artifact Store Modes

ODF supports `openspec`, `engram`, and `hybrid` artifact stores selected during
preflight. The current state-machine helpers use OpenSpec `state.yaml` files;
phase artifacts are persisted to Engram using deterministic topic keys, and
hybrid mode keeps both representations when the orchestrator supports it.

## Rules

1. Follow the selected artifact store; do not assume Engram-only or OpenSpec-only persistence.
2. Engram artifacts use `mem_save` with deterministic naming (see `engram-convention.md`).
3. Recovery after compaction uses `mem_search` then `mem_get_observation` (2-step protocol)
4. If the selected store is unavailable, return results inline and WARN the user.

## State Persistence (Orchestrator)

The orchestrator persists DAG state after each phase transition to enable recovery after context compaction. In the current runtime, the state-machine helpers write OpenSpec state; Engram status resolution reads `odf/{change}/...` observations.

| Action | How |
|--------|-----|
| Save state | `mem_save(topic_key: "odf/{change-name}/state")` |
| Recover state | `mem_search("odf/{change-name}/state")` then `mem_get_observation(id)` |

## Detail Level

The orchestrator may pass `detail_level`: `concise | standard | deep`.
This controls output verbosity but does NOT affect what gets persisted — always persist the full artifact.

## Common Rules for All Agents

- When invoked as a sub-agent for an ODF phase, ALWAYS read the relevant shared conventions before starting work
- ALWAYS return the structured result envelope defined in `result-contract.md`
- ALWAYS use the deterministic naming from `engram-convention.md` when persisting artifacts
- ALWAYS use the local source paths from `odoo-sources.md` when searching Odoo code
