import { NetworkState, Device, NetworkInterface, Link } from './types.js';

/**
 * Parse an IP address string into a 32-bit number.
 */
export function ipToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Convert a 32-bit number back to dotted-quad string.
 */
export function numToIp(num: number): string {
  return [
    (num >>> 24) & 0xff,
    (num >>> 16) & 0xff,
    (num >>> 8) & 0xff,
    num & 0xff,
  ].join('.');
}

/**
 * Get the network address from an IP and mask.
 */
export function getNetwork(ip: string, mask: string): string {
  return numToIp((ipToNum(ip) & ipToNum(mask)) >>> 0);
}

/**
 * Check if two IPs are in the same subnet given a mask.
 */
export function sameSubnet(ip1: string, ip2: string, mask: string): boolean {
  const maskNum = ipToNum(mask);
  return ((ipToNum(ip1) & maskNum) >>> 0) === ((ipToNum(ip2) & maskNum) >>> 0);
}

/**
 * Convert a CIDR prefix length to dotted-quad mask.
 */
export function prefixToMask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return numToIp(mask);
}

/**
 * Find a device by ID in the network state.
 */
export function findDevice(state: NetworkState, deviceId: string): Device | undefined {
  return state.devices.find(d => d.id === deviceId);
}

/**
 * Find an interface on a device by name (case-insensitive).
 */
export function findInterface(device: Device, ifName: string): NetworkInterface | undefined {
  return device.interfaces.find(
    i => i.name.toLowerCase() === ifName.toLowerCase()
  );
}

/**
 * Find which device owns a given IP address.
 */
export function findDeviceByIp(state: NetworkState, ip: string): { device: Device; iface: NetworkInterface } | undefined {
  for (const device of state.devices) {
    for (const iface of device.interfaces) {
      if (iface.ip === ip && iface.status === 'up') {
        return { device, iface };
      }
    }
    // Check SVIs
    for (const svi of device.routing.svis) {
      if (svi.ip === ip && svi.status === 'up') {
        // Return a synthetic interface
        return {
          device,
          iface: {
            name: `Vlan${svi.vlan}`,
            ip: svi.ip,
            mask: svi.mask,
            status: svi.status,
          }
        };
      }
    }
  }
  return undefined;
}

/**
 * Get the VLAN for a host interface based on the connected switch port.
 */
export function getHostVlan(state: NetworkState, hostDevice: Device, hostIface: NetworkInterface): number | undefined {
  // Find the link connecting this host interface to a switch
  const link = state.links.find(l =>
    (l.from.device === hostDevice.id && l.from.interface === hostIface.name) ||
    (l.to.device === hostDevice.id && l.to.interface === hostIface.name)
  );
  if (!link) return undefined;

  // Get the other end (the switch port)
  const switchEnd = link.from.device === hostDevice.id ? link.to : link.from;
  const switchDevice = findDevice(state, switchEnd.device);
  if (!switchDevice) return undefined;

  const switchPort = findInterface(switchDevice, switchEnd.interface);
  if (!switchPort) return undefined;

  if (switchPort.mode === 'access') {
    return switchPort.accessVlan;
  }
  return undefined;
}

/**
 * Find all links connected to a device.
 */
export function getDeviceLinks(state: NetworkState, deviceId: string): Link[] {
  return state.links.filter(l => l.from.device === deviceId || l.to.device === deviceId);
}

/**
 * Get the other end of a link from a device's perspective.
 */
export function getOtherEnd(link: Link, deviceId: string): { device: string; interface: string } {
  if (link.from.device === deviceId) return link.to;
  return link.from;
}

/**
 * Check if a VLAN can traverse a trunk link (is in the allowed list).
 */
export function vlanAllowedOnTrunk(device: Device, ifName: string, vlan: number): boolean {
  const iface = findInterface(device, ifName);
  if (!iface) return false;
  if (iface.mode !== 'trunk') return false;
  if (!iface.trunkAllowedVlans) return true; // no restriction = all allowed
  return iface.trunkAllowedVlans.includes(vlan);
}

/**
 * Check if a subnet matches a route entry.
 */
export function routeMatches(routeNetwork: string, routeMask: string, destIp: string): boolean {
  const routeNet = ipToNum(routeNetwork) & ipToNum(routeMask);
  const destNet = ipToNum(destIp) & ipToNum(routeMask);
  return (routeNet >>> 0) === (destNet >>> 0);
}

/**
 * Deep clone an object (simple JSON approach for our data model).
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
