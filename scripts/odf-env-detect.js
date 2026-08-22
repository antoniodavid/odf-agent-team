#!/usr/bin/env node
/**
 * ODF environment detector for odf-init.
 *
 * Parses the Doodba source manifest (odoo/custom/src/addons.yaml) and the
 * cloned repos to derive the active source universe, the project modules and
 * their dependency matrix, plus git branches. Read-only and bounded: only
 * manifests are read (capped), never the full source tree.
 *
 * Usage:
 *   node scripts/odf-env-detect.js --root <doodba-workspace-root> --repo <project-repo-dir> [--json]
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_MODULES_PER_REPO = 200

export function gitBranch(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null
  } catch {
    return null
  }
}

/** Parse a Python list literal value like "['base', 'stock']" into strings. */
export function parsePythonList(raw) {
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "").trim()
  if (!inner) return []
  return inner.split(",")
    .map(part => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
}

/** Extract one string field ('key': 'value') from a manifest body. */
function manifestField(body, key) {
  const re = new RegExp(`['"]${key}['"]\\s*:\\s*['"]([^'"]+)['"]`)
  const match = body.match(re)
  return match ? match[1] : null
}

export function parseManifest(filePath) {
  let body
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return null
    body = fs.readFileSync(filePath, "utf8")
  } catch {
    return null
  }
  const dependsMatch = body.match(/['"]depends['"]\s*:\s*(\[[^\]]*\])/s)
  return {
    name: manifestField(body, "name"),
    version: manifestField(body, "version"),
    license: manifestField(body, "license"),
    depends: dependsMatch ? parsePythonList(dependsMatch[1]) : [],
  }
}

function modulesOf(repoDir) {
  const modules = []
  let entries = []
  try {
    entries = fs.readdirSync(repoDir, { withFileTypes: true })
  } catch {
    return modules
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    if (modules.length >= MAX_MODULES_PER_REPO) break
    const manifestPath = path.join(repoDir, entry.name, "__manifest__.py")
    const manifest = parseManifest(manifestPath)
    if (!manifest) continue
    modules.push({
      name: entry.name,
      display_name: manifest.name,
      path: entry.name,
      version: manifest.version,
      license: manifest.license,
      depends: manifest.depends,
    })
  }
  modules.sort((a, b) => a.path.localeCompare(b.path))
  return modules
}

/** Parse the Doodba addons.yaml: uncommented top-level keys are active. */
export function parseAddonsYaml(filePath) {
  const active = []
  const commented = []
  let content
  try {
    content = fs.readFileSync(filePath, "utf8")
  } catch {
    return { active, commented }
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const commentedMatch = line.match(/^#\s*([A-Za-z0-9_.-]+)\s*:/)
    if (commentedMatch) {
      commented.push(commentedMatch[1])
      continue
    }
    const activeMatch = line.match(/^([A-Za-z0-9_.-]+)\s*:/)
    if (activeMatch) active.push(activeMatch[1])
  }
  return { active: Array.from(new Set(active)), commented: Array.from(new Set(commented)) }
}

export function detectEnv(root, repoDir) {
  const warnings = []
  const srcDir = path.join(root, "odoo", "custom", "src")
  const addonsYaml = path.join(srcDir, "addons.yaml")
  const manifest = fs.existsSync(addonsYaml) ? parseAddonsYaml(addonsYaml) : { active: [], commented: [] }
  if (!fs.existsSync(addonsYaml)) warnings.push("addons.yaml not found; sources are empty.")

  const cloned = []
  let srcEntries = []
  try {
    srcEntries = fs.readdirSync(srcDir, { withFileTypes: true })
  } catch {
    warnings.push(`No ${srcDir} directory found.`)
  }
  for (const entry of srcEntries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "addons.yaml") continue
    cloned.push(entry.name)
  }
  cloned.sort((a, b) => a.localeCompare(b))

  const declaredAbsent = manifest.active.filter(name => !cloned.includes(name))
  const undeclared = cloned.filter(name => !manifest.active.includes(name))
  if (declaredAbsent.length) warnings.push(`Declared but not cloned: ${declaredAbsent.join(", ")}.`)

  const activeRepos = manifest.active
    .filter(name => cloned.includes(name))
    .map(name => {
      const dir = path.join(srcDir, name)
      return { name, branch: gitBranch(dir), modules: modulesOf(dir) }
    })

  const projectModules = modulesOf(repoDir)
  const project = {
    repo: path.basename(repoDir),
    branch: gitBranch(repoDir),
    modules: projectModules,
  }

  const resolved = []
  const unresolved = []
  for (const module of projectModules) {
    for (const dep of module.depends) {
      const provider = activeRepos.find(repo => repo.modules.some(m => m.name === dep))
      if (provider) resolved.push({ module: module.name, dep, in_repo: provider.name })
      else unresolved.push({ module: module.name, dep })
    }
  }
  if (unresolved.length) {
    warnings.push("Dependencies not found in any active source repo; core addons come from the Docker image.")
  }

  return {
    addons_yaml: fs.existsSync(addonsYaml) ? addonsYaml : null,
    sources: {
      active: manifest.active,
      commented: manifest.commented,
      declared_absent: declaredAbsent,
      undeclared,
      active_repos: activeRepos,
    },
    project,
    dependency_matrix: { resolved, unresolved_in_sources: unresolved },
    warnings,
  }
}

function renderSummary(env) {
  const lines = [
    `addons.yaml: ${env.addons_yaml || "not found"}`,
    `sources: ${env.sources.active.length} active, ${env.sources.commented.length} commented, ${env.sources.declared_absent.length} declared-absent, ${env.sources.undeclared.length} undeclared`,
    `active repos: ${env.sources.active_repos.map(r => `${r.name}@${r.branch || "no-git"} (${r.modules.length} modules)`).join(", ") || "none"}`,
    `project: ${env.project.repo}@${env.project.branch || "no-git"} (${env.project.modules.length} modules)`,
    `deps resolved: ${env.dependency_matrix.resolved.length}, unresolved in sources: ${env.dependency_matrix.unresolved_in_sources.length}`,
  ]
  if (env.warnings.length) lines.push(`warnings: ${env.warnings.join(" | ")}`)
  return lines.join("\n")
}

function main(argv) {
  const args = { root: null, repo: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = argv[++i]
    else if (argv[i] === "--repo") args.repo = argv[++i]
    else if (argv[i] === "--json") args.json = true
  }
  if (!args.root || !args.repo) {
    console.error("Usage: node scripts/odf-env-detect.js --root <doodba-workspace-root> --repo <project-repo-dir> [--json]")
    process.exit(1)
  }
  const env = detectEnv(path.resolve(args.root), path.resolve(args.repo))
  process.stdout.write(args.json ? JSON.stringify(env, null, 2) + "\n" : renderSummary(env) + "\n")
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
