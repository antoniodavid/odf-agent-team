---
description: "View ODF skill version history. Shows changelog per skill. Usage: /odf-skill-log <name>|--all"
---

# ODF: Skill Version Log

**Parse command:** `/odf-skill-log <name>` or `/odf-skill-log --all`

Examples:
- `/odf-skill-log odf-fix` — Show version history for odf-fix
- `/odf-skill-log --all` — Show all skills with current version

## What This Does

Shows version history and changelog per skill. Each skill in the registry has a `version` field and `changelog` array tracking changes over time.

## Orchestrator Instructions

### Single skill

```
1. Read ~/.config/opencode/odf-registry.json → skills
2. Find skill by name (case-insensitive, partial match ok)
3. If multiple matches: show list, ask user to narrow down
4. Display:

ODF: Skill Version - {name}
  Current: v{version}  ({path})
  Updated: {last_updated}

  Changelog:
    v{ver} ({date}) — {change description}
    v{ver} ({date}) — {change description}

  Triggers: [{triggers}]
  Category: {category}
  Versions: Odoo {versions}
  Phase: {sdd_phase or "Standalone"}
```

### All skills

```
1. Read all skills from registry
2. Show table:

ODF: All Skills ({N} total)
  {name:<30} v{ver:<5} {category:<20} {trigger_preview:<25}
  ...
```
