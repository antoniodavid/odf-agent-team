---
description: "Archive completed change and save retrospective. Usage: /odf-archive <change-name>"
---

# ODF: Archive Change

**Parse command:** `/odf-archive <change-name>`

Examples:
- `/odf-archive sale-discount-field` — Archive completed change
- `/odf-archive sale-discount-field --force` — Re-archive even if already archived

## What This Does

Formalizes the closure of a completed ODF change:
1. Finalizes the retrospective (lessons learned)
2. Saves to Engram for future reference
3. Cleans up active state
4. Updates metrics

**Only run this AFTER successful VERIFY.**

## Orchestrator Instructions

1. **Verify change is complete:**
   ```
   mem_search("odf/{change-name}/verify-report")
   ```
   - If not found: Error "Change not verified. Run /odf-verify first."
   - If found: Continue

2. **Collect all artifacts:**
   ```
   mem_search("odf/{change-name}/assess") → get ID
   mem_search("odf/{change-name}/design") → get ID
   mem_search("odf/{change-name}/implement-progress") → get ID
   mem_search("odf/{change-name}/verify-report") → get ID
   mem_search("odf/{change-name}/state") → get ID
   mem_get_observation(id) for EACH
   ```

3. **Generate final retrospective:**

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

4. **Save to Engram:**
   ```
   mem_save(
     title: "odf/{change-name}/retrospective",
     topic_key: "odf/{change-name}/retrospective",
     type: "learning",
     project: "{project}",
     content: "{full retrospective}"
   )
   ```

5. **Update learned index:**
   ```
   mem_save(
     title: "odf-learned/{project}/{change-name}",
     topic_key: "odf-learned/{project}/{change-name}",
     type: "learning",
     project: "{project}",
     content: "{condensed retrospective}"
   )
   ```

6. **Mark as archived (update state):**
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

7. **Show confirmation:**

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

  Learnings saved to Engram:
  - odf/{change-name}/retrospective
  - odf-learned/{project}/{change-name}

  The change is now archived and available for future reference.
```

## When to Archive

**Archive when:**
- VERIFY passed (PASS or PASS WITH WARNINGS)
- All tasks completed
- Code is in production or merged

**Do NOT archive when:**
- VERIFY failed (fix and re-verify first)
- Change is still active/work in progress
- Tasks remain incomplete

## Benefits

- **Knowledge accumulation** — Future changes can reference past learnings
- **Metrics** — Track velocity, common issues, patterns
- **Clean state** — Clear active changes list
- **Retrospectives** — Document what worked and what didn't

## Integration

After archiving:
- Change appears in `/odf-metrics`
- Learnings referenced in future `/odf-new` explorations
- Available via `mem_search("odf-learned/{project}/")`
