---
description: "Generate timesheet report from Engram data, showing billable hours and tasks by project. Usage: /odf-timesheet [--days N] [--project NAME] [--idle-gap MIN] [--format markdown|text|json] [--serve]"
---

# ODF: Timesheet Report

**Parse command:** `/odf-timesheet [--days N] [--project NAME] [--idle-gap MIN] [--format markdown|text|json] [--serve]`

Examples:
- `/odf-timesheet` — Last 7 days, all projects
- `/odf-timesheet --days 30` — Last 30 days
- `/odf-timesheet --project inventory-log` — Single project, last 7 days
- `/odf-timesheet --days 90 --format json` — Raw data for external tools
- `/odf-timesheet --serve` — Launch web dashboard on :8080

## Orchestrator Instructions

### 1. Run timesheet binary

```
timesheet [--days N] [--project NAME] [--idle-gap MIN] [--min-block SEC] [--format markdown|text|json] [--serve] [--port PORT]
```

The binary reads directly from `~/.engram/engram.db` (Engram's SQLite database).

Pass the user's flags through. Defaults:
- `--days 7` if not specified
- `--idle-gap 30` (minutes of inactivity to split a block)
- `--min-block 120` (minimum seconds per block)
- `--format markdown`

### 2. CLI Mode (default)

No additional processing needed. The binary produces:
- **markdown**: Full report with summary table + per-project details with ✅ tasks
- **text**: Condensed one-liner per project
- **json**: Structured output for programmatic use

### 3. Web Dashboard Mode (--serve)

Starts an HTTP server with:
- **Web UI** at http://localhost:8080 — visual dashboard with charts, heatmap, timelines
- **API** at `/api/timesheet?days=30&project=NAME` — JSON data with full prompt details
- **API** at `/api/projects` — list of available projects

Query params for the API:
- `days` — lookback days (default 30)
- `project` — filter to single project
- `from` / `to` — custom date range (YYYY-MM-DD)
- `idle_gap` — minutes (default 30)
- `min_block` — seconds (default 120)

### 4. Flag reference

| Flag | Default | Description |
|------|---------|-------------|
| `--days` | 7 | Look back N days |
| `--project` | all | Filter to single project |
| `--idle-gap` | 30 | Minutes of inactivity to end a work block |
| `--min-block` | 120 | Minimum seconds per block (billing minimum) |
| `--format` | markdown | Output: markdown, text, or json |
| `--serve` | false | Launch web dashboard |
| `--port` | 8080 | Web server port |
| `--human-ratio` | 3.0 | Multiplier for estimated human time (AI→Human) |
| `--db` | auto | Custom path to engram.db |

### 5. Notes

- Times are calculated from `user_prompts` timestamps (prompts you sent to agents)
- Activity blocks are split by `idle-gap` minutes of silence (default 30m)
- Tasks are extracted from `session_summary` observations stored in Engram
- Duplicate tasks across overlapping summaries are automatically deduplicated
- Web UI built with React + TanStack Query + Recharts + Tailwind CSS v4
- The binary is at `~/.local/bin/timesheet`
