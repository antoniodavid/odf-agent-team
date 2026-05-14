# Persistence Contract (shared across all ODF skills and agents)

## Mode: Engram Only

ODF uses Engram exclusively for artifact persistence. No project files are created for ODF workflow artifacts.

## Rules

1. NEVER create or modify project files for ODF artifacts (no `openspec/`, no `.odf/`, no `odf/` directories in the project)
2. ALL artifacts persist to Engram via `mem_save` with deterministic naming (see `engram-convention.md`)
3. Recovery after compaction uses `mem_search` then `mem_get_observation` (2-step protocol)
4. If Engram is unavailable, return results inline and WARN the user that persistence is disabled

## State Persistence (Orchestrator)

The orchestrator persists DAG state after each phase transition to enable recovery after context compaction:

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
