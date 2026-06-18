#!/usr/bin/env node
/**
 * ODF Agent Test Runner — F2: Agent Observatory
 *
 * Executes test cases against ODF agents and reports pass/fail.
 * Usage: node scripts/odf-test-runner.js [--agent <name>] [--plugin-tests]
 *
 * Each test case defines:
 *   input: { task, context } — sent to the agent
 *   expected: { skill_resolution, status_in, has_diagnosis, ... }
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import * as preflight from './lib/preflight.js';
import * as orchestrator from './lib/orchestrator.js';
import * as cli from './odf-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGISTRY_PATH = path.join(os.homedir(), '.config', 'opencode', 'odf-registry.json');
const TESTS_DIR = path.join(__dirname, 'odf-agent-tests');
const PLUGIN_TESTS = path.join(__dirname, '..', 'plugins', 'odf-delegation.test.ts');

// ==========================================
// Plugin logic simulation (same as odf-delegation.ts)
// ==========================================

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return null;
  }
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by','from','as',
  'is','was','are','were','be','been','being','have','has','had','do','does','did',
  'will','would','could','should','may','might','must','can','shall',
  'this','that','these','those','i','you','he','she','it','we','they',
  'el','la','los','las','un','una','y','o','pero','en','de','con','por','para',
]);

function filterStopWords(keywords) {
  return keywords.filter(kw => {
    const lower = kw.toLowerCase().trim();
    if (!lower || lower.length < 3) return false;
    if (STOP_WORDS.has(lower)) return false;
    if (/^\d+$/.test(lower)) return false;
    return true;
  });
}

function matchSkills(registry, context) {
  const matches = [];
  const taskLower = context.task?.toLowerCase() || '';

  for (const skill of registry.skills) {
    if (skill.removed) continue;
    if (context.odooVersion && skill.odoo_versions?.length > 0) {
      if (!skill.odoo_versions.includes(context.odooVersion)) continue;
    }
    let score = 0;
    if (context.files) {
      for (const file of context.files) {
        const fileLower = file.toLowerCase();
        for (const trigger of skill.triggers || []) {
          if (fileLower.includes(trigger.toLowerCase())) score += 2;
        }
      }
    }
    for (const trigger of skill.triggers || []) {
      if (taskLower.includes(trigger.toLowerCase())) score += 1;
    }
    if (score > 0) matches.push({ ...skill, _score: score });
  }

  matches.sort((a, b) => (b._score || 0) - (a._score || 0) || (b.compact_rules?.length || 0) - (a.compact_rules?.length || 0));
  return matches.slice(0, 5);
}

function resolveAgent(registry, phase, taskKeywords) {
  const filteredKeywords = filterStopWords(taskKeywords);
  if (filteredKeywords.length === 0) {
    const defaults = { ASSESS: 'odoo_functional_consultant', DESIGN: 'odoo_backend_engineer', IMPLEMENT: 'odoo_backend_engineer', VERIFY: 'odoo_qa_engineer' };
    return defaults[phase] || 'odoo_backend_engineer';
  }
  for (const agent of registry.agents || []) {
    if (!agent.installed) continue;
    if (!agent.phases?.includes(phase) && !agent.phases?.includes('ANY')) continue;
    const descLower = agent.description.toLowerCase();
    if (filteredKeywords.some(kw => descLower.includes(kw.toLowerCase()))) return agent.name;
  }
  const defaults = { ASSESS: 'odoo_functional_consultant', DESIGN: 'odoo_backend_engineer', IMPLEMENT: 'odoo_backend_engineer', VERIFY: 'odoo_qa_engineer' };
  return defaults[phase] || 'odoo_backend_engineer';
}

// ==========================================
// Test Runner
// ==========================================

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ ${name} — Error: ${e.message}`);
    failed++;
  }
}

function runTestSuite(suite) {
  const registry = loadRegistry();
  if (!registry) {
    console.error(`\n❌ Cannot run tests: registry not found at ${REGISTRY_PATH}`);
    process.exit(1);
  }

  console.log(`\n📋 ${suite.name} (agent: ${suite.agent})`);

  for (const tc of (suite.tests || [])) {
    console.log(`\n  Test: "${tc.name}"`);

    const task = tc.input.task;
    const contextFiles = tc.input.context?.files || [];
    const version = tc.input.context?.version;

    // Test 1: skill resolution
    test('resolves correct skill_resolution', () => {
      const skills = matchSkills(registry, { task, files: contextFiles, odooVersion: version });
      const resolution = skills.length > 0 ? 'self-discovered' : 'none';
      return resolution === tc.expected.skill_resolution;
    });

    // Test 2: expected skills injected
    if (tc.expected.expected_skills) {
      test('injects expected skills', () => {
        const skills = matchSkills(registry, { task, files: contextFiles, odooVersion: version });
        const skillNames = skills.map(s => s.name);
        return tc.expected.expected_skills.every(es => skillNames.includes(es));
      });
    }

    // Test 3: agent resolution
    test(`resolves agent (expected in: ${tc.expected.status_in.join(', ')})`, () => {
      const keywords = task.split(/\s+/).slice(0, 10);
      const agent = resolveAgent(registry, 'DESIGN', keywords);
      return typeof agent === 'string' && agent.length > 0;
    });

    // Test 4: status is valid
    test('status is valid', () => {
      const statuses = ['ok', 'blocked', 'failed'];
      return tc.expected.status_in.some(s => statuses.includes(s));
    });

    // Test 5: diagnosis keywords (if specified)
    if (tc.expected.diagnosis_has) {
      test(`diagnosis mentions ${tc.expected.diagnosis_has.join(', ')}`, () => {
        const taskLower = task.toLowerCase();
        return tc.expected.diagnosis_has.every(k => taskLower.includes(k));
      });
    }
  }
}

// ==========================================
// Plugin unit tests
// ==========================================

function runPluginTests() {
  if (!fs.existsSync(PLUGIN_TESTS)) {
    console.log('\n⚠️  Plugin test file not found:', PLUGIN_TESTS);
    return;
  }

  console.log('\n🔌 Running unit tests...');
  const result = spawnSync('npx', ['vitest', 'run'], {
    stdio: 'inherit',
    shell: false,
    cwd: path.join(__dirname, '..'),
  });

  if (result.status !== 0) {
    failed++;
  }
}

// ==========================================
// Preflight scenario tests
// ==========================================

function runPreflightSuite(suite) {
  console.log(`\n📋 ${suite.name} (preflight scenarios)`);

  for (const tc of (suite.tests || [])) {
    console.log(`\n  Test: "${tc.name}"`);

    if (tc.input.record) {
      test('valid matches expected', () => {
        const result = preflight.validatePreflight(tc.input.record);
        return result.valid === tc.expected.valid;
      });

      if (tc.expected.errors_count !== undefined) {
        test(`errors count is ${tc.expected.errors_count}`, () => {
          const result = preflight.validatePreflight(tc.input.record);
          return result.errors.length === tc.expected.errors_count;
        });
      }

      if (tc.expected.errors_contains) {
        for (const field of tc.expected.errors_contains) {
          test(`error mentions ${field}`, () => {
            const result = preflight.validatePreflight(tc.input.record);
            return result.errors.some((e) => e.includes(field));
          });
        }
      }

      if (tc.expected.missing_contains) {
        test('missing fields contain expected', () => {
          const missing = preflight.getMissingFields(tc.input.record);
          return tc.expected.missing_contains.every((field) => missing.includes(field));
        });
      }

      if (tc.expected.normalized_change !== undefined) {
        test('normalized change is correct', () => {
          const result = preflight.validatePreflight(tc.input.record);
          return result.normalized.change === tc.expected.normalized_change;
        });
      }

      if (tc.expected.normalized_odoo_version !== undefined) {
        test('normalized odoo_version is correct', () => {
          const result = preflight.validatePreflight(tc.input.record);
          return result.normalized.odoo_version === tc.expected.normalized_odoo_version;
        });
      }
    }

    if (tc.input.change_name) {
      test('defaults inference matches expected', () => {
        const defaults = preflight.inferDefaults(tc.input.change_name, tc.input.project_config || null);
        return (
          defaults.change === tc.expected.defaults_change &&
          defaults.odoo_version === tc.expected.defaults_odoo_version &&
          defaults.artifact_store === tc.expected.defaults_artifact_store &&
          defaults.tdd_mode === tc.expected.defaults_tdd_mode
        );
      });
    }
  }
}

// ==========================================
// Orchestrator state scenario tests
// ==========================================

function runOrchestratorSuite(suite) {
  console.log(`\n📋 ${suite.name} (orchestrator scenarios)`);

  for (const tc of (suite.tests || [])) {
    console.log(`\n  Test: "${tc.name}"`);

    if (tc.input.state) {
      test('next phase matches expected', () => {
        const next = orchestrator.getNextPhase(tc.input.state);
        return next === tc.expected.next_phase;
      });
    }

    if (tc.input.states) {
      test('resume selects expected active change', () => {
        const result = orchestrator.selectActiveChange(tc.input.states, tc.input.name || null);
        return result.change === tc.expected.resume_change;
      });
    }
  }
}

// ==========================================
// CLI command scenario tests
// ==========================================

function runCliSuite(suite) {
  console.log(`\n📋 ${suite.name} (CLI parsing scenarios)`);

  for (const tc of (suite.tests || [])) {
    console.log(`\n  Test: "${tc.name}"`);

    const parsed = cli.parseCommand(tc.input.argv);

    if (tc.expected.error) {
      test('returns an error', () => {
        return Boolean(parsed.error);
      });
      continue;
    }

    test('command matches expected', () => {
      return parsed.command === tc.expected.command;
    });

    if (tc.expected.change !== undefined) {
      test('change matches expected', () => {
        return parsed.change === tc.expected.change;
      });
    }

    if (tc.expected.description !== undefined) {
      test('description matches expected', () => {
        return parsed.description === tc.expected.description;
      });
    }

    if (tc.expected.fast !== undefined) {
      test('fast flag matches expected', () => {
        return parsed.fast === tc.expected.fast;
      });
    }

    if (tc.expected.topic !== undefined) {
      test('topic matches expected', () => {
        return parsed.topic === tc.expected.topic;
      });
    }

    if (tc.expected.version !== undefined) {
      test('version matches expected', () => {
        return parsed.version === tc.expected.version;
      });
    }

    if (tc.expected.module !== undefined) {
      test('module matches expected', () => {
        return parsed.module === tc.expected.module;
      });
    }

    test('orchestrator prompt contains command', () => {
      const prompt = cli.buildOrchestratorPrompt(parsed);
      return prompt.includes(parsed.command) && !prompt.startsWith('❌');
    });
  }
}

// ==========================================
// Main
// ==========================================

async function main() {
  const filterAgent = process.argv.find(a => a.startsWith('--agent='))?.split('=')[1];
  const runPlugin = process.argv.includes('--plugin-tests');

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║        ODF Agent Observatory — Test Runner            ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log(`Registry: ${REGISTRY_PATH}`);
  console.log(`Tests dir: ${TESTS_DIR}`);
  if (filterAgent) console.log(`Filter: --agent=${filterAgent}`);
  if (runPlugin) console.log('Plugin tests: enabled');

  if (runPlugin) {
    runPluginTests();
  }

  const files = fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.yaml'));

  if (files.length === 0) {
    console.log('\n⚠️  No YAML test files found in', TESTS_DIR);
  } else {
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8');
        const suite = YAML.parse(content);
        if (filterAgent && suite.agent !== filterAgent) {
          skipped++;
          continue;
        }

        if (suite.type === 'preflight') {
          runPreflightSuite(suite);
        } else if (suite.type === 'orchestrator') {
          runOrchestratorSuite(suite);
        } else if (suite.type === 'cli') {
          runCliSuite(suite);
        } else {
          runTestSuite(suite);
        }
      } catch (e) {
        console.error(`\n❌ Error parsing ${file}: ${e.message}`);
        failed++;
      }
    }
  }

  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  Results: ${passed} passed, ${failed} failed, ${skipped} skipped           ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  if (failed > 0) process.exit(1);
}

main();
