# ODF cross-root write safety fix

Repository: `odf-agent-team`
Scope: make command-aware cross-root write detection reject external destinations without rejecting external read sources.

## Specs

- S1: "revisa y corrige el error"
- S2: The reported failure was `pre-tool-safety: cross-root-write` during PROPOSE after the user supplied an absolute destination inside the workspace. No token, agent session, or code write was created.

## Tasks

- T1 (S1-S2): Update command-aware cross-root destination detection and regression tests; route IMPLEMENT; commits `96eccdd` and `30dca3a`.

## Log

- L1: revisa y corrige el error
- L2: Reproduction showed `cp /external/source /workspace/destination` is blocked because the scanner treats the external source as a write target, while a destination outside the workspace must remain blocked.
- L3: Independent verification found that authorized-root prefix matching accepted sibling paths such as `/home/dev/project` for `/home/dev/proj`; the correction adds a path-boundary check and a regression.
