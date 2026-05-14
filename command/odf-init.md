---
description: "Initialize ODF project context. Detects Odoo version, modules, test runner, linting. Usage: /odf-init [--force]"
---

# ODF: Initialize Project

**Parse command:** `/odf-init [--force]`

Examples:
- `/odf-init` -- Detect and persist project context
- `/odf-init --force` -- Re-detect even if config already exists

## What This Does

Scans the current project to detect Odoo version, modules, test runner, linting
tools, and conventions. Persists the result to Engram so all ODF phases can
read it without re-detecting.

## Orchestrator Instructions

1. **Check for existing config**:
   ```
   mem_search("odf-init/{project-name}")
   ```
   - If found AND no `--force` flag: Show existing config summary, ask if user wants to re-detect
   - If found AND `--force`: Proceed to re-detect
   - If not found: Proceed to detect

2. **Launch detection**: Read `/home/adruban/.config/opencode/skills/odf-init/SKILL.md` and run detection
   - This is a direct orchestrator task (no sub-agent delegation needed)
   - The orchestrator itself performs the detection since it has filesystem access

3. **Show results** to user:
   ```
   ODF: Project Initialized

     Project: {name}
     Odoo: {version}
     Modules: {count} ({custom} custom, {oca} OCA)
     Tests: {runner} ({command preview})
     Linting: {pre-commit yes/no}, {pylint-odoo yes/no}
     OCA mode: {yes/no}

     Config saved to Engram. All ODF commands will use this context.
   ```

4. **Warnings**: If any critical detection failed (no Odoo version, no test runner):
   ```
   Warnings:
     - Could not detect Odoo version. Set manually: /odf-init --odoo-version 18
     - No test runner found. Tests will need to be run manually.
   ```

## Integration with Other Commands

- `/odf-new` checks for `odf-init/{project}` in Engram before starting. If missing, suggests `/odf-init` first.
- All phase skills read project config for test/lint commands instead of hardcoding.
- `/odf-init` is idempotent -- running it again updates the existing config via topic_key upsert.

## Manual Overrides

Users can pass overrides that take precedence over detection:

```
/odf-init --odoo-version 18
/odf-init --docker-container odoo18
/odf-init --no-oca
/odf-init --tdd
```

These are persisted as part of the config with `override: true` flag so
re-detection doesn't overwrite them.
