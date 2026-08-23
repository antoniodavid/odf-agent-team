export const STOP_WORDS: Set<string>
export function filterStopWords(keywords: string[]): string[]
export const DEFAULT_AGENTS: Record<string, string>
export function resolveAgent(
  registry: { agents?: Array<{ name: string; installed?: boolean; phases?: string[]; description?: string }> },
  phase: string,
  taskKeywords: string[],
): string | null
