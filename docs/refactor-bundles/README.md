# ODF Agent Team — Work-Unit Patches (regenerated)

Proof-backed lifecycle seam split, regenerated from the refactored source
(HEAD `b3f03db` → full roadmap state `3980968`). The original 01–10 / 07a / 07b
bundles were lost when the OS cleaned `/tmp/opencode/odf-work-units`; these two
reviewable slices were rebuilt from the surviving refactored source.

## Files

| File | Purpose |
|------|---------|
| `current-full.patch` | Full roadmap diff `b3f03db..3980968` (17 files, 4156 insertions, 270 deletions) |
| `07a-proof-backed-lifecycle-core.patch` | Lifecycle core: `commitWorkflowTransition`, `resolveProofBackedLifecycle`, `ProofBackedLifecycleInput`, lock/read/write helpers + direct unit tests |
| `07b-proof-backed-delegation-wiring.patch` | The three call sites routing sequential + parallel-resume + parallel-join through the seam + integration tests |

## Seam mapping (in `plugins/odf-delegation.ts` @ `3980968`)

- Core block: lines 4348–4978 (`SelectedWorkflowSnapshot` → `resolveProofBackedLifecycle`)
- Sequential call site: ~2778–2812
- Parallel resume aggregate commit: ~3427–3448
- Parallel join-complete aggregate commit: ~3653–3678
- Receipt/status helpers (`readReceiptFile`, `persistWorkflowFailureReceipt`, …) are intentionally NOT part of 07a/07b — they belong to other work units.

## Validation

Round-trip proven in the disposable clone (`/tmp/opencode/odf-bundle-work/clone`):

```
state R (b3f03db + non-seam roadmap)  --apply 07a-->  state C (core, no wiring)
state C (45b826e)                     --apply 07b-->  state W (3980968, full roadmap)
```

`git diff 3980968 <roundtrip result>` is empty — applying 07a then 07b onto the
base-without-seam state reproduces the full roadmap byte-identically.

Note: these are review slices of the roadmap diff, not standalone-against-HEAD
patches. They apply to the intermediate state without the seam (U1–U6 of the
original roadmap), which is why `current-full.patch` is kept alongside.

## Ownership

- 07a = proof-backed transition core
- 07b = delegation wiring
- Explicitly excluded: receipt, telemetry, strict-gate, selected-store-binding,
  parallel-join, health, docs — those belong to other work units.
