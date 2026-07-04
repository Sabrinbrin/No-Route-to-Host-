/**
 * Unified scenario validation logic — the SINGLE source of truth.
 *
 * Imported by:
 *   - packages/frontend (Author Studio live validation)
 *   - packages/validator (CI determinism gate)
 *   - packages/mcp-server (validate_scenario tool)
 *
 * Proves SOLVABLE + FAIR per .kiro/steering/networking-trainer.md.
 */
import { Scenario, GameState, CommandContext } from './types.js';
import { loadScenario, checkWinCondition } from './scenario-loader.js';
import { executeCommand } from './cli-parser.js';

export type FairnessVerdict =
  | 'PASS'
  | 'already-solved'
  | 'unsolvable'
  | 'symptom-mismatch'
  | 'unintended-solution';

export interface ValidationReport {
  passed: boolean;
  verdict: FairnessVerdict;
  steps: number;
  details: string;
}

/**
 * Validate a scenario is SOLVABLE and FAIR.
 *
 * Checks (in order):
 * 1. already-solved — fault must be present (win=false at load)
 * 2. symptom-mismatch — ticket must describe a real symptom
 * 3. unintended-solution — read-only investigation must not win
 * 4. unsolvable — reference solution must restore reachability
 * 5. state-change — the fix must actually mutate device state
 * 6. determinism — a second run must reach the same result
 */
export function validateScenario(scenario: Scenario): ValidationReport {
  const win = scenario.win_condition;

  // 1. already-solved
  let game = loadScenario(scenario);
  if (checkWinCondition(game.network, win).resolved) {
    return { passed: false, verdict: 'already-solved', steps: 0, details: 'Win condition already satisfied before any fix — fault not injected.' };
  }

  // 2. symptom-mismatch
  if (!scenario.ticket?.symptom?.trim()) {
    return { passed: false, verdict: 'symptom-mismatch', steps: 0, details: 'Ticket has no symptom.' };
  }
  const affected = scenario.ticket.affected_hosts || [];
  if (affected.length > 0 && !affected.includes(win.source)) {
    return {
      passed: false,
      verdict: 'symptom-mismatch',
      steps: 0,
      details: `Win source '${win.source}' is not in affected_hosts [${affected.join(', ')}].`,
    };
  }

  // 3. unintended-solution (bounded): read-only investigation must NOT win
  const probe = loadScenario(scenario);
  const readOnlyCmds = ['show running-config', 'show ip route', 'show interfaces', `ping ${win.destination}`];
  for (const device of probe.network.devices) {
    const ctx: CommandContext = { mode: 'exec', currentDevice: device.id };
    for (const cmd of readOnlyCmds) executeCommand(probe.network, device.id, cmd, ctx);
  }
  if (checkWinCondition(probe.network, win).resolved) {
    return { passed: false, verdict: 'unintended-solution', steps: 0, details: 'Read-only investigation resolved the win condition.' };
  }

  // 4. unsolvable + 5. state-change
  game = loadScenario(scenario);
  let steps = 0;
  let changed = false;
  for (const step of scenario.reference_solution) {
    const ctx: CommandContext = game.contexts[step.device] || { mode: 'exec', currentDevice: step.device };
    for (const command of step.commands) {
      const r = executeCommand(game.network, step.device, command, ctx);
      if (r.stateChanged) changed = true;
      steps++;
      game.contexts[step.device] = ctx;
    }
  }
  const final = checkWinCondition(game.network, win);
  if (!final.resolved) {
    return { passed: false, verdict: 'unsolvable', steps, details: `Win not met after reference solution: ${final.details}` };
  }
  if (!changed) {
    return { passed: false, verdict: 'unintended-solution', steps, details: 'Reference solution resolved the win without changing any state.' };
  }

  // 6. determinism
  const game2 = loadScenario(scenario);
  let steps2 = 0;
  for (const step of scenario.reference_solution) {
    const ctx: CommandContext = game2.contexts[step.device] || { mode: 'exec', currentDevice: step.device };
    for (const command of step.commands) {
      executeCommand(game2.network, step.device, command, ctx);
      steps2++;
      game2.contexts[step.device] = ctx;
    }
  }
  if (!checkWinCondition(game2.network, win).resolved) {
    return { passed: false, verdict: 'unsolvable', steps, details: 'Non-deterministic: second run did not resolve the win.' };
  }

  return { passed: true, verdict: 'PASS', steps, details: `Solvable in ${steps} steps, fair.` };
}
