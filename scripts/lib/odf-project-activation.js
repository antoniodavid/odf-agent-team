import fs from "node:fs"
import path from "node:path"

const ACTIVATION_DIRECTORY = ".odf"
const ACTIVATION_FILE = "project.json"
const ACTIVATION_SCHEMA_VERSION = 1

function canonicalRoot(directory) {
  const resolved = path.resolve(directory)
  try { return fs.realpathSync(resolved) } catch { return resolved }
}

function activationPath(directory) {
  return path.join(canonicalRoot(directory), ACTIVATION_DIRECTORY, ACTIVATION_FILE)
}

function isActivation(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    value.schema_version === ACTIVATION_SCHEMA_VERSION &&
    value.enabled === true &&
    value.kind === "odoo" &&
    typeof value.root === "string" &&
    typeof value.project === "string" && value.project.length > 0 &&
    typeof value.initialized_at === "string")
}

export function readProjectActivation(directory) {
  const root = canonicalRoot(directory)
  try {
    const value = JSON.parse(fs.readFileSync(activationPath(root), "utf8"))
    return isActivation(value) && canonicalRoot(value.root) === root ? value : null
  } catch {
    return null
  }
}

export function isProjectActivated(directory) {
  return readProjectActivation(directory) !== null
}

export function writeProjectActivation({ directory, project, initializedAt = new Date().toISOString() }) {
  const root = canonicalRoot(directory)
  const activation = {
    schema_version: ACTIVATION_SCHEMA_VERSION,
    enabled: true,
    kind: "odoo",
    root,
    project,
    initialized_at: initializedAt,
  }
  const directoryPath = path.dirname(activationPath(root))
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
  const temporary = path.join(directoryPath, `.project-${process.pid}-${Date.now()}.tmp`)
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(activation, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    fs.renameSync(temporary, activationPath(root))
  } finally {
    try { fs.unlinkSync(temporary) } catch { /* already renamed or absent */ }
  }
  return activation
}

export function disableProjectActivation(directory) {
  try {
    fs.rmSync(activationPath(directory), { force: true })
    return true
  } catch {
    return false
  }
}

export function projectActivationPath(directory) {
  return activationPath(directory)
}
