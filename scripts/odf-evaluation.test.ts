import { describe, expect, it, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { evaluateOffline, evaluateOnline, main } from "./odf-evaluation.js"

let temporaryFiles: string[] = []

afterEach(async () => {
  await Promise.all(temporaryFiles.map(file => fs.rm(file, { recursive: true, force: true })))
  temporaryFiles = []
})

describe("odf evaluation", () => {
  it("evaluates reproducible fixtures without a provider", () => {
    const result = evaluateOffline([
      { name: "ok", record: { status: "ok", agent: "backend" }, expect: { status: "ok", agent: "backend" } },
      { name: "bad", record: { status: "error" }, expect: { status: "ok" } },
    ])
    expect(result).toMatchObject({ mode: "offline", total: 2, passed: 1, failed: 1, score: 0.5 })
  })

  it("evaluates observed metric records using the existing dashboard aggregation", () => {
    expect(evaluateOnline([
      { agent: "backend", status: "ok", duration_ms: 1, token_estimate: 1 },
      { agent: "backend", status: "error", duration_ms: 1, token_estimate: 1 },
    ])).toMatchObject({ mode: "online", total: 2, errors: 1, error_rate: 0.5, score: 0.5 })
  })

  it("loads the CLI module path and evaluates a fixture file", async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "odf-eval-")), "fixture.json")
    temporaryFiles.push(path.dirname(file))
    await fs.writeFile(file, JSON.stringify([{ record: { status: "ok" }, expect: { status: "ok" } }]))
    expect(main(["offline", file])).toMatchObject({ mode: "offline", passed: 1, score: 1 })
  })
})
