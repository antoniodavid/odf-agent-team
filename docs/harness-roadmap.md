# ODF Harness Continuous Improvement Roadmap

ODF already has a credible control plane: specialized agents, bounded workflow
routes, persisted state, attempts, receipts, recovery, and risk-aware
verification. The next improvements must strengthen the **authority of its
evidence**, reduce the cost of small changes, and only then add semantic
evaluation and learning.

> **Start with T1.** Do not build a judge, dashboard, RAG layer, or more agents
> before ODF can prove which exact candidate bytes were verified and who
> produced the verification evidence.

## Roadmap authority

- This file is the canonical, team-facing execution roadmap.
- Engram topic `roadmap/odf-world-class-harness/execution-queue` is the recovery
  copy, not an independent source of truth.
- Update task status here and refresh the Engram recovery copy in the same work
  unit.
- Audit baseline: repository HEAD `190584d`, NotebookLM notebook
  `b6f56bd5-c9f9-4571-a72e-293c392b21c6`.

## Executive assessment

The audit rated ODF at approximately **2.5/5**. This is a directional maturity
score, not a benchmark result.

| Plane | Current state | Main gap |
| --- | --- | --- |
| Control | Strong | Legacy paths can still bypass strict proof requirements |
| Evidence | Weak | Candidate identity and VERIFY receipts are not strongly bound |
| Data | Weak | No real token, model-version, tool-call, or trace coverage |
| Evaluation | Weak | Fixtures and error rates do not measure semantic correctness |
| Safety | Weak | No systematic pre-tool PII/injection/path corpus |
| Learning | Partial | Metrics exist, but verified runs do not yet drive memory or skills |

The target is not “more machinery.” The target is a smaller set of trustworthy
contracts that can prove:

1. which candidate was reviewed and tested;
2. which actor produced each piece of evidence;
3. why the workflow selected its route and risk tier;
4. whether the result satisfies human-owned expectations;
5. what the harness learned without promoting unverified behavior.

## Execution rules

1. Execute one reviewable work unit at a time.
2. Keep behavior, tests, and user-facing documentation in the same work unit.
3. Do not start a task until all dependencies are complete with named evidence.
4. Record a focused test command, exact result, runtime smoke result or explicit
   `N/A`, and rollback boundary for every task.
5. Human blocking is reserved for consent, unresolved product expectations, and
   terminal failure disposition. Mechanical gates should remain silent.
6. Do not force a full SDD planning cycle on a bounded roadmap task whose
   outcome and acceptance criteria are already clear.
7. Do not add a state, flag, framework, agent, or parallel representation unless
   a measured failure proves it is needed.
8. If a work unit approaches 400 authored changed lines, split it by behavior,
   not by file type.

## Status legend

| Marker | Meaning |
| --- | --- |
| `[ ]` | Pending |
| `[~]` | In progress |
| `[x]` | Complete with evidence |
| `[!]` | Blocked; continuation must be named |
| `[-]` | Removed because evidence showed it was unnecessary |

## Delivery sequence

| Release slice | Tasks | Outcome |
| --- | --- | --- |
| A — Evidence authority | T1–T3 | Candidate identity and VERIFY become trustworthy |
| B — Proportional delivery | T4–T6 | Small changes stop paying the full-pipeline tax |
| C — Trustworthy data | T7–T8 | Evaluation receives complete, honest telemetry |
| D — Semantic quality and safety | T9–T11 | Human expectations, judge calibration, and pre-tool safety |
| E — Verified learning | T12 | Memory and skill proposals learn only from proven runs |

Critical dependency path:

```text
T1 → T2 → T3 → T6 → T7 → T9 → T10 → T12
                ↑
          T4 → T5

T7 → T8
T7 → T11
```

T4–T5 may be implemented in parallel with T1–T3, but proportionality work must
not delay evidence integrity.

---

## P0 — Evidence authority

### [x] T1 — Build a canonical candidate manifest and digest

**Status:** implemented; evidence recorded below.

**Outcome:** `frozen_diff_ref` is replaced or superseded by an identity derived
from the candidate bytes, not merely from `HEAD`.

**Root problem**

- Current policy logic can treat `HEAD` as the frozen reference.
- Untracked files may be absent from the candidate and risk classification.
- Path and mode changes need to participate in identity.

**Minimum implementation**

- Represent the repository base separately from the candidate digest.
- Build a deterministic manifest containing path, status, mode, and content
  identity for staged, unstaged, and untracked files.
- Use existing Git primitives and `node:crypto`; add no dependency.
- Sort and serialize canonically before hashing.
- Keep generated evidence bounded; do not copy candidate contents into metrics.

**Acceptance criteria**

- [ ] The same repository candidate always produces the same manifest and digest.
- [ ] A byte, path, status, or mode change changes the digest.
- [ ] Untracked files participate in the digest.
- [ ] An untracked ACL, migration, or security file participates in risk analysis.
- [ ] Empty candidates have an explicit representation rather than an inferred one.

**Required evidence**

- Focused deterministic tests for tracked, staged, unstaged, untracked, rename,
  delete, and mode-change cases.
- Full Vitest suite and typecheck.
- Rollback boundary: candidate-manifest helper, its integration point, and tests.

**KPI:** 100% of gated candidates have a reproducible digest.

**Implementation evidence (2026-08-17)**

- New `plugins/candidate-manifest.ts`: `buildCandidateManifest`, `computeCandidateDigest`,
  `extractChangedPaths`, `CandidateManifest`/`CandidateEntry`. Source of truth is
  `git status --porcelain=v1 -z --untracked-files=all` plus `git rev-parse HEAD`;
  sha256 per path from `node:crypto`; canonical sort + compact JSON digest. Empty
  candidate has an explicit stable digest. `.odf/` harness state is excluded so
  ODF's own gate saves do not invalidate the candidate.
- Integration in `plugins/odf-delegation.ts`: `PolicyGateDecision` gains
  `candidate_digest` and `base_head` (`frozen_diff_ref` kept for compatibility);
  VERIFY now derives `changed_paths` (including untracked), risk, and the digest
  from the manifest; idempotency compares the real candidate digest, so a
  byte/untracked change invalidates reuse. IMPLEMENT and no-git fail-open (`LOW`)
  are unchanged (the latter is T3).
- Tests: `plugins/candidate-manifest.test.ts` (12 tests: determinism, byte change,
  rename, delete, mode change, untracked participation, untracked security file →
  HIGH risk, integration with `computePolicyGate`, empty candidate, no-git).
