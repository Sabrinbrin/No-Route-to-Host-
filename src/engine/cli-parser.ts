import {
  NetworkState,
  Device,
  NetworkInterface,
  CommandContext,
  CommandResult,
  CommandMode,
} from './types.js';
import { findDevice, findInterface } from './utils.js';
import { evaluatePing } from './reachability.js';

/**
 * Execute a CLI command on a device within the network state.
 * Returns the output text and whether state was changed.
 */
export function executeCommand(
  state: NetworkState,
  deviceId: string,
  command: string,
  context: CommandContext
): CommandResult {
  const device = findDevice(state, deviceId);
  if (!device) {
    return { output: `% Device '${deviceId}' not found.`, stateChanged: false };
  }

  const cmd = command.trim();
  if (!cmd) {
    return { output: '', stateChanged: false };
  }

  const parts = cmd.split(/\s+/);
  const keyword = parts[0].toLowerCase();

  // Mode-specific parsing
  switch (context.mode) {
    case 'exec':
      return execModeCommand(state, device, parts, keyword, context);
    case 'config':
      return configModeCommand(state, device, parts, keyword, context);
    case 'config-if':
      return configIfModeCommand(state, device, parts, keyword, context);
  }
}

/**
 * IOS-style command abbreviation matching.
 * Returns true if `input` is a valid abbreviation of `full`.
 */
function abbr(input: string, full: string): boolean {
  const i = input.toLowerCase();
  const f = full.toLowerCase();
  return f.startsWith(i) && i.length > 0;
}


// ===== EXEC MODE COMMANDS =====

function execModeCommand(
  state: NetworkState,
  device: Device,
  parts: string[],
  keyword: string,
  context: CommandContext
): CommandResult {
  if (abbr(keyword, 'show')) {
    return handleShow(state, device, parts.slice(1));
  }
  if (abbr(keyword, 'ping')) {
    return handlePing(state, device, parts[1]);
  }
  if (abbr(keyword, 'configure')) {
    const arg = parts[1]?.toLowerCase() || '';
    if (!arg || abbr(arg, 'terminal')) {
      context.mode = 'config';
      return { output: `${device.hostname}(config)#`, stateChanged: false };
    }
    return { output: '% Invalid input. Use: configure terminal', stateChanged: false };
  }
  if (keyword === 'enable' || keyword === 'en') {
    // Already in exec/enable mode, just acknowledge
    return { output: `${device.hostname}#`, stateChanged: false };
  }
  if (keyword === 'aws') {
    return handleAWSCommand(state, device, parts.slice(1));
  }
  if (keyword === 'connect') {
    return { output: '% Use the device selector to change devices.', stateChanged: false };
  }
  return unknownCommand(context.mode);
}


// ===== CONFIG MODE COMMANDS =====

function configModeCommand(
  state: NetworkState,
  device: Device,
  parts: string[],
  keyword: string,
  context: CommandContext
): CommandResult {
  if (abbr(keyword, 'interface')) {
    const ifName = parts.slice(1).join(' ');
    const iface = findInterface(device, ifName);
    if (!iface) {
      // Maybe it's an SVI - create it
      if (ifName.toLowerCase().startsWith('vlan')) {
        context.mode = 'config-if';
        context.currentInterface = ifName;
        return { output: `${device.hostname}(config-if)#`, stateChanged: false };
      }
      return { output: `% Interface '${ifName}' not found.`, stateChanged: false };
    }
    context.mode = 'config-if';
    context.currentInterface = iface.name;
    return { output: `${device.hostname}(config-if)#`, stateChanged: false };
  }
  if (keyword === 'ip') {
    const sub = parts[1]?.toLowerCase() || '';
    if (abbr(sub, 'routing')) {
      device.routing.enabled = true;
      return { output: '% IP routing enabled.', stateChanged: true };
    }
    if (abbr(sub, 'route')) {
      return handleIpRoute(device, parts.slice(2));
    }
    return { output: '% Invalid ip command. Use: ip routing | ip route <net> <mask> <nh>', stateChanged: false };
  }
  if (keyword === 'no') {
    if (abbr(parts[1]?.toLowerCase() || '', 'ip') && abbr(parts[2]?.toLowerCase() || '', 'routing')) {
      device.routing.enabled = false;
      return { output: '% IP routing disabled.', stateChanged: true };
    }
    if (abbr(parts[1]?.toLowerCase() || '', 'shutdown')) {
      // "no shut" in config mode without interface selected — ignore gracefully
      return { output: '% Select an interface first.', stateChanged: false };
    }
    return { output: '% Invalid no command.', stateChanged: false };
  }
  if (keyword === 'set') {
    if (abbr(parts[1]?.toLowerCase() || '', 'firewall') && abbr(parts[2]?.toLowerCase() || '', 'policy')) {
      return handleSetFirewallPolicy(device, parts.slice(3));
    }
    return { output: '% Invalid set command.', stateChanged: false };
  }
  if (keyword === 'end') {
    context.mode = 'exec';
    context.currentInterface = undefined;
    return { output: `${device.hostname}#`, stateChanged: false };
  }
  if (abbr(keyword, 'exit')) {
    context.mode = 'exec';
    context.currentInterface = undefined;
    return { output: `${device.hostname}#`, stateChanged: false };
  }
  return unknownCommand(context.mode);
}


