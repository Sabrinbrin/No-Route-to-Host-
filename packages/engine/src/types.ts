// ===== Network State Model =====

export interface NetworkState {
  devices: Device[];
  links: Link[];
}

export interface Device {
  id: string;
  hostname: string;
  type: 'switch' | 'router' | 'firewall' | 'host' | 'ec2' | 'vpc-router' | 'linux-server' | 'windows-server' | 'docker-host';
  interfaces: NetworkInterface[];
  routing: RoutingConfig;
  firewallPolicies?: FirewallPolicy[];
  natRules?: NatRule[];
  aws?: AWSConfig;
  os?: OSConfig;
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

// ===== AWS Cloud Networking =====

export interface SecurityGroup {
  id: string;
  name: string;
  inboundRules: SGRule[];
  outboundRules: SGRule[];
}

export interface SGRule {
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  portRange?: string;      // e.g., "80", "443", "22", "0-65535", "all"
  source: string;          // CIDR or sg-id
  description?: string;
}

export interface NACL {
  id: string;
  name: string;
  inboundRules: NACLRule[];
  outboundRules: NACLRule[];
}

export interface NACLRule {
  ruleNumber: number;
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  portRange?: string;
  cidr: string;
  action: 'allow' | 'deny';
}

export interface RouteTable {
  id: string;
  name: string;
  routes: VPCRoute[];
  subnetAssociations: string[];  // subnet IDs
}

export interface VPCRoute {
  destination: string;          // CIDR
  target: string;               // igw-xxx, pcx-xxx, local, nat-xxx, eni-xxx
  status: 'active' | 'blackhole';
}

export interface VPCPeering {
  id: string;
  name: string;
  localVpc: string;
  peerVpc: string;
  status: 'active' | 'pending' | 'failed';
}

export interface AWSConfig {
  securityGroups?: SecurityGroup[];
  nacls?: NACL[];
  routeTables?: RouteTable[];
  vpcPeerings?: VPCPeering[];
  vpc?: string;
  subnet?: string;
  availabilityZone?: string;
}

// ===== OS-Level Networking (Linux / Windows) =====

export interface OSConfig {
  type: 'linux' | 'windows';
  iptables?: IptablesConfig;
  windowsFirewall?: WindowsFirewallConfig;
  dns?: DNSConfig;
  services?: ServiceConfig[];
  hostsFile?: HostsEntry[];
}

export interface IptablesConfig {
  chains: IptablesChain[];
}

export interface IptablesChain {
  name: string;              // INPUT, OUTPUT, FORWARD
  policy: 'ACCEPT' | 'DROP';
  rules: IptablesRule[];
}

export interface IptablesRule {
  num: number;
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  source: string;            // CIDR or 0.0.0.0/0
  destination: string;       // CIDR or 0.0.0.0/0
  dport?: string;            // destination port
  sport?: string;            // source port
  action: 'ACCEPT' | 'DROP' | 'REJECT';
  state?: string;            // ESTABLISHED,RELATED etc.
}

export interface WindowsFirewallConfig {
  profiles: WFProfile[];
  rules: WFRule[];
}

export interface WFProfile {
  name: 'Domain' | 'Private' | 'Public';
  enabled: boolean;
  defaultInbound: 'Allow' | 'Block';
  defaultOutbound: 'Allow' | 'Block';
}

export interface WFRule {
  name: string;
  displayName: string;
  enabled: boolean;
  direction: 'Inbound' | 'Outbound';
  action: 'Allow' | 'Block';
  protocol: 'TCP' | 'UDP' | 'ICMPv4' | 'Any';
  localPort?: string;
  remotePort?: string;
  remoteAddress?: string;
  profile?: string;
}

export interface DNSConfig {
  nameservers: string[];
  searchDomains?: string[];
  resolves: DNSRecord[];     // simulated DNS records
}

export interface DNSRecord {
  name: string;              // hostname to resolve
  type: 'A' | 'CNAME' | 'PTR';
  value: string;             // IP or alias
}

export interface ServiceConfig {
  name: string;
  status: 'running' | 'stopped' | 'failed';
  enabled: boolean;
  port?: number;
  protocol?: 'tcp' | 'udp';
}

export interface HostsEntry {
  ip: string;
  hostname: string;
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
