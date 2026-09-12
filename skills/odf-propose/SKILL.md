---
name: odf-propose
description: "Create an ODF change proposal with business context, scope, and approach. Trigger: Phase 0 (PROPOSE) of /odf-new."
license: MIT
metadata:
  author: adruban
  version: "1.2"
---

## Activation Contract

Use as the first phase after preflight in `/odf-new`. Transform the user's requirement into a structured proposal document: business problem, scope boundaries, capabilities, approach, risks. This is the bridge between "what the user wants" and "what ASSESS will analyze."

NEVER write code, functional specs, or config guides in this phase. Only the proposal document.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| No code | Produce only the proposal document. No analysis beyond scope/approach |
| Grilling upstream | The orchestrator owns the interactive grilling (frontier rounds) before delegation. Consume its resolved decisions; never re-interview the user from this phase |
| Size budget | Proposal MUST be under 300 words. Bullet points and tables over prose |
| Capabilities section | Must be filled — it's the contract with ASSESS |
| Rollback plan | Every proposal MUST have one |
| Success criteria | Every proposal MUST have measurable criteria |

## Decision Gates

| Condition | Action |
|-----------|--------|
| User changes scope | Update proposal, re-present for approval |
| User cancels | Archive the change gracefully without handing off to ASSESS |
| Proposal approved | `next_recommended: ["assess"]` |

## Execution Steps

### Step 0: Consume the Grilling (Interactive Mode Only)

The orchestrator owns the interactive grilling BEFORE this phase is delegated: it resolves the design tree in **frontier rounds** (one round of answerable questions per turn, each numbered with a recommended answer), fetching environment facts itself instead of asking for them. In `interactive`, the delegation carries the resolved decisions.

- Incorporate those decisions and assumptions into the proposal; never re-interview the user or invent new questions from this phase.
- If a decision that changes scope, risk, or rollback is still open, return `blocked` naming the missing decision — never guess or ship an assumed answer.
- In `batch` and `auto`, the grilling round is skipped; the proposal proceeds from the approved intent and Expectations.

### Step 1: Load Skills

Read shared conventions: `skills/_shared/persistence-contract.md`, `skills/_shared/result-contract.md`, `skills/_shared/odoo-sources.md`.

### Step 2: Write Proposal

Produce a structured proposal document in the response:

```markdown
## Proposal: {Change Name}

### Intent
{What problem are we solving? Why Odoo? Why now?}

### Scope
**In scope:**
- {deliverable 1}
- {deliverable 2}

**Out of scope (deferred):**
- {explicit non-goal 1}
- {explicit non-goal 2}

### Capabilities
**New:** <kebab-name> — {one-line description}
**Modified (spec-level):** <existing-capability> — {what behavior changes}

### Decisions
- {resolved grilling decision, with the chosen option}
- {assumption explicitly accepted by the user}

### Approach
{High-level: standard Odoo config, custom module, migration, or integration. 2-3 sentences max.}

### Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| {module/path} | New/Mod/Rem | {what changes} |

### Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| {risk} | Low/Med/High | {mitigation} |

### Rollback Plan
{How to revert. Be concrete.}

### Success Criteria
- [ ] {measurable outcome}
- [ ] {verifiable condition}
```

### Step 3: Persist Artifact

Use the selected store from `persistence-contract.md` and record the returned
canonical `artifact_ref`. Do not require `mem_*`; preserve the full proposal.

### Step 4: Return Summary

```markdown
## PROPOSE Complete

**Change**: {change-name}
**Status**: awaiting approval

### Summary
- Strategy hint: {standard | custom | unclear}
- Scope: {N items in, N deferred}
- Risk level: {Low/Medium/High}

### Next Step
Run ASSESS phase for functional analysis
```

## Output Contract

Keep the proposal semantics and summary above, then end the response with the
shared `## ODF Result` envelope from `skills/_shared/result-contract.md`.
Use `blocked` while awaiting interactive approval or user input, `ok` only after
approval and handoff to ASSESS, and `failed` only for an execution error. Set `artifacts_saved` to the
persisted proposal artifact and `next_recommended` to `["assess"]` after
approval, or `[]` when cancelled.

## Changelog

- 2026-09-12: Interactive grilling is orchestrator-owned; the proposal records resolved Decisions.
- 2026-07-31: Standardized result status for approval, handoff, and execution errors.

## References

- `skills/_shared/result-contract.md` — shared inner result envelope and status semantics.
- `skills/_shared/persistence-contract.md` — selected artifact-store persistence convention.
