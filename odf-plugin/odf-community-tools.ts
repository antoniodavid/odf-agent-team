/**
 * Community tool detection and installation (registry-driven).
 * Extracted from plugins/odf-delegation.ts — behavior unchanged.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { tool } from "@opencode-ai/plugin"
import { getOdfConfigDir } from "./odf-delegation-shared.js"
import { loadRegistry } from "./odf-registry-io.js"

export function createODFCommunityToolDetect(): ReturnType<typeof tool> {
  return tool({
    description: `Detect the status of a community tool: CLI availability, npm package, and agent guidance wiring.

Returns structured JSON with CLI path, installed version, and agent wiring status.`,
    args: {
      tool_name: tool.schema
        .string()
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
        guidance: { configured: false },
      }

      // Check CLI availability
      try {
        const which = process.platform === "win32" ? "where" : "which"
        const cliPath = execFileSync(which, [def.command_name], { encoding: "utf8" }).trim()
        if (cliPath) {
          result.cli = { available: true, path: cliPath.split("\n")[0], version: null }
          try {
            const ver = execFileSync(def.command_name, ["--version"], { encoding: "utf8" }).trim()
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
        const pkgPath = path.join(getOdfConfigDir(), "node_modules", def.package_name.split("@")[1] || def.package_name)
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
    description: `Install a community tool (npm package) and inject guidance into ODF agent instructions.

Runs npm install for the tool package and writes the CodeGraph-style guidance block
into the orchestrator's agent instructions for lazy-init wiring.`,
    args: {
      tool_name: tool.schema
        .string()
        .describe("Community tool name from registry: codegraph"),
      workspace_dir: tool.schema
        .string()
        .optional()
        .describe("Project directory to init codegraph index in (codegraph only)"),
    },
    async execute(args: { tool_name: string; workspace_dir?: string }): Promise<string> {
      const registry = await loadRegistry()
      if (!registry) {
        return "❌ ODF registry not found"
      }

      const def = registry.community_tools?.find(t => t.name === args.tool_name)
      if (!def) {
        return `❌ Unknown community tool "${args.tool_name}"`
      }

      const results: string[] = []

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

      // Step 2: Mark installed in registry cache
      if (registry.community_tools) {
        const idx = registry.community_tools.findIndex(t => t.name === args.tool_name)
        if (idx >= 0) {
          registry.community_tools[idx].installed = true
        }
      }

      // Step 3: Init codegraph index if workspace dir provided
      if (args.tool_name === "codegraph" && args.workspace_dir) {
        try {
          execFileSync("codegraph", ["init", args.workspace_dir], { encoding: "utf8", timeout: 60_000 })
          results.push(`✅ codegraph init ${args.workspace_dir} succeeded`)
        } catch (err) {
          results.push(`⚠️ codegraph init skipped: ${(err as Error).message || String(err)}`)
        }
      }

      return results.join("\n")
    },
  })
}
