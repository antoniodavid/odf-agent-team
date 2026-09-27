/**
 * ODF installer core — portable Node implementation of the installer.
 *
 * `install.sh` (Unix bootstrap), `install.ps1` (Windows bootstrap) and the
 * `odf` CLI (bin/odf.mjs) all delegate here. Every filesystem operation uses
 * node:fs / node:path / node:os so the installer behaves identically on Linux,
 * macOS and Windows; no GNU-only tooling (no `sed -i`, no `printf %q`, no
 * `cp -r`).
 *
 * The public surface is intentionally data-oriented so `scripts/lib/*.test.ts`
 * can exercise each step against temp directories without spawning a shell.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export const PACKAGE_NAME = "odf-agent-team"
export const DEFAULT_REPO = "https://github.com/antoniodavid/odf-agent-team"
export const DEFAULT_BRANCH = "main"
export const FALLBACK_VERSION = "1.4.0"

/**
 * The path the pack author's files carry. Installed copies rewrite it to the
 * environment's real config dir (same contract as the historical bash
 * installer).
 */
export const LEGACY_AUTHOR_CONFIG_DIR = "/home/adruban/.config/opencode"

/** Plugin helpers older pack versions installed; they must disappear on update. */
export const STALE_ODF_PLUGIN_FILES = [
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
  "odf-delegation.js",
  "odf-delegation-v2.ts",
  "odf-delegation-v2.js",
  "opencode-v2-entrypoint.ts",
  "opencode-v2-entrypoint.js",
]

/** Paths older pack versions installed; `scripts/tests` fails on current suites. */
export const STALE_ODF_PATHS = ["scripts/tests"]

/** Repo-only files that cannot run from an installed pack. */
export const REPO_ONLY_ODF_PATHS = ["scripts/odf-consistency-contracts.test.ts"]

const PRUNE_DIRS = new Set(["backups", "node_modules", ".git", ".hg", ".svn", ".cache", "coverage", "dist", "tmp", "logs"])
const REWRITE_EXTENSIONS = new Set([".md", ".ts", ".json", ".js"])
const SCAFFOLD_DIRS = ["agent", "agents", "skills", "plugins", "odf-plugin", "command", "commands", "scripts", "policies", "docs", "backups", "bin"]
const BACKUP_DIRS = ["agent", "agents", "skills", "plugins", "odf-plugin", "command", "commands", "scripts", "policies"]
const ENV_PROBE_TOOLS = ["engram", "codegraph", "git", "node", "docker", "python3"]

/** Error whose message is user-facing (printed without a stack trace). */
export class InstallerError extends Error {}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const ANSI = { red: "0;31", green: "0;32", yellow: "1;33", blue: "0;34", cyan: "0;36" }

function paint(code, text, color) {
  return color ? `\u001b[${code}m${text}\u001b[0m` : text
}

/**
 * Logger with the same shapes the bash installer used (warn goes to stdout,
 * error to stderr). `NO_COLOR` disables ANSI codes.
 */
export function createLogger({ color = !process.env.NO_COLOR, stdout = process.stdout, stderr = process.stderr } = {}) {
  const emit = (stream, code, text) => stream.write(`${paint(code, text, color)}\n`)
  return {
    info: (text) => emit(stdout, ANSI.blue, text),
    ok: (text) => emit(stdout, ANSI.green, text),
    warn: (text) => emit(stdout, ANSI.yellow, text),
    error: (text) => emit(stderr, ANSI.red, text),
    plain: (text) => stdout.write(`${text}\n`),
  }
}

// ---------------------------------------------------------------------------
// Small portable helpers
// ---------------------------------------------------------------------------

export function isFile(target) {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

export function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

/** Locate an executable on PATH (honors PATHEXT on Windows). */
export function commandExists(command, env = process.env) {
  const pathValue = env.PATH || env.Path || ""
  const dirs = pathValue.split(path.delimiter).filter(Boolean)
  const extensions = process.platform === "win32" ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";") : [""]
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        // keep looking
      }
    }
  }
  return ""
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, { encoding: "utf8", ...options, shell: false })
}

/** Run a host CLI (npm, opencode). Uses a shell only on Windows for .cmd shims. */
function runHostCli(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options, shell: process.platform === "win32" })
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

export function readPackVersion(packRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(packRoot, "package.json"), "utf8"))
    if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version
  } catch {
    // fall through to the constant
  }
  return FALLBACK_VERSION
}

/** POSIX single-quote quoting, safe for bash launchers on every platform. */
export function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0")
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

export const INSTALL_USAGE = `ODF Agent Team installer

Usage: odf install [flags]
       odf doctor

Modes:
  (no flags)             Interactive install with prompts
  --yes                  Non-interactive install (auto-confirm)
  --dry-run              Show what would be done without modifying anything
  --force                Skip confirmation, overwrite without prompting
  --update               Update an existing installation (backup + reinstall)
  --tui, --interactive   Launch the Node.js TUI installer
  --scope project        Install into <project>/.opencode with a project launcher
  --project PATH         Project root (absolute existing directory; defaults to cwd)

Options:
  --source DIR           Use a local pack directory instead of the packaged copy
  --config-dir DIR       Install into DIR (overrides ODF_DIR/ODF_CONFIG_DIR/XDG)
  --host opencode        Target host (opencode is the only supported host today)
  --with-codegraph       Install the CodeGraph community tool after ODF files
  --configure-mcp        Merge known-good MCP servers into opencode.json (backup first)
  --restart-service      Restart the OpenCode service after install (otherwise warn)
  --skip-npm             Skip npm install (same as ODF_SKIP_NPM=1)
  --skip-selftest        Skip the self-test (same as ODF_SKIP_SELFTEST=1)
  -h, --help             Show this help

Environment:
  ODF_DIR, ODF_CONFIG_DIR     Config directory (default: $XDG_CONFIG_HOME/opencode or ~/.config/opencode)
  ODF_SOURCE_DIR              Local pack source for offline install
  ODF_SKIP_NPM=1              Skip npm install
  ODF_SKIP_SELFTEST=1         Skip self-test after install
  ODF_INSTALL_NONINTERACTIVE=1 Auto-confirm (same as --yes)
  ODF_RESTART_SERVICE=1       Restart the OpenCode service after install
  REPO, BRANCH                Pack repository and branch (default: odf-agent-team main)
`