// ===== CONFIG-IF MODE COMMANDS =====

function configIfModeCommand(
  state: NetworkState,
  device: Device,
  parts: string[],
  keyword: string,
  context: CommandContext
): CommandResult {
  const ifName = context.currentInterface;
  if (!ifName) {
    context.mode = 'config';
    return { output: '% No interface selected.', stateChanged: false };
  }

  const iface = findInterface(device, ifName);

  if (abbr(keyword, 'switchport')) {
    if (!iface) return { output: `% Interface ${ifName} not found.`, stateChanged: false };
    return handleSwitchport(iface, parts.slice(1));
  }
  if (keyword === 'ip') {
    if (abbr(parts[1]?.toLowerCase() || '', 'address')) {
      if (!iface) return { output: `% Interface ${ifName} not found.`, stateChanged: false };
      const ip = parts[2];
      const mask = parts[3];
      if (!ip || !mask) return { output: '% Usage: ip address <ip> <mask>', stateChanged: false };
      iface.ip = ip;
      iface.mask = mask;
      return { output: `% IP address set to ${ip} ${mask}`, stateChanged: true };
    }
    return { output: '% Invalid ip command in interface mode.', stateChanged: false };
  }
  if (keyword === 'no') {
    if (abbr(parts[1]?.toLowerCase() || '', 'shutdown')) {
      if (!iface && ifName.toLowerCase().startsWith('vlan')) {
        const vlanNum = parseInt(ifName.replace(/[^0-9]/g, ''));
        const svi = device.routing.svis.find(s => s.vlan === vlanNum);
        if (svi) {
          svi.status = 'up';
          return { output: `% Interface ${ifName} enabled.`, stateChanged: true };
        }
        return { output: `% SVI VLAN ${vlanNum} not found.`, stateChanged: false };
      }
      if (!iface) return { output: `% Interface ${ifName} not found.`, stateChanged: false };
      iface.status = 'up';
      return { output: `% Interface ${ifName} enabled.`, stateChanged: true };
    }
    return { output: '% Invalid no command.', stateChanged: false };
  }
  if (abbr(keyword, 'shutdown')) {
    if (!iface && ifName.toLowerCase().startsWith('vlan')) {
      const vlanNum = parseInt(ifName.replace(/[^0-9]/g, ''));
      const svi = device.routing.svis.find(s => s.vlan === vlanNum);
      if (svi) {
        svi.status = 'down';
        return { output: `% Interface ${ifName} disabled.`, stateChanged: true };
      }
    }
    if (!iface) return { output: `% Interface ${ifName} not found.`, stateChanged: false };
    iface.status = 'down';
    return { output: `% Interface ${ifName} disabled.`, stateChanged: true };
  }
  if (keyword === 'end') {
    context.mode = 'exec';
    context.currentInterface = undefined;
    return { output: `${device.hostname}#`, stateChanged: false };
  }
  if (abbr(keyword, 'exit')) {
    context.mode = 'config';
    context.currentInterface = undefined;
    return { output: `${device.hostname}(config)#`, stateChanged: false };
  }
  return unknownCommand(context.mode);
}


