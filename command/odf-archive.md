---
description: "Archive completed change and save retrospective. Usage: /odf-archive <change-name> [--repo]"
---

# ODF: Archive Change

**Parse command:** `/odf-archive <change-name> [--repo]`

Examples:
- `/odf-archive sale-discount-field` — Archive completed change
- `/odf-archive sale-discount-field --force` — Re-archive even if already archived
- `/odf-archive sale-discount-field --repo` — Store the design-library index in the repo's `design-library/` instead of the ODF config dir

## What This Does

Formalizes the closure of a completed ODF change:
1. Finalizes the retrospective (lessons learned + calibrated effort)
2. Appends the design to the reusable design library (`design-library/index.json`)
3. Saves to Engram for future reference
4. Cleans up active state
5. Updates metrics

**Only run this AFTER successful VERIFY.**

## Orchestrator Instructions

1. **Verify change is complete:**
   ```
   mem_search("odf/{change-name}/verify-report")
   ```
   - If not found: Error "Change not verified. Run /odf-verify first."
   - If found: Continue
   - The verify report MUST contain a real module test result with the exact `command`, explicit isolated `database`, `exit_code: 0`, and `output_evidence` showing the passing result. Manual browser checks do not satisfy this requirement.
   - Reject reports whose tests are skipped, deferred, unavailable, unrecorded, or missing an explicit `-d {test_db}`. Treat them as `blocked` with `verification-deferred`; never archive them.

2. **Collect all artifacts:**
   ```
   mem_search("odf/{change-name}/assess") → get ID
   mem_search("odf/{change-name}/design") → get ID
   mem_search("odf/{change-name}/implement-progress") → get ID
   mem_search("odf/{change-name}/verify-report") → get ID
   mem_search("odf/{change-name}/state") → get ID
   mem_get_observation(id) for EACH
   ```

3. **Derive `design_meta` and collect real IMPLEMENT effort (A3):**
   - `design_meta`: use the one persisted by DESIGN if present, else derive it from the design document with `deriveDesignMeta()` (`scripts/odf-estimator.js`). If it cannot be derived, skip the library append and calibration (N/A), do not invent values.
   - Collect the change's IMPLEMENT telemetry records. Correlate by `candidate_digest` first; if absent, by `work_type` + the change's implementation window (from `implement-progress` timestamps). Records come from the plugin JSONL:
     ```
     ${ODF_CONFIG_DIR:-~/.config/opencode}/metrics/delegations-YYYY-MM-DD.jsonl
     ```
     Read them with `collectDelegations()`/`readDelegationFile()` (`scripts/odf-metrics.js`), then:
     ```
     collectImplementationRounds(records, { minutes_per_round })  // scripts/odf-design-library.js
     ```
     → `{ rounds_real, data_status, duration_ms, record_count }` (`data_status: "no_data"` when there are no completed IMPLEMENT records — that is the honest N/A).

4. **Generate final retrospective:**

```markdown
# Retrospective: {change-name}

## Overview
**Completed:** {date}
**Odoo Version:** {version}
**Modules:** {modules}
**Strategy:** {standard|custom}
**Status:** ✅ COMPLETED

## What Was Built
{Summary from verify-report}

## Phases Completed
- [x] ASSESS — {date}
- [x] DESIGN — {date}
- [x] IMPLEMENT — {date}
- [x] VERIFY — {date}

## Artifacts
| Phase | Artifact |
|-------|----------|
| ASSESS | odf/{change-name}/assess |
| DESIGN | odf/{change-name}/design |
| IMPLEMENT | odf/{change-name}/implement-progress |
| VERIFY | odf/{change-name}/verify-report |

## Metrics
- Total tasks: {N}
- Verify attempts: {N}
- Duration: {calculated from timestamps}

## Effort (calibrated)
- Rounds reales (from IMPLEMENT telemetry): {rounds_real} — N/A if no data
- Duration: {duration_ms}ms across {record_count} delegations
- Bucket: {work_type}/{risk}/{module_type}

## Key Learnings
{Extract from implement-progress and verify-report}

## Gotchas & Surprises
{What was unexpected}

## Patterns Established
{Reusable patterns discovered}

## Issues Encountered
{What went wrong and how fixed}

## Recommendations for Similar Changes
{What would you do differently}

## Files Changed
{List from implement-progress}
```

