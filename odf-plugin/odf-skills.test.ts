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

  it("falls back to compact rules when the canonical body is unavailable", async () => {
    const output = await formatDelegationSkills([
      makeSkill({ name: "canonical", title: "Canonical Stage", path: path.join(dir, "missing.md"), compact_rules: "- Fallback rule.", _canonical: true }),
    ])
    expect(output).toContain("_Full stage instructions unavailable; using compact rules._")
    expect(output).toContain("Fallback rule.")
  })

  it("does not inline the body of non-canonical skills", async () => {
    const file = path.join(dir, "extra", "SKILL.md")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "---\nname: extra\n---\n\n## Secret body\n", "utf8")
    const output = await formatDelegationSkills([
      makeSkill({ name: "extra", title: "Extra Standard", path: file, compact_rules: "- Extra rule." }),
    ])
    expect(output).not.toContain("Secret body")
    expect(output).toContain("Extra rule.")
  })
})
