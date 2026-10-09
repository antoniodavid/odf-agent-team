# Metrics And Engram Maintenance

ODF metrics are local JSONL records under `${ODF_CONFIG_DIR}/metrics` (or
`~/.config/opencode/metrics`). Session identifiers are hashed, error text is
bounded and sanitized, and the in-memory writer flushes synchronously at its
configured cap (`ODF_METRICS_BUFFER_CAP`). Daily files are naturally bounded
by `collectDelegations(metricsDir, days)`; consumers should choose a retention
window rather than treating the directory as an unbounded query source.
Recovery attempts emit bounded local spans (`task` values such as
`recovery:settle-attempt` and `recovery:late-seal-prepare`) with elapsed time and
outcome. Actual input/output tokens and `cost_usd` are recorded only when the
host supplies them; ODF never estimates cost, and token-length estimates remain
separately labelled as estimates. The local metrics summary reports recovery
counts/outcomes and host-reported USD cost with an explicit coverage count; no
network request is made by the metrics summary.

## Optional online feedback

Online feedback is disabled unless the operator configures an HTTPS endpoint.
The user must run `/odf-feedback <change>`, review a local preview, and confirm
that one submission should be sent. The command accepts only an explicit
integer quality rating from 1 to 5; it has no free-text field and never submits
automatically after a workflow.

```bash
ODF_FEEDBACK_ENDPOINT="https://feedback.example.invalid/odf" \
ODF_FEEDBACK_RETENTION_DAYS="30" \
ODF_FEEDBACK_BEARER_TOKEN="<optional-secret>" \
opencode
```

The endpoint must use HTTPS and may not embed credentials, query parameters, or
fragments. The bearer token is optional and sent only in the Authorization
header. The endpoint owner must enforce the configured retention value (1–30
days) for submitted records and relevant server logs. ODF includes that value
in the payload but cannot verify or enforce remote deletion; do not configure
an endpoint without an explicit retention policy.

The versioned payload contains only the rating and aggregates for finished
runs in the current local session/change: run count, latest phase status, total
duration, and host-supplied input/output tokens and USD cost with coverage
counts. Missing host usage is `null`; token estimates are excluded. The payload
never contains prompts, responses, free text, session/change/run IDs, model or
provider names, workspace names, paths, or credentials. The receiver still sees
normal network metadata such as the sender's IP address.

Preview writes nothing to disk and returns a five-minute, one-time in-memory
confirmation token bound to the exact payload, session, change, rating,
endpoint, and retention. A confirmed submission makes one bounded request with
a five-second timeout, rejects redirects, stores no durable feedback copy or
queue, and is never retried. An interrupted request may have an unknown remote
outcome. The rating is user feedback, not benchmark evidence; do not claim
efficacy improvements without a separate reproducible benchmark.

Evaluation is provider-agnostic:

From a source checkout:

```bash
node scripts/odf-evaluation.js offline fixtures/evaluation.json
ODF_CONFIG_DIR="${ODF_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}" node scripts/odf-evaluation.js online
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
ODF_CONFIG_DIR="${ODF_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
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
