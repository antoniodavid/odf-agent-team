import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { spawnSync } from "node:child_process"

const REPO = path.resolve(__dirname, "..")
const VALIDATOR = path.join(REPO, "scripts", "odf-skill-validate.js")

type Result = { status: number | null; json: any; stderr: string }

function run(configDir: string, args: string[] = ["--json"]): Result {
  const result = spawnSync("node", [VALIDATOR, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    cwd: REPO,
    env: { ...process.env, ODF_CONFIG_DIR: configDir },
  })
  let json: any = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    json = null
  }
  return { status: result.status, json, stderr: result.stderr }
}

const VALID_RULES = [
  "- Use the public interface and keep changes inside the approved scope.",
  "- Add a regression test for every behavior change before implementing it.",
  "- Never invent identifiers; verify them against the local source.",
].join("\n")

function registry(skills: unknown[]) {
  return JSON.stringify({ version: 1, skills }, null, 2)
}

async function writeSkill(dir: string, rel: string, frontmatter: string, body = "# Skill\n\nUse it.\n") {
  const file = path.join(dir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `---\n${frontmatter}\n---\n\n${body}`, "utf8")
}

function entry(name: string, file: string, rules = VALID_RULES) {
  return {
    name,
    title: name,
    triggers: [name],
    compact_rules: rules,
    path: file,
    odoo_versions: [16, 17, 18, 19],
    sdd_phase: null,
  }
}

describe("odf-skill-validate", () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "odf-skill-validate-"))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("accepts the real registry with zero errors", () => {
    const result = run(REPO)
    expect(result.status).toBe(0)
    expect(result.json.skills).toBe(87)
    expect(result.json.errors).toBe(0)
  })

  it("rejects compact rules below the minimum length", async () => {
    await writeSkill(dir, "skills/demo/SKILL.md", "name: demo\ndescription: Use when demonstrating a skill.")
    await fs.writeFile(
      path.join(dir, "odf-registry.json"),
      registry([entry("demo", "skills/demo/SKILL.md", "- Too short.")]),
      "utf8",
    )
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.json.error_details.map((e: any) => e.check)).toContain("compact-rules-too-short")
  })

  it("rejects a name that does not match the SKILL.md directory", async () => {
    await writeSkill(dir, "skills/demo/SKILL.md", "name: other\ndescription: Use when demonstrating a skill.")
    await fs.writeFile(path.join(dir, "odf-registry.json"), registry([entry("demo", "skills/demo/SKILL.md")]), "utf8")
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.json.error_details.map((e: any) => e.check)).toContain("name-directory-mismatch")
  })

  it("reports warnings without failing unless --strict", async () => {
    await writeSkill(
      dir,
      "skills/demo/SKILL.md",
      "name: demo\ndescription: Use when demonstrating a skill.\nextra: value",
      "# Demo\n\nSee ~/.config/opencode/odf-registry.json.\n",
    )
    await fs.writeFile(path.join(dir, "odf-registry.json"), registry([entry("demo", "skills/demo/SKILL.md")]), "utf8")

    const lenient = run(dir)
    expect(lenient.status).toBe(0)
    expect(lenient.json.warning_summary["non-spec-key"]).toBe(1)
    expect(lenient.json.warning_summary["absolute-reference"]).toBe(1)

    const strict = run(dir, ["--json", "--strict"])
    expect(strict.status).toBe(1)
  })

  it("rejects a skill without a name", async () => {
    await writeSkill(dir, "skills/demo/SKILL.md", "description: Use when demonstrating a skill.")
    await fs.writeFile(path.join(dir, "odf-registry.json"), registry([entry("demo", "skills/demo/SKILL.md")]), "utf8")
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.json.error_details.map((e: any) => e.check)).toContain("name-missing")
  })

  it("rejects a file without frontmatter", async () => {
    const file = path.join(dir, "skills/demo/SKILL.md")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "# Demo\n\nNo frontmatter.\n", "utf8")
    await fs.writeFile(path.join(dir, "odf-registry.json"), registry([entry("demo", "skills/demo/SKILL.md")]), "utf8")
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.json.error_details.map((e: any) => e.check)).toContain("frontmatter-missing")
  })

  it("rejects duplicated compact rules", async () => {
    await writeSkill(dir, "skills/one/SKILL.md", "name: one\ndescription: Use when running the first skill.")
    await writeSkill(dir, "skills/two/SKILL.md", "name: two\ndescription: Use when running the second skill.")
    await fs.writeFile(
      path.join(dir, "odf-registry.json"),
      registry([entry("one", "skills/one/SKILL.md"), entry("two", "skills/two/SKILL.md")]),
      "utf8",
    )
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.json.error_details.map((e: any) => e.check)).toContain("compact-rules-duplicate")
  })
})
