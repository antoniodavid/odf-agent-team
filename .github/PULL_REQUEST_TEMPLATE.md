<!-- Link exactly one approved issue in this repository. Choose a closing
keyword (Closes/Fixes/Resolves #N) or the non-closing keyword (Refs #N). -->
Closes #<issue-number>

## PR Type

Check exactly one and apply the matching `type:*` label.

- [ ] Bug fix (`type:bug`)
- [ ] Feature (`type:feature`)
- [ ] Documentation (`type:docs`)
- [ ] Maintenance/tooling (`type:chore`)

## Summary

-

## Changes

| File | Change |
| --- | --- |
|  |  |

## Evidence and test plan

- [ ] `npm run typecheck`
- [ ] `npm run test:unit -- --testTimeout=30000`
- [ ] `npm run test:yaml`
- [ ] `node scripts/odf-registry-validate.js`
- [ ] `git diff --check`
- [ ] Manual/runtime validation, or explain why it is not applicable

## Review checklist

- [ ] Linked one approved issue with the intended closing/non-closing keyword
- [ ] Exactly one matching `type:*` label is applied
- [ ] At most 400 changed lines, or `size:exception` is applied with a rationale and explicit human acceptance
- [ ] Relevant documentation is updated, or explain why none is needed
- [ ] Benchmarks are complete, or explain why they are not applicable
- [ ] Commit uses the required Conventional Commit format and has no AI `Co-authored-by:` trailer
- [ ] I reviewed the complete submission and take responsibility for it

## AI assistance

- [ ] No AI assistance
- [ ] AI-assisted contribution — describe the assistance:
- [ ] AI-generated code/content — describe what was generated:

Identify the tool/model when AI was used. For `target=oca`, follow
`policies/oca-ai-policy.md`, including its `Assisted-by:` commit trailer when
applicable.

Human acknowledgment (complete manually): I reviewed, understand, and take
responsibility for this contribution.

## Merge Danger

**Door:** one-way / two-way

**Blast Radius:** low / medium / high
