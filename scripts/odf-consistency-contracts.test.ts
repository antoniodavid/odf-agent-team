import { describe, expect, it } from "vitest"
import fs from "node:fs"

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
    expect(designContract).toContain("Architecture Decisions (condicional)")
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
