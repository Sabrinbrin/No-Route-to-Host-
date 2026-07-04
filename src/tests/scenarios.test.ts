import { suite, test, assert, assertEqual } from './harness.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadScenario, checkWinCondition, parseScenarioJson } from '../engine/scenario-loader.js';
import { executeCommand } from '../engine/cli-parser.js';
import { evaluatePing } from '../engine/reachability.js';
import { Scenario, CommandContext } from '../engine/types.js';

suite('scenarios');

const scenariosDir = resolve(process.cwd(), 'scenarios');
const files = readdirSync(scenariosDir).filter(f => f.endsWith('.json')).sort();

// Which ordered reachability condition each scenario's fault is expected to
// break. Locks the fault→condition mapping so a regression in the evaluator
// (e.g. an AWS fault silently passing as a routing failure) is caught.
const EXPECTED_CONDITION: Record<string, number> = {
  'wrong-access-vlan': 2,
  'trunk-allowed-list': 3,
  'inter-vlan-routing': 4,
  'missing-default-route': 4,
  'firewall-tunnel': 5,
  'aws-security-group': 6,
  'aws-route-table': 6,
  'aws-nacl-deny': 6,
  'linux-iptables': 7,
  'docker-networking': 7,
  'windows-firewall': 7,
};

function loadScenarioFile(file: string): Scenario {
  return parseScenarioJson(readFileSync(join(scenariosDir, file), 'utf-8'));
}

function runReferenceSolution(scenario: Scenario, game: ReturnType<typeof loadScenario>): void {
  for (const step of scenario.reference_solution) {
    const context: CommandContext = game.contexts[step.device] || { mode: 'exec', currentDevice: step.device };
    for (const cmd of step.commands) {
      executeCommand(game.network, step.device, cmd, context);
      game.contexts[step.device] = context;
    }
  }
}

test('every known scenario file is present and loads', () => {
  const ids = files.map(f => loadScenarioFile(f).id);
  for (const known of Object.keys(EXPECTED_CONDITION)) {
    assert(ids.includes(known), `expected scenario '${known}' to be present`);
  }
  assert(files.length >= Object.keys(EXPECTED_CONDITION).length, 'at least the known scenarios must exist');
});

for (const file of files) {
  const scenario = loadScenarioFile(file);

  test(`${scenario.id}: fault breaks the expected reachability condition`, () => {
    const game = loadScenario(scenario);
    const win = scenario.win_condition;
    const ping = evaluatePing(game.network, win.source, win.destination);
    // Win conditions in the shipped scenarios all expect success, so a
    // correctly-injected fault must make the ping fail.
    assert(!ping.success, `fault not injected — ping already succeeds (${file})`);
    const expected = EXPECTED_CONDITION[scenario.id];
    if (expected !== undefined) {
      assertEqual(ping.failedCondition, expected, `${scenario.id} should fail on condition ${expected}`);
    }
  });

  test(`${scenario.id}: reference solution resolves the win condition`, () => {
    const game = loadScenario(scenario);
    assert(!checkWinCondition(game.network, scenario.win_condition).resolved, 'should start broken');
    runReferenceSolution(scenario, game);
    assert(checkWinCondition(game.network, scenario.win_condition).resolved, 'should be fixed after solution');
  });
}
