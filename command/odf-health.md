---
description: "Check ODF agent system health. Usage: /odf-health [--quick|--full]"
---

# ODF: Health Check

**Parse command:** `/odf-health [--quick|--full]`

Examples:
- `/odf-health` — Quick check (<5s)
- `/odf-health --full` — Full verification (~30s)

## What This Does

Verifies that the ODF agent system is intact: registry valid, all skills/agents resolvable on disk, plugins loadable, test runner passing.

## Orchestrator Instructions

### --quick (default)

```
1. Read ~/.config/opencode/odf-registry.json → validate JSON
2. Count skills + agents + profiles
3. Check first 3 skills exist on disk (spot check)
4. Check first 3 agents exist on disk (spot check)
5. Check plugin file exists: ~/.config/opencode/plugins/odf-delegation.ts

Report:

ODF: Health Report (quick)

  Registry:     ✅ valid JSON ({N} skills, {N} agents, {N} profiles)
  Skills disk:  ✅ spot check passed ({N} sampled)
  Agents disk:  ✅ spot check passed ({N} sampled)
  Plugin:       ✅ odf-delegation.ts ({N} lines)

  Overall: ✅ HEALTHY
```

### --full

```
1. Run all quick checks
2. For EVERY skill in registry: verify SKILL.md exists on disk
3. For EVERY agent in registry: verify .md exists on disk
4. Check for unregistered skills in skills/ directory
5. Check for unregistered agents in agent/ directory
6. Run test runner: node scripts/odf-test-runner.js
7. Check backup directory exists

Report:

ODF: Health Report (full)

  Registry:     ✅ valid JSON ({N} skills, {N} agents, {N} profiles)
  Skills disk:  ✅ {N}/{N} found | ❌ {N} missing | ⚠️ {N} unregistered
  Agents disk:  ✅ {N}/{N} found | ❌ {N} missing | ⚠️ {N} unregistered
  Plugin:       ✅ odf-delegation.ts ({N} lines)
  Tests:        ✅ {N}/{N} passing
  Backups:      ✅ {N} available (latest: {date})
  Metrics:      ✅ {N} days of data

  Overall: {HEALTHY | WARNINGS | UNHEALTHY}
```
