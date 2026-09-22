---
description: "Refresh ODF skill registry. Scans skills/ for changes, updates odf-registry.json, persists to Engram. Usage: /odf-registry-refresh [--force]"
---

# ODF: Refresh Skill Registry

**Parse command:** `/odf-registry-refresh [--force]`

Examples:
- `/odf-registry-refresh` — Scan for new/changed/removed skills, update registry
- `/odf-registry-refresh --force` — Full re-scan (ignore cache)

## What This Does

Scans `~/.config/opencode/skills/` for all SKILL.md files under `odf-*`, `oca/`, and `odoo_*` directories **plus every path already present in the registry** (flat `.md` entries such as `oca-*.md`, patterns, and `_shared/skill-resolver.md` are refreshed by fingerprint, not discovered by SKILL.md scan). Compares fingerprints (path + mtime + size) against `.registry-cache.json`. Updates `odf-registry.json` with any changes. Creates a backup before modifying.

When `registry.flags.use_relative_paths` is `true` (the default for new installs), skill and agent paths are stored relative to the directory containing `odf-registry.json`. Absolute legacy paths are preserved unchanged.

## Orchestrator Instructions

1. **Check cache** (skip if --force):
   ```
   Read ~/.config/opencode/.registry-cache.json
   If exists: compare each skill's path + mtime + size against cache
   Unchanged skills: skip
   ```

2. **Scan skills** (two sources — the union is the scan set):
   ```
   SOURCE A (discovery): Find all SKILL.md recursively in ~/.config/opencode/skills/
     Include directories matching: odf-*, oca, odoo_*
   SOURCE B (refresh): every skills[].path already in odf-registry.json
     (flat .md files are NOT discovered by SOURCE A — without SOURCE B they
      would be wrongly marked removed on every refresh)

   FOR EACH path in (SOURCE A ∪ SOURCE B):
     Skip if marked removed: true and not in SOURCE A
     Read frontmatter: name, description, triggers, license, version
     Read ## Rules section → compact_rules
     Read sdd_phase if present
     Determine category from parent directory name
     Compute fingerprint: {path, mtime, size}
     If path does not exist on disk → candidate for removed: true
   ```

3. **Resolve path format**:
   ```
   IF registry.flags.use_relative_paths IS true:
     Store path relative to ~/.config/opencode/
   ELSE:
     Store absolute path
   ```

4. **Diff against current registry**:
   ```
   FOR EACH scanned skill:
     IF new → add to skills array
     IF changed → update entry, append to changelog

   FOR EACH registry skill NOT in the union scan set AND missing on disk:
     Mark removed: true (don't delete, preserve history)
   NEVER mark removed: true for a path that still exists on disk merely
   because it is not a SKILL.md — SOURCE B covers those paths.
   ```

5. **Backup before write**:
   ```
   cp odf-registry.json odf-registry.json.backup.$(date +%Y%m%d_%H%M%S)
   ```

6. **Write updated registry** + update `.registry-cache.json`

7. **Persist to Engram**:
   ```
   mem_save(
     title: "odf/registry/{timestamp}",
     topic_key: "odf/registry/latest",
     type: "config",
     project: "opencode",
     content: "{summary: X skills scanned, Y changed, Z new, W removed}"
   )
   ```

8. **Show summary**:
   ```
   ODF: Registry Refreshed
     Skills scanned: {N}
     New: {N}
     Updated: {N}
     Removed: {N}
     Total in registry: {N}
     use_relative_paths: {true|false}
   ```
