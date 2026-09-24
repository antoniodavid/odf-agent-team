import { describe, expect, it } from "vitest"
import fs from "node:fs"
import { ODF_REGISTERED_TOOLS } from "../odf-plugin/odf-delegation-shared.js"

const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), "utf8")

const orchestrator = read("../agent/odoo_orchestrator.md")
const reviewer = read("../agent/odoo_code_reviewer.md")
const verify = read("../skills/odf-verify/SKILL.md")
const design = read("../skills/odf-design/SKILL.md")
const designContract = read("../docs/design-contract.md")

describe("cross-artifact audit contract", () => {
  it("orchestrator audits EXP/REQ/tasks before BUILD", () => {
    expect(orchestrator).toContain("Cross-artifact consistency audit")
    expect(orchestrator).toContain("scope creep")
  })
})

describe("two-axis review contract", () => {
  it("reviewer reports Standards and Spec separately", () => {
    expect(reviewer).toContain("## Standards")
    expect(reviewer).toContain("## Spec")
    expect(reviewer).toContain("Scope creep")
  })

  it("verify lenses cover both axes", () => {
    expect(verify).toContain("two separate axes")
    expect(verify).toContain("**Spec**")
  })
})

describe("ADR-lite contract", () => {
  it("design records only decisions meeting the three-condition test", () => {
    expect(design).toContain("hard to reverse")
    expect(design).toContain("surprising without context")
    expect(design).toContain("real trade-off")
    expect(designContract).toContain("Architecture Decisions (conditional)")
  })
})

const fix = read("../skills/odf-fix/SKILL.md")
const qa = read("../skills/odf-qa/SKILL.md")
const init = read("../skills/odf-init/SKILL.md")
const assess = read("../skills/odf-assess/SKILL.md")

describe("engineering-quality contracts", () => {
  it("fix runs the full diagnosis discipline", () => {
    expect(fix).toContain("MINIMISE")
    expect(fix).toContain("HYPOTHESES")
    expect(fix).toContain("[DEBUG-xxxx]")
  })

  it("qa declares seams before scenarios and API fixtures", () => {
    expect(qa).toContain("Seams before scenarios")
    expect(qa).toContain("Integration fixtures")
  })

  it("design requires deep modules and prototype stays throwaway", () => {
    expect(design).toContain("Deep modules")
    expect(design).toContain("deletion test")
  })

  it("project context carries principles and glossary", () => {
    expect(init).toContain("project_context")
    expect(init).toContain("glossary")
    expect(assess).toContain("project glossary")
  })
})

const dba = read("../agent/odoo_dba_devops.md")
const migrator = read("../agent/odoo_upgrade_migrator.md")
const explore = read("../skills/odf-explore/SKILL.md")
const styleGuide = read("../docs/skill-style-guide.md")
const implement = read("../skills/odf-implement/SKILL.md")

describe("operations contracts", () => {
  it("dba generates wizards for human-only steps", () => {
    expect(dba).toContain("Manual Runbooks (Wizard)")
    expect(dba).toContain("bash wizard")
  })

  it("migrator sequences wide refactors and resolves conflicts by intent", () => {
    expect(migrator).toContain("Expand–Contract")
    expect(migrator).toContain("never abort the merge or rebase")
  })

  it("explore cites primary sources", () => {
    expect(explore).toContain("Cite sources")
    expect(explore).toContain("file:line")
  })

  it("style guide carries the writing-for-agents rules", () => {
    expect(styleGuide).toContain("Leading words")
    expect(styleGuide).toContain("Positive framing")
  })
})

describe("context wiring contract", () => {
  it("migrator charts multi-session migrations as a decision map", () => {
    expect(migrator).toContain("Decision Map")
    expect(migrator).toContain("Frontier")
  })

  it("design and implement consume project context", () => {
    expect(design).toContain("project_context.principles")
    expect(design).toContain("project_context.glossary")
    expect(implement).toContain("project_context")
  })
})

const fixCommand = read("../command/odf-fix.md")

describe("supervised-auto contracts", () => {
  it("orchestrator runs fix/small-change in supervised auto with bounded retry", () => {
    expect(orchestrator).toContain("Supervised Auto")
    expect(orchestrator).toContain("AT MOST ONE automatic relaunch")
  })

  it("fix escalates bounded multi-file fixes instead of stopping", () => {
    expect(fix).toContain("Scope escalation")
    expect(fixCommand).toContain("supervised auto")
  })
})

const readme = read("../README.md")
const agentsDoc = read("../AGENTS.md")
const docsIndex = read("../docs/README.md")
const pluginDoc = read("../docs/plugin.md")
const migrationDoc = read("../docs/opencode-v2-migration.md")

describe("documentation inventory counts", () => {
  it("tool counts match the registered tool surface", () => {
    const toolCount = ODF_REGISTERED_TOOLS.length
    for (const [name, text] of [
      ["README.md", readme],
      ["AGENTS.md", agentsDoc],
      ["docs/README.md", docsIndex],
      ["docs/plugin.md", pluginDoc],
    ] as const) {
      expect(text, `${name} should mention ${toolCount} tools`).toContain(`${toolCount} tools`)
    }
  })

  it("command counts match the command directory", () => {
    const commandDir = new URL("../command/", import.meta.url)
    const commandCount = fs.readdirSync(commandDir).filter(entry => entry.endsWith(".md")).length
    expect(readme, `README.md should mention ${commandCount} commands`).toContain(`${commandCount} commands`)
    expect(agentsDoc, `AGENTS.md should mention ${commandCount} slash command`).toContain(`${commandCount} slash command`)
    expect(migrationDoc, `migration doc should mention ${commandCount} ODF commands`).toContain(`${commandCount} ODF commands`)
  })
})
