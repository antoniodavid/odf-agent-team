# OCA AI Governance Policy v1

Canonical source: [OCA Generative AI / LLM Policy](https://github.com/OCA/.github/blob/master/AI_POLICY.md)

This policy applies only when `target=oca` is explicitly selected. It is a
concise operational profile of the canonical policy; the canonical source
remains authoritative.

## Human-only obligations

- Every contribution MUST come from a human who understands it and accepts
  full responsibility for it. AI MUST NOT replace human judgment.
- Humans MUST supervise agentic tools. Unsupervised agentic tools MUST NOT be
  used for OCA contributions.
- A human MUST be able to explain and defend every contributed line. “The AI
  wrote it” is not an answer.
- Reviewers and contributors MUST engage with review feedback rather than
  regenerate and resubmit without addressing it.
- AI-generated review comments MUST NOT be posted.
- AI-generated summaries MAY be posted only after a human verifies all content
  and assumes responsibility for the result.
- A human MUST assess relevance, scope, quantity, rate, and quality. Humans
  SHOULD wait for acknowledgement before sending another contribution.
- Human acknowledgement is required before commit, review, or PR publication;
  automation MUST NOT fabricate or record that acknowledgement.

## Automatable checks

- If AI assisted commit development, the commit SHOULD include one
  `Assisted-by:` trailer per model or agent. The same disclosure SHOULD appear
  in the PR description. AI tools MUST NOT appear in `Co-authored-by:`.
- Tooling SHOULD record minimal provenance and MUST reject path traversal and
  secret-like labels or paths.
- Tooling SHOULD report changed files and lines. The OCA reference point is a
  patch under 30 lines in one file; a contribution over 500 lines SHOULD have
  prior maintainer agreement.
- Humans MUST apply the rate and quality guardrails: more than 5 PRs or 10
  reviews from one source in 24 hours triggers scrutiny, and repeated
  regeneration without engagement is unacceptable. Any two applicable red
  lines may lead to rejection; acceptance remains a reviewer decision.

## Disclosure template

```text
## AI disclosure
Assisted-by: <model-or-agent>

Human acknowledgment (complete manually): I reviewed, understand, and take
responsibility for this contribution and any AI-assisted review or summary.
```
