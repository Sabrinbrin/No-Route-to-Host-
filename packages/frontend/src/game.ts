/**
 * Client-side game controller. The React app runs the whole simulation in the
 * browser by importing the shared @nrth/engine directly — no backend API.
 * The same engine powers the Author Studio's live validation.
 */
import {
  Scenario,
  GameState,
  loadScenario,
  checkWinCondition,
  executeCommand,
  parseScenario,
} from '@nrth/engine';

// Bundle every scenario YAML at build time (single source of truth: scenarios/).
const rawScenarios = import.meta.glob('../../../scenarios/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface ScenarioMeta {
  id: string;
  title: string;
  difficulty: number;
}

export interface CommandOutcome {
  output: string;
  stateChanged: boolean;
  mode: string;
  won: boolean;
}

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

const scenarios: Map<string, Scenario> = new Map();
const rawById: Map<string, string> = new Map();
for (const raw of Object.values(rawScenarios)) {
  const s = parseScenario(raw);
  scenarios.set(s.id, s);
  rawById.set(s.id, raw);
}

export function getScenarioYaml(id: string): string {
  return rawById.get(id) ?? '';
}

export function listScenarios(): ScenarioMeta[] {
  return [...scenarios.values()]
    .map((s) => ({ id: s.id, title: s.title, difficulty: s.difficulty }))
    .sort((a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title));
}

export function getScenario(id: string): Scenario | undefined {
  return scenarios.get(id);
}

/** A single live play session, backed by the engine's GameState. */
export class GameSession {
  readonly scenario: Scenario;
  private state: GameState;
  solved = false;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.state = loadScenario(scenario);
  }

  get network() {
    return this.state.network;
  }
  get commandCount() {
    return this.state.commandCount;
  }

  private context(deviceId: string) {
    if (!this.state.contexts[deviceId]) {
      this.state.contexts[deviceId] = { mode: 'exec', currentDevice: deviceId };
    }
    return this.state.contexts[deviceId];
  }

  mode(deviceId: string): string {
    return this.context(deviceId).mode;
  }

  run(deviceId: string, command: string): CommandOutcome {
    const ctx = this.context(deviceId);
    const result = executeCommand(this.state.network, deviceId, command, ctx);
    this.state.commandCount++;
    let won = false;
    if (result.stateChanged) {
      const win = checkWinCondition(this.state.network, this.scenario.win_condition);
      if (win.resolved) {
        this.solved = true;
        won = true;
      }
    }
    return { output: result.output, stateChanged: result.stateChanged, mode: ctx.mode, won };
  }

  checkWin() {
    return checkWinCondition(this.state.network, this.scenario.win_condition);
  }

  reset() {
    this.state = loadScenario(this.scenario);
    this.solved = false;
  }
}

/**
 * Author Studio: validate a scenario is SOLVABLE and FAIR entirely in-browser
 * using the shared engine — the same checks the CI validator runs.
 */
export function validateScenario(scenario: Scenario): ValidationReport {
  const win = scenario.win_condition;

  // already-solved
  let game = loadScenario(scenario);
  if (checkWinCondition(game.network, win).resolved) {
    return { passed: false, verdict: 'already-solved', steps: 0, details: 'Win condition already satisfied before any fix.' };
  }

  // symptom-mismatch
  if (!scenario.ticket.symptom?.trim()) {
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

  // unintended-solution: read-only investigation must not win
  const probe = loadScenario(scenario);
  for (const d of probe.network.devices) {
    const ctx = { mode: 'exec' as const, currentDevice: d.id };
    for (const cmd of ['show running-config', 'show ip route', `ping ${win.destination}`]) {
      executeCommand(probe.network, d.id, cmd, ctx);
    }
  }
  if (checkWinCondition(probe.network, win).resolved) {
    return { passed: false, verdict: 'unintended-solution', steps: 0, details: 'Read-only investigation resolved the win.' };
  }

  // unsolvable + the fix must change state
  game = loadScenario(scenario);
  let steps = 0;
  let changed = false;
  for (const step of scenario.reference_solution) {
    const ctx = game.contexts[step.device] || { mode: 'exec' as const, currentDevice: step.device };
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
    return { passed: false, verdict: 'unintended-solution', steps, details: 'Reference solution changed no state.' };
  }

  return { passed: true, verdict: 'PASS', steps, details: `Solvable in ${steps} steps, fair.` };
}
