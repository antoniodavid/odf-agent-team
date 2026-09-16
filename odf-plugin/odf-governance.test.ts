import { afterEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { execFileSync } from "node:child_process"
import YAML from "yaml"
import {
  createODFGovernanceCheck,
  createODFGovernanceProvenance,
  inspectOcaGovernance,
  recordAiProvenance,
} from "./odf-governance.js"
import { ODF_REGISTERED_TOOLS } from "./odf-delegation-shared.js"

const workspaces: string[] = []

async function gitWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "odf-oca-governance-"))
  workspaces.push(workspace)
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workspace })
  execFileSync("git", ["config", "user.email", "tests@example.invalid"], { cwd: workspace })
  execFileSync("git", ["config", "user.name", "ODF Tests"], { cwd: workspace })
  await fs.writeFile(path.join(workspace, "README.md"), "base\n", "utf8")
  execFileSync("git", ["add", "README.md"], { cwd: workspace })
  execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace })
  return workspace
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(workspace => fs.rm(workspace, { recursive: true, force: true })))
})

describe("OCA AI provenance", () => {
  it("merges records and rejects traversal and secret-like values", async () => {
    const workspace = await gitWorkspace()
    const first = recordAiProvenance(workspace, {
      target: "oca",
      phase: "IMPLEMENT",
      agent: "odoo_backend_engineer",
      model: "openai/gpt-5",
      files: ["README.md"],
    })
    const second = recordAiProvenance(workspace, {
      target: "oca",
      phase: "VERIFY",
      agent: "odoo_qa_engineer",
      model: "anthropic/claude",
      files: ["README.md", "tests/example.py"],
    })

    expect(first.records).toHaveLength(1)
    expect(second.records).toHaveLength(2)
    expect(JSON.parse(await fs.readFile(path.join(workspace, ".odf/ai-provenance.json"), "utf8")).records).toHaveLength(2)
    expect(() => recordAiProvenance(workspace, {
      target: "oca", phase: "IMPLEMENT", agent: "agent", model: "model", files: ["../outside.txt"],
    })).toThrow("unsafe file path")
    expect(() => recordAiProvenance(workspace, {
      target: "oca", phase: "IMPLEMENT", agent: "agent", model: "sk-secret-value", files: [],
    })).toThrow("unsafe")
  })

  it("writes through the registered tool without recording approval", async () => {
    const workspace = await gitWorkspace()
    const output = JSON.parse(await createODFGovernanceProvenance().execute({
      target: "oca",
      phase: "IMPLEMENT",
      agent: "odoo_backend_engineer",
      model: "openai/gpt-5",
      files: ["README.md"],
      workspace_dir: workspace,
    } as any, {} as any) as string)
    expect(output.status).toBe("ok")
    expect(output.path).toBe(".odf/ai-provenance.json")
    expect(output).not.toHaveProperty("human_acknowledged")
  })
})

describe("OCA governance check", () => {
  it("reports diff, recommends trailers, and rejects AI Co-authored-by", async () => {
    const workspace = await gitWorkspace()
    await fs.writeFile(path.join(workspace, "README.md"), "base\nchanged\n", "utf8")
    recordAiProvenance(workspace, {
      target: "oca",
      phase: "IMPLEMENT",
      agent: "odoo_backend_engineer",
      model: "openai/gpt-5",
      files: ["README.md"],
    })

    const disclosed = inspectOcaGovernance(workspace, "Assisted-by: openai/gpt-5\nCo-authored-by: Human <human@example.invalid>")
    expect(disclosed.diff.files).toContain("README.md")
    expect(disclosed.diff.changed_lines).toBe(1)
    expect(disclosed.provenance.present).toBe(true)
    expect(disclosed.trailers.assisted_by).toEqual(["openai/gpt-5"])
    expect(disclosed.trailers.ai_coauthored_by).toEqual([])
    expect(disclosed.human_ack_required).toBe(true)
    expect(disclosed).not.toHaveProperty("human_acknowledged")
    expect(disclosed.pr_disclosure_template).toContain("Assisted-by: openai/gpt-5")

    const invalid = inspectOcaGovernance(workspace, "Co-authored-by: Claude <claude@example.invalid>")
    expect(invalid.status).toBe("blocked")
    expect(invalid.trailers.ai_coauthored_by).toEqual(["Claude <claude@example.invalid>"])
  })

  it("warns when provenance is absent and keeps human actions unresolved", async () => {
    const workspace = await gitWorkspace()
    const result = inspectOcaGovernance(workspace, "")
    expect(result.status).toBe("warning")
    expect(result.provenance.present).toBe(false)
    expect(result.trailers.recommendations.join(" ")).toContain("record provenance")
    expect(result.human_actions_required).toHaveLength(2)
  })

  it("registers the tools and machine-readable profile", async () => {
    const registry = JSON.parse(await fs.readFile(path.join(process.cwd(), "odf-registry.json"), "utf8"))
    const skill = registry.skills.find((entry: { name: string }) => entry.name === "odf-oca-governance")
    const rules = YAML.parse(await fs.readFile(path.join(process.cwd(), "policies/oca/rules.yaml"), "utf8"))
    expect(ODF_REGISTERED_TOOLS).toEqual(expect.arrayContaining(["odf_governance_provenance", "odf_governance_check"]))
    expect(createODFGovernanceCheck().description).toContain("Read-only")
    expect(skill).toMatchObject({
      path: "skills/odf-oca-governance/SKILL.md",
      odoo_versions: [14, 15, 16, 17, 18, 19],
      sdd_phase: null,
    })
    expect(rules).toMatchObject({ id: "oca-governance-v1", target: "oca", human_ack_required: true })
    expect(rules.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "assisted-by-trailer" }),
      expect.objectContaining({ id: "no-ai-coauthored-by" }),
    ]))
  })
})
