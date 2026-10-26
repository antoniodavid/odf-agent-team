#!/usr/bin/env node
/**
 * ODF docs site builder.
 *
 * Renders every documentation source into a standalone, styled HTML page so the
 * public site never links to a raw `.md` file. It also regenerates the search
 * index and the `.nojekyll` marker that keeps GitHub Pages from reprocessing the
 * sources with a different theme.
 *
 * Usage:
 *   node scripts/odf-docs-build.js           # write pages
 *   node scripts/odf-docs-build.js --check   # fail when committed output is stale
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import MarkdownIt from "markdown-it"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DOCS = path.join(ROOT, "docs")
const SITE_NAME = "ODF Docs"
const SITE_URL = "https://antoniodavid.github.io/odf-agent-team/"
const REPO_URL = "https://github.com/antoniodavid/odf-agent-team"
const THEME_KEY = "odf-theme"

/**
 * Site navigation. Order is the reading order and drives prev/next.
 * `src` is repository-relative; `out` is docs-site-relative.
 */
const NAV = [
  { src: "docs/README.md", out: "docs.html", group: "Overview", label: "Docs index" },
  { src: "docs/intended-usage.md", out: "intended-usage.html", group: "Overview", label: "Intended usage" },
  { src: "docs/architecture.md", out: "architecture.html", group: "Overview", label: "Architecture" },
  { src: "docs/opencode-v2-migration.md", out: "opencode-v2-migration.html", group: "Overview", label: "OpenCode V2 migration" },

  { src: "docs/route-contract.md", out: "route-contract.html", group: "Contracts", label: "Route & stage" },
  { src: "docs/design-contract.md", out: "design-contract.html", group: "Contracts", label: "Design" },
  { src: "docs/expectations-contract.md", out: "expectations-contract.html", group: "Contracts", label: "Expectations" },
  { src: "docs/context-contract.md", out: "context-contract.html", group: "Contracts", label: "Context Manifest" },
  { src: "docs/safety-contract.md", out: "safety-contract.html", group: "Contracts", label: "Safety" },
  { src: "docs/judge-shadow-contract.md", out: "judge-shadow-contract.html", group: "Contracts", label: "Judge shadow" },
  { src: "docs/learning-loop-contract.md", out: "learning-loop-contract.html", group: "Contracts", label: "Learning loop" },

  { src: "docs/metrics-and-engram-maintenance.md", out: "metrics-and-engram-maintenance.html", group: "Operations", label: "Metrics & Engram" },
  { src: "docs/decision-evaluation.md", out: "decision-evaluation.html", group: "Operations", label: "Decision evaluation" },

  { src: "docs/plugin.md", out: "plugin.html", group: "Reference", label: "Plugin reference" },
  { src: "docs/skill-style-guide.md", out: "skill-style-guide.html", group: "Reference", label: "Skill style guide" },

  { src: "README.md", out: "readme.html", group: "Project", label: "README" },
  { src: "CHANGELOG.md", out: "changelog.html", group: "Project", label: "Changelog" },
  { src: "AGENTS.md", out: "agents.html", group: "Project", label: "Contributing" },

  { src: "docs/archive/README.md", out: "archive/index.html", group: "History", label: "Archive index" },
  { src: "docs/archive/harness-roadmap.md", out: "archive/harness-roadmap.html", group: "History", label: "Harness roadmap" },
  { src: "docs/archive/odf-fast-lane-plan.md", out: "archive/odf-fast-lane-plan.html", group: "History", label: "Fast-lane plan" },
  { src: "docs/archive/odf-fast-lane-tasks.md", out: "archive/odf-fast-lane-tasks.html", group: "History", label: "Fast-lane tasks" },
  { src: "docs/archive/odf-fast-lane-baseline-2026-09-13.md", out: "archive/odf-fast-lane-baseline-2026-09-13.html", group: "History", label: "Baseline 2026-09-13" },
  { src: "docs/archive/odf-fast-lane-baseline-2026-09-16.md", out: "archive/odf-fast-lane-baseline-2026-09-16.html", group: "History", label: "Baseline 2026-09-16" },
  { src: "docs/odf-linear-cycles-baseline-2026-10-01.md", out: "odf-linear-cycles-baseline-2026-10-01.html", group: "History", label: "Linear-cycles baseline" },
]

