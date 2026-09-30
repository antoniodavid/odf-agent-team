import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { canonicalWorkspaceRoot, CHANGE_NAME_PATTERN, isWithinRoot } from "./odf-delegation-shared.js"

export const MAX_PROPOSAL_BYTES = 32 * 1024
const PROPOSAL_ARTIFACT_NAME = "proposal.md"
const PROPOSAL_ARTIFACT_REF = (change: string): string => `openspec/changes/${change}/${PROPOSAL_ARTIFACT_NAME}`
const SHA256_PATTERN = /^[a-f0-9]{64}$/

interface ProposalPath {
  workspaceRoot: string
  changeDirectory: string
  filePath: string
  artifactRef: string
}

export type ProposalArtifactWriteResult =
  | { artifact_ref: string; digest: string; error: null }
  | { artifact_ref: null; digest: null; error: string }

function proposalPath(workspace: string, change: string): ProposalPath | null {
  if (!CHANGE_NAME_PATTERN.test(change)) return null

  let root: string
  try {
    root = canonicalWorkspaceRoot(workspace)
  } catch {
    return null
  }

  try {
    const rootStat = fs.lstatSync(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null
    const realRoot = fs.realpathSync(root)
    let current = realRoot
    for (const component of ["openspec", "changes", change]) {
      current = path.join(current, component)
      const stat = fs.lstatSync(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null
      const realCurrent = fs.realpathSync(current)
      if (!isWithinRoot(realCurrent, realRoot)) return null
      current = realCurrent
    }

    const filePath = path.join(current, PROPOSAL_ARTIFACT_NAME)
    try {
      const stat = fs.lstatSync(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || !isWithinRoot(fs.realpathSync(filePath), current)) return null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null
    }

    return {
      workspaceRoot: realRoot,
      changeDirectory: current,
      filePath,
      artifactRef: PROPOSAL_ARTIFACT_REF(change),
    }
  } catch {
    return null
  }
}

function validProposalContent(content: unknown): content is string {
  if (typeof content !== "string" || !content.trim() || content.includes("\0")) return false
  if (Buffer.byteLength(content, "utf8") > MAX_PROPOSAL_BYTES) return false
  return content.trim().split(/\s+/).length < 300
}

export function proposalContentDigest(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex")
}

/** Write only the canonical proposal.md inside an already-bound OpenSpec change. */
export function writeOpenSpecProposal(workspace: string, change: string, content: unknown): ProposalArtifactWriteResult {
  if (!validProposalContent(content)) return { artifact_ref: null, digest: null, error: "proposal-content-invalid" }
  const target = proposalPath(workspace, change)
  if (!target) return { artifact_ref: null, digest: null, error: "proposal-path-unsafe-or-missing" }

  const tempPath = path.join(target.changeDirectory, `${PROPOSAL_ARTIFACT_NAME}.${process.pid}.${crypto.randomUUID()}.tmp`)
  let descriptor: number | null = null
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600)
    fs.writeFileSync(descriptor, content, { encoding: "utf8" })
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = null

    // Re-check the fixed destination immediately before atomic replacement.
    try {
      const stat = fs.lstatSync(target.filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || !isWithinRoot(fs.realpathSync(target.filePath), target.changeDirectory)) {
        return { artifact_ref: null, digest: null, error: "proposal-path-unsafe-or-missing" }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return { artifact_ref: null, digest: null, error: "proposal-path-unsafe-or-missing" }
      }
    }

    fs.renameSync(tempPath, target.filePath)
    return { artifact_ref: target.artifactRef, digest: proposalContentDigest(content), error: null }
  } catch {
    return { artifact_ref: null, digest: null, error: "proposal-write-failed" }
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor) } catch { /* best-effort cleanup */ }
    }
    try { fs.unlinkSync(tempPath) } catch { /* the rename already consumed it */ }
  }
}

/** Verify persisted proposal bytes against evidence bound to a delegation token. */
export function verifyOpenSpecProposal(
  workspace: string,
  change: string,
  artifactRef: string,
  expectedDigest: string,
): boolean {
  if (artifactRef !== PROPOSAL_ARTIFACT_REF(change) || !SHA256_PATTERN.test(expectedDigest)) return false
  const target = proposalPath(workspace, change)
  if (!target) return false
  try {
    const stat = fs.lstatSync(target.filePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROPOSAL_BYTES) return false
    const content = fs.readFileSync(target.filePath, "utf8")
    return proposalContentDigest(content) === expectedDigest
  } catch {
    return false
  }
}
