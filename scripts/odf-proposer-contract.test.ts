import { describe, expect, it } from "vitest"
import fs from "node:fs"
import YAML from "yaml"

const proposerPath = new URL("../agent/odoo_proposer.md", import.meta.url)
const proposer = fs.readFileSync(proposerPath, "utf8")
const frontmatter = YAML.parse(proposer.match(/^---\n([\s\S]*?)\n---/)?.[1] || "")

describe("odoo proposer persistence contract", () => {
  it("allows OpenSpec writes without enabling bash", () => {
    expect(frontmatter.permission.edit).toBe("allow")
    expect(frontmatter.permission.bash).toBe("deny")
  })

  it("requires persistence before returning the phase result", () => {
    expect(proposer).toContain("Persist the complete proposal before returning.")
    expect(proposer).toContain("Do not return `ok` with proposal prose only.")
    expect(proposer).toContain("artifacts_saved")
  })
})