/** Diagrams stay standalone HTML; the index only needs their search metadata. */
const DIAGRAMS = [
  { title: "Phase flow & agent routing", href: "odf-agent-phase-flow.html", excerpt: "Full pipeline, fast routes, and capability routing.", keywords: "pipeline fast routes capability routing DECIDE PLAN BUILD VERIFY" },
  { title: "Harness architecture", href: "harness-architecture.html", excerpt: "Operator, orchestrator, plugin, specialist fleet, and the Odoo worktree.", keywords: "operator orchestrator plugin fleet Odoo worktree components" },
  { title: "One-call delegation efficiency", href: "delegation-flow.html", excerpt: "ODF's single resolved round-trip against the naive context loop.", keywords: "delegation single round-trip context loop efficiency" },
]

const SLUG_STRIP = /[^\p{L}\p{N}\s-]/gu

/** GitHub-compatible heading slug. */
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(SLUG_STRIP, "")
    .replace(/\s+/g, "-")
}

export function createSlugger() {
  const seen = new Map()
  return (text) => {
    const base = slugify(text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]))
}

function rel(fromOut, toOut) {
  const relPath = path.posix.relative(path.posix.dirname(fromOut), toOut)
  return relPath || path.posix.basename(toOut)
}

function baseFor(out) {
  const dir = path.posix.dirname(out)
  if (dir === ".") return ""
  return dir.split("/").map(() => "../").join("")
}

const PAGES_BY_SRC = new Map(NAV.map((page) => [page.src, page]))
const OUTPUTS = new Set(NAV.map((page) => page.out))

/**
 * Rewrite one markdown link for the generated page.
 *
 * - generated sources become local `.html` pages
 * - other repository files become GitHub blob URLs instead of dead relatives
 * - external links and anchors stay untouched
 */
export function rewriteHref(href, { src, out }) {
  if (!href || href.startsWith("#")) return href
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return href

  const match = href.match(/^([^#?]*)([?#].*)?$/)
  const target = decodeURI(match[1] || "")
  const suffix = match[2] || ""
  if (!target) return href

  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(src), target))
  const page = PAGES_BY_SRC.get(resolved)
  if (page) return rel(out, page.out) + suffix

  if (OUTPUTS.has(resolved)) return rel(out, resolved) + suffix

  const absolute = path.join(ROOT, resolved)
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
    return `${REPO_URL}/blob/main/${resolved}${suffix}`
  }
  // Some archived pages point at repository paths as if they lived under docs/.
  if (resolved.startsWith("docs/")) {
    const repoPath = resolved.slice("docs/".length)
    if (fs.existsSync(path.join(ROOT, repoPath))) {
      return `${REPO_URL}/blob/main/${repoPath}${suffix}`
    }
  }
  return href
}

function createMarkdown(current) {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false })
  const headings = []
  const slug = createSlugger()

  md.core.ruler.push("odf_headings", (state) => {
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i]
      if (token.type !== "heading_open") continue
      const inline = state.tokens[i + 1]
      const text = inline && inline.type === "inline" ? inline.content.replace(/`/g, "") : ""
      token.attrSet("id", slug(text))
      token.attrSet("tabindex", "-1")
      if (token.tag === "h2" || token.tag === "h3") {
        headings.push({ level: Number(token.tag.slice(1)), text, id: token.attrGet("id") })
      }
    }
  })

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const href = token.attrGet("href")
    if (href) token.attrSet("href", rewriteHref(href, current))
    if (href && /^(?:https?:)?\/\//.test(href)) {
      token.attrSet("target", "_blank")
      token.attrSet("rel", "noopener")
    }
    return self.renderToken(tokens, idx, options)
  }

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const id = token.attrGet("id")
    const anchor = id ? `<a class="anchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a>` : ""
    return self.renderToken(tokens, idx, options).replace(/>$/, `>${anchor}`)
  }

  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n'
  md.renderer.rules.table_close = () => "</table></div>\n"

  return { md, headings }
}

