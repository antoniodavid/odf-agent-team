---
name: odf-implement
description: "Implement Odoo tasks from the plan required by the persisted workflow route. Write code following approved scope and route-specific inputs. Trigger: BUILD/IMPLEMENT after route approval."
license: MIT
metadata:
  author: adruban
  version: "2.5"
---

## Activation Contract

Use only for a route whose next canonical stage is BUILD (legacy IMPLEMENT),
using the persisted `work_type` and authoritative route context supplied by the
orchestrator. Never infer the plan mode from triage labels or missing artifacts.

- When the route has `plan: required`, require approved ASSESS/Expectations,
  DESIGN with `design_closed: true`, and its closed task breakdown. Missing,
  false, stale, or unverifiable design is a hard block that reopens PLAN.
- When the route has `plan: inline` (`small-change` or `bugfix`), require its
  completed DECIDE/FIX entry evidence, approved Expectations, and the bounded
  inline implementation tasks and QA plan forwarded by the orchestrator. Formal
  ASSESS, QA-PLAN, DESIGN, and task artifacts are not prerequisites for this
  route. Do not invent REQ-XX or pretend a formal design exists.
- A `plan: none` route does not run BUILD. Missing or contradictory route
  context is a hard block; do not choose a route to make implementation eligible.

## When to Use

Implement only the approved work for the persisted route. On formal-plan routes,
follow the approved functional spec and closed design. On inline-plan routes,
follow the approved Expectations and inline task/QA plan; do not silently expand
scope or promote inline notes into formal artifacts.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Route-specific acceptance criteria | On `plan: required`, read REQ-XX from ASSESS for each task; on `plan: inline`, trace each task directly to approved EXP-XX and the inline task/QA plan |
| Follow approved decisions | On formal-plan routes follow DESIGN; on inline routes follow the approved inline plan. If either is wrong, NOTE IT and stop for orchestrator disposition |
| Project context | Name per `project_context.glossary` and follow `project_context.principles` from `odf-init/{project}`; a conflict with the approved route plan or a principle is reported and blocked — never silently deviated |
| Tests with code | Tests belong in the same commit as the behavior they verify |
| Smoke tests per batch | Run pre-commit + pylint-odoo on changed files after each batch |
| Stop-validation evidence | Settle all candidate-affecting files (including merged progress/task artifacts), run the tier's stop-validation commands, then write `<worktree>/.odf/validation-evidence-{change}.json` last — a batch WITHOUT verified evidence does NOT close |
| Candidate digest | Ordinary IMPLEMENT policy gates currently return `candidate_digest: null`; omit/null that optional evidence field. Targeted fast-lane and VERIFY evidence must use the authoritative digest their route requires; never guess or reuse a stale value. |
| Mark tasks as you go | Update task status immediately, not at the end |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Task blocked by unexpected issue | Stop batch, report status: blocked to orchestrator |
| Required formal plan is not closed (`design_closed !== true`) | Block IMPLEMENT, persist the reason, and re-open PLAN before any code change or task update |
| Inline-plan inputs are missing, ambiguous, or exceed the approved route scope | Block IMPLEMENT and ask the orchestrator to resolve scope or escalate to formal PLAN before editing |
| Pre-commit or pylint errors | Fix immediately before proceeding |
| Stop-validation evidence not verified (`validation.status !== "verified"`) | Do NOT close the batch — fix the cause, settle candidate-affecting artifacts, re-run the required commands, and rewrite evidence with the route-appropriate digest |
| All tasks in batch complete | Persist progress, return for next batch or VERIFY |

## Execution Steps

