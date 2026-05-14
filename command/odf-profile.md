---
description: "Manage ODF model profiles. Switch between model configurations per phase. Usage: /odf-profile list|switch|create|delete <name>"
---

# ODF: Model Profiles

**Parse command:** `/odf-profile <action> [name]`

Examples:
- `/odf-profile list` — Show available profiles
- `/odf-profile switch cheap` — Switch to "cheap" profile
- `/odf-profile create fast` — Create new profile (copy of current)
- `/odf-profile delete cheap` — Delete a profile (not default)

## What This Does

ODF supports named model profiles. Each profile assigns a model + temperature per phase (ASSESS, QA-PLAN, DESIGN, IMPLEMENT, VERIFY). Switch between them at runtime. The `default` profile always exists and cannot be deleted.

## Orchestrator Instructions

### List

```
1. Read ~/.config/opencode/odf-registry.json → profiles array
2. For each profile: show name, active status, model per phase
3. Mark active profile with ←

Output:
  ODF: Model Profiles
    default    ← active
      ASSESS:    deepseek-r1 (temp 0.3)
      DESIGN:    kimi-k2.6 (temp 0.25)
      IMPLEMENT: kimi-k2.6 (temp 0.1)
      VERIFY:    deepseek-r1 (temp 0.2)

    cheap
      ASSESS:    kimi-k2.6 (temp 0.3)
      DESIGN:    kimi-k2.6 (temp 0.25)
      IMPLEMENT: kimi-k2.6 (temp 0.1)
      VERIFY:    kimi-k2.6 (temp 0.2)
```

### Switch

```
1. Find profile by name in registry.json → profiles[]
2. If not found: error "Profile {name} not found"
3. Set all profiles.active = false
4. Set target profile.active = true
5. Save registry.json
6. Confirm: "ODF: Switched to profile '{name}'"
```

### Create

```
1. Copy the currently active profile
2. Set new name (lowercase, no spaces)
3. Set active: false
4. Add to registry.json → profiles[]
5. Show preview: "ODF: Profile '{name}' created. Use /odf-profile switch {name} to activate."
```

### Delete

```
1. If name == "default": error "Cannot delete default profile"
2. Find and remove profile from registry.json → profiles[]
3. Confirm: "ODF: Profile '{name}' deleted"
```
