import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

describe("ODF plugin V2 entrypoint", () => {
  let configDir: string
  let previousConfigDir: string | undefined

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), "odf-plugin-entrypoint-"))
    previousConfigDir = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = configDir
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.clearAllTimers()
    vi.useRealTimers()
    if (previousConfigDir === undefined) delete process.env.ODF_CONFIG_DIR
    else process.env.ODF_CONFIG_DIR = previousConfigDir
    await fs.rm(configDir, { recursive: true, force: true })
  })

  it("exports one stable V2 entrypoint and warms the runtime on demand", { timeout: 20_000 }, async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const module = await import("../plugins/odf-delegation.js")

    expect(module.default).toEqual({
      id: "odf-delegation",
      setup: module.OdfDelegationPluginV2.setup,
    })
    expect(module.default).not.toHaveProperty("server")
    expect(module.default).not.toHaveProperty("tui")

    // Registry/telemetry warm-up used to live in the retired V1 `server`
    // entrypoint; the V2 setup path now runs it.
    expect(typeof module.startOdfRuntime).toBe("function")
    await expect(module.startOdfRuntime()).resolves.toBeUndefined()

    warn.mockRestore()
    log.mockRestore()
  })

  it("tolerates a registry without a skills array in the permissions fingerprint", async () => {
    const { computePermissionsFingerprint } = await import("../odf-plugin/odf-registry-io.js")

    await expect(computePermissionsFingerprint({} as never)).resolves.toEqual(expect.any(String))
  })

  it("resolves the runtime warm-up with a registry that has no skills array", { timeout: 20_000 }, async () => {
    // `loadRegistry` returns any parseable JSON as-is, so `{}` used to make the
    // warm-up throw from computePermissionsFingerprint and fail plugin setup.
    await fs.writeFile(path.join(configDir, "odf-registry.json"), "{}\n", "utf8")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.resetModules()
    const module = await import("../plugins/odf-delegation.js")

    await expect(module.startOdfRuntime()).resolves.toBeUndefined()

    warn.mockRestore()
  })

  it("defers the V1 entrypoint import until V2 setup to prevent the Bun load-time TDZ", async () => {
    const adapterSource = await fs.readFile(new URL("./opencode-v2-adapter.ts", import.meta.url), "utf8")
    const setupStart = adapterSource.indexOf("export async function setupODFV2")
    const transformStart = adapterSource.indexOf("context.tool.transform", setupStart)
    const dynamicImport = adapterSource.indexOf('await import("../plugins/odf-delegation.js")', setupStart)

    expect(setupStart).toBeGreaterThanOrEqual(0)
    expect(adapterSource.slice(0, setupStart)).not.toContain('from "../plugins/odf-delegation.js"')
    expect(dynamicImport).toBeGreaterThan(setupStart)
    expect(dynamicImport).toBeLessThan(transformStart)
  })

})
