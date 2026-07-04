import {
  NetworkState,
  Device,
  NetworkInterface,
  PingResult,
  Link,
} from './types.js';
import {
  findDevice,
  findInterface,
  findDeviceByIp,
  getHostVlan,
  sameSubnet,
  getNetwork,
  routeMatches,
  vlanAllowedOnTrunk,
  getDeviceLinks,
  getOtherEnd,
} from './utils.js';

/**
 * Evaluate a ping from a source device to a destination IP.
 * Uses constraint-based evaluation (5 conditions in order).
 */
export function evaluatePing(state: NetworkState, sourceDeviceId: string, destIp: string): PingResult {
  const srcDevice = findDevice(state, sourceDeviceId);
  if (!srcDevice) {
    return { success: false, reason: `Device '${sourceDeviceId}' not found.`, failedCondition: 0 };
  }

  // Get source's outgoing interface (first interface with an IP, or the primary one)
  const srcIface = getSrcInterface(srcDevice);
  if (!srcIface) {
    return { success: false, reason: 'No active interface on source device.', failedCondition: 1 };
  }

  // === CONDITION 1: Source host has valid IP/mask/gateway ===
  const cond1 = checkCondition1(srcDevice, srcIface, destIp);
  if (!cond1.success) return cond1;

  // Check if destination is directly on the same device (loopback ping)
  if (srcIface.ip === destIp) {
    return { success: true };
  }

  // Find the destination device/interface
  const dstResult = findDeviceByIp(state, destIp);

  // Determine if same subnet or different subnet
  const srcIp = srcIface.ip!;
  const srcMask = srcIface.mask!;

  if (sameSubnet(srcIp, destIp, srcMask)) {
    // Same subnet - L2 path check
    return evaluateL2Ping(state, srcDevice, srcIface, destIp, dstResult);
  } else {
    // Different subnet - need routing
    return evaluateL3Ping(state, srcDevice, srcIface, destIp, dstResult);
  }
}

function getSrcInterface(device: Device): NetworkInterface | undefined {
  // For hosts, find the primary interface with an IP
  const active = device.interfaces.find(i => i.ip && i.status === 'up');
  if (active) return active;
  // Fallback: any interface with IP
  return device.interfaces.find(i => i.ip);
}

/**
 * Condition 1: Source has valid IP configuration.
 */
function checkCondition1(device: Device, iface: NetworkInterface, destIp: string): PingResult {
  if (!iface.ip || !iface.mask) {
    return { success: false, reason: 'No IP configuration on source.', failedCondition: 1 };
  }
  if (iface.status !== 'up') {
    return { success: false, reason: 'Source interface is down.', failedCondition: 1 };
  }
  // For hosts, if destination is not in same subnet, need a gateway
  if (device.type === 'host' && !sameSubnet(iface.ip, destIp, iface.mask)) {
    if (!iface.gateway) {
      return { success: false, reason: 'No default gateway configured on source host.', failedCondition: 1 };
    }
  }
  return { success: true };
}

/**
 * Evaluate same-subnet (L2) ping.
 * Conditions 2 & 3 apply.
 */
