import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

describe("ODF plugin V1 entrypoint", () => {
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

  it("exports a server-only V1 object and registers every ODF tool", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const module = await import("../plugins/odf-delegation.js")

    expect(module.default).toEqual({
      id: "odf-delegation",
      server: module.OdfDelegationPlugin,
    })
    expect(module.default).not.toHaveProperty("tui")

    const hooks = await module.default.server({
      directory: configDir,
      client: { session: { abort: vi.fn() } },
    } as any)

    expect(Object.keys(hooks.tool ?? {})).toEqual(expect.arrayContaining([...module.ODF_REGISTERED_TOOLS]))
    expect(Object.keys(hooks.tool ?? {})).toHaveLength(module.ODF_REGISTERED_TOOLS.length)

    await hooks.dispose?.()
    warn.mockRestore()
    log.mockRestore()
  })
})
