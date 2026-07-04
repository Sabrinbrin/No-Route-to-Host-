# Design — No Route to Host

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (React)                         │
│  ┌──────────────────┐   ┌──────────────────────────────┐   │
│  │  Terminal (xterm) │   │  Topology Diagram (SVG/React) │   │
│  └────────┬─────────┘   └──────────────┬───────────────┘   │
│           │                             │                    │
│           └──────────┬──────────────────┘                    │
│                      ▼                                       │
│           ┌──────────────────┐                               │
│           │   Game Controller │                               │
│           └────────┬─────────┘                               │
│                    ▼                                          │
│  ┌─────────────────────────────────────┐                     │
│  │       Shared Network Engine          │                     │
│  │  (state model + reachability + CLI)  │                     │
│  └─────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     MCP Server (Node.js)                      │
│  ┌───────────────────────────────────────────────┐           │
│  │  Tools: get_topology, get_ticket, run_command, │           │
│  │         check_win_condition, reset_scenario,   │           │
│  │         load_scenario                          │           │
│  └───────────────────────┬───────────────────────┘           │
│                          ▼                                    │
│  ┌─────────────────────────────────────┐                     │
│  │       Shared Network Engine          │  ← same module     │
│  └─────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Validation Agent (Kiro)                          │
│  Reads scenario → Drives MCP tools → Asserts solvability     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              On-Save Hook (chokidar watcher)                  │
│  Watches scenarios/*.yaml → Spawns validation → Reports       │
└─────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. Shared Network Engine (`packages/engine/`)

The single source of truth. Both the browser game and MCP server import this module.

#### State Model

```typescript
interface NetworkState {
  devices: Device[];
  links: Link[];
}

interface Device {
  id: string;
  hostname: string;
  type: 'switch' | 'router' | 'firewall' | 'host';
  interfaces: Interface[];
  routing: RoutingConfig;
  firewallPolicies?: FirewallPolicy[];  // only for firewall type
  natRules?: NatRule[];                 // only for firewall type
}

interface Interface {
  name: string;           // e.g., "GigabitEthernet0/1", "Vlan10"
  ip?: string;
  mask?: string;
  status: 'up' | 'down';
  mode?: 'access' | 'trunk';
  accessVlan?: number;
  trunkAllowedVlans?: number[];
  gateway?: string;       // for host interfaces
}

interface RoutingConfig {
  enabled: boolean;
  routes: StaticRoute[];
  svis: SVI[];
}

interface StaticRoute {
  network: string;
  mask: string;
  nextHop: string;
}

interface SVI {
  vlan: number;
  ip: string;
  mask: string;
  status: 'up' | 'down';
}

interface Link {
  id: string;
  from: { device: string; interface: string };
  to: { device: string; interface: string };
}

interface FirewallPolicy {
  id: number;
  srcSubnet: string;
  dstSubnet: string;
  action: 'permit' | 'deny';
  interface?: string;     // tunnel interface or zone
}

interface NatRule {
  id: number;
  type: 'source' | 'destination';
  original: string;
  translated: string;
}
```

#### Reachability Evaluator

```typescript
interface PingResult {
  success: boolean;
  reason?: string;         // human-readable failure reason
  failedCondition?: number; // 1-5 condition that failed
}

function evaluatePing(state: NetworkState, src: string, dst: string): PingResult;
```

The evaluator checks conditions 1–5 in order, returning on first failure.

#### CLI Parser

```typescript
interface CommandResult {
  output: string;
  stateChanged: boolean;
}

function executeCommand(
  state: NetworkState,
  deviceId: string,
  command: string,
  context: CommandContext  // tracks current mode (exec/config/interface)
): CommandResult;
```

### 2. CLI Command Subset

| Command | Mode | Effect |
|---------|------|--------|
| `show interfaces` | exec | Display all interfaces with status, IP, VLAN |
| `show ip route` | exec | Display routing table |
| `show vlan brief` | exec | Display VLAN-to-port mapping |
| `show running-config` | exec | Display full device config |
| `show ip int brief` | exec | Brief interface IP summary |
| `ping <ip>` | exec | Evaluate reachability from this device |
| `configure terminal` | exec | Enter config mode |
| `interface <name>` | config | Enter interface sub-mode |
| `switchport access vlan <id>` | config-if | Set access VLAN |
| `switchport trunk allowed vlan add <id>` | config-if | Add VLAN to trunk |
| `ip routing` | config | Enable L3 routing |
| `no shutdown` | config-if | Enable interface |
| `shutdown` | config-if | Disable interface |
| `ip route <net> <mask> <nh>` | config | Add static route |
| `ip address <ip> <mask>` | config-if | Set IP on interface |
| `set firewall policy <src> <dst> permit` | config | Add firewall policy |
| `end` | config/config-if | Return to exec mode |
| `exit` | any | Go up one level |

### 3. Scenario Data Schema (YAML)

```yaml
id: "wrong-access-vlan"
title: "Wrong Access VLAN"
difficulty: 1
topology:
  devices:
    - id: "switch1"
      hostname: "SW1"
      type: "switch"
      interfaces:
        - name: "Gi0/1"
          mode: "access"
          accessVlan: 10
          status: "up"
        - name: "Gi0/2"
          mode: "trunk"
          trunkAllowedVlans: [10, 20]
          status: "up"
      routing:
        enabled: false
        routes: []
        svis: []
    - id: "host-a"
      hostname: "HostA"
      type: "host"
      interfaces:
        - name: "eth0"
          ip: "10.0.10.2"
          mask: "255.255.255.0"
          gateway: "10.0.10.1"
          status: "up"
      routing:
        enabled: false
        routes: []
        svis: []
  links:
    - id: "link1"
      from: { device: "host-a", interface: "eth0" }
      to: { device: "switch1", interface: "Gi0/1" }

injected_fault:
  device: "switch1"
  interface: "Gi0/1"
  field: "accessVlan"
  value: 20  # should be 10

ticket:
  title: "Host A can't reach its default gateway"
  symptom: "Host A reports 'no route to host' when pinging 10.0.10.1."
  affected_hosts: ["host-a"]

win_condition:
  type: "ping"
  source: "host-a"
  destination: "10.0.10.1"
  expected: "success"

reference_solution:
  - device: "switch1"
    commands:
      - "configure terminal"
      - "interface Gi0/1"
      - "switchport access vlan 10"
      - "end"
```

### 4. MCP Server (`packages/mcp-server/`)

Built with the `@modelcontextprotocol/sdk` TypeScript library. Exposes tools over stdio transport.

**Tools:**

| Tool | Parameters | Returns |
|------|-----------|---------|
| `get_topology` | none | Full device/link state as JSON |
| `get_ticket` | none | `{title, symptom, affected_hosts}` |
| `run_command` | `{device: string, command: string}` | `{output: string, stateChanged: boolean}` |
| `check_win_condition` | none | `{resolved: boolean, details: string}` |
| `reset_scenario` | none | `{success: boolean}` |
| `load_scenario` | `{id: string}` | `{success: boolean, title: string}` |

### 5. Web Frontend (`packages/frontend/`)

- **Framework:** React 18 + Vite
- **Terminal:** xterm.js with a custom shell adapter that routes input to the engine
- **Topology:** React component rendering SVG nodes/edges with color transitions
- **State management:** React context wrapping the engine state; re-renders on state change
- **Layout:** Split view — terminal on left/bottom, topology + ticket on right/top

### 6. Validation Agent

A script/steering-driven workflow that:
1. Connects to the MCP server (or uses the engine directly).
2. Loads a scenario.
3. Verifies initial state is broken (`check_win_condition()` → false).
4. Executes `reference_solution` commands via `run_command()`.
5. Asserts `check_win_condition()` → true.
6. Reports pass/fail with step details.

### 7. On-Save Hook (`packages/hooks/`)

- Uses `chokidar` to watch `scenarios/*.yaml`.
- On file change: parses the YAML, spawns validation (can be in-process since engine is shared).
- Outputs colored pass/fail to stdout.
- Exits non-zero on validation failure (useful for CI integration).

## Data Flow

### Player Game Loop
```
Player types command → Terminal captures input
  → Game Controller routes to Engine.executeCommand(device, cmd)
  → Engine mutates state + re-evaluates reachability
  → Controller broadcasts new state
  → Topology re-renders (link colors update)
  → If win_condition met → show victory overlay
```

### Validation Loop
```
File saved → Hook detects change → Parse YAML
  → Load scenario into engine → Assert broken
  → Execute reference_solution steps
  → Assert win_condition met → Report
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Constraint-based reachability (not packet sim) | Deterministic, fast, provably solvable; avoids the complexity of real packet forwarding |
| Single shared engine module | Eliminates logic drift between game and MCP server; single source of truth |
| YAML scenario files | Human-readable, easy to author, good for version control diffs |
| TypeScript end-to-end | One language reduces context switching; engine can run in browser AND Node.js |
| xterm.js for terminal | Industry-standard terminal emulator in browser; handles escape codes, history |
| SVG for topology | Lightweight, scalable, CSS-animatable for link transitions |
| MCP stdio transport | Standard, works with Kiro tooling out of the box |
| chokidar for file watching | Mature, cross-platform file watcher for Node.js |

## Folder Structure

```
No-Route-to-Host-/
├── .kiro/
│   ├── specs/
│   │   ├── requirements.md
│   │   ├── design.md
│   │   └── tasks.md
│   └── steering/
│       └── validation-agent.md
├── packages/
│   ├── engine/          # Shared network simulation engine
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── state.ts        # State model types
│   │   │   ├── reachability.ts # Ping evaluation logic
│   │   │   ├── cli-parser.ts   # Command parsing + execution
│   │   │   └── scenario-loader.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── mcp-server/      # MCP server wrapping the engine
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── frontend/        # React web app
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── Terminal.tsx
│   │   │   │   ├── Topology.tsx
│   │   │   │   ├── Ticket.tsx
│   │   │   │   └── ScoreOverlay.tsx
│   │   │   ├── hooks/
│   │   │   └── context/
│   │   ├── index.html
│   │   ├── package.json
│   │   └── vite.config.ts
│   ├── validator/       # Validation agent script
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── hooks/           # On-save file watcher
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── scenarios/           # YAML scenario files
│   ├── 01-wrong-access-vlan.yaml
│   ├── 02-trunk-allowed-list.yaml
│   ├── 03-inter-vlan-routing.yaml
│   ├── 04-missing-default-route.yaml
│   └── 05-firewall-tunnel.yaml
├── package.json         # Workspace root (npm workspaces)
├── tsconfig.base.json   # Shared TS config
└── README.md
```