5. **Append to the design library (B1):**
   ```
   appendAndWrite(index_path, design_meta, {
     rounds_real,            // from step 3 (null → N/A)
     design_ref: "odf/{change-name}/design",
     retrospective_ref: "odf/{change-name}/retrospective",
     archived_at: "{YYYY-MM-DD}",
   })                        // scripts/odf-design-library.js
   ```
   - **Index location (default):** `${ODF_CONFIG_DIR:-~/.config/opencode}/design-library/index.json` — runtime data, keeps the repo clean. This is the recommended default.
   - **`--repo`:** `<repo>/design-library/index.json` — use when the team commits and shares the index.
   - Dedupe is by `change`: re-archiving updates the existing entry instead of duplicating it.

6. **Save to Engram:**
   ```
   mem_save(
     title: "odf/{change-name}/retrospective",
     topic_key: "odf/{change-name}/retrospective",
     type: "learning",
     project: "{project}",
     content: "{full retrospective}"
   )
   ```

7. **Update learned index:**
   ```
   mem_save(
     title: "odf-learned/{project}/{change-name}",
     topic_key: "odf-learned/{project}/{change-name}",
     type: "learning",
     project: "{project}",
     content: "{condensed retrospective}"
   )
   ```

8. **Mark as archived (update state):**
   ```
   mem_save(
     title: "odf/{change-name}/state",
     topic_key: "odf/{change-name}/state",
     type: "architecture",
     project: "{project}",
     content: "change: {change-name}
phase: archived
odoo_version: {ver}
strategy: {strategy}
artifacts:
  assess: true
  design: true
  implement: true
  verify: true
status: COMPLETED
archived_at: {ISO date}"
   )
   ```

9. **Show confirmation:**

```
ODF: Change Archived

  Change: {change-name}
  Status: ✅ COMPLETED
  
  Summary:
  {executive_summary from verify}

  Metrics:
  - Duration: {time}
  - Tasks: {N}
  - Verify attempts: {N}

  Estimación calibrada: {N} rounds reales para el próximo diseño parecido
  (o "N/A" si no hay datos de telemetría)

  Learnings saved to Engram:
  - odf/{change-name}/retrospective
  - odf-learned/{project}/{change-name}

  The change is now archived and available for future reference.
```

## When to Archive

**Archive when:**
- VERIFY passed (PASS or PASS WITH WARNINGS) only after the required module test command actually ran and passed with valid database and output evidence
- All tasks completed
- Code is in production or merged

**Do NOT archive when:**
- VERIFY failed (fix and re-verify first)
- Tests are skipped, deferred, unavailable, or missing command/database/exit-code/output evidence
- VERIFY is `blocked` or `verification-deferred`, even when manual browser checks passed
- Change is still active/work in progress
- Tasks remain incomplete

## Benefits

- **Knowledge accumulation** — Future changes can reference past learnings
- **Design library** — Searchable, versioned `design-library/index.json` feeds `/odf-explore` and calibrates the estimator from real effort
- **Metrics** — Track velocity, common issues, patterns
- **Clean state** — Clear active changes list
- **Retrospectives** — Document what worked and what didn't

## Integration

After archiving:
- Change appears in `/odf-metrics`
- Design is searchable via `scripts/odf-design-library.js search <query> [index.json]`
- Calibration buckets available via `scripts/odf-design-library.js calibrate <index.json>`
- Learnings referenced in future `/odf-new` explorations
- Available via `mem_search("odf-learned/{project}/")`