const VALUE_FLAGS = new Set(["--scope", "--project", "--source", "--config-dir", "--host"])

/**
 * Parse `odf install` arguments. Unknown flags throw, matching the historical
 * installer's fail-closed behavior. Returns plain data plus `rawArgs` so the
 * TUI delegation can forward the original invocation.
 */
export function parseInstallOptions(argv) {
  const options = {
    yes: false,
    dryRun: false,
    force: false,
    update: false,
    tui: false,
    scope: "global",
    project: "",
    source: "",
    configDir: "",
    host: "opencode",
    withCodegraph: false,
    configureMcp: false,
    restartService: false,
    skipNpm: false,
    skipSelftest: false,
    help: false,
    version: false,
    rawArgs: [...argv],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const nextValue = () => {
      index += 1
      if (index >= argv.length) throw new InstallerError(`Missing value for ${arg}`)
      return argv[index]
    }
    if (arg === "--yes") options.yes = true
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--force") options.force = true
    else if (arg === "--update") options.update = true
    else if (arg === "--tui" || arg === "--interactive") options.tui = true
    else if (arg === "--with-codegraph") options.withCodegraph = true
    else if (arg === "--configure-mcp") options.configureMcp = true
    else if (arg === "--restart-service") options.restartService = true
    else if (arg === "--skip-npm") options.skipNpm = true
    else if (arg === "--skip-selftest") options.skipSelftest = true
    else if (arg === "-h" || arg === "--help") options.help = true
    else if (arg === "--version") options.version = true
    else if (arg === "--scope" || arg.startsWith("--scope=")) options.scope = arg.startsWith("--scope=") ? arg.slice(8) : nextValue()
    else if (arg === "--project" || arg.startsWith("--project=")) options.project = arg.startsWith("--project=") ? arg.slice(10) : nextValue()
    else if (arg === "--source" || arg.startsWith("--source=")) options.source = arg.startsWith("--source=") ? arg.slice(9) : nextValue()
    else if (arg === "--config-dir" || arg.startsWith("--config-dir=")) options.configDir = arg.startsWith("--config-dir=") ? arg.slice(13) : nextValue()
    else if (arg === "--host" || arg.startsWith("--host=")) options.host = arg.startsWith("--host=") ? arg.slice(7) : nextValue()
    else throw new InstallerError(`Unknown option: ${arg}\nRun 'odf install --help' for usage.`)
  }

  if (options.scope !== "global" && options.scope !== "project") {
    throw new InstallerError(`Invalid scope: ${options.scope} (expected global or project)`)
  }
  if (options.scope === "global" && options.project) {
    throw new InstallerError("--project requires --scope project")
  }
  if (options.configDir && options.scope === "project") {
    throw new InstallerError("--config-dir cannot be combined with --scope project")
  }
  return options
}

function envFlag(env, name) {
  return env[name] === "1" || env[name] === "true"
}

// ---------------------------------------------------------------------------
// Source and config-dir resolution
// ---------------------------------------------------------------------------

/** Strict pack markers (same detection the bash installer used for cwd). */
export function looksLikePack(dir) {
  return (
    isFile(path.join(dir, "odf-registry.json")) &&
    isFile(path.join(dir, "package.json")) &&
    isDirectory(path.join(dir, "skills")) &&
    isFile(path.join(dir, "install.sh"))
  )
}

/** Relaxed marker used for the CLI's own package root (npm-installed packs). */
export function looksLikePackRoot(dir) {
  return (
    isFile(path.join(dir, "odf-registry.json")) &&
    isFile(path.join(dir, "package.json")) &&
    isDirectory(path.join(dir, "skills"))
  )
}

/**
 * Resolve the pack source directory. Order: --source, ODF_SOURCE_DIR, cwd
 * (strict markers, matching the bash installer), CLI package root.
 */
export function resolveSource({ explicitSource = "", env = process.env, cwd = process.cwd(), sourceRoot = "" } = {}) {
  if (explicitSource) {
    const dir = path.resolve(cwd, explicitSource)
    if (!isDirectory(dir)) throw new InstallerError(`❌ --source does not exist: ${explicitSource}`)
    return { dir, kind: "local" }
  }
  const fromEnv = (env.ODF_SOURCE_DIR || "").trim()
  if (fromEnv) {
    const dir = path.resolve(fromEnv)
    if (!isDirectory(dir)) throw new InstallerError(`❌ ODF_SOURCE_DIR does not exist: ${fromEnv}`)
    return { dir, kind: "local" }
  }
  if (looksLikePack(cwd)) return { dir: cwd, kind: "local" }
  if (sourceRoot && looksLikePackRoot(sourceRoot)) return { dir: sourceRoot, kind: "local" }
  throw new InstallerError(
    "❌ ODF source not found: run from the pack repository or pass --source <dir> (the curl bootstrap downloads it for you).",
  )
}