function evaluateL2Ping(
  state: NetworkState,
  srcDevice: Device,
  srcIface: NetworkInterface,
  destIp: string,
  dstResult: { device: Device; iface: NetworkInterface } | undefined
): PingResult {
  // If source is a host, check access VLAN path
  if (srcDevice.type === 'host') {
    // Check if host is directly connected to a router/firewall interface
    const directConnect = isDirectlyConnectedToRouter(state, srcDevice, srcIface);
    if (directConnect) {
      // Host is directly connected to a router/firewall — no VLAN needed
      // Check AWS conditions if applicable
      if (dstResult) {
        const awsCheck = checkAWSConditions(state, srcDevice, dstResult.device, destIp);
        if (!awsCheck.success) return awsCheck;
        // Check OS-level conditions (iptables, Windows Firewall, services)
        const osCheck = checkOSConditions(state, srcDevice, dstResult.device, destIp);
        if (!osCheck.success) return osCheck;
      }
      // Just verify the destination is reachable on that segment
      if (dstResult || findDeviceByIp(state, destIp)) {
        return { success: true };
      }
      return { success: false, reason: `Destination ${destIp} not found on connected segment.`, failedCondition: 2 };
    }

    const srcVlan = getHostVlan(state, srcDevice, srcIface);
    if (srcVlan === undefined) {
      return { success: false, reason: 'Source not connected to a valid access port.', failedCondition: 2 };
    }

    // Destination must also be in the same VLAN
    if (dstResult) {
      if (dstResult.device.type === 'host') {
        const dstVlan = getHostVlan(state, dstResult.device, dstResult.iface);
        if (dstVlan === undefined) {
          return { success: false, reason: 'Destination not connected to a valid access port.', failedCondition: 2 };
        }
        if (srcVlan !== dstVlan) {
          return { success: false, reason: `Source is in VLAN ${srcVlan}, destination is in VLAN ${dstVlan}. VLANs don't match.`, failedCondition: 2 };
        }
        // Check if VLANs are on the same switch or trunked
        const trunkCheck = checkTrunkPath(state, srcDevice, dstResult.device, srcVlan);
        if (!trunkCheck.success) return trunkCheck;
      } else {
        // Destination is a network device (e.g., SVI)
        // Check that the SVI VLAN matches the source VLAN
        const dstSvi = dstResult.device.routing.svis.find(s => s.ip === destIp);
        if (dstSvi && dstSvi.vlan !== srcVlan) {
          return { success: false, reason: `Source VLAN ${srcVlan} doesn't match destination SVI VLAN ${dstSvi.vlan}.`, failedCondition: 2 };
        }
        if (dstSvi && dstSvi.status !== 'up') {
          return { success: false, reason: `Destination SVI for VLAN ${dstSvi.vlan} is down.`, failedCondition: 2 };
        }
      }
    } else {
      // Destination IP not found on any device - check if it's a gateway (SVI)
      // Look for the gateway IP on an SVI
      const gateway = findGatewayDevice(state, destIp);
      if (!gateway) {
        return { success: false, reason: `Destination ${destIp} not found in the network.`, failedCondition: 2 };
      }
      // Check SVI is up and in same VLAN
      if (gateway.svi.status !== 'up') {
        return { success: false, reason: `Gateway SVI (VLAN ${gateway.svi.vlan}) is down.`, failedCondition: 2 };
      }
      if (gateway.svi.vlan !== srcVlan) {
        return { success: false, reason: `Source VLAN ${srcVlan} doesn't match gateway SVI VLAN ${gateway.svi.vlan}.`, failedCondition: 2 };
      }
    }
  }

  // If we get here, L2 path is valid
  if (!dstResult) {
    // Check if destination is an SVI
    const gateway = findGatewayDevice(state, destIp);
    if (gateway) return { success: true };
    return { success: false, reason: `Destination ${destIp} unreachable.`, failedCondition: 2 };
  }

  return { success: true };
}

/**
 * Evaluate cross-subnet (L3) ping.
 * Conditions 4 & 5 apply.
 */
function evaluateL3Ping(
  state: NetworkState,
  srcDevice: Device,
  srcIface: NetworkInterface,
  destIp: string,
  dstResult: { device: Device; iface: NetworkInterface } | undefined
): PingResult {
  // For host/EC2/server devices, check gateway is reachable first
  if (srcDevice.type === 'host' || srcDevice.type === 'ec2' || srcDevice.type === 'linux-server' || srcDevice.type === 'windows-server' || srcDevice.type === 'docker-host') {
    const gatewayIp = srcIface.gateway;
    if (!gatewayIp) {
      return { success: false, reason: 'No default gateway configured on source host.', failedCondition: 1 };
    }

    // Verify the gateway is reachable at L2
    const gwResult = evaluateL2Ping(state, srcDevice, srcIface, gatewayIp,
      findDeviceByIp(state, gatewayIp));
    if (!gwResult.success) return gwResult;

    // Now check routing from the gateway device to destination
    const gwDevice = findDeviceByIp(state, gatewayIp);
    if (!gwDevice) {
      return { success: false, reason: `Gateway ${gatewayIp} not found in network.`, failedCondition: 4 };
    }

    return evaluateRouting(state, gwDevice.device, destIp, dstResult);
  }

  // For network devices (routers/switches/firewalls), check routing directly
  return evaluateRouting(state, srcDevice, destIp, dstResult);
}

/**
 * Condition 4: Check L3 routing from a router/switch to destination.
 */
