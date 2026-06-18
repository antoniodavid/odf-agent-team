#!/usr/bin/env node
/**
 * ODF Registry Validator
 *
 * Loads odf-registry.json and verifies that every registered path
 * (skills, agents, commands, capabilities) resolves to an existing file.
 * Relative paths are resolved against the directory containing the registry.
 * Absolute paths are validated as-is.
 *
 * Usage: node scripts/odf-registry-validate.js
 * Exit code: 0 if all paths are valid, 1 otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

function getConfigDir() {
  const envDir = process.env.ODF_CONFIG_DIR?.trim();
  if (envDir) {
    if (path.isAbsolute(envDir)) return path.normalize(envDir);
    console.warn(`ODF_CONFIG_DIR "${envDir}" is not absolute; using default.`);
  }
  return path.join(os.homedir(), '.config', 'opencode');
}

function resolveEntry(registryDir, entryPath) {
  if (!entryPath) return '';
  if (entryPath.includes('..')) return '';

  let resolved;
  if (path.isAbsolute(entryPath)) {
    resolved = path.normalize(entryPath);
  } else if (entryPath.startsWith('~/')) {
    resolved = path.normalize(path.join(os.homedir(), entryPath.slice(2)));
  } else {
    resolved = path.resolve(registryDir, entryPath);
  }

  const allowedRoots = [path.normalize(registryDir), getConfigDir()];
  if (!allowedRoots.some(root => resolved === root || resolved.startsWith(root + path.sep))) {
    return '';
  }
  return resolved;
}

function validateCollection(registryDir, entries, kind) {
  const missing = [];
  for (const entry of entries || []) {
    const entryPath = entry.path || (typeof entry === 'string' ? entry : '');
    const name = entry.name || entryPath;
    const resolved = resolveEntry(registryDir, entryPath);
    if (!resolved) {
      missing.push({ name, path: entryPath, reason: 'path resolution rejected' });
    } else if (!fs.existsSync(resolved)) {
      missing.push({ name, path: entryPath, resolved, reason: 'file does not exist' });
    }
  }
  if (missing.length > 0) {
    console.error(`\n❌ ${kind}: ${missing.length} invalid path(s)`);
    for (const m of missing) {
      console.error(`   - ${m.name}: ${m.path}`);
      if (m.resolved) console.error(`     resolved: ${m.resolved}`);
      console.error(`     reason: ${m.reason}`);
    }
  }
  return missing;
}

function main() {
  const configDir = getConfigDir();
  const registryPath = path.join(configDir, 'odf-registry.json');

  if (!fs.existsSync(registryPath)) {
    console.error(`❌ Registry not found at ${registryPath}`);
    process.exit(1);
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (err) {
    console.error(`❌ Failed to parse registry: ${err.message}`);
    process.exit(1);
  }

  const registryDir = path.dirname(registryPath);
  console.log(`🔍 Validating registry at ${registryPath}`);
  console.log(`   Base directory: ${registryDir}`);

  let totalMissing = 0;

  if (!registry.package) {
    console.warn('⚠️  Registry is missing the "package" metadata section');
  } else {
    console.log(`   Package: ${registry.package.name}@${registry.package.version}`);
  }

  if (!registry.flags || typeof registry.flags.use_relative_paths !== 'boolean') {
    console.warn('⚠️  Registry flags.use_relative_paths is not a boolean');
  } else {
    console.log(`   use_relative_paths: ${registry.flags.use_relative_paths}`);
  }

  totalMissing += validateCollection(registryDir, registry.skills, 'Skills').length;
  totalMissing += validateCollection(registryDir, registry.agents, 'Agents').length;
  totalMissing += validateCollection(registryDir, registry.commands, 'Commands').length;
  totalMissing += validateCollection(registryDir, registry.capabilities, 'Capabilities').length;

  console.log('');
  if (totalMissing === 0) {
    console.log('✅ All registered paths are valid.');
    process.exit(0);
  }
  console.error(`❌ Registry validation failed with ${totalMissing} missing path(s).`);
  process.exit(1);
}

main();