// ===== SHOW COMMANDS =====

function handleShow(state: NetworkState, device: Device, args: string[]): CommandResult {
  const sub = args[0]?.toLowerCase() || '';

  if (abbr(sub, 'interfaces')) {
    return { output: formatInterfaces(device), stateChanged: false };
  }
  if (abbr(sub, 'ip')) {
    const sub2 = args[1]?.toLowerCase() || '';
    if (abbr(sub2, 'route')) {
      return { output: formatRoutes(device), stateChanged: false };
    }
    if (abbr(sub2, 'interface') || abbr(sub2, 'int')) {
      const sub3 = args[2]?.toLowerCase() || '';
      if (!sub3 || abbr(sub3, 'brief')) {
        return { output: formatIntBrief(device), stateChanged: false };
      }
    }
    return { output: '% Usage: show ip route | show ip int brief', stateChanged: false };
  }
  if (abbr(sub, 'vlan')) {
    return { output: formatVlanBrief(device), stateChanged: false };
  }
  if (abbr(sub, 'running-config') || sub === 'run') {
    return { output: formatRunningConfig(device), stateChanged: false };
  }
  if (abbr(sub, 'firewall')) {
    return { output: formatFirewallPolicies(device), stateChanged: false };
  }
  if (!sub) {
    return {
      output: `% Available show commands:\n  show interfaces\n  show ip route\n  show ip int brief\n  show vlan brief\n  show running-config\n  show firewall`,
      stateChanged: false,
    };
  }
  return {
    output: `% Available show commands:\n  show interfaces\n  show ip route\n  show ip int brief\n  show vlan brief\n  show running-config\n  show firewall`,
    stateChanged: false,
  };
}


// ===== FORMAT FUNCTIONS =====

function formatInterfaces(device: Device): string {
  let output = `Interface          Status  Protocol  IP Address       VLAN  Mode\n`;
  output += `${'─'.repeat(75)}\n`;
  for (const iface of device.interfaces) {
    const status = iface.status === 'up' ? 'up' : 'down';
    const ip = iface.ip ? `${iface.ip}/${iface.mask || ''}` : 'unassigned';
    const vlan = iface.accessVlan?.toString() || (iface.trunkAllowedVlans ? 'trunk' : '-');
    const mode = iface.mode || '-';
    output += `${iface.name.padEnd(18)} ${status.padEnd(7)} ${status.padEnd(9)} ${ip.padEnd(16)} ${vlan.padEnd(5)} ${mode}\n`;
  }
  // SVIs
  for (const svi of device.routing.svis) {
    const name = `Vlan${svi.vlan}`;
    const status = svi.status;
    const ip = `${svi.ip}/${svi.mask}`;
    output += `${name.padEnd(18)} ${status.padEnd(7)} ${status.padEnd(9)} ${ip.padEnd(16)} ${svi.vlan.toString().padEnd(5)} SVI\n`;
  }
  return output;
}

function formatRoutes(device: Device): string {
  let output = `Routing table for ${device.hostname}:\n`;
  output += `Codes: C - connected, S - static\n\n`;

  if (!device.routing.enabled && device.type === 'switch') {
    output += `% IP routing is disabled.\n`;
    return output;
  }

  // Connected routes from interfaces
  for (const iface of device.interfaces) {
    if (iface.ip && iface.mask && iface.status === 'up') {
      const net = getNetworkAddr(iface.ip, iface.mask);
      output += `C    ${net}/${maskToCidr(iface.mask)} is directly connected, ${iface.name}\n`;
    }
  }
  // Connected routes from SVIs
  for (const svi of device.routing.svis) {
    if (svi.status === 'up') {
      const net = getNetworkAddr(svi.ip, svi.mask);
      output += `C    ${net}/${maskToCidr(svi.mask)} is directly connected, Vlan${svi.vlan}\n`;
    }
  }
  // Static routes
  for (const route of device.routing.routes) {
    output += `S    ${route.network}/${maskToCidr(route.mask)} via ${route.nextHop}\n`;
  }

  if (device.routing.routes.length === 0 && device.interfaces.filter(i => i.ip).length === 0 && device.routing.svis.length === 0) {
    output += `% No routes configured.\n`;
  }
  return output;
}