/**
 * Resolve the install target. Mirrors the historical order:
 * ODF_DIR -> ODF_CONFIG_DIR -> --config-dir -> $XDG_CONFIG_HOME/opencode ->
 * ~/.config/opencode, with project scope installing into <project>/.opencode.
 */
export function resolveConfigDir({ options = {}, env = process.env, cwd = process.cwd() } = {}) {
  if (options.scope === "project") {
    const root = options.project || cwd
    if (!path.isAbsolute(root) || !isDirectory(root)) {
      throw new InstallerError(`❌ Project path must be an existing absolute directory: ${root}`)
    }
    const projectRoot = fs.realpathSync(root)
    const configDir = path.join(projectRoot, ".opencode")
    return { mode: "project", projectRoot, configDir, projectMetaDir: path.join(projectRoot, ".odf") }
  }

  let configDir = ""
  if (env.ODF_DIR) configDir = env.ODF_DIR
  else if (env.ODF_CONFIG_DIR) configDir = env.ODF_CONFIG_DIR
  else if (options.configDir) configDir = options.configDir
  else if (env.XDG_CONFIG_HOME) configDir = path.join(env.XDG_CONFIG_HOME, "opencode")
  else if (env.HOME) configDir = path.join(env.HOME, ".config", "opencode")
  else if (env.USERPROFILE) configDir = path.join(env.USERPROFILE, ".config", "opencode")
  else configDir = path.join(os.homedir(), ".config", "opencode")
  return { mode: "global", projectRoot: "", configDir: path.resolve(configDir), projectMetaDir: "" }
}

export function detectExistingInstall(configDir) {
  return isFile(path.join(configDir, "odf-registry.json")) ? "existing" : "new"
}

// ---------------------------------------------------------------------------
// Filesystem steps
// ---------------------------------------------------------------------------

/**
 * Copy a file or the *contents* of a directory (matching `cp -r src/* dst/`).
 * Hidden entries in the source root are skipped, exactly like the bash glob;
 * nested entries are copied in full.
 */
export function copyDirSync(src, dst, { dryRun = false, logger = null, skipHidden = true, _top = true } = {}) {
  if (!fs.existsSync(src)) return
  if (dryRun) {
    logger?.info(`    [dry-run] Would copy ${src} -> ${dst}`)
    return
  }

  const stat = fs.lstatSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      if (_top && skipHidden && entry.startsWith(".")) continue
      copyDirSync(path.join(src, entry), path.join(dst, entry), { dryRun, logger, skipHidden: false, _top: false })
    }
    return
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true })
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(src)
    try {
      fs.symlinkSync(target, dst)
    } catch {
      fs.copyFileSync(src, dst)
    }
    return
  }
  fs.copyFileSync(src, dst)
}

export function createBackup({ configDir, projectMode = false, projectMetaDir = "", dryRun = false, logger, now = new Date() } = {}) {
  let backupDir = path.join(configDir, "backups", `install-${formatTimestamp(now)}`)
  if (dryRun) {
    logger?.warn(`📦 [dry-run] Would back up existing config to ${backupDir}`)
    return backupDir
  }

  const launcher = projectMode ? path.join(projectMetaDir, "opencode") : ""
  const lock = projectMode ? path.join(projectMetaDir, "odf.lock") : ""
  if (!isDirectory(configDir) && !isFile(launcher) && !isFile(lock)) return ""

  const base = backupDir
  let suffix = 1
  while (fs.existsSync(backupDir)) backupDir = `${base}-${suffix++}`

  logger?.warn("📦 Backing up existing config...")
  fs.mkdirSync(backupDir, { recursive: true })

  const registry = path.join(configDir, "odf-registry.json")
  if (isFile(registry)) fs.copyFileSync(registry, path.join(backupDir, "odf-registry.json"))
  for (const dir of BACKUP_DIRS) {
    const source = path.join(configDir, dir)
    if (isDirectory(source)) copyDirSync(source, path.join(backupDir, dir))
  }

  if (projectMode) {
    if (isFile(launcher)) {
      fs.mkdirSync(path.join(backupDir, "project-meta"), { recursive: true })
      fs.copyFileSync(launcher, path.join(backupDir, "project-meta", "opencode"))
    }
    if (isFile(lock)) {
      fs.mkdirSync(path.join(backupDir, "project-meta"), { recursive: true })
      fs.copyFileSync(lock, path.join(backupDir, "project-meta", "odf.lock"))
    }
  }

  logger?.ok(`✅ Backed up to ${backupDir}`)
  return backupDir
}

export function cleanupStalePluginFiles({ configDir, dryRun = false, logger } = {}) {
  for (const name of STALE_ODF_PLUGIN_FILES) {
    const stalePath = path.join(configDir, "plugins", name)
    if (!fs.existsSync(stalePath)) continue
    if (dryRun) logger?.info(`    [dry-run] Would remove stale ODF plugin file ${stalePath}`)
    else fs.rmSync(stalePath, { force: true })
  }
}

