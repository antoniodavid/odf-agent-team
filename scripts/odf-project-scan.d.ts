import type { EnvDetection } from "./odf-env-detect.js"

export interface ProjectModule {
  name: string
  path: string
  version: string | null
  license: string | null
  depends: string[]
}

export interface ScanConfig {
  project_name: string
  odoo_version: number | null
  modules: ProjectModule[]
  environment: {
    type: "doodba" | null
    workspace_root: string
    addons_yaml: string | null
    compose: { file: string; service: string; db: string | null; image: string | null } | null
    sources: EnvDetection["sources"]
  }
  testing: { test_command: string | null; test_db: string | null }
  linting: { pre_commit: boolean; ruff: boolean; pylint_odoo: boolean; eslint: boolean; prettier: boolean }
  flags: { oca_mode: boolean }
  conventions: { git_branch: string | null; git_remote: string | null; git_dirty: boolean | null }
  codegraph: { indexed: boolean; cli_available: boolean; root: string; paths: string[]; last_sync: string | null }
  dependency_matrix: EnvDetection["dependency_matrix"]
  dependencies: import("./lib/dependencies.js").DependencyProbe
  warnings: string[]
  scan_checksum: string
  scanned_at: string
}

export function computeChecksum(inputs: string[]): string
export function resolveRepoArg(root: string, repoArg: string): string
export function compactForPersist(config: ScanConfig): ScanConfig
export function indexActiveSources(config: ScanConfig, workspaceRoot: string, runner?: (dir: string) => string): { indexed: string[]; errors: string[] }
export function buildConfig(workspaceRoot: string, repoDir: string, opts?: { odooVersion?: number | null }): ScanConfig
export function classifyExit(config: ScanConfig): 0 | 1 | 2
export function diffConfigs(cached: ScanConfig | null, fresh: ScanConfig): string[]
export function readPersistedConfig(project: string): ScanConfig | null
export function renderSummary(config: ScanConfig): string
