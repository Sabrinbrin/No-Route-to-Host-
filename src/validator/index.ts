/**
 * Scenario Validator — the CI determinism + fairness gate.
 *
 * For each scenario it proves SOLVABLE (fault present, reference solution
 * fixes it) and FAIR per .kiro/steering/networking-trainer.md:
 *   already-solved | unsolvable | symptom-mismatch | unintended-solution.
 *
 * Note: the "no unintended solution" rule cannot be proven exhaustively here.
 * We apply a bounded, honest check (read-only investigation must not win; the
 * fix must actually change state) rather than claiming full uniqueness.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Scenario, GameState, CommandContext } from '../engine/types.js';
import { loadScenario, checkWinCondition, parseScenarioJson } from '../engine/scenario-loader.js';
import { executeCommand } from '../engine/cli-parser.js';

type Verdict = 'PASS' | 'already-solved' | 'unsolvable' | 'symptom-mismatch' | 'unintended-solution';

interface ValidationResult {
  scenarioId: string;
  title: string;
  passed: boolean;
  verdict: Verdict;
  steps: number;
  details: string;
}

function runReferenceSolution(scenario: Scenario, game: GameState): { steps: number; changed: boolean } {
  let steps = 0;
  let changed = false;
  for (const step of scenario.reference_solution) {
    const context: CommandContext = game.contexts[step.device] || { mode: 'exec', currentDevice: step.device };
    for (const cmd of step.commands) {
      const r = executeCommand(game.network, step.device, cmd, context);
      if (r.stateChanged) changed = true;
      steps++;
      game.contexts[step.device] = context;
    }
  }
  return { steps, changed };
}

/**
 * Fairness checks that do NOT depend on running the reference solution.
 * Returns a failing verdict or null if fair.
 */
function checkFairness(scenario: Scenario): { verdict: Verdict; details: string } | null {
  const win = scenario.win_condition;

  // symptom-mismatch: the ticket must describe a real symptom, and the host
  // whose reachability the win asserts must be one the ticket blames.
  if (!scenario.ticket.symptom || !scenario.ticket.symptom.trim()) {
    return { verdict: 'symptom-mismatch', details: 'ticket symptom is empty' };
  }
  const affected = scenario.ticket.affected_hosts || [];
  if (affected.length > 0 && !affected.includes(win.source)) {
    return {
      verdict: 'symptom-mismatch',
      details: `win source '${win.source}' is not in affected_hosts [${affected.join(', ')}]`,
    };
  }

  // unintended-solution (bounded): read-only investigation must NOT resolve the
  // win. If merely running show/ping flips it, the fault is not a real
  // misconfiguration the player must fix.
  const probe = loadScenario(scenario);
  const readOnly = ['show running-config', 'show ip route', 'show interfaces', `ping ${win.destination}`];
  for (const device of probe.network.devices) {
    const ctx: CommandContext = { mode: 'exec', currentDevice: device.id };
    for (const cmd of readOnly) executeCommand(probe.network, device.id, cmd, ctx);
  }
  if (checkWinCondition(probe.network, win).resolved) {
    return { verdict: 'unintended-solution', details: 'read-only investigation commands resolved the win condition' };
  }

  return null;
}

function validateScenario(scenario: Scenario): ValidationResult {
  const base = { scenarioId: scenario.id, title: scenario.title };

  // 1. already-solved — fault must be present at load.
  const game = loadScenario(scenario);
  if (checkWinCondition(game.network, scenario.win_condition).resolved) {
    return { ...base, passed: false, verdict: 'already-solved', steps: 0, details: 'win condition already satisfied before any fix — fault not injected' };
  }

  // 2. fairness checks that don't need the solution.
  const unfair = checkFairness(scenario);
  if (unfair) {
    return { ...base, passed: false, verdict: unfair.verdict, steps: 0, details: unfair.details };
  }

  // 3. unsolvable — reference solution must fix it, and must actually change state.
  const { steps, changed } = runReferenceSolution(scenario, game);
  const finalCheck = checkWinCondition(game.network, scenario.win_condition);
  if (!finalCheck.resolved) {
    return { ...base, passed: false, verdict: 'unsolvable', steps, details: `win not met after reference solution: ${finalCheck.details}` };
  }
  if (!changed) {
    return { ...base, passed: false, verdict: 'unintended-solution', steps, details: 'reference solution resolved the win without changing any state' };
  }

  // 4. determinism — a second independent run must reach the same verdict.
  const game2 = loadScenario(scenario);
  runReferenceSolution(scenario, game2);
  if (!checkWinCondition(game2.network, scenario.win_condition).resolved) {
    return { ...base, passed: false, verdict: 'unsolvable', steps, details: 'non-deterministic: second run did not resolve the win' };
  }

  return { ...base, passed: true, verdict: 'PASS', steps, details: `solvable in ${steps} steps, fair` };
}

function findScenariosDir(): string {
  const primary = resolve(process.cwd(), 'scenarios');
  try {
    readdirSync(primary);
    return primary;
  } catch {
    return resolve(import.meta.url.replace('file://', '').replace('/dist/validator/index.js', ''), 'scenarios');
  }
}

function main(): void {
  const scenariosDir = findScenariosDir();
  let files: string[];
  try {
    files = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.json'));
  } catch {
    console.error('Cannot find scenarios directory.');
    process.exit(1);
    return;
  }

  console.log(`\n🔍 Validating ${files.length} scenarios (solvable + fair)...\n`);

  let allPassed = true;
  let passCount = 0;
  for (const file of files.sort()) {
    const scenario = parseScenarioJson(readFileSync(join(scenariosDir, file), 'utf-8'));
    const result = validateScenario(scenario);
    if (result.passed) {
      passCount++;
      console.log(`  ✓ ${result.title} (${result.scenarioId}) — PASS: ${result.details}`);
    } else {
      allPassed = false;
      console.log(`  ✗ ${result.title} (${result.scenarioId}) — FAIL ${result.verdict}: ${result.details}`);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passCount}/${files.length} passed`);
  if (!allPassed) {
    console.log('\n❌ Some scenarios failed validation.');
    process.exit(1);
  }
  console.log('\n✅ All scenarios validated successfully (solvable + fair).');
  process.exit(0);
}

main();
