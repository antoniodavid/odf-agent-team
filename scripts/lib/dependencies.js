/**
 * Environment dependency probe (portability matrix). Single source of truth
 * for CLI-side tool availability, used by odf-toolkit deps and
 * odf-project-scan config.
 */

import { execFileSync } from "node:child_process"

export function dependencyProbe() {
  const probe = (cmd, args = ["--version"]) => {
    try {
      execFileSync(cmd, args, { stdio: "ignore", timeout: 5_000 })
      return "available"
    } catch {
      return "missing"
    }
  }
  return {
    engram_cli: probe("engram"),
    codegraph_cli: probe("codegraph"),
    git: probe("git", ["--version"]),
    node: probe("node", ["--version"]),
    docker: probe("docker", ["--version"]),
    python3: probe("python3", ["--version"]),
  }
}
