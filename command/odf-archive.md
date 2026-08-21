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
3. Proposes reviewable skill/memory candidates from the verified change (C1, never auto-activated)
4. Saves to Engram for future reference
5. Cleans up active state
6. Updates metrics

**Only run this AFTER successful VERIFY.**

## Store-Aware Workflow Transition

ARCHIVE is a terminal workflow transition. Call the existing workflow transition
helper with `expectedStage: ARCHIVE` and the selected `artifact_store`:

- `openspec`: OpenSpec state and `archive-report.yaml` are authoritative.
- `engram`: Engram state and `odf/{change-name}/archive-report` are authoritative.
- `hybrid`: OpenSpec is authoritative; Engram receives an idempotent mirror.

Do not invent a public ARCHIVE transition API or write workflow state outside the
existing helper. The helper preserves `work_type` and completed canonical route
stages, writes `canonical_stage: ARCHIVED`, and returns `already-committed` for a
safe retry. Hybrid must finish with both stores representing ARCHIVED; it must
never leave the authoritative OpenSpec state at VERIFY.

Before calling the helper, require persisted state with terminal `VERIFY` and a
successful terminal `verify-report`. If VERIFY is missing, incomplete, failed,
or non-terminal, return `workflow-verify-not-terminal` and do not modify state.

## Orchestrator Instructions

1. **Verify change is complete:**
   ```
   mem_search("odf/{change-name}/verify-report")
   ```
   - If not found: Error "Change not verified. Run /odf-verify first."
   - If found: Continue
    - The verify report MUST contain a real module test result with the exact `command`, exact `database`, `exit_code: 0`, and `output_evidence` showing the passing result. If the database is non-isolated, it must also state that it is non-isolated and user-authorized and warn that tests may mutate module, schema, and test data. Manual browser checks do not satisfy this requirement.
    - Reject reports whose tests are skipped, deferred, unavailable, unrecorded, or missing the exact `-d {test_db}`. Treat them as `blocked` with `verification-deferred`; never archive them. Consent to use a non-isolated database does not authorize `dropdb`, `createdb`/reset/restore, `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, `DROP SCHEMA`, or destructive re-initialization; those require separate current consent for the exact operation and database and are not test setup.

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

8. **Propose learning candidates from the archived change (C1):**
   Build a verified run from the change's artifacts and feed the T12 learning loop:
   ```
   proposeFromArchivedChange({
     design_meta,            // from step 3 (or design_meta.candidate_digest)
     expectations,           // odf/{change}/expectations (approved EXP-XX)
     records,                // IMPLEMENT telemetry from step 3
     goldens,                // scripts/fixtures/golden-trajectories.json
     outcome: "pass",        // VERIFY passed
     receipt: { status: "success", candidate_digest, receipt_id: "<verify-report>" },
   })                        // scripts/odf-learning-bridge.js
   ```
   - `buildVerifiedRunFromChange` requires a 64-hex `candidate_digest` (from the verify receipt or `design_meta.candidate_digest`) AND approved expectations; without them the run is `no_data` and NOTHING is proposed (fail-closed, T8).
   - `tool_call_count` is derived honestly and flagged via `tool_call_source`: `"actual"` when records carry per-tool spans, `"derived"` when it comes from `rounds_real` (`collectImplementationRounds`), `null` when there is no data — never invented.
   - Skills are proposed ONLY from a difficult (`>= tool_calls_threshold`, default 5) verified success. NEVER auto-activate: every candidate is `proposed_for: "human"` (learning-loop-contract.md).
   - Only proceed when `data_status: "complete"`; with `no_data` skip steps 9 and the skill confirmation below (N/A).

9. **Save learning proposals to Engram (C1):**
   ```
   mem_save(
     title: "odf/{change-name}/learning-proposals",
     topic_key: "odf/{change-name}/learning-proposals",
     type: "learning",
     project: "{project}",
     content: "{skill_candidates + memory_candidates + golden_regression + kpi JSON}"
   )
   ```
   Saved for human review later; nothing is activated at archive time.

10. **Mark as archived:** use the store-aware transition above. Do not manually
    replace it with a generic `mem_save`; the selected store and ARCHIVED state
    are part of the runtime gate.

## Archive Report

The report is persisted idempotently at:

- OpenSpec: `openspec/changes/{change-name}/archive-report.yaml`
- Engram: `odf/{change-name}/archive-report`
- Hybrid: both locations, with OpenSpec as the authority

The report preserves the change, `work_type`, completed canonical stages, and
archive timestamp. It is a YAML document at the OpenSpec `.yaml` path.

## Show Confirmation

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
  Calibrated estimate: {N} real rounds for the next similar design
  (or "N/A" when telemetry data is unavailable)
  Learnings saved to Engram:
  - odf/{change-name}/retrospective
  - odf-learned/{project}/{change-name}
  - odf/{change-name}/learning-proposals
  Proposed skills (require human approval):
  - skill-{work_type}-{digest8}: {N} tool calls (source: actual|derived), verified path
  (or "None" when there are no skill candidates / data_status no_data)
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
- Skill/memory candidates from the verified change stored in `odf/{change}/learning-proposals`, awaiting human approval
- Learnings referenced in future `/odf-new` explorations
- Available via `mem_search("odf-learned/{project}/")`
