/**
 * Engine test entry point. Imports every *.test module (which register their
 * cases via the harness) and then runs them. Exits non-zero on any failure.
 *
 *   npm test   (build + node dist/tests/index.js)
 */
import './utils.test.js';
import './reachability.test.js';
import './cli.test.js';
import './scenarios.test.js';
import './validate.test.js';
import { run } from './harness.js';

console.log('\n🧪 Running engine unit tests...\n');
run();
