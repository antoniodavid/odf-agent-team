---
description: "Create a custom Odoo specialist agent. Usage: /odf-agent-new <description> [--phase PHASE]"
---

# ODF: Create New Agent

**Parse command:** `/odf-agent-new <description> [--phase PHASE]`

Examples:
- `/odf-agent-new "Expert in Argentine AFIP accounting with automatic perceptions"`
- `/odf-agent-new "Specialist in Odoo stock lot/serial tracking" --phase DESIGN`
- `/odf-agent-new "Reviewer for OCA compliance and security issues" --phase VERIFY`

## What This Does

Triggers the ODF Agent Builder to create a new custom sub-agent specialized in a specific Odoo domain.

## Orchestrator Instructions

1. **Read skill**: Load `~/.config/opencode/skills/odf-agent-builder/SKILL.md`
2. **Parse input**: Extract description and optional phase from command
3. **Check registry**: Search `odf-registry.json` and Engram for duplicate agents
4. **Execute builder workflow**:
   - Step 1-3: Parse, check duplicates, compose prompt
   - Step 4: Generate via `opencode run`
   - Step 5: Parse result into SKILL.md + AGENT.md
   - Step 6: Show preview to user
   - Step 7-8: Install and confirm

## Phase Option

If `--phase` is specified:
- The generated agent will be registered as supporting that ODF phase
- The orchestrator will prefer this agent over defaults when delegating that phase
- Valid phases: `ASSESS`, `DESIGN`, `IMPLEMENT`, `VERIFY`

If no phase specified:
- Agent is created as **standalone** (not tied to a specific phase)
- It activates based on trigger keywords only

## Output

```
ODF Agent Builder

Domain detected: {domain}
Generating specialist agent...

Preview:
  Name: odoo_{name}
  Expertise: {description}
  Phase: {phase or "Standalone"}
  Triggers: {keywords}

[Install] [Edit] [Regenerate]
```

## Quick Reference

| Step | Action | Tool |
|------|--------|------|
| Parse | Extract description + phase | - |
| Check | Search registry + Engram | mem_search, file read |
| Compose | Build generation prompt | - |
| Generate | Run opencode | bash: opencode run |
| Parse | Split SKILL.md / AGENT.md | string processing |
| Preview | Show to user | - |
| Install | Write files + update registry | write, edit |
| Persist | Save to Engram | mem_save |
