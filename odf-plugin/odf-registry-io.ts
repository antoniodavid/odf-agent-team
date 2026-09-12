/**
 * Registry I/O: path, TTL cache with hot-reload watcher, and the refresh
 * fingerprint cache (P0.2/P0.3). Extracted from plugins/odf-delegation.ts —
 * behavior unchanged.
 */

import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as path from "node:path"
import { debugLog, getOdfConfigDir, resolvePath, type ODFRegistry } from "./odf-delegation-shared.js"

export const REGISTRY_PATH = path.join(getOdfConfigDir(), "odf-registry.json")

// Registry cache with TTL (5 seconds) to avoid disk reads on every tool call
let registryCache: ODFRegistry | null = null
let registryCacheTime = 0
const REGISTRY_CACHE_TTL_MS = 5000

// Hot-reload: watch registry file for changes
let registryWatcher: fsSync.FSWatcher | null = null
function startRegistryWatcher(): void {
  if (registryWatcher) return
  try {
    registryWatcher = fsSync.watch(REGISTRY_PATH, (eventType) => {
      if (eventType === "change") {
        resetRegistryCache()
        debugLog(`[odf-delegation] Registry changed on disk. Cache invalidated.`)
      }
    })
  } catch {
    // Registry file may not exist yet — watcher will be started on first load
  }
}

/** Invalidate the in-memory registry cache (used by the watcher and startup refresh). */
export function resetRegistryCache(): void {
  registryCache = null
  registryCacheTime = 0
}

export async function loadRegistry(): Promise<ODFRegistry | null> {
  const now = Date.now()
  if (registryCache && (now - registryCacheTime) < REGISTRY_CACHE_TTL_MS) {
    return registryCache
  }
  try {
    const data = await fs.readFile(REGISTRY_PATH, "utf8")
    const parsed = JSON.parse(data) as ODFRegistry
    const registryDir = path.dirname(REGISTRY_PATH)

    // Resolve relative skill/agent paths against the registry directory
    for (const skill of parsed.skills || []) {
      skill.path = resolvePath(registryDir, skill.path)
    }
    for (const agent of parsed.agents || []) {
      agent.path = resolvePath(registryDir, agent.path)
    }

    registryCache = parsed
    registryCacheTime = now
    startRegistryWatcher()
    return parsed
  } catch (err) {
    if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    console.warn(`[odf-delegation] Registry at ${REGISTRY_PATH} is unreadable or corrupt: ${err}`)
    return null
  }
}

// ==========================================
// CACHE FINGERPRINT (P0.3: Startup perf)
// ==========================================

const CACHE_FILE = path.join(getOdfConfigDir(), ".registry-cache.json")

export interface CacheEntry {
  path: string
  mtime: string
  size: number
}

export interface RegistryCache {
  timestamp: string
  last_refresh: string
  skills: CacheEntry[]
  permissions_fingerprint: string
}

export async function loadRegistryCache(): Promise<RegistryCache | null> {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf8")
    return JSON.parse(data)
  } catch {
    return null
  }
}

export async function saveRegistryCache(cache: RegistryCache): Promise<void> {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8")
  } catch {
    // Cache file is optional
  }
}

export async function computePermissionsFingerprint(registry: ODFRegistry): Promise<string> {
  // Include rule content so cache invalidation follows behavior, not only metadata.
  const parts = registry.skills.map(s => JSON.stringify({
    name: s.name,
    version: (s as any).version || "1.0",
    triggers: s.triggers,
    compact_rules: s.compact_rules,
  })).sort()
  const hash = await crypto.subtle?.digest?.("SHA-256", new TextEncoder().encode(parts.join("|")))
  if (hash) {
    return Array.from(new Uint8Array(hash)).slice(0, 8).map(b => b.toString(16)).join("")
  }
  return parts.length.toString()
}

export async function hasSkillsChanged(): Promise<boolean> {
  const cache = await loadRegistryCache()
  if (!cache) return true

  const skillsDir = path.join(getOdfConfigDir(), "skills")
  try {
    const entries = await fs.readdir(skillsDir, { recursive: true })
    const skillFiles = entries.filter(e => e.endsWith("SKILL.md"))

    for (const file of skillFiles) {
      const fullPath = path.join(skillsDir, file)
      try {
        const stat = await fs.stat(fullPath)
        const cached = cache.skills.find(c => c.path === fullPath)
        if (!cached || cached.mtime !== stat.mtime.toISOString() || cached.size !== stat.size) {
          return true
        }
      } catch {
        return true
      }
    }

    // Check for removed skills
    if (skillFiles.length !== cache.skills.length) return true

    return false
  } catch {
    return false
  }
}
