# Engram Artifact Convention (ODF)

## Naming Rules

ALL ODF artifacts persisted to Engram MUST follow this deterministic naming:

```
title:     odf/{change-name}/{artifact-type}
topic_key: odf/{change-name}/{artifact-type}
type:      architecture
project:   {detected or current project name}
scope:     project
```

## Artifact Types (exact strings)

| Artifact Type | Produced By | Description |
|---------------|-------------|-------------|
| `assess` | odf-assess | Functional assessment + strategy (standard vs custom) |
| `design` | odf-design | Technical design + task breakdown |
| `implement-progress` | odf-implement | Implementation batch progress (updated per batch) |
| `verify-report` | odf-verify | Verification report (tests, OCA compliance, pre-commit) |
| `state` | orchestrator | DAG state for recovery after compaction |
| `fix-report` | odf-fix | Lightweight bugfix report (diagnose + fix + verify) |
| `learned` | orchestrator | Retrospective after successful verify |
| `explore` | odf-explore | Deep investigation of Odoo codebase patterns |
| `retrospective` | odf-archive | Final retrospective when archiving completed change |

### Standalone Exploration Artifacts (no change-name)

| Artifact Type | Produced By | Description |
|---------------|-------------|-------------|
| `odf/explore/{topic}` | odf-explore | Research on a topic not tied to a specific change |

### Project-level Artifacts (different prefix)

| Artifact Type | Produced By | Description |
|---------------|-------------|-------------|
| `odf-init/{project}` | odf-init | Project context: Odoo version, modules, test runner, linting |
| `odf-learned/{project}/{change}` | orchestrator | Knowledge accumulated from completed changes |

## State Artifact Format

The orchestrator persists DAG state after each phase transition:

```
mem_save(
  title: "odf/{change-name}/state",
  topic_key: "odf/{change-name}/state",
  type: "architecture",
  project: "{project}",
  content: "change: {change-name}
phase: {last-completed-phase}
odoo_version: {16|17|18|19}
module: {module_name}
strategy: {standard|custom|pending}
artifacts:
  assess: true|false
  design: true|false
  implement: true|false
  verify: true|false
tasks_progress:
  completed: []
  pending: []
timestamps:
  started_at: {ISO date}
  assess_completed: {ISO date or null}
  design_completed: {ISO date or null}
  implement_completed: {ISO date or null}
  verify_completed: {ISO date or null}
last_updated: {ISO date}"
)
```

Recovery: `mem_search("odf/{change-name}/state")` then `mem_get_observation(id)` then parse YAML then restore orchestrator state.

## Example

```
mem_save(
  title: "odf/sale-discount-field/assess",
  topic_key: "odf/sale-discount-field/assess",
  type: "architecture",
  project: "my-odoo-project",
  content: "# Functional Assessment: Sale Discount Field\n\n..."
)
```

## Recovery Protocol (2 steps — MANDATORY)

To retrieve an artifact, ALWAYS use this two-step process:

```
Step 1: Search by topic_key pattern
  mem_search(query: "odf/{change-name}/{artifact-type}", project: "{project}")
  Returns a truncated preview with an observation ID

Step 2: Get full content (REQUIRED)
  mem_get_observation(id: {observation-id from step 1})
  Returns complete, untruncated content
```

NEVER use `mem_search` results directly as the full artifact — they are truncated previews.
ALWAYS call `mem_get_observation` to get the complete content.

## Retrieving Multiple Artifacts

When a skill needs multiple artifacts (e.g., odf-verify needs assess + design + implement-progress):

```
1. mem_search(query: "odf/{change-name}/assess", project: "{project}") -> get ID
2. mem_search(query: "odf/{change-name}/design", project: "{project}") -> get ID
3. mem_search(query: "odf/{change-name}/implement-progress", project: "{project}") -> get ID
4. mem_get_observation(id) for EACH -> full content
```

## Browsing All Artifacts for a Change

```
mem_search(query: "odf/{change-name}/", project: "{project}")
Returns all artifacts for that change
```

## Writing Artifacts

### Standard Write (new artifact)

```
mem_save(
  title: "odf/{change-name}/{artifact-type}",
  topic_key: "odf/{change-name}/{artifact-type}",
  type: "architecture",
  project: "{project}",
  content: "{full markdown content}"
)
```

### Update Existing Artifact

When updating an artifact you already retrieved (e.g., marking tasks complete):

```
mem_update(
  id: {observation-id},
  content: "{updated full content}"
)
```

Use `mem_update` when you have the exact observation ID. Use `mem_save` with the same `topic_key` for upserts (Engram deduplicates by topic_key).

## Why This Convention Exists

- **Deterministic titles** — recovery works by exact match, not fuzzy search
- **`topic_key`** — enables upserts (updating same artifact without creating duplicates)
- **`odf/` prefix** — namespaces all ODF artifacts away from other Engram observations
- **Two-step recovery** — `mem_search` previews are always truncated; `mem_get_observation` is the only way to get full content
- **Lineage** — verify-report references all previous artifact IDs for complete traceability
