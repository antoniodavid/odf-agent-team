import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { formatDelegationSkills, readSkillInstructions } from "./odf-skills.js"

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    name: "demo",
    title: "Demo Skill",
    category: "odf",
    triggers: ["demo"],
    compact_rules: "- Compact rule for demo.",
    path: "",
    odoo_versions: [],
    sdd_phase: null,
    ...overrides,
  } as any
}

describe("readSkillInstructions", () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "odf-skill-body-"))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("strips frontmatter and lists bundled resources", async () => {
    const skillDir = path.join(dir, "demo")
    await fs.mkdir(path.join(skillDir, "references"), { recursive: true })
    await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true })
    await fs.writeFile(path.join(skillDir, "references", "guide.md"), "guide\n", "utf8")
    await fs.writeFile(path.join(skillDir, "scripts", "run.sh"), "echo ok\n", "utf8")
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo\ndescription: Demo.\n---\n\n## Procedure\n\nDo the thing.\n",
      "utf8",
    )

    const result = await readSkillInstructions({ path: path.join(skillDir, "SKILL.md") })
    expect(result).not.toBeNull()
    expect(result?.body).toContain("## Procedure")
    expect(result?.body).not.toContain("description: Demo.")
    expect(result?.bundled).toEqual(["references/guide.md", "scripts/run.sh"])
    expect(result?.truncated).toBe(false)
  })

  it("returns null when the file cannot be read", async () => {
    expect(await readSkillInstructions({ path: path.join(dir, "missing", "SKILL.md") })).toBeNull()
  })

  it("truncates bodies over the 20,000-character cap", async () => {
    const file = path.join(dir, "SKILL.md")
    await fs.writeFile(file, `---\nname: demo\n---\n\n${"x".repeat(20_500)}\n`, "utf8")
    const result = await readSkillInstructions({ path: file })
    expect(result?.truncated).toBe(true)
    expect(result?.body).toContain("truncated at 20000 characters")
  })
})

describe("formatDelegationSkills", () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "odf-skill-format-"))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("inlines the canonical stage body and keeps compact rules for other skills", async () => {
    const canonicalPath = path.join(dir, "canonical", "SKILL.md")
    await fs.mkdir(path.dirname(canonicalPath), { recursive: true })
    await fs.writeFile(canonicalPath, "---\nname: canonical\n---\n\n## Activation Contract\n\nFollow the real procedure.\n", "utf8")

    const output = await formatDelegationSkills([
      makeSkill({ name: "canonical", title: "Canonical Stage", path: canonicalPath, compact_rules: "- Canonical compact rule.", _canonical: true }),
      makeSkill({ name: "extra", title: "Extra Standard", compact_rules: "- Extra compact rule." }),
    ])

    expect(output).toContain("## Activation Contract")
    expect(output).toContain("Follow the real procedure.")
    expect(output).not.toContain("Canonical compact rule.")
    expect(output).toContain("Extra compact rule.")
    expect(output).toContain("### Precision Guardrails")
  })


  it("skips a governance body with a weak match and prefers a pattern domain", async () => {
    const governance = path.join(dir, "governance", "SKILL.md")
    const pattern = path.join(dir, "pattern", "SKILL.md")
    await fs.mkdir(path.dirname(governance), { recursive: true })
    await fs.mkdir(path.dirname(pattern), { recursive: true })
    await fs.writeFile(governance, "---\nname: governance\n---\n\n## Governance body\n", "utf8")
    await fs.writeFile(pattern, "---\nname: pattern\n---\n\n## Pattern body\n", "utf8")

    const output = await formatDelegationSkills([
      makeSkill({ name: "governance", title: "Governance", path: governance, compact_rules: "- Governance rule.", category: "governance", _score: 1 }),
      makeSkill({ name: "pattern", title: "Pattern", path: pattern, compact_rules: "- Pattern rule.", category: "patterns/business", _score: 1 }),
    ])
    expect(output).not.toContain("Governance body")
    expect(output).toContain("Pattern body")
  })

  it("falls back to compact rules when the canonical body is unavailable", async () => {
    const output = await formatDelegationSkills([
      makeSkill({ name: "canonical", title: "Canonical Stage", path: path.join(dir, "missing.md"), compact_rules: "- Fallback rule.", _canonical: true }),
    ])
    expect(output).toContain("_Full stage instructions unavailable; using compact rules._")
    expect(output).toContain("Fallback rule.")
  })

  it("inlines the body of the highest-scoring non-canonical standard", async () => {
    const first = path.join(dir, "first", "SKILL.md")
    const second = path.join(dir, "second", "SKILL.md")
    await fs.mkdir(path.dirname(first), { recursive: true })
    await fs.mkdir(path.dirname(second), { recursive: true })
    await fs.writeFile(first, "---\nname: first\n---\n\n## First standard body\n", "utf8")
    await fs.writeFile(second, "---\nname: second\n---\n\n## Second standard body\n", "utf8")

    const output = await formatDelegationSkills([
      makeSkill({ name: "first", title: "First Standard", path: first, compact_rules: "- First rule.", category: "patterns/business", _score: 2 }),
      makeSkill({ name: "second", title: "Second Standard", path: second, compact_rules: "- Second rule.", category: "patterns/business", _score: 1 }),
    ])
    expect(output).toContain("First standard body")
    expect(output).not.toContain("Second standard body")
    expect(output).toContain("Second rule.")
  })

  it("caps the non-canonical standard body at 8,000 characters", async () => {
    const file = path.join(dir, "extra", "SKILL.md")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `---\nname: extra\n---\n\n${"y".repeat(9_000)}\n`, "utf8")
    const output = await formatDelegationSkills([
      makeSkill({ name: "extra", title: "Extra Standard", path: file, compact_rules: "- Extra rule.", category: "patterns/testing", _score: 2 }),
    ])
    expect(output).toContain("truncated at 8000 characters")
    expect(output.length).toBeLessThan(10_000)
  })
})