function evaluateRouting(
  state: NetworkState,
  routerDevice: Device,
  destIp: string,
  dstResult: { device: Device; iface: NetworkInterface } | undefined
): PingResult {
  // Check if routing is enabled (skip for routers, firewalls, vpc-routers, ec2, and OS servers which route via gateway)
  if (!routerDevice.routing.enabled && routerDevice.type !== 'router' && routerDevice.type !== 'firewall' && routerDevice.type !== 'vpc-router' && routerDevice.type !== 'ec2' && routerDevice.type !== 'linux-server' && routerDevice.type !== 'windows-server' && routerDevice.type !== 'docker-host') {
    return { success: false, reason: `Routing is not enabled on ${routerDevice.hostname}.`, failedCondition: 4 };
  }

  // Check if destination is directly connected (on an SVI or interface)
  for (const svi of routerDevice.routing.svis) {
    if (sameSubnet(svi.ip, destIp, svi.mask)) {
      if (svi.status !== 'up') {
        return { success: false, reason: `SVI for VLAN ${svi.vlan} is shutdown on ${routerDevice.hostname}.`, failedCondition: 4 };
      }
      // Destination is on a directly connected subnet via SVI
      // Check if destination actually exists
      if (dstResult || findDeviceByIp(state, destIp)) {
        // Check firewall if path crosses one
        const fwCheck = checkFirewallPath(state, routerDevice, destIp);
        if (!fwCheck.success) return fwCheck;
        return { success: true };
      }
      return { success: false, reason: `Destination ${destIp} not found on connected subnet.`, failedCondition: 4 };
    }
  }

  // Check router interfaces
  for (const iface of routerDevice.interfaces) {
    if (iface.ip && iface.mask && iface.status === 'up') {
      if (sameSubnet(iface.ip, destIp, iface.mask)) {
        // Directly connected - check if dest exists
        if (dstResult || findDeviceByIp(state, destIp)) {
          const fwCheck = checkFirewallPath(state, routerDevice, destIp);
          if (!fwCheck.success) return fwCheck;
          // Check AWS conditions on source and destination
          const actualDst = dstResult || findDeviceByIp(state, destIp);
          if (actualDst) {
            // Find the original source device (exclude destination from candidates)
            const srcForCheck = findOriginalSourceDeviceExcluding(state, routerDevice, actualDst.device.id) || routerDevice;
            const awsCheck = checkAWSConditions(state, srcForCheck, actualDst.device, destIp);
            if (!awsCheck.success) return awsCheck;
            const osCheck = checkOSConditions(state, srcForCheck, actualDst.device, destIp);
            if (!osCheck.success) return osCheck;
          }
          return { success: true };
        }
        return { success: false, reason: `Destination ${destIp} not reachable on connected interface.`, failedCondition: 4 };
      }
    }
  }

  // Not directly connected - need a route
  const route = findBestRoute(routerDevice, destIp);
  if (!route) {
    return { success: false, reason: `No route to ${destIp} on ${routerDevice.hostname}.`, failedCondition: 4 };
  }

  // Route found - verify next-hop is reachable
  const nextHopResult = findDeviceByIp(state, route.nextHop);
  if (!nextHopResult) {
    // Next-hop might be a tunnel interface or virtual - check if device has an interface with that as next-hop
    // For simplicity, if route exists and next-hop is configured, consider it potentially reachable
    // but check if there's a firewall in the path
    const fwCheck = checkFirewallPath(state, routerDevice, destIp);
    if (!fwCheck.success) return fwCheck;

    // Check the next-hop device can reach the destination
    return { success: false, reason: `Next-hop ${route.nextHop} is unreachable from ${routerDevice.hostname}.`, failedCondition: 4 };
  }

  // Check firewall path
  const fwCheck = checkFirewallPath(state, routerDevice, destIp);
  if (!fwCheck.success) return fwCheck;

  // Check AWS conditions (security groups, NACLs, route tables)
  if (dstResult) {
    const awsCheck = checkAWSConditions(state, routerDevice, dstResult.device, destIp);
    if (!awsCheck.success) return awsCheck;
  }

  // Recurse: can the next-hop device reach the destination?
  if (nextHopResult.device.id !== routerDevice.id) {
    return evaluateRouting(state, nextHopResult.device, destIp, dstResult);
  }

  return { success: true };
}

/**
 * Condition 3: Check trunk carries the VLAN across switches.
 */
function checkTrunkPath(
  state: NetworkState,
  srcDevice: Device,
  dstDevice: Device,
  vlan: number
): PingResult {
  // Find path between devices through trunks (BFS)
  const visited = new Set<string>();
  const queue: string[] = [];

  // Find the switch connected to the source host
  const srcSwitch = findConnectedSwitch(state, srcDevice);
  const dstSwitch = findConnectedSwitch(state, dstDevice);

  if (!srcSwitch || !dstSwitch) {
    return { success: true }; // Can't determine path, assume OK
  }

  if (srcSwitch === dstSwitch) {
    return { success: true }; // Same switch, no trunk needed
  }

  // BFS through trunk links
  queue.push(srcSwitch);
  visited.add(srcSwitch);
  const parent: Record<string, string> = {};

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === dstSwitch) {
      // Found path - verify all trunks in path allow the VLAN
      return verifyTrunkVlanPath(state, srcSwitch, dstSwitch, parent, vlan);
    }

    const links = getDeviceLinks(state, current);
    for (const link of links) {
      const other = getOtherEnd(link, current);
      if (visited.has(other.device)) continue;

      const currentDev = findDevice(state, current);
      const otherDev = findDevice(state, other.device);
      if (!currentDev || !otherDev) continue;

      // Check if the link endpoint on current device is a trunk
      const currentEndIface = link.from.device === current ? link.from.interface : link.to.interface;
      const currentIface = findInterface(currentDev, currentEndIface);
      if (currentIface?.mode === 'trunk') {
        visited.add(other.device);
        parent[other.device] = current;
        queue.push(other.device);
      }
    }
  }

  return { success: false, reason: `No trunk path found between switches for VLAN ${vlan}.`, failedCondition: 3 };
}

