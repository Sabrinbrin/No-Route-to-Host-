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

server.registerTool(
  'validate_all',
  {
    description: 'Validate ALL scenarios are SOLVABLE and FAIR in a single call. Returns a summary with per-scenario verdicts and an overall pass/fail. Same logic as the CI gate (npm run validate).',
    inputSchema: {},
  },
  async () => {
    const results: Array<{ id: string; title: string; passed: boolean; verdict: string; steps: number; details: string }> = [];
    for (const [id, scenario] of availableScenarios) {
      const report = validateScenario(scenario);
      results.push({ id, title: scenario.title, passed: report.passed, verdict: report.verdict, steps: report.steps, details: report.details });
    }
    const passCount = results.filter(r => r.passed).length;
    const allPassed = passCount === results.length;
    return asText({
      total: results.length,
      passed: passCount,
      failed: results.length - passCount,
      allPassed,
      results,
    });
  }
);

// ===== MCP Resources & Prompts: registered after scenarios load =====

function registerResourcesAndPrompts(): void {
  // Each scenario is exposed as a resource the agent can read
  for (const [id, scenario] of availableScenarios) {
    server.resource(
      `scenario-${id}`,
      `scenario://${id}`,
      { description: `Scenario: ${scenario.title} (difficulty ${scenario.difficulty})`, mimeType: 'application/json' },
      async () => ({
        contents: [{
          uri: `scenario://${id}`,
          text: JSON.stringify({
            id: scenario.id,
            title: scenario.title,
            difficulty: scenario.difficulty,
            ticket: scenario.ticket,
            win_condition: scenario.win_condition,
            device_count: scenario.topology.devices.length,
            link_count: scenario.topology.links.length,
            devices: scenario.topology.devices.map(d => ({ id: d.id, hostname: d.hostname, type: d.type })),
            reference_steps: scenario.reference_solution.reduce((n, s) => n + s.commands.length, 0),
          }, null, 2),
        }],
      })
    );
  }

  // Scenario list resource
  server.resource(
    'scenario-list',
    'scenarios://list',
    { description: 'List of all available scenarios with metadata', mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'scenarios://list',
        text: JSON.stringify(
          [...availableScenarios.values()].map(s => ({
            id: s.id, title: s.title, difficulty: s.difficulty,
            ticket_title: s.ticket.title, devices: s.topology.devices.length,
          })),
          null, 2
        ),
      }],
    })
  );
}

// Prompts (static — don't depend on loaded data)
server.prompt(
  'validate-scenario',
  'Validate a scenario is solvable and fair. Guides the agent through the full fairness gate.',
  async (extra) => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `Validate a scenario using these steps:\n\n1. Call list_scenarios to see available scenarios\n2. Call load_scenario with the chosen id\n3. Call check_win_condition — it MUST return resolved=false (fault present)\n4. Read the ticket with get_ticket to understand the symptom\n5. Execute the reference solution commands using run_command\n6. Call check_win_condition — it MUST return resolved=true (fix works)\n7. Call validate_scenario for the full fairness report\n\nReport PASS or FAIL with the verdict.` },
    }],
  })
);

server.prompt(
  'diagnose-scenario',
  'Play a scenario as a student would: investigate, hypothesize, fix.',
  async (extra) => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `You are a junior network engineer. Diagnose a scenario:\n\n1. Call list_scenarios and pick one\n2. Call load_scenario with its id\n3. Call get_ticket to read the trouble ticket\n4. Call get_topology to see the network devices\n5. Use run_command to investigate (show commands, ping)\n6. Form a hypothesis about what's broken\n7. Apply the fix using run_command (config commands)\n8. Call check_win_condition to verify the fix\n\nUse abbreviations like a real engineer: sh ip int bri, conf t, sw acc vlan, etc.` },
    }],
  })
);

server.prompt(
  'author-new-scenario',
  'Guide for authoring a new scenario from scratch.',
  async (extra) => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `Create a new diagnostic scenario.\n\nThe scenario needs:\n- id: unique kebab-case\n- title: human-readable\n- difficulty: 1-5\n- topology: devices[] with interfaces, routing config; links[] between them\n- injected_fault: exactly ONE condition disabled (device, field, value)\n- ticket: title + symptom describing what the user sees (DON'T reveal the fix)\n- win_condition: a ping assertion {source, destination, expected: success}\n- reference_solution: minimal CLI commands that fix the fault\n\nDevice types: switch, router, firewall, host, ec2, vpc-router, linux-server, windows-server, docker-host\n\nThe fault must disable exactly one reachability condition:\n1. Source IP/mask/gateway\n2. Access VLAN path\n3. Trunk VLAN allowed\n4. L3 routing (enabled, SVI up, route exists)\n5. Firewall policy\n6. AWS (SG, NACL, route table)\n7. OS firewall (iptables, Windows Firewall)\n\nAfter writing the YAML, call validate_scenario to confirm it passes.` },
    }],
  })
);

// ===== Main =====

async function main(): Promise<void> {
  loadAllScenarios();
  registerResourcesAndPrompts();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] No Route to Host MCP server started (stdio transport)');
  console.error(`[MCP] ${availableScenarios.size} scenarios loaded as resources, 3 prompts, 9 tools`);
}

main().catch((e) => {
  console.error('[MCP] Fatal:', e);
  process.exit(1);
});