export function cleanupStalePaths({ configDir, dryRun = false, logger } = {}) {
  for (const rel of [...STALE_ODF_PATHS, ...REPO_ONLY_ODF_PATHS]) {
    const target = path.join(configDir, rel)
    if (!fs.existsSync(target)) continue
    if (dryRun) logger?.info(`    [dry-run] Would remove stale ODF path ${target}`)
    else fs.rmSync(target, { recursive: true, force: true })
  }
}

/**
 * Rewrite the author's absolute config path to this environment's config dir.
 * Dependency trees and historical backups are never touched. The replacement
 * uses forward slashes so rewritten JSON/TS string literals stay valid on
 * Windows.
 */
export function rewriteConfigPaths({ configDir, dryRun = false, logger } = {}) {
  if (dryRun) return
  const replacement = configDir.split(path.sep).join("/")
  const stack = [configDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!PRUNE_DIRS.has(entry.name)) stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!REWRITE_EXTENSIONS.has(path.extname(entry.name))) continue
      let content
      try {
        content = fs.readFileSync(full, "utf8")
      } catch {
        continue
      }
      if (!content.includes(LEGACY_AUTHOR_CONFIG_DIR)) continue
      fs.writeFileSync(full, content.split(LEGACY_AUTHOR_CONFIG_DIR).join(replacement))
    }
  }
  logger?.info(`    Rewrote config paths to ${configDir}`)
}

// ---------------------------------------------------------------------------
// Dependencies, self-test, host integration
// ---------------------------------------------------------------------------

/** True when the plugin's runtime dependencies resolve from the pack dir. */
export function runtimeDepsReady(configDir) {
  const result = runNode(
    ["-e", "Promise.all([import('zod'), import('yaml')]).then(() => {}, () => process.exit(1))"],
    { cwd: configDir, stdio: "ignore" },
  )
  return result.status === 0
}

/**
 * Install dependencies and report whether the plugin can actually import.
 * `false` means "do not expose the entrypoint": OpenCode caches a failed
 * plugin import until the service restarts.
 */
export function runNpmInstall({ configDir, dryRun = false, skipNpm = false, logger } = {}) {
  if (dryRun) {
    logger?.warn(`📦 [dry-run] Would run npm install in ${configDir}`)
    return true
  }
  if (!isFile(path.join(configDir, "package.json"))) return true

  if (skipNpm) {
    logger?.warn("📦 Skipping npm install (ODF_SKIP_NPM=1)")
    if (!runtimeDepsReady(configDir)) {
      logger?.warn(`⚠️  Runtime dependencies (zod, yaml) are not resolvable from ${configDir}; the plugin import will fail until they are installed.`)
    }
    return true
  }

  if (!commandExists("npm")) {
    logger?.warn("⚠️  npm not found; skipping npm install. Some self-tests may not run.")
  } else {
    logger?.warn("📦 Running npm install...")
    runHostCli("npm", ["install", "--no-audit", "--no-fund"], { cwd: configDir, stdio: "inherit" })
  }

  if (runtimeDepsReady(configDir)) return true
  logger?.warn(`⚠️  Runtime dependencies (zod, yaml) do not resolve from ${configDir}.`)
  return false
}

export function installFiles({ sourceDir, configDir, dryRun = false, skipNpm = false, logger }) {
  if (dryRun) {
    logger?.warn(`📁 [dry-run] Would install ODF files to ${configDir}`)
  } else {
    logger?.warn(`📁 Installing ODF files to ${configDir}...`)
    for (const dir of SCAFFOLD_DIRS) fs.mkdirSync(path.join(configDir, dir), { recursive: true })
  }

  const entrypoint = path.join(configDir, "plugins", "odf-delegation.ts")
  const supportDir = path.join(configDir, "odf-plugin")
  logger?.info(`    Plugin entrypoint: ${entrypoint}`)
  logger?.info(`    Plugin support:    ${supportDir}`)
  logger?.info(`    Cleanup:           known stale ODF helpers/tests in ${path.join(configDir, "plugins")}`)
  cleanupStalePluginFiles({ configDir, dryRun, logger })

  const copy = (src, dst) => copyDirSync(src, dst, { dryRun, logger })
  copy(path.join(sourceDir, "install.sh"), path.join(configDir, "install.sh"))
  copy(path.join(sourceDir, "install.ps1"), path.join(configDir, "install.ps1"))
  copy(path.join(sourceDir, "odf-registry.json"), path.join(configDir, "odf-registry.json"))
  copy(path.join(sourceDir, "agent"), path.join(configDir, "agent"))
  copy(path.join(sourceDir, "agent"), path.join(configDir, "agents"))
  copy(path.join(sourceDir, "skills"), path.join(configDir, "skills"))
  copy(path.join(sourceDir, "command"), path.join(configDir, "command"))
  copy(path.join(sourceDir, "command"), path.join(configDir, "commands"))
  copy(path.join(sourceDir, "scripts"), path.join(configDir, "scripts"))
  copy(path.join(sourceDir, "policies"), path.join(configDir, "policies"))
  copy(path.join(sourceDir, "openspec"), path.join(configDir, "openspec"))
  copy(path.join(sourceDir, "bin"), path.join(configDir, "bin"))
  // Install only the contracts consumed by ODF phases.
  copy(path.join(sourceDir, "docs", "design-contract.md"), path.join(configDir, "docs", "design-contract.md"))
  copy(path.join(sourceDir, "docs", "expectations-contract.md"), path.join(configDir, "docs", "expectations-contract.md"))
  copy(path.join(sourceDir, "package.json"), path.join(configDir, "package.json"))

  // Dependencies must resolve BEFORE the plugin file is exposed.
  const depsReady = runNpmInstall({ configDir, dryRun, skipNpm, logger })
  if (depsReady) {
    copy(path.join(sourceDir, "plugins", "odf-delegation.ts"), entrypoint)
    copy(path.join(sourceDir, "odf-plugin"), supportDir)
  } else {
    logger?.warn("⚠️  ODF plugin entrypoint NOT installed: runtime dependencies did not resolve, and exposing it would be cached as a failed plugin import.")
    logger?.warn("    Fix npm/network access and re-run the installer; the rest of the pack is already in place.")
  }

  // The pack ships a narrowed tsconfig so `npm run typecheck` covers ODF-owned
  // files only; keep the source file too so a pack can re-install itself.
  copy(path.join(sourceDir, "tsconfig.pack.json"), path.join(configDir, "tsconfig.json"))
  copy(path.join(sourceDir, "tsconfig.pack.json"), path.join(configDir, "tsconfig.pack.json"))

  cleanupStalePaths({ configDir, dryRun, logger })
  rewriteConfigPaths({ configDir, dryRun, logger })
  return depsReady
}