- Verification: `npm run test:unit -- plugins/candidate-manifest.test.ts` → 12/12
  pass; `npm run typecheck` → clean; `npm test` → full suite green (411 Vitest +
  126 YAML, 0 failed).
- Runtime smoke: `N/A` — plugin unit tests run with mocked `task()`; no live
  OpenCode/Odoo runtime boundary for this unit.
- Rollback boundary: remove `plugins/candidate-manifest.ts` and
  `plugins/candidate-manifest.test.ts`; revert `plugins/odf-delegation.ts` and
  `plugins/odf-delegation.test.ts`.

**Out of scope:** signing, remote attestation, OTel, or a generalized content
addressable storage layer.

### [x] T2 — Bind gates, attempts, and receipts to the candidate

**Status:** implemented; evidence recorded below.

**Outcome:** changing the candidate invalidates every content-bound decision.

**Dependencies:** T1.

**Minimum implementation**

- Bind policy gate, risk tier, attempt token, validation evidence, and receipt to
  the candidate digest.
- Recompute identity immediately before each content-bound transition.
- Reject reuse when candidate identity changes.
- Preserve the existing bounded-attempt contract; mutation must not silently
  create or consume another budget.

**Acceptance criteria**

- [ ] A mutation after policy classification invalidates that classification.
- [ ] A mutation after BUILD evidence invalidates the evidence.
- [ ] A receipt for candidate A cannot approve candidate B.
- [ ] Retry and resume rediscover committed state without duplicating attempts.

**Required evidence**

- Named `mutation-after-gate`, `mutation-after-build`, and `digest-mismatch`
  regression tests.
- Full Vitest suite and typecheck.

**KPI:** zero accepted stale-candidate fixtures.

**Implementation evidence (2026-08-17)**

- `AttemptLedgerRecord` gains `candidate_digest?: string | null`; recorded at
  `acquireAttempt` (null without Git) and preserved by `settleAttempt`.
- `ValidationEvidenceFile` gains `candidate_digest?: string | null`;
  `validateValidationEvidence` returns `invalid` with reason
  `candidate digest mismatch ...` when the stored digest differs from the fresh
  candidate. Legacy evidence without a digest keeps current behavior.
- `WorkflowReceipt`/`ODFReceipt` gain `candidate_digest?: string | null`;
  `mergeReceipt` writes the fresh digest so a mutated candidate cannot reuse a
  stale receipt, while terminal reads keep the original digest for detection.
- `commitWorkflowTransition` blocks with reason `candidate-digest-mismatch`
  (inside the lock, after `inspectPersistedTransition`) when a persisted gate,
  evidence, or receipt digest differs from the fresh candidate. A mismatch
  never creates or consumes an attempt (bounded-attempt contract preserved);
  null digests (legacy/no-git) do not block (strict enforcement is T3).
- Tests (6 new, named): `mutation-after-gate`, `mutation-after-build`,
  `digest-mismatch`, `compatibility: transitions with no candidate digests are
  not blocked by digest`, `compatibility: legacy evidence without
  candidate_digest still verifies even with git present`,
  `acquireAttempt records the candidate digest and settleAttempt preserves it`.
- Verification: `npx vitest run plugins/odf-delegation.test.ts` → 229/229 pass;
  `npm run typecheck` → clean; `npm test` → full suite green (325 Vitest + 126
  YAML, 0 failed).
- Runtime smoke: `N/A` — plugin unit tests run with mocked `task()`; no live
  OpenCode/Odoo runtime boundary for this unit.
- Rollback boundary: revert `plugins/odf-delegation.ts`,
  `plugins/odf-workflow-status.ts`, and `plugins/odf-delegation.test.ts`.

### [x] T3 — Make VERIFY fail closed with executor-owned receipts

**Status:** implemented; evidence recorded below.

**Outcome:** VERIFY succeeds only with fresh, complete evidence produced by the
execution boundary and bound to the current candidate.

**Dependencies:** T1, T2.

**Minimum implementation**

- Separate an agent's report from the harness/executor's test receipt.
- Require candidate digest, command identity, execution context or database,
  exit code, bounded output evidence, timestamp, test identity, and executor
  identity.
- Validate freshness and candidate binding at the VERIFY transition.
- Return a typed unavailable/blocked result when Git or candidate evidence is
  unavailable. Never degrade to `LOW/allow`.

**Acceptance criteria**

- [ ] `status: passed` without execution evidence is rejected.
- [ ] Stale receipts are rejected.
- [ ] Digest mismatches are rejected.
- [ ] Missing Git or incomplete candidate discovery never permits VERIFY.
- [ ] A complete, fresh, matching receipt permits the expected transition.

**Required evidence**

- One regression test for each invalid shape and one reproducible happy path.
- Full test suite, typecheck, and registry validation.

**KPI:** 100% of successful VERIFY transitions have a fresh bound receipt.

**Implementation evidence (2026-08-17)**

- `computePolicyGate` VERIFY branch no longer degrades to `LOW/allow` when Git is
  unavailable: it returns `gate: "block"` with reason
  `verification-unavailable` (actionable continuation named). `createODFDelegate`
  now maps a blocked gate to a blocked envelope (no delegation). IMPLEMENT
  unchanged.
- `validateValidationEvidence` enforces the VERIFY receipt contract: non-empty
  `commands`; per command `command`, `database`, `exit_code === 0`, and
  output; freshness window; required `candidate_digest` (when Git present);
  required `executor` and `test_identity` (new optional fields on
  `ValidationEvidenceFile`). Status-only/passed-only and legacy weak evidence
  are rejected. IMPLEMENT validation unchanged.
- `commitWorkflowTransition` re-validates the evidence file at the VERIFY
  transition and blocks with `verification-evidence-missing` or
  `verification-evidence-invalid`; digest-mismatch blocking from T2 retained
  without duplication.
- Docs updated surgically: `skills/odf-verify/SKILL.md`,
  `skills/odf-implement/SKILL.md`, `agent/odoo_qa_engineer.md`,
  `command/odf-verify.md` now instruct executors to emit
  `candidate_digest`/`executor`/`test_identity` with the receipt.
- Tests (10 new, named): `verify-fail-closed-without-git` (gate + delegation),
  `verify-rejects-status-only-evidence`, `verify-rejects-missing-required-fields`,
  `verify-rejects-nonzero-exit`, `verify-rejects-stale-evidence`,
  `verify-rejects-missing-executor-or-test-identity`,
  `verify-accepts-complete-fresh-evidence`, `verify-digest-required`, and
  fail-closed transition tests (missing/invalid).
