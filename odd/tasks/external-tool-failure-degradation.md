# External-tool failure degradation
Objective: Keep unaffected, authorized ODF work moving when an external tool fails without weakening canonical state or required gates.
Branch: `fix/external-tool-failure-degradation` | Baseline: `719169337e6a1a261acfb9364a9264752613be43` | Delivery: `ask-on-risk` | Runner: `npm run test:yaml`

## Specs

### S1 — Preserve integrity and continue independent work
User request: “y porque el harness esta tan dependiente de engram, si responde mal, ya no se podra continuar con el trbajo?, me parece un error de arquitectura, se debe resolver que si engram o cualquier tool externa presenta algun error, el harness mantiene su integridad y continua el trabajo”

Authorized scope: Update the ODF orchestrator's failure policy so an external-tool failure is confined to the affected operation and subsequent work that depends on it. Continue other already-authorized, independent work when safe. Preserve typed failure evidence and pending state. Do not infer that failure means missing state or success; do not change the selected artifact store, bypass a required gate, fabricate evidence, or retry an unchanged failure except through an existing bounded recovery.

Acceptance: The prompt contract explicitly distinguishes “stop the affected stage/dependent transition” from “stop the entire user request”; independent work can continue while canonical state, receipts, validation, and safety gates remain authoritative. A deterministic prompt scenario pins the behavior.

Checks: `npm run test:yaml`, `npm run test:unit`, `npm run validate:skills`.

### S2 — Safe degradation policy
User selected: “Degradación segura (Recomendado)”. The selected policy means: “Continuar trabajo local o independiente de la herramienta fallida; conservar el paso afectado como pendiente/reintentable y bloquear solo las transiciones que dependan de ese estado o evidencia. Sin cambiar de almacén ni saltar gates.”

Acceptance: Existing bounded retries, single-store authority, receipt handling, and child-liveness rules remain unchanged; failure of one dependency does not authorize fallback or completion of dependent work.

Checks: Regression scenarios retain existing stop/retry behavior for required gates and dependent transitions.

## Tasks
- T1 — S1-S2; route: inline; status: complete; commit: `49b8470`. Updated the orchestrator contract and YAML prompt scenario; focused/suite checks and independent verification passed.

## Log
- L1 — User request, verbatim: “y porque el harness esta tan dependiente de engram, si responde mal, ya no se podra continuar con el trbajo?, me parece un error de arquitectura, se debe resolver que si engram o cualquier tool externa presenta algun error, el harness mantiene su integridad y continua el trabajo”
- L2 — User selected the safe-degradation policy: continue local or independent work; keep the affected step pending/retryable; block only transitions dependent on unavailable state/evidence; do not switch stores or bypass gates.
- L3 — Read-only map: `agent/odoo_orchestrator.md` previously stopped the run on blocked/failed results and unresolved workflow status. ODF-owned child launch/seal paths already keep uncertain attempts pending and avoid duplicate prompts; selected-store and receipt writes fail closed. The prompt contract now scopes failures to dependent work while allowing safe independent continuation.
- L4 — Replika export diagnosis: `engram-export.json` was valid but scoped to `odf-agent-team`; it contained no Replika observations and cannot establish the Replika workflow state.
- L5 — Test-first evidence: after adding the external-failure contract to the YAML fixture and before changing the orchestrator prompt, `npm run test:yaml` reproduced the expected RED (`330 passed, 1 failed`), with the sole failure being the exact prompt-contract comparison. After updating `agent/odoo_orchestrator.md`, the same command was GREEN (`331 passed, 0 failed`).
- L6 — Verification: `npm run test:unit` passed (54 files, 1,492 tests); `npm run validate:skills` passed (51 skills, 0 errors). Receipt-driven development is explicitly off globally; no native review lifecycle is due under the user-owned switch.
- L7 — Independent verification: S1 and S2 both met with no blockers. The verifier ran `npm run test:yaml` on baseline and candidate scratch copies (331 passed, 0 failed in each), plus candidate `npm run test:unit` (54 files, 1,492 tests), `npm run validate:skills` (51 skills, 0 errors), and `npm run typecheck` (ok). Parent spot-check reran `npm run test:yaml` (331 passed, 0 failed); `git diff --check` passed. Verifier scratch was removed.
- L8 — Risk: item 3 (the orchestrator instructions define a shared workflow contract consumed by downstream ODF runs; incorrect failure-continuation behavior could alter those contracts).
- L9 — Work-unit commit: `49b8470` (`fix(odf): degrade safely on external tool failures`) contains T1 and its regression fixture. This tracking-document update closes the feature.
