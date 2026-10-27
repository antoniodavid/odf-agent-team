import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { matchSkills } from "../odf-plugin/odf-skills.js"

const REPO = path.resolve(__dirname, "..")
const registry = JSON.parse(fs.readFileSync(path.join(REPO, "odf-registry.json"), "utf8"))
const queries = JSON.parse(fs.readFileSync(path.join(__dirname, "odf-skill-evals", "trigger-queries.json"), "utf8")) as Array<{
  query: string
  expected: string
  files?: string[]
  version?: number
}>

describe("skill trigger evals", () => {
  it("the dataset covers the main skill families", () => {
    expect(queries.length).toBeGreaterThanOrEqual(50)
    const expected = new Set(queries.map((entry) => entry.expected))
    expect(expected.size).toBeGreaterThanOrEqual(20)
  })

  for (const entry of queries) {
    it(`matches ${entry.expected}: ${entry.query}`, () => {
      const skills = matchSkills(registry, null, {
        task: entry.query,
        files: entry.files ?? [],
        odooVersion: entry.version,
      })
      const names = skills.map((skill) => skill.name)
      expect(names.slice(0, 3)).toContain(entry.expected)
    })
  }
})
