export const REGISTRY_FILENAME: string
export function hasPackRegistry(dir: string): boolean
export interface OdfConfigDirResolution {
  dir: string
  source: "ODF_CONFIG_DIR" | "pack" | "XDG_CONFIG_HOME" | "home"
  /** Non-empty when ODF_CONFIG_DIR was set to a relative path and got ignored. */
  ignored: string
}
export function resolveOdfConfigDir(
  env?: NodeJS.ProcessEnv,
  options?: { packRoot?: string | null },
): OdfConfigDirResolution
export function findOtherPackRoots(dir: string, env?: NodeJS.ProcessEnv): string[]
