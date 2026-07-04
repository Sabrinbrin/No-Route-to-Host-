import { suite, test, assert, assertEqual } from './harness.js';
import { executeCommand } from '../engine/cli-parser.js';
import { NetworkState, CommandContext, Device } from '../engine/types.js';

suite('cli-parser');

function switchState(): NetworkState {
  const sw: Device = {
    id: 'sw', hostname: 'SW1', type: 'switch',
    interfaces: [{ name: 'Gi0/1', status: 'up', mode: 'access', accessVlan: 20 }],
    routing: { enabled: false, routes: [], svis: [{ vlan: 10, ip: '10.0.10.1', mask: '255.255.255.0', status: 'down' }] },
  };
  return { devices: [sw], links: [] };
}

function ctx(): CommandContext { return { mode: 'exec', currentDevice: 'sw' }; }

test('IOS abbreviation: "sh vlan br" runs show vlan brief', () => {
  const r = executeCommand(switchState(), 'sw', 'sh vlan br', ctx());
  assert(r.output.includes('VLAN'), 'should render a VLAN table');
});

test('"conf t" enters config mode', () => {
  const c = ctx();
  executeCommand(switchState(), 'sw', 'conf t', c);
  assertEqual(c.mode, 'config', 'mode should be config');
});

test('abbreviated path: conf t → int Gi0/1 → sw acc vlan 10 mutates access VLAN', () => {
  const state = switchState();
  const c = ctx();
  executeCommand(state, 'sw', 'conf t', c);
  executeCommand(state, 'sw', 'int Gi0/1', c);
  assertEqual(c.mode, 'config-if', 'mode should be config-if');
  const r = executeCommand(state, 'sw', 'sw acc vlan 10', c);
  assert(r.stateChanged, 'state should change');
  assertEqual(state.devices[0].interfaces[0].accessVlan, 10, 'access VLAN set to 10');
});

test('"no shut" on an SVI brings it up', () => {
  const state = switchState();
  const c = ctx();
  executeCommand(state, 'sw', 'configure terminal', c);
  executeCommand(state, 'sw', 'interface Vlan10', c);
  const r = executeCommand(state, 'sw', 'no shut', c);
  assert(r.stateChanged, 'state should change');
  assertEqual(state.devices[0].routing.svis[0].status, 'up', 'SVI should be up');
});

test('"ip routing" enables L3 routing', () => {
  const state = switchState();
  const c = ctx();
  executeCommand(state, 'sw', 'conf t', c);
  const r = executeCommand(state, 'sw', 'ip routing', c);
  assert(r.stateChanged, 'state changed');
  assert(state.devices[0].routing.enabled, 'routing enabled');
});

test('unknown command returns help without changing state', () => {
  const r = executeCommand(switchState(), 'sw', 'frobnicate', ctx());
  assert(!r.stateChanged, 'no state change');
  assert(r.output.toLowerCase().includes('unknown') || r.output.includes('%'), 'help/error text');
});

test('invalid VLAN id is rejected', () => {
  const state = switchState();
  const c = ctx();
  executeCommand(state, 'sw', 'conf t', c);
  executeCommand(state, 'sw', 'int Gi0/1', c);
  const r = executeCommand(state, 'sw', 'switchport access vlan 9999', c);
  assert(!r.stateChanged, 'out-of-range VLAN rejected');
  assertEqual(state.devices[0].interfaces[0].accessVlan, 20, 'access VLAN unchanged');
});