function verifyTrunkVlanPath(
  state: NetworkState,
  src: string,
  dst: string,
  parent: Record<string, string>,
  vlan: number
): PingResult {
  // Reconstruct path
  const path: string[] = [dst];
  let current = dst;
  while (parent[current]) {
    path.unshift(parent[current]);
    current = parent[current];
  }

  // Check each link in path allows the VLAN on both ends
  for (let i = 0; i < path.length - 1; i++) {
    const fromId = path[i];
    const toId = path[i + 1];
    const fromDev = findDevice(state, fromId)!;
    const toDev = findDevice(state, toId)!;

    // Find the link between them
    const link = state.links.find(l =>
      (l.from.device === fromId && l.to.device === toId) ||
      (l.from.device === toId && l.to.device === fromId)
    );
    if (!link) continue;

    const fromEnd = link.from.device === fromId ? link.from.interface : link.to.interface;
    const toEnd = link.from.device === fromId ? link.to.interface : link.from.interface;

    if (!vlanAllowedOnTrunk(fromDev, fromEnd, vlan)) {
      return {
        success: false,
        reason: `VLAN ${vlan} not allowed on trunk ${fromEnd} of ${fromDev.hostname}.`,
        failedCondition: 3,
      };
    }
    if (!vlanAllowedOnTrunk(toDev, toEnd, vlan)) {
      return {
        success: false,
        reason: `VLAN ${vlan} not allowed on trunk ${toEnd} of ${toDev.hostname}.`,
        failedCondition: 3,
      };
    }
  }

  return { success: true };
}

/**
 * Condition 5: Check firewall policies.
 */
function checkFirewallPath(
  state: NetworkState,
  fromDevice: Device,
  destIp: string
): PingResult {
  // Check if any firewall device is in the path
  const firewalls = state.devices.filter(d => d.type === 'firewall');
  if (firewalls.length === 0) return { success: true };

  // For each firewall, check if it's in the path (connected to the from device or between src/dst)
  for (const fw of firewalls) {
    // Skip if fromDevice IS the firewall (it's routing through itself - already permitted)
    if (fw.id === fromDevice.id) continue;

    // Check if the from device routes through this firewall
    const isInPath = isFirewallInPath(state, fromDevice, fw, destIp);
    if (!isInPath) continue;

    // Check firewall policies
    if (!fw.firewallPolicies || fw.firewallPolicies.length === 0) {
      return {
        success: false,
        reason: `Traffic blocked by firewall ${fw.hostname} - no permit policy.`,
        failedCondition: 5,
      };
    }

    // Find the source IP - trace back to the original source
    const srcIp = findOriginalSourceIp(state, fromDevice, fw);
    if (!srcIp) continue;

    const permitted = fw.firewallPolicies.some(policy => {
      if (policy.action !== 'permit') return false;
      const srcMatch = routeMatches(policy.srcSubnet.split('/')[0],
        prefixLenToMask(parseInt(policy.srcSubnet.split('/')[1] || '0')), srcIp);
      const dstMatch = routeMatches(policy.dstSubnet.split('/')[0],
        prefixLenToMask(parseInt(policy.dstSubnet.split('/')[1] || '0')), destIp);
      return srcMatch && dstMatch;
    });

    if (!permitted) {
      return {
        success: false,
        reason: `Traffic blocked by firewall ${fw.hostname} - no matching permit policy for this traffic.`,
        failedCondition: 5,
      };
    }
  }

  return { success: true };
}

