#!/usr/bin/env node
/**
 * ODF Skill Validator
 *
 * Validates every skill registered in odf-registry.json against the Agent Skills
 * format and the ODF compact-rule contract.
 *
 * Errors fail the run. Warnings report migration debt and pass unless --strict.
 *
 * Usage:
 *   node scripts/odf-skill-validate.js [--json] [--strict] [--quiet]
 */

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import YAML from "yaml"
import { resolveOdfConfigDir } from "./lib/config-dir.js"

const SPEC_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"])
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ABSOLUTE_REF_RE = /(?:~\/\.config|~\/Documents|~\/Workspace|\/home\/|\/Users\/)/
const BANNER_RE = /[╔╗╚╝║═]/

function getConfigDir() {
  const resolved = resolveOdfConfigDir(process.env)
  if (resolved.ignored) {
    console.warn(`ODF_CONFIG_DIR "${resolved.ignored}" is not absolute; using default.`)
  }
  return resolved.dir
}

function resolveEntry(registryDir, entryPath, configDir) {
  if (typeof entryPath !== "string" || !entryPath) return ""
  if (entryPath.split(/[\\/]/).includes("..")) return ""
  let resolved
  if (path.isAbsolute(entryPath)) resolved = path.normalize(entryPath)
  else if (entryPath.startsWith("~/")) resolved = path.normalize(path.join(os.homedir(), entryPath.slice(2)))
  else resolved = path.resolve(registryDir, entryPath)
  const roots = [path.normalize(registryDir), path.normalize(configDir)]
  if (!roots.some(root => resolved === root || resolved.startsWith(root + path.sep))) return ""
  return resolved
}

function splitFrontmatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return null
  const end = text.indexOf("\n---", 3)
  if (end === -1) return null
  const raw = text.slice(text.indexOf("\n") + 1, end)
  const after = text.slice(end + 4)
  return { raw, body: after.replace(/^\r?\n/, "") }
}

function validateSkill(skill, registryDir, configDir) {
  const errors = []
  const warnings = []
  const addError = (check, message) => errors.push({ check, skill: skill.name, message })
  const addWarning = (check, message) => warnings.push({ check, skill: skill.name, message })

  const resolved = resolveEntry(registryDir, skill.path, configDir)
  if (!resolved) {
    addError("path-invalid", `path is missing or escapes the allowed roots: ${skill.path}`)
    return { errors, warnings }
  }
  if (!fs.existsSync(resolved)) {
    addError("path-missing", `file does not exist: ${skill.path}`)
    return { errors, warnings }
  }
  if (!fs.statSync(resolved).isFile()) {
    addError("path-not-file", `path is not a file: ${skill.path}`)
    return { errors, warnings }
  }

  const text = fs.readFileSync(resolved, "utf8")
  const isSkillFile = path.basename(resolved).toLowerCase() === "skill.md"
  const split = splitFrontmatter(text)
  if (!split) {
    addError("frontmatter-missing", "SKILL.md must start with YAML frontmatter")
    return { errors, warnings }
  }

  let data
  try {
    data = YAML.parse(split.raw) ?? {}
  } catch (error) {
    addError("frontmatter-invalid", `frontmatter is not valid YAML: ${error.message}`)
    return { errors, warnings }
  }

  const name = typeof data.name === "string" ? data.name.trim() : ""
  if (!name) addError("name-missing", "frontmatter.name is required")
  else if (name.length > 64) addError("name-invalid", `name exceeds 64 characters: ${name.length}`)
  else if (!NAME_RE.test(name)) addError("name-invalid", `name must be lowercase alphanumeric with single hyphens: ${name}`)
  else if (isSkillFile) {
    const parent = path.basename(path.dirname(resolved))
    if (name !== parent) addError("name-directory-mismatch", `name "${name}" must match parent directory "${parent}"`)
  } else if (name !== skill.name) {
    addWarning("registry-name-mismatch", `frontmatter name "${name}" differs from registry name "${skill.name}"`)
  }

  const description = typeof data.description === "string" ? data.description.trim() : ""
  if (!description) addError("description-missing", "frontmatter.description is required")
  else if (description.length > 1024) addError("description-too-long", `description exceeds 1024 characters: ${description.length}`)

  if (!data.license) addWarning("license-missing", "no license declared")

  for (const key of Object.keys(data)) {
    if (!SPEC_KEYS.has(key)) addWarning("non-spec-key", `non-spec frontmatter key: ${key}`)
  }

  if (!isSkillFile) {
    addWarning("not-skill-layout", "file is not a SKILL.md; not discoverable by Agent Skills clients")
  }

  const bodyLines = split.body.split(/\r?\n/).length
  if (bodyLines > 500) addWarning("body-too-long", `${bodyLines} body lines exceeds the 500-line recommendation`)
  if (split.body.length > 20000) addWarning("body-too-large", `${split.body.length} body chars may exceed the ~5000-token recommendation`)

  const absoluteRefs = split.body.match(ABSOLUTE_REF_RE)
  if (absoluteRefs) addWarning("absolute-reference", "body contains absolute or personal paths")

  const rules = typeof skill.compact_rules === "string" ? skill.compact_rules.trim() : ""
  if (!rules) addError("compact-rules-empty", "compact_rules is empty")
  else {
    if (rules.length < 150) addError("compact-rules-too-short", `compact_rules is ${rules.length} chars; minimum is 150`)
    if (rules.length > 600) addError("compact-rules-too-long", `compact_rules is ${rules.length} chars; maximum is 600`)
    if (!/[.!?)]$/.test(rules)) addError("compact-rules-unterminated", "compact_rules does not end with a complete sentence")
    if (BANNER_RE.test(rules)) addError("compact-rules-banner", "compact_rules contains an ASCII banner")
    if (/[a-z]\.\.\.$/.test(rules)) addError("compact-rules-truncated", "compact_rules appears truncated mid-word")
  }

  return { errors, warnings, rules }
}