function formatIntBrief(device: Device): string {
  let output = `Interface          IP-Address      Status    Method\n`;
  output += `${'─'.repeat(60)}\n`;
  for (const iface of device.interfaces) {
    const ip = iface.ip || 'unassigned';
    output += `${iface.name.padEnd(18)} ${ip.padEnd(15)} ${iface.status.padEnd(9)} manual\n`;
  }
  for (const svi of device.routing.svis) {
    output += `${'Vlan' + svi.vlan}`.padEnd(18) + ` ${svi.ip.padEnd(15)} ${svi.status.padEnd(9)} manual\n`;
  }
  return output;
}

function formatVlanBrief(device: Device): string {
  // Collect VLANs from access ports
  const vlans: Record<number, string[]> = {};
  for (const iface of device.interfaces) {
    if (iface.mode === 'access' && iface.accessVlan) {
      if (!vlans[iface.accessVlan]) vlans[iface.accessVlan] = [];
      vlans[iface.accessVlan].push(iface.name);
    }
  }

  let output = `VLAN  Name       Status  Ports\n`;
  output += `${'─'.repeat(55)}\n`;
  for (const [vlan, ports] of Object.entries(vlans).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    output += `${vlan.padEnd(5)} VLAN${vlan.padEnd(5)}    active  ${ports.join(', ')}\n`;
  }
  if (Object.keys(vlans).length === 0) {
    output += `% No VLANs configured.\n`;
  }
  return output;
}


function formatRunningConfig(device: Device): string {
  let output = `!\n! Running configuration for ${device.hostname}\n!\nhostname ${device.hostname}\n!\n`;

  if (device.routing.enabled) {
    output += `ip routing\n!\n`;
  }

  for (const iface of device.interfaces) {
    output += `interface ${iface.name}\n`;
    if (iface.ip) output += `  ip address ${iface.ip} ${iface.mask}\n`;
    if (iface.mode === 'access') output += `  switchport mode access\n  switchport access vlan ${iface.accessVlan || 1}\n`;
    if (iface.mode === 'trunk') {
      output += `  switchport mode trunk\n`;
      if (iface.trunkAllowedVlans) {
        output += `  switchport trunk allowed vlan ${iface.trunkAllowedVlans.join(',')}\n`;
      }
    }
    if (iface.status === 'down') output += `  shutdown\n`;
    output += `!\n`;
  }

  for (const svi of device.routing.svis) {
    output += `interface Vlan${svi.vlan}\n`;
    output += `  ip address ${svi.ip} ${svi.mask}\n`;
    if (svi.status === 'down') output += `  shutdown\n`;
    output += `!\n`;
  }

  for (const route of device.routing.routes) {
    output += `ip route ${route.network} ${route.mask} ${route.nextHop}\n`;
  }

  if (device.firewallPolicies && device.firewallPolicies.length > 0) {
    output += `!\n! Firewall Policies\n`;
    for (const policy of device.firewallPolicies) {
      output += `policy ${policy.id} src ${policy.srcSubnet} dst ${policy.dstSubnet} action ${policy.action}`;
      if (policy.interface) output += ` interface ${policy.interface}`;
      output += `\n`;
    }
  }

  output += `!\nend\n`;
  return output;
}

function formatFirewallPolicies(device: Device): string {
  if (!device.firewallPolicies || device.firewallPolicies.length === 0) {
    return '% No firewall policies configured.';
  }
  let output = `ID   Source           Destination      Action  Interface\n`;
  output += `${'─'.repeat(65)}\n`;
  for (const p of device.firewallPolicies) {
    output += `${p.id.toString().padEnd(4)} ${p.srcSubnet.padEnd(16)} ${p.dstSubnet.padEnd(16)} ${p.action.padEnd(7)} ${p.interface || '-'}\n`;
  }
  return output;
}


// ===== PING HANDLER =====

