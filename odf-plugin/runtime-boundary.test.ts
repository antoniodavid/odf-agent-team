import { describe, expect, it, vi } from "vitest"
import { defineODFRuntime, ODF_PLUGIN_ID } from "./runtime-boundary.js"

describe("ODF runtime boundary", () => {
  it("keeps the stable plugin ID and forwards host-neutral context", async () => {
    const setup = vi.fn()
    const boundary = defineODFRuntime(setup)

    expect(boundary.id).toBe(ODF_PLUGIN_ID)
    await boundary.setup({ runtime: "v2", directory: "/tmp/odf" })
    expect(setup).toHaveBeenCalledWith({ runtime: "v2", directory: "/tmp/odf" })
  })
})
