# Context Manifest contract

The Context Manifest is the **Context** half of the ICE contract
(Intent + Context + Expectations). It is a bounded, reference-only snapshot the
harness builds once at entry and forwards unchanged to the entry role and every
BUILD batch.

It is **not** a specification, a prompt, a source dump, or a workflow artifact.
It carries references and counts so a delegated agent can start from known
facts instead of re-discovering the project on every stage.

## Invariants

- **Reference-only.** No source contents, prompts, diffs, secrets, or PII.
- **Bounded.** Every collection has a fixed cap; unsafe or malformed values are
  dropped and reported in `missing_facts`.
- **Built once.** Build it after the assessment gate and approved Expectations.
  Do not rebuild it per stage while module, Odoo version, scope, and
  Expectations stay unchanged.
- **Forwarded unchanged.** Pass the returned JSON under `## Context Manifest` to
  the entry role (ASSESS for `feature-inline`) and to every BUILD batch.
- **Not persisted as a workflow artifact.** The selected store keeps
  Expectations, the decision, progress, and verify evidence. On resume, reuse
  the approved Expectations and rebuild the manifest once.
- **Stale is explicit.** If the manifest is missing or its facts changed, the
  consumer performs bounded discovery and reports `manifest-stale`.

## Schema

| Field | Type | Meaning |
|---|---|---|
| `version` | `1` | Schema version. |
| `project` | string \| null | Project identifier from `odf-init/{project}`. |
| `odoo_version` | number \| null | Target Odoo version. |
| `module` | string \| null | Primary module. |
| `domain` | string \| null | Functional domain. |
| `dependencies` | string[] | Relevant module dependencies (max 32). |
| `references.files` | string[] | Selected repository-relative files (max 64). |
| `references.symbols` | string[] | Known symbols (max 64). |
| `references.tests` | string[] | Known test files (max 64). |
| `source_roots` | string[] | Active source roots (max 4). |
| `source_roots_status` | `available` \| `missing` \| `unsafe` \| `unavailable` | Whether roots are usable. |
| `authority_evidence_refs` | string[] | Reference-only authority evidence (max 64). |
| `authority_status` | status | Whether source authority is usable. |
| `missing_facts` | string[] | Generated and explicit gaps (max 32). |
| `candidate_digest` | string \| null | Candidate digest when one already exists. |
| `codegraph.status` | status | CodeGraph availability. |
| `codegraph.reference` | string \| null | Reference to the index/query, never graph content. |
| `redundancy.probed` | boolean | Whether the redundancy probe ran. |
| `redundancy.hits` | number | Existing-implementation hits (0-1000). |
| `redundancy.contradictions` | number | Contradictory prior learnings (0-1000). |
| `redundancy.references` | string[] | Safe references only (max 16). |
| `assessment_gate.mode` | `skip` \| `assess` \| `escalate` | Entry gate decision. |
| `assessment_gate.reason` | string | Bounded reason (max 512). |
| `assessment_gate.signals` | string[] | Gate signals (max 16). |
| `expectations_ref` | string \| null | Canonical reference to the approved Expectations artifact. |
| `manifest_digest` | string | SHA-256 of the canonical payload; changes when any field changes. |

## Example

```json
{
  "version": 1,
  "project": "customer-erp",
  "odoo_version": 18,
  "module": "sale",
  "domain": "sales",
  "dependencies": ["sale", "stock"],
  "references": {
    "files": ["sale/models/sale_order.py", "sale/views/sale_order_views.xml"],
    "symbols": ["sale.order"],
    "tests": ["sale/tests/test_sale_order.py"]
  },
  "source_roots": ["odoo/custom/src/odoo"],
  "source_roots_status": "available",
  "authority_evidence_refs": ["sale/views/sale_order_views.xml"],
  "authority_status": "available",
  "missing_facts": [],
  "candidate_digest": null,
  "codegraph": { "status": "available", "reference": "codegraph/query-1" },
  "redundancy": {
    "probed": true,
    "hits": 1,
    "contradictions": 0,
    "references": ["sale/models/sale_order.py"]
  },
  "assessment_gate": {
    "mode": "assess",
    "reason": "One bounded functional assessment is required before BUILD.",
    "signals": ["existing-code-surface"]
  },
  "expectations_ref": "openspec/changes/discount-by-category/expectations.yaml",
  "manifest_digest": "<sha256>"
}
```

## Redundancy and ASSESS

For `feature-inline`, redundancy is a **gate signal**, not a blocking question:

- `hits = 0` and `contradictions = 0` → the gate may stay `skip`.
- A hit or contradiction selects `assess`.
- The lean ASSESS resolves the result as `standard-coverage`,
  `extend-existing`, `custom`, `complex`, or `blocked`.

Do not ask the user to choose extend / already-implemented / cancel for
`feature-inline`. The formal `feature` route keeps its existing presentation.

## Verification

```bash
npx vitest run odf-plugin/odf-context-manifest.test.ts
```

The test covers digest stability, collection caps, unsafe-value rejection, and
the tool boundary.