export function runSelfTest({ configDir, dryRun = false, skipSelfTest = false, backupDir = "", logger } = {}) {
  const runner = path.join(configDir, "scripts", "odf-test-runner.js")
  if (dryRun) {
    logger?.warn(`🧪 [dry-run] Would run self-test: node ${runner}`)
    return true
  }
  if (skipSelfTest) {
    logger?.warn("🧪 Skipping self-test (ODF_SKIP_SELFTEST=1)")
    return true
  }
  if (!isFile(runner)) {
    logger?.warn("⚠️  Self-test runner not found; skipping.")
    return true
  }

  logger?.warn("🧪 Running self-test...")
  const result = runNode([runner], {
    cwd: configDir,
    env: { ...process.env, ODF_CONFIG_DIR: configDir },
    stdio: "inherit",
  })
  if (result.status !== 0) {
    logger?.error(`❌ Self-test failed. Your installation is kept at ${configDir}`)
    if (backupDir && isDirectory(backupDir)) logger?.warn(`   Backup: ${backupDir}`)
    return false
  }
  return true
}

/** Report the ODF plugin state (`active`, `failed`, `missing`, or ""). */
export function probePluginState() {
  const result = runHostCli("opencode", ["api", "GET", "/api/plugin"])
  const raw = (result.stdout || "").trim()
  if (!raw) return ""
  try {
    const entries = Array.isArray(JSON.parse(raw).data) ? JSON.parse(raw).data : []
    const plugin = entries.find((entry) => {
      const source = entry && entry.source
      return (entry && entry.id === "odf-delegation") || (source && typeof source.path === "string" && source.path.includes("odf-delegation"))
    })
    if (!plugin) return "missing"
    const status = plugin.state && plugin.state.status
    return status ? String(status) : ""
  } catch {
    return ""
  }
}

export function restartService({ dryRun = false, restart = false, env = process.env, logger } = {}) {
  const wantsRestart = restart || envFlag(env, "ODF_RESTART_SERVICE")

  // A dry run must not touch the filesystem: probing `opencode service status`
  // would initialise ~/.config/opencode on a pristine HOME.
  if (dryRun) {
    if (wantsRestart) logger?.warn("🔄 [dry-run] Would restart the OpenCode service")
    return
  }
  if (!commandExists("opencode")) return

  const status = runHostCli("opencode", ["service", "status"])
  const firstLine = (status.stdout || "").split("\n")[0] || ""
  if (!firstLine.startsWith("http")) return

  if (wantsRestart) {
    logger?.warn("🔄 Restarting the OpenCode service so it reloads ODF plugins...")
    const restartResult = runHostCli("opencode", ["service", "restart"], { stdio: "ignore" })
    if (restartResult.status === 0) logger?.ok("✅ OpenCode service restarted")
    else logger?.warn("⚠️  Could not restart the service. Run it manually: opencode service restart")
    return
  }

  const state = probePluginState()
  if (state === "active") {
    logger?.ok("✅ ODF plugin is active — the host reloaded it, no restart needed")
    return
  }
  if (state) {
    logger?.warn(`⚠️  ODF plugin state: ${state}. Restart OpenCode to load it: opencode service restart`)
    logger?.warn("     (a plugin that fails once stays 'failed' until the service restarts)")
  } else {
    logger?.warn("⚠️  Could not verify the ODF plugin state. If it is not loaded, restart: opencode service restart")
  }
}

export function configureMcp({ configDir, logger } = {}) {
  const cfg = path.join(configDir, "opencode.json")
  const helper = path.join(configDir, "scripts", "lib", "configure-mcp.mjs")
  const result = runNode([helper, cfg, path.join(configDir, "backups")])
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim()
  if (result.status === 0) {
    logger?.ok(`    ✓ context7 MCP entry merged (${output})`)
  } else {
    logger?.warn(`    ⚠️ ${output}`)
    logger?.warn(`    Manual path: review ${cfg} or ${path.join(configDir, "opencode.jsonc")} and add context7/engram using the matching MCP schema.`)
  }
  logger?.warn("  Manual checklist (not auto-configured): codegraph MCP and fff MCP — add their server entries to opencode.json per their docs.")
}