function handlePing(state: NetworkState, device: Device, target: string | undefined): CommandResult {
  if (!target) {
    return { output: '% Usage: ping <ip-address>', stateChanged: false };
  }
  const result = evaluatePing(state, device.id, target);
  if (result.success) {
    return {
      output: `Sending 5 100-byte ICMP Echos to ${target}:\n!!!!!!\nSuccess rate is 100 percent (5/5)`,
      stateChanged: false,
    };
  } else {
    return {
      output: `Sending 5 100-byte ICMP Echos to ${target}:\n.....\nSuccess rate is 0 percent (0/5)\n% ${result.reason}`,
      stateChanged: false,
    };
  }
}

// ===== SWITCHPORT HANDLER =====

function handleSwitchport(iface: NetworkInterface, args: string[]): CommandResult {
  const sub = args[0]?.toLowerCase() || '';
  if (abbr(sub, 'access')) {
    if (abbr(args[1]?.toLowerCase() || '', 'vlan')) {
      const vlanId = parseInt(args[2]);
      if (isNaN(vlanId) || vlanId < 1 || vlanId > 4094) {
        return { output: '% Invalid VLAN ID. Use 1-4094.', stateChanged: false };
      }
      iface.mode = 'access';
      iface.accessVlan = vlanId;
      return { output: `% Access VLAN set to ${vlanId}.`, stateChanged: true };
    }
    return { output: '% Usage: switchport access vlan <id>', stateChanged: false };
  }
  if (abbr(sub, 'mode')) {
    const mode = args[1]?.toLowerCase() || '';
    if (abbr(mode, 'access')) {
      iface.mode = 'access';
      return { output: '% Port mode set to access.', stateChanged: true };
    }
    if (abbr(mode, 'trunk')) {
      iface.mode = 'trunk';
      return { output: '% Port mode set to trunk.', stateChanged: true };
    }
    return { output: '% Usage: switchport mode access|trunk', stateChanged: false };
  }
  if (abbr(sub, 'trunk')) {
    if (abbr(args[1]?.toLowerCase() || '', 'allowed') && abbr(args[2]?.toLowerCase() || '', 'vlan')) {
      const action = args[3]?.toLowerCase() || '';
      if (abbr(action, 'add')) {
        const vlanId = parseInt(args[4]);
        if (isNaN(vlanId)) return { output: '% Invalid VLAN ID.', stateChanged: false };
        if (!iface.trunkAllowedVlans) iface.trunkAllowedVlans = [];
        if (!iface.trunkAllowedVlans.includes(vlanId)) {
          iface.trunkAllowedVlans.push(vlanId);
          iface.trunkAllowedVlans.sort((a, b) => a - b);
        }
        return { output: `% VLAN ${vlanId} added to trunk allowed list.`, stateChanged: true };
      }
      if (abbr(action, 'remove')) {
        const vlanId = parseInt(args[4]);
        if (isNaN(vlanId)) return { output: '% Invalid VLAN ID.', stateChanged: false };
        if (iface.trunkAllowedVlans) {
          iface.trunkAllowedVlans = iface.trunkAllowedVlans.filter(v => v !== vlanId);
        }
        return { output: `% VLAN ${vlanId} removed from trunk allowed list.`, stateChanged: true };
      }
      // Direct set (number as action)
      const vlanId = parseInt(action);
      if (!isNaN(vlanId)) {
        if (!iface.trunkAllowedVlans) iface.trunkAllowedVlans = [];
        if (!iface.trunkAllowedVlans.includes(vlanId)) {
          iface.trunkAllowedVlans.push(vlanId);
          iface.trunkAllowedVlans.sort((a, b) => a - b);
        }
        return { output: `% VLAN ${vlanId} added to trunk allowed list.`, stateChanged: true };
      }
      return { output: '% Usage: switchport trunk allowed vlan add|remove <id>', stateChanged: false };
    }
    return { output: '% Usage: switchport trunk allowed vlan add <id>', stateChanged: false };
  }
  return { output: '% Usage: switchport access vlan <id> | switchport trunk allowed vlan add <id>', stateChanged: false };
}


// ===== IP ROUTE HANDLER =====

