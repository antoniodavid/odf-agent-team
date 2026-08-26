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

function runProjectInstaller(args: string[], envOverrides: Record<string, string> = {}) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "odf-project-installer-home-"))
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "odf-project-installer-project-"))
  const env = {
    ...process.env,
    HOME: tempHome,
    XDG_CONFIG_HOME: path.join(tempHome, ".config"),
    ODF_CONFIG_DIR: path.join(tempHome, ".config", "opencode"),
    ODF_SOURCE_DIR: REPO_ROOT,
    ODF_SKIP_NPM: "1",
    ODF_SKIP_SELFTEST: "1",
    ...envOverrides,
  } as NodeJS.ProcessEnv

  const installerArgs = args.map(arg => arg === "__PROJECT__" ? projectDir : arg)
  const result = spawnSync("bash", [INSTALL_SCRIPT, ...installerArgs], {
    env,
    encoding: "utf8",
    cwd: REPO_ROOT,
  })

  return { result, tempHome, projectDir, env }
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

  it("does not rewrite dependency or historical backup files", () => {
    const { result, tempHome } = runInstaller(["--yes"])
    try {
      expect(result.status).toBe(0)
      const configDir = path.join(tempHome, ".config", "opencode")
      const oldPath = "/home/adruban/.config/opencode"
      const backupFixture = path.join(configDir, "backups", "fixture.md")
      const dependencyFixture = path.join(configDir, "node_modules", "fixture.js")
      fs.mkdirSync(path.dirname(backupFixture), { recursive: true })
      fs.mkdirSync(path.dirname(dependencyFixture), { recursive: true })
      fs.writeFileSync(backupFixture, oldPath, "utf8")
      fs.writeFileSync(dependencyFixture, oldPath, "utf8")

      const second = spawnSync("bash", [INSTALL_SCRIPT, "--yes"], {
        env: {
          ...process.env,
          HOME: tempHome,
          ODF_CONFIG_DIR: configDir,
          ODF_SOURCE_DIR: REPO_ROOT,
          ODF_SKIP_NPM: "1",
          ODF_SKIP_SELFTEST: "1",
        },
        encoding: "utf8",
        cwd: REPO_ROOT,
      })
      expect(second.status).toBe(0)
      expect(fs.readFileSync(backupFixture, "utf8")).toBe(oldPath)
      expect(fs.readFileSync(dependencyFixture, "utf8")).toBe(oldPath)
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

  it("installs a project-local layout with a launcher and lock metadata", () => {
    const { result, tempHome, projectDir } = runProjectInstaller([
      "--scope", "project", "--project", "__PROJECT__", "--yes",
    ])
    try {
      expect(result.status).toBe(0)
      const configDir = path.join(projectDir, ".opencode")
      const launcher = path.join(projectDir, ".odf", "opencode")
      const lockPath = path.join(projectDir, ".odf", "odf.lock")
      expect(fs.existsSync(path.join(configDir, "odf-registry.json"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "plugins", "odf-delegation.ts"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "agent"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "skills"))).toBe(true)
      expect(fs.existsSync(launcher)).toBe(true)
      expect(fs.statSync(launcher).mode & 0o111).toBeGreaterThan(0)
      expect(fs.existsSync(lockPath)).toBe(true)

      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
      expect(lock.version).toBe("1.2.1")
      expect(lock.source).toContain(`local:${REPO_ROOT}`)
      expect(lock.checksum).toMatch(/^[a-f0-9]{64}$/)
      expect(lock.config_dir).toBe(configDir)
    } finally {
      cleanup(tempHome)
      cleanup(projectDir)
    }
  })

  it("launcher exports the absolute project ODF_CONFIG_DIR", () => {
    const { result, tempHome, projectDir, env } = runProjectInstaller([
      "--scope", "project", "--project", "__PROJECT__", "--yes",
    ])
    try {
      expect(result.status).toBe(0)
      const binDir = path.join(tempHome, "bin")
      const capturePath = path.join(tempHome, "odf-config-dir.txt")
      const fakeOpenCode = path.join(binDir, "opencode")
      const elsewhere = path.join(tempHome, "elsewhere")
      fs.mkdirSync(binDir, { recursive: true })
      fs.mkdirSync(elsewhere, { recursive: true })
      fs.writeFileSync(fakeOpenCode, "#!/usr/bin/env bash\nprintf '%s' \"$ODF_CONFIG_DIR\" > \"$ODF_CAPTURE\"\n", "utf8")
      fs.chmodSync(fakeOpenCode, 0o755)

      const launch = spawnSync(path.join(projectDir, ".odf", "opencode"), [], {
        env: {
          ...env,
          PATH: `${binDir}:${process.env.PATH || ""}`,
          ODF_CAPTURE: capturePath,
          XDG_CONFIG_HOME: path.join(tempHome, ".config"),
        },
        encoding: "utf8",
        cwd: elsewhere,
      })
      expect(launch.status).toBe(0)
      expect(fs.readFileSync(capturePath, "utf8")).toBe(path.join(projectDir, ".opencode"))
    } finally {
      cleanup(tempHome)
      cleanup(projectDir)
    }
  })

  it("backs up project ODF files before an idempotent overwrite", () => {
    const first = runProjectInstaller([
      "--scope", "project", "--project", "__PROJECT__", "--yes",
    ])
    try {
      expect(first.result.status).toBe(0)
      const second = spawnSync("bash", [INSTALL_SCRIPT, "--scope", "project", "--project", first.projectDir, "--yes"], {
        env: first.env,
        encoding: "utf8",
        cwd: REPO_ROOT,
      })
      expect(second.status).toBe(0)

      const backupsDir = path.join(first.projectDir, ".opencode", "backups")
      const backups = fs.readdirSync(backupsDir).filter(entry => entry.startsWith("install-"))
      expect(backups.length).toBeGreaterThanOrEqual(1)
      const latestBackup = path.join(backupsDir, backups[backups.length - 1])
      expect(fs.existsSync(path.join(latestBackup, "odf-registry.json"))).toBe(true)
      expect(fs.existsSync(path.join(latestBackup, "project-meta", "opencode"))).toBe(true)
      expect(fs.existsSync(path.join(latestBackup, "project-meta", "odf.lock"))).toBe(true)
    } finally {
      cleanup(first.tempHome)
      cleanup(first.projectDir)
    }
  })

  it("project dry-run writes nothing", () => {
    const { result, tempHome, projectDir } = runProjectInstaller([
      "--scope", "project", "--project", "__PROJECT__", "--dry-run",
    ])
    try {
      expect(result.status).toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain("Would write launcher")
      expect(fs.existsSync(path.join(projectDir, ".opencode"))).toBe(false)
      expect(fs.existsSync(path.join(projectDir, ".odf"))).toBe(false)
    } finally {
      cleanup(tempHome)
      cleanup(projectDir)
    }
  })

  it("rejects invalid project paths", () => {
    const { result: relative, tempHome: relativeHome } = runInstaller([
      "--scope", "project", "--project", "relative-project", "--dry-run",
    ])
    try {
      expect(relative.status).not.toBe(0)
      expect(`${relative.stdout}\n${relative.stderr}`).toContain("absolute directory")
    } finally {
      cleanup(relativeHome)
    }

    const { result: missing, tempHome: missingHome } = runInstaller([
      "--scope", "project", "--project", path.join(os.tmpdir(), "odf-project-does-not-exist"), "--dry-run",
    ])
    try {
      expect(missing.status).not.toBe(0)
      expect(`${missing.stdout}\n${missing.stderr}`).toContain("absolute directory")
    } finally {
      cleanup(missingHome)
    }
  })

  it("refuses to launch when a global ODF plugin conflicts", () => {
    const installed = runProjectInstaller([
      "--scope", "project", "--project", "__PROJECT__", "--yes",
    ])
    try {
      expect(installed.result.status).toBe(0)
      const globalPlugin = path.join(installed.tempHome, ".config", "opencode", "plugins", "odf-delegation.ts")
      fs.mkdirSync(path.dirname(globalPlugin), { recursive: true })
      fs.writeFileSync(globalPlugin, "export default async () => ({})\n", "utf8")

      const launch = spawnSync(path.join(installed.projectDir, ".odf", "opencode"), [], {
        env: {
          ...installed.env,
          XDG_CONFIG_HOME: path.join(installed.tempHome, ".config"),
        },
        encoding: "utf8",
        cwd: installed.projectDir,
      })
      const output = `${launch.stdout}\n${launch.stderr}`
      expect(launch.status).not.toBe(0)
      expect(output).toContain("conflicting global ODF plugin/config")
      expect(output).toContain("Remediation:")
      expect(output).toContain(path.join(installed.projectDir, ".odf", "opencode"))
    } finally {
      cleanup(installed.tempHome)
      cleanup(installed.projectDir)
    }
  })
})
