export interface ModuleInfo {
  name: string
  display_name: string | null
  path: string
  version: string | null
  license: string | null
  depends: string[]
}

export interface ActiveRepo {
  name: string
  branch: string | null
  modules: ModuleInfo[]
}

export interface Sources {
  active: string[]
  commented: string[]
  declared_absent: string[]
  undeclared: string[]
  active_repos: ActiveRepo[]
}

export interface ProjectInfo {
  repo: string
  branch: string | null
  modules: ModuleInfo[]
}

export interface DependencyMatrix {
  resolved: Array<{ module: string; dep: string; in_repo: string }>
  unresolved_in_sources: Array<{ module: string; dep: string }>
}

export interface EnvDetection {
  addons_yaml: string | null
  sources: Sources
  project: ProjectInfo
  dependency_matrix: DependencyMatrix
  warnings: string[]
}

export function gitBranch(dir: string): string | null
export function parsePythonList(raw: string): string[]
export function parseManifest(filePath: string): Pick<ModuleInfo, "name" | "version" | "license" | "depends"> | null
export function parseAddonsYaml(filePath: string): { active: string[]; commented: string[] }
export function detectEnv(root: string, repoDir: string): EnvDetection
