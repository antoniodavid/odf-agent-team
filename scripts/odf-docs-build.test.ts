import { describe, expect, it } from "vitest"
import { createSlugger, rewriteHref, slugify } from "./odf-docs-build.js"

describe("docs site slugs", () => {
  it("matches GitHub heading anchors", () => {
    expect(slugify("Stopping safely")).toBe("stopping-safely")
    expect(slugify("Project activation")).toBe("project-activation")
    expect(slugify("Context Manifest (ICE)")).toBe("context-manifest-ice")
    expect(slugify("Native prepare/seal flow (OpenCode V2)")).toBe("native-prepareseal-flow-opencode-v2")
  })

  it("suffixes duplicate headings instead of colliding", () => {
    const slug = createSlugger()
    expect(slug("Overview")).toBe("overview")
    expect(slug("Overview")).toBe("overview-1")
    expect(slug("Overview")).toBe("overview-2")
  })
})

describe("docs site links", () => {
  const page = { src: "docs/route-contract.md", out: "route-contract.html" }

  it("rewrites documentation sources to generated pages", () => {
    expect(rewriteHref("context-contract.md", page)).toBe("context-contract.html")
    expect(rewriteHref("intended-usage.md#stopping-safely", page)).toBe("intended-usage.html#stopping-safely")
    expect(rewriteHref("../CHANGELOG.md", page)).toBe("changelog.html")
    expect(rewriteHref("archive/README.md", page)).toBe("archive/index.html")
  })

  it("keeps anchors, absolute URLs, and missing targets untouched", () => {
    expect(rewriteHref("#local-anchor", page)).toBe("#local-anchor")
    expect(rewriteHref("https://example.com/doc.md", page)).toBe("https://example.com/doc.md")
    expect(rewriteHref("does-not-exist.md", page)).toBe("does-not-exist.md")
  })

  it("points repository files at GitHub instead of a dead relative path", () => {
    expect(rewriteHref("../../command/odf-new.md", { src: "docs/archive/odf-fast-lane-plan.md", out: "archive/odf-fast-lane-plan.html" }))
      .toBe("https://github.com/antoniodavid/odf-agent-team/blob/main/command/odf-new.md")
  })

  it("never emits a raw markdown link for a registered page", () => {
    for (const href of ["route-contract.md", "context-contract.md", "decision-evaluation.md", "skill-style-guide.md"]) {
      expect(rewriteHref(href, page).endsWith(".md")).toBe(false)
    }
  })
})
