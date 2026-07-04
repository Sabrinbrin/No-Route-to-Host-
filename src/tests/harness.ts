/**
 * Tiny zero-dependency test harness.
 *
 * The whole project ships without runtime/dev test frameworks (see NFR-3/4),
 * so tests are plain TypeScript compiled to dist/ and run with node. This
 * harness collects pass/fail counts and makes the process exit non-zero on any
 * failure so it can gate CI.
 */

interface Case { name: string; fn: () => void; }

const cases: Case[] = [];
let currentSuite = '';

export function suite(name: string): void {
  currentSuite = name;
}

export function test(name: string, fn: () => void): void {
  cases.push({ name: currentSuite ? `${currentSuite} › ${name}` : name, fn });
}

export function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message ? message + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message ? message + ': ' : ''}expected ${e}, got ${a}`);
  }
}

export function run(): void {
  let passed = 0;
  const failures: string[] = [];
  for (const c of cases) {
    try {
      c.fn();
      passed++;
      console.log(`  ✓ ${c.name}`);
    } catch (e: any) {
      failures.push(`  ✗ ${c.name}\n      ${e.message || e}`);
      console.log(`  ✗ ${c.name}`);
    }
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${passed}/${cases.length} passed`);
  if (failures.length) {
    console.log(`\nFailures:\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  console.log('✅ All engine tests passed.\n');
}
