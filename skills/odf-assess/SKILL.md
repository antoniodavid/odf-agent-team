---
name: odf-assess
description: "Assess Odoo requirement: determine standard vs custom strategy, analyze functional feasibility, produce functional spec. Trigger: Phase 1 (ASSESS) of /odf-new."
license: MIT
metadata:
  author: adruban
  version: "2.0"
---

## Activation Contract

Use only for Phase 1 (ASSESS) of `/odf-new`, after PROPOSE and preflight. Match
requirements, version, and standard-vs-custom feasibility; do not implement.

## When to Use

Use as Phase 1 of /odf-new, after PROPOSE. Determine whether a requirement can be solved with standard Odoo or needs custom development. NEVER write code in this phase — only specs or config guides.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Standard Odoo first | When the strategy is unclear, investigate settings/automated actions/studio BEFORE custom code; skip exploration when the proposal strategy hint + Expectations already determine standard vs custom |
| No code | Produce only specifications (custom) or configuration guides (standard) |
| Version required | Confirm Odoo version before any analysis |
| Plan requirements numbered | Use REQ-01, REQ-02 format for the technical plan |
| RFC 2119 | Use MUST/SHALL/SHOULD/MAY in requirements |
| Human Expectations kept separate | Do NOT replace the human `EXP-XX` from the `expectations` artifact. Reference `EXP-XX` in each REQ, never rename them as REQ |

## Decision Gates

| Condition | Action |
|-----------|--------|
| All requirements covered by standard | strategy: standard. Produce step-by-step config guide. next_recommended: [] |
| Any gap exists | strategy: custom. Produce functional spec for gaps only. next_recommended: ["design"] |

## Execution Steps

1. **Detect version**: Read __manifest__.py or use provided version
2. **Map keywords to domains**: Identify which Odoo areas are involved (sale, stock, account, etc.)
3. **Check standard first (only when unclear)**: If the proposal strategy hint is `standard` or `custom` and the Expectations are clear, skip exploration and go straight to gap analysis + spec. Otherwise search local Odoo source + NotebookLM for existing features.
4. **Read human Expectations**: Load the `expectations` artifact (approved `EXP-XX`). These are the immutable human contract. Do NOT re-author or rephrase them.
5. **Find gaps**: Document what standard CAN and CANNOT do per requirement
6. **Produce output**: Config guide (standard) or functional spec (custom) with numbered REQ-XX for the technical plan, each REQ referencing the `EXP-XX` it covers, plus Given/When/Then scenarios
7. **Persist**: Save the full assessment in the selected store and return its
   canonical `artifact_ref`; do not require `mem_*`.

## Completion Criteria

The phase is DONE only when ALL hold (checkable, not vibes):

- Every REQ-XX has a numbered RFC 2119 requirement with a Given/When/Then scenario; no requirement is left as prose.
- Strategy is decided (`standard | custom | migration | integration`) and the standard-vs-custom reasoning names the exact standard modules/fields considered.
- For `standard`: the configuration guide covers every REQ. For `custom`: the functional spec has no open questions.
- Every non-core dependency of the affected module is resolved against the active sources or flagged (see odf-init dependency_matrix).
- The artifact is persisted in the selected store with a canonical `artifact_ref` in the ODF Result.

## Output Contract

Return ODF Result envelope with: status (ok), executive_summary, strategy (standard|custom), artifacts_saved, next_recommended (["design"] or []), risks, odoo_version, modules_affected.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/persistence-contract.md` — selected store and artifact references
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
