# Candidate digest phase binding and Replika continuation
Branch: `fix/candidate-digest-receipt-phase` (baseline `74fbc5399736edc98cec6654f9fef0d964ab4295`); delivery: `ask-on-risk`; runner: Vitest, `npm run typecheck`, `npm run test:yaml`.
Objective: stop unrelated phase receipts from blocking BUILD, then resume the authorized Replika workflow to its verified terminal state.

## Specs

1. **S1 — Phase-bound receipt digest.** User request: “solucionalo, buscar la forma de continuar con la session hasta terminar el proceso”. A receipt from a different workflow phase must not block the requested transition; a stale receipt from the same phase must still block. Policy-gate and validation-evidence digest mismatches remain blocking. Check through the existing workflow transition interface and keep the prior-stage-receipt regression in `odf-plugin/odf-delegation.test.ts`.
2. **S2 — Resume the existing Replika process.** The session request was: “el proyecto es replika, continue y termina el proceso, completa el tutorial”; the authorized verification request was: “usando el mcp odoo-mcp instancia odoo-16 y el chrome-devtools haz una corrida del modulo, con datos de prueba para verificar que esta resuelto el requerimiento y que se cumple con todo el pedido del cliente, luego actualiza la documentacion como el manual de usuario en html”. Continue `ses_ea08deda6ffe4jGyKK50IZFkM3` through the existing ODF workflow, preserve all pre-existing work, use the authorized Odoo 16 test instance and Chrome DevTools, and update the HTML user manual. Do not bypass BUILD/VERIFY/archive gates or report completion without observed evidence.

## Tasks
- T1 — S1 — inline — complete — Risk: item 2 (workflow guard); commit pending. Focused regression, clean full unit suite, typecheck, YAML suite, and independent S1 verification pass.
- T2 — S2 — parent/native ODF continuation — needs your selection: two active changes match in Replika — commit not applicable. Resume only the selected change through native status/transitions; do not replay unrelated stages or mutate unrelated repository state.

## Log
- L1: “solucionalo, buscar la forma de continuar con la session hasta terminar el proceso”
- L2: The recorded failure is `candidate-digest-mismatch`. The v1.6.0 code compares a receipt digest without checking that the receipt belongs to the transition phase; `.odf/` files are already excluded from the candidate manifest. The prior defect report did not preserve the mismatched binding or digest values.
- L3: Replika's worktree already contains staged and modified files. No cleanup or rollback is authorized; preserve that state.
- L4: The source branch is `fix/candidate-digest-receipt-phase`, based on the current clean tracked `main`; unrelated untracked task/docs remain untouched.
- L5: The regression fixture was corrected to use the valid IMPLEMENT→BUILD proof (`candidate_stage: PLAN`, with persisted BUILD state). RED then reproduced `candidate-digest-mismatch` specifically for a stale prior-stage receipt.
- L6: The guard compares receipt digests only when the receipt's canonical stage matches the transition. Legacy `phase` values project through `PHASE_STAGE`; unknown, missing, or conflicting bindings fail closed. Policy-gate and validation-evidence digests remain unconditional.
- L7: Initial focused `digest-mismatch` tests passed (11/11), typecheck passed, and the YAML suite passed (331/331). Two fork-pool full-suite attempts reported 1,478 tests passing but exited 1 with `Timeout calling "onTaskUpdate"`; the clean thread-pool result in L12 supersedes that incomplete proof.
- L8: The first independent verifier confirmed RED against baseline and GREEN for the candidate, then blocked on unprobed policy/evidence bindings and ambiguous `stage`/legacy `phase` conflicts. Its spot check also caught an accidental edit to an unrelated metrics expectation; that expectation was restored. One bounded correction added coverage for same/prior stage in canonical and legacy formats, conflicting/unknown/missing bindings, and policy/evidence digests; the source now fails closed on conflicts.
- L9: The verifier's one limited recheck passed S1: 11 focused tests passed in a fresh baseline scratch copy, typecheck returned `ok`, and the unrelated metrics expectation is absent from the diff. S2 was not assessed.
- L10: The focused unit suite, typecheck, and YAML suite pass. The fork-pool runner timeout was resolved by the user's chosen wait-for-clean-run path in L11-L12.
- L11: User decision, 2026-10-26: “B” — wait for a clean full Vitest run before resuming Replika.
- L12: A full thread-pool run passed cleanly: 54 test files, 1,487 tests, no errors (`npm run test:unit -- --pool=threads --maxWorkers=2 --minWorkers=1 --reporter=dot`). T1 now has the required proof; proceed with T2 through native workflow status and transitions.
- L13: Native `odf_workflow_status` found two resumable active Replika changes and required explicit selection: `inter-warehouse-branch-reception` (PLAN, pending BUILD, migration, resolved failed receipt with retry) and `inter-warehouse-multi-source` (BUILD, pending VERIFY, feature, resolved failed receipt with retry). No change was selected and no Replika files were modified.
