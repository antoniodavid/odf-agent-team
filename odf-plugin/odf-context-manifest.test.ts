import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  buildContextManifest,
  computeContextManifestDigest,
  CONTEXT_MANIFEST_LIMITS,
  createODFContextManifest,
} from "./odf-context-manifest.js"
import { ODF_REGISTERED_TOOLS } from "./odf-delegation-shared.js"

const candidate = "a".repeat(64)

describe("Context Manifest", () => {
  it("produces the same digest for equivalent normalized input", () => {
    const first = buildContextManifest({
      project: "demo",
      odoo_version: 18,
      module: "sale",
      domain: "sales",
      dependencies: ["stock", "sale"],
      references: { files: ["views/order.xml"], symbols: ["sale.order"], tests: ["tests/test_order.py"] },
      source_roots: ["odoo/source"],
      authority_evidence_refs: ["authority/view-1"],
      candidate_digest: candidate,
      codegraph: { status: "available", reference: "codegraph/query-1" },
    })
    const second = buildContextManifest({
      project: " demo ",
      odoo_version: 18,
      module: "sale",
      domain: "sales",
      dependencies: ["sale", "stock"],
      references: { files: ["views/order.xml"], symbols: ["sale.order"], tests: ["tests/test_order.py"] },
      source_roots: ["odoo/source"],
      authority_evidence_refs: ["authority/view-1"],
      candidate_digest: candidate.toUpperCase(),
      codegraph: { status: "indexed", reference: "codegraph/query-1" },
    })
    expect(first.manifest_digest).toBe(second.manifest_digest)
    expect(computeContextManifestDigest(first)).toBe(first.manifest_digest)
  })

  it("caps collections and drops unsafe references", () => {
    const manifest = buildContextManifest({
      project: "demo",
      odoo_version: 18,
      dependencies: Array.from({ length: 100 }, (_, index) => `dep-${index}`),
      references: { files: ["../secret", ...Array.from({ length: 100 }, (_, index) => `src/${index}.py`)] },
      source_roots: ["odoo/source"],
      authority_evidence_refs: ["evidence/1"],
      candidate_digest: candidate,
      codegraph: { status: "missing" },
    })
    expect(manifest.dependencies).toHaveLength(CONTEXT_MANIFEST_LIMITS.dependencies)
    expect(manifest.references.files.length).toBeLessThanOrEqual(CONTEXT_MANIFEST_LIMITS.references)
    expect(manifest.references.files).not.toContain("../secret")
    expect(manifest.missing_facts).toContain("references")
  })

  it("fails closed for unsafe or missing source roots", () => {
    const missing = buildContextManifest({ source_roots: undefined })
    const unsafe = buildContextManifest({ source_roots: ["/tmp/external", "../outside"] })
    const duplicate = buildContextManifest({ source_roots: ["odoo/source", "odoo/source"] })
    expect(missing.source_roots_status).toBe("missing")
    expect(missing.source_roots).toEqual([])
    expect(unsafe.source_roots_status).toBe("unsafe")
    expect(unsafe.source_roots).toEqual([])
    expect(duplicate.source_roots_status).toBe("unsafe")
    expect(duplicate.source_roots).toEqual([])
    expect(unsafe.missing_facts).toContain("authority-evidence:unsafe")
  })

  it("marks malformed and duplicate inputs as non-authoritative", () => {
    const manifest = buildContextManifest({
      project: "alice@example.com",
      dependencies: ["sale", "sale"],
      references: null,
      missing_facts: [42],
      codegraph: { status: "missing", reference: "../graph" },
    })
    expect(manifest.project).toBeNull()
    expect(manifest.missing_facts).toEqual(expect.arrayContaining(["dependencies", "references", "missing-facts", "codegraph:unsafe"]))
  })

  it("represents missing CodeGraph and source authority explicitly", () => {
    const manifest = buildContextManifest({ project: "demo", odoo_version: 18 })
    expect(manifest.codegraph).toEqual({ status: "missing", reference: null })
    expect(manifest.source_roots_status).toBe("missing")
    expect(manifest.authority_status).toBe("missing")
    expect(manifest.missing_facts).toEqual(expect.arrayContaining(["codegraph:missing", "source-roots:missing", "authority-evidence:missing"]))
  })

  it("changes the manifest digest when the candidate changes", () => {
    const first = buildContextManifest({ candidate_digest: candidate })
    const second = buildContextManifest({ candidate_digest: "b".repeat(64) })
    expect(first.candidate_digest).not.toBe(second.candidate_digest)
    expect(first.manifest_digest).not.toBe(second.manifest_digest)
  })

  it("does not persist anything", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "odf-context-manifest-"))
    try {
      expect(fs.readdirSync(directory)).toEqual([])
      buildContextManifest({ project: "demo", source_roots: ["odoo/source"] })
      expect(fs.readdirSync(directory)).toEqual([])
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it("registers a read-only tool with the plugin tool name", async () => {
    expect(ODF_REGISTERED_TOOLS).toContain("odf_context_manifest")
    const manifestTool = createODFContextManifest() as any
    expect(manifestTool.description).toContain("read-only")
    expect(manifestTool.args).not.toHaveProperty("prompt")
    expect(manifestTool.args).not.toHaveProperty("source_content")
    const output = JSON.parse(await manifestTool.execute({ project: "demo" }))
    expect(output.version).toBe(1)
    expect(output.manifest_digest).toMatch(/^[0-9a-f]{64}$/)
  })
})
