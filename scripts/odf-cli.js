#!/usr/bin/env node
/**
 * ODF CLI wrapper — minimal command parser and orchestrator router.
 *
 * Usage:
 *   node scripts/odf-cli.js <command> [args]
 *   odf <command> [args]
 *
 * Supported commands:
 *   new <change-name> ["description"] [--fast]
 *   continue [change-name]
 *   status [change-name]
 *   explore <topic> [--version N] [--module M]
 *
 * The wrapper only parses arguments and emits the orchestrator routing
 * envelope. It does not run the orchestrator itself.
 */

/**
 * Tokenize a raw command line into positional and flag arguments.
 * Supports quoted strings and --key value pairs.
 */
export function tokenize(argv) {
  const positionals = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags };
}

/**
 * Parse a raw CLI invocation into a structured command object.
 */
export function parseCommand(argv) {
  if (!argv || argv.length === 0) {
    return { error: 'Comando faltante. Usá: odf <new|continue|status|explore> [args]' };
  }

  const rawCommand = argv[0].replace(/^\//, '').replace(/^odf-/, '');
  const { positionals, flags } = tokenize(argv.slice(1));

  switch (rawCommand) {
    case 'new': {
      if (positionals.length === 0) {
        return { error: 'Falta el nombre del cambio. Uso: odf new <change-name> ["description"] [--fast]' };
      }
      const change = positionals[0];
      const description = positionals.slice(1).join(' ') || null;
      return {
        command: 'odf-new',
        change,
        description,
        fast: flags.fast === true,
      };
    }

    case 'continue': {
      return {
        command: 'odf-continue',
        change: positionals[0] || null,
      };
    }

    case 'status': {
      return {
        command: 'odf-status',
        change: positionals[0] || null,
      };
    }

    case 'explore': {
      if (positionals.length === 0) {
        return { error: 'Falta el tema a explorar. Uso: odf explore <topic> [--version N] [--module M]' };
      }
      const topic = positionals.join(' ');
      const version = flags.version ? parseInt(flags.version, 10) : null;
      const module = flags.module || null;
      if (version !== null && Number.isNaN(version)) {
        return { error: 'La versión debe ser un número entero.' };
      }
      return {
        command: 'odf-explore',
        topic,
        version,
        module,
      };
    }

    default:
      return { error: `Comando desconocido: ${rawCommand}. Usá: new, continue, status o explore.` };
  }
}

/**
 * Build the orchestrator handoff prompt from a parsed command.
 */
export function buildOrchestratorPrompt(parsed) {
  if (parsed.error) {
    return `❌ ${parsed.error}`;
  }

  const lines = [
    '## ODF Command Routing',
    '',
    `- **command**: ${parsed.command}`,
  ];

  if (parsed.command === 'odf-new') {
    lines.push(`- **change**: ${parsed.change}`);
    lines.push(`- **description**: ${parsed.description || '(none)'}`);
    lines.push(`- **fast**: ${parsed.fast}`);
    lines.push('', `Start change "${parsed.change}". Description: ${parsed.description || '(none)'}. Fast mode: ${parsed.fast}.`);
  } else if (parsed.command === 'odf-continue') {
    lines.push(`- **change**: ${parsed.change || '(latest active)'}`);
    lines.push('', `Continue change ${parsed.change || 'latest active change'}.`);
  } else if (parsed.command === 'odf-status') {
    lines.push(`- **change**: ${parsed.change || '(all active)'}`);
    lines.push('', `Show status for ${parsed.change || 'all active changes'}.`);
  } else if (parsed.command === 'odf-explore') {
    lines.push(`- **topic**: ${parsed.topic}`);
    lines.push(`- **version**: ${parsed.version || '(project default)'}`);
    lines.push(`- **module**: ${parsed.module || '(none)'}`);
    lines.push('', `Explore topic '${parsed.topic}' for Odoo ${parsed.version || 'project version'} in module ${parsed.module || 'any'}.`);
  }

  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const parsed = parseCommand(args);
  const prompt = buildOrchestratorPrompt(parsed);
  console.log(prompt);
  if (parsed.error) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
