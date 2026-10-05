---
name: odf-batch-implement
description: "Trigger: bounded batch, work unit, IMPLEMENT batch, timeout-sensitive, T8/T9/T10, tests, evidence. Execute one route-aware Odoo implementation slice."
license: MIT
metadata:
  author: adruban
  version: "1.3"
---

## Activation Contract

Use only for IMPLEMENT work explicitly bounded as a batch/work unit,
timeout-sensitive slice, or T8/T9/T10 implementation/evidence batch. Ordinary
backend/frontend IMPLEMENT work stays with its domain specialist.

## Hard Rules

- Before editing, require the persisted `work_type`, authoritative route plan mode, completed entry stage, approved Expectations, and exact approved scope. For `plan: required`, require the approved spec, `design_closed: true` design, and closed design tasks. For `plan: inline`, require the approved inline implementation tasks and QA plan; formal ASSESS/DESIGN/task artifacts are not prerequisites. Never infer route from absent artifacts. Batch 1 may initialize `implement-progress`/apply-progress; continuation batches require existing progress and must merge it, never overwrite it.
- **Keep `implement-progress` a checklist.** BUILD is terminal only when its selected canonical artifact is terminal; the `implement-progress` checklist must have every step marked `[x]` (or a success `status:` line). A prose slice log is not terminal and the commit gate refuses the stage. Older `tasks.md` / `apply-progress.md` files are legacy fallbacks only when no canonical `build` or `implement-progress` artifact exists; they cannot override an incomplete canonical artifact. `build_completed`/`completed_canonical_stages` are state-record keys read from `state.yaml`, not from the artifact — writing them here changes nothing.
- Implement one cohesive batch, normally 1-3 related tasks/files. Do not redesign, broaden scope, or re-research settled decisions.
- Write code early in vertical slices; add tests with the code. When effective strict TDD is on, prove red before implementation.
- Merge progress and task status before final validation evidence; keep technical output English. These candidate-affecting artifacts must be settled before digest capture, and the `.odf` evidence file is written last.
- Ordinary IMPLEMENT policy gates currently return `candidate_digest: null`; leave the optional evidence field omitted/null instead of copying null, reusing a stale value, or inventing one. Targeted fast-lane and VERIFY evidence must use the authoritative digest their route requires; if unavailable, block rather than guess.
- Never perform destructive database setup.
- For view/XML/QWeb/OWL view work, record source-authority evidence; otherwise report that source authority is not required.

## Decision Gates

- Missing/ambiguous artifacts or a batch beyond the boundary means stop and return `blocked`.
- If a long development-DB test is required, run the exact project command once against the exact user-authorized database, capture command/database/exit evidence, and do not retry indefinitely.
- Any code-writing or test-command timeout is partial/blocked evidence, never `ok`.

## Execution Steps

1. Read the forwarded task, persisted route context, approved Expectations, and the route-appropriate plan inputs: spec/closed design/tasks for `plan: required`, or bounded inline tasks/QA plan for `plan: inline`. Read source authority and project test command. Read existing progress for continuation; initialize minimal progress for batch 1 when absent. If route context or required inputs are missing/contradictory, stop as `blocked` before editing.
2. Implement the selected vertical slice and its test; avoid unrelated files.
3. After the slice's focused tests pass, finalize/merge progress and task artifacts from those results.
4. Run the required focused checks and authorized DB command against the settled candidate (once when required). If a check requires any source or progress change, settle the artifacts again and rerun the affected required checks before recording evidence.
5. Write validation evidence last with actual outputs and only the route-appropriate candidate digest; `.odf` evidence itself is excluded from the candidate manifest. Report files, exits, unfinished work, and conditional source-authority refs for view work.

## Output Contract

Return the shared `## ODF Result` with `status`, `executive_summary`, `strategy`, `batch_summary`, `artifacts_saved` using canonical `artifact_ref`, `validation_evidence`, `next_recommended`, `risks`, `odoo_version`, `modules_affected`, and `skill_resolution: injected | self-discovered | none`. Include `source_authority_required: true` plus `source_authority_refs: [{file, line, claim}]` for view work, or `false` plus `[]` otherwise. Use `blocked` for missing inputs, incomplete evidence, or timeouts.

## Changelog

- 1.3 - Settle progress before validation evidence and clarify route-specific candidate digests.
- 1.2 - Allow route-approved inline-plan BUILD without requiring formal ASSESS/DESIGN/task artifacts.
- 1.1 - Allow batch 1 progress initialization and require conditional view source evidence.

## References

- `~/.config/opencode/skills/_shared/odoo-sources.md` — local Odoo source authority
- `~/.config/opencode/skills/_shared/result-contract.md` — shared result envelope
- `~/.config/opencode/skills/_shared/persistence-contract.md` — selected artifact store
- `~/.config/opencode/skills/odf-implement/SKILL.md` — base IMPLEMENT rules
