import { suite, test, assert, assertEqual } from './harness.js';
import { evaluatePing } from '../engine/reachability.js';
import { NetworkState, Device } from '../engine/types.js';

suite('reachability');

function host(id: string, ip: string, gateway?: string): Device {
  return {
    id, hostname: id, type: 'host',
    interfaces: [{ name: 'eth0', ip, mask: '255.255.255.0', status: 'up', gateway }],
    routing: { enabled: false, routes: [], svis: [] },
  };
}

function accessSwitch(id: string, ports: { name: string; vlan: number }[], svis: Device['routing']['svis'] = []): Device {
  return {
    id, hostname: id, type: 'switch',
    interfaces: ports.map(p => ({ name: p.name, status: 'up', mode: 'access', accessVlan: p.vlan })),
    routing: { enabled: false, routes: [], svis },
  };
}

// Two hosts on one access switch, same subnet.
function twoHostState(vlanA: number, vlanB: number): NetworkState {
  return {
    devices: [
      host('a', '10.0.10.5'),
      host('b', '10.0.10.6'),
      accessSwitch('sw', [{ name: 'Gi0/1', vlan: vlanA }, { name: 'Gi0/2', vlan: vlanB }]),
    ],
    links: [
      { id: 'l1', from: { device: 'a', interface: 'eth0' }, to: { device: 'sw', interface: 'Gi0/1' } },
      { id: 'l2', from: { device: 'b', interface: 'eth0' }, to: { device: 'sw', interface: 'Gi0/2' } },
    ],
  };
}

test('Condition 1: host pinging another subnet with no gateway fails on condition 1', () => {
  const state: NetworkState = { devices: [host('a', '10.0.10.5')], links: [] };
  const r = evaluatePing(state, 'a', '10.0.99.9');
  assert(!r.success, 'should fail');
  assertEqual(r.failedCondition, 1, 'failedCondition should be 1');
});

test('loopback ping (source == destination) succeeds', () => {
  const state: NetworkState = { devices: [host('a', '10.0.10.5')], links: [] };
  assert(evaluatePing(state, 'a', '10.0.10.5').success, 'ping self succeeds');
});

test('Condition 2: same subnet, same VLAN succeeds', () => {
  const r = evaluatePing(twoHostState(10, 10), 'a', '10.0.10.6');
  assert(r.success, `expected success, got: ${r.reason}`);
});

test('Condition 2: same subnet, mismatched VLAN fails on condition 2', () => {
  const r = evaluatePing(twoHostState(10, 20), 'a', '10.0.10.6');
  assert(!r.success, 'VLAN mismatch should fail');
  assertEqual(r.failedCondition, 2, 'failedCondition should be 2');
});

test('unknown source device fails on condition 0', () => {
  const state: NetworkState = { devices: [host('a', '10.0.10.5')], links: [] };
  const r = evaluatePing(state, 'nope', '10.0.10.5');
  assert(!r.success, 'unknown device fails');
  assertEqual(r.failedCondition, 0, 'failedCondition should be 0');
});

test('determinism: identical inputs yield identical results', () => {
  const s1 = twoHostState(10, 20);
  const s2 = twoHostState(10, 20);
  const r1 = evaluatePing(s1, 'a', '10.0.10.6');
  const r2 = evaluatePing(s2, 'a', '10.0.10.6');
  assertEqual(r1.success, r2.success, 'same success');
  assertEqual(r1.failedCondition, r2.failedCondition, 'same failedCondition');
  assertEqual(r1.reason, r2.reason, 'same reason');
});
