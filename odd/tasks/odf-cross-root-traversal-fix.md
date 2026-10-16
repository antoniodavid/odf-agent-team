# ODF absolute traversal safety correction
Repository: `odf-agent-team`
Scope: close the absolute-traversal escape in command-aware cross-root write detection.

## Specs

- S1: "revisa los archivos y las confirmaciones que hay en la rama main"
- S2: "Destinations outside the root, traversal targets, and sibling paths that only share the root prefix must remain blocked."
- S3: `pre-tool-safety: cross-root-write`

## Tasks

- T1 (S1-S3): Create a regression for absolute traversal and correct path-boundary evaluation; route FIX/BUILD; commit `1f692b8`.
- T2 (S2-S3): Run baseline/fix checks and independent read-only validation; route VERIFY; commit `1f692b8`.
- T3 (S1-S3): Prepare the approved follow-up issue and PR; route delivery; PR `#155`.

## Log

- L1: revisa los archivos y las confirmaciones que hay en la rama main
- L2: ok
- L3: Main review reproduced `cp source /home/dev/proj/../etc/evil` as allowed with `/home/dev/proj` authorized, despite the destination resolving outside the root.
- L4: T1 RED: the new `cp` and `rsync` absolute-traversal cases failed while the existing 37 cases passed.
- L5: T1 GREEN: `npx vitest run scripts/odf-safety.test.ts` passed with 39 tests after adding the fail-closed absolute-traversal guard.
- L6: Clean base `a318d251` passed 37 focused tests, `npm run typecheck`, registry validation, and `git diff --check`.
- L7: Fix branch passed 39 focused tests, `npm run typecheck`, registry validation, and `git diff --check`.
- L8: Differential comparison passed: five existing cases were unchanged and the two new absolute-traversal cases changed from allowed on base to blocked on the fix.
- L9: Work-unit commit `1f692b8` contains the source correction and both public-interface regression cases.
- L10: Independent read-only security validation passed 39 focused tests and confirmed external sources remain allowed only for in-root destinations, while absolute traversal and sibling-prefix destinations block. It noted the intentional conservative behavior of blocking normalized in-root paths that contain `..`.
- L11: PR `#155` was created against `main` with `Closes #154` and exactly one `type:bug` label; merge remains a separate human decision.
