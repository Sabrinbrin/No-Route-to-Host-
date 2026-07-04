// ===== Network State Model =====

export interface NetworkState {
  devices: Device[];
  links: Link[];
}

export interface Device {
  id: string;
  hostname: string;
  type: 'switch' | 'router' | 'firewall' | 'host';
  interfaces: NetworkInterface[];
  routing: RoutingConfig;
  firewallPolicies?: FirewallPolicy[];
  natRules?: NatRule[];
}

export interface NetworkInterface {
  name: string;
  ip?: string;
  mask?: string;
  status: 'up' | 'down';
  mode?: 'access' | 'trunk';
  accessVlan?: number;
  trunkAllowedVlans?: number[];
  gateway?: string;
}

export interface RoutingConfig {
  enabled: boolean;
  routes: StaticRoute[];
  svis: SVI[];
}

export interface StaticRoute {
  network: string;
  mask: string;
  nextHop: string;
}

export interface SVI {
  vlan: number;
  ip: string;
  mask: string;
  status: 'up' | 'down';
}

export interface Link {
  id: string;
  from: LinkEndpoint;
  to: LinkEndpoint;
}

export interface LinkEndpoint {
  device: string;
  interface: string;
}

export interface FirewallPolicy {
  id: number;
  srcSubnet: string;
  dstSubnet: string;
  action: 'permit' | 'deny';
  interface?: string;
}

export interface NatRule {
  id: number;
  type: 'source' | 'destination';
  original: string;
  translated: string;
}

// ===== Ping / Reachability =====

export interface PingResult {
  success: boolean;
  reason?: string;
  failedCondition?: number;
}

// ===== CLI =====

export type CommandMode = 'exec' | 'config' | 'config-if';

export interface CommandContext {
  mode: CommandMode;
  currentDevice: string;
  currentInterface?: string;
}

export interface CommandResult {
  output: string;
  stateChanged: boolean;
}

// ===== Scenario =====

export interface Scenario {
  id: string;
  title: string;
  difficulty: number;
  topology: {
    devices: Device[];
    links: Link[];
  };
  injected_fault: InjectedFault;
  ticket: Ticket;
  win_condition: WinCondition;
  reference_solution: SolutionStep[];
  layout?: Record<string, { x: number; y: number }>;
}

export interface InjectedFault {
  device: string;
  interface?: string;
  field: string;
  value: any;
  // For routing/firewall faults that remove entries
  action?: 'set' | 'remove' | 'add';
}

export interface Ticket {
  title: string;
  symptom: string;
  affected_hosts: string[];
}

export interface WinCondition {
  type: 'ping';
  source: string;
  destination: string;
  expected: 'success' | 'failure';
}

export interface SolutionStep {
  device: string;
  commands: string[];
}

// ===== Game State =====

export interface GameState {
  scenario: Scenario;
  network: NetworkState;
  commandCount: number;
  startTime: number;
  resolved: boolean;
  contexts: Record<string, CommandContext>;
}