export function probeEnvironment(logger) {
  logger?.warn("🔍 Environment dependencies:")
  for (const tool of ENV_PROBE_TOOLS) {
    if (commandExists(tool)) logger?.ok(`  ✓ ${tool}`)
    else logger?.warn(`  ✗ ${tool} (missing — see impact below)`)
  }
  logger?.warn("  Impact: engram missing blocks Engram-only workflows (OpenSpec OK); codegraph missing disables context packs (FFF fallback); docker missing disables test-command detection.")
}

// ---------------------------------------------------------------------------
// Project scope: launcher + lock metadata
// ---------------------------------------------------------------------------

const LAUNCHER_BODY = `#!/usr/bin/env bash
set -euo pipefail

# ODF project launcher: this project-local pack is the active ODF runtime.
PROJECT_ROOT=__PROJECT_ROOT_QUOTED__
PROJECT_PACK=__PROJECT_PACK_QUOTED__

ORIGINAL_ODF_CONFIG_DIR="\${ODF_CONFIG_DIR:-}"
ORIGINAL_ODF_DIR="\${ODF_DIR:-}"
ORIGINAL_OPENCODE_CONFIG="\${OPENCODE_CONFIG:-}"
GLOBAL_CONFIG="\${XDG_CONFIG_HOME:-\${HOME:-$PROJECT_ROOT/.config}}/opencode"
HOME_CONFIG="\${HOME:-$PROJECT_ROOT}/.config/opencode"

has_odf_marker() {
  local root="$1"
  if [[ -f "$root" ]]; then
    grep -Eiq 'odf-delegation|odf-agent-team' "$root"
    return $?
  fi
  if [[ -f "$root/plugins/odf-delegation.ts" ||
        -f "$root/plugins/odf-delegation.js" ||
        -f "$root/plugins/odf-delegation-v2.ts" ||
        -f "$root/plugins/odf-delegation-v2.js" ||
        -f "$root/plugins/opencode-v2-entrypoint.ts" ||
        -f "$root/plugins/opencode-v2-entrypoint.js" ||
        -f "$root/plugin/odf-delegation.ts" ||
        -f "$root/plugin/odf-delegation.js" ]]; then
    return 0
  fi
  local config
  for config in "$root/opencode.json" "$root/opencode.jsonc"; do
    if [[ -f "$config" ]] && grep -Eiq 'odf-delegation|odf-agent-team' "$config"; then
      return 0
    fi
  done
  return 1
}

for candidate in "$ORIGINAL_ODF_CONFIG_DIR" "$ORIGINAL_ODF_DIR" "$ORIGINAL_OPENCODE_CONFIG" "$GLOBAL_CONFIG" "$HOME_CONFIG"; do
  [[ -n "$candidate" && "$candidate" != "$PROJECT_PACK" ]] || continue
  if { [[ -d "$candidate" ]] || [[ -f "$candidate" ]]; } && has_odf_marker "$candidate"; then
    printf 'ODF project launcher refused to start: conflicting global ODF plugin/config detected at:\\n  %s\\n' "$candidate" >&2
    printf 'The global and project odf-delegation plugins must not load together.\\n' >&2
    if [[ -f "$candidate" ]]; then
      printf 'Remediation: remove or disable only the ODF plugin entry in "%s", then rerun:\\n  %s\\n' "$candidate" "$PROJECT_ROOT/.odf/opencode" >&2
    else
      printf 'Remediation: remove or disable only the global ODF plugin/config at "%s" (for auto-discovery, remove "%s/plugins/odf-delegation.ts"), then rerun:\\n  %s\\n' "$candidate" "$candidate" "$PROJECT_ROOT/.odf/opencode" >&2
    fi
    exit 1
  fi
done

export ODF_CONFIG_DIR="$PROJECT_PACK"
cd "$PROJECT_ROOT"
exec opencode "$@"
`

export function buildProjectLauncher({ projectRoot, configDir }) {
  return LAUNCHER_BODY
    .split("__PROJECT_ROOT_QUOTED__").join(shellQuote(projectRoot))
    .split("__PROJECT_PACK_QUOTED__").join(shellQuote(configDir))
}

export function writeProjectLauncher({ projectRoot, configDir, projectMetaDir, dryRun = false, logger } = {}) {
  const launcher = path.join(projectMetaDir, "opencode")
  if (dryRun) {
    logger?.info(`    [dry-run] Would write launcher ${launcher}`)
    return launcher
  }
  fs.mkdirSync(projectMetaDir, { recursive: true })
  fs.writeFileSync(launcher, buildProjectLauncher({ projectRoot, configDir }))
  fs.chmodSync(launcher, 0o755)
  logger?.ok(`✅ Wrote project launcher ${launcher}`)
  return launcher
}

export function writeProjectLock({
  configDir,
  projectMetaDir,
  sourceDir,
  sourceKind = "local",
  repo = DEFAULT_REPO,
  branch = DEFAULT_BRANCH,
  version,
  dryRun = false,
  logger,
} = {}) {
  const lockPath = path.join(projectMetaDir, "odf.lock")
  if (dryRun) {
    logger?.info(`    [dry-run] Would write lock metadata ${lockPath}`)
    return lockPath
  }
  const source = sourceKind === "local" ? `local:${fs.realpathSync(sourceDir)}` : `${repo}@${branch}`
  const lock = {
    format: 1,
    package: PACKAGE_NAME,
    scope: "project",
    version,
    source,
    checksum: sha256File(path.join(configDir, "odf-registry.json")),
    config_dir: configDir,
  }
  fs.mkdirSync(projectMetaDir, { recursive: true })
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  logger?.ok(`✅ Wrote project lock metadata ${lockPath}`)
  return lockPath
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function countRegistryEntries(configDir) {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(configDir, "odf-registry.json"), "utf8"))
    return { skills: String((registry.skills || []).length), agents: String((registry.agents || []).length) }
  } catch {
    return { skills: "?", agents: "?" }
  }
}

