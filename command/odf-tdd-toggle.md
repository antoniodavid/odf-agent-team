---
description: "Toggle Strict TDD mode on/off. When on, tests must be written BEFORE code. Usage: /odf-tdd on|off|status"
---

# ODF: Strict TDD Mode

**Parse command:** `/odf-tdd <action>`

Examples:
- `/odf-tdd status` — Show current TDD mode
- `/odf-tdd on` — Enable Strict TDD (test-first enforcement)
- `/odf-tdd off` — Disable Strict TDD (tests can come after code)

## What This Does

When enabled, every ODF phase enforces test-first: (1) write failing test, (2) implement to make it pass, (3) refactor. The VERIFY phase rejects implementations without matching tests.

## Orchestrator Instructions

### Status

```
1. Read ~/.config/opencode/odf-registry.json
2. Check if flags.strict_tdd exists and is true
3. Show:

ODF: Strict TDD Mode
  Status: {ON | OFF}
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
6. Confirm: "ODF: Strict TDD enabled. Tests must now be written BEFORE code."
```

### Off

```
1. Read ~/.config/opencode/odf-registry.json
2. Set flags.strict_tdd: false
3. Save
4. Confirm: "ODF: Strict TDD disabled. Tests can come after code."
```
