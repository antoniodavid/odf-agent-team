#!/usr/bin/env node
/**
 * ODF deterministic project scan (odf-project-scan).
 *
 * One deterministic pass that assembles the full ODF project config:
 * Doodba sources + dependency matrix (odf-env-detect), compose environment,
 * linting, git state, CodeGraph status, Odoo version. Renders summary/json/
 * yaml/markdown, persists directly to Engram (--persist), caches by checksum,
 * and can diff against the persisted config (--diff). No LLM required.
 *
 * Usage:
 *   node scripts/odf-project-scan.js --root <doodba-root> --repo <repo-dir>
 *     [--format summary|json|yaml|markdown] [--persist] [--fresh] [--diff]
 *     [--codegraph] [--odoo-version N] [--docker-container NAME]
 *
 * Exit codes: 0 ok, 1 warnings present, 2 blocked (environment unreadable).
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import YAML from "yaml"
import { detectEnv } from "./odf-env-detect.js"
import { dependencyProbe } from "./lib/dependencies.js"

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "devel.yaml"]

function fileExists(...parts) {
  try {
    return fs.statSync(path.join(...parts)).isFile()
  } catch {
    return false
  }
}

function runGit(repoDir, args) {
  try {
    return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch {
    return null
  }
}

function detectOdooVersion(repoDir, workspaceRoot) {
  const fromManifest = (() => {
    const scan = detectEnv(workspaceRoot, repoDir)
    const version = scan.project.modules.find(m => m.version)?.version
    return version ? Number(version.split(".")[0]) || null : null
  })()
  if (fromManifest) return fromManifest
  try {
    const copier = fs.readFileSync(path.join(repoDir, ".copier-answers.yml"), "utf8")
    const match = copier.match(/odoo_version\s*:\s*["']?(\d+)\.?\d*/)
    if (match) return Number(match[1]) || null
  } catch { /* fall through */ }
  const compose = findCompose(workspaceRoot)
  if (compose?.image) {
    const match = compose.image.match(/(\d+)\.[0-9x]+/i)
    if (match) return Number(match[1]) || null
  }
  return null
}

function findCompose(workspaceRoot) {
  for (const name of COMPOSE_FILES) {
    const composePath = path.join(workspaceRoot, name)
    let parsed
    try {
      parsed = YAML.parse(fs.readFileSync(composePath, "utf8"))
    } catch {
      continue
    }
    const services = parsed?.services && typeof parsed.services === "object" ? parsed.services : null
    if (!services) continue
    const serviceNames = Object.keys(services)
    const odooService = serviceNames.find(s => {
      const svc = services[s] || {}
      const image = String(svc.image || "")
      const command = Array.isArray(svc.command) ? svc.command.join(" ") : String(svc.command || "")
      return /odoo/i.test(image) || /odoo/i.test(command)
    })
    const serviceName = odooService || serviceNames[0] || "odoo"
    const svc = services[serviceName] || {}
    // Doodba declares the DB via an anchor on another service (PGDATABASE) and
    // the odoo service usually only carries DATABASE_URL; scan all services.
    let db = null
    for (const name of serviceNames) {
      const env = (services[name] || {}).environment || {}
      const direct = typeof env.POSTGRES_DB === "string" ? env.POSTGRES_DB
        : typeof env.ODOO_DB === "string" ? env.ODOO_DB
        : typeof env.PGDATABASE === "string" ? env.PGDATABASE
        : null
      if (direct) { db = direct; break }
    }
    if (!db) {
      const dbUrl = typeof svc.environment?.DATABASE_URL === "string" ? svc.environment.DATABASE_URL : null
      const match = dbUrl && dbUrl.match(/postgres(?:ql)?:\/\/[^/]+\/([^?]+)/)
      if (match) db = match[1]
    }
    return { file: composePath, service: serviceName, db, image: String(svc.image || null) || null }
  }
  return null
}

