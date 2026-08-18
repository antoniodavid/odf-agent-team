import { describe, expect, it } from "vitest"
import { classifyEntryTriage, detectRiskSignals, type EntryTriageInput } from "./entry-triage.js"

const base = (overrides: Partial<EntryTriageInput> = {}): EntryTriageInput => ({
  command: "odf-new",
  change: "triage-test",
  description: "Add a computed discount field to sale.order.",
  ...overrides,
})

describe("classifyEntryTriage", () => {
  it("honors an explicit security work type as full and never micro", () => {
    const r = classifyEntryTriage(base({ explicit_work_type: "security" }))
    expect(r.level).toBe("full")
    expect(r.work_type).toBe("security")
    expect(r.needs_question).toBe(false)
  })

  it("classifies a migration mention in text as full", () => {
    const r = classifyEntryTriage(base({ description: "Upgrade the module for migration to Odoo 18." }))
    expect(r.level).toBe("full")
    expect(r.work_type).toBe("migration")
    expect(r.needs_question).toBe(false)
  })

  it.each([
    ["payment", "Add payment processing to the sales flow."],
    ["money", "Handle money rounding in the invoice."],
  ])("classifies a %s mention in text as full", (_label, description) => {
    const r = classifyEntryTriage(base({ description }))
    expect(r.level).toBe("full")
    expect(r.needs_question).toBe(false)
  })

  it("classifies a valid micro input as small-change", () => {
    const r = classifyEntryTriage(base({
      module: "sale",
      domain: "sales",
      expected_files: 2,
      expectations_clear: true,
    }))
    expect(r.level).toBe("micro")
    expect(r.work_type).toBe("small-change")
    expect(r.needs_question).toBe(false)
  })

  it("classifies standard-config wording as standard-config micro", () => {
    const r = classifyEntryTriage(base({
      description: "Enable the standard configuration for stock picking defaults.",
      module: "stock",
      domain: "inventory",
      expected_files: 1,
      expectations_clear: true,
    }))
    expect(r.level).toBe("micro")
    expect(r.work_type).toBe("standard-config")
  })

  it("routes /odf-fix to bugfix micro without needing extra facts", () => {
    const r = classifyEntryTriage(base({ command: "odf-fix" }))
    expect(r.level).toBe("micro")
    expect(r.work_type).toBe("bugfix")
    expect(r.needs_question).toBe(false)
  })

  it("asks one grouped question when facts are missing", () => {
    const r = classifyEntryTriage(base({}))
    expect(r.needs_question).toBe(true)
    expect(r.question).toBeTruthy()
    expect(r.question).toContain("module")
  })

  it("falls back to feature standard when data is complete but not micro-sized", () => {
    const r = classifyEntryTriage(base({
      module: "sale",
      domain: "sales",
      expected_files: 6,
      expectations_clear: true,
    }))
    expect(r.level).toBe("standard")
    expect(r.work_type).toBe("feature")
    expect(r.needs_question).toBe(false)
  })

  it("respects an explicit feature work type", () => {
    const r = classifyEntryTriage(base({
      explicit_work_type: "feature",
      module: "sale",
      domain: "sales",
      expected_files: 1,
      expectations_clear: true,
    }))
    expect(r.level).toBe("standard")
    expect(r.work_type).toBe("feature")
  })
})

describe("precedence", () => {
  it("complete /odf-fix input routes bugfix/micro with needs_question false", () => {
    const r = classifyEntryTriage(base({
      command: "odf-fix",
      description: "Fix the rounding error in sale.order --fast",
      module: "sale",
      domain: "sales",
      expected_files: 2,
      expectations_clear: true,
    }))
    expect(r.level).toBe("micro")
    expect(r.work_type).toBe("bugfix")
    expect(r.needs_question).toBe(false)
  })

  it("complete micro input (small-change) needs no question", () => {
    const r = classifyEntryTriage(base({
      command: undefined,
      module: "sale",
      domain: "sales",
      expected_files: 2,
      expectations_clear: true,
    }))
    expect(r.level).toBe("micro")
    expect(r.work_type).toBe("small-change")
    expect(r.needs_question).toBe(false)
  })

  it("ambiguous input yields exactly one grouped question", () => {
    const r = classifyEntryTriage(base({}))
    expect(r.needs_question).toBe(true)
    expect(r.question).toBeTruthy()
    expect(r.question!.split(";").filter(part => part.trim().length > 0)).toHaveLength(3)
    expect(r.question!).toContain("module")
    expect(r.question!).toContain("expected file count")
    expect(r.question!).toContain("expectations")
  })

  it("high-risk discovered escalates even with complete micro input", () => {
    const r = classifyEntryTriage(base({
      description: "Fix the rounding error and tighten access rights.",
      module: "sale",
      domain: "sales",
      expected_files: 2,
      expectations_clear: true,
    }))
    expect(r.level).toBe("full")
    expect(r.work_type).toBe("security")
    expect(r.needs_question).toBe(false)
  })
})

describe("detectRiskSignals", () => {
  it.each([
    ["security", "Add ACL rules and ir.model.access entries"],
    ["migration", "Run the module migration scripts"],
    ["payment", "Handle money in the payment flow"],
    ["public-api", "Expose a public API webhook endpoint"],
    ["data-loss", "Purge and unlink old records"],
  ])("detects %s signals", (signal, description) => {
    expect(detectRiskSignals(description)).toEqual([signal])
  })

  it("returns nothing for a clean description", () => {
    expect(detectRiskSignals("Add a computed discount field.")).toEqual([])
  })
})