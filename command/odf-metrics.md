---
description: "ODF Agent Observatory dashboard. Shows agent performance metrics and trends. Usage: /odf-metrics [--days N]"
---

# ODF: Agent Observatory

**Parse command:** `/odf-metrics [--days N]`

Examples:
- `/odf-metrics` — Last 24h metrics
- `/odf-metrics --days 7` — Last 7 days
- `/odf-metrics --days 30` — Last 30 days

## What This Does

Reads delegation metrics from the plugin's local JSONL log (canonical source, `${ODF_CONFIG_DIR:-~/.config/opencode}/metrics/delegations-YYYY-MM-DD.jsonl`) and presents:
- Agent performance (delegations, duration, tokens)
- Work type and branch attribution, including branch duration
- Scheduler join lifecycle, bounded counts, and validation ratio
- Skill resolution rates
- Most-used skills
- Errors and timeouts

Engram is NOT the metrics source — the plugin never writes delegations to Engram.

## Orchestrator Instructions

### 1. Fetch metrics

Run the read-only aggregator:

```
node scripts/odf-metrics.js [--days N]
```

Respects `ODF_CONFIG_DIR` when set; falls back to `~/.config/opencode/metrics`. Read-only — never write to the metrics directory (the plugin owns the writer side) and never append to Engram.

### 2. Build dashboard

```
ODF: Agent Observatory (last {N}d)

=== Overall ===
  Total delegations: {N}
  Avg duration: {X}s
  Avg tokens: {N}
  Skill resolution rate: {X}% self-discovered
  Errors: {N} ({X}%)

=== By Agent ===
  Agent               Delegations    Avg Dur    Avg Tokens    Resolution
  ─────────────────────────────────────────────────────────────────────
  odoo_backend_eng.   12             45s        2,400         92%
  odoo_frontend_en.   3              32s        1,800         100%
  odoo_qa_engineer    5              18s        900           80%

=== Top Skills (by injection count) ===
  oca-governance-commit-messages    15
  oca-python-style                  12
  odf-fix                           8

=== Errors ===
  {timestamp} | {agent} | {error} | {duration}s
```

### 3. Show trends when --days >= 7 (optional)

Compare current period vs previous period of the same length. The script returns a single aggregate; for trends, run it twice (`--days N` and `--days 2N`) and diff the overall block.

### 4. Cache snapshot (optional, never a source)

If a snapshot is wanted for cross-session reference, store the dashboard TEXT in Engram — it is a denormalized cache, NOT the source of truth:

```
mem_save(
  title: "odf/metrics/snapshot/{date}",
  topic_key: "odf/metrics/latest",
  type: "architecture",
  project: "opencode",
  content: "{dashboard text}"
)
```