function detectLinting(repoDir, workspaceRoot) {
  const has = (dir, name) => fileExists(dir, name)
  const roots = workspaceRoot && workspaceRoot !== repoDir ? [repoDir, workspaceRoot] : [repoDir]
  const any = (name) => roots.some(dir => has(dir, name))
  const linting = {
    pre_commit: any(".pre-commit-config.yaml"),
    ruff: any(".ruff.toml") || any("ruff.toml"),
    pylint_odoo: any(".pylintrc") || any(".pylintrc-mandatory"),
    eslint: any(".eslintrc.yml") || any(".eslintrc.json") || any(".eslintrc.js"),
    prettier: any(".prettierrc.yml") || any(".prettierrc.json") || any(".prettierrc"),
  }
  let ocaMode = false
  for (const dir of roots) {
    try {
      const copier = fs.readFileSync(path.join(dir, ".copier-answers.yml"), "utf8")
      if (/oca-addons-repo|oca\.github\.io/i.test(copier)) { ocaMode = true; break }
    } catch { /* not OCA */ }
  }
  return { linting, oca_mode: ocaMode }
}

function gitState(repoDir) {
  const branch = runGit(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"])
  const remote = runGit(repoDir, ["remote", "get-url", "origin"])
  const dirty = runGit(repoDir, ["status", "--porcelain"]) !== null
    ? (runGit(repoDir, ["status", "--porcelain"]) || "").length > 0
    : null
  return { branch, remote, dirty }
}

function projectName(repoDir) {
  const remote = runGit(repoDir, ["remote", "get-url", "origin"])
  if (remote) {
    const base = remote.replace(/\.git$/, "").split(/[/:]/).pop()
    if (base) return base
  }
  return path.basename(repoDir)
}

function codegraphState(repoDir) {
  const indexed = fs.existsSync(path.join(repoDir, ".codegraph"))
  let cliAvailable = false
  try {
    execFileSync("codegraph", ["--version"], { stdio: "ignore", timeout: 5_000 })
    cliAvailable = true
  } catch { /* not installed */ }
  return { indexed, cli_available: cliAvailable }
}

function defaultCodegraphRunner(dir) {
  try {
    if (fs.existsSync(path.join(dir, ".codegraph"))) {
      execFileSync("codegraph", ["sync", dir], { stdio: "ignore", timeout: 300_000 })
    } else {
      execFileSync("codegraph", ["init", dir], { stdio: "ignore", timeout: 600_000 })
    }
    return "ok"
  } catch (error) {
    return String(error?.message || "failed").slice(0, 120)
  }
}

/** --deep: index every active source repo with CodeGraph (bounded, opt-in). */
export function indexActiveSources(config, workspaceRoot, runner = defaultCodegraphRunner) {
  const srcBase = path.join(workspaceRoot, "odoo", "custom", "src")
  const indexed = []
  const errors = []
  for (const activeRepo of config.environment?.sources?.active_repos || []) {
    const outcome = runner(path.join(srcBase, activeRepo.name))
    if (outcome === "ok") indexed.push(activeRepo.name)
    else errors.push(`${activeRepo.name}: ${outcome}`)
  }
  return { indexed, errors }
}

export function computeChecksum(inputs) {
  const hash = createHash("sha256")
  for (const input of inputs) hash.update(input)
  return hash.digest("hex")
}

function scanInputs(workspaceRoot, repoDir, env) {
  const parts = []
  if (env.addons_yaml) parts.push(fs.readFileSync(env.addons_yaml, "utf8"))
  const compose = findCompose(workspaceRoot)
  if (compose) parts.push(fs.readFileSync(compose.file, "utf8"))
  const manifestDirs = [path.join(repoDir), ...env.sources.active_repos.map(r => path.join(workspaceRoot, "odoo", "custom", "src", r.name))]
  for (const dir of manifestDirs) {
    for (const module of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      if (!module.isDirectory()) continue
      const manifestPath = path.join(dir, module.name, "__manifest__.py")
      try {
        const stat = fs.statSync(manifestPath)
        parts.push(`${manifestPath}:${stat.size}:${stat.mtimeMs}`)
      } catch { /* no manifest */ }
    }
  }
  return parts
}

export function buildConfig(workspaceRoot, repoDir, opts = {}) {
  const env = detectEnv(workspaceRoot, repoDir)
  const compose = findCompose(workspaceRoot)
  const linting = detectLinting(repoDir, workspaceRoot)
  const git = gitState(repoDir)
  const codegraph = codegraphState(repoDir)
  const odooVersion = opts.odooVersion ?? detectOdooVersion(repoDir, workspaceRoot)
  const testCommand = compose
    ? `docker compose run --rm ${compose.service} odoo -d {test_db} -i {module} --test-enable --stop-after-init`
    : null

  const config = {
    project_name: projectName(repoDir),
    odoo_version: odooVersion,
    modules: env.project.modules.map(m => ({
      name: m.name,
      path: m.path,
      version: m.version,
      license: m.license,
      depends: m.depends,
    })),
    environment: {
      type: compose ? "doodba" : null,
      workspace_root: workspaceRoot,
      addons_yaml: env.addons_yaml,
      compose: compose ? { file: compose.file, service: compose.service, db: compose.db, image: compose.image } : null,
      sources: env.sources,
    },
    testing: {
      test_command: testCommand,
      test_db: compose?.db ?? null,
    },
    linting: linting.linting,
    flags: { oca_mode: linting.oca_mode },
    conventions: { git_branch: git.branch, git_remote: git.remote, git_dirty: git.dirty },
    codegraph: { indexed: codegraph.indexed, cli_available: codegraph.cli_available, root: repoDir, paths: [], last_sync: null },
    dependency_matrix: env.dependency_matrix,
    dependencies: dependencyProbe(),
    warnings: env.warnings,
    scan_checksum: computeChecksum(scanInputs(workspaceRoot, repoDir, env)),
    scanned_at: new Date().toISOString(),
  }
  if (!odooVersion) config.warnings.push("Odoo version could not be detected.")
  if (!compose) config.warnings.push("No Docker Compose file detected; test command unavailable.")
  if (!codegraph.indexed) config.warnings.push("CodeGraph index missing for the project repo.")
  return config
}

export function classifyExit(config) {
  const warnings = config.warnings || []
  const blocked = !config.odoo_version && config.modules.length === 0
  return blocked ? 2 : warnings.length ? 1 : 0
}

export function diffConfigs(cached, fresh) {
  const changes = []
  const fields = [
    ["odoo_version", a => a?.odoo_version, b => b?.odoo_version],
    ["modules", a => (a?.modules || []).map(m => m.name).sort().join(","), b => (b?.modules || []).map(m => m.name).sort().join(",")],
    ["sources.active", a => (a?.environment?.sources?.active || []).sort().join(","), b => (b?.environment?.sources?.active || []).sort().join(",")],
    ["sources.undeclared", a => (a?.environment?.sources?.undeclared || []).sort().join(","), b => (b?.environment?.sources?.undeclared || []).sort().join(",")],
    ["sources.declared_absent", a => (a?.environment?.sources?.declared_absent || []).sort().join(","), b => (b?.environment?.sources?.declared_absent || []).sort().join(",")],
    ["testing.test_command", a => a?.testing?.test_command, b => b?.testing?.test_command],
    ["linting.pre_commit", a => a?.linting?.pre_commit, b => b?.linting?.pre_commit],
    ["codegraph.indexed", a => a?.codegraph?.indexed, b => b?.codegraph?.indexed],
  ]
  for (const [label, getA, getB] of fields) {
    const a = getA(cached)
    const b = getB(fresh)
    if (String(a ?? "") !== String(b ?? "")) changes.push(`${label}: ${a ?? "null"} -> ${b ?? "null"}`)
  }
  return changes
}

export function renderSummary(config) {
  const env = config.environment || {}
  const sources = env.sources || {}
  const lines = [
    `project: ${config.project_name} (Odoo ${config.odoo_version ?? "?"})`,
    `modules: ${config.modules.length} | branch: ${config.conventions?.git_branch || "no-git"}${config.conventions?.git_dirty ? " [dirty]" : ""}`,
    `sources: ${(sources.active || []).length} active, ${(sources.undeclared || []).length} undeclared, ${(sources.declared_absent || []).length} declared-absent`,
    `compose: ${env.compose?.file ? `${path.basename(env.compose.file)} (service ${env.compose.service}, db ${env.compose.db ?? "?"})` : "none"}`,
    `test: ${config.testing?.test_command ? `${path.basename(config.testing.test_command.split(" ")[0])} -d ${config.testing.test_db ?? "{test_db}"}` : "not detected"}`,
    `lint: pre-commit=${config.linting?.pre_commit}, ruff=${config.linting?.ruff}, pylint-odoo=${config.linting?.pylint_odoo}${config.flags?.oca_mode ? " | OCA mode" : ""}`,
    `codegraph: ${config.codegraph?.indexed ? "indexed" : "missing"}${config.codegraph?.cli_available ? " (cli available)" : " (cli unavailable)"}`,
    `deps: ${(config.dependency_matrix?.resolved || []).length} resolved, ${(config.dependency_matrix?.unresolved_in_sources || []).length} unresolved in sources`,
  ]
  if ((config.warnings || []).length) lines.push(`warnings (${(config.warnings).length}):`)
  for (const w of config.warnings || []) lines.push(`  - ${w}`)
  return lines.join("\n")
}

function renderMarkdown(config) {
  const rows = [
    ["Project", config.project_name],
    ["Odoo", String(config.odoo_version ?? "?")],
    ["Modules", String(config.modules.length)],
    ["Branch", String(config.conventions?.git_branch ?? "-")],
    ["Sources", `${(config.environment?.sources?.active || []).length} active / ${(config.environment?.sources?.undeclared || []).length} undeclared`],
    ["Test command", String(config.testing?.test_command ?? "-")],
    ["CodeGraph", config.codegraph?.indexed ? "indexed" : "missing"],
    ["Deps resolved", String((config.dependency_matrix?.resolved || []).length)],
    ["Deps unresolved", String((config.dependency_matrix?.unresolved_in_sources || []).length)],
  ]
  const table = rows.map(([k, v]) => `| ${k} | ${v} |`).join("\n")
  return `## ODF Project Scan: ${config.project_name}\n\n| Field | Value |\n|---|---|\n${table}\n`
}

/** Read the persisted `odf-init/{project}` config from Engram (export + filter). */
export function readPersistedConfig(project) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "odf-scan-"))
  const tmpFile = path.join(tmpDir, "export.json")
  try {
    execFileSync("engram", ["export", tmpFile], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 })
    const raw = fs.readFileSync(tmpFile, "utf8")
    const parsed = JSON.parse(raw)
    const observations = Array.isArray(parsed) ? parsed : parsed?.observations
    const topicKey = `odf-init/${project}`
    // Latest observation wins (export may list oldest first); the plugin uses the same .at(-1) rule.
    const matches = (observations || []).filter(o => o.topic_key === topicKey)
    const obs = matches.at(-1)
    return obs?.content ? YAML.parse(obs.content) : null
  } catch {
    return null
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

/** Compact the persisted copy: per-repo module lists are huge in Doodba and
 * the Engram store truncates content around 50KB. Keep essential context and
 * per-repo module counts; the full lists are re-derivable deterministically. */
export function compactForPersist(config) {
  const sources = config.environment?.sources
  return {
    ...config,
    environment: {
      ...config.environment,
      sources: sources
        ? { ...sources, active_repos: (sources.active_repos || []).map(r => ({ name: r.name, branch: r.branch, module_count: r.modules.length })) }
        : sources,
    },
  }
}

function persistConfig(config) {
  const project = config.project_name
  const topicKey = `odf-init/${project}`
  const yaml = YAML.stringify(compactForPersist(config))
  try {
    execFileSync("engram", [
      "save", topicKey, yaml,
      "--type", "config", "--project", project, "--scope", "project", "--topic", topicKey,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000, maxBuffer: 256 * 1024 })
    return null
  } catch (error) {
    const code = error?.code
    return code === "ENOENT" ? "engram-cli-unavailable" : code === "ETIMEDOUT" ? "engram-save-timeout" : "engram-save-failed"
  }
}

/** Resolve --repo: absolute as-is; relative against the Doodba src dir (or the root). */
export function resolveRepoArg(root, repoArg) {
  if (path.isAbsolute(repoArg)) return path.resolve(repoArg)
  const srcBase = path.join(root, "odoo", "custom", "src")
  const base = fs.existsSync(srcBase) ? srcBase : root
  return path.resolve(base, repoArg)
}

async function main(argv) {
  const args = { root: null, repo: null, format: "summary", persist: false, fresh: false, diff: false, codegraph: false, deep: false, odooVersion: null, dockerContainer: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = argv[++i]
    else if (argv[i] === "--repo") args.repo = argv[++i]
    else if (argv[i] === "--format") args.format = argv[++i]
    else if (argv[i] === "--persist") args.persist = true
    else if (argv[i] === "--fresh") args.fresh = true
    else if (argv[i] === "--diff") args.diff = true
    else if (argv[i] === "--codegraph") args.codegraph = true
    else if (argv[i] === "--deep") args.deep = true
    else if (argv[i] === "--odoo-version") args.odooVersion = Number(argv[++i]) || null
    else if (argv[i] === "--docker-container") args.dockerContainer = argv[++i]
  }
  if (!args.root || !args.repo) {
    console.error("Usage: node scripts/odf-project-scan.js --root <doodba-root> --repo <repo-dir> [--format summary|json|yaml|markdown] [--persist] [--fresh] [--diff] [--codegraph] [--deep] [--odoo-version N] [--docker-container NAME]")
    process.exit(2)
  }
  const root = path.resolve(args.root)
  // Resolve a relative --repo against the Doodba src dir (not the CWD) so a
  // bare repo name never produces a degraded scan of the wrong directory.
  const repo = resolveRepoArg(root, args.repo)
  const project = projectName(repo)
  const cached = args.diff || !args.fresh ? readPersistedConfig(project) : null

  const config = buildConfig(root, repo, { odooVersion: args.odooVersion })
  if (args.dockerContainer && config.testing?.test_command) {
    config.testing.test_command = config.testing.test_command.replace(/(run --rm )\S+/, `$1${args.dockerContainer}`)
  }
  if (args.codegraph && !config.codegraph.indexed && config.codegraph.cli_available) {
    try {
      execFileSync("codegraph", ["init", repo], { stdio: "ignore", timeout: 120_000 })
      config.codegraph.indexed = fs.existsSync(path.join(repo, ".codegraph"))
      config.codegraph.last_sync = new Date().toISOString()
    } catch {
      config.warnings.push("codegraph init failed.")
    }
  }
  if (args.deep && config.environment?.sources?.active_repos?.length && config.codegraph.cli_available) {
    process.stdout.write("deep: indexing active source repos with CodeGraph (can take minutes)...\n")
    const deep = indexActiveSources(config, root)
    config.codegraph.paths = [repo, ...deep.indexed.map(name => path.join(root, "odoo", "custom", "src", name))]
    for (const error of deep.errors) config.warnings.push(`codegraph deep failed: ${error}`)
    if (deep.indexed.length) config.codegraph.last_sync = new Date().toISOString()
  } else if (args.deep) {
    config.warnings.push("--deep requested but codegraph CLI is unavailable.")
  }

  let exit = classifyExit(config)
  const lines = []
  if (args.diff && cached) {
    const changes = diffConfigs(cached, config)
    if (changes.length) lines.push("## Diff vs persisted config", ...changes.map(c => `- ${c}`))
    else lines.push("No changes detected.")
  }
  if (args.persist) {
    // Guard: never let a degraded scan (0 modules) overwrite a valid config.
    if (config.modules.length === 0 && cached && (cached.modules || []).length > 0) {
      console.error("scan-degraded: 0 modules detected while a valid config exists. Pass an absolute --repo (or a repo path relative to --root) and retry; nothing was persisted.")
      process.exit(2)
    }
    const error = persistConfig(config)
    if (error) {
      lines.push(`persist error: ${error}`)
      exit = Math.max(exit, 1)
    } else {
      // Readback verification: the canonical topic must now expose THIS scan.
      // engram export may lag the save by a few hundred ms; poll briefly.
      let verified = null
      for (let attempt = 0; attempt < 5 && !(verified && verified.scan_checksum === config.scan_checksum); attempt++) {
        const sleepMs = new Promise(resolve => setTimeout(resolve, 200))
        await sleepMs
        verified = readPersistedConfig(project)
      }
      if (verified && verified.scan_checksum === config.scan_checksum) {
        lines.push(`persisted to Engram topic odf-init/${project} (verified)`)
        if (cached && cached.scan_checksum === config.scan_checksum) lines.push("cached: no environment changes since last scan.")
      } else {
        lines.push(`persist error: readback mismatch for topic odf-init/${project} — the CLI persist did not land. Reinstall the pack or check the engram CLI.`)
        exit = Math.max(exit, 1)
      }
    }
  }

  if (args.format === "json") process.stdout.write(JSON.stringify(config, null, 2) + "\n")
  else if (args.format === "yaml") process.stdout.write(YAML.stringify(config) + "\n")
  else if (args.format === "markdown") process.stdout.write(renderMarkdown(config) + (lines.length ? "\n" + lines.join("\n") + "\n" : ""))
  else process.stdout.write(renderSummary(config) + (lines.length ? "\n" + lines.join("\n") + "\n" : ""))
  process.exit(exit)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(String(error?.message || error))
    process.exit(2)
  })
}
