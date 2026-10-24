/**
 * Community tool detection and installation (registry-driven).
 * Extracted from plugins/odf-delegation.ts — behavior unchanged.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { tool } from "./odf-tool.js"
import { getOdfConfigDir, resolveToolWorkspaceRoot } from "./odf-delegation-shared.js"
import type { ToolContext } from "./odf-tool.js"
import { loadRegistry } from "./odf-registry-io.js"

function scopedPackagePath(packageName: string): string {
  const lastAt = packageName.lastIndexOf("@")
  return lastAt > 0 ? packageName.slice(0, lastAt) : packageName
}

export function createODFCommunityToolDetect(): ReturnType<typeof tool> {
  return tool({
    description: `Detect the status of a community tool: CLI availability and the local npm package.

Returns structured JSON with CLI path, installed version, and package status.`,
    args: {
      tool_name: tool.schema
        .string()
        .max(64)
        .describe("Community tool name from registry: codegraph"),
    },
    async execute(args: { tool_name: string }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return JSON.stringify({ status: "error", message: "ODF registry not found" })
      }

      const def = registry.community_tools?.find(t => t.name === args.tool_name)
      if (!def) {
        return JSON.stringify({ status: "error", message: `Unknown community tool "${args.tool_name}"` })
      }

      const result: Record<string, any> = {
        tool: def.name,
        title: def.title,
        package: def.package_name,
        command: def.command_name,
        cli: { available: false, path: null, version: null },
        npm: { installed: false },
      }

      // Check CLI availability
      try {
        const which = process.platform === "win32" ? "where" : "which"
        const cliPath = execFileSync(which, [def.command_name], { encoding: "utf8", timeout: 5_000 }).trim()
        if (cliPath) {
          result.cli = { available: true, path: cliPath.split("\n")[0], version: null }
          try {
            const ver = execFileSync(def.command_name, ["--version"], { encoding: "utf8", timeout: 5_000 }).trim()
            if (ver) result.cli.version = ver.split("\n")[0]
          } catch {
            // version not available
          }
        }
      } catch {
        // CLI not found
      }

      // Check npm package locally
      try {
        const pkgPath = path.join(getOdfConfigDir(), "node_modules", scopedPackagePath(def.package_name))
        await fs.access(pkgPath)
        result.npm = { installed: true }
      } catch {
        // Not installed in ODF config dir
      }

      return JSON.stringify(result, null, 2)
    },
  })
}

export function createODFCommunityToolInstall(): ReturnType<typeof tool> {
  return tool({
    description: `Install or remove a community tool (npm package); install optionally initializes a CodeGraph index.

Install runs npm install for the tool package; with codegraph and an explicit
workspace, also runs codegraph init. Remove runs npm uninstall and does not
delete project indexes. It does not modify agent instructions.`,
    args: {
      tool_name: tool.schema
        .string()
        .max(64)
        .describe("Community tool name from registry: codegraph"),
      action: tool.schema
        .enum(["install", "uninstall"])
        .optional()
        .describe("Install (default) or uninstall the package"),
      workspace_dir: tool.schema
        .string()
        .max(4096)
        .optional()
        .describe("Project directory to init codegraph index in (codegraph install only)"),
    },
    async execute(args: { tool_name: string; action?: "install" | "uninstall"; workspace_dir?: string }, toolCtx: ToolContext): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found"
      }

      const def = registry.community_tools?.find(t => t.name === args.tool_name)
      if (!def) {
        return `❌ Unknown community tool "${args.tool_name}"`
      }

      const results: string[] = []
      if (args.action === "uninstall") {
        try {
          execFileSync("npm", ["uninstall", "--no-audit", "--no-fund", scopedPackagePath(def.package_name)], {
            cwd: getOdfConfigDir(),
            encoding: "utf8",
            timeout: 120_000,
          })
          results.push(`✅ npm uninstall ${scopedPackagePath(def.package_name)} succeeded`)
        } catch (err) {
          results.push(`⚠️ npm uninstall ${scopedPackagePath(def.package_name)}: ${(err as Error).message || String(err)}`)
        }
        return results.join("\n")
      }

      // Step 1: npm install
      try {
        execFileSync("npm", ["install", "--no-audit", "--no-fund", def.package_name], {
          cwd: getOdfConfigDir(),
          encoding: "utf8",
          timeout: 120_000,
        })
        results.push(`✅ npm install ${def.package_name} succeeded`)
      } catch (err) {
        results.push(`⚠️ npm install ${def.package_name}: ${(err as Error).message || String(err)}`)
      }

      // Step 2: Init codegraph index if workspace dir provided
      const workspace = args.workspace_dir
        ? resolveToolWorkspaceRoot(args.workspace_dir, toolCtx?.directory)
        : null
      if (args.workspace_dir && !workspace) {
        results.push("⚠️ codegraph init skipped: unsafe workspace path")
      } else if (args.tool_name === "codegraph" && workspace) {
        try {
          execFileSync("codegraph", ["init", workspace], { encoding: "utf8", timeout: 60_000 })
          results.push(`✅ codegraph init ${workspace} succeeded`)
        } catch (err) {
          results.push(`⚠️ codegraph init skipped: ${(err as Error).message || String(err)}`)
        }
      }

      return results.join("\n")
    },
  })
}