- Verification: `npx vitest run plugins/odf-delegation.test.ts` → 239/239 pass;
  `npm run typecheck` → clean; `npm test` → full suite green (335 Vitest + 126
  YAML, 0 failed).
- Authored diff ≈ 440 lines (above the 400 guidance). If this were re-sliced it
  would split as runtime (`odf-delegation.ts`) then contract/tests; recorded for
  future slices, no rework performed.
- Runtime smoke: `N/A` — plugin unit tests run with mocked `task()`; no live
  OpenCode/Odoo runtime boundary for this unit.
- Rollback boundary: revert `plugins/odf-delegation.ts`,
  `plugins/odf-delegation.test.ts`, `plugins/candidate-manifest.test.ts`, and the
  four doc files.

**Out of scope:** a new CI platform. The first version should strengthen the
existing local execution contract.

---

## P1 — Proportional delivery and enforceable contracts

### [x] T4 — Add deterministic entry triage using existing work types

**Status:** implemented; evidence recorded below.

**Outcome:** `/odf-new` selects the cheapest safe existing route instead of
defaulting small work into the full planning path.

**Dependencies:** none. Execute after T3 unless explicitly run in parallel.

**Do not create new work types.** Project three UX levels onto the routes that
already exist in `plugins/odf-workflow.ts`:

| UX level | Existing work types | Planning behavior |
| --- | --- | --- |
| Micro | `bugfix`, `small-change`, `standard-config` | Inline intent/expectations; no QA-PLAN or DESIGN |
| Standard | `feature` | DECIDE, BUILD, VERIFY; PLAN only where the route requires it |
| Full | `cross-domain`, `migration`, `security` | Full planning and risk controls |

**Micro eligibility**

- One module and one business domain.
- Clear human intent and expectations.
- Expected scope of at most three files.
- No migration, security boundary, payment/money path, public API, or data-loss
  risk. Such work must never be classified as micro.

**Acceptance criteria**

- [ ] Explicit commands such as `/odf-fix` keep their intended route.
- [ ] Migration and security work never select micro.
- [ ] Ambiguity produces at most one user question.
- [ ] Routing output records the selected existing `work_type` and reason.
- [ ] Table-driven tests cover micro, standard, full, and ambiguous inputs.

**KPI:** small changes reach BUILD with at most one human interruption.

**Implementation evidence (2026-08-17)**

- New pure module `plugins/entry-triage.ts` (no I/O): `classifyEntryTriage` +
  `detectRiskSignals` (`security`, `migration`, `payment`, `public-api`,
  `data-loss`). Signals never select micro; explicit work types are respected
  (risk signals escalate an explicit micro choice to full); missing facts
  produce `needs_question` with exactly one grouped question; fallback is
  `feature`/standard.
- New plugin tool `odf_entry_triage` registered in `plugins/odf-delegation.ts`
  (mirrors `createODFWorkflowRoute`; returns JSON with `level`, `work_type`,
  `reason`, `needs_question`). `ODF_REGISTERED_TOOLS` is now exported for
  registration tests.
- Docs updated: `command/odf-new.md` adds an entry-triage step before
  `odf_workflow_route`/`odf_workflow_bind` (one grouped question when ambiguous,
  no free-form work-type choice); `agent/odoo_orchestrator.md` adds the
  classify-before-route rule.
- Tests: `plugins/entry-triage.test.ts` (16 table-driven) + registration and
  ambiguity tests in `plugins/odf-delegation.test.ts`.
- Verification: `npx vitest run plugins/entry-triage.test.ts
  plugins/odf-delegation.test.ts` → 258/258 pass; `npm run typecheck` → clean;
  `npm test` → full suite green (354 Vitest + 126 YAML, 0 failed).
- Authored diff ≈ 389 lines (under the 400 guidance).
- Runtime smoke: `N/A` — pure classifier and plugin tool tested at unit level;
  no live OpenCode/Odoo runtime boundary for this unit.
- Rollback boundary: remove `plugins/entry-triage.ts` and
  `plugins/entry-triage.test.ts`; revert `plugins/odf-delegation.ts` and
  `plugins/odf-delegation.test.ts`; revert the two doc files.

### [x] T5 — Make the micro path genuinely low-friction

**Status:** implemented; evidence recorded below.

**Outcome:** a correctly classified small change no longer pays for proposal,
assessment, QA plan, and design ceremonies that add no decision value.

**Dependencies:** T4.

**Minimum implementation**

- When intent and expectations are complete, ask no planning question.
- When one required fact is missing, ask one grouped question.
- Keep mechanical policy and evidence gates silent.
- Clarify that `/odf-fix` “No gates” means no human phase approvals, not no
  policy or evidence controls.
- Prove precedence between global execution mode and FIX → BUILD → VERIFY.

**Acceptance criteria**

- [ ] `small-change` omits QA-PLAN and DESIGN.
- [ ] Complete micro input reaches BUILD without a human approval loop.
- [ ] `/odf-fix` preserves root-cause analysis and a regression check.
- [ ] Any discovered high-risk condition escalates before editing.

**KPI:** median human blocks before micro BUILD ≤ 1.

**Implementation evidence (2026-08-17)**

- `skills/odf-fix/SKILL.md`: "No gates" clarified as no human phase-approval
  pauses; mechanical gates (`odf_policy_gate`, validation evidence, VERIFY, risk
  escalation) remain mandatory and run silently.
- `command/odf-fix.md`: same clarification in "Qué hace"; step 5 reinforced to
  escalate to DECIDE → PLAN **before editing** on architecture/multi-file/high
  risk.
- `command/odf-new.md` step 7: micro with `needs_question: false` skips
  PROPOSE/ASSESS approval rounds (inline plan → BUILD → VERIFY); escalate on any
  high-risk signal before editing.
- `agent/odoo_orchestrator.md`: "Micro path" rule — skip approval rounds when
  complete, ask at most one grouped question when a fact is missing, escalate on
  high-risk signals.
- Tests (4 new, `precedence` block in `plugins/entry-triage.test.ts`): complete
  `/odf-fix` input routes bugfix/micro with `needs_question: false`; complete
  micro input needs no question; ambiguous input yields exactly one grouped
  question; high-risk escalates even with complete micro input.
- Verification: `npx vitest run plugins/entry-triage.test.ts` → 20/20 pass;
  `npm run typecheck` → clean; `npm test` → full suite green (126 YAML + Vitest,
  0 failed).
