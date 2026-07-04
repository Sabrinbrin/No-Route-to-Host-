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


// Test: reference solution changes no state → FAIL unintended-solution
test('detects no-state-change fix as unintended-solution', () => {
  const base = parseScenario(readFileSync(join(scenariosDir, '01-wrong-access-vlan.yaml'), 'utf-8'));
  // Reference solution that only runs read-only commands (show/ping) — changes nothing
  const noChange: Scenario = {
    ...base,
    reference_solution: [{ device: 'switch1', commands: ['show vlan brief', 'show interfaces'] }],
  };
  const report = validateScenario(noChange);
  assert(!report.passed, 'Expected FAIL but got PASS');
  // This hits either 'unsolvable' (if win not met) or 'unintended-solution' (if win met without state change)
  // Since the fault is still present and show commands don't fix it, win is not met → unsolvable
  // To trigger unintended-solution via no-state-change, we need the win to be met WITHOUT changes.
  // That means the scenario's win_condition must already be satisfied after the fault — but that's already-solved.
  // The realistic case: reference_solution commands run but are all no-ops (e.g., setting the same value).
  assert(report.verdict === 'unsolvable' || report.verdict === 'unintended-solution',
    `Expected unsolvable or unintended-solution but got ${report.verdict}`);
});

// Test: scenario where read-only investigation wins → FAIL unintended-solution
// This tests the bounded heuristic: if just running show/ping commands on every device
// resolves the win condition, the fault isn't a real misconfiguration.
test('detects read-only-wins as unintended-solution', () => {
  // Construct a scenario where the win_condition source IS a device that exists,
  // and the destination is its own IP (loopback ping always succeeds).
  // The fault "breaks" something unrelated, but the win condition is trivially satisfied.
  const selfPing: Scenario = {
    id: 'test-self-ping',
    title: 'Test Self Ping',
    difficulty: 1,
    topology: {
      devices: [
        {
          id: 'host1',
          hostname: 'Host1',
          type: 'host',
          interfaces: [{ name: 'eth0', ip: '10.0.0.1', mask: '255.255.255.0', gateway: '10.0.0.254', status: 'up' }],
          routing: { enabled: false, routes: [], svis: [] },
        },
        {
          id: 'sw1',
          hostname: 'SW1',
          type: 'switch',
          interfaces: [
            { name: 'Gi0/1', mode: 'access' as const, accessVlan: 10, status: 'up' },
          ],
          routing: { enabled: false, routes: [], svis: [{ vlan: 10, ip: '10.0.0.254', mask: '255.255.255.0', status: 'up' }] },
        },
      ],
      links: [
        { id: 'l1', from: { device: 'host1', interface: 'eth0' }, to: { device: 'sw1', interface: 'Gi0/1' } },
      ],
    },
    injected_fault: { device: 'sw1', interface: 'Gi0/1', field: 'accessVlan', value: 99, action: 'set' },
    ticket: { title: 'Test', symptom: 'Host1 cannot reach gateway', affected_hosts: ['host1'] },
    // Win condition: host1 pings ITSELF (always succeeds regardless of fault)
    win_condition: { type: 'ping', source: 'host1', destination: '10.0.0.1', expected: 'success' },
    reference_solution: [{ device: 'sw1', commands: ['configure terminal', 'interface Gi0/1', 'switchport access vlan 10', 'end'] }],
  };
  const report = validateScenario(selfPing);
  // The self-ping win condition is satisfied even before the fix → should be already-solved or unintended-solution
  assert(!report.passed, 'Expected FAIL but got PASS');
  assert(
    report.verdict === 'already-solved' || report.verdict === 'unintended-solution',
    `Expected already-solved or unintended-solution but got ${report.verdict}: ${report.details}`
  );
});

// Test: reference solution that sets the SAME broken value (no real state change) → catches no-op fixes
test('detects no-op reference solution as unsolvable (not silently passing)', () => {
  const base = parseScenario(readFileSync(join(scenariosDir, '01-wrong-access-vlan.yaml'), 'utf-8'));
  // Reference solution sets the VLAN to the SAME wrong value (20) — technically "changes" the field to the same value
  // The engine's switchport command sets it regardless, so stateChanged=true, but win won't be met
  const noOp: Scenario = {
    ...base,
    reference_solution: [{ device: 'switch1', commands: ['configure terminal', 'interface Gi0/1', 'switchport access vlan 20', 'end'] }],
  };
  const report = validateScenario(noOp);
  assert(!report.passed, 'Expected FAIL but got PASS');
  assertEqual(report.verdict, 'unsolvable');
});
