---
name: odf-design
description: "Create a CLOSED technical design document + IMPLEMENT plan for Odoo module. Trigger: Phase 2 (DESIGN) of /odf-new after ASSESS approved."
license: MIT
metadata:
  author: adruban
  version: "3.1"
---

## Activation Contract

Use only for Phase 2 (DESIGN) after ASSESS is approved and its REQ-XX plus the
approved human EXP-XX artifact are available. Return a closed design or block.

## When to Use

Use after ASSESS returns strategy: custom. Produce a **closed** design document
per `docs/design-contract.md` that resolves EVERYTHING IMPLEMENT will need (module
destination, models, views, security, EXP-XX), then derive the IMPLEMENT task
plan from it. The orchestrator will approve before IMPLEMENT.

## Principle

> IMPLEMENT does not re-investigate. If IMPLEMENT needs a decision not fixed
> here, DESIGN is re-opened — never improvised in IMPLEMENT.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Read source first | Read the real Odoo module source being extended/inherited BEFORE designing |
| Read EXP-XX | Read the `expectations` artifact (EXP-XX, from `docs/expectations-contract.md` and the store) as input |
| Resolve all EXP-XX | Every EXP-XX must have a concrete resolution row; a design missing any is NOT closed |
| No code | Use the contract's TABLES (fields, views, tasks). Do NOT write Python/XML in the design — IMPLEMENT writes the code |
| Reference by ID | Reference EXP-XX/REQ-XX by ID; do not restate the full expectation statement (it lives in expectations.yaml) |
| Fix the module | Decide the exact target module (new vs inherit) in DESIGN — never leave it to IMPLEMENT |
| Traceability | Every task links to a REQ-XX and the EXP-XX it resolves |
| Security required | Every new model MUST have ir.model.access.csv (per group) + ir.rule if applicable |
| Tests required | Every feature MUST have at least one test task |
| OCA conventions | File structure, naming, manifest follow OCA standards |

## Decision Gates

| Condition | Action |
|-----------|--------|
| Single module | One module, 3 phases: Foundation → Views → Tests |
| Multi-module (2+) | Design per module: Primary first (all phases), then secondary. Prefix task IDs (A1.1, B1.1) |
| Complex architecture | Include architecture decisions with rationale + rejected alternatives |

## Execution Steps

1. **Retrieve** the assess artifact (REQ-XX) and `expectations` artifact
   (EXP-XX) through the selected store.
2. **Read the module**: Read the real Odoo source module being extended/inherited.
3. **Produce the design document** per `docs/design-contract.md` (ALL sections):
   Context (module + manifest_depends), EXP-XX resolution table, data model
   (`_name`/`_inherit`, fields/types/constraints, computed/onchange), views + UI
   (actions + menus + wizard), security, data/migration, IMPLEMENT plan.
4. **Fix the module destination** exactly (new vs inherit) — do not leave it open.
5. **Derive the IMPLEMENT plan** from the document: each task links to exact
   file(s) + the EXP-XX it resolves.
6. **Verify closure internally** using `docs/design-contract.md` §8 — do NOT
   copy the checklist into the document as a section. If not closed, iterate
   before returning; if a decision genuinely cannot be resolved, return `blocked`
   listing the open decisions.
7. **Persist** in the selected store with `artifact_ref`, `design_path`,
   `design_closed`, and `design_meta`. Derive `design_meta` from the closed
   document per `docs/design-contract.md` §"design_meta": count models, fields,
   views, tasks, EXP-XX rows; `module_type` from the "Fix the module" decision;
   `manifest_depends`/`odoo_version` from the context. Include `design_meta` in
   the envelope and as part of the persisted artifact. If it cannot be derived
   (empty document / no data), return `design_meta: null` with `reason` — never
   invent values.

## Output Contract

Return ODF Result envelope with: status (ok), executive_summary ("N modules, M
models, V views, K tasks in M phases — design closed"), **design_closed** (true|false),
**design_path** (path of the persisted design.md), **design_meta** (structured summary
for estimation — see `docs/design-contract.md`), artifacts_saved,
next_recommended (["implement"]), risks, odoo_version, modules_affected. If
`design_closed: false`, do NOT return ok — iterate or return blocked.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/persistence-contract.md` — selected store and artifact references
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
- `docs/design-contract.md` — The design document contract + closed-design checklist
- `docs/expectations-contract.md` — EXP-XX format and immutability