function extractTitleAndBody(tokens) {
  let title = ""
  let start = 0
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === "heading_open" && tokens[i].tag === "h1") {
      const inline = tokens[i + 1]
      title = inline && inline.type === "inline" ? inline.content.replace(/[*_`]/g, "").trim() : ""
      start = i + 3
      break
    }
  }
  return { title, body: tokens.slice(start) }
}

function plainText(tokens) {
  return tokens
    .filter((t) => t.type === "inline" || t.type === "text")
    .map((t) => t.content)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function excerptFrom(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type === "paragraph_open" && tokens[i + 1]?.type === "inline") {
      const text = plainText([tokens[i + 1]])
      if (text.length > 40) return text.slice(0, 220)
    }
  }
  return ""
}

function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in values ? String(values[key]) : ""))
}

const HEADER = `<!DOCTYPE html>
<html lang="en" data-theme="auto" data-base="{base}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} · ${SITE_NAME}</title>
  <meta name="description" content="{description}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script>(function(){var d=document.documentElement,s=localStorage.getItem("odf-theme"),m=matchMedia("(prefers-color-scheme: dark)").matches;d.dataset.theme=s||(m?"dark":"light");})();</script>
  <link rel="stylesheet" href="{base}assets/docs.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="bar">
  <div class="bar-in">
    <a class="brand" href="{base}index.html">
      <svg class="brand-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".95"/>
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".65"/>
        <rect x="16" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".35"/>
        <path d="M8 12h1M15 12h1" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      ODF <small>docs</small>
    </a>
    <div class="bar-spacer"></div>
    <nav class="bar-nav" aria-label="Sections">
      <a href="{base}index.html#whatsnew">What's new</a>
      <a href="{base}index.html#flows">Flows</a>
      <a href="{base}index.html#skills">Skills</a>
      <a href="{base}docs.html">Docs</a>
    </nav>
    <button class="searchbtn" id="openSearch" aria-label="Search documentation">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <span class="lbl">Search docs…</span>
      <kbd>/</kbd>
    </button>
    <button class="icon-btn" id="themeToggle" aria-label="Toggle dark mode" title="Toggle theme">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    </button>
    <a class="gh" href="${REPO_URL}" target="_blank" rel="noopener">GitHub ↗</a>
  </div>
</header>
<div class="shell">
  {sidebar}
  <main id="content" class="doc">
    <nav class="crumb" aria-label="Breadcrumb">
      <a href="{base}index.html">ODF</a><span>/</span><a href="{base}docs.html">Docs</a><span>/</span><span>{group}</span>
    </nav>
    <article class="prose">
      <h1>{heading}</h1>
      <p class="doc-meta">{readtime} min read</p>
      {body}
    </article>
    {pager}
  </main>
  {toc}
</div>
<div class="overlay" id="overlay" role="dialog" aria-modal="true" aria-label="Search documentation">
  <div class="palette">
    <div class="palette-input">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true" style="color:var(--ink-faint)"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input id="q" type="search" placeholder="Search docs, diagrams, contracts…" autocomplete="off" spellcheck="false">
      <kbd>esc</kbd>
    </div>
    <div class="results" id="results"></div>
    <div class="palette-foot"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span></div>
  </div>
</div>
<div class="toast" id="toast" role="status"></div>
<script src="{base}assets/docs.js"></script>
</body>
</html>
`

function sidebar(current, base) {
  let html = `<details class="side" open><summary>Documentation menu</summary><div class="side-inner"><a class="side-home" href="${base}docs.html">Documentation index</a>`
  let group = ""
  for (const page of NAV) {
    if (page.group !== group) {
      group = page.group
      html += `<p class="side-group">${escapeHtml(group)}</p>`
    }
    const active = page.out === current.out ? ' class="active" aria-current="page"' : ""
    html += `<a href="${rel(current.out, page.out)}"${active}>${escapeHtml(page.label)}</a>`
  }
  return html + `</div></details>`
}

function toc(headings) {
  const items = headings.filter((h) => h.level === 2 || h.level === 3)
  if (items.length < 3) return "<aside class=\"toc\" aria-label=\"On this page\"></aside>"
  let html = '<aside class="toc" aria-label="On this page"><p class="toc-title">On this page</p><nav>'
  for (const item of items) {
    html += `<a class="toc-l${item.level}" href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a>`
  }
  return html + "</nav></aside>"
}

function pager(current, base) {
  const index = NAV.findIndex((page) => page.out === current.out)
  const prev = index > 0 ? NAV[index - 1] : null
  const next = index >= 0 && index < NAV.length - 1 ? NAV[index + 1] : null
  const link = (page, direction) => page
    ? `<a class="pager-link ${direction}" href="${rel(current.out, page.out)}"><span>${direction === "prev" ? "Previous" : "Next"}</span><b>${escapeHtml(page.label)}</b></a>`
    : "<span></span>"
  return `<nav class="pager" aria-label="Documentation pagination">${link(prev, "prev")}${link(next, "next")}</nav>`
}

function renderPage(page) {
  const source = fs.readFileSync(path.join(ROOT, page.src), "utf8")
  const { md, headings } = createMarkdown({ src: page.src, out: page.out })
  const tokens = md.parse(source, {})
  const { title, body } = extractTitleAndBody(tokens)
  const heading = title || page.label
  const excerpt = excerptFrom(tokens)
  const rendered = md.renderer.render(body, md.options, {})
  const words = plainText(tokens).split(/\s+/).filter(Boolean).length
  const base = baseFor(page.out)
  const html = format(HEADER, {
    base,
    title: escapeHtml(heading),
    description: escapeHtml(excerpt || `${heading} — ODF documentation.`),
    group: escapeHtml(page.group),
    heading: escapeHtml(heading),
    readtime: Math.max(1, Math.round(words / 220)),
    body: rendered,
    sidebar: sidebar(page, base),
    pager: pager(page, base),
    toc: toc(headings),
  })
  return { page, html, title: heading, excerpt, keywords: headings.filter((h) => h.level === 2).map((h) => h.text).join(" · ") }
}

function searchIndex(rendered) {
  const entries = rendered.map(({ page, title, excerpt, keywords }) => ({
    title,
    href: page.out,
    kind: page.out.startsWith("archive/") ? "archive" : "doc",
    excerpt: excerpt || `${title} — ODF documentation.`,
    keywords,
  }))
  for (const diagram of DIAGRAMS) entries.push({ ...diagram, kind: "diagram" })
  return JSON.stringify(entries, null, 0) + "\n"
}

function build() {
  const rendered = NAV.map(renderPage)
  const files = new Map()
  for (const result of rendered) files.set(path.join(DOCS, result.page.out), result.html)
  files.set(path.join(DOCS, "search-index.json"), searchIndex(rendered))
  files.set(path.join(DOCS, ".nojekyll"), "")
  files.set(path.join(DOCS, "sitemap.xml"), sitemap())
  files.set(path.join(DOCS, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`)
  return files
}

function sitemap() {
  const paths = ["index.html", ...NAV.map((page) => page.out), ...DIAGRAMS.map((diagram) => diagram.href)]
  const urls = paths.map((href) => `  <url><loc>${SITE_URL}${href}</loc></url>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

function check(expected) {
  const stale = []
  for (const [file, content] of expected) {
    const actual = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null
    if (actual !== content) stale.push(path.relative(ROOT, file))
  }
  if (stale.length > 0) {
    console.error("❌ Generated docs are stale. Run `npm run docs:build` and commit the output:")
    for (const file of stale) console.error(`   - ${file}`)
    process.exit(1)
  }
  console.log(`✅ Docs site is up to date (${expected.size} files).`)
}

function write(expected) {
  for (const [file, content] of expected) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  console.log(`✅ Built ${expected.size} docs-site files.`)
}

function assertRegistered() {
  const known = new Set(NAV.map((page) => page.src))
  const found = []
  for (const entry of fs.readdirSync(DOCS)) {
    if (entry.endsWith(".md") && entry !== "README.md") found.push(`docs/${entry}`)
    if (entry === "README.md") found.push("docs/README.md")
  }
  for (const entry of fs.readdirSync(path.join(DOCS, "archive"))) {
    if (entry.endsWith(".md")) found.push(`docs/archive/${entry}`)
  }
  const missing = found.filter((file) => !known.has(file))
  if (missing.length > 0) {
    console.error("❌ Unregistered documentation sources (add them to NAV in scripts/odf-docs-build.js):")
    for (const file of missing) console.error(`   - ${file}`)
    process.exit(1)
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  assertRegistered()
  const expected = build()
  if (process.argv.includes("--check")) check(expected)
  else write(expected)
}