- Runtime smoke: `N/A` — routing-layer precedence proven at unit level; no live
  OpenCode/Odoo runtime boundary for this unit.
- Rollback boundary: revert the four doc files and the `precedence` test block
  in `plugins/entry-triage.test.ts`.

### [x] T6 — Remove legacy bypasses and enable strict workflow

**Status:** implemented; evidence recorded below.

**Outcome:** every BUILD and VERIFY invocation uses the same binding, attempt,
proof, and receipt contracts.

**Dependencies:** T3, T5.

**Minimum implementation**

- Instrument remaining legacy callers.
- Migrate each caller to the canonical transition path.
- Enable strict workflow only after the caller inventory reaches zero.
- Remove compatibility branches after evidence proves they are unused.

**Acceptance criteria**

- [ ] BUILD without binding, attempt ID, or required validation fails before
  `task()`.
- [ ] VERIFY without a bound receipt fails before `task()`.
- [ ] No retained command relies on a removed compatibility path.
- [ ] Runtime smoke evidence is recorded, or `N/A` explains why no runtime
  boundary exists.

**KPI:** zero gated delegations through legacy proof-optional paths.

**Implementation evidence (2026-08-17)**

- `odf-registry.json` default flipped to `"strict_workflow": true`. The plugin
  gate already blocked IMPLEMENT/VERIFY without `workflow_advance` under strict;
  no new runtime code was needed.
- Caller inventory: `odf-new.md`, `odf-continue.md`, and `odoo_orchestrator.md`
  already passed the three required fields; migrated the remaining documented
  flows — `command/odf-fix.md` (BUILD/VERIFY steps), `command/odf-apply.md`
  (BUILD), and `command/odf-qa.md` (lens delegation note). No scripts/YAML
  depended on legacy omission.
- Decision: a missing `strict_workflow` flag stays non-blocking (legacy registry
  compatibility); activation happens through the registry value.
- `odf_parallel_delegate` already requires the shared proof unconditionally
  (strictly stronger than the flag), so the parallel path has no bypass; a test
  pins that behavior.
- The explicit `strict_workflow: false` opt-out branch is retained as a
  self-service exit until telemetry proves disuse (T12); no evidence of active
  opt-out consumers yet.
- Tests: default assertion flipped to `true`; new/renamed
  `strict-default-blocks-legacy-omission`, `strict-opt-out-allows-legacy`,
  `strict-parallel-delegate-blocks-without-shared-proof`, `strict-happy-path`;
  6 legacy-internal tests now run under the explicit opt-out.
- Verification: `npx vitest run plugins/odf-delegation.test.ts` → 245/245 pass;
  `npm run typecheck` → clean; `npm test` → full suite green (361 Vitest + 126
  YAML, 0 failed); registry validator → all registered paths valid.
- Runtime smoke: `N/A` — plugin unit tests run with mocked `task()`; no live
  OpenCode/Odoo runtime boundary for this unit.
- Rollback boundary: revert `odf-registry.json`, the migrated doc lines in
  `command/odf-fix.md`, `command/odf-apply.md`, `command/odf-qa.md`,
  `command/odf-new.md`, `command/odf-continue.md`,
  `agent/odoo_orchestrator.md`, and `plugins/odf-delegation.test.ts`.

---

## P1 — Trustworthy telemetry

### [x] T7 — Emit versioned local traces with real runtime metadata

**Status:** implemented; evidence recorded below.

**Outcome:** evaluation can reconstruct what happened without relying on the
current `prompt.length / 4` token estimate.

**Dependencies:** T3, T6.

**Minimum implementation**

- Define a versioned local event schema for run, trace, and span.
- Capture phase, task, tool, model, provider, model version, input/output tokens,
  latency, status, retry, work type, candidate digest, and receipt identity when
  the host exposes them.
- Represent unavailable provider fields honestly; never synthesize precision.
- Continue with bounded JSONL storage first. Add no OTel backend yet.

**Acceptance criteria**

- [ ] Parent and child spans correlate to one run.
- [ ] Real token fields replace the heuristic when available.
- [ ] Missing provider data is explicit and test-covered.
- [ ] Sensitive prompt, source, path, and environment content is not logged.
- [ ] Buffer, flush, cap, and failure behavior remain bounded.

**KPI:** at least 95% of delegations contain model, version, candidate digest,
and honest token availability.

**Implementation evidence (2026-08-17)**

- `DelegationMetrics` extended (retrocompatible): `event: "run" | "span"`,
  `schema_version: 1`, `trace_id`/`span_id`/`parent_span_id?`, `task?`,
  `tool?`, `retry_count?`, `model`/`provider`/`model_version` (null when
  absent), `model_available`, `tokens: { input?, output?, estimated? }`,
  `candidate_digest?`, `receipt_ref?`. No second JSONL stream — the existing
  `delegations-*.jsonl` was extended (minimal change).
- Host discovery: `ToolContext` exposes only `sessionID, messageID, agent,
  directory, worktree, abort, metadata, ask` — no model/provider/usage. So
  `model/provider/tokens` default to explicit `null`/`model_available: false`
  and are never synthesized; `estimateTokens` remains only as `tokens.estimated`
  (marked). A defensive `hostTelemetryFromContext` reads them if a future host
  adds them.
- `scrubMetricSecrets` added; `sanitizeError` now scrubs secrets and stays ≤200
  chars. Prompt contents, absolute user paths, and env values are never logged.
- Tests (6 new): `telemetry-schema-versioned`,
  `telemetry-parent-child-correlate`, `telemetry-tokens-honest`,
  `telemetry-no-secrets`, `telemetry-buffer-bounded`,
  `telemetry-model-available-flag`.
- Verification: `npx vitest run plugins/odf-delegation.test.ts` → 251/251 pass;
  `npm run typecheck` → clean; `npm test` → full suite green (367 Vitest + 126
  YAML, 0 failed).
- Authored diff ≈ 290 lines (well under 400).
- Runtime smoke: `N/A` — telemetry produced at plugin unit level with mocked
  `task()`/`toolCtx`; no live OpenCode/Odoo runtime boundary for this unit.
- Rollback boundary: revert `plugins/odf-delegation.ts` and
  `plugins/odf-delegation.test.ts`.

### [x] T8 — Represent absent and incomplete data honestly

**Outcome:** zero records no longer appear as perfect performance.

**Dependencies:** T7.

**Minimum implementation**

- Introduce `no_data`/`N/A` semantics in offline evaluation, online evaluation,
  metrics summaries, and any dashboard view.
