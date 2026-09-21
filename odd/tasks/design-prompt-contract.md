# DESIGN Prompt Contract Refinement

## Objective

Make ODF DESIGN guidance shorter and more deterministic by separating phase contract, precision invariants, source authority, domain guidance, and task-specific context.

## Problem

The backend DESIGN guidance already enforces closed designs and source checks, but its permanent rules are mixed with implementation details. Ambiguity handling, backend/frontend ownership, and target-version authority can be made explicit without adding a new abstraction or changing runtime behavior.

## Scope

- Refine `agent/odoo_backend_engineer.md` with explicit DESIGN/IMPLEMENT boundaries, technical-versus-product ambiguity handling, source-authority order, and minimal-change invariants.
- Refine `skills/odf-design/SKILL.md` with compact precision and authority rules while preserving the closed-design contract.
- Synchronize the `odf-design` registry compact rules, version, and changelog.
- Leave frontend ownership, plugin runtime behavior, and existing design artifact schemas unchanged.

## Constraints

- Preserve all existing closed-design requirements and ODF Result fields.
- Do not hardcode OWL or Odoo APIs that should be resolved from target-version source.
- Do not introduce a new agent, abstraction, or workflow phase.
- Preserve unrelated tracked and untracked work in the current worktree.

## Authorized scope and route

- Authorized files: `agent/odoo_backend_engineer.md`, `skills/odf-design/SKILL.md`, `odf-registry.json`, and this task document.
- Route: delegated direct writer for the three non-trivial prompt/registry files; parent validates registry and wording.
- Artifact language: English.

## Checklist

- [x] D1 — Add the layered DESIGN/IMPLEMENT and precision contract to the backend agent.
- [x] D2 — Add source-authority and ambiguity rules to the DESIGN skill without duplicating the design schema.
- [x] D3 — Synchronize registry compact rules, skill version, and changelog.
- [x] D4 — Validate registry paths/JSON and inspect the final diff.

## Acceptance criteria

- DESIGN closes implementation-relevant decisions and returns `blocked` for unresolved product decisions instead of asking or guessing.
- IMPLEMENT consumes the closed design and reopens DESIGN for missing decisions.
- Technical ambiguity is resolved from repository/source evidence; product ambiguity is surfaced.
- Backend owns integrated module DESIGN but explicitly hands client seams to the frontend specialist.
- Odoo/OWL version behavior is resolved from target source, not prompt memory.
- Registry metadata and compact rules match the skill file.

## Verification

- `node scripts/odf-registry-validate.js`
- `ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js` — passed
- JSON parse of `odf-registry.json`
- `git diff --check`
- targeted search for removed duplicate/version-hardcoded guidance

## Progress

- User authorized applying the prompt improvements.
- Current design contract and frontend ownership boundary were inspected before editing.
- Scoped edits were present after the delegated writer cancellation and were verified by the parent.
- Verification passed: repository registry validation, JSON parsing, whitespace checks, and targeted removal checks.
- Next step: refresh the installed ODF registry and restart OpenCode before using the updated agent/skill prompts.
