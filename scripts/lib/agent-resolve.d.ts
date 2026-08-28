export const STOP_WORDS: Set<string>
export const MAX_ROUTING_KEYWORDS: number
export const MAX_ROUTING_KEYWORD_LENGTH: number
export function filterStopWords(keywords: unknown): string[]
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
  taskKeywords: unknown,
): string | null