function handleIpRoute(device: Device, args: string[]): CommandResult {
  // ip route <network> <mask> <next-hop>
  const network = args[0];
  const mask = args[1];
  const nextHop = args[2];

  if (!network || !mask || !nextHop) {
    return { output: '% Usage: ip route <network> <mask> <next-hop>', stateChanged: false };
  }

  // Check if route already exists
  const existing = device.routing.routes.find(
    r => r.network === network && r.mask === mask && r.nextHop === nextHop
  );
  if (existing) {
    return { output: '% Route already exists.', stateChanged: false };
  }

  device.routing.routes.push({ network, mask, nextHop });
  return { output: `% Static route added: ${network} ${mask} via ${nextHop}`, stateChanged: true };
}

// ===== FIREWALL POLICY HANDLER =====

function handleSetFirewallPolicy(device: Device, args: string[]): CommandResult {
  // set firewall policy <srcSubnet> <dstSubnet> permit [interface <name>]
  const srcSubnet = args[0];
  const dstSubnet = args[1];
  const action = args[2]?.toLowerCase();

  if (!srcSubnet || !dstSubnet || (action !== 'permit' && action !== 'deny')) {
    return { output: '% Usage: set firewall policy <src-subnet> <dst-subnet> permit|deny [interface <name>]', stateChanged: false };
  }

  if (!device.firewallPolicies) device.firewallPolicies = [];

  const nextId = device.firewallPolicies.length > 0
    ? Math.max(...device.firewallPolicies.map(p => p.id)) + 1
    : 1;

  const policy: any = {
    id: nextId,
    srcSubnet,
    dstSubnet,
    action: action as 'permit' | 'deny',
  };

  // Check for optional interface
  if (args[3]?.toLowerCase() === 'interface') {
    policy.interface = args[4];
  }

  device.firewallPolicies.push(policy);
  return { output: `% Firewall policy ${nextId} added: ${srcSubnet} -> ${dstSubnet} ${action}`, stateChanged: true };
}

// ===== HELPERS =====

function unknownCommand(mode: CommandMode): CommandResult {
  const modeStr = mode === 'exec' ? '' : mode === 'config' ? '(config)' : '(config-if)';
  const commands = mode === 'exec'
    ? 'show, ping, configure terminal'
    : mode === 'config'
    ? 'interface, ip routing, ip route, set firewall policy, end, exit'
    : 'switchport, ip address, no shutdown, shutdown, end, exit';
  return {
    output: `% Unknown command. Available commands in ${mode} mode:\n  ${commands}`,
    stateChanged: false,
  };
}

function getNetworkAddr(ip: string, mask: string): string {
  const ipParts = ip.split('.').map(Number);
  const maskParts = mask.split('.').map(Number);
  return ipParts.map((p, i) => p & maskParts[i]).join('.');
}

function maskToCidr(mask: string): number {
  const parts = mask.split('.').map(Number);
  let bits = 0;
  for (const part of parts) {
    let p = part;
    while (p > 0) {
      bits += p & 1;
      p >>= 1;
    }
  }
  return bits;
}


// ===== AWS CLI COMMANDS =====

