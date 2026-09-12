---
description: "Show status of active ODF changes. Usage: /odf-status [change-name]"
triggers: ["/odf-status"]
agent: odoo_orchestrator
---

# /odf-status — ODF change status

Shows all active ODF changes or the detail of a specific change.

## Usage

```
/odf-status              — Show all active changes
/odf-status <change-name> — Show detail for one change
```

## Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `change-name` | No | string | Name of the change to show in detail |

## Examples

- `/odf-status`
- `/odf-status sale-discount-field`

## Orchestrator Instructions

1. **Query `odf_workflow_status` in read-only mode**. For a named change, first read `openspec/changes/{change}/state.yaml` and its artifacts; Engram fills in missing groups and keeps conflicts as warnings.
2. If no valid OpenSpec `state.yaml` exists, use Engram as a fallback, show `source.state: engram` and its warning, without presenting it as OpenSpec authority. Without a name, keep the existing Engram selection and query OpenSpec only for that selected change.
3. If a name is given, render the **change detail** using `renderStatusDetail(change, state)`.
4. If there is no name, render the **summary table** using `renderStatusTable(states)`.
5. Include the suggested command to continue each change.

## Canonical Fields

In the detail, show these fields in addition to the legacy ones (`phase`, `artifacts`, `applyProgress`, `lastUpdated`):

- `canonical_stage`
- `legacy_phase`
- `completed_canonical_stages`
- `pending_stage`
- `progress` (`completed`, `total`, `known`, `source`)
- `artifact_refs`
- `receipt` (`state`, `status`, `action`, `ref`)
- `resumable`
- `source` (`state`, `artifacts`)
- `warnings`

OpenSpec is the authority for state and canonical artifacts when available. The command does not write `state.yaml`, artifacts, or receipts.

## Routing Contract

- Input: `/odf-status` command with optional name.
- Output: state rendered in English.

## Error Handling

- **No active changes**: show an empty message and suggest `/odf-new`.
- **Change not found**: list active ones.
- **Failed to read state**: show the error and suggest `/odf-init`.

## Output Format (table)

```
ODF Status

| Change              | Phase    | Next      | Version | Strategy   |
|---------------------|----------|-----------|---------|------------|
| sale-discount-field | ASSESS   | design    | 18      | custom     |
| pos-custom-receipt  | init     | preflight | 18      | pending    |

Commands:
  /odf-continue sale-discount-field  — Continue implementation
  /odf-continue pos-custom-receipt   — Continue to DESIGN
```

## Output Format (detail)

```
## ODF Status: sale-discount-field

- **Change**: sale-discount-field
- **Odoo version**: 18
- **Strategy**: custom
- **Current phase**: ASSESS
- **Next phase**: design
- **Canonical stage**: DECIDE
- **Pending canonical stage**: PLAN
- **Completed canonical stages**: DECIDE
- **Progress**: 0/0 (unknown; source: null)
- **Artifact refs**: DECIDE=[odf/sale-discount-field/assess]
- **Receipt**: none (resumable: true)
- **Source**: engram
- **Warnings**: []

**Artifacts**:
- [x] assess
- [ ] qa-plan
- [ ] design
- [ ] implement
- [ ] verify

Continue: /odf-continue sale-discount-field
```