- Distinguish complete, partial, unavailable, and invalid evidence.
- Preserve backwards-compatible reading only where it cannot misstate results.

**Acceptance criteria**

- [ ] Zero records never produce score `1` or `100%`.
- [ ] Partial datasets expose coverage and freshness.
- [ ] Tests cover empty, partial, invalid, and complete datasets.

**KPI:** zero success claims generated from absent evidence.

**Implementation evidence (2026-08-17)**

- `scripts/odf-evaluation.js`: `evaluateOffline`/`evaluateOnline` return
  `data_status: "no_data"` with `score: null` and `score_label: "N/A"` on empty
  or non-array input (never `score: 1`). With data they return
  `data_status: "complete"` (or `"partial"` when some records lack T7 telemetry),
  and online exposes `coverage` / `records_with_telemetry` without distorting the
  score.
- `scripts/odf-metrics.js`: percentages with zero base now return `null` with an
  `*Label: "N/A"`; `buildDashboard` gains `data_status`, `coverage`,
  `records_with_telemetry`. Shared `hasTelemetry` heuristic: a record is
  telemetry-bearing if it has any of `event`, `schema_version`,
  `model_available`, `candidate_digest`; a dataset is `partial` when
  `records.length > 0 && withTelemetry < records.length`;
  `coverage = withTelemetry / total` (null when not partial).
- Type declarations updated (`odf-evaluation.d.ts`, `odf-metrics.d.ts`).
- CLI confirmed: `ODF_CONFIG_DIR=<empty-metrics> node scripts/odf-evaluation.js
  online` prints `{"mode":"online","data_status":"no_data","total":0,
  "errors":0,"error_rate":null,"score":null,"score_label":"N/A"}`.
- Tests: `offline-empty-no-data` (2), `offline-complete`, `online-empty-no-data`,
  `online-complete`, `online-partial-coverage`, `dashboard-no-data`,
  `dashboard-partial`; adjusted CLI module test and float-ratio assertions.
- Verification: focused → 20/20 pass; `npm run typecheck` → clean; `npm test` →
  full suite green (126 YAML + Vitest, 0 failed).
- Runtime smoke: `node scripts/odf-evaluation.js online` on an empty metrics dir
  returned `no_data`/N/A (recorded above).
- Rollback boundary: revert `scripts/odf-evaluation.js`,
  `scripts/odf-metrics.js`, `scripts/odf-evaluation.d.ts`,
  `scripts/odf-metrics.d.ts`, and their `.test.ts` files.

## P2 — Semantic evaluation and safety

### [x] T9 — Separate human expectations and build golden trajectories

**Status:** implemented; evidence recorded below.

**Outcome:** ODF evaluates against a human-owned contract rather than criteria
written and judged by the same model.

**Dependencies:** T3, T7.

**Minimum implementation**

- Persist Intent and Expectations separately from generated plans and REQ IDs.
- Make approved Expectations immutable for the candidate.
- Build a small representative corpus per work type and risk tier.
- Include success, failure, recovery, stale evidence, unsafe tool attempts, and
  Odoo-specific edge cases.
- Add a golden whenever a harness defect is fixed.

**Acceptance criteria**

- [ ] Agents cannot silently rewrite approved Expectations.
- [ ] Goldens evaluate outcomes and trajectories, not only JSON shape.
- [ ] Corpus cases name the defect or contract they protect.
- [ ] Generated fixtures remain part of candidate identity even when excluded
  from authored-line workload estimates.

**KPI:** golden coverage by work type and risk tier, with zero unexplained
Expectation rewrites.

**Implementation evidence (2026-08-17)**

- New canonical contract `docs/expectations-contract.md`: the `expectations`
  artifact is human-owned (`EXP-XX`, `owned_by: "human"`, `approved`, immutable
  after approval). REQ-XX derived by ASSESS is now a technical plan that
  references EXP-XX rather than replacing them. VERIFY evaluates against
  approved EXP-XX and blocks on `expectations-not-approved` or tampering; legacy
  changes without the artifact keep REQ-based verification with an explicit
  `missing-expectations` warning.
- Updated `agent/odoo_orchestrator.md` (capture/persist/approve EXP at entry,
  forward as primary VERIFY criterion), `skills/odf-assess/SKILL.md`,
  `agent/odoo_qa_engineer.md`, `command/odf-new.md`, `command/odf-verify.md`.
- Golden corpus `scripts/fixtures/golden-trajectories.json`: 7 entries covering
  feature success, migration failure, recovery-correction, stale evidence, unsafe
  tool, multi-company edge case, unapproved expectations.
- `evaluateGoldens(goldens)` added to `scripts/odf-evaluation.js` (deterministic
  shape/consistency verifier: `work_type`, `risk`, `outcome`, `protects`,
  `expectation`, `golden`, `trajectory`), integrated as CLI mode `golden`;
  empty → `no_data`/N/A (consistent with T8).
- Verification: focused → 17/17 pass; `npm run typecheck` → clean; `npm test` →
  full suite green (126 YAML + Vitest, 0 failed); CLI `golden` → complete, 7/7;
  offline CLI still 1/1; registry valid.
- Authored diff > 400 lines (contract/docs + corpus + engine/tests). Recorded
  re-slice suggestion: (1) contract + docs/agents/skills, (2) golden corpus,
  (3) engine + tests. No rework performed.
- Runtime smoke: `N/A` — deterministic evaluator and docs; no live OpenCode/Odoo
  runtime boundary for this unit.
- Rollback boundary: revert `docs/expectations-contract.md`,
  `scripts/fixtures/golden-trajectories.json`, `scripts/odf-evaluation.js`,
  `scripts/odf-evaluation.d.ts`, `scripts/odf-evaluation.test.ts`, and the
  edited agent/skill/command files.

### [x] T10 — Calibrate an LLM judge in shadow mode

**Status:** implemented; evidence recorded below.

**Outcome:** ODF measures semantic correctness without granting an uncalibrated
model delivery authority.

**Dependencies:** T9.

**Minimum implementation**

- Version judge prompt, rubric, model, provider, and result schema.
- Bind each judgment to Expectations, candidate digest, and trace identity.
- Run shadow-only; do not block delivery.
- Compare against labeled human decisions and deterministic checks.

**Acceptance criteria**

- [ ] Shadow judgments never change workflow state.
- [ ] Agreement, false-pass, false-block, unavailable, and cost are recorded.
- [ ] Judge failures cannot be mistaken for positive judgments.
- [ ] Promotion to any blocking role requires a separate human decision backed
  by measured calibration.

