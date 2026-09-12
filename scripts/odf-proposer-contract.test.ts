import { describe, expect, it } from "vitest"
import fs from "node:fs"
import YAML from "yaml"

const proposerPath = new URL("../agent/odoo_proposer.md", import.meta.url)
const proposer = fs.readFileSync(proposerPath, "utf8")
const frontmatter = YAML.parse(proposer.match(/^---\n([\s\S]*?)\n---/)?.[1] || "")

describe("odoo proposer persistence contract", () => {
  it("allows OpenSpec writes without enabling bash", () => {
    expect(frontmatter.permission.edit).toBe("allow")
    expect(frontmatter.permission.bash).toBe("deny")
  })

  it("requires persistence before returning the phase result", () => {
    expect(proposer).toContain("Persist the complete proposal before returning.")
    expect(proposer).toContain("Do not return `ok` with proposal prose only.")
    expect(proposer).toContain("artifacts_saved")
  })
})

const orchestrator = fs.readFileSync(new URL("../agent/odoo_orchestrator.md", import.meta.url), "utf8")
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
