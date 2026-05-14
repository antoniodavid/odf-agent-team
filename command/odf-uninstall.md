---
description: "Uninstall ODF components safely. Creates backup before removal. Usage: /odf-uninstall [--what <components>] [--force]"
---

# ODF: Uninstall

**Parse command:** `/odf-uninstall [--what <components>] [--force]`

Examples:
- `/odf-uninstall` — Interactive: choose components to remove
- `/odf-uninstall --what all` — Remove ALL ODF components (with confirmation)
- `/odf-uninstall --what registry,commands --force` — Remove registry + commands, skip confirm

## What This Does

Safely removes ODF-managed files. NEVER touches non-ODF files. Creates a backup before any removal.

Components available:
- `all` — Everything ODF-managed
- `registry` — odf-registry.json + .registry-cache.json
- `agents` — agent/*.md
- `skills` — skills/odf-* + skills/oca/01-oca-governance/oca-* (solo prefijos ODF)
- `commands` — command/odf-*.md
- `plugins` — plugins/odf-delegation.ts
- `backups` — backups/
- `metrics` — metrics/

## Orchestrator Instructions

### Interactive (no --what)

```
1. Show component selector:

ODF: Uninstall
  Select components to remove:
    [ ] all
    [ ] registry
    [ ] agents
    [ ] skills
    [ ] commands
    [ ] plugins
    [ ] backups
    [ ] metrics

2. On selection:
   a. Create backup: /odf-backup create (automatic)
   b. Show preview of files to be deleted
   c. Confirm: "Remove {N} files? This cannot be undone. [y/N]"
   d. On yes: delete files, show summary
```

### With --what

```
1. Parse comma-separated component list
2. Create backup automatically
3. If --force: skip confirmation, remove immediately
4. If no --force: show preview + ask confirmation
5. Remove files per component:

   COMPONENT → FILES TO REMOVE:
   registry  → ~/.config/opencode/odf-registry.json, .registry-cache.json
   agents    → ~/.config/opencode/agent/*.md
   skills    → ~/.config/opencode/skills/odf-*, skills/oca/01-oca-governance/oca-*
              (NOT skills/oca/02-*, 03-*, etc.)
   commands  → ~/.config/opencode/command/odf-*.md
   plugins   → ~/.config/opencode/plugins/odf-delegation.ts
   backups   → ~/.config/opencode/backups/
   metrics   → ~/.config/opencode/metrics/

6. Show summary:

ODF: Uninstall Complete
  Removed: {N} files
  Backup:  {backup-id}
  Components: {list}

  To restore: /odf-backup restore {backup-id}
```

### Important Rules

- NEVER remove: skills/oca/03-patterns/, skills/oca/02-development-style/ (except oca-* prefixed), skills/oca/04-testing/, skills/oca/05-version/
- NEVER remove: ~/.config/opencode/opencode.json, tui.json, plugins/ (except odf-delegation.ts), skills/_shared/
- ALWAYS create backup before removal
- ALWAYS confirm unless --force