function isFirewallInPath(state: NetworkState, fromDevice: Device, fw: Device, destIp: string): boolean {
  // A firewall is in the path only if fromDevice routes traffic to destIp through it
  const fwIps = fw.interfaces.filter(i => i.ip).map(i => i.ip!);

  // Check if any route on fromDevice for destIp has a next-hop that is the firewall
  for (const route of fromDevice.routing.routes) {
    if (fwIps.includes(route.nextHop) && routeMatches(route.network, route.mask, destIp)) {
      return true;
    }
  }

  // Check if the destination is directly connected to the firewall (dest sits behind it)
  // and fromDevice must go through fw to reach it
  for (const link of state.links) {
    const fwEnd = link.from.device === fw.id ? link.from : (link.to.device === fw.id ? link.to : null);
    if (!fwEnd) continue;
    // Check if destination is on a subnet connected to this firewall interface
    const fwIface = findInterface(fw, fwEnd.interface);
    if (fwIface?.ip && fwIface.mask) {
      if (sameSubnet(fwIface.ip, destIp, fwIface.mask)) {
        // Dest is on this firewall's subnet - is fromDevice connected to fw?
        const fromToFwLink = state.links.some(l =>
          (l.from.device === fromDevice.id && l.to.device === fw.id) ||
          (l.from.device === fw.id && l.to.device === fromDevice.id)
        );
        if (fromToFwLink && fromDevice.id !== fw.id) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Find the original source IP of traffic reaching a firewall through fromDevice.
 * For the tunnel scenario: traffic originates from a host behind fromDevice.
 */
function findOriginalSourceIp(state: NetworkState, fromDevice: Device, fw: Device): string | undefined {
  // If fromDevice is a firewall itself, find hosts connected to its internal interfaces
  if (fromDevice.type === 'firewall' || fromDevice.type === 'router' || fromDevice.type === 'vpc-router') {
    // Look for hosts directly connected to this device
    for (const link of state.links) {
      let hostDevId: string | undefined;
      if (link.from.device === fromDevice.id) {
        const dev = findDevice(state, link.to.device);
        if (dev?.type === 'host' || dev?.type === 'ec2' || dev?.type === 'linux-server' || dev?.type === 'windows-server' || dev?.type === 'docker-host') hostDevId = dev.id;
      }
      if (link.to.device === fromDevice.id) {
        const dev = findDevice(state, link.from.device);
        if (dev?.type === 'host' || dev?.type === 'ec2' || dev?.type === 'linux-server' || dev?.type === 'windows-server' || dev?.type === 'docker-host') hostDevId = dev.id;
      }
      if (hostDevId) {
        const host = findDevice(state, hostDevId);
        if (host) {
          const iface = host.interfaces.find(i => i.ip);
          if (iface) return iface.ip;
        }
      }
    }
  }
  // Fallback: use the fromDevice's own IP
  return fromDevice.interfaces.find(i => i.ip)?.ip || fromDevice.routing.svis[0]?.ip;
}

/**
 * Find the original source device (EC2/host) behind a router.
 */
function findOriginalSourceDevice(state: NetworkState, routerDevice: Device): Device | undefined {
  for (const link of state.links) {
    let devId: string | undefined;
    if (link.from.device === routerDevice.id) {
      const dev = findDevice(state, link.to.device);
      if (dev && (dev.type === 'host' || dev.type === 'ec2' || dev.type === 'linux-server' || dev.type === 'windows-server' || dev.type === 'docker-host')) devId = dev.id;
    }
    if (link.to.device === routerDevice.id) {
      const dev = findDevice(state, link.from.device);
      if (dev && (dev.type === 'host' || dev.type === 'ec2' || dev.type === 'linux-server' || dev.type === 'windows-server' || dev.type === 'docker-host')) devId = dev.id;
    }
    if (devId) return findDevice(state, devId);
  }
  return undefined;
}

function findOriginalSourceDeviceExcluding(state: NetworkState, routerDevice: Device, excludeId: string): Device | undefined {
  for (const link of state.links) {
    let devId: string | undefined;
    if (link.from.device === routerDevice.id) {
      const dev = findDevice(state, link.to.device);
      if (dev && dev.id !== excludeId && (dev.type === 'host' || dev.type === 'ec2' || dev.type === 'linux-server' || dev.type === 'windows-server' || dev.type === 'docker-host')) devId = dev.id;
    }
    if (link.to.device === routerDevice.id) {
      const dev = findDevice(state, link.from.device);
      if (dev && dev.id !== excludeId && (dev.type === 'host' || dev.type === 'ec2' || dev.type === 'linux-server' || dev.type === 'windows-server' || dev.type === 'docker-host')) devId = dev.id;
    }
    if (devId) return findDevice(state, devId);
  }
  return undefined;
}

function findBestRoute(device: Device, destIp: string): { network: string; mask: string; nextHop: string } | undefined {
  let bestRoute: { network: string; mask: string; nextHop: string } | undefined;
  let bestPrefix = -1;

  for (const route of device.routing.routes) {
    if (routeMatches(route.network, route.mask, destIp)) {
      // Longer prefix = more specific = better
      const prefix = countBits(route.mask);
      if (prefix > bestPrefix) {
        bestPrefix = prefix;
        bestRoute = route;
      }
    }
  }

  return bestRoute;
}

function countBits(mask: string): number {
  const num = ipToNum(mask);
  let count = 0;
  let n = num;
  while (n) {
    count += n & 1;
    n >>>= 1;
  }
  return count;
}

function ipToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function prefixLenToMask(prefix: number): string {
  if (prefix === 0) return '0.0.0.0';
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return [
    (mask >>> 24) & 0xff,
    (mask >>> 16) & 0xff,
    (mask >>> 8) & 0xff,
    mask & 0xff,
  ].join('.');
}

function findConnectedSwitch(state: NetworkState, hostDevice: Device): string | undefined {
  for (const link of state.links) {
    if (link.from.device === hostDevice.id) {
      const dev = findDevice(state, link.to.device);
      if (dev && (dev.type === 'switch' || dev.type === 'router')) return dev.id;
    }
    if (link.to.device === hostDevice.id) {
      const dev = findDevice(state, link.from.device);
      if (dev && (dev.type === 'switch' || dev.type === 'router')) return dev.id;
    }
  }
  return undefined;
}

function findGatewayDevice(state: NetworkState, ip: string): { device: Device; svi: { vlan: number; ip: string; mask: string; status: 'up' | 'down' } } | undefined {
  for (const device of state.devices) {
    for (const svi of device.routing.svis) {
      if (svi.ip === ip) {
        return { device, svi };
      }
    }
    for (const iface of device.interfaces) {
      if (iface.ip === ip) {
        return { device, svi: { vlan: 0, ip: iface.ip, mask: iface.mask || '255.255.255.0', status: iface.status } };
      }
    }
  }
  return undefined;
}

/**
 * Check if a host is directly connected to a router or firewall (not via a switch access port).
 */
function isDirectlyConnectedToRouter(state: NetworkState, hostDevice: Device, hostIface: NetworkInterface): boolean {
  const link = state.links.find(l =>
    (l.from.device === hostDevice.id && l.from.interface === hostIface.name) ||
    (l.to.device === hostDevice.id && l.to.interface === hostIface.name)
  );
  if (!link) return false;

  const otherEnd = link.from.device === hostDevice.id ? link.to : link.from;
  const otherDevice = findDevice(state, otherEnd.device);
  if (!otherDevice) return false;

  // If connected to a router, firewall, vpc-router, or ec2 with IP, it's a direct L3 connection
  if (otherDevice.type === 'router' || otherDevice.type === 'firewall' || otherDevice.type === 'vpc-router') {
    return true;
  }

  // EC2/server instances are directly connected at L3
  if (otherDevice.type === 'ec2' || otherDevice.type === 'linux-server' || otherDevice.type === 'windows-server' || otherDevice.type === 'docker-host') {
    return true;
  }

  // If connected to a switch port that has an IP (acting as L3), also OK
  const otherIface = findInterface(otherDevice, otherEnd.interface);
  if (otherIface && otherIface.ip) {
    return true;
  }

  return false;
}

/**
 * Condition 6: Check AWS Security Groups and NACLs.
 * For EC2/AWS devices, verify that security groups allow the traffic
 * and NACLs permit it in both directions.
 */
function checkAWSConditions(state: NetworkState, srcDevice: Device, dstDevice: Device, destIp: string): PingResult {
  // Check destination device's security group (inbound)
  if (dstDevice.aws?.securityGroups) {
    const srcIp = srcDevice.interfaces.find(i => i.ip)?.ip;
    if (!srcIp) return { success: true }; // can't check without source IP

    const allowed = dstDevice.aws.securityGroups.some(sg =>
      sg.inboundRules.some(rule => {
        if (rule.protocol !== 'icmp' && rule.protocol !== 'all') return false;
        return cidrContains(rule.source, srcIp);
      })
    );

    if (!allowed) {
      const sgNames = dstDevice.aws.securityGroups.map(sg => sg.name || sg.id).join(', ');
      return {
        success: false,
        reason: `Blocked by security group (${sgNames}) on ${dstDevice.hostname} \u2014 no inbound rule allows ICMP from ${srcIp}.`,
        failedCondition: 6,
      };
    }
  }

  // Check source device's security group (outbound)
  if (srcDevice.aws?.securityGroups) {
    const allowed = srcDevice.aws.securityGroups.some(sg =>
      sg.outboundRules.some(rule => {
        if (rule.protocol !== 'icmp' && rule.protocol !== 'all') return false;
        return cidrContains(rule.source, destIp);
      })
    );

    if (!allowed) {
      const sgNames = srcDevice.aws.securityGroups.map(sg => sg.name || sg.id).join(', ');
      return {
        success: false,
        reason: `Blocked by security group (${sgNames}) on ${srcDevice.hostname} \u2014 no outbound rule allows ICMP to ${destIp}.`,
        failedCondition: 6,
      };
    }
  }

  // Check NACLs (stateless - check both directions)
  if (dstDevice.aws?.nacls) {
    const srcIp = srcDevice.interfaces.find(i => i.ip)?.ip;
    if (srcIp) {
      const inboundResult = evaluateNACL(dstDevice.aws.nacls, 'inbound', srcIp);
      if (!inboundResult) {
        return {
          success: false,
          reason: `Blocked by NACL on ${dstDevice.hostname} subnet \u2014 inbound ICMP from ${srcIp} denied.`,
          failedCondition: 6,
        };
      }
    }
  }

  if (srcDevice.aws?.nacls) {
    const outboundResult = evaluateNACL(srcDevice.aws.nacls, 'outbound', destIp);
    if (!outboundResult) {
      return {
        success: false,
        reason: `Blocked by NACL on ${srcDevice.hostname} subnet \u2014 outbound ICMP to ${destIp} denied.`,
        failedCondition: 6,
      };
    }
  }

  // Check VPC route tables
  if (srcDevice.aws?.routeTables) {
    const hasRoute = srcDevice.aws.routeTables.some(rt =>
      rt.routes.some(r => r.status === 'active' && cidrContains(r.destination, destIp))
    );
    if (!hasRoute) {
      return {
        success: false,
        reason: `No route to ${destIp} in route table for ${srcDevice.hostname}.`,
        failedCondition: 6,
      };
    }
    // Check for blackhole routes
    const blackhole = srcDevice.aws.routeTables.some(rt =>
      rt.routes.some(r => r.status === 'blackhole' && cidrContains(r.destination, destIp))
    );
    if (blackhole) {
      return {
        success: false,
        reason: `Route to ${destIp} is blackholed in route table for ${srcDevice.hostname}.`,
        failedCondition: 6,
      };
    }
  }

  return { success: true };
}

function evaluateNACL(nacls: import('./types.js').NACL[], direction: 'inbound' | 'outbound', ip: string): boolean {
  for (const nacl of nacls) {
    const rules = direction === 'inbound' ? nacl.inboundRules : nacl.outboundRules;
    // NACL rules are evaluated in order by rule number
    const sorted = [...rules].sort((a, b) => a.ruleNumber - b.ruleNumber);
    for (const rule of sorted) {
      if (rule.protocol !== 'icmp' && rule.protocol !== 'all') continue;
      if (cidrContains(rule.cidr, ip)) {
        return rule.action === 'allow';
      }
    }
  }
  // Default deny
  return false;
}

function cidrContains(cidr: string, ip: string): boolean {
  if (cidr === '0.0.0.0/0') return true;
  const [net, prefixStr] = cidr.split('/');
  if (!prefixStr) return net === ip;
  const prefix = parseInt(prefixStr);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const netNum = ipToNum(net);
  const ipNum = ipToNum(ip);
  return ((netNum & mask) >>> 0) === ((ipNum & mask) >>> 0);
}


/**
 * Condition 7: Check OS-level networking (iptables, Windows Firewall, services, DNS).
 */
function checkOSConditions(state: NetworkState, srcDevice: Device, dstDevice: Device, destIp: string): PingResult {
  // Check destination's OS firewall (inbound)
  if (dstDevice.os) {
    const inboundCheck = checkOSFirewallInbound(dstDevice, srcDevice, destIp);
    if (!inboundCheck.success) return inboundCheck;

    // Check if the target service is actually running
    const serviceCheck = checkServiceRunning(dstDevice);
    if (!serviceCheck.success) return serviceCheck;
  }

  // Check source's OS firewall (outbound)
  if (srcDevice.os) {
    const outboundCheck = checkOSFirewallOutbound(srcDevice, destIp);
    if (!outboundCheck.success) return outboundCheck;

    // Check DNS resolution if destination is referenced by name
    const dnsCheck = checkDNS(srcDevice, destIp);
    if (!dnsCheck.success) return dnsCheck;
  }

  return { success: true };
}

function checkOSFirewallInbound(device: Device, srcDevice: Device, destIp: string): PingResult {
  const os = device.os!;
  const srcIp = srcDevice.interfaces.find(i => i.ip)?.ip || '0.0.0.0';

  // Linux iptables
  if (os.type === 'linux' && os.iptables) {
    const inputChain = os.iptables.chains.find(c => c.name === 'INPUT');
    if (inputChain) {
      // Check rules in order
      for (const rule of inputChain.rules.sort((a, b) => a.num - b.num)) {
        if (ruleMatchesTraffic(rule, srcIp, destIp, 'icmp')) {
          if (rule.action === 'DROP' || rule.action === 'REJECT') {
            return {
              success: false,
              reason: `Blocked by iptables on ${device.hostname}: INPUT rule ${rule.num} ${rule.action}s ${rule.protocol} from ${rule.source}.`,
              failedCondition: 7,
            };
          }
          if (rule.action === 'ACCEPT') return { success: true };
        }
      }
      // No rule matched — use chain policy
      if (inputChain.policy === 'DROP') {
        return {
          success: false,
          reason: `Blocked by iptables on ${device.hostname}: INPUT chain policy is DROP and no rule allows ICMP from ${srcIp}.`,
          failedCondition: 7,
        };
      }
    }
  }

  // Windows Firewall
  if (os.type === 'windows' && os.windowsFirewall) {
    const wf = os.windowsFirewall;
    // Check if firewall is enabled
    const activeProfile = wf.profiles.find(p => p.enabled);
    if (activeProfile && activeProfile.defaultInbound === 'Block') {
      // Check for an allow rule
      const allowed = wf.rules.some(r =>
        r.enabled &&
        r.direction === 'Inbound' &&
        r.action === 'Allow' &&
        (r.protocol === 'ICMPv4' || r.protocol === 'Any') &&
        (r.remoteAddress === 'Any' || r.remoteAddress === '*' || cidrContains(r.remoteAddress || '0.0.0.0/0', srcIp))
      );
      if (!allowed) {
        return {
          success: false,
          reason: `Blocked by Windows Firewall on ${device.hostname}: no inbound rule allows ICMPv4. Default action: Block.`,
          failedCondition: 7,
        };
      }
    }
  }

  return { success: true };
}

function checkOSFirewallOutbound(device: Device, destIp: string): PingResult {
  const os = device.os!;

  // Linux iptables OUTPUT chain
  if (os.type === 'linux' && os.iptables) {
    const outputChain = os.iptables.chains.find(c => c.name === 'OUTPUT');
    if (outputChain) {
      for (const rule of outputChain.rules.sort((a, b) => a.num - b.num)) {
        if (ruleMatchesTraffic(rule, device.interfaces[0]?.ip || '0.0.0.0', destIp, 'icmp')) {
          if (rule.action === 'DROP' || rule.action === 'REJECT') {
            return {
              success: false,
              reason: `Blocked by iptables on ${device.hostname}: OUTPUT rule ${rule.num} ${rule.action}s traffic to ${destIp}.`,
              failedCondition: 7,
            };
          }
          if (rule.action === 'ACCEPT') return { success: true };
        }
      }
      if (outputChain.policy === 'DROP') {
        return {
          success: false,
          reason: `Blocked by iptables on ${device.hostname}: OUTPUT chain policy is DROP.`,
          failedCondition: 7,
        };
      }
    }
  }

  return { success: true };
}

function checkServiceRunning(device: Device): PingResult {
  // For ICMP ping, we don't need a specific service running
  // But if the device has services configured and none are running, it might indicate the network stack is down
  // This check is mainly used for port-based connectivity scenarios
  return { success: true };
}

function checkDNS(device: Device, destIp: string): PingResult {
  // DNS check only applies if destination is a hostname (not IP)
  // Since our win conditions use IPs, this passes by default
  // But can be used in scenarios where DNS resolution is the fault
  const os = device.os!;
  if (os.dns && os.dns.nameservers.length === 0) {
    // No nameservers configured — only matters if trying to resolve a name
    // For IP-based ping, DNS is not needed
  }
  return { success: true };
}

function ruleMatchesTraffic(rule: import('./types.js').IptablesRule, srcIp: string, destIp: string, protocol: string): boolean {
  // Check protocol
  if (rule.protocol !== 'all' && rule.protocol !== protocol) return false;
  // Check source
  if (rule.source !== '0.0.0.0/0' && !cidrContains(rule.source, srcIp)) return false;
  // Check destination
  if (rule.destination !== '0.0.0.0/0' && !cidrContains(rule.destination, destIp)) return false;
  // State-tracking rules only match established connections, not new pings
  if (rule.state && rule.state.includes('ESTABLISHED')) return false;
  return true;
}
