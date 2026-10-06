---
name: odf-qa
description: "QA workflow for ODF: test planning, coverage analysis, test review, quality gates. Trigger: /odf-qa or orchestrator needs QA in any phase."
license: MIT
metadata:
  author: adruban
  version: "2.2"
---

## Activation Contract

Every code-changing route needs a concise QA plan that maps approved human
`EXP-XX` to at least one focused test/check and includes relevant regression or
edge paths. Keep that minimum plan inline for `small-change` and `bugfix`; do not
create a separate `qa-plan` artifact or add a QA-PLAN handoff for those routes.
Use QA-PLAN, QA-REVIEW, QA-AGGREGATE, or QA-REPORT only when explicitly routed
by ODF, such as a route requiring PLAN or a risk/complexity escalation.
`EXP-XX` is the primary acceptance criterion; REQ-XX is technical traceability
derived from it. Do not approve QA on REQ-XX coverage alone when an approved
expectation is missing or untested.

## When to Use

Use for formal test strategy planning (after ASSESS) when PLAN/QA-PLAN is
required, test review (during IMPLEMENT), coverage aggregation (before VERIFY),
or final QA reporting (after VERIFY), when ODF routes that QA lens. For an
inline-plan route, keep the focused test/check plan with the existing work; do
not add a separate QA delegation merely to produce an artifact.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Run actual coverage | Use coverage tools — don't estimate coverage percentages |
| Trace to expectations | Start from every approved EXP-XX, then map through REQ-XX to tests; an untested EXP-XX blocks the acceptance verdict |
| Flag untested paths | Identify critical paths without test coverage — don't ignore them |
| Choose the test class | Select the narrowest valid class: `TransactionCase` for ORM transactions, `SavepointCase` for savepoint behavior, `HttpCase` for browser/tour flows, and focused JS tests for frontend behavior. Do not impose one class universally |
| Seams before scenarios | Declare the public seams under test before writing scenarios: prefer the highest existing seam, propose new seams at the highest point, keep their number minimal, and confirm them. No scenario is written at an unconfirmed seam |
| Integration fixtures | For API integrations, capture a real request/response pair at the client adapter seam and replay it in tests; never assert against a live external service |

## Decision Gates

| Phase | Input | Output |
|-------|-------|--------|
| Minimum QA (every code-changing route) | Approved Expectations + project test configuration | Focused test/check plan tied to each expectation, carried inline for small changes/bugfixes |
| QA-PLAN (conditional) | Assess artifact + approved Expectations | Test scenarios (unit/integration/E2E) + coverage targets + fixture design + persisted `qa-plan` |
| QA-REVIEW | Test files from IMPLEMENT | Test quality report (isolation, assertions, coverage delta) |
| QA-AGGREGATE | All batch results | Aggregate coverage report + requirements traceability |
| QA-REPORT | All QA artifacts | Final QA metrics + quality gate status + verdict |

## Execution Steps

1. **Minimum QA (always for code changes)**: In the existing inline plan, map each approved EXP-XX to a focused test/check and identify relevant regression/edge paths. The implementer runs the configured checks; VERIFY remains the authoritative test/evidence gate.
2. **QA-PLAN (conditional)**: When explicitly routed, read approved EXP-XX first, map REQ-XX from assess, choose the narrowest suitable test class per behavior, **declare the seams under test (highest, fewest, confirmed)**, design scenarios for every expectation, set coverage targets per module type, and persist as `qa-plan`.
3. **QA-REVIEW**: When routed, review test quality (isolation, meaningful assertions, coverage toward targets) → flag issues → persist as `qa-review`.
4. **QA-AGGREGATE**: When routed, collect batch results → generate aggregate coverage → map to requirements → identify untested paths → persist as `qa-aggregate`.
5. **QA-REPORT**: When routed, compile final metrics → build requirements traceability matrix → evaluate quality gates → persist as `qa-report`.

## Output Contract

Return the complete shared ODF Result envelope, including every required common
field (especially `strategy` and `skill_resolution`), plus the QA summary.
`artifacts_saved` contains only QA artifacts actually
produced by the routed work (`qa-plan`, `qa-review`, `qa-aggregate`,
`qa-report`); do not claim formal QA artifacts for an inline plan. When tests
ran, report measured results and approved-expectation coverage; otherwise state
what remains for BUILD/VERIFY without implying a pass.

## References

- `~/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `~/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths
