import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as os from "node:os"
import { execSync } from "node:child_process"
import { buildCandidateManifest, computeCandidateDigest, extractChangedPaths } from "./candidate-manifest.js"
import { classifyRiskTierWithContent, computePolicyGate, validateValidationEvidence, type ODFRegistry } from "./odf-delegation.js"
import { readPersistedExternalValidationScope } from "./odf-delegation-policy.js"
import { candidateDigestOrNull, mergeReceipt, type ODFReceipt } from "./odf-delegation-receipts.js"

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

  it("scopes external validation to Git-visible workflow paths without force-adding ignored subjects", async () => {
    const repo = path.join(tmp, "scoped")
    initGitRepo(repo)
    commitFile(repo, "base.txt")
    await fs.writeFile(path.join(repo, ".gitignore"), "probe/\n", "utf8")
    await fs.mkdir(path.join(repo, "probe"), { recursive: true })
    await fs.writeFile(path.join(repo, "probe", "subject.py"), "ignored\n", "utf8")
    await fs.writeFile(path.join(repo, "workflow.md"), "workflow\n", "utf8")
    await fs.writeFile(path.join(repo, "unrelated.py"), "unrelated\n", "utf8")
    await fs.appendFile(path.join(repo, "base.txt"), "dirty\n", "utf8")

    const defaultPaths = extractChangedPaths(buildCandidateManifest(repo))
    expect(defaultPaths).toContain("workflow.md")
    expect(defaultPaths).toContain("unrelated.py")
    expect(defaultPaths).toContain("base.txt")
    expect(defaultPaths).not.toContain("probe/subject.py")

    const scopedPaths = extractChangedPaths(buildCandidateManifest(repo, ["workflow.md", "probe/subject.py"]))
    expect(scopedPaths).toEqual(["workflow.md"])
  })

  it.each(["../outside", path.resolve(os.tmpdir(), "outside"), "C:\\outside", "workflow/../../outside"])(
    "rejects unsafe external-validation scope path %s",
    unsafePath => {
      const repo = path.join(tmp, "unsafe-scope")
      initGitRepo(repo)
      commitFile(repo, "base.txt")

      expect(() => buildCandidateManifest(repo, [unsafePath])).toThrow(/external-validation scope/)
      const decision = computePolicyGate({
        change: "unsafe-scope",
        phase: "VERIFY",
        workspaceDir: repo,
        registry: registryWithTdd(false),
        externalValidationScope: [unsafePath],
      })
      expect(decision).toMatchObject({ gate: "block", reason: expect.stringContaining("invalid external-validation scope") })
    },
  )

  it("persists and reuses the normalized external-validation scope", async () => {
    const repo = path.join(tmp, "scope-persistence")
    initGitRepo(repo)
    commitFile(repo, "base.txt")
    await fs.mkdir(path.join(repo, "workflow"), { recursive: true })
    await fs.writeFile(path.join(repo, "workflow", "verify.yaml"), "status: passed\n", "utf8")
    await fs.writeFile(path.join(repo, "unrelated.py"), "unrelated\n", "utf8")

    const first = computePolicyGate({
      change: "scope-persistence",
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationScope: ["./workflow/verify.yaml"],
    })
    expect(first.external_validation_scope).toEqual(["workflow/verify.yaml"])
    expect(first.changed_paths).toEqual(["workflow/verify.yaml"])

    const saved = JSON.parse(await fs.readFile(path.join(repo, ".odf", "policy-gate-scope-persistence.json"), "utf8"))
    expect(saved.external_validation_scope).toEqual(["workflow/verify.yaml"])

    const reused = computePolicyGate({
      change: "scope-persistence",
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationScope: ["workflow/verify.yaml"],
    })
    expect(reused).toEqual(first)
  })

  it("fails closed when an existing policy gate is malformed", async () => {
    const repo = path.join(tmp, "malformed-policy-gate")
    initGitRepo(repo)
    commitFile(repo, "base.txt")
    await fs.mkdir(path.join(repo, ".odf"), { recursive: true })
    await fs.writeFile(path.join(repo, ".odf", "policy-gate-malformed.json"), "{not-json", "utf8")

    expect(readPersistedExternalValidationScope(repo, "malformed")).toEqual({ invalid: true })
    expect(candidateDigestOrNull(repo, "malformed")).toBeNull()
    expect(readPersistedExternalValidationScope(repo, "absent")).toEqual({ invalid: false })
  })

  it("counts lines in explicitly scoped untracked workflow files", async () => {
    const repo = path.join(tmp, "scoped-untracked-lines")
    initGitRepo(repo)
    commitFile(repo, "base.txt")
    await fs.writeFile(path.join(repo, "workflow.md"), "first\nsecond\nthird\n", "utf8")

    const gate = computePolicyGate({
      change: "scoped-untracked-lines",
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationScope: ["workflow.md"],
    })

    expect(gate.changed_paths).toEqual(["workflow.md"])
    expect(gate.changed_lines).toBe(3)
    expect(gate.correction_budget_lines).toBe(2)
  })

  it("uses the persisted scope for receipt binding and stable digest mismatch checks", async () => {
    const repo = path.join(tmp, "scoped-digest")
    initGitRepo(repo)
    commitFile(repo, "base.txt")
    await fs.writeFile(path.join(repo, ".gitignore"), "probe.py\n", "utf8")
    await fs.writeFile(path.join(repo, "probe.py"), "ignored\n", "utf8")
    await fs.writeFile(path.join(repo, "workflow.md"), "workflow\n", "utf8")
    await fs.writeFile(path.join(repo, "unrelated.py"), "unrelated\n", "utf8")

    const change = "scoped-digest"
    const gate = computePolicyGate({
      change,
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationScope: ["workflow.md"],
    })
    const digest = candidateDigestOrNull(repo, change)
    expect(digest).toBe(gate.candidate_digest)

    const receipt: ODFReceipt = {
      change,
      phase: "VERIFY",
      status: "blocked",
      cause: "validation-failed",
      evidence: null,
      action: null,
      review_gate: null,
      frozen_diff_ref: gate.frozen_diff_ref,
      resolved_at: "2026-09-20T00:00:00.000Z",
    }
    expect(mergeReceipt(repo, receipt).candidate_digest).toBe(digest)

    const now = new Date("2026-09-20T00:00:00.000Z")
    await fs.writeFile(path.join(repo, ".odf", `validation-evidence-${change}.json`), JSON.stringify({
      change,
      phase: "VERIFY",
      batch: 1,
      risk_tier: gate.risk_tier,
      frozen_diff_ref: gate.frozen_diff_ref,
      candidate_digest: digest,
      executor: "filesystem-test",
      test_identity: "candidate manifest unit test",
      resolved_at: now.toISOString(),
      commands: [
        { name: "typecheck", command: "npm run typecheck", database: "filesystem", exit_code: 0, output_tail: "passed" },
        { name: "unit", command: "npm run test:unit", database: "filesystem", exit_code: 0, output_tail: "passed" },
      ],
    }), "utf8")

    await fs.appendFile(path.join(repo, "unrelated.py"), "changed\n", "utf8")
    expect(candidateDigestOrNull(repo, change)).toBe(digest)
    expect(validateValidationEvidence({
      workspaceDir: repo,
      change,
      tier: gate.risk_tier,
      frozenDiffRef: gate.frozen_diff_ref,
      expectedPhase: "VERIFY",
      now,
    }).status).toBe("verified")

    await fs.appendFile(path.join(repo, "workflow.md"), "changed\n", "utf8")
    expect(candidateDigestOrNull(repo, change)).not.toBe(digest)
    expect(validateValidationEvidence({
      workspaceDir: repo,
      change,
      tier: gate.risk_tier,
      frozenDiffRef: gate.frozen_diff_ref,
      expectedPhase: "VERIFY",
      now,
    }).reason).toContain("candidate digest mismatch")
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
