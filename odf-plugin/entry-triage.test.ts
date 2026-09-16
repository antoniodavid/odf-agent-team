import { describe, expect, it } from "vitest"
import { classifyEntryTriage, contextRiskSignals, descriptionClarity, detectRiskSignals, predictEntryRouteShadow, type EntryTriageInput } from "./entry-triage.js"

const base = (overrides: Partial<EntryTriageInput> = {}): EntryTriageInput => ({
  command: "odf-new",
  change: "triage-test",
  description: "Add a computed discount field to sale.order.",
  ...overrides,
})

const shadowFacts = {
  expectations_approved: true,
  prior_learning: "consistent" as const,
  blast_radius: "low" as const,
  reversibility: "high" as const,
  source_authority: "complete" as const,
}

const shadowReady = (overrides: Partial<EntryTriageInput> = {}): EntryTriageInput => ({
  ...base({
    module: "sale",
    domain: "sales",
    expected_files: 3,
    expectations_clear: true,
    known_modules: ["sale", "stock"],
  }),
  ...overrides,
  shadow_context: { ...shadowFacts, ...(overrides.shadow_context || {}) },
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
    ["pii", "Store personal data of partners with privacy constraints"],
  ])("detects %s signals", (signal, description) => {
    expect(detectRiskSignals(description)).toEqual([signal])
  })

  it("returns nothing for a clean description", () => {
    expect(detectRiskSignals("Add a computed discount field.")).toEqual([])
  })
})

describe("ICE triage improvements", () => {
  it("routes a standard-config wording to the cheap DECIDE-only route without facts", () => {
    const r = classifyEntryTriage(base({ description: "Install and configure l10n_mx_edi on the instance." }))
    expect(r.level).toBe("micro")
    expect(r.work_type).toBe("standard-config")
    expect(r.needs_question).toBe(false)
  })

  it("asks an ICE question when the intent is not concrete", () => {
    const r = classifyEntryTriage(base({ description: "Make it better" }))
    expect(r.needs_question).toBe(true)
    expect(r.clarity).toBe("unclear")
    expect(r.question).toMatch(/resultado esper/)
    expect(r.question).toContain("comportamiento actual")
  })

  it("detects risk signals from the affected module name", () => {
    const r = classifyEntryTriage(base({ module: "payment-gateway", domain: "sales" }))
    expect(r.level).toBe("full")
    expect(r.work_type).toBe("feature")
    expect(r.signals).toContain("payment")
  })

  it("flags an unknown module from the project sources as a warning", () => {
    const r = classifyEntryTriage(base({
      module: "ghost_module",
      domain: "sales",
      expected_files: 2,
      expectations_clear: true,
      known_modules: ["sale", "stock"],
    }))
    expect(r.work_type).toBe("small-change")
    expect(r.warnings?.some(w => w.includes("ghost_module"))).toBe(true)
  })

  it("carries signals and clarity in every result for auditability", () => {
    const r = classifyEntryTriage(base({ module: "sale", domain: "sales", expected_files: 2, expectations_clear: true }))
    expect(r.signals).toEqual([])
    expect(r.clarity).toBe("clear")
    const risky = classifyEntryTriage(base({ description: "Expose a public API webhook endpoint." }))
    expect(risky.signals).toEqual(["public-api"])
  })

  it("normalizes valid reference-only ICE context into legacy classifier fields", () => {
    const r = classifyEntryTriage(base({
      ice_context: {
        version: 1,
        provenance: { source: "project-scan", reference: "odf/project/context.json" },
        references: [{ source: "odf-init", reference: "odf/project/config.json" }],
        metadata: {
          module: "sale",
          domain: "sales",
          expected_files: 2,
          expectations: { approved: true, reference: "odf/triage-test/expectations" },
        },
      },
    }))
    expect(r).toMatchObject({ level: "micro", work_type: "small-change", needs_question: false })
    expect(r.warnings).toBeUndefined()
  })

  it("keeps explicit flat input and approved Expectations ahead of context metadata", () => {
    const r = classifyEntryTriage(base({
      module: "stock",
      domain: "inventory",
      expected_files: 8,
      expectations_clear: false,
      ice_context: {
        provenance: { source: "project", reference: "project/profile" },
        metadata: {
          module: "sale",
          domain: "sales",
          expected_files: 1,
          expectations: { approved: true, reference: "odf/other/expectations" },
        },
      },
    }))
    expect(r).toMatchObject({ level: "standard", work_type: "feature", needs_question: false })
  })

  it("fails closed for unsafe context references", () => {
    const r = classifyEntryTriage(base({
      ice_context: {
        provenance: { source: "project", reference: "../outside/context" },
        metadata: {
          module: "sale",
          domain: "sales",
          expected_files: 1,
          expectations: { approved: true, reference: "odf/triage-test/expectations" },
        },
      },
    }))
    expect(r.needs_question).toBe(true)
    expect(r.warnings?.some(warning => warning.includes("ICE context ignored"))).toBe(true)
  })

  it("keeps missing context facts unknown instead of making a micro decision", () => {
    const r = classifyEntryTriage(base({
      ice_context: {
        provenance: { source: "project-scan", reference: "odf/project/context.json" },
        metadata: { module: "sale" },
      },
    }))
    expect(r.needs_question).toBe(true)
    expect(r.question).toContain("functional domain")
    expect(r.warnings?.some(warning => warning.includes("Expectations remain unknown"))).toBe(true)
  })
})

