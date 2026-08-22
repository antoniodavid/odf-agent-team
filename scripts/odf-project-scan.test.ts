import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { execFileSync } from "node:child_process"
import { buildConfig, classifyExit, computeChecksum, diffConfigs } from "./odf-project-scan.js"
import YAML from "yaml"

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const file = path.join(dir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, "utf8")
}

const manifest = (name: string, depends: string[]) => `{
    'name': '${name}',
    'version': '18.0.1.0.0',
    'license': 'AGPL-3',
    'depends': [${depends.map(d => `'${d}'`).join(", ")}],
}`

describe("odf-project-scan", () => {
  let root: string
  let repo: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-scan-"))
    repo = path.join(root, "myrepo")
    await writeFile(root, "odoo/custom/src/addons.yaml", "repo-a:\n  - \"*\"\n")
    await writeFile(root, "odoo/custom/src/repo-a/mod_a1/__manifest__.py", manifest("mod_a1", ["base"]))
    await writeFile(root, "devel.yaml", "services:\n  odoo:\n    image: ghcr.io/tecnativa/odoo:18.0+e\n    environment:\n      POSTGRES_DB: devel\n")
    await writeFile(root, "myrepo/mod_p1/__manifest__.py", manifest("mod_p1", ["mod_a1", "web"]))
    await writeFile(root, "myrepo/.pre-commit-config.yaml", "")
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it("builds the full config: sources, compose, lint, version, codegraph, matrix", () => {
    const config = buildConfig(root, repo)
    expect(config.project_name).toBe("myrepo")
    expect(config.odoo_version).toBe(18)
    expect(config.modules.map(m => m.name)).toEqual(["mod_p1"])
    expect(config.environment.compose).toMatchObject({ service: "odoo", db: "devel" })
    expect(config.testing.test_command).toContain("docker compose run --rm odoo odoo -d {test_db} -i {module}")
    expect(config.testing.test_db).toBe("devel")
    expect(config.linting.pre_commit).toBe(true)
    expect(config.codegraph.indexed).toBe(false)
    expect(config.dependency_matrix.resolved).toEqual([{ module: "mod_p1", dep: "mod_a1", in_repo: "repo-a" }])
    expect(config.dependency_matrix.unresolved_in_sources).toEqual([{ module: "mod_p1", dep: "web" }])
    expect(config.scan_checksum).toMatch(/^[0-9a-f]{64}$/)
  })

  it("checksum changes when a manifest changes and is stable otherwise", async () => {
    const a = buildConfig(root, repo)
    const b = buildConfig(root, repo)
    expect(a.scan_checksum).toBe(b.scan_checksum)
    await writeFile(root, "myrepo/mod_p1/__manifest__.py", manifest("mod_p1", ["mod_a1", "web", "sale"]))
    const c = buildConfig(root, repo)
    expect(c.scan_checksum).not.toBe(a.scan_checksum)
  })

  it("classifies exit codes: 0 ok, 1 warnings, 2 blocked", () => {
    const ok = buildConfig(root, repo)
    ok.warnings = []
    expect(classifyExit(ok)).toBe(0)
    expect(classifyExit(buildConfig(root, repo))).toBe(1)
    const blocked = buildConfig(root, path.join(root, "empty-repo"))
    blocked.odoo_version = null
    blocked.modules = []
    blocked.warnings = []
    expect(classifyExit(blocked)).toBe(2)
  })

  it("diffs only changed fields between cached and fresh configs", () => {
    const cached = buildConfig(root, repo)
    const fresh = buildConfig(root, repo)
    expect(diffConfigs(cached, fresh)).toEqual([])
    fresh.odoo_version = 19
    const changes = diffConfigs(cached, fresh)
    expect(changes).toEqual(["odoo_version: 18 -> 19"])
  })

  it("config serializes to parseable YAML with the yaml package", () => {
    const config = buildConfig(root, repo)
    const roundTrip = YAML.parse(YAML.stringify(config))
    expect(roundTrip.project_name).toBe("myrepo")
    expect(roundTrip.environment.sources.active).toEqual(["repo-a"])
  })

  it("empty environment blocks and warns instead of throwing", () => {
    const config = buildConfig(path.join(root, "nowhere"), path.join(root, "nowhere-repo"))
    expect(config.odoo_version).toBeNull()
    expect(config.modules).toEqual([])
    expect(config.warnings.length).toBeGreaterThan(0)
    expect(computeChecksum(["a", "b"])).toMatch(/^[0-9a-f]{64}$/)
  })
})
