import { afterEach, describe, expect, it } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  createLateSealCapability,
  consumeLateSealCapability,
  LATE_SEAL_CAPABILITY_TTL_MS,
  readLateSealCapability,
  type LateSealCapabilityBinding,
} from "./odf-late-seal-capability.js"

describe("late-seal recovery capabilities", () => {
  let root: string | null = null

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true })
    root = null
  })

  async function setup(): Promise<LateSealCapabilityBinding> {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "odf-late-seal-"))
    await fs.mkdir(path.join(root, ".odf"))
    return {
      change: "late-seal-change",
      token: "odf-tok-0123456789abcdef0123456789abcdef",
      attempt_id: "attempt-123",
      parent_session_id: "parent-session",
      child_session_id: "child-session",
    }
  }

  it("binds a short-lived capability to the exact change, token, attempt, parent, and child", async () => {
    const binding = await setup()
    const now = new Date("2026-10-08T10:00:00.000Z")
    const issued = createLateSealCapability(root!, binding, now)
    expect("capability" in issued).toBe(true)
    if (!("capability" in issued)) return

    expect(issued.expires_at).toBe(new Date(now.getTime() + LATE_SEAL_CAPABILITY_TTL_MS).toISOString())
    expect(readLateSealCapability(root!, issued.capability, binding, now)).toMatchObject({ valid: true })
    expect(readLateSealCapability(root!, issued.capability, { ...binding, child_session_id: "sibling-session" }, now))
      .toMatchObject({ valid: false, reason: "late-seal-capability-mismatch" })
    expect(readLateSealCapability(root!, issued.capability, { ...binding, token: "odf-tok-abcdef0123456789abcdef0123456789" }, now))
      .toMatchObject({ valid: false, reason: "late-seal-capability-unavailable" })
    expect(readLateSealCapability(root!, issued.capability, binding, new Date(now.getTime() + LATE_SEAL_CAPABILITY_TTL_MS)))
      .toMatchObject({ valid: false, reason: "late-seal-capability-expired" })
    expect(readLateSealCapability(root!, issued.capability, binding, new Date(now.getTime() + LATE_SEAL_CAPABILITY_TTL_MS + 1)))
      .toMatchObject({ valid: false, reason: "late-seal-capability-expired" })
  })

  it("consumes once and does not allow reminting after consumption", async () => {
    const binding = await setup()
    const now = new Date("2026-10-08T10:00:00.000Z")
    const issued = createLateSealCapability(root!, binding, now)
    expect("capability" in issued).toBe(true)
    if (!("capability" in issued)) return

    expect(consumeLateSealCapability(root!, issued.capability, binding, now)).toMatchObject({ valid: true })
    expect(consumeLateSealCapability(root!, issued.capability, binding, now)).toMatchObject({
      valid: false,
      reason: "late-seal-capability-already-used",
    })
    expect(createLateSealCapability(root!, binding, new Date(now.getTime() + 1_000)))
      .toMatchObject({ error: "late-seal-capability-already-used" })
  })

  it("rejects capability metadata tampering instead of extending its TTL", async () => {
    const binding = await setup()
    const now = new Date("2026-10-08T10:00:00.000Z")
    const issued = createLateSealCapability(root!, binding, now)
    expect("capability" in issued).toBe(true)
    if (!("capability" in issued)) return

    const file = path.join(root!, ".odf", `late-seal-${binding.change}-${binding.token}.json`)
    const record = JSON.parse(await fs.readFile(file, "utf8"))
    const shift = 24 * 60 * 60 * 1000
    record.created_at = new Date(Date.parse(record.created_at) + shift).toISOString()
    record.expires_at = new Date(Date.parse(record.expires_at) + shift).toISOString()
    await fs.writeFile(file, JSON.stringify(record))
    expect(readLateSealCapability(root!, issued.capability, binding, now))
      .toMatchObject({ valid: false, reason: "late-seal-capability-mismatch" })
  })

  it("fails closed for invalid bindings and malformed time", async () => {
    const binding = await setup()
    expect(createLateSealCapability(root!, { ...binding, child_session_id: "unsafe\nchild" }))
      .toMatchObject({ error: "late-seal-binding-invalid" })
    expect(createLateSealCapability(root!, binding, new Date(Number.NaN)))
      .toMatchObject({ error: "late-seal-time-invalid" })
  })
})
