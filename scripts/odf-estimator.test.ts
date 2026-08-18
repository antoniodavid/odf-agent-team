import { describe, expect, it } from "vitest"
import {
  ESTIMATOR_SCHEMA_VERSION,
  deriveDesignMeta,
  similarity,
  estimateFromHistory,
  roundsFromDurationMs,
} from "./odf-estimator.js"

const DESIGN_DOC = `# Design

## Context
- module: sale
- module_type: inherit
- odoo_version: 17
- manifest_depends: ["sale", "account"]

## Resolución de EXP-XX
| EXP-01 | Modelo A |
| EXP-02 | Campo x |
| EXP-03 | Vista |

## 3. Data model
_name = "sale.order.ext"
_name = "sale.order.line.ext"

| Campo | Tipo | required |
| name | Char | no |
| amount | Float | no |
| state | Selection | no |

## 4. Vistas
| Vista | Tipo | Modelo |
| sale_view_form | form | sale.order.ext |
| sale_view_tree | tree | sale.order.ext |

## 5. Seguridad
| group_id | permisos |

## Plan de IMPLEMENT
| Task | Archivo |
| T1 | models/a.py |
| T2 | models/a.py |
| T3 | models/a.py |
| T4 | models/a.py |
| T5 | models/a.py |
| T6 | models/a.py |
`

const BASE_META = {
  change: "test-change",
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

describe("odf estimator deriveDesignMeta", () => {
  it("deriveDesignMeta-from-document: derives correct counts from a closed design doc", () => {
    const { meta, reason } = deriveDesignMeta(DESIGN_DOC)
    expect(reason).toBeUndefined()
    expect(meta).toMatchObject({
      models: 2,
      fields: 3,
      views: 2,
      tasks: 6,
      exp_count: 3,
      module_type: "inherit",
      odoo_version: 17,
      manifest_depends: ["sale", "account"],
      module_destination: "sale",
      closed: true,
    })
  })

  it("deriveDesignMeta-empty: empty document yields meta null + reason", () => {
    expect(deriveDesignMeta("")).toEqual({ meta: null, reason: "empty document" })
    expect(deriveDesignMeta(null)).toEqual({ meta: null, reason: "empty document" })
    expect(deriveDesignMeta({})).toEqual({ meta: null, reason: "empty document" })
  })

  it("deriveDesignMeta-structured: reuses already-structured counts when present", () => {
    const { meta } = deriveDesignMeta(BASE_META)
    expect(meta).toMatchObject({ models: 2, tasks: 6, closed: true })
  })
})

describe("odf estimator similarity", () => {
  it("similarity-categories: same work_type/risk/module_type scores high; different work_type low", () => {
    const same = similarity(BASE_META, { ...BASE_META, change: "other" })
    expect(same).toBeGreaterThan(0.9)
    const diff = similarity(BASE_META, { ...BASE_META, work_type: "migration" })
    expect(diff).toBeLessThan(same)
    // work_type is a hard high-weight filter: dropping it cuts a large share.
    expect(diff).toBeLessThan(0.8)
  })

  it("similarity-counters: fields 5 vs 6 closer than 5 vs 60 (log-scaled)", () => {
    const near = similarity(BASE_META, { ...BASE_META, fields: 5 })
    const far = similarity(BASE_META, { ...BASE_META, fields: 60 })
    expect(near).toBeGreaterThan(far)
  })

  it("similarity-text: manifest_depends overlap affects score", () => {
    const full = similarity(BASE_META, { ...BASE_META, manifest_depends: ["sale", "account"] })
    const none = similarity(BASE_META, { ...BASE_META, manifest_depends: ["stock"] })
    expect(full).toBeGreaterThan(none)
  })
})

describe("odf estimator estimateFromHistory", () => {
  const historyEntry = (over = {}) => ({
    change: "h",
    design_meta: { ...BASE_META, change: "h", ...over },
    rounds_real: 18,
  })

  it("estimate-from-history: complete estimate with total_rounds, wallclock, confidence", () => {
    const result = estimateFromHistory(BASE_META, [
      historyEntry(),
      historyEntry({ change: "h2", rounds_real: 24 }),
    ])
    expect(result.data_status).toBe("complete")
    expect(result.estimate).toBeTruthy()
    expect(result.estimate!.total_rounds).toBeGreaterThan(0)
    expect(result.estimate!.wallclock_min).toBe(result.estimate!.total_rounds * 3)
    expect(result.estimate!.confidence.n).toBe(2)
    expect(result.matching).toHaveLength(2)
    expect(result.score_label).toContain("2")
  })

  it("estimate-no-history: empty bucket yields no_data/N/A, never a number", () => {
    const result = estimateFromHistory(BASE_META, [historyEntry({ work_type: "migration" })])
    expect(result).toEqual({ data_status: "no_data", estimate: null, score_label: "N/A" })
  })

  it("estimate-empty-history: empty/non-array history yields no_data/N/A", () => {
    expect(estimateFromHistory(BASE_META, [])).toEqual({ data_status: "no_data", estimate: null, score_label: "N/A" })
    expect(estimateFromHistory(BASE_META, null as never)).toEqual({ data_status: "no_data", estimate: null, score_label: "N/A" })
  })

  it("estimate-duration-history: derives rounds from duration_ms when rounds_real absent", () => {
    const result = estimateFromHistory(BASE_META, [
      { change: "h", design_meta: BASE_META, duration_ms: 540000 },
    ])
    expect(result.data_status).toBe("complete")
    expect(result.matching![0].rounds_real).toBe(3)
  })

  it("honest-no-invent: without data never returns a numeric estimate", () => {
    const empty = estimateFromHistory(BASE_META, [])
    const none = estimateFromHistory(null as never, [historyEntry()])
    expect(empty.estimate).toBeNull()
    expect(none.estimate).toBeNull()
    expect(empty.score_label).toBe("N/A")
    expect(none.data_status).toBe("no_data")
  })
})

describe("odf estimator roundsFromDurationMs", () => {
  it("rounds-from-duration: 540000ms at 3min/round -> 3 rounds", () => {
    expect(roundsFromDurationMs(540000, 3)).toBe(3)
  })

  it("rounds-from-duration: defaults to 3 min/round", () => {
    expect(roundsFromDurationMs(540000)).toBe(3)
  })
})

describe("odf estimator schema", () => {
  it("exports a stable schema version", () => {
    expect(ESTIMATOR_SCHEMA_VERSION).toBe(1)
  })
})
