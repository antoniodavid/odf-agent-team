import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import {
  LIBRARY_SCHEMA_VERSION,
  appendDesign,
  readLibrary,
  writeLibrary,
  searchDesigns,
  appendAndWrite,
  collectImplementationRounds,
  calibrateFromHistory,
} from "./odf-design-library.js"

const META = {
  change: "sale-discount-field",
  work_type: "feature",
  risk: "low",
  module_type: "inherit",
  odoo_version: 17,
  models: 2,
  fields: 3,
  views: 2,
  tasks: 6,
  exp_count: 3,
  manifest_depends: ["sale", "account"],
  module_destination: "sale",
  closed: true,
}

let tmp: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-design-library-"))
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("odf design library appendDesign", () => {
  it("append-design-shape: returns the normalized library entry with ref defaults", () => {
    const entry = appendDesign(META, { rounds_real: 18, archived_at: "2026-08-17" })
    expect(entry).toEqual({
      change: "sale-discount-field",
      design_meta: META,
      rounds_real: 18,
      design_ref: "odf/sale-discount-field/design",
      retrospective_ref: "odf/sale-discount-field/retrospective",
      archived_at: "2026-08-17",
    })
  })

  it("append-design-unknown-effort: rounds_real stays null, never invented", () => {
    expect(appendDesign(META).rounds_real).toBeNull()
    expect(appendDesign(META, { rounds_real: NaN }).rounds_real).toBeNull()
  })
})

describe("odf design library readLibrary", () => {
  it("read-library-missing-no-data: missing file yields no_data", () => {
    const lib = readLibrary(path.join(tmp, "nope.json"))
    expect(lib.data_status).toBe("no_data")
    expect(lib.designs).toEqual([])
  })

  it("read-library-invalid-no-data: corrupt JSON or missing designs array yields no_data", async () => {
    const file = path.join(tmp, "index.json")
    await fs.writeFile(file, "{not json")
    expect(readLibrary(file).data_status).toBe("no_data")
    await fs.writeFile(file, JSON.stringify({ schema_version: 1 }))
    expect(readLibrary(file).data_status).toBe("no_data")
    await fs.writeFile(file, JSON.stringify({ schema_version: 1, designs: "nope" }))
    expect(readLibrary(file).data_status).toBe("no_data")
  })
})

describe("odf design library writeLibrary", () => {
  it("write-library-roundtrip: written index reads back identical", () => {
    const file = path.join(tmp, "index.json")
    const library = { schema_version: 1, designs: [appendDesign(META, { rounds_real: 18, archived_at: "2026-08-17" })] }
    writeLibrary(file, library)
    expect(readLibrary(file)).toEqual(library)
  })
})

describe("odf design library searchDesigns", () => {
  const library = {
    schema_version: 1,
    designs: [
      appendDesign(META, { rounds_real: 18, archived_at: "2026-08-17" }),
      appendDesign(
        { ...META, change: "stock-reorder-rule", module_destination: "stock", manifest_depends: ["stock"] },
        { rounds_real: 9, archived_at: "2026-08-10" }
      ),
    ],
  }

  it("search-query-matches: ranks matches by token overlap with effort", () => {
    const { data_status, results } = searchDesigns("sale", library)
    expect(data_status).toBe("complete")
    expect(results).toHaveLength(1)
    expect(results[0].change).toBe("sale-discount-field")
    expect(results[0].rounds_real).toBe(18)
    expect(results[0].archived_at).toBe("2026-08-17")
  })

  it("search-query-multi: broad query ranks by score descending", () => {
    const { results } = searchDesigns("stock sale", library)
    expect(results.length).toBeGreaterThan(1)
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
  })

  it("search-no-library-no-data: null/empty library yields no_data", () => {
    expect(searchDesigns("sale", null as never)).toEqual({ data_status: "no_data", results: [] })
    expect(searchDesigns("sale", { schema_version: 1, designs: [] })).toEqual({ data_status: "no_data", results: [] })
  })
})

