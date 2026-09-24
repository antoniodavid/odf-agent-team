import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const REPO_ROOT = path.resolve(process.cwd())

type TuiModule = typeof import("../odf-install-tui.mjs")

const FULL_COMPONENTS = [
  "registry", "agents", "skills", "commands", "plugins", "scripts", "policies", "docs", "openspec",
]

describe("odf-install-tui install parity", () => {
  let configDir: string
  let previousConfigDir: string | undefined
  let previousOdfDir: string | undefined

  async function loadTui(): Promise<TuiModule> {
    process.env.ODF_CONFIG_DIR = configDir
    delete process.env.ODF_DIR
    vi.resetModules()
    return await import("../odf-install-tui.mjs")
  }

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "odf-tui-install-"))
    previousConfigDir = process.env.ODF_CONFIG_DIR
    previousOdfDir = process.env.ODF_DIR
    vi.spyOn(console, "log").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (previousConfigDir === undefined) delete process.env.ODF_CONFIG_DIR
    else process.env.ODF_CONFIG_DIR = previousConfigDir
    if (previousOdfDir === undefined) delete process.env.ODF_DIR
    else process.env.ODF_DIR = previousOdfDir
    fs.rmSync(configDir, { recursive: true, force: true })
  })

  it("copies the plugin support modules, policies, and package manifest", async () => {
    const tui = await loadTui()
    tui.installFiles(REPO_ROOT, FULL_COMPONENTS)

    expect(fs.existsSync(path.join(configDir, "odf-plugin", "odf-delegation-shared.ts"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "odf-plugin", "runtime-boundary.ts"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "odf-plugin", "opencode-v2-adapter.ts"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "policies", "oca-ai-policy.md"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "policies", "oca", "rules.yaml"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "package.json"))).toBe(true)
  })

  it("installs an entrypoint whose relative imports resolve", async () => {
    const tui = await loadTui()
    tui.installFiles(REPO_ROOT, FULL_COMPONENTS)

    const entrypoint = path.join(configDir, "plugins", "odf-delegation.ts")
    const source = fs.readFileSync(entrypoint, "utf8")
    const imports = [...source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].map(match => match[1])

    expect(imports.length).toBeGreaterThan(0)
    for (const specifier of imports) {
      const resolved = path.resolve(path.dirname(entrypoint), specifier)
      const sourcePath = fs.existsSync(resolved)
        ? resolved
        : resolved.endsWith(".js") ? `${resolved.slice(0, -3)}.ts` : resolved
      expect(fs.existsSync(sourcePath), `${specifier} should resolve to ${sourcePath}`).toBe(true)
    }
  })

  it("cleans every stale ODF plugin file and keeps foreign plugins", async () => {
    const tui = await loadTui()
    const pluginsDir = path.join(configDir, "plugins")
    fs.mkdirSync(pluginsDir, { recursive: true })
    fs.writeFileSync(path.join(pluginsDir, "custom-plugin.ts"), "export default async () => ({})\n", "utf8")
    for (const name of tui.STALE_ODF_PLUGIN_FILES) {
      fs.writeFileSync(path.join(pluginsDir, name), `// stale ${name}\n`, "utf8")
    }

    tui.cleanupStalePluginFiles()

    for (const name of tui.STALE_ODF_PLUGIN_FILES) {
      expect(fs.existsSync(path.join(pluginsDir, name)), name).toBe(false)
    }
    expect(fs.readFileSync(path.join(pluginsDir, "custom-plugin.ts"), "utf8")).toBe("export default async () => ({})\n")
  })
})
