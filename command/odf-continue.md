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

1. **Recover state** from Engram:
   ```
   mem_search(query: "odf/*/state") — list active changes
   mem_get_observation(id) — full state YAML
   ```
2. **Determine next phase** from state:
   - If assess=true, design=false — run DESIGN
   - If design=true, implement=false — run IMPLEMENT
   - If implement=true, verify=false — run VERIFY
   - If verify=true — change is complete
3. **Launch next phase** via the appropriate skill + sub-agent
4. **Show gate** after phase completion

## If Multiple Active Changes

```
Active ODF changes:
  1. sale-discount — Phase: DESIGN (ready for IMPLEMENT)
  2. pos-custom-receipt — Phase: ASSESS (ready for DESIGN)

Which change to continue? (or specify: /odf-continue sale-discount)
```

## Output

```
ODF: Continuing "{change-name}"

  Last phase: {phase}
  Next phase: {next-phase}
  Delegating to: {agent}
  ...
```