export function printSummary({
  status,
  configDir,
  existingStatus = "new",
  sourceLabel,
  projectMode = false,
  launcher = "",
  lock = "",
  backupDir = "",
  version = FALLBACK_VERSION,
  dryRun = false,
  logger,
} = {}) {
  if (dryRun) {
    logger?.warn("\n🏁 Dry-run complete. No changes were made.")
    logger?.info(`   Target:        ${configDir}`)
    logger?.info(`   Existing:      ${existingStatus}`)
    logger?.info(`   Source:        ${sourceLabel}`)
    return
  }

  const counts = countRegistryEntries(configDir)
  logger?.ok("\n╔═══════════════════════════════════════════════════╗")
  logger?.ok(`║         ODF Agent Team v${version} — ${status}        ║`)
  logger?.ok("╚═══════════════════════════════════════════════════╝")
  logger?.info(`  Target:        ${configDir}`)
  if (projectMode) {
    logger?.info(`  Launcher:      ${launcher}`)
    logger?.info(`  Lock:          ${lock}`)
  }
  logger?.info(`  Previous:      ${existingStatus}`)
  logger?.info(`  Skills:        ${counts.skills}`)
  logger?.info(`  Agents:        ${counts.agents}`)
  if (backupDir && isDirectory(backupDir)) logger?.info(`  Backup:        ${backupDir}`)
  logger?.warn("\n  Next steps:")
  logger?.info("  1. Open OpenCode in your Odoo project")
  logger?.info("  2. Run /odf-init to detect your project context")
  logger?.info("  3. Run /odf-health to verify everything works")
  logger?.info("  4. Run /odf-new my-feature to start your first change")
}

// ---------------------------------------------------------------------------
// Install orchestration
// ---------------------------------------------------------------------------

function confirmInstall({ options, env, logger }) {
  if (options.update || options.dryRun || options.yes || options.force) return true
  if (envFlag(env, "ODF_INSTALL_NONINTERACTIVE")) return true
  if (!process.stdin.isTTY) {
    logger?.warn("Non-interactive stdin detected; continuing with installation (use --dry-run to preview, or --yes to silence this notice).")
    return true
  }
  process.stdout.write("\nContinue with installation? [Y/n] ")
  let answer = ""
  try {
    const buffer = Buffer.alloc(1)
    const read = fs.readSync(0, buffer, 0, 1)
    answer = read > 0 ? buffer.toString("utf8").trim() : ""
  } catch {
    answer = ""
  }
  process.stdout.write("\n")
  if (answer && !/^[Yy]$/.test(answer)) {
    logger?.warn("Installation cancelled.")
    return false
  }
  return true
}

function installCodegraph({ dryRun = false, logger } = {}) {
  if (dryRun) {
    logger?.warn("🔧 [dry-run] Would install CodeGraph: npm install -g @colbymchenry/codegraph@latest")
    return
  }
  logger?.warn("🔧 Installing CodeGraph community tool...")
  if (!commandExists("npm")) {
    logger?.warn("⚠️ npm not found; skipping CodeGraph install")
    return
  }
  const result = runHostCli("npm", ["install", "-g", "@colbymchenry/codegraph@latest"], { stdio: "ignore" })
  if (result.status !== 0) logger?.warn("⚠️ CodeGraph install failed (non-fatal)")
  logger?.ok("✅ CodeGraph installed")
}

/**
 * Full install flow. Returns an exit code; `InstallerError` surfaces as a
 * clean one-line failure.
 */
