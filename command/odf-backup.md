---
description: "Backup and restore ODF configuration. Creates snapshots of registry + agents + skills + plugins. Usage: /odf-backup create|list|restore <id>"
---

# ODF: Backup & Rollback

**Parse command:** `/odf-backup <action> [id]`

Examples:
- `/odf-backup create` — Create a new backup snapshot
- `/odf-backup list` — List available backups
- `/odf-backup restore 20260514_120000` — Restore a backup by ID

## What This Does

Creates timestamped snapshots of ODF configuration. Backup includes: `odf-registry.json`, all files under `agent/`, `skills/`, `plugins/`, `command/`. Auto-prunes to keep last 5 backups.

## Orchestrator Instructions

### Create

```
1. Define paths:
   BACKUP_DIR = ~/.config/opencode/backups/{YYYYMMDD_HHmmss}/
   SNAPSHOT = {registry.json, agent/*, skills/*, plugins/*, command/*}
   METADATA = {timestamp, file_count, total_size}

2. Create directory: mkdir -p $BACKUP_DIR

3. Copy files:
   cp odf-registry.json $BACKUP_DIR/
   cp -r agent/ $BACKUP_DIR/agent/
   cp -r skills/ $BACKUP_DIR/skills/
   cp -r plugins/ $BACKUP_DIR/plugins/
   cp -r command/ $BACKUP_DIR/command/

4. Write metadata:
   cat > $BACKUP_DIR/metadata.json << 'EOF'
   { "timestamp": "{ISO date}", "files": {count}, "size": {bytes} }
   EOF

5. Prune old backups:
   Keep only last 5 in ~/.config/opencode/backups/
   Remove oldest beyond that

6. Confirm:
   ODF: Backup Created
     ID: {YYYYMMDD_HHmmss}
     Files: {N}
     Size: {KB}
     Retention: 5 backups (auto-pruned)
```

### List

```
1. List directories in ~/.config/opencode/backups/ sorted by date DESC
2. For each: read metadata.json → show ID, date, files, size
3. Show active marker for most recent

Output:
  ODF: Available Backups
    {ID}  {date}  {files} files  {size}KB  ← active
    {ID}  {date}  {files} files  {size}KB
```

### Restore

```
1. Validate backup ID exists
2. Confirm with user: "Restore {ID} from {date}? This will overwrite current config."
3. Copy files back:
   cp $BACKUP_DIR/odf-registry.json ~/.config/opencode/
   cp -r $BACKUP_DIR/agent/* ~/.config/opencode/agent/
   cp -r $BACKUP_DIR/skills/* ~/.config/opencode/skills/
4. Show confirmation
```
