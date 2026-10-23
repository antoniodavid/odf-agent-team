import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

const repo = "/home/adruban/Workspace/Personal/odf-agent-team"

describe("registry shape validation", () => {
  let configDir: string
  let originalConfig: string | undefined

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), "odf-registry-shape-"))
    await fs.copyFile(path.join(repo, "odf-registry.json"), path.join(configDir, "odf-registry.json"))
    originalConfig = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = configDir
    vi.resetModules()
  })

  afterEach(async () => {
    if (originalConfig === undefined) delete process.env.ODF_CONFIG_DIR
    else process.env.ODF_CONFIG_DIR = originalConfig
    vi.resetModules()
    await fs.rm(configDir, { recursive: true, force: true })
  })

  async function load() {
    const { loadRegistry } = await import(path.join(repo, "odf-plugin/odf-registry-io.js"))
    return loadRegistry()
  }

  it("loads the valid registry", async () => {
    const registry = await load()
    expect(registry?.skills.length).toBeGreaterThan(0)
    expect(registry?.agents.length).toBeGreaterThan(0)
  })

  it("fails closed when profiles is not an array", async () => {
    const registry = JSON.parse(await fs.readFile(path.join(configDir, "odf-registry.json"), "utf8"))
    registry.profiles = {}
    await fs.writeFile(path.join(configDir, "odf-registry.json"), JSON.stringify(registry), "utf8")
    vi.resetModules()
    expect(await load()).toBeNull()
  })

  it("fails closed when skills is not an array", async () => {
    const registry = JSON.parse(await fs.readFile(path.join(configDir, "odf-registry.json"), "utf8"))
    registry.skills = {}
    await fs.writeFile(path.join(configDir, "odf-registry.json"), JSON.stringify(registry), "utf8")
    vi.resetModules()
    expect(await load()).toBeNull()
  })

  it("fails closed when community_tools is not an array", async () => {
    const registry = JSON.parse(await fs.readFile(path.join(configDir, "odf-registry.json"), "utf8"))
    registry.community_tools = {}
    await fs.writeFile(path.join(configDir, "odf-registry.json"), JSON.stringify(registry), "utf8")
    vi.resetModules()
    expect(await load()).toBeNull()
  })
})
