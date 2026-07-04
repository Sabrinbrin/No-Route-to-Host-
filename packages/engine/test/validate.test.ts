/**
 * Regression tests for the unified validateScenario function (validate.ts).
 *
 * Ensures:
 * 1. All real scenarios pass (SOLVABLE + FAIR)
 * 2. A deliberately broken scenario is detected as FAIL unsolvable
 * 3. A scenario with no fault is detected as FAIL already-solved
 * 4. A scenario with empty symptom is detected as FAIL symptom-mismatch
 */
import { suite, test, assert, assertEqual } from './harness.js';
import { validateScenario, parseScenario, type Scenario } from '../src/index.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

suite('validate');

// Load all real scenarios
const scenariosDir = resolve(process.cwd(), 'scenarios');
const scenarioFiles = readdirSync(scenariosDir).filter(f => f.endsWith('.yaml'));

// Test: every real scenario passes
for (const file of scenarioFiles) {
  const scenario = parseScenario(readFileSync(join(scenariosDir, file), 'utf-8'));
  test(`${scenario.id}: passes validation (solvable + fair)`, () => {
    const report = validateScenario(scenario);
    assert(report.passed, `Expected PASS but got ${report.verdict}: ${report.details}`);
  });
}

// Test: broken reference solution → FAIL unsolvable
test('detects broken reference solution as unsolvable', () => {
  const base = parseScenario(readFileSync(join(scenariosDir, '01-wrong-access-vlan.yaml'), 'utf-8'));
  const broken: Scenario = {
    ...base,
    reference_solution: [{ device: 'switch1', commands: ['configure terminal', 'interface Gi0/1', 'switchport access vlan 99', 'end'] }],
  };
  const report = validateScenario(broken);
  assert(!report.passed, 'Expected FAIL but got PASS');
  assertEqual(report.verdict, 'unsolvable');
});

// Test: no fault (win already satisfied) → FAIL already-solved
test('detects missing fault as already-solved', () => {
  const base = parseScenario(readFileSync(join(scenariosDir, '01-wrong-access-vlan.yaml'), 'utf-8'));
  // Remove the fault — set the correct VLAN so win is already satisfied
  const noFault: Scenario = {
    ...base,
    injected_fault: { device: 'switch1', interface: 'Gi0/1', field: 'accessVlan', value: 10, action: 'set' },
  };
  const report = validateScenario(noFault);
  assert(!report.passed, 'Expected FAIL but got PASS');
  assertEqual(report.verdict, 'already-solved');
});

// Test: empty symptom → FAIL symptom-mismatch
test('detects empty symptom as symptom-mismatch', () => {
  const base = parseScenario(readFileSync(join(scenariosDir, '01-wrong-access-vlan.yaml'), 'utf-8'));
  const noSymptom: Scenario = {
    ...base,
    ticket: { ...base.ticket, symptom: '' },
  };
  const report = validateScenario(noSymptom);
  assert(!report.passed, 'Expected FAIL but got PASS');
  assertEqual(report.verdict, 'symptom-mismatch');
});
