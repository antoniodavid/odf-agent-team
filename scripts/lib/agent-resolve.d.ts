export const STOP_WORDS: Set<string>
export function filterStopWords(keywords: string[]): string[]
export const DEFAULT_AGENTS: Record<string, string>
interface ResolvedAgent {
  name: string
  installed?: boolean
  phases?: string[]
  routing_triggers?: string[]
  description?: string
}
type AgentSelection =
  | { valid: true; reason: null; agent: ResolvedAgent }
  | { valid: false; reason: string; agent: null }
export function validateAgentSelection(
  registry: { agents?: ResolvedAgent[] },
  phase: string,
  agentName: unknown,
): AgentSelection
export function resolveAgent(
  registry: { agents?: ResolvedAgent[] },
  phase: string,
  taskKeywords: string[],
): string | null
