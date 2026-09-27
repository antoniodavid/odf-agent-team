import { afterEach, describe, expect, it, vi } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { findOtherPackRoots, hasPackRegistry, resolveOdfConfigDir } from "./config-dir.js"

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function makePack(prefix: string): string {
  const dir = tempDir(prefix)
  fs.writeFileSync(path.join(dir, "odf-registry.json"), "{}\n")
  return dir
}

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("resolveOdfConfigDir", () => {
  it("prefers an absolute ODF_CONFIG_DIR over every other candidate", () => {
    const pack = makePack("odf-cfg-override-")
    tempDirs.push(pack)

    const resolved = resolveOdfConfigDir({ ODF_CONFIG_DIR: pack }, { packRoot: "/somewhere/else" })

    expect(resolved).toEqual({ dir: path.normalize(pack), source: "ODF_CONFIG_DIR", ignored: "" })
  })

  it("ignores a relative ODF_CONFIG_DIR and reports it for the caller to warn about", () => {
    const resolved = resolveOdfConfigDir({ ODF_CONFIG_DIR: "relative/pack" }, { packRoot: null })

    expect(resolved.ignored).toBe("relative/pack")
    expect(resolved.source).toBe("home")
    expect(resolved.dir).toBe(path.join(os.homedir(), ".config", "opencode"))
  })

  it("selects a project-local pack by location when ODF_CONFIG_DIR is not set", () => {
    // This is the `--scope project` layout running WITHOUT the launcher: the
    // pack ships the resolver, so `<project>/.opencode` is picked up on its own.
    const projectPack = makePack("odf-cfg-project-")
    tempDirs.push(projectPack)

    const resolved = resolveOdfConfigDir({}, { packRoot: projectPack })

    expect(resolved).toEqual({ dir: path.normalize(projectPack), source: "pack", ignored: "" })
  })

  it("skips self-location when the directory does not look like a pack", () => {
    const notAPack = tempDir("odf-cfg-empty-")
    tempDirs.push(notAPack)

    const resolved = resolveOdfConfigDir({ XDG_CONFIG_HOME: "/tmp/odf-xdg" }, { packRoot: notAPack })

    expect(resolved.source).toBe("XDG_CONFIG_HOME")
    expect(resolved.dir).toBe("/tmp/odf-xdg/opencode")
  })

  it("disables self-location entirely when packRoot is null", () => {
    const resolved = resolveOdfConfigDir({ XDG_CONFIG_HOME: "/tmp/odf-xdg" }, { packRoot: null })

    expect(resolved.source).toBe("XDG_CONFIG_HOME")
    expect(resolved.dir).toBe("/tmp/odf-xdg/opencode")
  })

  it("uses XDG_CONFIG_HOME/opencode when there is neither an override nor a pack", () => {
    const resolved = resolveOdfConfigDir({ XDG_CONFIG_HOME: "/tmp/odf-xdg" }, { packRoot: null })

    expect(resolved).toEqual({ dir: "/tmp/odf-xdg/opencode", source: "XDG_CONFIG_HOME", ignored: "" })
  })

  it("falls back to ~/.config/opencode when XDG_CONFIG_HOME is relative", () => {
    const resolved = resolveOdfConfigDir({ XDG_CONFIG_HOME: "relative" }, { packRoot: null })

    expect(resolved).toEqual({
      dir: path.join(os.homedir(), ".config", "opencode"),
      source: "home",
      ignored: "",
    })
  })

  it("falls back to ~/.config/opencode when nothing is configured", () => {
    const resolved = resolveOdfConfigDir({}, { packRoot: null })

    expect(resolved).toEqual({
      dir: path.join(os.homedir(), ".config", "opencode"),
      source: "home",
      ignored: "",
    })
  })
})

describe("hasPackRegistry", () => {
  it("accepts only an absolute directory that carries the registry", () => {
    const pack = makePack("odf-cfg-hasreg-")
    tempDirs.push(pack)
    const bare = tempDir("odf-cfg-bare-")
    tempDirs.push(bare)

    expect(hasPackRegistry(pack)).toBe(true)
    expect(hasPackRegistry(bare)).toBe(false)
    expect(hasPackRegistry("relative/path")).toBe(false)
    expect(hasPackRegistry("")).toBe(false)
  })
})

describe("findOtherPackRoots", () => {
  it("reports packs under XDG_CONFIG_HOME other than the resolved one", () => {
    const xdgBase = tempDir("odf-cfg-xdgbase-")
    tempDirs.push(xdgBase)
    const xdgPack = path.join(xdgBase, "opencode")
    fs.mkdirSync(xdgPack, { recursive: true })
    fs.writeFileSync(path.join(xdgPack, "odf-registry.json"), "{}\n")

    const current = path.join(os.homedir(), ".config", "opencode")
    const others = findOtherPackRoots(current, { XDG_CONFIG_HOME: xdgBase })

    expect(others).toContain(xdgPack)
    expect(others).not.toContain(current)
  })

  it("never reports the directory that was already resolved", () => {
    const xdgBase = tempDir("odf-cfg-xdgbase2-")
    tempDirs.push(xdgBase)
    const xdgPack = path.join(xdgBase, "opencode")
    fs.mkdirSync(xdgPack, { recursive: true })
    fs.writeFileSync(path.join(xdgPack, "odf-registry.json"), "{}\n")

    expect(findOtherPackRoots(xdgPack, { XDG_CONFIG_HOME: xdgBase })).not.toContain(xdgPack)
  })
})

describe("getOdfConfigDir (plugin runtime)", () => {
  let originalConfigDir: string | undefined

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.ODF_CONFIG_DIR
    else process.env.ODF_CONFIG_DIR = originalConfigDir
  })

  it("follows the shared resolver for an absolute override", async () => {
    originalConfigDir = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = "/tmp/odf-alias-pack"

    const { getOdfConfigDir } = await import("../../odf-plugin/odf-delegation-shared.js")

    expect(getOdfConfigDir()).toBe("/tmp/odf-alias-pack")
  })

  it("warns and keeps resolving when the override is relative", async () => {
    originalConfigDir = process.env.ODF_CONFIG_DIR
    process.env.ODF_CONFIG_DIR = "relative/pack"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const { getOdfConfigDir } = await import("../../odf-plugin/odf-delegation-shared.js")
    const dir = getOdfConfigDir()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ODF_CONFIG_DIR "relative/pack" is not absolute'))
    // Without an absolute override the resolver lands on the pack that ships
    // this module (the repository checkout, which carries a registry).
    expect(path.isAbsolute(dir)).toBe(true)
  })
})
