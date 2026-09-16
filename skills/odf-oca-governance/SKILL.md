---
name: odf-oca-governance
description: "Trigger: target=oca, OCA contribution, OCA commit, OCA PR, OCA review, Assisted-by. Apply the OCA AI governance gate before publication."
license: MIT
metadata:
  author: "odf-agent-team"
  version: "1.0"
---

## Activation Contract

Load this skill only when the work explicitly sets `target=oca`. Apply it to
OCA code, documentation, discussions, commits, reviews, and pull requests.

## Hard Rules

- Load `policies/oca-ai-policy.md` and `policies/oca/rules.yaml` before acting.
- Record minimal AI provenance with the governance provenance tool when AI
  assisted the work. Keep the canonical policy as the source of truth.
- Run `odf_governance_check` before commit, review publication, or PR
  publication. Treat `human_ack_required: true` as unresolved until a human
  explicitly acknowledges it.
- Keep `Assisted-by:` separate from `Co-authored-by:` and disclose AI use in
  the PR description when applicable.
- Never auto-commit, auto-publish, or treat this check as the ODF VERIFY
  verdict; a human owns acknowledgement and `odoo_qa_engineer` owns VERIFY.

## Decision Gates

| Condition | Action |
| --- | --- |
| `target` is not explicitly `oca` | Do not apply this profile. |
| AI assisted the contribution | Record provenance and recommend trailers. |
| AI appears in `Co-authored-by:` | Stop and correct the disclosure. |
| Human acknowledgement is absent | Stop publication and ask the human. |

## Execution Steps

1. Load the policy and machine-readable rules.
2. Record agent/model labels and affected files without secrets.
3. Run the read-only governance check against the selected worktree.
4. Present its findings and disclosure template; wait for human acknowledgement.

## Output Contract

Return the check result, provenance path, disclosure template, unresolved human
action, and any trailer or path violations. Never claim human acknowledgement.

## References

- `policies/oca-ai-policy.md` — concise operational policy.
- `policies/oca/rules.yaml` — machine-readable profile.
- `agent/odoo_code_reviewer.md` — advisory review contract and no-VERIFY ownership.
- `docs/skill-style-guide.md` — skill authoring contract.
