/**
 * Scenario Validator — Verifies each scenario is solvable by running
 * the reference solution and checking the win condition.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  Scenario,
  GameState,
  CommandContext,
} from '../engine/types.js';
import { loadScenario, checkWinCondition, parseScenarioJson } from '../engine/scenario-loader.js';
import { executeCommand } from '../engine/cli-parser.js';

interface ValidationResult {
  scenarioId: string;
  title: string;
  passed: boolean;
  steps: number;
  details: string;
}

function validateScenario(scenario: Scenario): ValidationResult {
  // Step 1: Load the scenario (applies the fault)
  const gameState = loadScenario(scenario);

  // Step 2: Verify the fault is present (win condition should NOT be met)
  const initialCheck = checkWinCondition(gameState.network, scenario.win_condition);
  if (initialCheck.resolved) {
    return {
      scenarioId: scenario.id,
      title: scenario.title,
      passed: false,
      steps: 0,
      details: `FAIL: Win condition already satisfied before fix. Fault not properly injected. Details: ${initialCheck.details}`,
    };
  }

  // Step 3: Execute the reference solution
  let stepCount = 0;
  for (const step of scenario.reference_solution) {
    const context: CommandContext = gameState.contexts[step.device] || {
      mode: 'exec',
      currentDevice: step.device,
    };

    for (const cmd of step.commands) {
      const result = executeCommand(gameState.network, step.device, cmd, context);
      stepCount++;

      // Update context in game state
      gameState.contexts[step.device] = context;
    }
  }

  // Step 4: Check win condition after solution
  const finalCheck = checkWinCondition(gameState.network, scenario.win_condition);
  if (!finalCheck.resolved) {
    return {
      scenarioId: scenario.id,
      title: scenario.title,
      passed: false,
      steps: stepCount,
      details: `FAIL: Win condition not met after reference solution. ${finalCheck.details}`,
    };
  }

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    passed: true,
    steps: stepCount,
    details: `PASS: Solvable in ${stepCount} steps.`,
  };
}

function main() {
  const scenariosDir = resolve(process.cwd(), 'scenarios');
  let files: string[] = [];

  try {
    files = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.json'));
  } catch (e) {
    // Try relative to script location
    const altDir = resolve(import.meta.url.replace('file://', '').replace('/dist/validator/index.js', ''), 'scenarios');
    try {
      files = readdirSync(altDir).filter((f: string) => f.endsWith('.json'));
    } catch {
      console.error('Cannot find scenarios directory.');
      process.exit(1);
    }
  }

  console.log(`\n🔍 Validating ${files.length} scenarios...\n`);

  let allPassed = true;
  const results: ValidationResult[] = [];

  for (const file of files.sort()) {
    const filePath = join(scenariosDir, file);
    const content = readFileSync(filePath, 'utf-8');
    const scenario = parseScenarioJson(content);
    const result = validateScenario(scenario);
    results.push(result);

    const icon = result.passed ? '✓' : '✗';
    console.log(`  ${icon} ${result.title} (${result.scenarioId}) — ${result.details}`);

    if (!result.passed) allPassed = false;
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${results.filter(r => r.passed).length}/${results.length} passed`);

  if (!allPassed) {
    console.log('\n❌ Some scenarios failed validation.');
    process.exit(1);
  } else {
    console.log('\n✅ All scenarios validated successfully.');
    process.exit(0);
  }
}

main();
