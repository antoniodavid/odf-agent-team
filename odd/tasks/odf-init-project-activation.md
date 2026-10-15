# ODF Init Project Activation
Feature: activate the ODF harness only for projects initialized through `/odf-init`.
Scope: local activation state, V2 setup gating, and regression coverage.

## Specs

1. **S1 — Initialization controls activation**
   > "se puede mezclar con el comando odf-init?, que desde ahi se haga la configuracion para que el harness se active por asi decirlo"

2. **S2 — Isolated implementation**
   > "en un worktree nuevo, haz la implementacion de este nuevo featura para el harness"

## Tasks

- T1 [S1] Add a canonical project activation manifest and resolver; commit: pending (implemented)
- T2 [S1] Make `/odf-init` persist verified activation and support disabling; commit: pending (implemented)
- T3 [S1] Gate V2/V1 harness activation on the project manifest; commit: pending (implemented for V2)
- T4 [S1-S2] Add regression tests and run focused checks; commit: pending

## Log

- L1: se puede mezclar con el comando odf-init?, que desde ahi se haga la configuracion para que el harness se active por asi decirlo
- L2: en un worktree nuevo, haz la implementacion de este nuevo featura para el harness
- L3: Implemented `.odf/project.json` as the local activation manifest, made `/odf-init` create it only after verified Engram persistence, added `--disable`, and made inactive V2 projects register no ODF runtime, tools, hooks, or events.
- L4: Focused activation, contract, and scan tests pass (52 total), typecheck, registry validation, and diff check pass. The full suite executed 331 scenarios but ended with two 5-second Vitest test timeouts and one worker `onTaskUpdate` timeout under the long parallel run; this remains unresolved verification evidence.
