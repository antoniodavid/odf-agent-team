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

Reads delegation metrics from Engram (`odf/metrics/delegation/*`) and presents:
- Agent performance (delegations, duration, tokens)
- Skill resolution rates
- Most-used skills
- Errors and timeouts
- Trends over time

## Orchestrator Instructions

### 1. Fetch metrics

```
FROM ENGRAM:
  mem_search("odf/metrics/delegation/", limit: 100)
  FOR EACH result: mem_get_observation(id)

FILTER by last N days (default: 1)
```

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

=== Trends (last 7d vs previous 7d) ===
  Delegations:    +15%
  Avg duration:   -5%  (improving)
  Resolution:     +3%  (improving)
  Errors:         -50% (improving)
```

### 3. Show trends when --days >= 7

Compare current period vs previous period of same length.

### 4. Store in Engram on each run

```
mem_save(
  title: "odf/metrics/snapshot/{date}",
  topic_key: "odf/metrics/latest",
  type: "architecture",
  project: "opencode",
  content: "{dashboard text}"
)
```
