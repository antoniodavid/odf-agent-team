import { describe, it, expect, beforeAll } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { spawnSync } from "node:child_process"

const REPO_ROOT = path.resolve(process.cwd())
const INSTALL_SCRIPT = path.join(REPO_ROOT, "install.sh")
const STALE_ODF_PLUGIN_FILES = [
  "candidate-manifest.test.ts",
  "candidate-manifest.ts",
  "entry-triage.test.ts",
  "entry-triage.ts",
  "odf-delegation.test.ts",
  "odf-expectations.test.ts",
  "odf-expectations.ts",
  "odf-parallel-join.ts",
  "odf-workflow-status.test.ts",
  "odf-workflow-status.ts",
  "odf-workflow.test.ts",
  "odf-workflow.ts",
]

function runInstaller(args: string[], envOverrides: Record<string, string> = {}) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "odf-installer-unit-"))
  const env = {
    ...process.env,
    HOME: tempHome,
    ODF_CONFIG_DIR: path.join(tempHome, ".config", "opencode"),
    ODF_SOURCE_DIR: REPO_ROOT,
    ODF_SKIP_NPM: "1",
    ODF_SKIP_SELFTEST: "1",
    ...envOverrides,
  } as NodeJS.ProcessEnv

  const result = spawnSync("bash", [INSTALL_SCRIPT, ...args], {
    env,
    encoding: "utf8",
    cwd: REPO_ROOT,
  })

  return { result, tempHome }
}

function cleanup(tempHome: string) {
  fs.rmSync(tempHome, { recursive: true, force: true })
}

describe("install.sh", { timeout: 30000 }, () => {
  beforeAll(() => {
    expect(fs.existsSync(INSTALL_SCRIPT)).toBe(true)
  })

  it("dry-run exits 0 and prints a plan", () => {
    const { result, tempHome } = runInstaller(["--dry-run"])
    try {
      expect(result.status).toBe(0)
      const output = `${result.stdout}\n${result.stderr}`
      expect(output).toContain("Dry-run complete")
      expect(output).toContain("Target directory:")
      expect(output).toContain("Would install ODF files")
      expect(output).toContain("Plugin entrypoint:")
      expect(output).toContain("Plugin support:")
      expect(output).toContain("Cleanup:")
      expect(fs.existsSync(path.join(tempHome, ".config"))).toBe(false)
    } finally {
      cleanup(tempHome)
    }
  })

  it("non-interactive install copies ODF files to the target directory", () => {
    const { result, tempHome } = runInstaller(["--yes"])
    try {
      expect(result.status).toBe(0)
      const configDir = path.join(tempHome, ".config", "opencode")
      expect(fs.existsSync(path.join(configDir, "odf-registry.json"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "plugins", "odf-delegation.ts"))).toBe(true)
      expect(fs.readdirSync(path.join(configDir, "plugins"))).toEqual(["odf-delegation.ts"])
      expect(fs.existsSync(path.join(configDir, "odf-plugin", "odf-workflow.ts"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "odf-plugin", "odf-delegation.test.ts"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "odf-plugin", "plugin-entrypoint.test.ts"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "scripts", "odf-test-runner.js"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "command", "odf-new.md"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "command", "odf-health.md"))).toBe(true)
    } finally {
      cleanup(tempHome)
    }
  })

  it("migrates the old plugin layout without touching foreign plugins and remains idempotent", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "odf-installer-idem-"))
    const configDir = path.join(tempHome, ".config", "opencode")
    const env = {
      ...process.env,
      HOME: tempHome,
      ODF_CONFIG_DIR: configDir,
      ODF_SOURCE_DIR: REPO_ROOT,
      ODF_SKIP_NPM: "1",
      ODF_SKIP_SELFTEST: "1",
    } as NodeJS.ProcessEnv

    try {
      const pluginsDir = path.join(configDir, "plugins")
      fs.mkdirSync(pluginsDir, { recursive: true })
      fs.writeFileSync(path.join(pluginsDir, "custom-plugin.ts"), "export default async () => ({})\n", "utf8")
      for (const name of STALE_ODF_PLUGIN_FILES) {
        fs.writeFileSync(path.join(pluginsDir, name), `// stale ${name}\n`, "utf8")
      }

      // First install
      const first = spawnSync("bash", [INSTALL_SCRIPT, "--yes"], { env, encoding: "utf8", cwd: REPO_ROOT })
      expect(first.status).toBe(0)
      expect(fs.existsSync(path.join(configDir, "odf-registry.json"))).toBe(true)
      expect(fs.readFileSync(path.join(pluginsDir, "custom-plugin.ts"), "utf8")).toBe("export default async () => ({})\n")
      expect(fs.readdirSync(pluginsDir).sort()).toEqual(["custom-plugin.ts", "odf-delegation.ts"])
      for (const name of STALE_ODF_PLUGIN_FILES) {
        expect(fs.existsSync(path.join(pluginsDir, name))).toBe(false)
      }

      const firstEntrypoint = fs.readFileSync(path.join(pluginsDir, "odf-delegation.ts"), "utf8")
      const firstSupportFiles = fs.readdirSync(path.join(configDir, "odf-plugin")).sort()

      // Second install
      const second = spawnSync("bash", [INSTALL_SCRIPT, "--yes"], { env, encoding: "utf8", cwd: REPO_ROOT })
      expect(second.status).toBe(0)
      expect(fs.readFileSync(path.join(pluginsDir, "custom-plugin.ts"), "utf8")).toBe("export default async () => ({})\n")
      expect(fs.readFileSync(path.join(pluginsDir, "odf-delegation.ts"), "utf8")).toBe(firstEntrypoint)
      expect(fs.readdirSync(path.join(configDir, "odf-plugin")).sort()).toEqual(firstSupportFiles)
      expect(fs.readdirSync(pluginsDir).sort()).toEqual(["custom-plugin.ts", "odf-delegation.ts"])

      const backupsDir = path.join(configDir, "backups")
      const backups = fs.existsSync(backupsDir)
        ? fs.readdirSync(backupsDir).filter(e => e.startsWith("install-"))
        : []
      expect(backups.length).toBeGreaterThanOrEqual(1)
    } finally {
      cleanup(tempHome)
    }
  })

  it("installs an entrypoint whose relative imports resolve", () => {
    const { result, tempHome } = runInstaller(["--yes"])
    try {
      expect(result.status).toBe(0)
      const entrypoint = path.join(tempHome, ".config", "opencode", "plugins", "odf-delegation.ts")
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
    } finally {
      cleanup(tempHome)
    }
  })

  it("respects ODF_CONFIG_DIR override", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "odf-installer-odfcfg-"))
    const customConfig = path.join(tempHome, "custom-odf")
    const { result } = runInstaller(["--dry-run"], {
      ODF_CONFIG_DIR: customConfig,
      ODF_SKIP_NPM: "1",
      ODF_SKIP_SELFTEST: "1",
    })
    cleanup(tempHome)

    expect(result.status).toBe(0)
    const output = `${result.stdout}\n${result.stderr}`
    expect(output).toContain(customConfig)
  })
})
