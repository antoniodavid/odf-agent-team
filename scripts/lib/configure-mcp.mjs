#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const [configPath, backupDir = path.join(path.dirname(configPath || "."), "backups")] = process.argv.slice(2)

function stop(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

if (!configPath) stop("MCP configuration not changed: missing opencode.json path.")

const jsoncPath = path.join(path.dirname(configPath), "opencode.jsonc")
if (fs.existsSync(jsoncPath)) {
  stop(`MCP configuration not changed: JSONC config detected at ${jsoncPath}. Edit that file manually or convert it to strict JSON before rerunning --configure-mcp.`)
}

const exists = fs.existsSync(configPath)
let config = { $schema: "https://opencode.ai/config.json" }

if (exists) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  } catch {
    stop(`MCP configuration not changed: ${configPath} is not strict JSON (comments and trailing commas require a JSONC parser). Edit it manually or convert it to strict JSON before rerunning --configure-mcp.`)
  }
}

if (!isRecord(config)) stop(`MCP configuration not changed: ${configPath} must contain a JSON object.`)

let mcp = config.mcp
if (mcp === undefined) {
  mcp = {}
  config.mcp = mcp
} else if (!isRecord(mcp)) {
  stop(`MCP configuration not changed: ${configPath} has an invalid mcp object. Edit it manually.`)
}

const nativeV2 = Object.prototype.hasOwnProperty.call(mcp, "servers")
let servers = mcp
if (nativeV2) {
  if (!isRecord(mcp.servers)) stop(`MCP configuration not changed: ${configPath} has an invalid mcp.servers object. Edit it manually.`)
  servers = mcp.servers
}

function mergeServer(name, values) {
  if (servers[name] !== undefined && !isRecord(servers[name])) {
    stop(`MCP configuration not changed: ${configPath} has an invalid mcp server entry for ${name}. Edit it manually.`)
  }
  servers[name] = { ...(servers[name] || {}), ...values }
}

mergeServer("context7", nativeV2
  ? { type: "remote", url: "https://mcp.context7.com/mcp", disabled: false }
  : { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true })

const engramAvailable = spawnSync("engram", ["mcp", "--help"], { stdio: "ignore", timeout: 5000 }).status === 0
if (engramAvailable) {
  mergeServer("engram", nativeV2
    ? { type: "local", command: ["engram", "mcp"], disabled: false }
    : { type: "local", command: ["engram", "mcp"], enabled: true })
}

if (exists) {
  fs.mkdirSync(backupDir, { recursive: true })
  const base = path.join(backupDir, "opencode.json")
  let backupPath = base
  let suffix = 1
  while (fs.existsSync(backupPath)) backupPath = `${base}.${suffix++}`
  fs.copyFileSync(configPath, backupPath)
}

fs.mkdirSync(path.dirname(configPath), { recursive: true })
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
process.stdout.write(`configured ${nativeV2 ? "V2 mcp.servers" : "V1 mcp"}`)