**KPI:** measured human/judge agreement and false-pass rate; no gate impact.

**Implementation evidence (2026-08-17)**

- New `scripts/odf-judge.js`: `JUDGE_SCHEMA_VERSION = 1`,
  `defaultJudgeRubric()` (correctness_vs_expectations .6, regression_risk .25,
  evidence_quality .15), `evaluateShadow(...)` returning
  `{ mode:"shadow", schema_version, judge_version:{rubric_version, model,
  provider}, verdict, verdict_label, rationale, bound_to:{expectation_ids,
  candidate_digest, trace_ref}, data_status }`, `compareHumanJudge(...)`
  computing `{ agreement, false_pass, false_block, unavailable }`,
  `recordShadowJudgment(...)`, and `appendShadowJudgment(...)`. No provider
  configured (`ODF_JUDGE_MODEL` absent) → `verdict: "unavailable"`,
  `data_status: "no_data"`, never synthesized. Provider is an explicit extension
  point (`runJudge`), never a gate; no workflow state change.
- New `docs/judge-shadow-contract.md` (shadow semantics, schema, metrics, the
  no-blocking rule, and the human-decision + measured-calibration promotion
  gate).
- CLI mode `node scripts/odf-judge.js shadow <input.json>` returns the shadow
  JSON; with no provider it reports `unavailable`/`N/A`/`no_data` (verified).
- Tests (10): `shadow-no-provider-unavailable`, `shadow-versioned`, `shadow-bound`,
  `compare-human-judge-agreement`, `compare-false-pass`, `compare-false-block`,
  `compare-unavailable`, `compare-disagreement`, `append-shadow-judgment`,
  `record-shadow-judgment`.
- Verification: `npx vitest run scripts/odf-judge.test.ts` → 10/10 pass; `npm run
  typecheck` → clean; `npm test` → full suite green (126 YAML + Vitest, 0
  failed); CLI shadow with valid input reports `unavailable`/N/A without a
  provider.
- Authored diff ≈ 374 lines (under 400), 4 new cohesive files.
- Runtime smoke: CLI shadow verified above; no live OpenCode/Odoo runtime
  boundary for this unit.
- Rollback boundary: remove `scripts/odf-judge.js`, `scripts/odf-judge.d.ts`,
  `scripts/odf-judge.test.ts`, and `docs/judge-shadow-contract.md`.

### [x] T11 — Enforce safety before tool execution

**Status:** implemented; evidence recorded below.

**Outcome:** destructive, escaping, privacy-sensitive, and injected tool calls
are stopped before execution rather than detected afterward.

**Dependencies:** T7.

**Minimum implementation**

- Use host-native permissions and hooks first.
- Add custom argument inspection only for proven host gaps.
- Build a corpus for destructive commands, path escape, secrets/PII, prompt
  injection, jailbreak, and writes outside authorized roots.
- Log bounded decisions without retaining secrets or raw sensitive arguments.

**Acceptance criteria**

- [ ] Critical corpus cases block before the tool runs.
- [ ] Allowed equivalents continue to work.
- [ ] Each refusal names a runnable safe continuation.
- [ ] False-positive rate is measured before broadening policy.

**KPI:** 100% block rate for critical corpus cases, with false positives tracked.

**Implementation evidence (2026-08-17)**

- New `scripts/odf-safety.js`: `SAFETY_SCHEMA_VERSION = 1`, `SAFETY_RULES`
  (classes `destructive`, `path-escape`, `secrets-pii`, `injection`, `jailbreak`,
  `cross-root-write`), `inspectToolArgs({ tool, args, authorized_roots })` →
  `{ blocked, decision, classes, matched_rules, reason, safe_continuation }`,
  `safeContinuation(class)`, and an exported corpus. Each rejection names an
  executable safe continuation (never a dead-end); it complements (does not
  replace) OpenCode's native permissions.
- Integrated into `odf_delegate` before `findTaskApi`/`invokeTask` (never
  reaches `task()` on a block): returns a `blocked` envelope with reason
  `pre-tool-safety` plus `classes`/`matched_rules`/`safe_continuation` (via an
  optional `extra` on `blockWorkflow`), and records a blocked metric. It scans
  `args.prompt` (the user payload), not the enriched boundary prompt, to avoid a
  false positive from the executor-boundary text that names DROP/TRUNCATE as
  prohibitions.
- New `docs/safety-contract.md` (blocked classes, native-permission complement,
  every-rejection-names-a-continuation rule, false-positive measurement).
- Tests: `scripts/odf-safety.test.ts` (23: destructive/path-escape/secrets/
  injection/jailbreak blocks, benign allow, safe-equivalent allow, executable
  continuation, schema version, cross-root-write, false-positive rate) +
  `plugins/odf-delegation.test.ts` (2: destructive prompt blocked pre-tool and
  never delegates; benign prompt still delegates).
- Verification: `npx vitest run scripts/odf-safety.test.ts` → 23/23 pass; `npm run
  typecheck` → clean; `npm test` → full suite green (126 YAML + Vitest, 0
  failed); false positives = 0 on normal ODF commands in the corpus.
- Authored diff ≈ 518 lines (adapters + tests + integration); if committed it
  would split as the self-contained `scripts/odf-safety*` +
  `docs/safety-contract.md` unit plus two small `odf-delegation.ts` hunks.
- Runtime smoke: `N/A` — pre-tool inspection is deterministic string matching
  proven at unit level; no live OpenCode/Odoo runtime boundary for this unit.
- Rollback boundary: remove `scripts/odf-safety.js`, `scripts/odf-safety.d.ts`,
  `scripts/odf-safety.test.ts`, and `docs/safety-contract.md`; revert the two
  hunks in `plugins/odf-delegation.ts` and the two tests.

## P2 — Verified learning loop

### [x] T12 — Propose memory and skills only from verified runs

**Status:** implemented; evidence recorded below.

**Outcome:** ODF learns from trustworthy outcomes without automatically turning
plausible mistakes into permanent procedure.

**Dependencies:** T9, T10.

**Minimum implementation**

- Admit only runs with a valid candidate digest, receipt, Expectations, and
  known outcome.
- Consolidate episodic evidence into reviewable memory candidates.
- Propose a skill candidate after a difficult verified trajectory, including the
  Hermes-inspired five-plus-tool-call signal as one signal, not sufficient proof.
- Run candidates against goldens before presenting them for human approval.
- Never autoactivate skills.

