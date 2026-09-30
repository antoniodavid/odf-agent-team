import { describe, expect, it } from "vitest"
import fs from "node:fs"
import YAML from "yaml"

const proposerPath = new URL("../agent/odoo_proposer.md", import.meta.url)
const proposer = fs.readFileSync(proposerPath, "utf8")
const frontmatter = YAML.parse(proposer.match(/^---\n([\s\S]*?)\n---/)?.[1] || "")
const orchestrator = fs.readFileSync(new URL("../agent/odoo_orchestrator.md", import.meta.url), "utf8")
const orchestratorFrontmatter = YAML.parse(orchestrator.match(/^---\n([\s\S]*?)\n---/)?.[1] || "")
type PermissionRule = { action: string; resource: string; effect: string }
type AgentFrontmatter = { mode?: string; permissions: PermissionRule[]; [key: string]: unknown }

const agentFrontmatters = Object.fromEntries(fs.readdirSync(new URL("../agent/", import.meta.url))
  .filter(filename => filename.endsWith(".md"))
  .map(filename => {
    const source = fs.readFileSync(new URL(`../agent/${filename}`, import.meta.url), "utf8")
    const parsed = YAML.parse(source.match(/^---\n([\s\S]*?)\n---/)?.[1] || "")
    return [parsed.name || filename.replace(/\.md$/, ""), parsed as AgentFrontmatter]
  })) as Record<string, AgentFrontmatter>

const permissionEffect = (agent: AgentFrontmatter, action: string) => [...(agent.permissions || [])]
  .reverse()
  .find(rule => rule.action === action && rule.resource === "*")?.effect

describe("odoo proposer persistence contract", () => {
  it("uses OpenCode V2 permissions for bounded proposal persistence", () => {
    expect(frontmatter).not.toHaveProperty("permission")
    expect(frontmatter).not.toHaveProperty("temperature")
    expect(frontmatter.request.body.temperature).toBe(0.2)
    expect(frontmatter.permissions).toEqual(expect.arrayContaining([
      { action: "read", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "~/.config/opencode/**", effect: "allow" },
      { action: "mgrep", resource: "*", effect: "deny" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "shell", resource: "*", effect: "deny" },
      { action: "odf_proposal_write", resource: "*", effect: "allow" },
    ]))

    expect(orchestratorFrontmatter).not.toHaveProperty("permission")
    expect(orchestratorFrontmatter).not.toHaveProperty("temperature")
    expect(orchestratorFrontmatter.request.body.temperature).toBe(0.2)
    expect(orchestratorFrontmatter.permissions).toEqual(expect.arrayContaining([
      { action: "read", resource: "*", effect: "allow" },
      { action: "glob", resource: "*", effect: "allow" },
      { action: "grep", resource: "*", effect: "allow" },
      { action: "mgrep", resource: "*", effect: "deny" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "shell", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "~/.config/opencode/**", effect: "allow" },
      { action: "question", resource: "*", effect: "allow" },
      { action: "odf_*", resource: "*", effect: "allow" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "odoo_*", effect: "allow" },
    ]))
  })

  it("uses explicit V2 effective permissions for every ODF child agent", () => {
    expect(Object.keys(agentFrontmatters)).toHaveLength(11)
    for (const [name, config] of Object.entries(agentFrontmatters)) {
      expect(config, name).not.toHaveProperty("permission")
      expect(config, name).not.toHaveProperty("temperature")
      expect(config.permissions, name).toEqual(expect.arrayContaining([
        { action: "read", resource: "*", effect: "allow" },
        { action: "mgrep", resource: "*", effect: "deny" },
      ]))
      for (const rule of config.permissions) {
        expect(Object.keys(rule).sort(), `${name} permission shape`).toEqual(["action", "effect", "resource"])
        expect(["allow", "ask", "deny"], `${name} permission effect`).toContain(rule.effect)
      }
    }

    const expected = {
      odoo_api_integrator: ["allow", "allow"],
      odoo_backend_engineer: ["allow", "allow"],
      odoo_batch_implementer: ["allow", "allow"],
      odoo_code_reviewer: ["deny", "ask"],
      odoo_dba_devops: ["ask", "ask"],
      odoo_frontend_engineer: ["allow", "allow"],
      odoo_functional_consultant: ["deny", "ask"],
      odoo_proposer: ["deny", "deny"],
      odoo_qa_engineer: ["deny", "allow"],
      odoo_upgrade_migrator: ["ask", "ask"],
    }
    for (const [name, [edit, shell]] of Object.entries(expected)) {
      const config = agentFrontmatters[name]
      expect(config.mode, `${name} mode`).toBe("subagent")
      expect(permissionEffect(config, "edit"), `${name} edit`).toBe(edit)
      expect(permissionEffect(config, "shell"), `${name} shell`).toBe(shell)
      expect(config.permissions).toContainEqual({ action: "odf_*", resource: "*", effect: "deny" })
      expect(config.permissions).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
    }

    expect(agentFrontmatters.odoo_orchestrator.mode).toBe("primary")
    expect(agentFrontmatters.odoo_orchestrator.permissions).toContainEqual({ action: "odf_*", resource: "*", effect: "allow" })
    expect(agentFrontmatters.odoo_orchestrator.permissions).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
    expect(agentFrontmatters.odoo_orchestrator.permissions).toContainEqual({ action: "subagent", resource: "odoo_*", effect: "allow" })

    const proposerRules = agentFrontmatters.odoo_proposer.permissions
    expect(proposerRules.findIndex(rule => rule.action === "odf_*" && rule.effect === "deny")).toBeLessThan(
      proposerRules.findIndex(rule => rule.action === "odf_proposal_write" && rule.effect === "allow"),
    )
    expect(permissionEffect(agentFrontmatters.odoo_proposer, "odf_proposal_write")).toBe("allow")
  })

  it("requires persistence before returning the phase result", () => {
    expect(proposer).toContain("Persist the complete proposal before returning.")
    expect(proposer).toContain("call `odf_proposal_write`")
    expect(proposer).toContain("delegation token from the")
    expect(proposer).toContain("For `hybrid`, also save the matching Engram artifact")
    expect(proposer).toContain("Do not return `ok` with proposal prose only.")
    expect(proposer).toContain("artifacts_saved")
    expect(proposeSkill).toContain("call `odf_proposal_write`")
    expect(orchestrator).toContain("Pass the selected `artifact_store` when preparing PROPOSE")
  })
})

const proposeSkill = fs.readFileSync(new URL("../skills/odf-propose/SKILL.md", import.meta.url), "utf8")
const assessSkill = fs.readFileSync(new URL("../skills/odf-assess/SKILL.md", import.meta.url), "utf8")
const consultant = fs.readFileSync(new URL("../agent/odoo_functional_consultant.md", import.meta.url), "utf8")

describe("grilling and requirements-quality contracts", () => {
  it("orchestrator owns the interactive grilling as frontier rounds", () => {
    expect(orchestrator).toContain("frontier")
    expect(orchestrator).toContain("recommended answer")
  })

  it("proposal consumes grilling decisions instead of re-interviewing", () => {
    expect(proposeSkill).toContain("Grilling upstream")
    expect(proposeSkill).toContain("### Decisions")
    expect(proposer).toContain("### Decisions")
  })

  it("assess enforces the requirements quality checklist", () => {
    expect(assessSkill).toContain("Requirements Quality Checklist")
    expect(consultant).toContain("Requirements Quality")
  })
})
