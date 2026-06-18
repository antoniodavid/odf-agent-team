export interface TokenizeResult {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export interface ParsedCommand {
  error?: string;
  command?: string;
  change?: string | null;
  description?: string | null;
  fast?: boolean;
  topic?: string;
  version?: number | null;
  module?: string | null;
}

export function tokenize(argv: string[]): TokenizeResult;
export function parseCommand(argv: string[]): ParsedCommand;
export function buildOrchestratorPrompt(parsed: ParsedCommand): string;
