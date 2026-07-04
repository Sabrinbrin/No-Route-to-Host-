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
  validateScenario,
  type FairnessVerdict,
  type ValidationReport,
} from '@nrth/engine';

// Re-export validation types from engine (single source of truth)
export type { FairnessVerdict, ValidationReport };
export { validateScenario };

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
