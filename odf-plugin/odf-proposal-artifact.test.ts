import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  MAX_PROPOSAL_BYTES,
  verifyOpenSpecProposal,
  writeOpenSpecProposal,
} from "./odf-proposal-artifact.js"

describe("bounded OpenSpec proposal writer", () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "odf-proposal-"))
    await fs.mkdir(path.join(workspace, "openspec", "changes", "proposal-test"), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it("writes and verifies only the canonical proposal artifact", async () => {
    const content = "## Proposal: proposal-test\n\n### Intent\nA bounded, measurable change.\n"
    const result = writeOpenSpecProposal(workspace, "proposal-test", content)

    expect(result).toMatchObject({
      artifact_ref: "openspec/changes/proposal-test/proposal.md",
      error: null,
    })
    expect(await fs.readFile(path.join(workspace, "openspec", "changes", "proposal-test", "proposal.md"), "utf8"))
      .toBe(content)
    expect(verifyOpenSpecProposal(workspace, "proposal-test", result.artifact_ref!, result.digest!)).toBe(true)
    expect(verifyOpenSpecProposal(workspace, "proposal-test", "openspec/changes/proposal-test/design.md", result.digest!)).toBe(false)
  })

  it("rejects unsafe, missing, empty, oversized, and 300-word proposals", async () => {
    const content = "A valid proposal."
    expect(writeOpenSpecProposal(workspace, "../outside", content).error).toBe("proposal-path-unsafe-or-missing")
    expect(writeOpenSpecProposal(workspace, "missing-change", content).error).toBe("proposal-path-unsafe-or-missing")
    expect(writeOpenSpecProposal(workspace, "proposal-test", " \n").error).toBe("proposal-content-invalid")
    expect(writeOpenSpecProposal(workspace, "proposal-test", "word ".repeat(300)).error).toBe("proposal-content-invalid")
    expect(writeOpenSpecProposal(workspace, "proposal-test", "x".repeat(MAX_PROPOSAL_BYTES + 1)).error)
      .toBe("proposal-content-invalid")
  })

  it("rejects symlinked change directories and detects post-write tampering", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "odf-proposal-outside-"))
    try {
      const changeDirectory = path.join(workspace, "openspec", "changes", "proposal-test")
      await fs.rm(changeDirectory, { recursive: true, force: true })
      await fs.symlink(outside, changeDirectory, "dir")
      expect(writeOpenSpecProposal(workspace, "proposal-test", "Proposal content.").error)
        .toBe("proposal-path-unsafe-or-missing")

      await fs.rm(changeDirectory)
      await fs.mkdir(changeDirectory)
      const result = writeOpenSpecProposal(workspace, "proposal-test", "Proposal content.")
      expect(result.error).toBeNull()
      await fs.writeFile(path.join(changeDirectory, "proposal.md"), "tampered content", "utf8")
      expect(verifyOpenSpecProposal(workspace, "proposal-test", result.artifact_ref!, result.digest!)).toBe(false)
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})
