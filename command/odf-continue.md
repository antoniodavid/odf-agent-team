---
description: "Continue ODF workflow from last completed phase. Usage: /odf-continue [change-name]"
---

# ODF: Continue Change

Resume the ODF workflow from wherever it was left off.

## Parse Arguments

```
/odf-continue              — Resume the most recent active change
/odf-continue sale-discount — Resume a specific change by name
```

## Orchestrator Instructions

1. **Recover state**:
   - Read `openspec/changes/{change}/state.yaml` for active changes (and/or Engram `odf/{change}/state`).
   - Sort active changes by `last_updated` descending.
2. **Select change**:
   - If name provided: load that change; error if not active.
   - If no name: pick the most recent active change.
   - If more than one active change and ambiguous: list them and ask the user to pick.
3. **Preflight check**:
   - If the selected change has an incomplete or missing preflight record, run the preflight gate first.
4. **Determine next phase** from `state.artifacts`:
   - If preflight incomplete → preflight
   - If assess=false → ASSESS
   - If design=false → DESIGN
   - If implement=false → IMPLEMENT
   - If verify=false → VERIFY
   - If all true → change is complete, suggest archive
5. **Launch next phase** via `odf_delegate(phase, prompt, context_files)`.
6. **Show gate** after phase completion.

## Output

```
ODF: Continuing "{change-name}"

  Last phase: {phase}
  Next phase: {next-phase}
  Delegating to: {agent}
  ...
```
