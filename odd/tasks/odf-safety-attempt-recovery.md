# ODF cross-root safety false-positive and aborted-execute attempt recovery

Branch: `fix/odf-safety-attempt-recovery`
Delivery: one PR; install from the merged tree for runtime verification
Test runner: `npm run test:unit` (Vitest) and `npm test` (Vitest + YAML scenarios)

## Specs

- **S1**: `cross-root-write` must not block prose where a `>` closes an inline `<...>` placeholder and is immediately followed by a bare `/` delimiter. The exact regression is the ODF prompt phrase `` `filter` value of the form `/<url-encoded regex>/` ``, which must return `blocked: false` with an authorized workspace root.
- **S2**: Real external redirects must remain blocked: `echo x>/etc/evil`, `echo x > /etc/evil`, `echo x > /"etc/evil"`, `echo x > /'etc/evil'`, `echo x > /$'etc/evil'`, `echo x <package.json>/etc/evil`, and command-substitution targets must return `blocked: true` with class `cross-root-write`.
- **S3**: `settle-unlaunched-attempt` must settle a native attempt when the idle bound parent transcript proves an `execute` tool part that:
  - contains exactly one static `odf_delegation_prepare` call bound to the attempt, change, and phase;
  - contains exactly one static `odf_delegation_launch` call for the same change;
  - has `state.status: "error"`, `state.error: {type: "aborted", message: "Tool execution interrupted"}`, `executed: false`, and no `state.content` output;
  - has no child identity in the part, state, error, or metadata; and
  - is not followed by any `subagent`, `task`, `odf_delegation_launch`, `odf_delegate`, or `odf_parallel_delegate` tool part.
- **S4**: The recovery must be fail-closed. A completed `execute` with output, a recorded launch/subagent child, a mismatched attempt/change/phase, multiple prepare/launch candidates, or a later launch call must not settle.
- **S5**: The settlement must append one terminal failed/cancelled ledger record and persist audit evidence without a raw delegation token.
- **S6**: Both fixes are delivered in this PR and verified against the installed pack; no fix is left only on a local branch or worktree.
- **S7**: A real orphaned native attempt with the aborted-execute shape was settled with the new proof in an isolated runtime. No project, session, or attempt identifiers are retained in this document.

## Tasks

- **T1** (S1, S2): Done. The first broad angle-bracket/bare-`/` exemption was rejected by independent verification because it hid real redirects. The narrowed fix allows only a bare `/` that is a complete shell word (prose backtick close counted; quote/`$`/path continuations still inspected). 46/46 safety tests.
- **T2** (S3, S4, S5): Done. 60/60 recovery tests, 1/1 new integration test, 532/532 focused delegation/recovery tests.
- **T3** (S1-S5): Done. Typecheck, registry validation, diff check, full suite on rerun: 45 files / 1244 Vitest tests and 331 YAML scenarios passed, exit 0. The first aggregate run hit the known Vitest worker timeout; the isolated YAML run passed 331/331.
- **T4** (S6): Done. The code was installed from the merged tree and the installed files were compared byte-for-byte with the source.
- **T5** (S7): Done. A real orphaned attempt with the aborted-execute shape was settled through the installed proof; the ledger is terminal and the audit contains hash-only evidence.

## Log

- **L1**: "genera los fix del harnes, y luego mezclalos a main, no dejes fix huerfanos que despues se pierdan"
- **L2**: Diagnosis: a BUILD prompt containing ``filter=/<url-encoded regex>/`` was falsely blocked because `>/` was parsed as a redirect to `/`.
- **L3**: Diagnosis: a native attempt had no child; the parent transcript contained an aborted `execute` with prepare+launch and no result. The installed pack had only the pre-tool-safety and aborted-`subagent` proofs.
- **L4**: T1 RED: new safety regressions failed. GREEN after the narrowed bare-root skip; the real prompt returns `blocked: false`.
- **L5**: T2 RED: new recovery positive tests failed. GREEN after `inspectNativeExecuteLaunchNotExecuted` and `settle-unlaunched-attempt` wiring; the real transcript yields `native-execute-launch-not-executed`.
- **L6**: T3 verification: typecheck, registry validation, diff check, 1244 Vitest tests, and 331 YAML scenarios passed.
- **L7**: T4 delivery: installed the merged code and verified source/installed parity.
- **L8**: T5 observation: the first runtime call used an old in-memory plugin; a standalone runtime loaded the new proof and settled the real attempt with hash-only audit evidence.
- **L9**: Independent verifier blocker: the first safety fix allowed real `>/"..."` and `<file>/...` redirects. Correction: removed the broad angle-bracket exemption and skip a bare `/` only when it is a complete shell word.
- **L10**: Correction verification: five bypass regressions pass alongside the original prose case; full suite, typecheck, registry validation, and diff check pass on rerun.
- **L11**: Independent recheck: all bypass cases block, the exact regex-prose case remains allowed, the broad exemption is gone, and the installed safety file matches the source. Verdict: CLEAR.
