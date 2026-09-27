import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const REPO_ROOT = path.resolve(process.cwd())
const CLI = path.join(REPO_ROOT, "bin", "odf.mjs")

function runCli(args: string[], envOverrides: Record<string, string> = {}) {
  const env: Record<string, string> = { ...process.env as Record<string, string>, NO_COLOR: "1", ...envOverrides }
  // Never let the caller's installed config leak into these assertions.
  delete env.ODF_DIR
  delete env.ODF_CONFIG_DIR
  for (const [key, value] of Object.entries(envOverrides)) env[key] = value
  return spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", cwd: REPO_ROOT })
}

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "odf-cli-"))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe("odf CLI basics", { timeout: 60000 }, () => {
  it("prints the package version", () => {
    const result = runCli(["--version"])
    expect(result.status).toBe(0)
    const packageVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version
    expect(result.stdout.trim()).toBe(packageVersion)
  })

  it("prints install help", () => {
    const result = runCli(["install", "--help"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Usage: odf install")
    expect(result.stdout).toContain("--config-dir")
  })

  it("fails closed on unknown commands and flags", () => {
    const unknownCommand = runCli(["frobnicate"])
    expect(unknownCommand.status).toBe(1)
    expect(unknownCommand.stderr).toContain("Unknown command: frobnicate")

    const unknownFlag = runCli(["install", "--nope"])
    expect(unknownFlag.status).toBe(1)
    expect(unknownFlag.stderr).toContain("Unknown option: --nope")

    const badScope = runCli(["install", "--scope", "elsewhere"])
    expect(badScope.status).toBe(1)
    expect(badScope.stderr).toContain("Invalid scope: elsewhere")

    const unsupportedHost = runCli(["install", "--host", "pi"])
    expect(unsupportedHost.status).toBe(1)
    expect(unsupportedHost.stderr).toContain("Unsupported host: pi")
  })
})

describe("odf install", { timeout: 60000 }, () => {
  it("dry-run plans the install and writes nothing", () => {
    const configDir = path.join(tempDir, ".config", "opencode")
    const result = runCli(["install", "--dry-run", "--source", REPO_ROOT, "--config-dir", configDir])
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(0)
    expect(output).toContain("Dry-run complete")
    expect(output).toContain("Would install ODF files")
    expect(output).toContain("Plugin entrypoint:")
    expect(output).toContain("Plugin support:")
    expect(output).toContain("Cleanup:")
    expect(output).toContain("Would run self-test")
    expect(fs.existsSync(configDir)).toBe(false)
    expect(fs.existsSync(path.join(tempDir, ".config"))).toBe(false)
  })

  it("installs the OpenCode layout and rewrites author paths", () => {
    const configDir = path.join(tempDir, ".config", "opencode")
    const result = runCli([
      "install", "--yes", "--source", REPO_ROOT, "--config-dir", configDir, "--skip-npm", "--skip-selftest",
    ])
    expect(result.status).toBe(0)

    expect(fs.existsSync(path.join(configDir, "odf-registry.json"))).toBe(true)
    expect(fs.readdirSync(path.join(configDir, "plugins"))).toEqual(["odf-delegation.ts"])
    expect(fs.existsSync(path.join(configDir, "odf-plugin", "runtime-boundary.ts"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "agents", "odoo_orchestrator.md"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "agent", "odoo_orchestrator.md"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "command", "odf-new.md"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "commands", "odf-new.md"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "skills", "odf-init", "SKILL.md"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "scripts", "odf-test-runner.js"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "bin", "odf.mjs"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "install.ps1"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "tsconfig.json"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "scripts", "tests"))).toBe(false)
    expect(fs.existsSync(path.join(configDir, "scripts", "odf-consistency-contracts.test.ts"))).toBe(false)

    const skill = fs.readFileSync(path.join(configDir, "skills", "odf-init", "SKILL.md"), "utf8")
    expect(skill).not.toContain("/home/adruban/.config/opencode")
    expect(`${result.stdout}\n${result.stderr}`).toContain("ODF Agent Team v")
    expect(`${result.stdout}\n${result.stderr}`).toContain("— installed")
  })

  it("is idempotent and creates a backup on re-install", () => {
    const configDir = path.join(tempDir, ".config", "opencode")
    const args = ["install", "--yes", "--source", REPO_ROOT, "--config-dir", configDir, "--skip-npm", "--skip-selftest"]
    expect(runCli(args).status).toBe(0)
    const firstEntrypoint = fs.readFileSync(path.join(configDir, "plugins", "odf-delegation.ts"), "utf8")

    expect(runCli(args).status).toBe(0)
    expect(fs.readFileSync(path.join(configDir, "plugins", "odf-delegation.ts"), "utf8")).toBe(firstEntrypoint)

    const backups = fs.readdirSync(path.join(configDir, "backups")).filter((entry) => entry.startsWith("install-"))
    expect(backups.length).toBeGreaterThanOrEqual(1)
  })

  it("installs a project-local pack with launcher and lock", () => {
    const projectDir = fs.mkdtempSync(path.join(tempDir, "project-"))
    const result = runCli([
      "install", "--yes", "--source", REPO_ROOT, "--scope", "project", "--project", projectDir, "--skip-npm", "--skip-selftest",
    ])
    expect(result.status).toBe(0)

    const configDir = path.join(projectDir, ".opencode")
    const launcher = path.join(projectDir, ".odf", "opencode")
    const lockPath = path.join(projectDir, ".odf", "odf.lock")
    expect(fs.existsSync(path.join(configDir, "odf-registry.json"))).toBe(true)
    expect(fs.existsSync(launcher)).toBe(true)
    expect(fs.statSync(launcher).mode & 0o111).toBeGreaterThan(0)
    expect(fs.existsSync(lockPath)).toBe(true)
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
    expect(lock.config_dir).toBe(configDir)
    expect(lock.source).toContain("local:")
  })

  it("rejects relative project paths", () => {
    const result = runCli(["install", "--dry-run", "--source", REPO_ROOT, "--scope", "project", "--project", "relative-project"])
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain("absolute directory")
  })
})

describe("odf doctor", { timeout: 60000 }, () => {
  it("reports the config dir and install state", () => {
    const configDir = path.join(tempDir, ".config", "opencode")
    const result = runCli(["doctor", "--config-dir", configDir])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("ODF doctor")
    expect(result.stdout).toContain(configDir)
    expect(result.stdout).toContain("Installed:     no")

    expect(runCli(["install", "--yes", "--source", REPO_ROOT, "--config-dir", configDir, "--skip-npm", "--skip-selftest"]).status).toBe(0)
    const installed = runCli(["doctor", "--config-dir", configDir])
    expect(installed.stdout).toContain("Installed:     yes")
    expect(installed.stdout).toContain("Skills:")
  })
})
