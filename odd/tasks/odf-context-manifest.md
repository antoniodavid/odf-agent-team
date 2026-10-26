# ODF Context Manifest for the ICE flow

Objective: make Context a first-class, bounded, reference-only artifact built
once at entry and forwarded unchanged to ASSESS and BUILD. Redundancy becomes a
gate signal for `feature-inline`, not a blocking user question.
Branch: `feat/odf-context-manifest`. Delivery strategy: `ask-on-risk`.
Test runner: `npm test`.

## Specs

- **S1**: `odf_context_manifest` accepts `redundancy`
  (`probed`, `hits`, `contradictions`, `references`), `assessment_gate`
  (`mode`, `reason`, `signals`), and `expectations_ref`; the manifest records
  them, includes them in `manifest_digest`, caps every collection, and drops
  unsafe or malformed values into explicit `missing_facts`.
- **S2**: a `feature-inline` entry builds exactly one Context Manifest after the
  gate and approved Expectations, and forwards the returned JSON unchanged under
  `## Context Manifest` to ASSESS and BUILD. It is never persisted as a source
  artifact and is not rebuilt while module, Odoo version, scope, and
  Expectations remain unchanged.
- **S3**: redundancy is a gate signal for `feature-inline`, never a blocking
  question. The entry does not ask extend / already-implemented / cancel; hits or
  contradictions select `assess`, and the lean ASSESS resolves
  `standard-coverage` / `extend-existing` or escalates. The formal `feature`
  route keeps its existing redundancy presentation.
- **S4**: lean ASSESS and BUILD consume the forwarded manifest references,
  source roots, CodeGraph reference, and redundancy counts. They do not re-run
  project discovery or redundancy while the manifest is fresh. A missing or
  stale manifest degrades to bounded discovery and reports `manifest-stale`.
- **S5**: backward compatibility: existing manifests, routes, change state, and
  persisted artifacts are unchanged. No new workflow store or artifact type.
- **S6**: `docs/context-contract.md` documents the schema and lifecycle; docs,
  orchestrator, command, and skills are consistent. Typecheck, full unit suite,
  YAML scenarios, and registry validator pass.

## Tasks

- T1 (S1) — DONE. `odf-plugin/odf-context-manifest.ts` records redundancy, the
  assessment gate, and the Expectations reference; digest covers them; caps and
  unsafe-value rejection covered by 4 new tests.
- T2 (S2, S3) — DONE. `command/odf-new.md` builds the manifest once and forwards
  it; `agent/odoo_orchestrator.md` documents the lifecycle and the
  `feature-inline` redundancy behavior.
- T3 (S4) — DONE. `skills/odf-assess/SKILL.md` and
  `skills/odf-implement/SKILL.md` consume the manifest and report
  `manifest-stale` instead of re-running discovery.
- T4 (S6) — DONE. `docs/context-contract.md`, `docs/README.md`,
  `docs/plugin.md`, `docs/route-contract.md`.
- T5 (S6) — DONE. `npm run typecheck` clean; focused Vitest green;
  `npx vitest run` 1362/1362 (49 files, exit 0); `npm run test:yaml` 331/331;
  registry validator valid.

## Log

- **L1** (user, verbatim): "continue con la Unidad 2"
- **L2** (scope): Unit 2 of the IDSD/ICE decoupling plan. Target is the Odoo
  customer flow. The accepted Unit 1 route is `feature-inline` with the
  conditional ASSESS gate.
- **L3** (implementation, 2026-10-26): T1-T4 implemented on
  `feat/odf-context-manifest`. Evidence: typecheck clean, 1362/1362 unit
  (49 files, exit 0), 331/331 YAML, registry valid.
- **L4** (user, 2026-10-26): requested a commit and merge into `main`.
