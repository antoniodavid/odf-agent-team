import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Writable } from "node:stream"
import {
  InstallerError,
  buildProjectLauncher,
  cleanupStalePaths,
  cleanupStalePluginFiles,
  copyDirSync,
  createBackup,
  createLogger,
  detectExistingInstall,
  looksLikePack,
  parseInstallOptions,
  resolveConfigDir,
  resolveSource,
  rewriteConfigPaths,
  shellQuote,
  writeProjectLauncher,
  writeProjectLock,
} from "./install-core.mjs"

const REPO_ROOT = path.resolve(process.cwd())

function silentLogger() {
  const sink = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  return createLogger({ color: false, stdout: sink as unknown as NodeJS.WritableStream, stderr: sink as unknown as NodeJS.WritableStream })
}

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "odf-install-core-"))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe("parseInstallOptions", () => {
  it("applies defaults", () => {
    const options = parseInstallOptions([])
    expect(options.scope).toBe("global")
    expect(options.host).toBe("opencode")
    expect(options.dryRun).toBe(false)
    expect(options.rawArgs).toEqual([])
  })

  it("parses both --flag value and --flag=value forms", () => {
    const options = parseInstallOptions(["--scope=project", "--project", "/tmp/example", "--yes", "--skip-npm"])
    expect(options.scope).toBe("project")
    expect(options.project).toBe("/tmp/example")
    expect(options.yes).toBe(true)
    expect(options.skipNpm).toBe(true)
  })

  it("rejects missing values and unknown flags", () => {
    expect(() => parseInstallOptions(["--scope"])).toThrow(InstallerError)
    expect(() => parseInstallOptions(["--nope"])).toThrow(/Unknown option: --nope/)
  })

  it("rejects an invalid scope and --project without project scope", () => {
    expect(() => parseInstallOptions(["--scope", "elsewhere"])).toThrow(/Invalid scope/)
    expect(() => parseInstallOptions(["--project", "/tmp/x"])).toThrow(/--project requires --scope project/)
  })

  it("rejects --config-dir together with project scope", () => {
    expect(() => parseInstallOptions(["--scope", "project", "--config-dir", "/tmp/x"])).toThrow(/--config-dir cannot be combined/)
  })
})

describe("resolveConfigDir", () => {
  it("honors ODF_DIR over every other source", () => {
    const env = {
      ODF_DIR: path.join(tempDir, "odf-dir"),
      ODF_CONFIG_DIR: path.join(tempDir, "odf-config"),
      XDG_CONFIG_HOME: path.join(tempDir, "xdg"),
      HOME: tempDir,
    }
    expect(resolveConfigDir({ options: { scope: "global" }, env }).configDir).toBe(env.ODF_DIR)
  })

  it("falls back through ODF_CONFIG_DIR, XDG and HOME", () => {
    const configDir = path.join(tempDir, "config")
    expect(resolveConfigDir({ options: { scope: "global" }, env: { ODF_CONFIG_DIR: configDir, HOME: tempDir } }).configDir).toBe(configDir)

    const xdgDir = path.join(tempDir, "xdg", "opencode")
    expect(resolveConfigDir({ options: { scope: "global" }, env: { XDG_CONFIG_HOME: path.join(tempDir, "xdg"), HOME: tempDir } }).configDir).toBe(xdgDir)

    const homeDir = path.join(tempDir, ".config", "opencode")
    expect(resolveConfigDir({ options: { scope: "global" }, env: { HOME: tempDir } }).configDir).toBe(homeDir)
  })

  it("uses --config-dir when no env override exists", () => {
    const configDir = path.join(tempDir, "cli")
    expect(resolveConfigDir({ options: { scope: "global", configDir }, env: { HOME: tempDir } }).configDir).toBe(configDir)
  })

  it("resolves project scope to <project>/.opencode with .odf metadata", () => {
    const project = fs.mkdtempSync(path.join(tempDir, "proj-"))
    const target = resolveConfigDir({ options: { scope: "project", project }, env: {} })
    expect(target.mode).toBe("project")
    expect(target.configDir).toBe(path.join(fs.realpathSync(project), ".opencode"))
    expect(target.projectMetaDir).toBe(path.join(fs.realpathSync(project), ".odf"))
  })

  it("rejects relative and missing project paths", () => {
    expect(() => resolveConfigDir({ options: { scope: "project", project: "relative" }, env: {}, cwd: tempDir })).toThrow(/absolute directory/)
    expect(() => resolveConfigDir({ options: { scope: "project", project: path.join(tempDir, "missing") }, env: {} })).toThrow(/absolute directory/)
  })

  it("defaults the project root to cwd", () => {
    const project = fs.mkdtempSync(path.join(tempDir, "cwd-proj-"))
    expect(resolveConfigDir({ options: { scope: "project" }, env: {}, cwd: project }).configDir).toBe(path.join(fs.realpathSync(project), ".opencode"))
  })
})

