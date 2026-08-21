---
name: odf-implement
description: "Implement Odoo tasks from design artifact. Write code following spec + design. Trigger: Phase 3 (IMPLEMENT) of /odf-new after DESIGN approved."
license: MIT
metadata:
  author: adruban
  version: "2.2"
---

## Activation Contract

Use only for Phase 3 (IMPLEMENT) after DESIGN is approved and the current
design artifact proves `design_closed: true`. A missing, false, stale, or
unverifiable value is a hard block that reopens DESIGN; IMPLEMENT must never
annotate and continue.

## When to Use

Use after DESIGN returns approved task breakdown. Implement assigned tasks in batches. Follow functional spec and design strictly — do NOT freelance different approaches.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Specs are acceptance criteria | Read REQ-XX from assess before implementing each task |
| Follow design decisions | If design is wrong, NOTE IT — don't silently deviate |
| Tests with code | Tests belong in the same commit as the behavior they verify |
| Smoke tests per batch | Run pre-commit + pylint-odoo on changed files after each batch |
| Stop-validation evidence | After each batch, run the tier's stop-validation commands and write `<worktree>/.odf/validation-evidence-{change}.json` — a batch WITHOUT verified evidence does NOT close |
| Mark tasks as you go | Update task status immediately, not at the end |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Task blocked by unexpected issue | Stop batch, report status: blocked to orchestrator |
| Design is not closed (`design_closed !== true`) | Block IMPLEMENT, persist the reason, and re-open DESIGN before any code change or task update |
| Pre-commit or pylint errors | Fix immediately before proceeding |
| Stop-validation evidence not verified (`validation.status !== "verified"`) | Do NOT close the batch — fix, re-run the commands, rewrite the evidence file |
| All tasks in batch complete | Persist progress, return for next batch or VERIFY |

## Execution Steps

1. **Retrieve**: Read assess (functional spec) + the current design (task breakdown) from the selected store. Verify `design_closed === true`; otherwise stop, return `blocked` with `next_recommended: ["design"]`, persist the reopen reason, and do not edit code or task status.
2. **Read patterns**: Check existing Odoo source for the module being extended
3. **Implement tasks**: For each task → read REQ-XX → read source patterns → write code (OCA standards) → mark [x]
4. **Smoke test**: pre-commit run --files {changed} + pylint-odoo on changed files
5. **Write stop-validation evidence**: run the tier's stop-validation commands and write `<worktree>/.odf/validation-evidence-{change}.json`. The Policy Gate decision injected in your prompt carries the authoritative `risk_tier`, `frozen_diff_ref`, and `candidate_digest` — use them. Minimum commands per tier (use the project's real commands from `odf-init/{project}`; no fabricated exit codes):
   - **LOW**: ≥ 1 — e.g. `git diff --check` (+ AST parse of changed `.py`, or `xmllint --noout` when only views changed)
   - **MEDIUM**: ≥ 2 — LOW + module lint (pre-commit `--files` or pylint-odoo) + module tests (`test_command`)
   - **HIGH**: ≥ 3 — MEDIUM + `pre-commit run -a` + automated security scan (grep for `env.cr.execute` with interpolation, `eval(`, `subprocess` with `shell=True`)
     - **Running module tests**: use the project's `testing.test_command` from `odf-init/{project}` and substitute `{module}` only. The persisted Docker template is `docker compose run --rm odoo odoo -d {test_db} -i {module} --test-enable --stop-after-init`; the local template is `odoo-bin -d {test_db} -i {module} --test-enable --stop-after-init`. A command without the exact `-d {test_db}` is invalid for Odoo DB tests. Disposable databases remain preferred. A named non-isolated development database is allowed only for the current run when the current user-approved scope names that exact database and authorizes its use. State that status in the phase result/evidence and warn that tests may mutate module, schema, and test data. If the exact database or authorization is missing, block and ask rather than guessing. Consent to use it does not authorize `dropdb`, `createdb`/reset/restore, `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, `DROP SCHEMA`, or destructive re-initialization; those require separate current consent for the exact operation and database and are not automatic test setup.
   - Evidence format:
   ```json
   {
     "change": "my-change", "phase": "IMPLEMENT", "batch": 1,
     "risk_tier": "MEDIUM", "frozen_diff_ref": "<same ref as the policy gate>",
      "candidate_digest": "<same digest as the policy gate>",
     "resolved_at": "<ISO-8601>",
     "commands": [
       { "name": "git-diff-check", "command": "git diff --check", "exit_code": 0, "output_tail": "..." },
        { "name": "odoo-tests", "command": "docker compose run --rm odoo odoo -d {test_db} -i {module} --test-enable --stop-after-init", "database": "{test_db}", "exit_code": 0, "output_tail": "... 0 failed ..." }
     ]
    }
    ```
    - When `{test_db}` is non-isolated, include the non-isolated/user-authorized statement and mutation warning in the ODF Result and evidence.
   - Evidence is smoke for THIS batch — the compliance matrix, review lenses, and correction budget remain in VERIFY. Do not grow this into a parallel VERIFY.
6. **Persist progress** in the selected store with its canonical `artifact_ref`.
   Update the selected task/design artifact with [x] marks as applicable.

## Output Contract

Return ODF Result envelope with: status (ok|warning|blocked), executive_summary ("N/M tasks done. Smoke: pass/warn."), batch_summary (completed tasks, files changed, deviations from design, smoke test results), artifacts_saved, next_recommended (["implement"] or ["verify"]), risks, modules_affected, validation_evidence (path to the evidence file + command/exit_code summary — REQUIRED for IMPLEMENT batches).

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/persistence-contract.md` — selected store and artifact references
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