1. **Retrieve route-specific inputs** from the selected store and forwarded workflow context. Require the persisted `work_type`, route plan mode, completed entry stage, approved Expectations, and exact approved scope. For `plan: required`, also read ASSESS and DESIGN/tasks and verify `design_closed === true`; otherwise stop with `blocked`, `next_recommended: ["design"]`, and no code/task edits. For `plan: inline`, use the approved Expectations and forwarded inline tasks/QA plan; do not require formal ASSESS/DESIGN/task artifacts. If required inputs are absent or conflict with the persisted route, stop and ask the orchestrator to resolve or escalate.
2. **Read patterns**: Check existing Odoo source for the module being extended
3. **Implement tasks**: For each task, read its REQ-XX on `plan: required` routes or its approved EXP-XX trace on `plan: inline` routes → read source patterns → write code (OCA standards) → run focused tests; mark [x] only after the behavior is verified
4. **Smoke test**: run pre-commit --files {changed} + pylint-odoo on changed files; finish any source/test fixes before proceeding
5. **Finalize progress and task artifacts**: merge progress into the existing canonical artifact and update task status only from actual verification results. These files can be part of the Git candidate, so complete all such edits before final validation evidence/digest capture.
6. **Run stop-validation and write evidence last**: run the tier's required stop-validation commands against the settled candidate, capture their real outputs, then write `<worktree>/.odf/validation-evidence-{change}.json` as the final candidate-related write. `.odf/` evidence is excluded from the candidate manifest; do not edit code, tests, progress, or other candidate files after capturing any required digest. The Policy Gate supplies the authoritative `risk_tier` and `frozen_diff_ref`; its `candidate_digest` is null for ordinary IMPLEMENT, so omit/null that optional field. Targeted fast-lane or VERIFY evidence must carry the exact digest required by that route; if it is unavailable, stop as blocked rather than guess or reuse a stale digest. Minimum commands per tier (use the project's real commands from `odf-init/{project}`; no fabricated exit codes):
   - **LOW**: ≥ 1 — e.g. `git diff --check` (+ AST parse of changed `.py`, or `xmllint --noout` when only views changed)
   - **MEDIUM**: ≥ 2 — LOW + module lint (pre-commit `--files` or pylint-odoo) + module tests (`test_command`)
   - **HIGH**: ≥ 3 — MEDIUM + `pre-commit run -a` + automated security scan (grep for `env.cr.execute` with interpolation, `eval(`, `subprocess` with `shell=True`)
     - **Running module tests**: use the project's `testing.test_command` from `odf-init/{project}` and substitute `{module}` only. The persisted Docker template is `docker compose run --rm odoo odoo -d {test_db} -i {module} --test-enable --stop-after-init`; the local template is `odoo-bin -d {test_db} -i {module} --test-enable --stop-after-init`. A command without the exact `-d {test_db}` is invalid for Odoo DB tests. Disposable databases remain preferred. A named non-isolated development database is allowed only for the current run when the current user-approved scope names that exact database and authorizes its use. State that status in the phase result/evidence and warn that tests may mutate module, schema, and test data. If the exact database or authorization is missing, block and ask rather than guessing. Consent to use it does not authorize `dropdb`, `createdb`/reset/restore, `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, `DROP SCHEMA`, or destructive re-initialization; those require separate current consent for the exact operation and database and are not automatic test setup.
   - Evidence format:
   ```json
   {
     "change": "my-change", "phase": "IMPLEMENT", "batch": 1,
     "risk_tier": "MEDIUM", "frozen_diff_ref": "<same ref as the policy gate>",
     "resolved_at": "<ISO-8601>",
     "commands": [
       { "name": "git-diff-check", "command": "git diff --check", "exit_code": 0, "output_tail": "..." },
        { "name": "odoo-tests", "command": "docker compose run --rm odoo odoo -d {test_db} -i {module} --test-enable --stop-after-init", "database": "{test_db}", "exit_code": 0, "output_tail": "... 0 failed ..." }
     ]
    }
    ```
    - When `{test_db}` is non-isolated, include the non-isolated/user-authorized statement and mutation warning in the ODF Result and evidence.
   - Evidence is smoke for THIS batch — the compliance matrix, review lenses, and correction budget remain in VERIFY. Do not grow this into a parallel VERIFY.
7. **Return evidence and progress refs** in the ODF Result. Do not make further
   candidate-file edits after writing validation evidence; all canonical design,
   task, and progress updates must already be persisted.

## Test Discipline

- **Confirm seams first**: before writing any test, state the public seams under test and get the user's confirmation. No test is written at an unconfirmed seam. Prefer the highest seam; the fewer seams across the codebase the better.
- **Anti-patterns to avoid**:
  - *Tautological*: the assertion recomputes the expected value the same way the code does — it can never disagree. Expected values come from an independent source (known-good literal, worked example, spec).
  - *Horizontal slicing*: all tests first, then all implementation. Work in vertical slices: one test → one implementation → repeat.
  - *Implementation-coupled*: mocks internal collaborators or tests private methods; the test breaks when behavior doesn't change.

## Completion Criteria

A task is DONE only when ALL hold:

- The behavior is verified: a test that fails without the change passes with it (or, for user-run/manual acceptance, recorded evidence exists) — never "it compiles, so it works".
- No task is marked `[x]` without its verification evidence; no `[ ]` task is claimed as done.
- Pre-commit and pylint-odoo pass on the changed files (auto-fixable failures fixed, not suppressed).
- Progress is merged with the existing `implement-progress` artifact (never overwritten).
- **BUILD is terminal only when its selected canonical artifact is terminal.** Use `implement-progress.md` as the checklist: every step must be marked `[x]`, or the artifact must carry a success `status:` line. A prose slice log with no checklist is *not* terminal, and the commit gate will refuse the stage. Older `tasks.md` / `apply-progress.md` artifacts are legacy fallbacks only when no canonical `build` or `implement-progress` artifact exists; they cannot override an incomplete canonical artifact. Before reporting DONE, confirm the canonical checklist is complete — the workflow status adapter reports `Progress is unknown: … has no checklist` when it is not.
- **Do not mirror state-record keys into the artifact.** `build_completed`, `build_done` and `completed_canonical_stages` are read from `state.yaml`; writing them into `implement-progress.md` has no effect and the stage stays blocked.
- Tests live with the code they verify in the same commit unit.
- Every XML ID/model written in the code resolves in the local source (run `odf-toolkit verify-refs` on the module before closing the batch); invented IDs are a BLOCKER.

## Output Contract

Return ODF Result envelope with: status (ok|warning|blocked), executive_summary ("N/M tasks done. Smoke: pass/warn."), batch_summary (completed tasks, files changed, deviations from the approved route plan, smoke test results), artifacts_saved, next_recommended (["implement"] or ["verify"]), risks, modules_affected, validation_evidence (path to the evidence file + command/exit_code summary — REQUIRED for IMPLEMENT batches).

## References

- `~/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `~/.config/opencode/skills/_shared/persistence-contract.md` — selected store and artifact references
- `~/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
