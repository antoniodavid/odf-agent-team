import { describe, it, expect } from "vitest"
import { tokenize, parseCommand, buildOrchestratorPrompt } from "./odf-cli.js"

describe("tokenize", () => {
  it("separates positionals and flags", () => {
    const result = tokenize(["sale-discount", "Add discount", "--fast"])
    expect(result.positionals).toEqual(["sale-discount", "Add discount"])
    expect(result.flags).toEqual({ fast: true })
  })

  it("captures flag values", () => {
    const result = tokenize(["tax calculation", "--version", "18", "--module", "sale"])
    expect(result.positionals).toEqual(["tax calculation"])
    expect(result.flags).toEqual({ version: "18", module: "sale" })
  })
})

describe("parseCommand", () => {
  it("parses new with change name", () => {
    const parsed = parseCommand(["new", "sale-discount-field"])
    expect(parsed.command).toBe("odf-new")
    expect(parsed.change).toBe("sale-discount-field")
    expect(parsed.description).toBeNull()
    expect(parsed.fast).toBe(false)
  })

  it("parses new with description and fast", () => {
    const parsed = parseCommand(["new", "sale-discount-field", "Add discount", "--fast"])
    expect(parsed.command).toBe("odf-new")
    expect(parsed.change).toBe("sale-discount-field")
    expect(parsed.description).toBe("Add discount")
    expect(parsed.fast).toBe(true)
  })

  it("errors on new without name", () => {
    const parsed = parseCommand(["new"])
    expect(parsed.error).toBeDefined()
  })

  it("parses continue with specific change", () => {
    const parsed = parseCommand(["continue", "sale-discount-field"])
    expect(parsed.command).toBe("odf-continue")
    expect(parsed.change).toBe("sale-discount-field")
  })

  it("parses continue without change", () => {
    const parsed = parseCommand(["continue"])
    expect(parsed.command).toBe("odf-continue")
    expect(parsed.change).toBeNull()
  })

  it("parses status with specific change", () => {
    const parsed = parseCommand(["status", "sale-discount-field"])
    expect(parsed.command).toBe("odf-status")
    expect(parsed.change).toBe("sale-discount-field")
  })

  it("parses explore with topic", () => {
    const parsed = parseCommand(["explore", "inventory valuation methods"])
    expect(parsed.command).toBe("odf-explore")
    expect(parsed.topic).toBe("inventory valuation methods")
    expect(parsed.version).toBeNull()
    expect(parsed.module).toBeNull()
  })

  it("parses explore with version and module", () => {
    const parsed = parseCommand(["explore", "tax calculation", "--version", "18", "--module", "sale"])
    expect(parsed.command).toBe("odf-explore")
    expect(parsed.topic).toBe("tax calculation")
    expect(parsed.version).toBe(18)
    expect(parsed.module).toBe("sale")
  })

  it("errors on explore without topic", () => {
    const parsed = parseCommand(["explore"])
    expect(parsed.error).toBeDefined()
  })

  it("errors on unknown command", () => {
    const parsed = parseCommand(["fix", "bug-name"])
    expect(parsed.error).toBeDefined()
  })

  it("strips leading /odf- from command names", () => {
    const parsed = parseCommand(["/odf-new", "my-feature"])
    expect(parsed.command).toBe("odf-new")
    expect(parsed.change).toBe("my-feature")
  })
})

describe("buildOrchestratorPrompt", () => {
  it("includes command and change for new", () => {
    const prompt = buildOrchestratorPrompt({
      command: "odf-new",
      change: "my-feature",
      description: "Add feature",
      fast: true,
    })
    expect(prompt).toContain("odf-new")
    expect(prompt).toContain("my-feature")
    expect(prompt).toContain("Add feature")
    expect(prompt).toContain("true")
  })

  it("returns error message for invalid input", () => {
    const prompt = buildOrchestratorPrompt({ error: "missing name" })
    expect(prompt).toContain("missing name")
  })
})
