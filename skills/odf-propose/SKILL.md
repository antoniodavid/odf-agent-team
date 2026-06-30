---
name: odf-propose
description: "Create an ODF change proposal with business context, scope, and approach. Trigger: Phase 0 (PROPOSE) of /odf-new."
license: MIT
metadata:
  author: adruban
  version: "1.0"
---

## When to Use

Use as the first phase after preflight in `/odf-new`. Transform the user's requirement into a structured proposal document: business problem, scope boundaries, capabilities, approach, risks. This is the bridge between "what the user wants" and "what ASSESS will analyze."

NEVER write code, functional specs, or config guides in this phase. Only the proposal document.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| No code | Produce only the proposal document. No analysis beyond scope/approach |
| Questions first | Before finalizing, offer the user a question round for business decisions |
| Size budget | Proposal MUST be under 300 words. Bullet points and tables over prose |
| Capabilities section | Must be filled — it's the contract with ASSESS |
| Rollback plan | Every proposal MUST have one |
| Success criteria | Every proposal MUST have measurable criteria |

## Decision Gates

| Condition | Action |
|-----------|--------|
| User changes scope | Update proposal, re-present for approval |
| User cancels | `status: cancelled`. Archive change gracefully |
| Proposal approved | `next_recommended: ["assess"]` |

## Execution Steps

### Step 0: Question Round (Interactive Mode Only)

Before writing the proposal, offer the user 3–5 business questions via the `question` tool (or plain text if the tool is unavailable — list the questions and ask the user to answer one by one). Explain that these clarify scope and risks before investing in a full assessment. Cover the smallest useful subset of:

1. Business problem — what pain, opportunity, or cost drives this change now?
2. Target users — who is affected, in which workflow, at what moment?
3. Business rules — policies, thresholds, compliance, invariants the solution must respect
4. Scope boundaries — what belongs in the first slice vs deferred vs explicitly excluded
5. Risks — what could go wrong, what's the rollback plan?

After answers, summarize assumptions and ask if the user wants a second round or to proceed.

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

```
mem_save(
  title: "odf/{change}/propose",
  topic_key: "odf/{change}/propose",
  type: "architecture",
  capture_prompt: false,
  content: {full proposal markdown}
)
```

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