**Acceptance criteria**

- [ ] Unverified and failed runs cannot create promotable candidates.
- [ ] Each candidate cites source run, Expectations, receipt, and regressions.
- [ ] Human approval is required before memory/skill activation.
- [ ] Rollback removes the candidate without rewriting source evidence.

**KPI:** candidate acceptance rate, regressions avoided, and rollback rate.

**Implementation evidence (2026-08-17)**

- New `scripts/odf-learning.js` (pure, no Engram/skill writes): `isVerifiedRun`
  (fail-closed: requires 64-hex `candidate_digest`, a `receipt`/`receipt_ref`
  with matching digest and `success`/`verified` status, non-empty approved
  `expectations`, and known `outcome`), `consolidateMemory` (verified episodes →
  reviewable memory candidates, `no_data` when none), `proposeSkillCandidate`
  (only from a verified, difficult (`tool_call_count >= 5`, a signal not proof),
  successful run; never activates), `runGoldenRegression` (blocks conflicting
  candidates), `approveCandidates` (human approval required), `rollbackCandidate`
  (adds `rolled_back` without touching source evidence), and `buildPlan` with a
  KPI report (`accepted`, `regressions_avoided`, `rolled_back`, `pending`).
- CLI `node scripts/odf-learning.js <runs.json>`: empty input → `no_data`/N/A;
  verified run → complete with pending memory+skill candidates awaiting human
  approval (verified via CLI).
- New `docs/learning-loop-contract.md` (verified-run admission, difficulty
  signal, golden regression before presenting, mandatory human approval,
  evidence-preserving rollback, and metrics). Auto-activation remains out of
  scope (parking lot).
- Tests (9): `admits-only-verified-runs`, `no-verified-runs-no-data`,
  `consolidates-episodic-to-memory`, `skill-only-from-difficult-verified-success`,
  `golden-regression-blocks-conflicting`, `approval-required`,
  `rollback-preserves-evidence`, `kpi-report`, `schema-versioned`.
- Verification: `npx vitest run scripts/odf-learning.test.ts` → 9/9 pass; `npm run
  typecheck` → clean; `npm test` → full suite green (126 YAML + Vitest, 0
  failed); CLI empty input → `no_data` (recorded).
- Authored diff ≈ 588 lines (4 new files); a re-slice would be module+types,
  tests, doc — three reviewable units. No rework performed.
- Runtime smoke: CLI verified above; no live OpenCode/Odoo runtime boundary for
  this unit.
- Rollback boundary: remove `scripts/odf-learning.js`, `scripts/odf-learning.d.ts`,
  `scripts/odf-learning.test.ts`, and `docs/learning-loop-contract.md`.

---

## Roadmap completion

All roadmap tasks T1–T12 are implemented with recorded evidence (2026-08-17).
The post-roadmap hardening work is also implemented in the current working tree:
phase artifact gates, executable micro/FIX routes, store-aware ARCHIVE,
installable contracts, phase-aware skill routing, store-neutral persistence
instructions, and Expectations validation before proof-backed VERIFY.
The continuous-improvement loop components (goldens, verified telemetry,
shadow judge, memory/skill candidates) now exist as deterministic contracts;
activation of any blocking judge role or auto-skill creation still requires a
separate human decision backed by measured calibration (see the conditional
backlog and parking lot). At HEAD `6035f94` (`v1.2.1`), the working tree is
clean; the remaining work below is planned follow-up, not an uncommitted
implementation claim.

---

## Continuous improvement loop

```text
offline goldens
  → instrumented online runs
  → deterministic checks
  → shadow judge
  → comparison with human Expectations
  → failure diagnosis
  → memory/skill candidate
  → golden regression
  → human approval
  → new baseline
```

The loop is healthy only when failures add reusable evidence. Adding another
gate without adding a named regression is process growth, not improvement.

## Dashboard and observability reassessment (2026-08-24)

The current ODF implementation is materially stronger than the original
dashboard study. It now has canonical workflow state, candidate-bound policy
and receipts, durable `IMPLEMENT`/`VERIFY` attempt-ledger records, bounded
parallel-join snapshots, richer versioned telemetry, source precision checks,
dependency/health probes, and an integral harness smoke test.

This changes the dashboard decision from “insufficient foundation” to
“valuable, but still not ready for a live web UI.” O1 now emits correlated
started/finished lifecycle records with bounded run/change/attempt identity for
actual delegations, and the read-side excludes start markers from finished
aggregates while exposing unfinished runs. It still cannot support a
trustworthy full-run live trace because legacy/early records can lack usable
identity, production spans are not emitted, finish telemetry is
buffered/best-effort JSONL with a 30-second flush, and the read-side does not
yet combine the attempt ledger with canonical workflow state.

The existing telemetry coverage heuristic is also too permissive: the presence
of `event`, `schema_version`, or `model_available` does not prove usable
identity, lifecycle, model, or token coverage. Host-provided model/provider and
real token usage remain unavailable in the current `ToolContext`; estimates
must remain visibly estimated.

### Revised observability plan

1. **O1 — Define usable run identity and lifecycle coverage [x].** Added validated
   change/run/attempt linkage and explicit start/finish outcomes for every
   actual delegated phase. Reused candidate digests, receipts, and join records
   without adding a parallel authority. Coverage now requires a finished
   lifecycle record with valid identity, not merely the presence of T7 fields.
2. **O2 — Make the read-side status truthful [x].** Added a bounded,
   per-change observability timeline to both `odf_status` and
   `odf_workflow_status`. It combines canonical workflow/receipt state,
   attempt-ledger records, validated joins, and filtered lifecycle JSONL;
   reports active, unfinished, partial, and no-data states without inferring
   activity from `canonical_stage` alone. Stale classification remains deferred.
3. **O3 — Add production spans only where they answer a measured question [ ].**
   Instrument delegation, task invocation, and parallel branches with real
   parent/child relationships. Measure required-field coverage, not schema
   presence.
4. **O4 — Revalidate the web UI gate [ ].** Only after O1–O3 reach stable coverage
   should the project add a local, read-only web observatory. Its first views
   should be run timeline, bottlenecks, harness health, and deterministic
   replay/simulation.
5. **O5 — Defer operational controls and remote observability [ ].** Abort/resume,
   WebSockets, OTel, remote storage, and team-wide retention require a separate
   measured need and must not become dashboard-side workflow authority.

### Current decision