describe("resolveSource", () => {
  it("prefers an explicit --source and reports a missing one", () => {
    expect(resolveSource({ explicitSource: REPO_ROOT }).dir).toBe(REPO_ROOT)
    expect(() => resolveSource({ explicitSource: path.join(tempDir, "missing") })).toThrow(/--source does not exist/)
  })

  it("honors ODF_SOURCE_DIR and reports a missing one", () => {
    expect(resolveSource({ env: { ODF_SOURCE_DIR: REPO_ROOT } }).dir).toBe(REPO_ROOT)
    expect(() => resolveSource({ env: { ODF_SOURCE_DIR: path.join(tempDir, "missing") } })).toThrow(/ODF_SOURCE_DIR does not exist/)
  })

  it("detects a pack in cwd and falls back to the CLI package root", () => {
    expect(resolveSource({ cwd: REPO_ROOT, env: {} }).dir).toBe(REPO_ROOT)
    expect(looksLikePack(REPO_ROOT)).toBe(true)
    expect(resolveSource({ cwd: tempDir, env: {}, sourceRoot: REPO_ROOT }).dir).toBe(REPO_ROOT)
  })

  it("fails with a helpful message when nothing is found", () => {
    expect(() => resolveSource({ cwd: tempDir, env: {} })).toThrow(/ODF source not found/)
  })
})

