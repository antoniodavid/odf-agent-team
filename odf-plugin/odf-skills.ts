/**
 * Skill matching, version detection, and profile resolution + their tools.
 * Extracted from plugins/odf-delegation.ts — behavior unchanged.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { filterStopWords, resolveAgent } from "../scripts/lib/agent-resolve.js"
import { loadRegistry } from "./odf-registry-io.js"
import { debugLog, type ODFRegistry, type ODFSkill } from "./odf-delegation-shared.js"

// ==========================================
// VERSION DETECTION
// ==========================================

export async function detectOdooVersion(projectDir: string): Promise<number | null> {
  try {
    // Try to find __manifest__.py in project or subdirectories
    const manifestPaths = [
      path.join(projectDir, "__manifest__.py"),
      path.join(projectDir, "*", "__manifest__.py"),
    ]

    for (const pattern of manifestPaths) {
      if (pattern.includes("*")) {
        // Glob-like: check direct children
        const entries = await fs.readdir(projectDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const manifestPath = path.join(projectDir, entry.name, "__manifest__.py")
            try {
              const content = await fs.readFile(manifestPath, "utf8")
              const versionMatch = content.match(/['"]version['"]\s*:\s*['"](\d+)\.\d+/)
              if (versionMatch) {
                return parseInt(versionMatch[1], 10)
              }
            } catch {
              // Continue to next directory
            }
          }
        }
      } else {
        try {
          const content = await fs.readFile(pattern, "utf8")
          const versionMatch = content.match(/['"]version['"]\s*:\s*['"](\d+)\.\d+/)
          if (versionMatch) {
            return parseInt(versionMatch[1], 10)
          }
        } catch {
          // Continue
        }
      }
    }
  } catch {
    // Could not detect version
  }
  return null
}

// ==========================================
// PROFILE RESOLUTION
// ==========================================

export async function getProfileByPhase(
  registry: ODFRegistry,
  phase: string,
  profileName?: string
): Promise<{ model: string; temperature: number; reasoning?: boolean; name?: string } | null> {
  if (!registry.profiles) return null

  // Find active profile first
  const profiles = registry.profiles as any[]
  const selectedProfile = profileName
    ? profiles.find(p => p.name === profileName)
    : profiles.find(p => p.active === true) || profiles.find(p => p.name === "default") || profiles[0]

  if (selectedProfile && selectedProfile.phases && selectedProfile.phases[phase.toUpperCase()]) {
    return {
      ...selectedProfile.phases[phase.toUpperCase()],
      name: selectedProfile.name,
    }
  }

  // Fall back to flat profile structure
  const flatProfile = registry.profiles.find(p => (p as any).phase === phase.toUpperCase())
  if (flatProfile) {
    return {
      model: (flatProfile as any).model,
      temperature: (flatProfile as any).temperature,
      reasoning: (flatProfile as any).reasoning,
    }
  }

  return null
}

export function formatProfileBlock(
  profile: { model: string; temperature: number; reasoning?: boolean; name?: string },
  phase: string
): string {
  return `## SDD Profile (auto-resolved)
Profile: ${profile.name || "default"}
Phase: ${phase}
Model: ${profile.model ?? "current (inherited)"}
Temperature: ${profile.temperature}
Reasoning: ${profile.reasoning ? "enabled" : "disabled"}`
}

// ==========================================
// SKILL MATCHING
// ==========================================

const EXPLICIT_OCA_TARGET = /(?:^|[\s([{,;])target\s*=\s*oca(?:$|[\s)\]},;.!?])/i

function hasExplicitOcaTarget(context: { task?: string; target?: string | null }): boolean {
  return context.target?.trim().toLowerCase() === "oca" || EXPLICIT_OCA_TARGET.test(context.task || "")
}

export function matchSkills(
  registry: ODFRegistry,
  phase: string | null,
  context: { files?: string[]; task?: string; odooVersion?: number | null; target?: string | null }
): ODFSkill[] {
  const matches: ODFSkill[] = []
  const taskLower = context.task?.toLowerCase() || ""
  const ocaTargeted = hasExplicitOcaTarget(context)
  const normalizedPhase = phase?.toUpperCase() || null
  const canonicalName = normalizedPhase === "QA-PLAN"
    ? "odf-qa"
    : normalizedPhase
      ? `odf-${normalizedPhase.toLowerCase()}`
      : null

  for (const skill of registry.skills) {
    if (skill.name === "odf-oca-governance" && !ocaTargeted) continue
    const isOdfSkill = skill.category === "odf" || skill.category.startsWith("odf/")
    if (isOdfSkill && normalizedPhase && skill.sdd_phase && skill.sdd_phase.toUpperCase() !== normalizedPhase) {
      continue
    }

    const isCanonical = skill.name === canonicalName
    // Version pinning: skip skills that don't support the detected version
    if (context.odooVersion && skill.odoo_versions.length > 0) {
      if (!skill.odoo_versions.includes(context.odooVersion)) {
        continue
      }
    }

    let score = 0

    // Match by file context
    if (context.files) {
      for (const file of context.files) {
        const fileLower = file.toLowerCase()
        for (const trigger of skill.triggers) {
          if (fileLower.includes(trigger.toLowerCase())) {
            score += 2
          }
        }
      }
    }

    // Match by task context
    for (const trigger of skill.triggers) {
      if (taskLower.includes(trigger.toLowerCase())) {
        score += 1
      }
    }

    if (score > 0 || isCanonical || (skill.name === "odf-oca-governance" && ocaTargeted)) {
      matches.push({ ...skill, _score: score, _canonical: isCanonical } as ODFSkill & { _score: number; _canonical: boolean })
    }
  }

  // Sort by score (desc) then by compact_rules length (more specific first)
  matches.sort((a: any, b: any) => {
    if (b._canonical !== a._canonical) {
      return Number(b._canonical) - Number(a._canonical)
    }
    if (b._score !== a._score) {
      return b._score - a._score
    }
    return b.compact_rules.length - a.compact_rules.length
  })

  return matches.slice(0, 5)
}

// Karpathy-inspired precision guardrails — always injected first
const KARPATHY_COMPACT_RULES = [
  "- State assumptions explicitly before implementing. If uncertain, ask.",
  "- If multiple interpretations exist, present all — do NOT pick silently.",
  "- No features beyond what was asked. No abstractions for single-use code.",
  "- No 'flexibility' or 'configurability' that wasn't requested.",
  "- Don't 'improve' adjacent code, comments, or formatting.",
  "- Don't refactor things that aren't broken. Match existing style.",
  "- Every changed line must trace directly to the task requirement.",
  "- Transform 'fix bug' → 'write failing test first, then make it pass'.",
  "- For multi-step: state plan with verification per step.",
  "- If 200 lines could be 50, rewrite it smaller.",
].join("\n")

export function formatCompactRules(skills: ODFSkill[]): string {
  const sections: string[] = ["## Project Standards (auto-resolved)\n"]

  // Precision guardrails always injected first (karpathy-precision)
  sections.push("### Precision Guardrails")
  sections.push(KARPATHY_COMPACT_RULES)
  sections.push("")

  for (const skill of skills) {
    sections.push(`### ${skill.title}`)
    sections.push(skill.compact_rules)
    sections.push("")
  }

  return sections.join("\n")
}

// ==========================================
// SKILL TOOLS
// ==========================================

export function createODFSkillInject(): ReturnType<typeof tool> {
  return tool({
    description: `Read the ODF registry and return compact rules for matching skills.

Use this to manually inject standards into a sub-agent prompt when not using odf_delegate.`,
    args: {
      context_files: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Files being worked on"),
      task_description: tool.schema
        .string()
        .optional()
        .describe("Description of the task"),
      target: tool.schema
        .string()
        .optional()
        .describe("Explicit governance target, such as oca"),
      max_skills: tool.schema
        .number()
        .optional()
        .describe("Max skills to return (default: 5)"),
    },
    async execute(args: { context_files?: string[]; task_description?: string; target?: string; max_skills?: number }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found"
      }

       const skills = matchSkills(registry, null, {
        files: args.context_files,
        task: args.task_description,
        target: args.target,
      })
      debugLog(`[odf-delegation] odf_skill_inject: matched ${skills.length} skills`)

      const limit = args.max_skills || 5
      const limited = skills.slice(0, limit)

      if (limited.length === 0) {
        return "No matching skills found in registry for the given context."
      }

      return formatCompactRules(limited)
    },
  })
}

export function createODFSkillResolve(): ReturnType<typeof tool> {
  return tool({
    description: `Preview what skills, agent, and profile would be selected for a task WITHOUT executing.

Use this for debugging:
- "Why was agent X chosen?"
- "What skills would match?"
- "Which profile applies?"`,
    args: {
      phase: tool.schema
        .string()
        .describe("ODF phase: PROPOSE, ASSESS, QA-PLAN, DESIGN, IMPLEMENT, VERIFY, EXPLORE"),
      task: tool.schema
        .string()
        .describe("Task description to analyze"),
      context_files: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Files involved (for skill matching)"),
      target: tool.schema
        .string()
        .optional()
        .describe("Explicit governance target, such as oca"),
      odoo_version: tool.schema
        .number()
        .optional()
        .describe("Odoo version (auto-detected if not provided)"),
    },
    async execute(args: { phase: string; task: string; context_files?: string[]; target?: string; odoo_version?: number }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found"
      }

      // Detect version if not provided
      let version = args.odoo_version || null
      if (!version) {
        // Try to detect from current working directory
        version = await detectOdooVersion(process.cwd())
      }

      // Resolve agent
      const keywords = args.task.split(/\s+/).slice(0, 10)
      const agentName = resolveAgent(registry, args.phase, keywords)
      const agent = registry.agents.find(a => a.name === agentName)

      // Match skills
       const skills = matchSkills(registry, args.phase, {
         files: args.context_files,
         task: args.task,
         target: args.target,
         odooVersion: version,
      })

      // Get profile (named profile format)
      const profile = await getProfileByPhase(registry, args.phase)

      const lines: string[] = [
        "## ODF Skill Resolution (Preview)",
        "",
        `**Phase:** ${args.phase}`,
        `**Odoo Version:** ${version || "not detected (no version filter applied)"}`,
        "",
        "### Agent Resolution",
        `**Selected:** ${agentName || "none"}`,
      ]

      if (agent) {
        lines.push(`**Description:** ${agent.description}`)
        lines.push(`**Phases:** ${agent.phases.join(", ")}`)
        lines.push(`**Installed:** ${agent.installed}`)
      } else {
        lines.push(`**Status:** ⚠️ Agent not found in registry`)
      }

      lines.push("")
      lines.push("### Skill Matching")
      lines.push(`**Matched:** ${skills.length} skill(s)`)

      if (skills.length > 0) {
        for (const skill of skills) {
          const score = (skill as any)._score || "?"
          const versionNote = skill.odoo_versions.length > 0
            ? ` [v${skill.odoo_versions.join(",")}]`
            : " [all versions]"
          lines.push(`- **${skill.title}** (${skill.name}) — score: ${score}${versionNote}`)
        }
      } else {
        lines.push("_No skills matched the task/files/version._")
      }

      lines.push("")
      lines.push("### SDD Profile")
      if (profile) {
        lines.push(`**Model:** ${profile.model ?? "current (inherited)"}`)
        lines.push(`**Temperature:** ${profile.temperature}`)
        lines.push(`**Reasoning:** ${profile.reasoning ? "enabled" : "disabled"}`)
      } else {
        lines.push("_No profile for this phase._")
      }

      lines.push("")
      lines.push("### Filtered Keywords")
      const filtered = filterStopWords(keywords)
      lines.push(`Original: [${keywords.join(", ")}]`)
      lines.push(`Filtered: [${filtered.join(", ")}]`)

      return lines.join("\n")
    },
  })
}
