/**
 * HTTP Server for No Route to Host
 * Serves the static frontend and provides a JSON API to the game engine.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
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
        ticket: scenario.ticket,
        topology: currentGameState.network,
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
    req.on('data', (chunk: any) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const result = handleApi(url, parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
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

  let filePath = url;
  const fullPath = join(publicDir, filePath);

  try {
    if (!existsSync(fullPath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const content = readFileSync(fullPath, 'utf-8');
    const ext = extname(fullPath);
    const mime = MIME[ext] || 'text/plain';
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
