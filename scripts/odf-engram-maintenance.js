#!/usr/bin/env node
import { spawnSync } from "node:child_process"

const OPERATIONS = {
  status: { args: () => ["sync", "--status"], mutates: false },
  sync: { args: () => ["sync"], mutates: true },
  consolidate: { args: () => ["projects", "consolidate", "--all"], mutates: true },
  prune: { args: () => ["projects", "prune"], mutates: true },
}

function executableAvailable(executable) {
  const locator = process.platform === "win32" ? "where" : "which"
  return spawnSync(locator, [executable], { stdio: "ignore" }).status === 0
}

export function buildMaintenancePlan({ operation, project, all = false, confirm = false, dryRun = false, executable = "engram" }) {
  const definition = OPERATIONS[operation]
  if (!definition) throw new Error(`Unknown Engram maintenance operation: ${operation}`)
  if (project) throw new Error("Engram maintenance does not support project-scoped commands; refusing to pretend it does")
  if (operation === "consolidate" && !all) throw new Error("consolidate requires explicit --all because project scoping is unavailable")
  if (definition.mutates && !confirm) throw new Error(`${operation} requires explicit --confirm`)
  const args = definition.args()
  if (dryRun && ["consolidate", "prune"].includes(operation)) args.push("--dry-run")
  return { executable, args, mutates: definition.mutates, dry_run: dryRun }
}

export function runMaintenance(options) {
  const plan = buildMaintenancePlan(options)
  if (plan.dry_run) return { ...plan, executed: false, status: "dry-run" }
  if (plan.mutates && !executableAvailable(plan.executable)) {
    throw new Error(`Engram CLI unavailable; cannot run ${options.operation}`)
  }
  const result = spawnSync(plan.executable, plan.args, { encoding: "utf8" })
  if (result.error) throw new Error(`Engram ${options.operation} failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Engram ${options.operation} failed with exit code ${result.status}`)
  return { ...plan, executed: true, status: "ok", output: result.stdout || "" }
}

function parseArgs(argv) {
  const [operation, ...rest] = argv
  return {
    operation,
    all: rest.includes("--all"),
    confirm: rest.includes("--confirm"),
    dryRun: rest.includes("--dry-run"),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(runMaintenance(parseArgs(process.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(`odf-engram-maintenance: ${error.message}`)
    process.exitCode = 1
  }
}
