import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { execFileSync, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { buildConfig, classifyExit, compactForPersist, computeChecksum, diffConfigs, indexActiveSources, readPersistedConfig, resolveRepoArg } from "./odf-project-scan.js"
import YAML from "yaml"

const SCAN_CLI = fileURLToPath(new URL("./odf-project-scan.js", import.meta.url))

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

const FAKE_ENGRAM = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const storePath = process.env.ODF_TEST_ENGRAM_STORE
const read = () => fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, "utf8")) : []
if (args[0] === "save") {
  const topic = flag("--topic")
  const project = flag("--project")
  const others = read().filter(o => o.topic_key !== topic)
  fs.writeFileSync(storePath, JSON.stringify([...others, { topic_key: topic, content: args[2], project }]))
  process.exit(0)
}
if (args[0] === "export") {
  const project = flag("--project")
  const observations = project ? read().filter(o => o.project === project) : []
  fs.writeFileSync(args[1], JSON.stringify({ version: "test", observations }))
  fs.appendFileSync(process.env.ODF_TEST_ENGRAM_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\\n")
  process.exit(0)
}
process.exit(2)
`

async function withFakeEngram(
  script: string,
  run: (paths: { bin: string; log: string; store: string }) => Promise<void> | void,
): Promise<void> {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-bin-"))
  const previous = {
    PATH: process.env.PATH,
    log: process.env.ODF_TEST_ENGRAM_LOG,
    store: process.env.ODF_TEST_ENGRAM_STORE,
    config: process.env.ODF_TEST_ENGRAM_CONFIG,
  }
  const log = path.join(bin, "calls.jsonl")
  const store = path.join(bin, "observations.json")
  await fs.writeFile(path.join(bin, "engram"), script, "utf8")
  await fs.chmod(path.join(bin, "engram"), 0o755)
  process.env.PATH = `${bin}${path.delimiter}${previous.PATH || ""}`
  process.env.ODF_TEST_ENGRAM_LOG = log
  process.env.ODF_TEST_ENGRAM_STORE = store
  try {
    await run({ bin, log, store })
  } finally {
    process.env.PATH = previous.PATH
    if (previous.log === undefined) delete process.env.ODF_TEST_ENGRAM_LOG
    else process.env.ODF_TEST_ENGRAM_LOG = previous.log
    if (previous.store === undefined) delete process.env.ODF_TEST_ENGRAM_STORE
    else process.env.ODF_TEST_ENGRAM_STORE = previous.store
    if (previous.config === undefined) delete process.env.ODF_TEST_ENGRAM_CONFIG
    else process.env.ODF_TEST_ENGRAM_CONFIG = previous.config
    await fs.rm(bin, { recursive: true, force: true })
  }
}

async function readCalls(log: string): Promise<Array<{ args: string[]; cwd?: string }>> {
  try {
    return (await fs.readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
  } catch {
    return []
  }
}

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

  it("detects linting from the workspace root when the repo has no configs", async () => {
    await fs.rm(path.join(root, "myrepo", ".pre-commit-config.yaml"))
    await writeFile(root, ".pylintrc", "")
    await writeFile(root, ".copier-answers.yml", "template: oca-addons-repo\n")
    const config = buildConfig(root, repo)
    expect(config.linting.pre_commit).toBe(false)
    expect(config.linting.pylint_odoo).toBe(true)
    expect(config.flags.oca_mode).toBe(true)
  })

  it("resolves a relative --repo against the Doodba src dir, not the CWD", () => {
    expect(resolveRepoArg(root, "myrepo")).toBe(path.join(root, "odoo", "custom", "src", "myrepo"))
    expect(resolveRepoArg(root, path.join(root, "elsewhere"))).toBe(path.join(root, "elsewhere"))
  })

  it("indexes active source repos with --deep through the injected runner", () => {
    const config = buildConfig(root, repo)
    const calls: string[] = []
    const fakeRunner = (dir: string) => { calls.push(dir); return "ok" }
    const deep = indexActiveSources(config, root, fakeRunner)
    expect(calls).toEqual([path.join(root, "odoo", "custom", "src", "repo-a")])
    expect(deep.indexed).toEqual(["repo-a"])
    expect(deep.errors).toEqual([])
    const failing = indexActiveSources(config, root, () => "boom")
    expect(failing.errors).toEqual(["repo-a: boom"])
  })

  it("compactForPersist strips per-repo module lists but keeps the checksum and counts", () => {
    const config = buildConfig(root, repo)
    const compact = compactForPersist(config)
    expect(compact.scan_checksum).toBe(config.scan_checksum)
    expect(compact.environment.sources.active_repos[0]).toEqual({ name: "repo-a", branch: null, module_count: 1 })
    expect(compact.modules).toEqual(config.modules)
    expect(YAML.stringify(compact).length).toBeLessThan(YAML.stringify(config).length)
  })

  it("readPersistedConfig returns the LATEST observation for a topic, not the first", async () => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "odf-engram-bin-"))
    const previousPath = process.env.PATH
    const previousExport = process.env.ODF_TEST_ENGRAM_EXPORT
    await fs.writeFile(path.join(bin, "engram"), "#!/bin/sh\nprintf '%s' \"$ODF_TEST_ENGRAM_EXPORT\" > \"$2\"\n", "utf8")
    await fs.chmod(path.join(bin, "engram"), 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath || ""}`
    try {
      const oldConfig = YAML.stringify({ project_name: "proj", odoo_version: null, modules: [] })
      const newConfig = YAML.stringify({ project_name: "proj", odoo_version: 19, modules: [{ name: "m1" }], testing: { test_command: "cmd" } })
      process.env.ODF_TEST_ENGRAM_EXPORT = JSON.stringify({
        observations: [
          { topic_key: "odf-init/proj", content: oldConfig },
          { topic_key: "odf-init/proj", content: newConfig },
        ],
      })
      const config = readPersistedConfig("proj")
      expect(config?.odoo_version).toBe(19)
      expect(config?.modules).toEqual([{ name: "m1" }])
      expect(config?.testing.test_command).toBe("cmd")
    } finally {
      process.env.PATH = previousPath
      if (previousExport === undefined) delete process.env.ODF_TEST_ENGRAM_EXPORT
      else process.env.ODF_TEST_ENGRAM_EXPORT = previousExport
      await fs.rm(bin, { recursive: true, force: true })
    }
  })

  it("scopes the Engram export to the requested project and cwd", async () => {
    await withFakeEngram(FAKE_ENGRAM, async ({ log }) => {
      process.env.ODF_TEST_ENGRAM_CONFIG = YAML.stringify({ project_name: "proj", odoo_version: 19, modules: [] })
      execFileSync("engram", ["save", "odf-init/proj", process.env.ODF_TEST_ENGRAM_CONFIG, "--type", "config", "--project", "proj", "--scope", "project", "--topic", "odf-init/proj"], { encoding: "utf8" })
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "odf-scan-cwd-"))
      try {
        const config = readPersistedConfig("proj", { cwd })
        expect(config?.odoo_version).toBe(19)
        const calls = await readCalls(log)
        expect(calls).toHaveLength(1)
        expect(calls[0].args).toEqual(["export", expect.any(String), "--project", "proj"])
        expect(calls[0].cwd).toBe(await fs.realpath(cwd))
      } finally {
        await fs.rm(cwd, { recursive: true, force: true })
      }
    })
  })

  it("falls back to the legacy export when an older Engram rejects --project", async () => {
    const fallbackCli = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
fs.appendFileSync(process.env.ODF_TEST_ENGRAM_LOG, JSON.stringify({ args }) + "\\n")
if (args.includes("--project")) process.exit(17)
fs.writeFileSync(args[1], JSON.stringify({ observations: [{ topic_key: "odf-init/proj", content: process.env.ODF_TEST_ENGRAM_CONFIG }] }))
`
    await withFakeEngram(fallbackCli, async ({ log }) => {
      process.env.ODF_TEST_ENGRAM_CONFIG = YAML.stringify({ project_name: "proj", odoo_version: 18, modules: [] })
      const config = readPersistedConfig("proj", { cwd: os.tmpdir() })
      expect(config?.odoo_version).toBe(18)
      const calls = await readCalls(log)
      expect(calls).toHaveLength(2)
      expect(calls[0].args).toContain("--project")
      expect(calls[1].args).toEqual(["export", expect.any(String)])
    })
  })

  it("persists and verifies odf-init from a cwd outside the repo", async () => {
    await withFakeEngram(FAKE_ENGRAM, async ({ log, store }) => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), "odf-scan-cwd-"))
      try {
        const summary = spawnSync(process.execPath, [SCAN_CLI, "--root", root, "--repo", repo, "--persist", "--format", "summary"], { cwd: outside, env: { ...process.env }, encoding: "utf8" })
        expect(summary.status).toBe(1)
        expect(summary.stdout).toContain("persisted to Engram topic odf-init/myrepo (verified)")
        expect(summary.stdout).toContain('"store":"engram"')
        const stored = JSON.parse(await fs.readFile(store, "utf8")) as Array<Record<string, unknown>>
        expect(stored[0]).toMatchObject({ topic_key: "odf-init/myrepo", project: "myrepo" })

        const json = spawnSync(process.execPath, [SCAN_CLI, "--root", root, "--repo", repo, "--persist", "--format", "json"], { cwd: outside, env: { ...process.env }, encoding: "utf8" })
        const parsed = JSON.parse(json.stdout) as { artifact_ref?: unknown }
        expect(parsed.artifact_ref).toEqual({ store: "engram", ref: "odf-init/myrepo" })

        const calls = await readCalls(log)
        expect(calls.length).toBeGreaterThan(0)
        expect(calls.every(call => call.args.includes("--project"))).toBe(true)
      } finally {
        await fs.rm(outside, { recursive: true, force: true })
      }
    })
  }, 30_000)

  it("empty environment blocks and warns instead of throwing", () => {
    const config = buildConfig(path.join(root, "nowhere"), path.join(root, "nowhere-repo"))
    expect(config.odoo_version).toBeNull()
    expect(config.modules).toEqual([])
    expect(config.warnings.length).toBeGreaterThan(0)
    expect(computeChecksum(["a", "b"])).toMatch(/^[0-9a-f]{64}$/)
  })
})
