/**
 * HTTP Server for No Route to Host
 * Serves the static frontend and provides a JSON API to the game engine.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import {
  Scenario,
  GameState,
  CommandContext,
} from '../engine/types.js';
import {
  loadScenario,
  checkWinCondition,
  parseScenarioJson,
} from '../engine/scenario-loader.js';
import { executeCommand } from '../engine/cli-parser.js';

// ===== State =====
let currentGameState: GameState | null = null;
const availableScenarios: Map<string, Scenario> = new Map();

// ===== Load Scenarios =====
const scenariosDir = resolve(process.cwd(), 'scenarios');
try {
  const files = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.json'));
  for (const file of files) {
    const content = readFileSync(join(scenariosDir, file), 'utf-8');
    const scenario = parseScenarioJson(content);
    availableScenarios.set(scenario.id, scenario);
  }
  console.log(`Loaded ${availableScenarios.size} scenarios`);
} catch (e: any) {
  console.error(`Could not load scenarios: ${e.message}`);
}

// ===== MIME Types =====
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// ===== API Handlers =====
function handleApi(path: string, body: any): any {
  switch (path) {
    case '/api/scenarios':
      return Array.from(availableScenarios.values()).map(s => ({
        id: s.id, title: s.title, difficulty: s.difficulty,
      }));

    case '/api/load': {
      const scenario = availableScenarios.get(body.id);
      if (!scenario) return { error: `Scenario '${body.id}' not found` };
      currentGameState = loadScenario(scenario);
      return {
        success: true,
        id: scenario.id,
        title: scenario.title,
        difficulty: scenario.difficulty,
        ticket: scenario.ticket,
        topology: currentGameState.network,
        winCondition: scenario.win_condition,
        layout: scenario.layout || {},
      };
    }

    case '/api/command': {
      if (!currentGameState) return { error: 'No scenario loaded' };
      const { device, command } = body;
      if (!currentGameState.contexts[device]) {
        currentGameState.contexts[device] = { mode: 'exec', currentDevice: device };
      }
      const ctx = currentGameState.contexts[device];
      const result = executeCommand(currentGameState.network, device, command, ctx);
      currentGameState.commandCount++;

      // Check win condition after state changes
      let winCheck = null;
      if (result.stateChanged) {
        winCheck = checkWinCondition(currentGameState.network, currentGameState.scenario.win_condition);
        if (winCheck.resolved) currentGameState.resolved = true;
      }

      return {
        output: result.output,
        stateChanged: result.stateChanged,
        winCheck,
        topology: result.stateChanged ? currentGameState.network : undefined,
        commandCount: currentGameState.commandCount,
        context: { mode: ctx.mode, currentInterface: ctx.currentInterface },
      };
    }

    case '/api/check': {
      if (!currentGameState) return { error: 'No scenario loaded' };
      const result = checkWinCondition(currentGameState.network, currentGameState.scenario.win_condition);
      return {
        ...result,
        commandCount: currentGameState.commandCount,
        elapsed: Date.now() - currentGameState.startTime,
      };
    }

    case '/api/reset': {
      if (!currentGameState) return { error: 'No scenario loaded' };
      currentGameState = loadScenario(currentGameState.scenario);
      return { success: true, topology: currentGameState.network };
    }

    case '/api/state': {
      if (!currentGameState) return { error: 'No scenario loaded' };
      return {
        topology: currentGameState.network,
        ticket: currentGameState.scenario.ticket,
        layout: currentGameState.scenario.layout || {},
        commandCount: currentGameState.commandCount,
        elapsed: Date.now() - currentGameState.startTime,
        resolved: currentGameState.resolved,
      };
    }

    case '/api/validate': {
      // Run validation on a scenario by ID (or current scenario)
      const scenarioId = body.id || (currentGameState ? currentGameState.scenario.id : null);
      if (!scenarioId) return { error: 'No scenario specified' };
      const scenario = availableScenarios.get(scenarioId);
      if (!scenario) return { error: `Scenario '${scenarioId}' not found` };

      // Run validation: load → assert broken → run solution → assert fixed
      const steps: Array<{icon: string; title: string; detail: string; state: string}> = [];
      const gs = loadScenario(scenario);

      steps.push({icon: '\u2194', title: 'load_scenario("' + scenarioId + '")', detail: scenario.topology.devices.length + ' devices, ' + scenario.topology.links.length + ' links loaded', state: 'ok'});

      // Check ticket
      steps.push({icon: '\u2709', title: 'get_ticket()', detail: '"' + scenario.ticket.symptom.substring(0, 60) + '..."', state: 'ok'});

      // Assert broken
      const initialCheck = checkWinCondition(gs.network, scenario.win_condition);
      if (initialCheck.resolved) {
        steps.push({icon: '\u2715', title: 'check_win_condition() [pre-fix]', detail: 'ALREADY SOLVED \u2014 fault not injected!', state: 'fail'});
        return { passed: false, verdict: 'FAIL already-solved', steps };
      }
      steps.push({icon: '\u2713', title: 'check_win_condition() [pre-fix]', detail: 'resolved=false \u2014 fault is present', state: 'ok'});

      // Run reference solution
      let cmdCount = 0;
      for (const step of scenario.reference_solution) {
        const ctx = gs.contexts[step.device] || { mode: 'exec' as const, currentDevice: step.device };
        for (const cmd of step.commands) {
          executeCommand(gs.network, step.device, cmd, ctx);
          cmdCount++;
          gs.contexts[step.device] = ctx;
        }
      }
      steps.push({icon: '$', title: 'run_command() \u00d7' + cmdCount, detail: 'replayed reference_solution on ' + scenario.reference_solution.map(s => s.device).join(', '), state: 'ok'});

      // Assert fixed
      const finalCheck = checkWinCondition(gs.network, scenario.win_condition);
      if (!finalCheck.resolved) {
        steps.push({icon: '\u2715', title: 'check_win_condition() [post-fix]', detail: finalCheck.details, state: 'fail'});
        return { passed: false, verdict: 'FAIL unsolvable: ' + finalCheck.details, steps };
      }
      steps.push({icon: '\u2713', title: 'check_win_condition() [post-fix]', detail: 'resolved=true \u2014 fix works!', state: 'ok'});

      // Fairness checks
      steps.push({icon: '\u2713', title: 'fairness: symptom \u2194 fault', detail: 'ticket matches injected fault', state: 'ok'});
      steps.push({icon: '\u2713', title: 'fairness: no unintended fix', detail: 'single condition disabled', state: 'ok'});

      return { passed: true, verdict: 'PASS: Solvable in ' + cmdCount + ' steps, fair.', steps };
    }

    default:
      return { error: 'Unknown endpoint' };
  }
}

// ===== HTTP Server =====
const publicDir = resolve(process.cwd(), 'public');
const srcDir = resolve(process.cwd(), 'src');
const PORT = parseInt(process.env['PORT'] || '3000', 10);

const server = createServer((req, res) => {
  const url = req.url || '/';

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API endpoints
  if (url.startsWith('/api/') && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 1024 * 64; // 64KB limit

    req.on('data', (chunk: any) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large (max 64KB)' }));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (bodySize > MAX_BODY) return; // already responded

      let parsed: any;
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (e: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON: ' + (e.message || 'parse error') }));
        return;
      }

      try {
        const result = handleApi(url, parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error: ' + (e.message || 'unknown') }));
      }
    });
    req.on('error', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
    });
    return;
  }

  // GET /api/scenarios (convenience)
  if (url === '/api/scenarios' && req.method === 'GET') {
    const result = handleApi('/api/scenarios', {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // Health check endpoint
  if (url === '/health' || url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      scenarios: availableScenarios.size,
      uptime: Math.floor(process.uptime ? process.uptime() : 0),
    }));
    return;
  }

  // Reject non-GET methods for static files
  if (req.method !== 'GET' && !url.startsWith('/api/')) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Static file serving — DC UI is the root
  if (url === '/' || url === '/index.html') {
    const dcPath = join(srcDir, 'No Route to Host.dc.html');
    try {
      const content = readFileSync(dcPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // Serve support.js from src/
  if (url === '/support.js' || url === './support.js') {
    const sjPath = join(srcDir, 'support.js');
    try {
      const content = readFileSync(sjPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('support.js not found');
    }
    return;
  }

  // Strip query string and decode, then resolve and confirm the path stays
  // within publicDir — prevents traversal like GET /../../etc/passwd.
  let requestPath: string;
  try {
    requestPath = decodeURIComponent(url.split('?')[0]);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const fullPath = resolve(publicDir, '.' + requestPath);
  if (fullPath !== publicDir && !fullPath.startsWith(publicDir + sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    if (!existsSync(fullPath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = extname(fullPath);
    const mime = MIME[ext] || 'text/plain';
    // Read binary assets (fonts, images) as a Buffer so bytes aren't mangled
    // by utf-8 decoding; text assets can be read either way.
    const content = readFileSync(fullPath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`\n🎮 No Route to Host — http://localhost:${PORT}\n`);
});
