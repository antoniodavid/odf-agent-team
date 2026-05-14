---
description: "Refresh ODF skill registry. Scans skills/ for changes, updates odf-registry.json, persists to Engram. Usage: /odf-registry-refresh [--force]"
---

# ODF: Refresh Skill Registry

**Parse command:** `/odf-registry-refresh [--force]`

Examples:
- `/odf-registry-refresh` — Scan for new/changed/removed skills, update registry
- `/odf-registry-refresh --force` — Full re-scan (ignore cache)

## What This Does

Scans `~/.config/opencode/skills/` for all SKILL.md files. Compares fingerprints (path + mtime + size) against `.registry-cache.json`. Updates `odf-registry.json` with any changes. Creates a backup before modifying.

## Orchestrator Instructions

1. **Check cache** (skip if --force):
   ```
   Read ~/.config/opencode/.registry-cache.json
   If exists: compare each skill's path + mtime + size against cache
   Unchanged skills: skip
   ```

2. **Scan skills**:
   ```
   Find all SKILL.md recursively in ~/.config/opencode/skills/
   For each:
     Read frontmatter: name, description, triggers, license, version
     Read ## Rules section → compact_rules
     Read sdd_phase if present
     Determine category from parent directory name
     Compute fingerprint: {path, mtime, size}
   ```

3. **Diff against current registry**:
   ```
   FOR EACH scanned skill:
     IF new → add to skills array
     IF changed → update entry, append to changelog
     IF removed → mark removed: true (don't delete, preserve history)

   FOR EACH registry skill NOT found in scan:
     Mark removed: true
   ```

4. **Backup before write**:
   ```
   cp odf-registry.json odf-registry.json.backup.$(date +%Y%m%d_%H%M%S)
   ```

5. **Write updated registry** + update `.registry-cache.json`

6. **Persist to Engram**:
   ```
   mem_save(
     title: "odf/registry/{timestamp}",
     topic_key: "odf/registry/latest",
     type: "config",
     project: "opencode",
     content: "{summary: X skills scanned, Y changed, Z new, W removed}"
   )
   ```

7. **Show summary**:
   ```
   ODF: Registry Refreshed
     Skills scanned: {N}
     New: {N}
     Updated: {N}
     Removed: {N}
     Total in registry: {N}
   ```
