import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Privacy guard for the published surface.
 *
 * The website renders docs/**, and the README, AGENTS.md, CHANGELOG.md, LICENSE,
 * install.sh and the TUI installer are published from the repository root. A
 * personal home path, a real credential, or a provider email must never reach
 * them.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const FILES = [
  "README.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "LICENSE",
  "install.sh",
  "scripts/odf-install-tui.mjs",
  "docs/index.html",
  ...fs.readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`),
  ...fs.readdirSync(path.join(ROOT, "docs", "archive")).filter((f) => f.endsWith(".md")).map((f) => `docs/archive/${f}`),
]

function read(relative: string): string {
  const text = fs.readFileSync(path.join(ROOT, relative), "utf8")
  // The landing page carries inline JS; drop it so identifiers like `token`
  // and base64 payloads cannot be mistaken for credentials.
  return relative.endsWith(".html") ? text.replace(/<script[\s\S]*?<\/script>/gi, "") : text
}

const CHECKS = [
  { name: "absolute home path", pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+\// },
  { name: "Windows home path", pattern: /C:\\Users\\[A-Za-z0-9._-]+/i },
  { name: "provider email", pattern: /[A-Za-z0-9._%+-]+@(?:gmail|outlook|hotmail|yahoo|protonmail|icloud)\.[A-Za-z]{2,}/i },
  { name: "private key block", pattern: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: "GitHub token", pattern: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: "URL with credentials", pattern: /https?:\/\/[^\s/]+:[^\s@]+@/ },
  { name: "literal password", pattern: /password\s*=\s*(?!["']?<)[^\s|`)"']{6,}/i },
]

describe("published documentation privacy", () => {
  for (const file of FILES) {
    it(`${file} has no personal data or credentials`, () => {
      const text = read(file)
      const hits = CHECKS.filter((check) => check.pattern.test(text)).map((check) => check.name)
      expect(hits, `${file} contains: ${hits.join(", ")}`).toEqual([])
    })
  }
})
