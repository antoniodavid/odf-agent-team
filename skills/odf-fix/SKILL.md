---
name: odf-fix
description: "Lightweight 3-step bugfix flow: DIAGNOSE → FIX → VERIFY. Trigger: /odf-fix, bugfix request, error report, 'this is broken'."
license: MIT
metadata:
  author: adruban
  version: "2.3"
---

## Activation Contract

Use for `/odf-fix` targeted, reproducible bugs with a bounded 1-3 file scope.
It may chain the three steps without human phase approvals, but policy,
evidence, VERIFY, and risk escalation remain mandatory.

## When to Use

Use odf-fix for targeted bugs where the problem is known and scope is small (1-3 files). Do NOT use for new features, architectural changes, or unclear scope — use /odf-new instead.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| No gates | No human phase-approval pauses: run DIAGNOSE → FIX → VERIFY continuously. This does not remove policy gates, validation evidence, VERIFY, or risk escalation; `odf_policy_gate` and those checks remain mandatory and may block |
| Root cause first | Identify root cause BEFORE modifying any code |
| Test validates fix | Include a test that fails without the fix |
| Scope escalation | If diagnosis reveals >3 files or an architectural change, never improvise: finish the diagnosis, report the scope, and escalate the route — continue under the same supervised-auto flow with an inline plan when the fix stays bounded (one root cause, no schema/security/data-loss signals, ≤8 files), or stop for a scope decision when architectural or high-risk |
| One fix per invocation | Do not fix multiple unrelated bugs in one run |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Root cause found, fix is 1-3 files | Proceed to FIX |
| Root cause found, 4-8 bounded files (single root cause, no schema/security/data-loss signals) | Proceed to FIX under the same route with an inline plan; note the scope in the result |
| Root cause involves architecture change or unbounded scope | Escalate to DECIDE → PLAN before editing; stop only for the scope decision |
| Fix affects security or data integrity | Add CRITICAL flag in report |
| Can't reproduce the bug | Stop, report reproduction steps attempted |

## Execution Steps

0. **Build a tight feedback loop FIRST** (this is the skill; everything else is mechanical). Get a fast, deterministic pass/fail signal that goes red on THIS bug before touching code: failing test at the right seam → curl/HTTP script → CLI with fixture diffed against a known-good snapshot → headless browser script → replay a captured trace → throwaway harness → property/fuzz loop → `git bisect run` harness → differential loop (old vs new) → HITL bash script as last resort. Then tighten it (faster, sharper, more deterministic). No loop → no confident fix. If you genuinely cannot build one, stop and say so — list what you tried and ask for environment access, a captured artifact, or instrumentation permission; never proceed to theories without a loop.
1. **MINIMISE**: reproduce through the loop and shrink the repro to the smallest scenario that still goes red — cut inputs, callers, config, and steps one at a time, re-running after each cut. Done when every remaining element is load-bearing.
2. **HYPOTHESES**: write 3-5 ranked, falsifiable hypotheses before testing any: "If <X> is the cause, then <changing Y> makes it disappear / <changing Z> makes it worse." Show the ranked list to the user (continue with your ranking if they are away); discard any hypothesis that has no prediction.
3. **INSTRUMENT**: one variable at a time; every probe maps to a prediction. Debugger/REPL before logs; targeted logs only at boundaries that distinguish hypotheses — never "log everything". Tag every debug log with a unique prefix (`[DEBUG-xxxx]`) so cleanup is a single grep.
4. **FIX**: write the regression test BEFORE the fix, only at a correct seam — one that exercises the real bug pattern as it occurs at the call site. If no correct seam exists, record that as a finding (the architecture blocked the lockdown) and say so. Then apply the fix; follow OCA standards.
5. **VERIFY**: watch the regression test go red before the fix and green after; re-run the original (un-minimised) loop; run pre-commit and module tests on the changed files.
6. **CLEANUP**: original repro no longer reproduces; regression test passes (or the missing seam is documented); every `[DEBUG-...]` log removed; throwaway prototypes deleted; the winning hypothesis stated in the result so the next debugger learns.
7. **Persist** diagnosis, fix progress, verification evidence, learning, and any
   receipt in the selected store; return canonical `artifact_ref` values.

## Redaction

When showing commands, outputs, or captured artifacts, **redact every secret
first** (`<REDACTED>`): API keys, passwords, tokens, auth headers, PII. Keep
credentials in environment variables, never in what you display or persist.
If the redacted output is insufficient to diagnose, say so and ask.

## Output Contract

Return ODF Result envelope with: status (ok|blocked|failed), executive_summary, diagnosis (root cause + file:line), fix_summary (files changed + what changed), test_evidence (command output), risks.

## References

- `~/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `~/.config/opencode/skills/_shared/persistence-contract.md` — selected store and artifact references
- `~/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
