/**
 * MCP Server for "No Route to Host"
 * 
 * Implements the Model Context Protocol over stdio transport.
 * Exposes tools: get_topology, get_ticket, run_command, check_win_condition,
 *                reset_scenario, load_scenario
 * 
 * All tools operate on the shared network engine — no duplicated logic.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import {
  Scenario,
  GameState,
  CommandContext,
} from '@nrth/engine';
import {
  loadScenario,
  checkWinCondition,
  parseScenario,
} from '@nrth/engine';
import { executeCommand } from '@nrth/engine';

// ===== MCP Protocol Types =====

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

// ===== Server State =====

let currentGameState: GameState | null = null;
let scenariosDir: string;
let availableScenarios: Map<string, Scenario> = new Map();

// ===== Tool Definitions =====

const TOOLS = [
  {
    name: 'get_topology',
    description: 'Get the current network topology including all devices, interfaces, links, and their states.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_ticket',
    description: 'Get the current scenario trouble ticket with title, symptom description, and affected hosts.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a CLI command on a network device. Supports show, ping, and configuration commands.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description: 'The device ID to run the command on',
        },
        command: {
          type: 'string',
          description: 'The CLI command to execute',
        },
      },
      required: ['device', 'command'],
    },
  },
  {
    name: 'check_win_condition',
    description: 'Check if the current scenario win condition is satisfied (network issue resolved).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'reset_scenario',
    description: 'Reset the current scenario to its initial broken state.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'load_scenario',
    description: 'Load a specific scenario by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The scenario ID to load',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_scenarios',
    description: 'List all available scenarios with their IDs and titles.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ===== Tool Handlers =====

function handleGetTopology(): any {
  if (!currentGameState) {
    return { error: 'No scenario loaded. Use load_scenario first.' };
  }
  return {
    devices: currentGameState.network.devices.map(d => ({
      id: d.id,
      hostname: d.hostname,
      type: d.type,
      interfaces: d.interfaces,
      routing: d.routing,
      firewallPolicies: d.firewallPolicies,
    })),
    links: currentGameState.network.links,
  };
}

function handleGetTicket(): any {
  if (!currentGameState) {
    return { error: 'No scenario loaded. Use load_scenario first.' };
  }
  return currentGameState.scenario.ticket;
}

function handleRunCommand(args: { device: string; command: string }): any {
  if (!currentGameState) {
    return { error: 'No scenario loaded. Use load_scenario first.' };
  }

  const { device, command } = args;

  // Get or create context for this device
  if (!currentGameState.contexts[device]) {
    currentGameState.contexts[device] = {
      mode: 'exec',
      currentDevice: device,
    };
  }

  const context = currentGameState.contexts[device];
  const result = executeCommand(
    currentGameState.network,
    device,
    command,
    context
  );

  currentGameState.commandCount++;

  return {
    output: result.output,
    stateChanged: result.stateChanged,
  };
}

function handleCheckWinCondition(): any {
  if (!currentGameState) {
    return { error: 'No scenario loaded. Use load_scenario first.' };
  }

  const result = checkWinCondition(
    currentGameState.network,
    currentGameState.scenario.win_condition
  );

  if (result.resolved) {
    currentGameState.resolved = true;
  }

  return {
    resolved: result.resolved,
    details: result.details,
    commandCount: currentGameState.commandCount,
    elapsedMs: Date.now() - currentGameState.startTime,
  };
}

function handleResetScenario(): any {
  if (!currentGameState) {
    return { error: 'No scenario loaded. Use load_scenario first.' };
  }

  const scenario = currentGameState.scenario;
  currentGameState = loadScenario(scenario);

  return { success: true, title: scenario.title };
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

function handleListScenarios(): any {
  return Array.from(availableScenarios.values()).map(s => ({
    id: s.id,
    title: s.title,
    difficulty: s.difficulty,
  }));
}

// ===== MCP Protocol Handling =====

function handleRequest(request: JsonRpcRequest): JsonRpcResponse {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'no-route-to-host',
            version: '1.0.0',
          },
        },
      };

    case 'notifications/initialized':
      // No response needed for notifications
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      let toolResult: any;
      try {
        switch (toolName) {
          case 'get_topology':
            toolResult = handleGetTopology();
            break;
          case 'get_ticket':
            toolResult = handleGetTicket();
            break;
          case 'run_command':
            toolResult = handleRunCommand(toolArgs);
            break;
          case 'check_win_condition':
            toolResult = handleCheckWinCondition();
            break;
          case 'reset_scenario':
            toolResult = handleResetScenario();
            break;
          case 'load_scenario':
            toolResult = handleLoadScenario(toolArgs);
            break;
          case 'list_scenarios':
            toolResult = handleListScenarios();
            break;
          default:
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Unknown tool: ${toolName}` },
            };
        }
      } catch (e: any) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: e.message || 'Internal error' },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(toolResult, null, 2),
            },
          ],
        },
      };
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ===== Initialization =====

function loadAllScenarios(): void {
  scenariosDir = resolve(process.cwd(), 'scenarios');
  try {
    const files = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.yaml'));
    for (const file of files) {
      const content = readFileSync(join(scenariosDir, file), 'utf-8');
      const scenario = parseScenario(content);
      availableScenarios.set(scenario.id, scenario);
    }
    console.error(`[MCP] Loaded ${availableScenarios.size} scenarios`);
  } catch (e: any) {
    console.error(`[MCP] Warning: Could not load scenarios: ${e.message}`);
  }
}

// ===== Main: stdio transport =====

function main(): void {
  loadAllScenarios();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  let buffer = '';

  process.stdin.on('data', (chunk: any) => {
    buffer += chunk.toString();

    // Process complete lines (JSON-RPC messages are newline-delimited)
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.substring(0, newlineIdx).trim();
      buffer = buffer.substring(newlineIdx + 1);

      if (!line) continue;

      try {
        const request = JSON.parse(line) as JsonRpcRequest;

        // Notifications don't get responses
        if (!('id' in request)) {
          // Handle as notification
          continue;
        }

        const response = handleRequest(request);
        const responseStr = JSON.stringify(response);
        process.stdout.write(responseStr + '\n');
      } catch (e: any) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: ' + e.message },
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  console.error('[MCP] No Route to Host MCP server started (stdio transport)');
}

main();
