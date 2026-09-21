import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as os from "node:os"
import { execSync } from "node:child_process"
import {
  buildCandidateManifest,
  captureExternalValidationSubjectManifest,
  computeCandidateDigest,
  extractChangedPaths,
} from "./candidate-manifest.js"
import { classifyRiskTierWithContent, computePolicyGate, validateValidationEvidence, type ODFRegistry } from "./odf-delegation.js"
import {
  readPersistedExternalValidationScope,
  readPersistedExternalValidationSubjects,
} from "./odf-delegation-policy.js"
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

function verifyEvidence(
  change: string,
  gate: ReturnType<typeof computePolicyGate>,
  resolvedAt: Date,
  subjectManifest?: unknown,
): Record<string, unknown> {
  return {
    change,
    phase: "VERIFY",
    batch: 1,
    risk_tier: gate.risk_tier,
    frozen_diff_ref: gate.frozen_diff_ref,
    candidate_digest: gate.candidate_digest,
    executor: "filesystem-test",
    test_identity: "external subject test",
    ...(subjectManifest === undefined ? {} : { external_validation_subject_manifest: subjectManifest }),
    resolved_at: resolvedAt.toISOString(),
    commands: [
      { name: "odoo-tests", command: "odoo-bin -d odf_test_db --test-enable", database: "odf_test_db", exit_code: 0, output_tail: "0 failed" },
      { name: "git-diff-check", command: "git diff --check", database: "odf_test_db", exit_code: 0, output_tail: "passed" },
    ],
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

  it("reuses persisted scope and subjects when a later gate omits both", async () => {
    const repo = path.join(tmp, "reuse-persisted-declarations")
    initGitRepo(repo)
    commitFile(repo, ".gitignore", "probe.py\n")
    await fs.writeFile(path.join(repo, "workflow.md"), "workflow\n", "utf8")
    await fs.writeFile(path.join(repo, "probe.py"), "probe\n", "utf8")

    const first = computePolicyGate({
      change: "reuse-persisted-declarations",
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationScope: ["./workflow.md"],
      externalValidationSubjects: ["./probe.py"],
    })
    const reused = computePolicyGate({
      change: "reuse-persisted-declarations",
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
    })

    expect(reused).toEqual(first)
    expect(reused.external_validation_scope).toEqual(["workflow.md"])
    expect(reused.external_validation_subjects).toEqual(["probe.py"])
  })

  it("blocks reuse when a persisted scope or subject declaration is malformed", async () => {
    for (const kind of ["scope", "subjects"] as const) {
      const repo = path.join(tmp, `malformed-persisted-${kind}`)
      initGitRepo(repo)
      commitFile(repo, ".gitignore", "probe.py\n")
      await fs.writeFile(path.join(repo, "probe.py"), "probe\n", "utf8")
      const change = `malformed-persisted-${kind}`
      const first = computePolicyGate({ change, phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
      const gatePath = path.join(repo, ".odf", `policy-gate-${change}.json`)
      await fs.writeFile(path.join(repo, ".odf", `policy-gate-${change}.json`), JSON.stringify({
        ...first,
        ...(kind === "scope" ? { external_validation_scope: ["../escape"] } : { external_validation_subjects: ["../escape"] }),
      }), "utf8")

      const blocked = computePolicyGate({ change, phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
      expect(blocked).toMatchObject({
        gate: "block",
        reason: `invalid persisted external-validation ${kind} — policy gate must be repaired before reuse`,
      })
      expect(JSON.parse(await fs.readFile(gatePath, "utf8"))).toMatchObject(
        kind === "scope" ? { external_validation_scope: ["../escape"] } : { external_validation_subjects: ["../escape"] },
      )
    }
  })

  it("normalizes and persists explicitly replaced scope and subjects", async () => {
    const repo = path.join(tmp, "replace-persisted-declarations")
    initGitRepo(repo)
    commitFile(repo, ".gitignore", "probe/\n")
    await fs.writeFile(path.join(repo, "workflow-old.md"), "old\n", "utf8")
    await fs.writeFile(path.join(repo, "workflow-new.md"), "new\n", "utf8")
    await fs.mkdir(path.join(repo, "probe"), { recursive: true })
    await fs.writeFile(path.join(repo, "probe", "old.py"), "old\n", "utf8")
    await fs.writeFile(path.join(repo, "probe", "new.py"), "new\n", "utf8")
    const change = "replace-persisted-declarations"

    computePolicyGate({
      change,
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationScope: ["./workflow-old.md"],
      externalValidationSubjects: ["./probe/old.py"],
    })
    const replacement = computePolicyGate({
      change,
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationScope: ["./workflow-new.md"],
      externalValidationSubjects: ["./probe/new.py"],
    })
    const saved = JSON.parse(await fs.readFile(path.join(repo, ".odf", `policy-gate-${change}.json`), "utf8"))

    expect(replacement.external_validation_scope).toEqual(["workflow-new.md"])
    expect(replacement.external_validation_subjects).toEqual(["probe/new.py"])
    expect(saved.external_validation_scope).toEqual(["workflow-new.md"])
    expect(saved.external_validation_subjects).toEqual(["probe/new.py"])
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

  it("captures ignored subjects, expands directories, and orders the manifest deterministically", async () => {
    const repo = path.join(tmp, "ignored-subjects")
    initGitRepo(repo)
    commitFile(repo, ".gitignore", "probe/\n")
    await fs.mkdir(path.join(repo, "probe", "nested"), { recursive: true })
    await fs.writeFile(path.join(repo, "probe", "z.txt"), "z\n", "utf8")
    await fs.writeFile(path.join(repo, "probe", "a.txt"), "a\n", "utf8")
    await fs.writeFile(path.join(repo, "probe", "nested", "m.txt"), "m\n", "utf8")

    const change = "ignored-subjects"
    const gate = computePolicyGate({
      change,
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationSubjects: ["./probe"],
    })
    const first = captureExternalValidationSubjectManifest(repo, ["probe"])
    const second = captureExternalValidationSubjectManifest(repo, ["probe"])

    expect(gate.external_validation_subjects).toEqual(["probe"])
    expect(gate.changed_paths).toEqual([])
    expect(buildCandidateManifest(repo).entries).toEqual([])
    expect(readPersistedExternalValidationSubjects(repo, change)).toEqual({ paths: ["probe"], invalid: false })
    expect(first).toEqual(second)
    expect(first.manifest?.map(entry => entry.path)).toEqual([
      "probe/a.txt",
      "probe/nested/m.txt",
      "probe/z.txt",
    ])
  })

  it("rejects unsafe external subject paths and symlinks", async () => {
    const repo = path.join(tmp, "unsafe-subjects")
    initGitRepo(repo)
    commitFile(repo, "base.txt")
    await fs.writeFile(path.join(tmp, "outside-subject.txt"), "outside\n", "utf8")
    await fs.symlink(path.join(tmp, "outside-subject.txt"), path.join(repo, "subject-link"))

    for (const unsafePath of ["../outside", path.resolve(tmp, "outside-subject.txt"), "C:\\outside", "subject-link"]) {
      expect(captureExternalValidationSubjectManifest(repo, [unsafePath]).error).toEqual(expect.any(String))
    }
  })

  it("rejects subject evidence that is missing, malformed, or path-mismatched", async () => {
    const repo = path.join(tmp, "subject-evidence-shape")
    initGitRepo(repo)
    commitFile(repo, ".gitignore", "probe.py\n")
    await fs.writeFile(path.join(repo, "probe.py"), "probe\n", "utf8")
    const change = "subject-evidence-shape"
    const gate = computePolicyGate({
      change,
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationSubjects: ["probe.py"],
    })
    const subjectManifest = captureExternalValidationSubjectManifest(repo, ["probe.py"]).manifest
    const now = new Date("2026-09-20T00:00:00.000Z")
    const evidencePath = path.join(repo, ".odf", `validation-evidence-${change}.json`)
    const policyPath = path.join(repo, ".odf", `policy-gate-${change}.json`)
    await fs.writeFile(policyPath, JSON.stringify({ ...gate, external_validation_subjects: ["../escape"] }), "utf8")
    expect(readPersistedExternalValidationSubjects(repo, change)).toEqual({ invalid: true })
    expect(candidateDigestOrNull(repo, change)).toBeNull()
    await fs.writeFile(policyPath, JSON.stringify(gate), "utf8")

    for (const evidenceSubjects of [undefined, [{ path: "probe.py" }], [{ path: "other.py", mode: 0o644, sha256: "a".repeat(64) }]]) {
      await fs.writeFile(evidencePath, JSON.stringify(verifyEvidence(change, gate, now, evidenceSubjects)), "utf8")
      expect(validateValidationEvidence({
        workspaceDir: repo,
        change,
        tier: gate.risk_tier,
        frozenDiffRef: gate.frozen_diff_ref,
        now,
      }).status).toBe("invalid")
    }

    await fs.writeFile(evidencePath, JSON.stringify(verifyEvidence(change, gate, now, subjectManifest)), "utf8")
    await fs.rm(path.join(repo, "probe.py"))
    expect(validateValidationEvidence({
      workspaceDir: repo,
      change,
      tier: gate.risk_tier,
      frozenDiffRef: gate.frozen_diff_ref,
      now,
    }).status).toBe("invalid")
  })

  it("rejects subject evidence after an ignored file mutates", async () => {
    const repo = path.join(tmp, "subject-evidence-mismatch")
    initGitRepo(repo)
    commitFile(repo, ".gitignore", "probe.py\n")
    await fs.writeFile(path.join(repo, "probe.py"), "before\n", "utf8")
    const change = "subject-evidence-mismatch"
    const gate = computePolicyGate({
      change,
      phase: "VERIFY",
      workspaceDir: repo,
      registry: registryWithTdd(false),
      externalValidationSubjects: ["probe.py"],
    })
    const now = new Date("2026-09-20T00:00:00.000Z")
    const subjectManifest = captureExternalValidationSubjectManifest(repo, ["probe.py"]).manifest
    await fs.writeFile(
      path.join(repo, ".odf", `validation-evidence-${change}.json`),
      JSON.stringify(verifyEvidence(change, gate, now, subjectManifest)),
      "utf8",
    )

    expect(validateValidationEvidence({
      workspaceDir: repo,
      change,
      tier: gate.risk_tier,
      frozenDiffRef: gate.frozen_diff_ref,
      now,
    }).status).toBe("verified")

    await fs.writeFile(path.join(repo, "probe.py"), "after\n", "utf8")
    expect(validateValidationEvidence({
      workspaceDir: repo,
      change,
      tier: gate.risk_tier,
      frozenDiffRef: gate.frozen_diff_ref,
      now,
    })).toMatchObject({ status: "invalid", reason: "external-validation subject manifest mismatch" })
  })

  it("keeps ordinary validation evidence valid without a subject declaration", async () => {
    const repo = path.join(tmp, "ordinary-evidence")
    initGitRepo(repo)
    commitFile(repo, "base.txt")
    const change = "ordinary-evidence"
    const gate = computePolicyGate({ change, phase: "VERIFY", workspaceDir: repo, registry: registryWithTdd(false) })
    const now = new Date("2026-09-20T00:00:00.000Z")
    await fs.writeFile(
      path.join(repo, ".odf", `validation-evidence-${change}.json`),
      JSON.stringify(verifyEvidence(change, gate, now)),
      "utf8",
    )

    expect(validateValidationEvidence({
      workspaceDir: repo,
      change,
      tier: gate.risk_tier,
      frozenDiffRef: gate.frozen_diff_ref,
      now,
    }).status).toBe("verified")
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
