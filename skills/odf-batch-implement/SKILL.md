---
name: odf-batch-implement
description: "Trigger: bounded batch, work unit, IMPLEMENT batch, timeout-sensitive, T8/T9/T10, tests, evidence. Execute one closed-design Odoo implementation slice."
license: MIT
metadata:
  author: adruban
  version: "1.1"
---

## Activation Contract

Use only for IMPLEMENT work explicitly bounded as a batch/work unit,
timeout-sensitive slice, or T8/T9/T10 implementation/evidence batch. Ordinary
backend/frontend IMPLEMENT work stays with its domain specialist.

## Hard Rules

- Before editing, require an approved spec, `design_closed: true` design, closed tasks, and the exact approved scope. Batch 1 may initialize `implement-progress`/apply-progress; continuation batches require existing progress and must merge it, never overwrite it.
- Implement one cohesive batch, normally 1-3 related tasks/files. Do not redesign, broaden scope, or re-research settled decisions.
- Write code early in vertical slices; add tests with the code. When effective strict TDD is on, prove red before implementation.
- Merge progress, task status, and required validation evidence in the selected ODF store. Keep technical output English.
- Never perform destructive database setup.
- For view/XML/QWeb/OWL view work, record source-authority evidence; otherwise report that source authority is not required.

## Decision Gates

- Missing/ambiguous artifacts or a batch beyond the boundary means stop and return `blocked`.
- If a long development-DB test is required, run the exact project command once against the exact user-authorized database, capture command/database/exit evidence, and do not retry indefinitely.
- Any code-writing or test-command timeout is partial/blocked evidence, never `ok`.

## Execution Steps

1. Read the forwarded task, spec, closed design, tasks, source authority, and project test command. Read existing progress for continuation; initialize minimal progress for batch 1 when absent.
2. Implement the selected vertical slice and its test; avoid unrelated files.
3. Run focused checks and the authorized DB command once when required.
4. Persist merged progress and validation evidence; report files, exits, unfinished work, and conditional source-authority refs for view work.

## Output Contract

Return the shared `## ODF Result` with `status`, `executive_summary`, `strategy`, `batch_summary`, `artifacts_saved` using canonical `artifact_ref`, `validation_evidence`, `next_recommended`, `risks`, `odoo_version`, `modules_affected`, and `skill_resolution: injected | self-discovered | none`. Include `source_authority_required: true` plus `source_authority_refs: [{file, line, claim}]` for view work, or `false` plus `[]` otherwise. Use `blocked` for missing inputs, incomplete evidence, or timeouts.

## Changelog

- 1.1 - Allow batch 1 progress initialization and require conditional view source evidence.

## References

- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — local Odoo source authority
- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — shared result envelope
- `/home/adruban/.config/opencode/skills/_shared/persistence-contract.md` — selected artifact store
- `/home/adruban/.config/opencode/skills/odf-implement/SKILL.md` — base IMPLEMENT rules
