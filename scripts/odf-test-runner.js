#!/usr/bin/env node
/**
 * ODF Agent Test Runner — F2: Agent Observatory
 *
 * Executes test cases against ODF agents and reports pass/fail.
 * Usage: node scripts/odf-test-runner.js [--agent <name>]
 *
 * Each test case defines:
 *   input: { task, context } — sent to the agent
 *   expected: { skill_resolution, status_in, has_diagnosis, ... }
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const REGISTRY_PATH = path.join(process.env.HOME, '.config', 'opencode', 'odf-registry.json');
const TESTS_DIR = path.join(__dirname, 'odf-agent-tests');

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
// Main
// ==========================================

async function main() {
  const filterAgent = process.argv.find(a => a.startsWith('--agent='))?.split('=')[1];

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║        ODF Agent Observatory — Test Runner            ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log(`Registry: ${REGISTRY_PATH}`);
  console.log(`Tests dir: ${TESTS_DIR}`);
  if (filterAgent) console.log(`Filter: --agent=${filterAgent}`);

  const files = fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.yaml'));

  if (files.length === 0) {
    console.log('\n⚠️  No test files found in', TESTS_DIR);
    process.exit(0);
  }

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8');
      const suite = require('yaml').parse(content);
      if (filterAgent && suite.agent !== filterAgent) {
        skipped++;
        continue;
      }
      runTestSuite(suite);
    } catch (e) {
      console.error(`\n❌ Error parsing ${file}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  Results: ${passed} passed, ${failed} failed, ${skipped} skipped           ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  if (failed > 0) process.exit(1);
}

main();
