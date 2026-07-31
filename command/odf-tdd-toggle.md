---
description: "Two-source TDD kill switch. Any off wins, fail-closed. Usage: /odf-tdd on|off|status|local on|local off"
---

# ODF: Strict TDD Mode (Two-Source Kill Switch)

**Parse command:** `/odf-tdd <action>`

Examples:
- `/odf-tdd status` — Report BOTH sources and the EFFECTIVE mode
- `/odf-tdd on` — Enable Strict TDD globally (test-first enforcement)
- `/odf-tdd off` — Disable Strict TDD globally (tests can come after code)
- `/odf-tdd local off` — Create `<worktree>/.odf/tdd.off` (TDD off for THIS repo)
- `/odf-tdd local on` — Remove `<worktree>/.odf/tdd.off`

## What This Does

TDD is controlled by a TWO-SOURCE kill switch. ANY source off → effective TDD is OFF (fail-closed). A repo can NEVER force TDD on — only the user globally, or by removing the local marker.

| Source | Where | Meaning | Controlled by |
|--------|-------|---------|---------------|
| Global (user) | `~/.config/opencode/odf-registry.json` → `flags.strict_tdd` | TDD on/off for all projects | `/odf-tdd on\|off` |
| Clone-local (off-only) | `<worktree>/.odf/tdd.off` | TDD OFF for that repo | `/odf-tdd local off\|on` |

**Effective mode = global AND local.** If EITHER is off → effective OFF. If the local marker is unreadable → fail-closed (treat as OFF, never ON). Re-activating TDD re-validates state from zero — it does NOT inherit "was off, still no mandatory tests".

## Orchestrator Instructions

### Status

```
1. Read ~/.config/opencode/odf-registry.json → flags.strict_tdd (global source)
2. Detect worktree root: git rev-parse --show-toplevel
3. Check for <worktree>/.odf/tdd.off (local source). Unreadable → treat as OFF (fail-closed)
4. Effective = global AND local; any off (or unreadable local) → OFF
5. Show:

ODF: Strict TDD Mode
  Global (flags.strict_tdd):        {ON | OFF}
  Local  (<worktree>/.odf/tdd.off): {ON | OFF | UNREADABLE → OFF}
  Effective:                        {ON | OFF}
  Enforced since: {date or "N/A"}
```

### On

```
1. Backup registry: cp odf-registry.json odf-registry.json.backup.$(date +%Y%m%d_%H%M%S)
2. Read ~/.config/opencode/odf-registry.json
3. If flags key doesn't exist, create it:
   "flags": { "strict_tdd": true, "tdd_enforced_since": "{today}" }
4. If flags exists: set strict_tdd: true, tdd_enforced_since: "{today}"
5. Save
6. Confirm: "ODF: Strict TDD enabled globally. Effective mode also depends on the local source — run /odf-tdd status."
```

### Off

```
1. Read ~/.config/opencode/odf-registry.json
2. Set flags.strict_tdd: false
3. Save
4. Confirm: "ODF: Strict TDD disabled globally. Tests can come after code."
```

### Local off

```
1. Detect worktree root: git rev-parse --show-toplevel
2. mkdir -p <worktree>/.odf
3. touch <worktree>/.odf/tdd.off
4. Confirm: "ODF: TDD disabled for THIS repo (<worktree>). Any off wins — effective mode is OFF here."
```

### Local on

```
1. Detect worktree root: git rev-parse --show-toplevel
2. rm -f <worktree>/.odf/tdd.off
3. Confirm: "ODF: local TDD-off marker removed. Effective mode now depends on the global source — run /odf-tdd status."
```
