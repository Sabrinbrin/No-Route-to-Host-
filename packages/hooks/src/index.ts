/**
 * On-Save Hook — Watches scenario files and validates them automatically.
 * 
 * When a scenario file is saved (created/modified), this hook:
 * 1. Parses the JSON
 * 2. Validates the schema
 * 3. Runs the reference solution through the engine
 * 4. Reports pass/fail
 * 
 * Usage: node dist/hooks/index.js
 * Exit: 0 on pass, 1 on fail (useful for CI)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
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

// ===== Schema Validation =====

interface SchemaError {
  field: string;
  message: string;
}

function validateSchema(data: any): SchemaError[] {
  const errors: SchemaError[] = [];

  if (!data.id || typeof data.id !== 'string') errors.push({ field: 'id', message: 'Missing or invalid id' });
  if (!data.title || typeof data.title !== 'string') errors.push({ field: 'title', message: 'Missing or invalid title' });
  if (typeof data.difficulty !== 'number') errors.push({ field: 'difficulty', message: 'Missing or invalid difficulty' });
  if (!data.topology) errors.push({ field: 'topology', message: 'Missing topology' });
  else {
    if (!Array.isArray(data.topology.devices)) errors.push({ field: 'topology.devices', message: 'Missing or invalid devices array' });
    if (!Array.isArray(data.topology.links)) errors.push({ field: 'topology.links', message: 'Missing or invalid links array' });
  }
  if (!data.injected_fault) errors.push({ field: 'injected_fault', message: 'Missing injected_fault' });
  else {
    if (!data.injected_fault.device) errors.push({ field: 'injected_fault.device', message: 'Missing fault device' });
    if (!data.injected_fault.field) errors.push({ field: 'injected_fault.field', message: 'Missing fault field' });
  }
  if (!data.ticket) errors.push({ field: 'ticket', message: 'Missing ticket' });
  else {
    if (!data.ticket.title) errors.push({ field: 'ticket.title', message: 'Missing ticket title' });
    if (!data.ticket.symptom) errors.push({ field: 'ticket.symptom', message: 'Missing ticket symptom' });
  }
  if (!data.win_condition) errors.push({ field: 'win_condition', message: 'Missing win_condition' });
  else {
    if (data.win_condition.type !== 'ping') errors.push({ field: 'win_condition.type', message: 'Only ping type supported' });
    if (!data.win_condition.source) errors.push({ field: 'win_condition.source', message: 'Missing source' });
    if (!data.win_condition.destination) errors.push({ field: 'win_condition.destination', message: 'Missing destination' });
  }
  if (!Array.isArray(data.reference_solution)) errors.push({ field: 'reference_solution', message: 'Missing or invalid reference_solution' });

  return errors;
}

// ===== Scenario Validation =====

interface ValidationResult {
  file: string;
  scenarioId: string;
  title: string;
  passed: boolean;
  steps: number;
  details: string;
}

function validateScenarioFile(filePath: string): ValidationResult {
  const fileName = basename(filePath);

  // Parse the scenario (YAML, superset of JSON)
  let data: any;
  try {
    const content = readFileSync(filePath, 'utf-8');
    data = parseScenario(content);
  } catch (e: any) {
    return {
      file: fileName,
      scenarioId: '?',
      title: '?',
      passed: false,
      steps: 0,
      details: `Parse error: ${e.message}`,
    };
  }

  // Validate schema
  const schemaErrors = validateSchema(data);
  if (schemaErrors.length > 0) {
    return {
      file: fileName,
      scenarioId: data.id || '?',
      title: data.title || '?',
      passed: false,
      steps: 0,
      details: `Schema errors: ${schemaErrors.map(e => `${e.field}: ${e.message}`).join('; ')}`,
    };
  }

  const scenario = data as Scenario;

  // Load scenario (applies fault)
  let gameState: GameState;
  try {
    gameState = loadScenario(scenario);
  } catch (e: any) {
    return {
      file: fileName,
      scenarioId: scenario.id,
      title: scenario.title,
      passed: false,
      steps: 0,
      details: `Load error: ${e.message}`,
    };
  }

  // Step 1: Verify fault is present
  const initialCheck = checkWinCondition(gameState.network, scenario.win_condition);
  if (initialCheck.resolved) {
    return {
      file: fileName,
      scenarioId: scenario.id,
      title: scenario.title,
      passed: false,
      steps: 0,
      details: `Fault not injected: win condition already satisfied. ${initialCheck.details}`,
    };
  }

  // Step 2: Execute reference solution
  let stepCount = 0;
  for (const step of scenario.reference_solution) {
    const context: CommandContext = gameState.contexts[step.device] || {
      mode: 'exec',
      currentDevice: step.device,
    };

    for (const cmd of step.commands) {
      executeCommand(gameState.network, step.device, cmd, context);
      stepCount++;
      gameState.contexts[step.device] = context;
    }
  }

  // Step 3: Verify fix
  const finalCheck = checkWinCondition(gameState.network, scenario.win_condition);
  if (!finalCheck.resolved) {
    return {
      file: fileName,
      scenarioId: scenario.id,
      title: scenario.title,
      passed: false,
      steps: stepCount,
      details: `Reference solution failed: ${finalCheck.details}`,
    };
  }

  return {
    file: fileName,
    scenarioId: scenario.id,
    title: scenario.title,
    passed: true,
    steps: stepCount,
    details: `Solvable in ${stepCount} steps.`,
  };
}

// ===== File Watcher (polling-based, no chokidar needed) =====

function watchMode(scenariosDir: string): void {
  console.log(`\n👁  Watching ${scenariosDir} for changes...\n`);
  console.log('   Save a scenario file to trigger validation.\n');

  const lastMtimes: Record<string, number> = {};

  // Initial scan
  const files = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.yaml'));
  for (const file of files) {
    const fullPath = join(scenariosDir, file);
    lastMtimes[file] = statSync(fullPath).mtimeMs;
  }

  // Poll every second
  setInterval(() => {
    let currentFiles: string[];
    try {
      currentFiles = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.yaml'));
    } catch {
      return;
    }

    for (const file of currentFiles) {
      const fullPath = join(scenariosDir, file);
      let mtime: number;
      try {
        mtime = statSync(fullPath).mtimeMs;
      } catch {
        continue;
      }

      if (lastMtimes[file] !== mtime) {
        lastMtimes[file] = mtime;
        console.log(`\n📝 Change detected: ${file}`);
        const result = validateScenarioFile(fullPath);
        const icon = result.passed ? '✓' : '✗';
        const color = result.passed ? '\x1b[32m' : '\x1b[31m';
        console.log(`   ${color}${icon}\x1b[0m ${result.title} (${result.scenarioId}) — ${result.details}`);
      }
    }
  }, 1000);
}

// ===== Single-run validation (for CI / on-save trigger) =====

function validateAll(scenariosDir: string): boolean {
  const files = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.yaml'));
  console.log(`\n🔍 Validating ${files.length} scenarios...\n`);

  let allPassed = true;
  for (const file of files.sort()) {
    const fullPath = join(scenariosDir, file);
    const result = validateScenarioFile(fullPath);
    const icon = result.passed ? '✓' : '✗';
    console.log(`  ${icon} ${result.title} (${result.scenarioId}) — ${result.details}`);
    if (!result.passed) allPassed = false;
  }

  console.log(`\n${'─'.repeat(60)}`);
  if (allPassed) {
    console.log('✅ All scenarios validated successfully.\n');
  } else {
    console.log('❌ Some scenarios failed validation.\n');
  }
  return allPassed;
}

// ===== Validate single file (for hook triggers) =====

function validateSingle(filePath: string): boolean {
  console.log(`\n🔍 Validating: ${basename(filePath)}`);
  const result = validateScenarioFile(filePath);
  const icon = result.passed ? '✓' : '✗';
  console.log(`  ${icon} ${result.title} (${result.scenarioId}) — ${result.details}\n`);
  return result.passed;
}

// ===== Main =====

function main(): void {
  const args = process.argv.slice(2);
  const scenariosDir = resolve(process.cwd(), 'scenarios');

  if (args.includes('--watch') || args.includes('-w')) {
    // Watch mode: poll for changes
    validateAll(scenariosDir);
    watchMode(scenariosDir);
  } else if (args.length > 0 && !args[0].startsWith('-')) {
    // Single file validation
    const filePath = resolve(args[0]);
    const passed = validateSingle(filePath);
    process.exit(passed ? 0 : 1);
  } else {
    // Validate all and exit
    const passed = validateAll(scenariosDir);
    process.exit(passed ? 0 : 1);
  }
}

main();