describe("odf design library appendAndWrite", () => {
  it("append-dedupe-by-change: appending the same change updates instead of duplicating", () => {
    const file = path.join(tmp, "index.json")
    appendAndWrite(file, META, { rounds_real: 18 })
    appendAndWrite(file, { ...META, fields: 4 }, { rounds_real: 24 })
    const lib = readLibrary(file)
    expect(lib.designs).toHaveLength(1)
    expect(lib.designs[0].rounds_real).toBe(24)
    expect(lib.designs[0].design_meta.fields).toBe(4)
    expect(lib.schema_version).toBe(1)
  })
})

describe("odf design library calibration (A3)", () => {
  it("collect-impl-rounds: sums completed IMPLEMENT durations into rounds", () => {
    const records = [
      { phase: "IMPLEMENT", status: "ok", duration_ms: 540000 },
      { phase: "IMPLEMENT", status: "ok", duration_ms: 540000 },
      { phase: "DESIGN", status: "ok", duration_ms: 540000 },
      { phase: "IMPLEMENT", status: "error", duration_ms: 900000 },
    ]
    const r = collectImplementationRounds(records, { minutes_per_round: 3 })
    expect(r.data_status).toBe("complete")
    expect(r.rounds_real).toBe(6)
    expect(r.duration_ms).toBe(1080000)
    expect(r.record_count).toBe(2)
  })

  it("collect-impl-rounds-no-data: no completed IMPLEMENT records yields no_data", () => {
    expect(collectImplementationRounds([], { minutes_per_round: 3 })).toMatchObject({
      rounds_real: null,
      data_status: "no_data",
    })
    expect(collectImplementationRounds([{ phase: "VERIFY", status: "ok", duration_ms: 5000 }])).toMatchObject({
      data_status: "no_data",
    })
    expect(collectImplementationRounds([{ phase: "IMPLEMENT", status: "error", duration_ms: 5000 }])).toMatchObject({
      data_status: "no_data",
    })
  })

  it("calibrate-from-history: derives per-bucket rates from real rounds", () => {
    const library = {
      schema_version: 1,
      designs: [
        appendDesign({ ...META, change: "a", models: 2, tasks: 4 }, { rounds_real: 10, archived_at: "2026-08-01" }),
        appendDesign({ ...META, change: "b", models: 4, tasks: 8 }, { rounds_real: 20, archived_at: "2026-08-02" }),
        appendDesign({ ...META, change: "c", work_type: "migration", models: 2, tasks: 4 }, { rounds_real: 40, archived_at: "2026-08-03" }),
      ],
    }
    const c = calibrateFromHistory(library)
    expect(c.data_status).toBe("complete")
    expect(c.buckets).toHaveLength(2)
    const feature = c.buckets.find((b) => b.work_type === "feature")
    expect(feature!.n).toBe(2)
    expect(feature!.rounds_per_model).toBe(5)
    expect(feature!.rounds_per_task).toBe(2.5)
    expect(feature!.sigma).toBeGreaterThan(0)
    const migration = c.buckets.find((b) => b.work_type === "migration")
    expect(migration!.n).toBe(1)
    expect(migration!.rounds_per_model).toBe(20)
  })

  it("calibrate-no-data: empty library yields no_data", () => {
    expect(calibrateFromHistory({ schema_version: 1, designs: [] })).toMatchObject({
      buckets: [],
      data_status: "no_data",
    })
    expect(calibrateFromHistory(null as never)).toMatchObject({ buckets: [], data_status: "no_data" })
  })

  it("calibrate-skips-unknown-effort: entries without rounds_real do not pollute buckets", () => {
    const c = calibrateFromHistory({
      schema_version: 1,
      designs: [appendDesign(META)],
    })
    expect(c.data_status).toBe("no_data")
    expect(c.buckets).toEqual([])
  })
})

describe("odf design library schema", () => {
  it("schema-versioned: exports a stable version and persists it", () => {
    expect(LIBRARY_SCHEMA_VERSION).toBe(1)
    const file = path.join(tmp, "index.json")
    appendAndWrite(file, META, { rounds_real: 18 })
    expect(readLibrary(file).schema_version).toBe(1)
  })
})