function handleAWSCommand(state: NetworkState, device: Device, args: string[]): CommandResult {
  const service = args[0]?.toLowerCase();
  const action = args[1]?.toLowerCase();

  if (service !== 'ec2') {
    return { output: '% Supported: aws ec2 <command>', stateChanged: false };
  }

  if (!device.aws) {
    return { output: '% This device has no AWS configuration.', stateChanged: false };
  }

  switch (action) {
    case 'describe-security-groups':
      return { output: formatSecurityGroups(device), stateChanged: false };

    case 'describe-route-tables':
      return { output: formatRouteTables(device), stateChanged: false };

    case 'describe-network-acls':
      return { output: formatNACLs(device), stateChanged: false };

    case 'describe-vpc-peering-connections':
      return { output: formatVPCPeering(device), stateChanged: false };

    case 'authorize-security-group-ingress': {
      // aws ec2 authorize-security-group-ingress --group-id <id> --protocol <p> --cidr <cidr>
      const sgId = extractArg(args, '--group-id');
      const protocol = extractArg(args, '--protocol') || 'all';
      const cidr = extractArg(args, '--cidr') || '0.0.0.0/0';
      const port = extractArg(args, '--port');
      if (!sgId) return { output: '% Usage: aws ec2 authorize-security-group-ingress --group-id <id> --protocol <proto> --cidr <cidr>', stateChanged: false };

      const sg = device.aws.securityGroups?.find(s => s.id === sgId || s.name === sgId);
      if (!sg) return { output: `% Security group '${sgId}' not found.`, stateChanged: false };

      sg.inboundRules.push({
        protocol: protocol as any,
        source: cidr,
        portRange: port || 'all',
      });
      return { output: `% Inbound rule added to ${sg.id}: ${protocol} from ${cidr}`, stateChanged: true };
    }

    case 'authorize-security-group-egress': {
      const sgId = extractArg(args, '--group-id');
      const protocol = extractArg(args, '--protocol') || 'all';
      const cidr = extractArg(args, '--cidr') || '0.0.0.0/0';
      const port = extractArg(args, '--port');
      if (!sgId) return { output: '% Usage: aws ec2 authorize-security-group-egress --group-id <id> --protocol <proto> --cidr <cidr>', stateChanged: false };

      const sg = device.aws.securityGroups?.find(s => s.id === sgId || s.name === sgId);
      if (!sg) return { output: `% Security group '${sgId}' not found.`, stateChanged: false };

      sg.outboundRules.push({
        protocol: protocol as any,
        source: cidr,
        portRange: port || 'all',
      });
      return { output: `% Outbound rule added to ${sg.id}: ${protocol} to ${cidr}`, stateChanged: true };
    }

    case 'create-route': {
      // aws ec2 create-route --route-table-id <id> --destination-cidr <cidr> --target <tgt>
      const rtId = extractArg(args, '--route-table-id');
      const dest = extractArg(args, '--destination-cidr');
      const target = extractArg(args, '--target') || extractArg(args, '--vpc-peering-connection-id') || extractArg(args, '--gateway-id');
      if (!rtId || !dest || !target) return { output: '% Usage: aws ec2 create-route --route-table-id <id> --destination-cidr <cidr> --target <target>', stateChanged: false };

      const rt = device.aws.routeTables?.find(r => r.id === rtId || r.name === rtId);
      if (!rt) return { output: `% Route table '${rtId}' not found.`, stateChanged: false };

      rt.routes.push({ destination: dest, target: target, status: 'active' });
      return { output: `% Route added: ${dest} -> ${target} in ${rt.id}`, stateChanged: true };
    }

    case 'replace-route': {
      const rtId = extractArg(args, '--route-table-id');
      const dest = extractArg(args, '--destination-cidr');
      const target = extractArg(args, '--target') || extractArg(args, '--gateway-id') || extractArg(args, '--nat-gateway-id');
      if (!rtId || !dest || !target) return { output: '% Usage: aws ec2 replace-route --route-table-id <id> --destination-cidr <cidr> --target <target>', stateChanged: false };

      const rt = device.aws.routeTables?.find(r => r.id === rtId || r.name === rtId);
      if (!rt) return { output: `% Route table '${rtId}' not found.`, stateChanged: false };

      const existing = rt.routes.find(r => r.destination === dest);
      if (existing) {
        existing.target = target;
        existing.status = 'active';
      } else {
        rt.routes.push({ destination: dest, target: target, status: 'active' });
      }
      return { output: `% Route replaced: ${dest} -> ${target}`, stateChanged: true };
    }

    case 'create-network-acl-entry': {
      const naclId = extractArg(args, '--network-acl-id');
      const ruleNum = extractArg(args, '--rule-number');
      const protocol = extractArg(args, '--protocol') || 'all';
      const cidr = extractArg(args, '--cidr-block') || '0.0.0.0/0';
      const ruleAction = extractArg(args, '--rule-action') || 'allow';
      const ingress = args.includes('--ingress');
      if (!naclId || !ruleNum) return { output: '% Usage: aws ec2 create-network-acl-entry --network-acl-id <id> --rule-number <n> --protocol <p> --cidr-block <cidr> --rule-action allow|deny --ingress|--egress', stateChanged: false };

      const nacl = device.aws.nacls?.find(n => n.id === naclId || n.name === naclId);
      if (!nacl) return { output: `% NACL '${naclId}' not found.`, stateChanged: false };

      const rule = { ruleNumber: parseInt(ruleNum), protocol: protocol as any, cidr, action: ruleAction as 'allow' | 'deny' };
      if (ingress) nacl.inboundRules.push(rule);
      else nacl.outboundRules.push(rule);
      return { output: `% NACL entry added: rule ${ruleNum} ${ruleAction} ${protocol} ${cidr}`, stateChanged: true };
    }

    default:
      return {
        output: `% Available aws ec2 commands:\n  describe-security-groups\n  describe-route-tables\n  describe-network-acls\n  describe-vpc-peering-connections\n  authorize-security-group-ingress --group-id <id> --protocol <p> --cidr <cidr>\n  authorize-security-group-egress --group-id <id> --protocol <p> --cidr <cidr>\n  create-route --route-table-id <id> --destination-cidr <cidr> --target <tgt>\n  create-network-acl-entry --network-acl-id <id> --rule-number <n> --protocol <p> --cidr-block <cidr> --rule-action allow|deny --ingress|--egress`,
        stateChanged: false,
      };
  }
}

