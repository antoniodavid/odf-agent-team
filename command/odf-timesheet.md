---
description: "Generate timesheet report from Engram data, showing billable hours and tasks by project. Usage: /odf-timesheet [--days N] [--project NAME] [--idle-gap MIN] [--format markdown|text|json]"
---

# ODF: Timesheet Report

**Parse command:** `/odf-timesheet [--days N] [--project NAME] [--idle-gap MIN] [--format markdown|text|json]`

Examples:
- `/odf-timesheet` — Last 7 days, all projects
- `/odf-timesheet --days 30` — Last 30 days
- `/odf-timesheet --project inventory-log` — Single project, last 7 days
- `/odf-timesheet --days 90 --format json` — Raw data for external tools

## Orchestrator Instructions

### 1. Run timesheet binary

```
timesheet [--days N] [--project NAME] [--idle-gap MIN] [--min-block SEC] [--format markdown|text|json]
```

The binary reads directly from `~/.engram/engram.db` (Engram's SQLite database).

Pass the user's flags through. Defaults:
- `--days 7` if not specified
- `--idle-gap 30` (minutes of inactivity to split a block)
- `--min-block 120` (minimum seconds per block)
- `--format markdown`

### 2. Show output to user

No additional processing needed. The binary produces:
- **markdown**: Full report with summary table + per-project details with ✅ tasks
- **text**: Condensed one-liner per project
- **json**: Structured output for programmatic use

### 3. Flag reference

| Flag | Default | Description |
|------|---------|-------------|
| `--days` | 7 | Look back N days |
| `--project` | all | Filter to single project |
| `--idle-gap` | 30 | Minutes of inactivity to end a work block |
| `--min-block` | 120 | Minimum seconds per block (billing minimum) |
| `--format` | markdown | Output: markdown, text, or json |
| `--db` | auto | Custom path to engram.db |

### 4. Notes

- Times are calculated from `user_prompts` timestamps (prompts you sent to agents)
- Activity blocks are split by `idle-gap` minutes of silence (default 30m)
- Tasks are extracted from `session_summary` observations stored in Engram
- Duplicate tasks across overlapping summaries are automatically deduplicated
- The binary is at `~/.local/bin/timesheet`
