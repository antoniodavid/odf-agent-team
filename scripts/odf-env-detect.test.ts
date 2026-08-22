import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { execFileSync } from "node:child_process"
import { detectEnv } from "./odf-env-detect.js"

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const file = path.join(dir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, "utf8")
}

function manifest(name: string, version: string, license: string, depends: string[]): string {
  return `{
    'name': '${name}',
    'version': '${version}',
    'license': '${license}',
    'depends': [${depends.map(d => `'${d}'`).join(", ")}],
}`
}

async function gitInitBranch(dir: string, branch: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  execFileSync("git", ["init", "-b", branch], { cwd: dir, stdio: "ignore" })
  await fs.writeFile(path.join(dir, ".gitkeep"), "", "utf8")
  execFileSync("git", ["add", ".gitkeep"], { cwd: dir, stdio: "ignore" })
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init"], { cwd: dir, stdio: "ignore" })
}

describe("odf-env-detect", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-env-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it("classifies sources, reads modules/depends, branches, and the dependency matrix", async () => {
    const src = path.join(root, "odoo", "custom", "src")
    await writeFile(root, "odoo/custom/src/addons.yaml", [
      "repo-a:",
      '  - "*"',
      "repo-b:",
      '  - "*"',
      "repo-e:",
      '  - "*"',
      "# repo-x:",
      '#   - "*"',
      "# repo-y:",
      '#   - "*"',
    ].join("\n"))

    await gitInitBranch(path.join(src, "repo-a"), "feature/x")
    await writeFile(root, "odoo/custom/src/repo-a/mod_a1/__manifest__.py", manifest("Mod A1", "18.0.1.0.0", "AGPL-3", ["base", "stock"]))
    await writeFile(root, "odoo/custom/src/repo-a/mod_a2/__manifest__.py", manifest("Mod A2", "18.0.1.1.0", "LGPL-3", ["base"]))

    // repo-b is declared but NOT cloned.
    await writeFile(root, "odoo/custom/src/repo-e/mod_e1/__manifest__.py", manifest("Mod E1", "18.0.1.0.0", "AGPL-3", ["base"]))

    // repo-c is cloned but undeclared.
    await fs.mkdir(path.join(src, "repo-c", "mod_c1"), { recursive: true })

    // Project repo (no git).
    const repoDir = path.join(root, "project")
    await writeFile(root, "project/mod_p1/__manifest__.py", manifest("Mod P1", "18.0.1.0.0", "AGPL-3", ["mod_a1", "web", "totally_missing"]))

    const env = detectEnv(root, repoDir)

    expect(env.addons_yaml).toContain("addons.yaml")
    expect(env.sources.active).toEqual(["repo-a", "repo-b", "repo-e"])
    expect(env.sources.commented).toEqual(["repo-x", "repo-y"])
    expect(env.sources.declared_absent).toEqual(["repo-b"])
    expect(env.sources.undeclared).toEqual(["repo-c"])

    expect(env.sources.active_repos).toHaveLength(2)
    const repoA = env.sources.active_repos.find(r => r.name === "repo-a")!
    expect(repoA.branch).toBe("feature/x")
    expect(repoA.modules.map(m => m.name)).toEqual(["mod_a1", "mod_a2"])
    expect(repoA.modules[0].display_name).toBe("Mod A1")
    expect(repoA.modules[0].depends).toEqual(["base", "stock"])
    expect(repoA.modules[0].version).toBe("18.0.1.0.0")
    expect(repoA.modules[0].license).toBe("AGPL-3")
    const repoE = env.sources.active_repos.find(r => r.name === "repo-e")!
    expect(repoE.branch).toBeNull()

    expect(env.project.repo).toBe("project")
    expect(env.project.branch).toBeNull()
    expect(env.project.modules).toHaveLength(1)
    expect(env.project.modules[0].name).toBe("mod_p1")
    expect(env.project.modules[0].depends).toEqual(["mod_a1", "web", "totally_missing"])

    expect(env.dependency_matrix.resolved).toEqual([{ module: "mod_p1", dep: "mod_a1", in_repo: "repo-a" }])
    expect(env.dependency_matrix.unresolved_in_sources).toEqual([
      { module: "mod_p1", dep: "web" },
      { module: "mod_p1", dep: "totally_missing" },
    ])
    expect(env.warnings.some(w => w.includes("repo-b"))).toBe(true)
  })

  it("warns instead of throwing when addons.yaml or the src tree is missing", () => {
    const env = detectEnv(root, path.join(root, "project"))
    expect(env.addons_yaml).toBeNull()
    expect(env.sources.active).toEqual([])
    expect(env.sources.active_repos).toEqual([])
    expect(env.project.modules).toEqual([])
    expect(env.warnings.length).toBeGreaterThan(0)
  })

  it("handles a repo cloned without git (branch null) and skips hidden dirs", async () => {
    await writeFile(root, "odoo/custom/src/addons.yaml", "repo-a:\n  - \"*\"\n")
    await fs.mkdir(path.join(root, "odoo", "custom", "src", "repo-a", "mod_a1"), { recursive: true })
    await writeFile(root, "odoo/custom/src/repo-a/mod_a1/__manifest__.py", manifest("Mod A1", "18.0.1.0.0", "AGPL-3", ["base"]))
    await fs.mkdir(path.join(root, "odoo", "custom", "src", ".hidden"), { recursive: true })

    const env = detectEnv(root, path.join(root, "project"))
    const repoA = env.sources.active_repos.find(r => r.name === "repo-a")!
    expect(repoA.branch).toBeNull()
    expect(repoA.modules.map(m => m.name)).toEqual(["mod_a1"])
    expect(env.sources.undeclared).not.toContain(".hidden")
  })
})
