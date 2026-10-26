/**
 * Skill matching, version detection, and profile resolution + their tools.
 * Extracted from plugins/odf-delegation.ts — behavior unchanged.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { tool, type ToolContext } from "./odf-tool.js"
import { filterStopWords, resolveAgent } from "../scripts/lib/agent-resolve.js"
import { loadRegistry } from "./odf-registry-io.js"
import { debugLog, resolveToolWorkspaceRoot, type ODFRegistry, type ODFSkill } from "./odf-delegation-shared.js"
import { resolveDelegationTarget } from "./odf-delegation-contract.js"

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
  if (!Array.isArray(registry.profiles)) return null

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

export function profileExists(registry: ODFRegistry, name: string): boolean {
  return Array.isArray(registry.profiles) &&
    registry.profiles.some(profile => profile && typeof profile === "object" && (profile as { name?: unknown }).name === name)
}

export function formatProfileBlock(
  profile: { model: string; temperature: number; reasoning?: boolean; name?: string },
  phase: string
): string {
  return `## SDD Profile (advisory)
Profile: ${profile.name || "default"}
Phase: ${phase}
Model: ${profile.model ?? "current (inherited)"}
Temperature: ${profile.temperature}
Reasoning: ${profile.reasoning ? "enabled" : "disabled"}
The host task inherits its model and runtime settings; these values are prompt guidance unless the host applies them.`
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

  const registeredSkills = Array.isArray(registry.skills) ? registry.skills : []
  for (const [order, skill] of registeredSkills.entries()) {
    if (!skill || typeof skill !== "object") continue
    const triggers = Array.isArray(skill.triggers) ? skill.triggers : []
    const odooVersions = Array.isArray(skill.odoo_versions) ? skill.odoo_versions : []
    if (skill.name === "odf-oca-governance" && !ocaTargeted) continue
    const category = typeof skill.category === "string" ? skill.category : ""
    const isOdfSkill = category === "odf" || category.startsWith("odf/")
    if (isOdfSkill && normalizedPhase && skill.sdd_phase && skill.sdd_phase.toUpperCase() !== normalizedPhase) {
      continue
    }

    const isCanonical = skill.name === canonicalName
    // Version pinning: skip skills that don't support the detected version
    if (context.odooVersion && odooVersions.length > 0) {
      if (!odooVersions.includes(context.odooVersion)) {
        continue
      }
    }

    let score = 0

    // Match by file context
    if (context.files) {
      for (const file of context.files) {
        const fileLower = file.toLowerCase()
        for (const trigger of triggers) {
          if (typeof trigger === "string" && fileLower.includes(trigger.toLowerCase())) {
            score += 2
          }
        }
      }
    }

    // Match by task context
    for (const trigger of triggers) {
      if (typeof trigger === "string" && taskLower.includes(trigger.toLowerCase())) {
        score += 1
      }
    }

    if (score > 0 || isCanonical || (skill.name === "odf-oca-governance" && ocaTargeted)) {
      matches.push({ ...skill, _score: score, _canonical: isCanonical, _order: order } as ODFSkill & { _score: number; _canonical: boolean; _order: number })
    }
  }

  // Sort by canonical role, then score, then registry order. Registry order is
  // deterministic and never rewards longer prompt text.
  matches.sort((a: any, b: any) => {
    if (b._canonical !== a._canonical) {
      return Number(b._canonical) - Number(a._canonical)
    }
    if (b._score !== a._score) {
      return b._score - a._score
    }
    return a._order - b._order
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
        .array(tool.schema.string().max(512))
        .max(64)
        .optional()
        .describe("Files being worked on"),
      task_description: tool.schema
        .string()
        .max(20_000)
        .optional()
        .describe("Description of the task"),
      target: tool.schema
        .enum(["oca"])
        .optional()
        .describe("Explicit governance target, such as oca"),
      max_skills: tool.schema
        .number()
        .int()
        .min(1)
        .max(5)
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
      stage: tool.schema
        .string()
        .describe("Canonical stage: DECIDE, PLAN, BUILD, VERIFY, EXPLORE, FIX"),
      role: tool.schema
        .string()
        .optional()
        .describe("Role inside a composite stage: DECIDE requires PROPOSE or ASSESS; PLAN requires QA-PLAN or DESIGN. Omit for BUILD, VERIFY, EXPLORE, and FIX."),
      task: tool.schema
        .string()
        .min(1)
        .max(20_000)
        .describe("Task description to analyze"),
      context_files: tool.schema
        .array(tool.schema.string().max(512))
        .max(64)
        .optional()
        .describe("Files involved (for skill matching)"),
      target: tool.schema
        .enum(["oca"])
        .optional()
        .describe("Explicit governance target, such as oca"),
      odoo_version: tool.schema
        .number()
        .int()
        .min(16)
        .max(19)
        .optional()
        .describe("Odoo version (auto-detected if not provided)"),
      profile: tool.schema
        .string()
        .max(64)
        .optional()
        .describe("Optional profile name to preview; defaults to the active profile"),
    },
    async execute(args: { stage: string; role?: string; task: string; context_files?: string[]; target?: string; odoo_version?: number; profile?: string }, toolCtx: ToolContext): Promise<string> {
      const target = resolveDelegationTarget(args.stage, args.role)
      if (!target.ok) {
        return `❌ ${target.message}`
      }
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found"
      }

      // Detect version if not provided
      let version = args.odoo_version || null
      if (!version) {
        // Prefer the current session directory; fall back to cwd for standalone use.
        version = await detectOdooVersion(resolveToolWorkspaceRoot(undefined, toolCtx?.directory) ?? process.cwd())
      }

      // Resolve agent
      const keywords = args.task.split(/\s+/).slice(0, 10)
      const agentName = resolveAgent(registry, target.phase, keywords)
      const agent = registry.agents.find(a => a.name === agentName)

      // Match skills
       const skills = matchSkills(registry, target.phase, {
         files: args.context_files,
         task: args.task,
         target: args.target,
         odooVersion: version,
      })

      // Get profile (named profile format)
      if (args.profile && !profileExists(registry, args.profile)) {
        return `❌ Profile "${args.profile}" is not registered.`
      }
      const profile = await getProfileByPhase(registry, target.phase, args.profile)

      const lines: string[] = [
        "## ODF Skill Resolution (Preview)",
        "",
        `**Stage:** ${target.stage}${target.role ? ` ${target.role}` : ""}`,
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
        lines.push("**Advisory:** the task inherits the host model; this profile is prompt guidance unless the host applies it.")
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
