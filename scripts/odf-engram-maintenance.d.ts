export interface MaintenanceOptions {
  operation: "status" | "sync" | "consolidate" | "prune"
  all?: boolean
  confirm?: boolean
  dryRun?: boolean
  executable?: string
}

export function buildMaintenancePlan(options: MaintenanceOptions): {
  executable: string
  args: string[]
  mutates: boolean
  dry_run: boolean
}

export function runMaintenance(options: MaintenanceOptions): Record<string, unknown>
