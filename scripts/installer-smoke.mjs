#!/usr/bin/env node
/**
 * Cross-OS installer smoke test.
 *
 * Packs the npm tarball, installs it into a temp project like a user would,
 * then runs the *packaged* CLI against a temp config dir and asserts the
 * layout. Runs on ubuntu/macos/windows in CI: pure Node, no bash, no sed.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const isWindows = process.platform === "win32"
const npm = isWindows ? "npm.cmd" : "npm"

function run(command, args, options = {}) {
  const needsShell = isWindows && command === npm
  const finalArgs = needsShell ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)) : args
  const result = spawnSync(command, finalArgs, { encoding: "utf8", ...options, shell: needsShell })
  if (result.status !== 0) {
    process.stderr.write(`command failed (${result.status}): ${command} ${finalArgs.join(" ")}\n`)
    process.stderr.write(`${result.stdout || ""}\n${result.stderr || ""}\n`)
    process.exit(1)
  }
  return result.stdout || ""
}

function assertFile(root, relative) {
  if (!fs.existsSync(path.join(root, relative))) {
    throw new Error(`missing ${relative} under ${root}`)
  }
}

function assertAbsent(root, relative) {
  if (fs.existsSync(path.join(root, relative))) {
    throw new Error(`unexpected ${relative} under ${root}`)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "odf-smoke-"))

try {
  // 1. Pack the package (this validates the `files` allowlist).
  const packOutput = run(npm, ["pack", "--silent"], { cwd: repoRoot }).trim()
  const tarballName = packOutput.split("\n").pop().trim()
  const tarball = path.join(repoRoot, tarballName)
  if (!fs.existsSync(tarball)) throw new Error(`npm pack did not produce ${tarball}`)
  console.log(`packed ${tarballName}`)

  // 2. Install the tarball like a user would.
  const project = path.join(tmp, "project")
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "odf-smoke", private: true }))
  run(npm, ["install", "--no-audit", "--no-fund", tarball], { cwd: project })

  const packDir = path.join(project, "node_modules", "odf-agent-team")
  for (const required of [
    "odf-registry.json",
    "install.sh",
    "install.ps1",
    "bin/odf.mjs",
    "plugins/odf-delegation.ts",
    "scripts/lib/install-core.mjs",
    "docs/design-contract.md",
    "docs/expectations-contract.md",
    "skills/odf-init/SKILL.md",
  ]) {
    assertFile(packDir, required)
  }
  for (const excluded of [".github", "odd", "docs/architecture.md", "AGENTS.md"]) {
    assertAbsent(packDir, excluded)
  }

  // 3. Run the packaged CLI against a temp config dir.
  const configDir = path.join(tmp, "config", "opencode")
  run(
    process.execPath,
    [
      path.join(packDir, "bin", "odf.mjs"),
      "install", "--yes", "--source", packDir, "--config-dir", configDir, "--skip-npm", "--skip-selftest",
    ],
    { stdio: "inherit" },
  )

  for (const required of [
    "odf-registry.json",
    "plugins/odf-delegation.ts",
    "odf-plugin/runtime-boundary.ts",
    "skills/odf-init/SKILL.md",
    "agents/odoo_orchestrator.md",
    "commands/odf-new.md",
    "scripts/odf-test-runner.js",
    "bin/odf.mjs",
    "install.ps1",
  ]) {
    assertFile(configDir, required)
  }

  // 4. Doctor must agree the pack is installed.
  const doctor = run(process.execPath, [path.join(packDir, "bin", "odf.mjs"), "doctor", "--config-dir", configDir])
  if (!doctor.includes("Installed:     yes")) {
    throw new Error(`doctor did not report the install:\n${doctor}`)
  }

  console.log("installer smoke OK")
} catch (error) {
  process.stderr.write(`installer smoke FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
  for (const entry of fs.readdirSync(repoRoot)) {
    if (/^odf-agent-team-.*\.tgz$/.test(entry)) fs.rmSync(path.join(repoRoot, entry), { force: true })
  }
}