describe("backup and copy helpers", () => {
  it("createBackup copies registry, pack dirs and project metadata", () => {
    const configDir = path.join(tempDir, "config")
    const projectMetaDir = path.join(tempDir, ".odf")
    fs.mkdirSync(path.join(configDir, "skills", "one"), { recursive: true })
    fs.writeFileSync(path.join(configDir, "odf-registry.json"), "{}")
    fs.writeFileSync(path.join(configDir, "skills", "one", "SKILL.md"), "# skill")
    fs.mkdirSync(projectMetaDir, { recursive: true })
    fs.writeFileSync(path.join(projectMetaDir, "opencode"), "#!/usr/bin/env bash\n")
    fs.writeFileSync(path.join(projectMetaDir, "odf.lock"), "{}")

    const backupDir = createBackup({ configDir, projectMode: true, projectMetaDir, logger: silentLogger() })
    expect(fs.existsSync(path.join(backupDir, "odf-registry.json"))).toBe(true)
    expect(fs.existsSync(path.join(backupDir, "skills", "one", "SKILL.md"))).toBe(true)
    expect(fs.existsSync(path.join(backupDir, "project-meta", "opencode"))).toBe(true)
    expect(fs.existsSync(path.join(backupDir, "project-meta", "odf.lock"))).toBe(true)
  })

  it("createBackup is a no-op on a pristine target and dry-run writes nothing", () => {
    const pristine = path.join(tempDir, "pristine")
    expect(createBackup({ configDir: pristine, logger: silentLogger() })).toBe("")

    const configDir = path.join(tempDir, "config")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, "odf-registry.json"), "{}")
    const planned = createBackup({ configDir, dryRun: true, logger: silentLogger() })
    expect(planned).toContain("install-")
    expect(fs.existsSync(path.join(configDir, "backups"))).toBe(false)
  })

  it("createBackup avoids timestamp collisions", () => {
    const configDir = path.join(tempDir, "config")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, "odf-registry.json"), "{}")
    const now = new Date()
    const first = createBackup({ configDir, logger: silentLogger(), now })
    const second = createBackup({ configDir, logger: silentLogger(), now })
    expect(first).not.toBe(second)
    expect(second).toBe(`${first}-1`)
  })

  it("copyDirSync copies directory contents, files, and skips hidden top-level entries", () => {
    const src = path.join(tempDir, "src")
    const nested = path.join(src, "nested")
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(src, "one.md"), "1")
    fs.writeFileSync(path.join(nested, "two.md"), "2")
    fs.writeFileSync(path.join(nested, ".hidden.md"), "hidden")
    fs.writeFileSync(path.join(src, ".top-hidden.md"), "top")

    const dst = path.join(tempDir, "dst")
    copyDirSync(src, dst, { logger: silentLogger() })
    expect(fs.existsSync(path.join(dst, "one.md"))).toBe(true)
    expect(fs.existsSync(path.join(dst, "nested", "two.md"))).toBe(true)
    expect(fs.existsSync(path.join(dst, "nested", ".hidden.md"))).toBe(true)
    expect(fs.existsSync(path.join(dst, ".top-hidden.md"))).toBe(false)
  })

  it("copyDirSync dry-run only reports", () => {
    const src = path.join(tempDir, "src")
    fs.mkdirSync(src, { recursive: true })
    fs.writeFileSync(path.join(src, "file.md"), "x")
    const dst = path.join(tempDir, "dst")
    copyDirSync(src, dst, { dryRun: true, logger: silentLogger() })
    expect(fs.existsSync(dst)).toBe(false)
  })

  it("removes only known stale plugin files and pack paths", () => {
    const configDir = path.join(tempDir, "config")
    fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true })
    fs.mkdirSync(path.join(configDir, "scripts", "tests"), { recursive: true })
    fs.mkdirSync(path.join(configDir, "scripts", "keep"), { recursive: true })
    fs.writeFileSync(path.join(configDir, "plugins", "odf-delegation.js"), "// stale")
    fs.writeFileSync(path.join(configDir, "plugins", "custom-plugin.ts"), "// keep")
    fs.writeFileSync(path.join(configDir, "scripts", "tests", "old.ts"), "// stale")
    fs.writeFileSync(path.join(configDir, "scripts", "odf-consistency-contracts.test.ts"), "// repo-only")

    cleanupStalePluginFiles({ configDir, logger: silentLogger() })
    cleanupStalePaths({ configDir, logger: silentLogger() })

    expect(fs.existsSync(path.join(configDir, "plugins", "odf-delegation.js"))).toBe(false)
    expect(fs.existsSync(path.join(configDir, "plugins", "custom-plugin.ts"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "scripts", "tests"))).toBe(false)
    expect(fs.existsSync(path.join(configDir, "scripts", "odf-consistency-contracts.test.ts"))).toBe(false)
    expect(fs.existsSync(path.join(configDir, "scripts", "keep"))).toBe(true)
  })

  it("dry-run cleanup keeps every file on disk", () => {
    const configDir = path.join(tempDir, "config")
    fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true })
    fs.mkdirSync(path.join(configDir, "scripts", "tests"), { recursive: true })
    fs.writeFileSync(path.join(configDir, "plugins", "odf-delegation.js"), "// stale")
    cleanupStalePluginFiles({ configDir, dryRun: true, logger: silentLogger() })
    cleanupStalePaths({ configDir, dryRun: true, logger: silentLogger() })
    expect(fs.existsSync(path.join(configDir, "plugins", "odf-delegation.js"))).toBe(true)
    expect(fs.existsSync(path.join(configDir, "scripts", "tests"))).toBe(true)
  })
})

