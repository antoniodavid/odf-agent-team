import { describe, it, expect, beforeAll } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { spawnSync } from "node:child_process"

const REPO_ROOT = path.resolve(process.cwd())
const INSTALL_SCRIPT = path.join(REPO_ROOT, "install.sh")

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
      expect(fs.existsSync(path.join(configDir, "scripts", "odf-test-runner.js"))).toBe(true)
      expect(fs.existsSync(path.join(configDir, "command", "odf-new.md"))).toBe(true)
    } finally {
      cleanup(tempHome)
    }
  })

  it("re-run is idempotent and creates a backup", () => {
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
      // First install
      const first = spawnSync("bash", [INSTALL_SCRIPT, "--yes"], { env, encoding: "utf8", cwd: REPO_ROOT })
      expect(first.status).toBe(0)
      expect(fs.existsSync(path.join(configDir, "odf-registry.json"))).toBe(true)

      // Second install
      const second = spawnSync("bash", [INSTALL_SCRIPT, "--yes"], { env, encoding: "utf8", cwd: REPO_ROOT })
      expect(second.status).toBe(0)

      const backupsDir = path.join(configDir, "backups")
      const backups = fs.existsSync(backupsDir)
        ? fs.readdirSync(backupsDir).filter(e => e.startsWith("install-"))
        : []
      expect(backups.length).toBeGreaterThanOrEqual(1)
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