describe("contextRiskSignals + descriptionClarity", () => {
  it("maps conservative module/domain words to signals", () => {
    expect(contextRiskSignals("sale", "sales")).toEqual([])
    expect(contextRiskSignals("payment_gateway", "pos")).toEqual(["payment"])
    expect(contextRiskSignals("ir.rule", "security")).toEqual(["security"])
    expect(contextRiskSignals("migration_utils", "technical")).toEqual(["migration"])
  })

  it("requires a verb or object noun and enough words to be clear", () => {
    expect(descriptionClarity("Add a field")).toBe("unclear")
    expect(descriptionClarity("Add a computed discount field to sale.order.")).toBe("clear")
    expect(descriptionClarity("Some generic text about improving things around here")).toBe("unclear")
  })
})

describe("predictEntryRouteShadow", () => {
  it("predicts the existing small-change route as eligible without changing top-level triage", () => {
    const input = shadowReady()
    const result = classifyEntryTriage(input)
    expect(result).toMatchObject({ level: "micro", work_type: "small-change" })
    expect(result.shadow).toMatchObject({
      version: 1,
      mode: "shadow",
      advisory: true,
      execution_unchanged: true,
      predicted_route: "small-change",
      predicted_stages: ["DECIDE", "BUILD", "VERIFY"],
      micro_policy: "eligible",
      missing_facts: [],
      blocking_reasons: [],
    })
    expect(predictEntryRouteShadow(input)).toEqual(result.shadow)
  })

  it("blocks an unknown module while preserving the historical small-change result", () => {
    const result = classifyEntryTriage(shadowReady({ module: "ghost_module" }))
    expect(result.work_type).toBe("small-change")
    expect(result.warnings?.some(warning => warning.includes("ghost_module"))).toBe(true)
    expect(result.shadow.micro_policy).toBe("ineligible")
    expect(result.shadow.blocking_reasons).toContain("unknown module")
  })

  it("keeps missing approved Expectations unknown even when legacy clarity is true", () => {
    const result = predictEntryRouteShadow(shadowReady({ shadow_context: { ...shadowFacts, expectations_approved: undefined } }))
    expect(result.micro_policy).toBe("unknown")
    expect(result.missing_facts).toContain("approved Expectations")
  })

  it("marks standard-config as not-applicable and keeps its DECIDE-only route", () => {
    const result = predictEntryRouteShadow(base({ description: "Enable the standard configuration for stock picking defaults." }))
    expect(result).toMatchObject({
      predicted_route: "standard-config",
      predicted_stages: ["DECIDE"],
      micro_policy: "not-applicable",
    })
  })

  it("keeps bugfix unknown without explicit diagnosis evidence", () => {
    const result = predictEntryRouteShadow(base({ command: "odf-fix" }))
    expect(result.micro_policy).toBe("unknown")
    expect(result.missing_facts).toEqual(expect.arrayContaining([
      "diagnosis evidence", "root-cause evidence", "regression evidence",
    ]))
  })

  it("does not make a bugfix eligible even with diagnosis, root-cause, and regression evidence", () => {
    const result = predictEntryRouteShadow(base({
      command: "odf-fix",
      shadow_context: {
        diagnosis_evidence: true,
        root_cause_evidence: true,
        regression_evidence: true,
      },
    }))
    expect(result).toMatchObject({ predicted_route: "bugfix", micro_policy: "ineligible" })
    expect(result.blocking_reasons).toContain("FAST is restricted to the existing small-change route")
  })

  it.each([
    ["protected signal", { risk_signals: ["schema"] }, "protected risk signal"],
    ["protected domain", { shadow_context: { ...shadowFacts, protected_domains: ["accounting"] } }, "protected domain"],
    ["unknown protected signal", { shadow_context: { ...shadowFacts, protected_signals: ["project-specific-risk"] } }, "protected risk signal"],
    ["unknown protected domain", { shadow_context: { ...shadowFacts, protected_domains: ["project-specific-domain"] } }, "protected domain"],
    ["architecture signal", { shadow_context: { ...shadowFacts, architecture_signals: ["model"] } }, "architecture signal"],
    ["scope signal", { shadow_context: { ...shadowFacts, scope_signals: ["multi-module"] } }, "scope signal"],
    ["prior-learning contradiction", { shadow_context: { ...shadowFacts, prior_learning_contradiction: true } }, "contradictory prior learning"],
  ] as Array<[string, Partial<EntryTriageInput>, string]>) ("blocks %s", (_label, overrides, reason) => {
    const result = predictEntryRouteShadow(shadowReady(overrides))
    expect(result.micro_policy).toBe("ineligible")
    expect(result.blocking_reasons).toContain(reason)
  })

  it.each([
    ["high blast radius", { blast_radius: "high" as const }, "high blast radius"],
    ["low reversibility", { reversibility: "low" as const }, "low reversibility"],
    ["incomplete source authority", { source_authority: "incomplete" as const }, "incomplete source authority"],
  ] as const)("blocks %s", (_label, context, reason) => {
    const result = predictEntryRouteShadow(shadowReady({ shadow_context: { ...shadowFacts, ...context } }))
    expect(result.micro_policy).toBe("ineligible")
    expect(result.blocking_reasons).toContain(reason)
  })

  it.each([
    ["missing", { ...shadowFacts, prior_learning: undefined }],
    ["null", { ...shadowFacts, prior_learning: null as any }],
    ["malformed", { ...shadowFacts, prior_learning: "stale" as any }],
    ["unknown", { ...shadowFacts, prior_learning: "unknown" as const }],
  ])("treats %s prior learning as uncertain", (_label, context) => {
    const result = predictEntryRouteShadow(shadowReady({ shadow_context: context }))
    expect(result.micro_policy).toBe("unknown")
    expect(result.missing_facts).toContain("prior learning")
  })

  it("fails closed for malformed context", () => {
    const result = predictEntryRouteShadow(shadowReady({
      ice_context: { provenance: { source: "project", reference: "../outside/context" } },
    }))
    expect(result.micro_policy).toBe("unknown")
    expect(result.blocking_reasons).toContain("malformed context")
  })

  it("uses the explicit three-file boundary", () => {
    expect(predictEntryRouteShadow(shadowReady({ expected_files: 3 })).micro_policy).toBe("eligible")
    const four = predictEntryRouteShadow(shadowReady({ expected_files: 4 }))
    expect(four).toMatchObject({ predicted_route: "feature", micro_policy: "ineligible" })
    expect(four.blocking_reasons).toContain("predicted route is not the existing small-change route")
  })

  it("fails closed for multiple functional domains without changing single-domain behavior", () => {
    const multiple = predictEntryRouteShadow(shadowReady({ domain: "sales, inventory" }))
    expect(multiple.micro_policy).toBe("ineligible")
    expect(multiple.blocking_reasons).toContain("multiple functional domains")
    expect(predictEntryRouteShadow(shadowReady({ domain: "sales" })).micro_policy).toBe("eligible")
  })
})
