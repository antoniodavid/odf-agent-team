# Metrics And Engram Maintenance

ODF metrics are local JSONL records under `${ODF_CONFIG_DIR}/metrics` (or
`~/.config/opencode/metrics`). Session identifiers are hashed, error text is
bounded and sanitized, and the in-memory writer flushes synchronously at its
configured cap (`ODF_METRICS_BUFFER_CAP`). Daily files are naturally bounded
by `collectDelegations(metricsDir, days)`; consumers should choose a retention
window rather than treating the directory as an unbounded query source.

Evaluation is provider-agnostic:

From a source checkout:

```bash
node scripts/odf-evaluation.js offline fixtures/evaluation.json
ODF_CONFIG_DIR="${ODF_CONFIG_DIR:-$HOME/.config/opencode}" node scripts/odf-evaluation.js online
```

Offline fixtures contain `{ "record": {}, "expect": {} }` pairs and are
reproducible. Online evaluation reads observed delegation metric records and
reports the error rate; it does not call a model.

Engram maintenance uses argument arrays, never a shell command string:

From a source checkout:

```bash
npm run engram:maintenance -- status
npm run engram:maintenance -- sync --confirm
npm run engram:maintenance -- consolidate --all --confirm
npm run engram:maintenance -- prune --confirm
npm run engram:maintenance -- prune --confirm --dry-run
```

From an installed runtime, `package.json` is not copied, so invoke the
installed script directly:

```bash
ODF_CONFIG_DIR="${ODF_CONFIG_DIR:-$HOME/.config/opencode}"
node "$ODF_CONFIG_DIR/scripts/odf-engram-maintenance.js" status
node "$ODF_CONFIG_DIR/scripts/odf-engram-maintenance.js" sync --confirm
node "$ODF_CONFIG_DIR/scripts/odf-engram-maintenance.js" consolidate --all --confirm
node "$ODF_CONFIG_DIR/scripts/odf-engram-maintenance.js" prune --confirm --dry-run
```

`status` and `--dry-run` do not mutate. `sync`, `consolidate`, and `prune`
require explicit confirmation and fail clearly if `engram` is unavailable.
Engram 1.20.1 does not expose project selectors for these commands, so the
adapter refuses project arguments; consolidation requires `--all`, and prune
operates on the CLI's global zero-observation set. The adapter uses the actual
command shapes without embedding unsupported project flags.
