---
description: "Initialize ODF project context. Detects Odoo version, modules, test runner, linting. Usage: /odf-init [--force]"
---

# ODF: Initialize Project

**Parse command:** `/odf-init [--force]`

Examples:
- `/odf-init` -- Detect and persist project context
- `/odf-init --force` -- Re-detect even if config already exists
- `/odf-init --deep` -- Also index active Doodba source repos with CodeGraph

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

2. **Launch deterministic scan**: run the CLI (preferred; no manual re-derivation). Resolve the pack path deterministically — `PACK="${ODF_CONFIG_DIR:-$HOME/.config/opencode}"`; never search the filesystem. If the script is missing, reinstall the pack and stop:
   ```
   node "$PACK/scripts/odf-project-scan.js" --root <doodba-workspace-root> --repo <repo-dir> --persist --format summary
   ```
   - Add `--diff` when re-detecting (shows changes vs the persisted config), `--fresh` to bypass the checksum cache, and pass user overrides as flags (`--odoo-version 18`, `--docker-container odoo`, `--codegraph`).
   - Exit codes: `0` ok; `1` warnings — show them; `2` blocked — fall back to manual detection (read `skills/odf-init/SKILL.md` steps) or ask the user for the missing values; never guess.
   - **Success requires the CLI output to include `persisted to Engram topic odf-init/{project} (verified)`.** If that line is absent (no `--persist`, persist error, or readback mismatch), the project is NOT initialized: stop and report, do not claim success, do not fall back to manual persistence.
   - If the CLI cannot run, read `skills/odf-init/SKILL.md` and run detection manually.

3. **Show results** to user:
   ```
   ODF: Project Initialized

     Project: {name}
     Odoo: {version}
     Modules: {count} ({custom} custom, {oca} OCA)
     Tests: {runner} ({command preview})
     Linting: {pre-commit yes/no}, {pylint-odoo yes/no}
     OCA mode: {yes/no}
     Environment: {sources active} sources, {declared-absent} declared-absent, {undeclared} undeclared
     CodeGraph: {indexed yes/no} ({root})
     Config saved to Engram. All ODF commands will use this context.
   ```
   Show warnings when `declared_absent` or `undeclared` sources exist, when a project module depends on an unresolved non-core module, or when the CodeGraph index is missing.

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
