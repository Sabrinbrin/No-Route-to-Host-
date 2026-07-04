import { suite, test, assert, assertEqual } from './harness.js';
import {
  ipToNum,
  numToIp,
  getNetwork,
  sameSubnet,
  prefixToMask,
  routeMatches,
  vlanAllowedOnTrunk,
  findInterface,
} from '../src/utils.js';
import { Device } from '../src/types.js';

suite('utils');

test('ipToNum / numToIp round-trip', () => {
  for (const ip of ['0.0.0.0', '10.0.10.1', '192.168.1.255', '255.255.255.255']) {
    assertEqual(numToIp(ipToNum(ip)), ip, `round-trip ${ip}`);
  }
});

test('ipToNum is unsigned for high addresses', () => {
  assert(ipToNum('255.255.255.255') === 0xffffffff, '255.255.255.255 must be unsigned 0xffffffff');
});

test('getNetwork masks host bits', () => {
  assertEqual(getNetwork('10.0.10.37', '255.255.255.0'), '10.0.10.0');
  assertEqual(getNetwork('192.168.1.200', '255.255.255.128'), '192.168.1.128');
});

test('sameSubnet true within /24, false across', () => {
  assert(sameSubnet('10.0.10.5', '10.0.10.200', '255.255.255.0'), 'same /24');
  assert(!sameSubnet('10.0.10.5', '10.0.20.5', '255.255.255.0'), 'different /24');
});

test('prefixToMask', () => {
  assertEqual(prefixToMask(24), '255.255.255.0');
  assertEqual(prefixToMask(30), '255.255.255.252');
  assertEqual(prefixToMask(0), '0.0.0.0');
  assertEqual(prefixToMask(32), '255.255.255.255');
});

test('routeMatches respects the mask (default route matches all)', () => {
  assert(routeMatches('0.0.0.0', '0.0.0.0', '8.8.8.8'), 'default route matches anything');
  assert(routeMatches('10.2.0.0', '255.255.255.0', '10.2.0.10'), 'in-subnet match');
  assert(!routeMatches('10.2.0.0', '255.255.255.0', '10.3.0.10'), 'out-of-subnet no match');
});

test('vlanAllowedOnTrunk honors the allowed list', () => {
  const dev: Device = {
    id: 'sw', hostname: 'SW', type: 'switch',
    interfaces: [
      { name: 'Gi0/1', status: 'up', mode: 'trunk', trunkAllowedVlans: [10, 20] },
      { name: 'Gi0/2', status: 'up', mode: 'access', accessVlan: 10 },
    ],
    routing: { enabled: false, routes: [], svis: [] },
  };
  assert(vlanAllowedOnTrunk(dev, 'Gi0/1', 10), 'VLAN 10 allowed on trunk');
  assert(!vlanAllowedOnTrunk(dev, 'Gi0/1', 30), 'VLAN 30 not in allowed list');
  assert(!vlanAllowedOnTrunk(dev, 'Gi0/2', 10), 'access port is not a trunk');
});

test('findInterface is case-insensitive', () => {
  const dev: Device = {
    id: 'sw', hostname: 'SW', type: 'switch',
    interfaces: [{ name: 'Gi0/1', status: 'up' }],
    routing: { enabled: false, routes: [], svis: [] },
  };
  assert(!!findInterface(dev, 'gi0/1'), 'lowercase match');
  assert(!!findInterface(dev, 'GI0/1'), 'uppercase match');
  assert(!findInterface(dev, 'Gi0/9'), 'no match');
});