function main() {
  const args = process.argv.slice(2)
  const json = args.includes("--json")
  const strict = args.includes("--strict")
  const quiet = args.includes("--quiet")
  const configDir = getConfigDir()
  const registryPath = path.join(configDir, "odf-registry.json")

  if (!fs.existsSync(registryPath)) {
    console.error(`❌ Registry not found at ${registryPath}`)
    process.exit(1)
  }

  let registry
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
  } catch (error) {
    console.error(`❌ Registry is not valid JSON: ${error.message}`)
    process.exit(1)
  }

  const skills = Array.isArray(registry.skills) ? registry.skills : []
  const errors = []
  const warnings = []
  const seenRules = new Map()

  for (const skill of skills) {
    if (!skill || typeof skill !== "object") continue
    const result = validateSkill(skill, configDir, configDir)
    errors.push(...result.errors)
    warnings.push(...result.warnings)
    if (result.rules) {
      const names = seenRules.get(result.rules) ?? []
      names.push(skill.name)
      seenRules.set(result.rules, names)
    }
  }

  for (const [rules, names] of seenRules) {
    if (names.length > 1) {
      errors.push({ check: "compact-rules-duplicate", skill: names.join(", "), message: "compact_rules duplicated across skills" })
    }
  }

  const grouped = groupByCheck(warnings)
  const payload = {
    skills: skills.length,
    errors: errors.length,
    warnings: warnings.length,
    error_details: errors,
    warning_summary: Object.fromEntries(Object.entries(grouped).map(([check, list]) => [check, list.length])),
  }

  if (json) {
    console.log(JSON.stringify(payload, null, 2))
  } else if (!quiet) {
    console.log(`ODF skill validation: ${skills.length} skills`)
    if (errors.length === 0) console.log("✅ errors: 0")
    else {
      console.log(`❌ errors: ${errors.length}`)
      for (const item of errors) console.log(`   - [${item.check}] ${item.skill}: ${item.message}`)
    }
    if (warnings.length > 0) {
      console.log(`⚠️  warnings: ${warnings.length}`)
      for (const [check, list] of Object.entries(grouped)) {
        const sample = list.slice(0, 3).map(w => w.skill).join(", ")
        console.log(`   - [${check}] ${list.length}: ${sample}${list.length > 3 ? ", …" : ""}`)
      }
    }
  }

  if (errors.length > 0 || (strict && warnings.length > 0)) process.exit(1)
}

function groupByCheck(items) {
  const grouped = {}
  for (const item of items) {
    grouped[item.check] = grouped[item.check] ?? []
    grouped[item.check].push(item)
  }
  return grouped
}

main()
