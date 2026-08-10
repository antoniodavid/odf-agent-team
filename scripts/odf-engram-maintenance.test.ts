import { describe, expect, it } from "vitest"
import { buildMaintenancePlan, runMaintenance } from "./odf-engram-maintenance.js"

describe("Engram maintenance adapter", () => {
  it("maps status to the read-only sync status command", () => {
    expect(buildMaintenancePlan({ operation: "status" })).toMatchObject({ args: ["sync", "--status"], mutates: false })
  })

  it("requires confirmation for every mutating operation", () => {
    expect(() => buildMaintenancePlan({ operation: "sync" })).toThrow("--confirm")
    expect(() => buildMaintenancePlan({ operation: "consolidate", all: true })).toThrow("--confirm")
    expect(() => buildMaintenancePlan({ operation: "prune" })).toThrow("--confirm")
  })

  it("fails closed when project scoping is unavailable", () => {
    expect(() => buildMaintenancePlan({ operation: "prune", project: "odf-agent-team", confirm: true } as any)).toThrow("project-scoped")
    expect(() => buildMaintenancePlan({ operation: "consolidate", confirm: true })).toThrow("--all")
  })

  it("uses the supported project commands and preserves dry-run", () => {
    expect(buildMaintenancePlan({ operation: "consolidate", all: true, confirm: true, dryRun: true })).toMatchObject({ args: ["projects", "consolidate", "--all", "--dry-run"] })
    expect(runMaintenance({ operation: "prune", confirm: true, dryRun: true, executable: "missing-engram" })).toMatchObject({ executed: false, status: "dry-run", args: ["projects", "prune", "--dry-run"] })
  })

  it("fails clearly when Engram is unavailable for destructive actions", () => {
    expect(() => runMaintenance({ operation: "prune", confirm: true, executable: "missing-engram" })).toThrow("Engram CLI unavailable")
  })
})