export function runInstall({ options, env = process.env, cwd = process.cwd(), sourceRoot = "", logger = createLogger() } = {}) {
  if (options.help) {
    logger.plain(INSTALL_USAGE)
    return 0
  }
  if (options.host !== "opencode") {
    throw new InstallerError(`❌ Unsupported host: ${options.host}. Only 'opencode' is supported today (a pi.dev adapter is planned).`)
  }

  const target = resolveConfigDir({ options, env, cwd })
  const version = sourceRoot ? readPackVersion(sourceRoot) : FALLBACK_VERSION

  // TUI mode: hand over to the Node installer UI before any file work.
  if (options.tui) {
    const candidates = [
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "odf-install-tui.mjs"),
      sourceRoot ? path.join(sourceRoot, "scripts", "odf-install-tui.mjs") : "",
      path.join(target.configDir, "scripts", "odf-install-tui.mjs"),
    ].filter(Boolean)
    const tuiScript = candidates.find((candidate) => isFile(candidate))
    if (tuiScript) {
      const result = runNode([tuiScript, ...options.rawArgs], {
        stdio: "inherit",
        env: { ...env, ODF_DIR: target.configDir, ODF_CONFIG_DIR: target.configDir },
      })
      return result.status ?? 1
    }
    logger.warn("⚠️ TUI script not found at scripts/odf-install-tui.mjs. Falling back to standard installer.")
  }

  logger.plain("")
  logger.info("╔═══════════════════════════════════════════════════╗")
  logger.info(`║         ODF Agent Team Installer v${version}          ║`)
  logger.info("╚═══════════════════════════════════════════════════╝")
  logger.plain("")

  logger.info("🔍 Checking prerequisites...")
  logger.ok(`✅ Node.js v${process.versions.node}`)

  const source = resolveSource({ explicitSource: options.source, env, cwd, sourceRoot })
  const sourceLabel = `local: ${source.dir}`
  const existingStatus = detectExistingInstall(target.configDir)

  logger.plain("")
  if (options.update) logger.info("🔄 Update mode — will back up current install and update from source")
  logger.info(`Target directory: ${target.configDir}`)
  logger.info(`Existing install: ${existingStatus}`)
  logger.info(`Source:           ${sourceLabel}`)

  if (!confirmInstall({ options, env, logger })) return 0

  const backupDir = createBackup({
    configDir: target.configDir,
    projectMode: target.mode === "project",
    projectMetaDir: target.projectMetaDir,
    dryRun: options.dryRun,
    logger,
  })

  installFiles({
    sourceDir: source.dir,
    configDir: target.configDir,
    dryRun: options.dryRun,
    skipNpm: options.skipNpm || envFlag(env, "ODF_SKIP_NPM"),
    logger,
  })

  if (!options.dryRun && !isFile(path.join(target.configDir, "odf-registry.json"))) {
    throw new InstallerError(`❌ Installation failed: registry not found at ${path.join(target.configDir, "odf-registry.json")}`)
  }

  let launcher = ""
  let lock = ""
  if (target.mode === "project") {
    launcher = writeProjectLauncher({
      projectRoot: target.projectRoot,
      configDir: target.configDir,
      projectMetaDir: target.projectMetaDir,
      dryRun: options.dryRun,
      logger,
    })
    lock = writeProjectLock({
      configDir: target.configDir,
      projectMetaDir: target.projectMetaDir,
      sourceDir: source.dir,
      sourceKind: source.kind,
      repo: env.REPO || DEFAULT_REPO,
      branch: env.BRANCH || DEFAULT_BRANCH,
      version,
      dryRun: options.dryRun,
      logger,
    })
  }

  if (options.withCodegraph) installCodegraph({ dryRun: options.dryRun, logger })

  const selfTestPassed = runSelfTest({
    configDir: target.configDir,
    dryRun: options.dryRun,
    skipSelfTest: options.skipSelftest || envFlag(env, "ODF_SKIP_SELFTEST"),
    backupDir,
    logger,
  })
  if (!selfTestPassed) return 1

  restartService({ dryRun: options.dryRun, restart: options.restartService, env, logger })

  if (options.dryRun) {
    printSummary({ status: "dry-run", configDir: target.configDir, existingStatus, sourceLabel, dryRun: true, logger })
    return 0
  }

  probeEnvironment(logger)
  if (options.configureMcp) {
    logger.warn("🔌 Configuring MCP servers (--configure-mcp)...")
    configureMcp({ configDir: target.configDir, logger })
  }
  printSummary({
    status: "installed",
    configDir: target.configDir,
    existingStatus,
    sourceLabel,
    projectMode: target.mode === "project",
    launcher,
    lock,
    backupDir,
    version,
    logger,
  })
  return 0
}

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

export function runDoctor({ options = {}, env = process.env, cwd = process.cwd(), sourceRoot = "", logger = createLogger() } = {}) {
  const version = sourceRoot ? readPackVersion(sourceRoot) : FALLBACK_VERSION
  let target
  try {
    target = resolveConfigDir({ options, env, cwd })
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error))
    return 1
  }

  logger.info(`ODF doctor — v${version}`)
  logger.info(`  Config dir:    ${target.configDir}`)
  logger.info(`  Installed:     ${detectExistingInstall(target.configDir) === "existing" ? "yes" : "no"}`)
  if (isFile(path.join(target.configDir, "odf-registry.json"))) {
    const counts = countRegistryEntries(target.configDir)
    logger.info(`  Skills:        ${counts.skills}`)
    logger.info(`  Agents:        ${counts.agents}`)
  }
  logger.info(`  Runtime deps:  ${runtimeDepsReady(target.configDir) ? "resolvable" : "missing (run npm install in the pack)"}`)

  probeEnvironment(logger)

  if (commandExists("opencode")) {
    const state = probePluginState()
    logger.info(`  Plugin state:  ${state || "unavailable"}`)
  } else {
    logger.info("  Plugin state:  opencode not on PATH")
  }
  return 0
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export function runCli({ argv = [], env = process.env, cwd = process.cwd(), sourceRoot = "", logger = createLogger() } = {}) {
  const [command, ...rest] = argv

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      logger.plain(INSTALL_USAGE)
      return 0
    }
    if (command === "version" || command === "--version" || command === "-v") {
      logger.plain(readPackVersion(sourceRoot || path.dirname(fileURLToPath(import.meta.url))))
      return 0
    }
    if (command === "doctor") {
      const options = parseInstallOptions(rest)
      return runDoctor({ options, env, cwd, sourceRoot, logger })
    }
    if (command === "install") {
      const options = parseInstallOptions(rest)
      return runInstall({ options, env, cwd, sourceRoot, logger })
    }
    throw new InstallerError(`Unknown command: ${command}\nRun 'odf --help' for usage.`)
  } catch (error) {
    if (error instanceof InstallerError) {
      logger.error(error.message)
      return 1
    }
    throw error
  }
}
