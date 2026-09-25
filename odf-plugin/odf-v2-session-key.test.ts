import { describe, expect, it, vi } from "vitest"

/**
 * `ODF_V2_SESSION` used to be a per-record `Symbol("odf.v2.session")`.
 *
 * The OpenCode V2 host can evaluate the plugin graph into more than one module
 * record inside the same process. The handle is then attached with one record's
 * symbol and read with another's, so `odf_health` reported `v2_session:
 * unavailable` with `detail: "context.session was not attached to the tool
 * context"` even though the value was sitting on the tool context — it was
 * observed in a long-lived shared service with the same pack that reports
 * `context.session` in a fresh private server.
 *
 * A well-known key (`Symbol.for`) keeps the property out of `Object.keys` and
 * JSON while making identity stable across records. The value stays
 * per-tool-context state, so nothing is shared across contexts.
 */
describe("ODF_V2_SESSION key", () => {
  it("is a well-known symbol", async () => {
    const { ODF_V2_SESSION } = await import("./odf-delegation-health.js")

    expect(ODF_V2_SESSION).toBe(Symbol.for("odf.v2.session"))
    expect(String(ODF_V2_SESSION)).toBe("Symbol(odf.v2.session)")
  })

  it("keeps the same identity after the plugin graph is re-evaluated", async () => {
    const before = (await import("./odf-delegation-health.js")).ODF_V2_SESSION
    vi.resetModules()
    const after = (await import("./odf-delegation-health.js")).ODF_V2_SESSION

    // This is the red-green guard: a plain Symbol() fails it, because the second
    // record mints a different identity for the same description.
    expect(after).toBe(before)
  })

  it("stays hidden from Object.keys and JSON on a tool context", async () => {
    const { ODF_V2_SESSION } = await import("./odf-delegation-health.js")
    const context = { sessionID: "s1", task: () => undefined }
    ;(context as unknown as Record<PropertyKey, unknown>)[ODF_V2_SESSION] = { get: () => undefined }

    expect(Object.keys(context)).toEqual(["sessionID", "task"])
    expect(JSON.stringify(context)).toBe('{"sessionID":"s1"}')
    expect(Reflect.get(context, ODF_V2_SESSION)).toEqual({ get: expect.any(Function) })
  })
})
