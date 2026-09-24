/**
 * Single source of truth for locating the ODF pack directory.
 *
 * This logic was duplicated five times with three different fallbacks (the
 * plugin's `getOdfConfigDir`, the registry validator, the test runner, the
 * metrics CLI and the design library) while `install.sh` independently resolved
 * `$ODF_DIR -> ODF_CONFIG_DIR -> $XDG_CONFIG_HOME/opencode -> ~/.config/opencode`.
 * Diverging is what let an XDG install land where the runtime never looked: the
 * installer honored XDG, the runtime hardcoded `~/.config/opencode`.
 *
 * Resolution order:
 *
 *   1. `ODF_CONFIG_DIR` (absolute) — explicit override, and the channel the
 *      project launcher uses for a project-local pack. A relative value is
 *      ignored and reported in `ignored` so the caller can warn in its own
 *      wording.
 *   2. The pack this module lives in (`<pack>/scripts/lib/config-dir.js` →
 *      `<pack>`), but only when it actually looks like a pack, i.e. it contains
 *      `odf-registry.json`. The plugin and every CLI ship inside the pack, so
 *      this resolves a global install regardless of where the base dir is (XDG
 *      or not) and a project-local `<project>/.opencode` *without* requiring the
 *      launcher that exports `ODF_CONFIG_DIR`.
 *   3. `$XDG_CONFIG_HOME/opencode` (must be absolute).
 *   4. `~/.config/opencode`.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const REGISTRY_FILENAME = "odf-registry.json"

/** The pack that ships this module: `<pack>/scripts/lib/config-dir.js`. */
const SELF_PACK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

function isAbsolutePath(value) {
  return typeof value === "string" && value.length > 0 && path.isAbsolute(value)
}

/** True when `dir` looks like a pack root (it carries the ODF registry). */
export function hasPackRegistry(dir) {
  if (!isAbsolutePath(dir)) return false
  try {
    return fs.statSync(path.join(dir, REGISTRY_FILENAME)).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve the ODF pack directory.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ packRoot?: string | null }} [options] `packRoot` overrides the
 *   self-location probe (tests use it); `null` disables the probe entirely.
 * @returns {{ dir: string, source: "ODF_CONFIG_DIR" | "pack" | "XDG_CONFIG_HOME" | "home", ignored: string }}
 */
export function resolveOdfConfigDir(env = process.env, options = {}) {
  const packRoot = options.packRoot === undefined ? SELF_PACK_ROOT : options.packRoot

  const configured = typeof env.ODF_CONFIG_DIR === "string" ? env.ODF_CONFIG_DIR.trim() : ""
  const ignored = configured && !isAbsolutePath(configured) ? configured : ""
  if (configured && !ignored) {
    return { dir: path.normalize(configured), source: "ODF_CONFIG_DIR", ignored: "" }
  }

  if (packRoot && hasPackRegistry(packRoot)) {
    return { dir: path.normalize(packRoot), source: "pack", ignored }
  }

  const xdg = typeof env.XDG_CONFIG_HOME === "string" ? env.XDG_CONFIG_HOME.trim() : ""
  if (xdg && isAbsolutePath(xdg)) {
    return { dir: path.join(xdg, "opencode"), source: "XDG_CONFIG_HOME", ignored }
  }

  return { dir: path.join(os.homedir(), ".config", "opencode"), source: "home", ignored }
}

/**
 * Other places a pack lives on this machine that are NOT `dir`.
 *
 * Used to turn "registry not found here" into an actionable message instead of
 * a bare failure.
 *
 * @param {string} dir
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function findOtherPackRoots(dir, env = process.env) {
  const candidates = []
  const xdg = typeof env.XDG_CONFIG_HOME === "string" ? env.XDG_CONFIG_HOME.trim() : ""
  if (xdg && isAbsolutePath(xdg)) candidates.push(path.join(xdg, "opencode"))
  candidates.push(path.join(os.homedir(), ".config", "opencode"))

  const current = isAbsolutePath(dir) ? path.normalize(dir) : ""
  const seen = new Set(current ? [current] : [])
  const found = []
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    if (hasPackRegistry(normalized)) found.push(normalized)
  }
  return found
}
