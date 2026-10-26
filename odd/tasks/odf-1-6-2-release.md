# ODF 1.6.2 Release — Docs Site and Privacy Hardening

## Objective

Ship `1.6.2` with the generated documentation site and the published-surface
privacy fixes merged after `v1.6.1`, so the newest downloadable pack no longer
contains personal paths or credential-like examples.

Branch: `chore/release-1-6-2`. Delivery strategy: `single-pr`. Test runner:
Vitest + YAML scenarios.

## Specs

- **S1 — Version metadata.** `VERSION`, `package.json`, `package-lock.json`,
  `odf-registry.json`, `install.sh`, README badge/install pin, and the
  installer/registry fixtures report `1.6.2`.
- **S2 — Changelog.** A `1.6.2` section covering the documentation site
  (`#186`, `#187`) and the privacy fixes (`#188`), with the verification
  boundary and the residual history note.
- **S3 — Documentation.** `docs/README.md` summarizes 1.6.2 and points to 1.6.1
  highlights; generated pages, search index, and docs checks stay current.
- **S4 — Website.** `docs/index.html` pins `v1.6.2`, shows 1,405 tests, adds a
  "What's new in 1.6.2" section, retitles the previous release to "1.6.1
  highlights", and updates the footer.
- **S5 — Publication.** Open the release PR, let CI + auto-merge land it, then
  publish tag/GitHub release `v1.6.2`. No npm publication.

## Tasks

| ID | Spec | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1 | inline | done | Version metadata + fixtures |
| T2 | S2 | inline | done | `CHANGELOG.md` 1.6.2 |
| T3 | S3 | inline | done | `docs/README.md` + regenerated pages |
| T4 | S4 | inline | done | `docs/index.html` |
| T5 | S5 | inline | done | PR #189 merged as `5870b5f`; release `v1.6.2` targets that commit |

## Log

### L1 — user request (verbatim)

> si continuea con la idea sacar 1.6.2

### L2 — release decision

`1.6.1` remains public with the pre-fix installer path in its tag and in history.
A patch release is the non-destructive way to make the newest artifact clean;
history rewriting would require a force-push and is out of scope.

### L3 — scope

Only metadata, changelog, docs summary, and the landing page change. Runtime
code, skills, and routes are untouched; the docs generator is already covered by
`docs:check` and the privacy guard test.

### L4 — release evidence (2026-10-26)

- PR #189 passed CI on Node 22 and auto-merged as `5870b5f`; the branch was
  deleted locally and remotely.
- Release `v1.6.2` is published, non-draft, non-prerelease, and targets
  `5870b5f`. `VERSION`, `package.json`, and `odf-registry.json` at the tag report
  `1.6.2`; the tag's `install.sh` has no `adruban` reference.
- GitHub Pages serves `v1.6.2`, "What's new in 1.6.2", and 1,405 tests; the live
  crawl resolved 30 pages and all anchors, and the privacy scan of 32 published
  files found no personal data or credentials.
- Local release matrix: 1,405 Vitest tests (52 files), 331 YAML scenarios, 18
  harness checks, typecheck, registry validation, skill validation, docs check,
  `bash -n install.sh`, `node --check`, and `git diff --check`.
