export interface InstallLogger {
  info(text: string): void
  ok(text: string): void
  warn(text: string): void
  error(text: string): void
  plain(text: string): void
}

export interface InstallOptions {
  yes: boolean
  dryRun: boolean
  force: boolean
  update: boolean
  tui: boolean
  scope: string
  project: string
  source: string
  configDir: string
  host: string
  withCodegraph: boolean
  configureMcp: boolean
  restartService: boolean
  skipNpm: boolean
  skipSelftest: boolean
  help: boolean
  version: boolean
  rawArgs: string[]
}

export interface ConfigTarget {
  mode: "global" | "project"
  projectRoot: string
  configDir: string
  projectMetaDir: string
}

export interface ResolvedSource {
  dir: string
  kind: "local"
}

export const PACKAGE_NAME: string
export const DEFAULT_REPO: string
export const DEFAULT_BRANCH: string
export const FALLBACK_VERSION: string
export const LEGACY_AUTHOR_CONFIG_DIR: string
export const STALE_ODF_PLUGIN_FILES: string[]
export const STALE_ODF_PATHS: string[]
export const REPO_ONLY_ODF_PATHS: string[]
export const INSTALL_USAGE: string

export class InstallerError extends Error {}

export function createLogger(options?: { color?: boolean; stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream }): InstallLogger
export function isFile(target: string): boolean
export function isDirectory(target: string): boolean
export function commandExists(command: string, env?: NodeJS.ProcessEnv): string
export function sha256File(file: string): string
export function readPackVersion(packRoot: string): string
export function shellQuote(value: string): string
export function parseInstallOptions(argv: string[]): InstallOptions
export function looksLikePack(dir: string): boolean
export function looksLikePackRoot(dir: string): boolean
export function resolveSource(options?: { explicitSource?: string; env?: NodeJS.ProcessEnv; cwd?: string; sourceRoot?: string }): ResolvedSource
export function resolveConfigDir(options?: { options?: Partial<InstallOptions>; env?: NodeJS.ProcessEnv; cwd?: string }): ConfigTarget
export function detectExistingInstall(configDir: string): "existing" | "new"
export function copyDirSync(src: string, dst: string, options?: { dryRun?: boolean; logger?: InstallLogger | null; skipHidden?: boolean }): void
export function createBackup(options: {
  configDir: string
  projectMode?: boolean
  projectMetaDir?: string
  dryRun?: boolean
  logger: InstallLogger
  now?: Date
}): string
export function cleanupStalePluginFiles(options: { configDir: string; dryRun?: boolean; logger: InstallLogger }): void
export function cleanupStalePaths(options: { configDir: string; dryRun?: boolean; logger: InstallLogger }): void
export function rewriteConfigPaths(options: { configDir: string; dryRun?: boolean; logger: InstallLogger }): void
export function runtimeDepsReady(configDir: string): boolean
export function runNpmInstall(options: { configDir: string; dryRun?: boolean; skipNpm?: boolean; logger: InstallLogger }): boolean
export function installFiles(options: { sourceDir: string; configDir: string; dryRun?: boolean; skipNpm?: boolean; logger: InstallLogger }): boolean
export function runSelfTest(options: {
  configDir: string
  dryRun?: boolean
  skipSelfTest?: boolean
  backupDir?: string
  logger: InstallLogger
}): boolean
export function probePluginState(): string
export function restartService(options: { dryRun?: boolean; restart?: boolean; env?: NodeJS.ProcessEnv; logger: InstallLogger }): void
export function configureMcp(options: { configDir: string; logger: InstallLogger }): void
export function probeEnvironment(logger: InstallLogger): void
export function buildProjectLauncher(options: { projectRoot: string; configDir: string }): string
export function writeProjectLauncher(options: {
  projectRoot: string
  configDir: string
  projectMetaDir: string
  dryRun?: boolean
  logger: InstallLogger
}): string
export function writeProjectLock(options: {
  configDir: string
  projectMetaDir: string
  sourceDir: string
  sourceKind?: string
  repo?: string
  branch?: string
  version: string
  dryRun?: boolean
  logger: InstallLogger
}): string
export function printSummary(options: {
  status: string
  configDir: string
  existingStatus?: string
  sourceLabel: string
  projectMode?: boolean
  launcher?: string
  lock?: string
  backupDir?: string
  version?: string
  dryRun?: boolean
  logger: InstallLogger
}): void
export function runInstall(options: {
  options: InstallOptions
  env?: NodeJS.ProcessEnv
  cwd?: string
  sourceRoot?: string
  logger?: InstallLogger
}): number
export function runDoctor(options?: {
  options?: Partial<InstallOptions>
  env?: NodeJS.ProcessEnv
  cwd?: string
  sourceRoot?: string
  logger?: InstallLogger
}): number
export function runCli(options?: {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  cwd?: string
  sourceRoot?: string
  logger?: InstallLogger
}): number
