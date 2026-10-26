# ODF 1.6.1 Release — Documentation and Website Refresh

## Objective

Cut `1.6.1` for the 36 commits merged after `v1.6.0` (PRs #139–#183), refresh the
documentation set that went stale, and rebuild the ODF website landing page so it
documents the new flows and the skill quality work.

Branch: `chore/release-1-6-1`. Delivery strategy: `single-pr` (metadata + docs +
website in one reviewable slice). Test runner: Vitest + YAML scenarios.

## Specs

- **S1 — Documentation refresh.** Update the documentation that the changes since
  `v1.6.0` made stale: stage/route vocabulary, removal of the legacy status
  projection and `odf_status`, persisted stage handoff, safe stop classification,
  delegation cancellation and late-seal recovery, project scoping, Context
  Manifest, decision-quality evaluation, and Agent Skills validation.
- **S2 — Release 1.6.1 metadata.** `VERSION`, `package.json`,
  `package-lock.json`, `odf-registry.json`, `install.sh` (banner + release-pinned
  hint), release fixtures (`scripts/lib/installer.test.ts`,
  `scripts/odf-agent-tests/odf-installer.yaml`,
  `scripts/odf-agent-tests/registry.yaml`), `README.md` badge/install pin, and a
  `CHANGELOG.md` section for `1.6.1`.
- **S3 — Website refresh.** `docs/index.html` must show the current release pin,
  current counts (87 skills, 11 agents, 23 commands, 29 plugin tools), current
  test totals, and the new flows: `feature-inline` with the conditional ASSESS
  gate, the ICE Context Manifest, native delegation lifecycle (prepare → launch →
  seal, cancellation, late-seal recovery), safe stop classification, and the
  decision-quality evaluation loop.
- **S4 — Skill improvements documented on the website.** A dedicated section for
  the Agent Skills conformance work: spec validation (`npm run validate:skills`),
  regenerated `compact_rules`, deterministic tie-break, frontmatter fixes, and the
  contribution path (`docs/skill-style-guide.md`).
- **S5 — Search index.** `docs/search-index.json` must include every new or
  changed page a visitor can reach from the site.
- **S6 — Publication.** Open the release PR, let CI + auto-merge land it on
  `main`, then publish tag/GitHub release `v1.6.1`. No npm publication.

Acceptance: every count and version string matches the repository; the site has
no stale `v1.3.0`/`19 tools`/`844 unit` claim; `npm test` and the release
validation matrix pass.

## Tasks

| ID | Spec | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1 | inline | done | `docs/intended-usage.md`, `docs/plugin.md`, `docs/skill-style-guide.md`, `docs/README.md`, `README.md`, `AGENTS.md` updated |
| T2 | S2 | inline | done | Version metadata + fixtures + CHANGELOG `1.6.1` |
| T3 | S3, S4 | inline | done | `docs/index.html` rebuilt around the 1.6.1 flows |
| T4 | S5 | inline | done | `docs/search-index.json` regenerated |
| T5 | S6 | inline | done | PR + `v1.6.1` release |

## Log

### L1 — user request (verbatim)

> en base a todos los cambios nuevos, actualizar la documentacion y sacar un nuevo release 1.6.1
> actualizar la pagina web tambien con todas cosas nuevas incorporadas, los flujos, las mejoras de los skills, documentalas tambien en el website de odf

### L2 — scope decision

Read-only audit of `v1.6.0..main` (36 commits, PRs #139–#183) produced the doc
gaps: stale legacy-compatibility claims in `docs/intended-usage.md`, missing
stop-classification / project-scoping / Agent Skills validation docs, README test
counts frozen at `1182`, and a website still pinned to `v1.3.0` with 19 tools.

### L3 — release boundary

The user asked to "sacar un nuevo release 1.6.1", which authorizes the version
bump, the release PR, and the GitHub tag/release publication. npm publication
remains out of scope, as in 1.6.0.
