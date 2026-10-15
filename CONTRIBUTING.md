# Contributing

Pull requests should make the change, its evidence, and its merge risk easy to
review. Follow the repository's PR template and keep every required check
honest: mark a box only when its evidence exists.

## Pull request requirements

1. Link exactly one approved issue in this repository using `Closes #N`,
   `Fixes #N`, or `Resolves #N` when the issue should close on merge; use
   `Refs #N` when it should remain open.
2. Apply exactly one matching `type:*` label:

   | Change | Label |
   | --- | --- |
   | Bug fix | `type:bug` |
   | Feature | `type:feature` |
   | Documentation | `type:docs` |
   | Maintenance or tooling | `type:chore` |

3. Keep the PR at or below 400 changed lines. A larger PR needs the
   `size:exception` label, a concise rationale in the PR, and explicit human
   acceptance of the exception. The label does not replace issue approval,
   review, tests, or responsibility for the submitted change.
4. Run and report the applicable checks from the PR template. Update relevant
   documentation when behavior or contributor workflow changes.
5. Select exactly one AI-assistance option in the PR and never use
   `Co-authored-by:` for an AI tool. When `target=oca` is explicitly selected,
   also follow `policies/oca-ai-policy.md`, including its `Assisted-by:`
   disclosure and human-acknowledgment requirements.

## Merge behavior

The CI workflow automatically squash-merges a non-draft, same-repository PR
after its test job succeeds. Keep a PR in draft until its issue link, type and
size labels, rationale, checks, and human review are ready.

## Labels

`size:exception` is reserved for an explicitly accepted exception to the
400-line review budget. Include the reason in the PR description; do not apply
the label by inference. Existing type labels are listed in the table above.
