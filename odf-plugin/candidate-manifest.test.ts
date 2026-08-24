import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as os from "node:os"
import { execSync } from "node:child_process"
import { buildCandidateManifest, computeCandidateDigest, extractChangedPaths } from "./candidate-manifest.js"
import { classifyRiskTierWithContent, computePolicyGate, type ODFRegistry } from "./odf-delegation.js"

function initGitRepo(dir: string): void {
  fsSync.mkdirSync(dir, { recursive: true })
  execSync("git init -q", { cwd: dir })
  execSync('git config user.email "test@example.com"', { cwd: dir })
  execSync('git config user.name "odf-test"', { cwd: dir })
}

function commitFile(dir: string, name: string, content = "line 0\n"): void {
  const filePath = path.join(dir, name)
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true })
  fsSync.writeFileSync(filePath, content, "utf8")
  execSync("git add -A", { cwd: dir })
  execSync('git commit -q -m "base"', { cwd: dir })
}

function registryWithTdd(strict: boolean): ODFRegistry {
  return {
    version: 1,
    last_updated: new Date().toISOString(),
    skills: [],
    agents: [],
    flags: { strict_tdd: strict },
  }
}

describe("candidate-manifest", () => {
  let tmp: string
  const originalConfigDir = process.env.ODF_CONFIG_DIR
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "odf-manifest-"))
  })
  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.ODF_CONFIG_DIR
    else process.env.ODF_CONFIG_DIR = originalConfigDir
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("produces the same manifest and digest for the same candidate", async () => {
    const repo = path.join(tmp, "same")
    initGitRepo(repo)
    commitFile(repo, "a.py", "one\n")
    await fs.appendFile(path.join(repo, "a.py"), "two\n", "utf8")
    await fs.writeFile(path.join(repo, "new.txt"), "n\n", "utf8")

    const m1 = buildCandidateManifest(repo)
    const m2 = buildCandidateManifest(repo)
    expect(m1).toEqual(m2)
    expect(computeCandidateDigest(m1)).toBe(computeCandidateDigest(m2))
  })

  it("changes the digest when file bytes change", async () => {
    const repo = path.join(tmp, "bytes")
    initGitRepo(repo)
    commitFile(repo, "a.py", "one\n")
    await fs.appendFile(path.join(repo, "a.py"), "two\n", "utf8")
    const before = computeCandidateDigest(buildCandidateManifest(repo))

    await fs.appendFile(path.join(repo, "a.py"), "three\n", "utf8")
    const after = computeCandidateDigest(buildCandidateManifest(repo))
    expect(after).not.toBe(before)
  })

  it("changes the digest on rename", async () => {
    const repo = path.join(tmp, "rename")
    initGitRepo(repo)
    commitFile(repo, "a.py", "one\n")
    const before = computeCandidateDigest(buildCandidateManifest(repo))

    execSync("git mv a.py b.py", { cwd: repo })
    const manifest = buildCandidateManifest(repo)
    expect(manifest.entries.map((e) => e.path).sort()).toEqual(["a.py", "b.py"])
    expect(computeCandidateDigest(manifest)).not.toBe(before)
  })

  it("changes the digest on delete", async () => {
    const repo = path.join(tmp, "delete")
    initGitRepo(repo)
    commitFile(repo, "a.py", "one\n")
    const before = computeCandidateDigest(buildCandidateManifest(repo))

    await fs.rm(path.join(repo, "a.py"))
    const manifest = buildCandidateManifest(repo)
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0].status).toBe("D")
    expect(manifest.entries[0].mode).toBeNull()
    expect(manifest.entries[0].sha256).toBeNull()
    expect(computeCandidateDigest(manifest)).not.toBe(before)
  })

  it("changes the digest on a mode change", async () => {
    const repo = path.join(tmp, "mode")
    initGitRepo(repo)
    commitFile(repo, "x.py", "one\n")
    const before = computeCandidateDigest(buildCandidateManifest(repo))

    await fs.chmod(path.join(repo, "x.py"), 0o755)
    const manifest = buildCandidateManifest(repo)
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0].mode).toBe(0o755)
    expect(computeCandidateDigest(manifest)).not.toBe(before)
  })

  it("includes untracked files in the manifest and digest", async () => {
    const repo = path.join(tmp, "untracked")
    initGitRepo(repo)
    commitFile(repo, "a.py", "one\n")
    const before = computeCandidateDigest(buildCandidateManifest(repo))

    await fs.writeFile(path.join(repo, "untracked.txt"), "u\n", "utf8")
    const manifest = buildCandidateManifest(repo)
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0].status).toBe("??")
    expect(manifest.entries[0].path).toBe("untracked.txt")
    expect(computeCandidateDigest(manifest)).not.toBe(before)
  })

  it("ignores durable telemetry in a configured nested directory", async () => {
    const repo = path.join(tmp, "nested-telemetry")
    initGitRepo(repo)
    commitFile(repo, "README.md")
    process.env.ODF_CONFIG_DIR = path.join(repo, ".config", "opencode")
    const before = computeCandidateDigest(buildCandidateManifest(repo))
    await fs.mkdir(path.join(repo, ".config", "opencode", "metrics"), { recursive: true })
    await fs.writeFile(path.join(repo, ".config", "opencode", "metrics", "delegations-2026-08-24.jsonl"), "{}\n", "utf8")

    const manifest = buildCandidateManifest(repo)
    expect(manifest.entries).toEqual([])
    expect(computeCandidateDigest(manifest)).toBe(before)
  })

  it("ignores durable telemetry when the repository is the configured root", async () => {
    const repo = path.join(tmp, "root-telemetry")
    initGitRepo(repo)
    commitFile(repo, "README.md")
    process.env.ODF_CONFIG_DIR = repo
    await fs.mkdir(path.join(repo, "metrics"), { recursive: true })
    await fs.writeFile(path.join(repo, "metrics", "delegations-2026-08-24.jsonl"), "{}\n", "utf8")

    expect(buildCandidateManifest(repo).entries).toEqual([])
  })

  it("does not exclude a similarly named directory when configured telemetry is outside", async () => {
    const repo = path.join(tmp, "outside-telemetry")
    initGitRepo(repo)
    commitFile(repo, "README.md")
    process.env.ODF_CONFIG_DIR = path.join(tmp, "outside-config")
    await fs.mkdir(path.join(repo, "metrics"), { recursive: true })
    await fs.writeFile(path.join(repo, "metrics", "user-file.txt"), "keep\n", "utf8")

    expect(extractChangedPaths(buildCandidateManifest(repo))).toContain("metrics/user-file.txt")
  })

  it("excludes ODF's own .odf state dir from the manifest", async () => {
    const repo = path.join(tmp, "odf-state")
    initGitRepo(repo)
    commitFile(repo, "a.py", "one\n")
    await fs.mkdir(path.join(repo, ".odf"), { recursive: true })
    await fs.writeFile(path.join(repo, ".odf", "policy-gate-x.json"), "{}", "utf8")

    const m1 = buildCandidateManifest(repo)
    const m2 = buildCandidateManifest(repo)
    expect(m1.entries).toEqual([])
    expect(computeCandidateDigest(m1)).toBe(computeCandidateDigest(m2))
  })

  it("untracked security csv participates in risk classification", async () => {
    const repo = path.join(tmp, "sec-untracked")
    initGitRepo(repo)
    commitFile(repo, "a.py", "one\n")
    await fs.mkdir(path.join(repo, "security"), { recursive: true })
    await fs.writeFile(path.join(repo, "security", "ir.model.access.csv"), "id,name\n", "utf8")

    const manifest = buildCandidateManifest(repo)
    const paths = extractChangedPaths(manifest)
    expect(paths).toContain("security/ir.model.access.csv")
    expect(classifyRiskTierWithContent(paths, repo)).toBe("HIGH")
  })

  it("empty candidate has a stable, explicit digest and no entries", async () => {
    const repo = path.join(tmp, "empty")
    initGitRepo(repo)
    commitFile(repo, "a.py", "one\n")

    const m1 = buildCandidateManifest(repo)
    const m2 = buildCandidateManifest(repo)
    expect(m1.base_head).toBeTruthy()
    expect(m1.entries).toEqual([])
    const d1 = computeCandidateDigest(m1)
    expect(d1).toBeTruthy()
    expect(d1).toBe(computeCandidateDigest(m2))
  })

  it("returns base_head null without throwing when git is unavailable", async () => {
    const manifest = buildCandidateManifest(tmp)
    expect(manifest.base_head).toBeNull()
    expect(manifest.entries).toEqual([])
  })

  it("integration: VERIFY with untracked security csv is HIGH and recomputes on byte change", async () => {
    const repo = path.join(tmp, "gate-sec")
    initGitRepo(repo)
    commitFile(repo, "a.py", "one\n")
    const csv = path.join(repo, "security", "ir.model.access.csv")
    await fs.mkdir(path.dirname(csv), { recursive: true })
    await fs.writeFile(csv, "id,name\n", "utf8")

    const first = computePolicyGate({ change: "gate-sec", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(first.changed_paths).toContain("security/ir.model.access.csv")
    expect(first.risk_tier).toBe("HIGH")
    expect(first.base_head).toBeTruthy()
    expect(first.candidate_digest).toBeTruthy()

    await fs.appendFile(csv, "extra,row\n", "utf8")
    const second = computePolicyGate({ change: "gate-sec", phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    expect(second.candidate_digest).not.toBe(first.candidate_digest)
    expect(second.changed_paths).toContain("security/ir.model.access.csv")
    expect(second.risk_tier).toBe("HIGH")
  })

  it("integration: VERIFY without git blocks instead of failing open (candidate not reproducible)", () => {
    const d = computePolicyGate({ change: "no-git", phase: "VERIFY", workspaceDir: tmp, registry: registryWithTdd(true) })
    expect(d.base_head).toBeNull()
    expect(d.candidate_digest).toBeNull()
    expect(d.gate).toBe("block")
    expect(d.reason).toContain("verification-unavailable")
    expect(d.risk_tier).toBe("MEDIUM")
  })
})
