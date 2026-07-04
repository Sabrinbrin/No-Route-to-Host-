/**
 * MCP Server for "No Route to Host"
 *
 * Built on the official @modelcontextprotocol/sdk (stdio transport). Exposes
 * the simulation as MCP tools so a Kiro validation agent can *play* each
 * scenario. All tools operate on the shared @nrth/engine — no duplicated logic.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  Scenario,
  GameState,
  loadScenario,
  checkWinCondition,
  parseScenario,
  executeCommand,
  validateScenario,
} from '@nrth/engine';

// ===== Server State =====

let currentGameState: GameState | null = null;
const availableScenarios: Map<string, Scenario> = new Map();

function loadAllScenarios(): void {
  const scenariosDir = resolve(process.cwd(), 'scenarios');
  try {
    const files = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.yaml'));
    for (const file of files) {
      const scenario = parseScenario(readFileSync(join(scenariosDir, file), 'utf-8'));
      availableScenarios.set(scenario.id, scenario);
    }
    console.error(`[MCP] Loaded ${availableScenarios.size} scenarios`);
  } catch (e: any) {
    console.error(`[MCP] Warning: could not load scenarios: ${e.message}`);
  }
}

// ===== Tool Handlers (pure — return plain data) =====

function handleListScenarios(): any {
  return Array.from(availableScenarios.values()).map(s => ({
    id: s.id,
    title: s.title,
    difficulty: s.difficulty,
  }));
}

function handleLoadScenario(args: { id: string }): any {
  const scenario = availableScenarios.get(args.id);
  if (!scenario) {
    return {
      error: `Scenario '${args.id}' not found. Available: ${Array.from(availableScenarios.keys()).join(', ')}`,
    };
  }
  currentGameState = loadScenario(scenario);
  return { success: true, title: scenario.title, id: scenario.id };
}

function handleGetTopology(): any {
  if (!currentGameState) return { error: 'No scenario loaded. Use load_scenario first.' };
  return {
    devices: currentGameState.network.devices.map(d => ({
      id: d.id,
      hostname: d.hostname,
      type: d.type,
      interfaces: d.interfaces,
      routing: d.routing,
      firewallPolicies: d.firewallPolicies,
      aws: d.aws,
    })),
    links: currentGameState.network.links,
  };
}

function handleGetTicket(): any {
  if (!currentGameState) return { error: 'No scenario loaded. Use load_scenario first.' };
  return currentGameState.scenario.ticket;
}

function handleRunCommand(args: { device: string; command: string }): any {
  if (!currentGameState) return { error: 'No scenario loaded. Use load_scenario first.' };
  const { device, command } = args;
  if (!currentGameState.contexts[device]) {
    currentGameState.contexts[device] = { mode: 'exec', currentDevice: device };
  }
  const context = currentGameState.contexts[device];
  const result = executeCommand(currentGameState.network, device, command, context);
  currentGameState.commandCount++;
  return { output: result.output, stateChanged: result.stateChanged };
}

function handleCheckWinCondition(): any {
  if (!currentGameState) return { error: 'No scenario loaded. Use load_scenario first.' };
  const result = checkWinCondition(currentGameState.network, currentGameState.scenario.win_condition);
  if (result.resolved) currentGameState.resolved = true;
  return {
    resolved: result.resolved,
    details: result.details,
    commandCount: currentGameState.commandCount,
    elapsedMs: Date.now() - currentGameState.startTime,
  };
}

function handleResetScenario(): any {
  if (!currentGameState) return { error: 'No scenario loaded. Use load_scenario first.' };
  const scenario = currentGameState.scenario;
  currentGameState = loadScenario(scenario);
  return { success: true, title: scenario.title };
}

// ===== MCP wiring =====

function asText(obj: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] };
}

const server = new McpServer({ name: 'no-route-to-host', version: '2.0.0' });

server.registerTool(
  'list_scenarios',
  { description: 'List all available scenarios with their IDs, titles, and difficulty.', inputSchema: {} },
  async () => asText(handleListScenarios())
);

server.registerTool(
  'load_scenario',
  {
    description: 'Load a scenario by ID (applies its injected fault and initialises state).',
    inputSchema: { id: z.string().describe('The scenario ID to load') },
  },
  async ({ id }) => asText(handleLoadScenario({ id }))
);

server.registerTool(
  'get_topology',
  { description: 'Get the current network topology: devices, interfaces, links, routing, and cloud config.', inputSchema: {} },
  async () => asText(handleGetTopology())
);

server.registerTool(
  'get_ticket',
  { description: 'Get the current trouble ticket (title, symptom, affected hosts).', inputSchema: {} },
  async () => asText(handleGetTicket())
);

server.registerTool(
  'run_command',
  {
    description: 'Execute a CLI command on a device (show / ping / configuration commands).',
    inputSchema: {
      device: z.string().describe('The device ID to run the command on'),
      command: z.string().describe('The CLI command to execute'),
    },
  },
  async ({ device, command }) => asText(handleRunCommand({ device, command }))
);

server.registerTool(
  'check_win_condition',
  { description: 'Check whether the scenario win condition is satisfied (issue resolved).', inputSchema: {} },
  async () => asText(handleCheckWinCondition())
);

server.registerTool(
  'reset_scenario',
  { description: 'Reset the current scenario to its initial broken state.', inputSchema: {} },
  async () => asText(handleResetScenario())
);

server.registerTool(
  'validate_scenario',
  {
    description: 'Validate that a scenario is SOLVABLE and FAIR. Runs the full fairness gate: asserts fault present, executes reference solution, asserts fix works, checks for symptom mismatch and unintended solutions. Same logic as CI and the on-save hook.',
    inputSchema: {
      id: z.string().describe('Scenario ID to validate (or omit to validate the currently loaded scenario)').optional(),
    },
  },
  async ({ id }) => {
    const scenarioId = id || currentGameState?.scenario.id;
    if (!scenarioId) return asText({ error: 'No scenario specified. Provide an id or load a scenario first.' });
    const scenario = availableScenarios.get(scenarioId);
    if (!scenario) return asText({ error: `Scenario '${scenarioId}' not found.` });
    const report = validateScenario(scenario);
    return asText({
      scenarioId,
      title: scenario.title,
      ...report,
    });
  }
);

// ===== Main =====

async function main(): Promise<void> {
  loadAllScenarios();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] No Route to Host MCP server started (stdio transport)');
}

main().catch((e) => {
  console.error('[MCP] Fatal:', e);
  process.exit(1);
});
