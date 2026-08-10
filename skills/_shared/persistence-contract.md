# Persistence Contract (shared across all ODF skills and agents)

## Artifact Store Modes

ODF supports `openspec`, `engram`, and `hybrid` artifact stores selected during
preflight. For lifecycle state commits, the explicit `artifact_store` binding
selects exactly one authoritative store: `openspec` or `engram`. Hybrid state
commits are not supported and must never dual-write or fall back.

## Rules

1. Follow the selected artifact store; do not assume Engram-only or OpenSpec-only persistence.
2. Engram artifacts use `mem_save` with deterministic naming (see `engram-convention.md`).
3. Recovery after compaction uses `mem_search` then `mem_get_observation` (2-step protocol)
4. If the selected store is unavailable, return results inline and WARN the user; a proof-backed lifecycle transition must also fail closed without advancing state.

## State Persistence (Orchestrator)

The orchestrator persists canonical workflow state after each proof-backed BUILD
or VERIFY transition to enable recovery after context compaction. The selected
store is re-read before commit and remains the only source of truth for that
transition.

| Action | How |
|--------|-----|
| Save OpenSpec state | Atomically replace `openspec/changes/{change-name}/state.yaml` using a sibling temporary file and rename |
| Save Engram state | One deterministic `odf/{change-name}/state` observation via the safe export/save path |
| Recover state | Read only the explicitly selected OpenSpec file or Engram observation; never fall back to the other store |

## Detail Level

The orchestrator may pass `detail_level`: `concise | standard | deep`.
This controls output verbosity but does NOT affect what gets persisted — always persist the full artifact.

## Common Rules for All Agents

- When invoked as a sub-agent for an ODF phase, ALWAYS read the relevant shared conventions before starting work
- ALWAYS return the structured result envelope defined in `result-contract.md`
- ALWAYS use the deterministic naming from `engram-convention.md` when persisting artifacts
- ALWAYS use the local source paths from `odoo-sources.md` when searching Odoo code
