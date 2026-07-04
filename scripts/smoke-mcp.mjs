// CI smoke test: connect to the MCP server as a real client, list tools +
// scenarios, then play a scenario to a win over the actual protocol.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['packages/mcp-server/dist/index.js'] });
const client = new Client({ name: 'ci-smoke', version: '1.0.0' });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name);
const parse = (r) => JSON.parse(r.content[0].text);
const scenarios = parse(await client.callTool({ name: 'list_scenarios', arguments: {} }));
if (scenarios.length < 8) throw new Error(`expected >= 8 scenarios, got ${scenarios.length}`);

await client.callTool({ name: 'load_scenario', arguments: { id: 'wrong-access-vlan' } });
if (parse(await client.callTool({ name: 'check_win_condition', arguments: {} })).resolved)
  throw new Error('fault not present at load');
for (const command of ['configure terminal', 'interface Gi0/1', 'switchport access vlan 10', 'end'])
  await client.callTool({ name: 'run_command', arguments: { device: 'switch1', command } });
if (!parse(await client.callTool({ name: 'check_win_condition', arguments: {} })).resolved)
  throw new Error('reference solution did not resolve the win');

console.log(`✓ MCP smoke: ${tools.length} tools, ${scenarios.length} scenarios, scenario played to a win`);
await client.close();
