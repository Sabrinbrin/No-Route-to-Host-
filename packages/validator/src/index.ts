/**
 * Scenario Validator — the CI determinism + fairness gate.
 *
 * Imports the unified validateScenario from @nrth/engine — the SAME
 * logic the Author Studio and MCP validate_scenario tool use.
 * Zero duplication.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseScenario, validateScenario } from '@nrth/engine';

function findScenariosDir(): string {
  const primary = resolve(process.cwd(), 'scenarios');
  try {
    readdirSync(primary);
    return primary;
  } catch {
    return resolve(import.meta.url.replace('file://', '').replace('/dist/index.js', ''), 'scenarios');
  }
}

function main(): void {
  const scenariosDir = findScenariosDir();
  let files: string[];
  try {
    files = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.yaml'));
  } catch {
    console.error('Cannot find scenarios directory.');
    process.exit(1);
    return;
  }

  console.log(`\n\u{1f50d} Validating ${files.length} scenarios (solvable + fair)...\n`);

  let allPassed = true;
  let passCount = 0;
  for (const file of files.sort()) {
    const scenario = parseScenario(readFileSync(join(scenariosDir, file), 'utf-8'));
    const result = validateScenario(scenario);
    if (result.passed) {
      passCount++;
      console.log(`  \u2713 ${scenario.title} (${scenario.id}) \u2014 PASS: ${result.details}`);
    } else {
      allPassed = false;
      console.log(`  \u2717 ${scenario.title} (${scenario.id}) \u2014 FAIL ${result.verdict}: ${result.details}`);
    }
  }

  console.log(`\n${'\u2500'.repeat(60)}`);
  console.log(`Results: ${passCount}/${files.length} passed`);
  if (!allPassed) {
    console.log('\n\u274c Some scenarios failed validation.');
    process.exit(1);
  }
  console.log('\n\u2705 All scenarios validated successfully (solvable + fair).');
  process.exit(0);
}

main();
