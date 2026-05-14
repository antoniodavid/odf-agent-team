---
name: oca-chained-pr
description: "Split oversized OCA PRs (>400 lines) into reviewable chained PRs. Trigger: PR >400 lines, SDD forecast High risk, 'chained', 'stacked PR'."
license: Apache-2.0
metadata:
  author: antoniodavid
  version: "1.0"
---

## When to Use

Load this skill when a planned PR exceeds **400 changed lines**, SDD forecasts `budget risk: High`, or the user asks for chained/stacked PRs.

## Hard Rules

| Rule | Requirement |
|------|-------------|
| Split PRs over 400 lines | Unless a maintainer accepts `size:exception` |
| ≤60 min review per PR | Each PR must be reviewable in about 60 minutes |
| Tests+docs stay with unit | Tests and docs belong with the work unit they verify |
| State boundaries | Every chained PR must state: start, end, dependencies, follow-up, out-of-scope |
| Dependency diagram | Child PRs must include a diagram with current PR marked `📍` |

## Decision Gates

| Condition | Strategy |
|-----------|----------|
| PR ≤400 lines and focused | Keep single PR |
| PR >400, each slice lands independently | Stacked PRs to main (each targets main) |
| PR >400, must integrate before main | Feature Branch Chain with tracker PR |
| Generated/vendor/migration can't split | Ask maintainer for `size:exception` |
| SDD provides `delivery_strategy` | Follow it before PR creation |

## Execution Steps

1. **Estimate**: Count changed lines (`git diff --stat`). Identify independent work units.
2. **Choose strategy**: ≤400 → single PR. >400 → ask user for chain strategy.
3. **Create branches**: Per strategy rules. Add Chain Context to each PR.
4. **Verify per PR**: CI/tests/docs independently. Clean diff per PR.
5. **Track**: Keep tracker PR draft/no-merge until all child PRs are approved.

## Output Contract

Return: chosen strategy, PR order, current PR boundary, dependency diagram, review budget (`additions + deletions`), verification plan, `size:exception` rationale if applicable.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/oca/01-oca-governance/oca-pr-workflow.md` — OCA PR workflow context
