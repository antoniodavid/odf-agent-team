export interface TuiComponent {
  name: string
  label: string
  desc: string
  default: boolean
}

export const COMPONENTS: TuiComponent[]
export const CONFIG_DIR: string
export const REPO_ONLY_ODF_PATHS: string[]
export const STALE_ODF_PATHS: string[]
export const STALE_ODF_PLUGIN_FILES: string[]
export function cleanupStalePackPaths(): void
export function cleanupStalePluginFiles(): void
export function installFiles(srcDir: string, components: string[]): number