function extractArg(args: string[], flag: string): string | undefined {
  const idx = args.findIndex(a => a.toLowerCase() === flag.toLowerCase());
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function formatSecurityGroups(device: Device): string {
  if (!device.aws?.securityGroups?.length) return '% No security groups.';
  let out = '';
  for (const sg of device.aws.securityGroups) {
    out += `SecurityGroup: ${sg.id} (${sg.name})\n`;
    out += `  Inbound Rules:\n`;
    if (sg.inboundRules.length === 0) out += `    (none)\n`;
    for (const r of sg.inboundRules) {
      out += `    ${r.protocol.padEnd(6)} ${(r.portRange || 'all').padEnd(10)} ${r.source}${r.description ? '  # ' + r.description : ''}\n`;
    }
    out += `  Outbound Rules:\n`;
    if (sg.outboundRules.length === 0) out += `    (none)\n`;
    for (const r of sg.outboundRules) {
      out += `    ${r.protocol.padEnd(6)} ${(r.portRange || 'all').padEnd(10)} ${r.source}\n`;
    }
    out += '\n';
  }
  return out;
}

function formatRouteTables(device: Device): string {
  if (!device.aws?.routeTables?.length) return '% No route tables.';
  let out = '';
  for (const rt of device.aws.routeTables) {
    out += `RouteTable: ${rt.id} (${rt.name})\n`;
    out += `  Destination        Target           Status\n`;
    out += `  ${'─'.repeat(50)}\n`;
    for (const r of rt.routes) {
      out += `  ${r.destination.padEnd(19)} ${r.target.padEnd(16)} ${r.status}\n`;
    }
    out += '\n';
  }
  return out;
}

function formatNACLs(device: Device): string {
  if (!device.aws?.nacls?.length) return '% No NACLs.';
  let out = '';
  for (const nacl of device.aws.nacls) {
    out += `NACL: ${nacl.id} (${nacl.name})\n`;
    out += `  Inbound:\n    Rule#  Proto   CIDR              Action\n`;
    for (const r of nacl.inboundRules.sort((a, b) => a.ruleNumber - b.ruleNumber)) {
      out += `    ${String(r.ruleNumber).padEnd(6)} ${r.protocol.padEnd(7)} ${r.cidr.padEnd(17)} ${r.action}\n`;
    }
    out += `  Outbound:\n    Rule#  Proto   CIDR              Action\n`;
    for (const r of nacl.outboundRules.sort((a, b) => a.ruleNumber - b.ruleNumber)) {
      out += `    ${String(r.ruleNumber).padEnd(6)} ${r.protocol.padEnd(7)} ${r.cidr.padEnd(17)} ${r.action}\n`;
    }
    out += '\n';
  }
  return out;
}

function formatVPCPeering(device: Device): string {
  if (!device.aws?.vpcPeerings?.length) return '% No VPC peering connections.';
  let out = `PeeringID            Name            Local VPC    Peer VPC     Status\n`;
  out += `${'─'.repeat(70)}\n`;
  for (const p of device.aws.vpcPeerings) {
    out += `${p.id.padEnd(20)} ${(p.name||'-').padEnd(15)} ${p.localVpc.padEnd(12)} ${p.peerVpc.padEnd(12)} ${p.status}\n`;
  }
  return out;
}