Keep the dashboard as a conditional roadmap item. O1 and O2 are implemented in
the current working tree; the next work unit is source-authority hardening,
followed by O3 spans. Do not start a React application yet. The prior
local-first, read-only architecture remains correct, but the dashboard should
be named a **control-plane observatory**, not a full tracing platform.

### Error-learning audit: source-authority resolution (2026-08-24)

The vendor-bills incident is a real systemic bug class: **source-authority
resolution is unsound and unenforced**. The agent searched for a plausible
generic view instead of tracing the authoritative chain:

```text
action_move_in_invoice_type
  → search_view_id
  → account.view_account_bill_filter
  → inherited target
```

The current precision tools do not yet prevent recurrence:

- `sourceLookup` skips files larger than 128 KiB, which can hide the correct
  definition in a large Odoo source file.
- Module filtering does not fully constrain unqualified `id=` matches.
- `verifyRefs` proves textual existence, not that an action points to the
  selected view.
- The plugin injects precision instructions but does not recompute or enforce
  the action-to-view chain before accepting a result.
- Failed/blocked runs are recorded operationally, but do not automatically
  enter the T12 learning pipeline as causal prevention candidates.

The next separate work unit is **S1 — source-authority precision**:

1. Add an action-relation query to the existing precision tool.
2. Make large-file scanning bounded but non-skipping.
3. Enforce module-qualified definitions and reject authority mismatches.
4. Require structured authority evidence for view-related DESIGN/IMPLEMENT.
5. Add version-specific regression goldens for every supported Odoo version —
   Odoo 16, 17, 18, and current 19.0 — and
   block workflow advancement on an authority mismatch. Do not assume that an
   action/view relation is stable across versions; XML IDs, actions, models,
   fields, and inheritance chains can change between releases.
6. Fix the learning bridge admission mapping so `blocked`/`failed` receipts
   cannot default to a successful learning run.

Generic memory such as “be more careful” is not sufficient learning. A useful
lesson must become an executable lookup, validator, or regression. T12 should
propose that lesson for human review; it must not auto-activate unverified
skills.

## Program-level success measures

| Capability | Measure |
| --- | --- |
| Candidate integrity | Successful VERIFY transitions bound to a reproducible digest: 100% |
| Evidence authority | Successful VERIFY transitions with fresh executor receipts: 100% |
| Micro UX | Median human blocks before BUILD: ≤ 1 |
| Strict workflow | Gated legacy invocations: 0 |
| Telemetry | Runs with valid identity/lifecycle fields: ≥ 95% |
| Host metadata | Model/provider/real-token coverage measured separately; estimates never substitute |
| Evaluation honesty | Success claims from `no_data`: 0 |
| Judge quality | Agreement and false-pass rate measured, not assumed |
| Safety | Critical pre-tool corpus block rate: 100% |
| Learning | Promoted candidates without verified provenance: 0 |

## Conditional backlog — do not schedule yet

| Item | Activation condition |
| --- | --- |
| Web dashboard | At least 95% valid identity/lifecycle coverage and a stable event schema |
| Semantic skill resolver | Measured misses or false matches from trigger matching |
| Plugin extraction | A measured blast-radius or testability problem, not file length |
| Executable archive receipt | Evidence that the current archive path creates inconsistent state |
| OTel backend | Stable local trace schema and a real multi-process operations need |
| Cordis-style lifecycle | Hot unload/self-modification and costly in-process reconstruction |
| RAG/vector memory | Measured BM25/keyword retrieval failure at real volume |
| Additional graph framework | Existing routes cannot represent proven SOPs |
| More specialist agents | Routing data demonstrates a missing expertise boundary |
| More human gates | A genuine consent, irreversibility, or product-decision requirement |

Unlimited correction loops are permanently out of scope.

## Evidence behind this roadmap

Repository evidence reviewed:

- `odf-plugin/odf-delegation-metrics.ts` — versioned telemetry, buffering,
  sanitization, and honest model/token fields.
- `odf-plugin/odf-delegation-health.ts` and
  `odf-plugin/odf-delegation-loopguard.ts` — runtime health and duplicate-entry
  protection.
- `odf-plugin/odf-parallel-join.ts` — durable bounded branch/join evidence.
- `scripts/odf-toolkit.js` — source lookup and XML ref/model precision checks.
- `scripts/odf-harness.test.ts` — integral harness smoke coverage.

- `plugins/odf-delegation.ts` — policy, evidence, attempts, receipts, metrics,
  and learning summaries.
- `plugins/odf-workflow.ts` — canonical routes and existing work types.
- `plugins/odf-workflow-status.ts` — workflow and receipt state.
- `scripts/odf-evaluation.js` — deterministic offline and error-rate online
  evaluation.
- `scripts/odf-metrics.js` — current metrics summaries.
- `scripts/odf-engram-maintenance.js` — maintenance wrapper.
- `command/odf-new.md`, `command/odf-fix.md`, and
  `agent/odoo_orchestrator.md` — entry UX and orchestration contracts.
- `skills/odf-verify/SKILL.md` — verification policy.

Notebook evidence reviewed:

| Subject | Source ID |
| --- | --- |
| DeepSeek Harness | `79010a71-15ea-4879-b9e7-5283d38b46a5` |
| DeepSeek Web UI | `d2f96fee-2ad0-42b8-a772-1b60ec53b95d` |
| Harness engineering | `2704d514-fd0b-4882-ba98-d84b35056886` |
| Agent harness and loops | `67d12874-949a-429b-980f-d1fa11489bad` |
| Hermes | `1ff53092-4d17-4ef3-b019-6541536c9e8f` |
| Loop vs. graph | `a8aea89d-fbe4-44c4-ba9b-4a3142c888e5` |
| `paper.pdf` / Cordis | `8c798065-5541-4c56-820b-eb9affd8ba3c` |
| SDD vs. IDSD | `9caa35e3-c049-4543-920a-c8fa25fae107` |
| Hybrid Intelligence | `23ef459f-34f8-46f8-8f77-6168f3402276` |

## Standard verification after each work unit

```bash
npm test
npm run typecheck
ODF_CONFIG_DIR="$PWD" node scripts/odf-registry-validate.js
```

Run the smallest relevant focused test before the full checks. Installation,
commit, push, and runtime deployment remain separate explicit actions.

## Next action

Do not start a web UI or restart T1–T12. The next observability work unit is O2:
project the attempt ledger, canonical workflow state, parallel joins, and JSONL
into one truthful read-side timeline, then measure actual identity/lifecycle
coverage. The standard verification commands remain required for that work unit.
