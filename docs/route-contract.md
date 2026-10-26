# Route and stage contract

This document is the human-readable matrix of the workflow contract. The source
of truth is code:

- Routes: `odf-plugin/odf-workflow.ts` (`ROUTES`, `advanceWorkflow`).
- Stage artifacts and handoff gates: `odf-plugin/odf-artifact-contract.ts`
  (`ARTIFACT_GROUPS`, `CANONICAL_ARTIFACT_TYPES`, `STAGE_ARTIFACT_REQUIREMENTS`,
  `HANDOFF_GATES_BY_STAGE`).
- Delegation stages and roles: `odf-plugin/odf-delegation-contract.ts`.
- Status and handoff derivation: `odf-plugin/odf-workflow-status.ts`.

The permanent regression test is `odf-plugin/odf-route-contract.test.ts`. It
walks every route, every transition, every stage/role, and every artifact/gate
requirement.

## Route matrix

| Work type | Entry | Stages | Terminal | Plan | Verification | Closure |
|---|---|---|---|---|---|---|
| `question` | `EXPLORE` | `EXPLORE` | `EXPLORE` | none | none | Ephemeral report via `/odf-explore`; not bound. |
| `investigation` | `EXPLORE` | `EXPLORE` | `EXPLORE` | none | none | Ephemeral report via `/odf-explore`; not bound. |
| `standard-config` | `DECIDE` | `DECIDE` | `DECIDE` | none | none | Complete at `DECIDE`; no archive. |
| `small-change` | `DECIDE` | `DECIDE → BUILD → VERIFY` | `VERIFY` | inline | required | Archive after terminal VERIFY. |
| `feature-inline` | `DECIDE` | `DECIDE → BUILD → VERIFY` | `VERIFY` | inline | required | Archive after terminal VERIFY. |
| `feature` | `DECIDE` | `DECIDE → PLAN → BUILD → VERIFY` | `VERIFY` | required | required | Archive after terminal VERIFY. |
| `cross-domain` | `DECIDE` | `DECIDE → PLAN → BUILD → VERIFY` | `VERIFY` | required | required | Archive after parallel BUILD and terminal VERIFY. |
| `bugfix` | `FIX` | `FIX → BUILD → VERIFY` | `VERIFY` | inline | required | Archive after terminal VERIFY. |
| `migration` | `DECIDE` | `DECIDE → PLAN → BUILD → VERIFY` | `VERIFY` | required | required | Archive after terminal VERIFY. |
| `security` | `DECIDE` | `DECIDE → PLAN → BUILD → VERIFY` | `VERIFY` | required | required | Archive after terminal VERIFY. |
| `verify-only` | `VERIFY` | `VERIFY` | `VERIFY` | none | required | Archive after terminal VERIFY. |

`/odf-explore` is the supported path for `question` and `investigation`: it
does not bind workflow state or persist a formal change. Do not start those two
work types through `/odf-new`. `standard-config` is a real formal route, but its
lifecycle ends at `DECIDE`; `/odf-archive` is reserved for routes that reach
`VERIFY`.

`feature-inline` is the default standard-feature route. It keeps the human
Intent + Expectations contract and drops the formal PLAN. Its `DECIDE` stage has
three modes, selected deterministically at entry:

| Mode | Entry signal | DECIDE behavior |
|---|---|---|
| `skip` | Clear intent, known module, no risk, no assess trigger | Terminal bind writes `decision` before BUILD. |
| `assess` | Redundancy hit, existing `models/`/`security/`/`data/`/`migrations/`/`wizard/`/`report/`/`controllers/` surface, >10 expected files, unknown module, unclear intent, or explicit `--assess` | One bounded ASSESS delegation writes the canonical `decision` before BUILD. |
| `escalate` | `feature`/`cross-domain`/`migration`/`security`, OCA target, or a protected risk signal | The formal `feature` route keeps DECIDE + PLAN. |

ASSESS in `assess` mode is a decision assessment, not a functional spec: it
returns strategy (standard-coverage / custom / extend-existing), scope, affected
areas, risks, unknowns, and a bounded reason. It does not create `proposal`,
`assess`, `design`, `qa-plan`, or `tasks` artifacts.

The entry builds one bounded, reference-only Context Manifest after the gate and
approved Expectations, and forwards it unchanged to ASSESS and BUILD. See
[Context contract](context-contract.md). Redundancy is a gate signal here, not a
blocking user question.

## Stage matrix

| Stage | Roles | Canonical artifact | Completion | Gates | Stage commit |
|---|---|---|---|---|---|
| `DECIDE` | `PROPOSE`, `ASSESS` | `decision` | `decision` or `propose` + `assess` | safety, receipt-clear | `ASSESS` commits `DECIDE`. |
| `PLAN` | `QA-PLAN`, `DESIGN` | `plan` | `plan` or `design` | safety, receipt-clear | `DESIGN` commits `PLAN`. |
| `BUILD` | — | `implement-progress` | progress checklist terminal, or a terminal accepted build artifact | safety, receipt-clear, policy-gate, validation-evidence | Validation verified and progress terminal; batches stay `batch-verified` until then. |
| `VERIFY` | — | `verify-report` | terminal verify report | safety, receipt-clear, policy-gate, validation-evidence | Verify evidence verdict and policy gate bind. |
| `FIX` | — | `fix` | `fix` or `fix-progress` | safety, receipt-clear | Bind terminal FIX writes `fix.yaml`; no delegation commit. |
| `EXPLORE` | — | `explore` | `explore` or `explore-progress` | safety, receipt-clear | None; exploratory and ephemeral. |

Role rules:

- `DECIDE` requires `PROPOSE` or `ASSESS`.
- `PLAN` requires `QA-PLAN` or `DESIGN`.
- `BUILD`, `VERIFY`, `EXPLORE`, and `FIX` reject a role.
- `agent` is an optional override and must be eligible for the resolved role.

## Handoff and gate rules

A stage hands off only when its completion artifact set is satisfied:

- `DECIDE` accepts a canonical `decision` artifact, or both `propose` and
  `assess`.
- `PLAN` accepts a canonical `plan` artifact, or a `design` artifact.
- `BUILD` requires terminal implementation progress (or an accepted legacy
  build artifact) plus the policy gate and validation evidence.
- `VERIFY` requires a terminal `verify-report` plus the policy gate and
  validation evidence.
- `ARCHIVE` requires terminal VERIFY evidence for routes that include VERIFY,
  and blocks pending receipts, running attempts, and running joins.

`odf_workflow_status.next_handoff` names the previous stage artifacts and the
gates required by the next stage. It is advisory: `BUILD` and `VERIFY` starts
trust the persisted completed stages as the workflow commit record. An audited
`odf_workflow_override` can skip `DECIDE` or `PLAN`; `BUILD` and `VERIFY` can
never be skipped.

The validation-evidence proof still uses the role labels `phase: "IMPLEMENT"` or
`phase: "VERIFY"` inside `.odf/validation-evidence-{change}.json`. That is a
proof label, not a delegation input; all producers and consumers agree on it.

## Verification

```bash
npx vitest run odf-plugin/odf-route-contract.test.ts
```

The test fails if a route stage loses its artifact/gate definition, a role stops
mapping to its stage, a handoff cannot be built, a route cannot advance to
complete, or a terminal stage changes without updating this matrix.

Decision-quality reports (route agreement, risk/plan distribution, first-pass
yield, rework, receipts, overrides, stage activity), period comparison, review
cadence, and human-approved proposals live in `docs/decision-evaluation.md` and
run with:

```bash
node scripts/odf-evaluation.js decisions [days] [--root <dir>] [--md]
```