describe("rewriteConfigPaths", () => {
  it("rewrites runtime extensions but skips node_modules, backups and other extensions", () => {
    const configDir = path.join(tempDir, "config")
    const legacy = "/home/adruban/.config/opencode"
    fs.mkdirSync(path.join(configDir, "skills", "s"), { recursive: true })
    fs.mkdirSync(path.join(configDir, "node_modules", "dep"), { recursive: true })
    fs.mkdirSync(path.join(configDir, "backups", "install-1"), { recursive: true })
    fs.mkdirSync(path.join(configDir, "scripts"), { recursive: true })
    fs.writeFileSync(path.join(configDir, "skills", "s", "SKILL.md"), `path ${legacy} here`)
    fs.writeFileSync(path.join(configDir, "node_modules", "dep", "index.js"), legacy)
    fs.writeFileSync(path.join(configDir, "backups", "install-1", "fixture.md"), legacy)
    fs.writeFileSync(path.join(configDir, "scripts", "tool.mjs"), legacy)
    fs.writeFileSync(path.join(configDir, "scripts", "tool.yaml"), legacy)

    const replacement = configDir.split(path.sep).join("/")
    rewriteConfigPaths({ configDir, logger: silentLogger() })

    expect(fs.readFileSync(path.join(configDir, "skills", "s", "SKILL.md"), "utf8")).toBe(`path ${replacement} here`)
    expect(fs.readFileSync(path.join(configDir, "node_modules", "dep", "index.js"), "utf8")).toBe(legacy)
    expect(fs.readFileSync(path.join(configDir, "backups", "install-1", "fixture.md"), "utf8")).toBe(legacy)
    expect(fs.readFileSync(path.join(configDir, "scripts", "tool.mjs"), "utf8")).toBe(legacy)
    expect(fs.readFileSync(path.join(configDir, "scripts", "tool.yaml"), "utf8")).toBe(legacy)
  })

  it("does nothing in dry-run mode", () => {
    const configDir = path.join(tempDir, "config")
    fs.mkdirSync(configDir, { recursive: true })
    const fixture = path.join(configDir, "skill.md")
    fs.writeFileSync(fixture, "/home/adruban/.config/opencode")
    rewriteConfigPaths({ configDir, dryRun: true, logger: silentLogger() })
    expect(fs.readFileSync(fixture, "utf8")).toBe("/home/adruban/.config/opencode")
  })
})

describe("project scope artifacts", () => {
  it("shellQuote leaves simple paths alone and single-quotes the rest", () => {
    expect(shellQuote("/home/user/pack")).toBe("/home/user/pack")
    expect(shellQuote("/home/user/my pack")).toBe("'/home/user/my pack'")
    expect(shellQuote("/home/o'brien")).toBe(`'/home/o'\\''brien'`)
  })

  it("builds a launcher that pins the project pack", () => {
    const launcher = buildProjectLauncher({ projectRoot: "/home/user/project", configDir: "/home/user/project/.opencode" })
    expect(launcher).toContain("PROJECT_ROOT=/home/user/project")
    expect(launcher).toContain("PROJECT_PACK=/home/user/project/.opencode")
    expect(launcher).toContain('export ODF_CONFIG_DIR="$PROJECT_PACK"')
    expect(launcher).toContain('exec opencode "$@"')
    expect(launcher).toContain('${ODF_CONFIG_DIR:-}')
  })

  it("writeProjectLauncher is executable and writeProjectLock matches the lock contract", () => {
    const projectMetaDir = path.join(tempDir, ".odf")
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, "odf-registry.json"), "{\"skills\":[],\"agents\":[]}")

    const launcher = writeProjectLauncher({
      projectRoot: tempDir,
      configDir,
      projectMetaDir,
      logger: silentLogger(),
    })
    expect(fs.statSync(launcher).mode & 0o111).toBeGreaterThan(0)

    const lockPath = writeProjectLock({
      configDir,
      projectMetaDir,
      sourceDir: REPO_ROOT,
      sourceKind: "local",
      version: "1.4.0",
      logger: silentLogger(),
    })
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
    expect(lock).toMatchObject({ format: 1, package: "odf-agent-team", scope: "project", version: "1.4.0", config_dir: configDir })
    expect(lock.source).toBe(`local:${fs.realpathSync(REPO_ROOT)}`)
    expect(lock.checksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it("detectExistingInstall distinguishes a pack from a pristine dir", () => {
    const configDir = path.join(tempDir, "config")
    fs.mkdirSync(configDir, { recursive: true })
    expect(detectExistingInstall(configDir)).toBe("new")
    fs.writeFileSync(path.join(configDir, "odf-registry.json"), "{}")
    expect(detectExistingInstall(configDir)).toBe("existing")
  })
})
