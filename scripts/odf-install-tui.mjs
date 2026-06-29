#!/usr/bin/env node
/**
 * ODF Agent Team — TUI Installer
 *
 * Rich terminal UI for installing, updating, and uninstalling ODF.
 * Launched via: ./install.sh --tui
 *
 * Zero external dependencies — uses only Node.js built-ins:
 *   - fs, path, child_process
 *   - readline (for input)
 *   - ANSI escape codes (for colors/formatting)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// ─── ANSI helpers ─────────────────────────────────────────────────────────
const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const REVERSE = `${ESC}[7m`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

const fg = {
  cyan: `${ESC}[36m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  red: `${ESC}[31m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  white: `${ESC}[37m`,
  gray: `${ESC}[90m`,
};

const bg = {
  cyan: `${ESC}[46m`,
  green: `${ESC}[42m`,
  yellow: `${ESC}[43m`,
  red: `${ESC}[41m`,
  blue: `${ESC}[44m`,
};

// ─── Terminal utilities ────────────────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on('close', () => {
  process.stdout.write(SHOW_CURSOR);
  process.exit(0);
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function clearScreen() {
  process.stdout.write(CLEAR);
}

function colorize(text, color) {
  return `${color}${text}${RESET}`;
}

function header(text) {
  return `${BOLD}${fg.white}${bg.blue} ${text} ${RESET}`;
}

function bullet(label, value, color = fg.white) {
  return `  ${fg.cyan}•${RESET} ${BOLD}${label}:${RESET} ${color}${value}${RESET}`;
}

function divider() {
  return `  ${DIM}${'─'.repeat(56)}${RESET}`;
}

function progressBar(current, total, width = 30) {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  const bar = `${fg.green}${'█'.repeat(filled)}${RESET}${DIM}${'░'.repeat(empty)}${RESET}`;
  return `${bar} ${BOLD}${current}/${total}${RESET}`;
}

// ─── Config ────────────────────────────────────────────────────────────────
const CONFIG_DIR = process.env.ODF_DIR
  || process.env.ODF_CONFIG_DIR
  || path.join(process.env.HOME || '~', '.config', 'opencode');

const REPO = process.env.REPO || 'https://github.com/antoniodavid/odf-agent-team';
const BRANCH = process.env.BRANCH || 'main';

const COMPONENTS = [
  { name: 'registry',    label: 'Registry',         desc: 'odf-registry.json + cache', default: true },
  { name: 'agents',      label: 'Agents',           desc: 'Agents (orchestrator + sub-agents)', default: true },
  { name: 'skills',      label: 'Skills',            desc: 'OCA + ODF skills (31 files)', default: true },
  { name: 'commands',    label: 'Commands',          desc: 'Slash commands (/odf-*)', default: true },
  { name: 'plugins',     label: 'Plugin',            desc: 'odf-delegation.ts (runtime tools)', default: true },
  { name: 'scripts',     label: 'Scripts',           desc: 'Test runner + CLI + validators', default: true },
  { name: 'openspec',    label: 'OpenSpec',          desc: 'Spec/config templates', default: false },
  { name: 'codegraph',   label: 'CodeGraph',         desc: 'Community: code graph indexer', default: false },
];

const PROFILES = [
  { name: 'default', desc: 'deepseek-r1 for ASSESS/VERIFY, kimi-k2.6 for rest' },
  { name: 'cheap',   desc: 'kimi-k2.6 for all phases (faster, cheaper)' },
];

// ─── Install helpers ──────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  return execSync(cmd, {
    stdio: opts.silent ? 'pipe' : 'inherit',
    encoding: 'utf-8',
    ...opts,
  });
}

function detectExistingInstall() {
  return fs.existsSync(path.join(CONFIG_DIR, 'odf-registry.json'));
}

function getCurrentVersion() {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'odf-registry.json'), 'utf-8'));
    return reg.package?.version || 'unknown';
  } catch { return 'none'; }
}

function backupConfig() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(CONFIG_DIR, 'backups', `install-${stamp}`);
  if (!fs.existsSync(path.join(CONFIG_DIR, 'backups'))) {
    fs.mkdirSync(path.join(CONFIG_DIR, 'backups'), { recursive: true });
  }
  if (fs.existsSync(CONFIG_DIR)) {
    run(`cp -r "${CONFIG_DIR}" "${backupDir}"`, { silent: true });
  }
  return backupDir;
}

function downloadSource(destDir) {
  process.stdout.write(`\n  ${fg.yellow}⬇️  Downloading ODF Agent Team...${RESET}`);
  const url = `${REPO}/archive/${BRANCH}.tar.gz`;
  run(`curl -sL "${url}" | tar xz -C "${destDir}"`, { silent: true });
  let srcDir = path.join(destDir, `odf-agent-team-${BRANCH}`);
  if (!fs.existsSync(srcDir)) {
    const entries = fs.readdirSync(destDir).filter(e => e !== '.' && e !== '..');
    if (entries.length > 0) srcDir = path.join(destDir, entries[0]);
  }
  process.stdout.write(` ${fg.green}done${RESET}\n`);
  return srcDir;
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  const items = fs.readdirSync(src);
  for (const item of items) {
    const s = path.join(src, item);
    const d = path.join(dst, item);
    if (fs.statSync(s).isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDir(s, d);
    } else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

function installFiles(srcDir, components) {
  const mapping = {
    registry: { src: 'odf-registry.json', dst: path.join(CONFIG_DIR, 'odf-registry.json') },
    agents:   { src: 'agent',              dst: path.join(CONFIG_DIR, 'agent') },
    skills:   { src: 'skills',             dst: path.join(CONFIG_DIR, 'skills') },
    commands: { src: 'command',            dst: path.join(CONFIG_DIR, 'command') },
    plugins:  { src: 'plugins',            dst: path.join(CONFIG_DIR, 'plugins') },
    scripts:  { src: 'scripts',            dst: path.join(CONFIG_DIR, 'scripts') },
    openspec: { src: 'openspec',           dst: path.join(CONFIG_DIR, 'openspec') },
  };

  let count = 0;
  for (const comp of components) {
    if (comp === 'codegraph') continue; // handled separately
    const m = mapping[comp];
    if (!m) continue;
    const fullSrc = path.join(srcDir, m.src);
    if (!fs.existsSync(fullSrc)) continue;

    if (fs.statSync(fullSrc).isDirectory()) {
      fs.mkdirSync(m.dst, { recursive: true });
      copyDir(fullSrc, m.dst);
    } else {
      fs.mkdirSync(path.dirname(m.dst), { recursive: true });
      fs.copyFileSync(fullSrc, m.dst);
    }
    count++;
  }
  return count;
}

function installCodeGraph() {
  try {
    run('npm install -g @colbymchenry/codegraph@latest', { silent: true });
    return true;
  } catch {
    return false;
  }
}

// ─── TUI Screens ──────────────────────────────────────────────────────────

function showLogo() {
  console.log(`
${fg.cyan}${BOLD}
   ╔═══════════════════════════════════════════════════╗
   ║       ODF Agent Team  —  TUI Installer           ║
   ╚═══════════════════════════════════════════════════╝${RESET}
`);
}

function showFooter(commands) {
  console.log(`\n  ${DIM}${commands}${RESET}`);
}

async function confirmPrompt(msg) {
  const answer = await ask(`\n  ${fg.yellow}?${RESET} ${BOLD}${msg}${RESET} ${DIM}(Y/n)${RESET} `);
  return answer.toLowerCase() !== 'n' && answer !== '';
}

async function selectFromList(items, title, multi = false) {
  clearScreen();
  showLogo();
  console.log(`  ${header(title)}\n`);
  items.forEach((item, i) => {
    const checked = item.selected ? '✓' : ' ';
    const marker = multi ? `[${checked}]` : `${i + 1}.`;
    const color = item.selected ? fg.green : fg.gray;
    console.log(`  ${color}${marker} ${BOLD}${item.label}${RESET} ${color}${item.desc}${RESET}`);
  });
  console.log('');
  showFooter(multi ? 'space=toggle, enter=done' : 'enter number');

  return new Promise((resolve) => {
    const input = process.stdin;
    const rawMode = input.isRaw;

    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf-8');

    let selectedIdx = items.findIndex(i => i.selected);
    if (selectedIdx === -1) selectedIdx = 0;

    function renderLine(idx, label, desc, sel, active) {
      const checked = sel ? '✓' : ' ';
      const marker = multi ? `[${checked}]` : '';
      const prefix = active ? `${fg.cyan}▶${RESET}` : ' ';
      if (active) {
        return `  ${prefix} ${BOLD}${fg.white}${marker} ${label}${RESET}\n     ${fg.cyan}${desc}${RESET}`;
      }
      const color = sel ? fg.green : fg.gray;
      return `  ${prefix} ${color}${marker} ${label}${RESET}\n     ${color}${desc}${RESET}`;
    }

    const lines = items.map((item, i) => renderLine(i, item.label, item.desc, item.selected || false, i === selectedIdx));
    process.stdout.write(lines.join('\n') + '\n\n');

    function onData(key) {
      if (key === '\u001b[A' || key === 'k') { // up
        selectedIdx = Math.max(0, selectedIdx - 1);
        redraw();
      } else if (key === '\u001b[B' || key === 'j') { // down
        selectedIdx = Math.min(items.length - 1, selectedIdx + 1);
        redraw();
      } else if (key === ' ' && multi) {
        items[selectedIdx].selected = !items[selectedIdx].selected;
        redraw();
        return;
      } else if (key === '\r' || key === '\n') {
        input.setRawMode(rawMode);
        input.pause();
        process.stdout.write('\n');
        if (multi) {
          resolve(items.filter(i => i.selected).map(i => i.name));
        } else {
          resolve(items[selectedIdx].name);
        }
        return;
      }

      function redraw() {
        process.stdout.write(`${ESC}[${items.length * 2 + 1}A`);
        const rendered = items.map((item, i) => renderLine(i, item.label, item.desc, item.selected || false, i === selectedIdx));
        process.stdout.write('\x1b[0J' + rendered.join('\n') + '\n\n');
      }
    }

    input.on('data', onData);
  });
}

// ─── Screens ──────────────────────────────────────────────────────────────

async function modeSelection() {
  clearScreen();
  showLogo();

  const isInstalled = detectExistingInstall();
  const currentVer = getCurrentVersion();

  console.log(`  ${header('Detected')}`);
  console.log(`  ${bullet('Config dir', CONFIG_DIR)}`);
  console.log(`  ${bullet('Current version', isInstalled ? `v${currentVer}` : 'none', isInstalled ? fg.green : fg.yellow)}`);
  console.log(`  ${bullet('Status', isInstalled ? 'Installed' : 'Not installed', isInstalled ? fg.green : fg.red)}`);
  console.log();

  const items = [
    { name: 'install', label: 'Fresh Install', desc: isInstalled ? '⚠️ Will overwrite existing' : 'Install ODF to config dir', selected: !isInstalled },
    { name: 'update',  label: 'Update',        desc: isInstalled ? 'Pull latest + backup + update' : 'N/A — no existing install', selected: isInstalled },
    { name: 'uninstall', label: 'Uninstall',   desc: 'Remove ODF components (backup first)', selected: false },
  ];
  if (!isInstalled) items[1].selected = false;

  return await selectFromList(items, 'Select Mode', false);
}

async function componentSelection(mode) {
  if (mode !== 'install' && mode !== 'update') return [];

  const items = COMPONENTS.map(c => ({
    name: c.name,
    label: c.label,
    desc: c.desc,
    selected: mode === 'install' ? c.default : true,
  }));

  const selected = await selectFromList(items, 'Select Components', true);
  return selected;
}

async function profileSelection() {
  const items = PROFILES.map((p, i) => ({
    name: p.name,
    label: p.name === 'default' ? 'Default (Recommended)' : p.name,
    desc: p.desc,
    selected: i === 0,
  }));
  return await selectFromList(items, 'Model Profile', false);
}

async function showSummary(mode, components, profile) {
  clearScreen();
  showLogo();
  console.log(`  ${header('Summary')}\n`);
  console.log(`  ${bullet('Mode', mode === 'install' ? 'Fresh Install' : mode === 'update' ? 'Update' : 'Uninstall', fg.cyan)}`);
  if (mode !== 'uninstall') {
    console.log(`  ${bullet('Components', components.length > 0 ? components.join(', ') : 'none')}`);
    console.log(`  ${bullet('Profile', profile || 'default')}`);
  }
  console.log(`  ${bullet('Directory', CONFIG_DIR)}`);
  console.log(`  ${bullet('Source', `${REPO}/${BRANCH}`)}`);
  console.log();

  return await confirmPrompt('Proceed?');
}

async function installProgress(components) {
  clearScreen();
  showLogo();
  console.log(`  ${header('Installing')}\n`);

  // Download
  const tmpDir = fs.mkdtempSync('/tmp/odf-install-');
  process.stdout.write(`  ${progressBar(0, 5)}  Downloading...\n`);
  const srcDir = downloadSource(tmpDir);

  process.stdout.write(`${ESC}[A${progressBar(1, 5)}  ${fg.green}Downloaded${RESET}\n`);

  // Backup
  process.stdout.write(`${ESC}[A${progressBar(1, 5)}  Backing up...\n`);
  const backupDir = backupConfig();
  process.stdout.write(`${ESC}[A${progressBar(2, 5)}  ${fg.green}Backed up to ${backupDir}${RESET}\n`);

  // Install files
  process.stdout.write(`${ESC}[A${progressBar(2, 5)}  Installing files...\n`);
  const count = installFiles(srcDir, components);
  process.stdout.write(`${ESC}[A${progressBar(3, 5)}  ${fg.green}${count} components installed${RESET}\n`);

  // CodeGraph
  if (components.includes('codegraph')) {
    process.stdout.write(`${ESC}[A${progressBar(3, 5)}  Installing CodeGraph...\n`);
    const cgOk = installCodeGraph();
    process.stdout.write(`${ESC}[A${progressBar(4, 5)}  ${cgOk ? fg.green + 'CodeGraph installed' : fg.yellow + 'CodeGraph skipped (npm not found)'}${RESET}\n`);
  } else {
    process.stdout.write(`${ESC}[A${progressBar(4, 5)}  ${DIM}CodeGraph — skipped${RESET}\n`);
  }

  // npm install
  if (fs.existsSync(path.join(CONFIG_DIR, 'package.json'))) {
    process.stdout.write(`${ESC}[A${progressBar(4, 5)}  Running npm install...\n`);
    try { run(`cd "${CONFIG_DIR}" && npm install --no-audit --no-fund`, { silent: true }); }
    catch { /* non-fatal */ }
    process.stdout.write(`${ESC}[A${progressBar(5, 5)}  ${fg.green}npm install done${RESET}\n`);
  } else {
    process.stdout.write(`${ESC}[A${progressBar(5, 5)}  ${DIM}npm — no package.json${RESET}\n`);
  }

  // Self-test
  process.stdout.write(`\n  ${fg.yellow}🧪 Running self-test...${RESET}\n`);
  try {
    run(`node "${path.join(CONFIG_DIR, 'scripts', 'odf-test-runner.js')}"`, { silent: true });
    process.stdout.write(`  ${fg.green}✅ Self-test passed${RESET}\n`);
  } catch (e) {
    process.stdout.write(`  ${fg.red}❌ Self-test failed${RESET}\n`);
    process.stdout.write(`  ${DIM}${e.stderr?.split('\n').slice(0, 3).join('\n')}${RESET}\n`);
  }

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n  ${fg.green}${BOLD}Done!${RESET}`);
  return backupDir;
}

async function uninstallFlow() {
  clearScreen();
  showLogo();
  console.log(`  ${header('Uninstall')}\n`);

  const allComponents = COMPONENTS.filter(c => c.default || c.name === 'codegraph');
  const items = allComponents.map(c => ({
    name: c.name,
    label: c.label,
    desc: c.desc,
    selected: true,
  }));

  const toRemove = await selectFromList(items, 'Select Components to Remove', true);
  if (toRemove.length === 0) {
    console.log(`\n  ${fg.yellow}Nothing to remove.${RESET}`);
    return;
  }

  console.log(`\n  ${fg.yellow}Creating backup...${RESET}`);
  const backupDir = backupConfig();

  const mapping = {
    registry: 'odf-registry.json',
    agents:   'agent',
    skills:   'skills',
    commands: 'command',
    plugins:  'plugins/odf-delegation.ts',
    scripts:  'scripts',
    openspec: 'openspec',
  };

  let removed = 0;
  for (const comp of toRemove) {
    const target = mapping[comp];
    if (!target) continue;
    const fullPath = path.join(CONFIG_DIR, target);
    if (fs.existsSync(fullPath)) {
      if (comp === 'plugins') {
        // Only remove odf-delegation.ts, not other plugins
        const pluginFile = path.join(CONFIG_DIR, 'plugins', 'odf-delegation.ts');
        if (fs.existsSync(pluginFile)) fs.unlinkSync(pluginFile);
      } else {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
      removed++;
      console.log(`  ${fg.red}✕${RESET} Removed: ${target}`);
    }
  }

  console.log(`\n  ${fg.green}${BOLD}${removed} components removed${RESET}`);
  console.log(`  ${DIM}Backup: ${backupDir}${RESET}`);
  if (await confirmPrompt('Remove backup as well?')) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    console.log(`  ${fg.yellow}Backup removed.${RESET}`);
  }
}

async function installFlow(mode) {
  const components = await componentSelection(mode);
  if (components.length === 0) {
    console.log(`\n  ${fg.yellow}No components selected. Aborting.${RESET}`);
    return;
  }

  const profile = await profileSelection();

  const proceed = await showSummary(mode, components, profile);
  if (!proceed) {
    console.log(`\n  ${fg.yellow}Cancelled.${RESET}`);
    return;
  }

  const backupDir = await installProgress(components);
  await showResult(mode, backupDir);
}

async function showResult(mode, backupDir) {
  clearScreen();
  showLogo();
  console.log(`  ${header(mode === 'install' ? 'Install Complete' : 'Update Complete')}\n`);
  console.log(`  ${bullet('Version', `v${getCurrentVersion()}`)}`);
  console.log(`  ${bullet('Directory', CONFIG_DIR)}`);
  console.log(`  ${bullet('Backup', backupDir)}`);
  console.log(`\n  ${divider()}\n`);
  console.log(`  ${fg.yellow}Next steps:${RESET}`);
  console.log(`  ${fg.cyan}  1.${RESET} Open OpenCode in your Odoo project`);
  console.log(`  ${fg.cyan}  2.${RESET} Run /odf-init to detect project context`);
  console.log(`  ${fg.cyan}  3.${RESET} Run /odf-health to verify everything works`);
  console.log(`  ${fg.cyan}  4.${RESET} Run /odf-new my-feature to start your first change\n`);

  await ask(`  ${DIM}Press Enter to exit${RESET}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(HIDE_CURSOR);

  try {
    const mode = await modeSelection();

    switch (mode) {
      case 'install':
      case 'update':
        await installFlow(mode);
        break;
      case 'uninstall':
        await uninstallFlow();
        break;
    }
  } catch (err) {
    process.stdout.write(SHOW_CURSOR);
    console.error(`\n  ${fg.red}${BOLD}Error:${RESET} ${err.message}`);
    process.exit(1);
  }

  process.stdout.write(SHOW_CURSOR);
  rl.close();
}

main();
