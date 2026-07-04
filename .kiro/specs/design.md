# Design — No Route to Host

> **As-built.** This document describes the system as implemented. An earlier
> draft proposed an npm-workspaces / React+Vite / MCP-SDK / YAML stack; the
> project was instead built as a single zero-dependency TypeScript tree with a
> hand-rolled MCP server, JSON scenarios, and a dependency-free browser client.
> This design reflects what actually ships.

## Architecture Overview

One shared engine module is imported unchanged by four consumers — the game's
HTTP server, the MCP server, the CI validator, and the on-save hook. No
reachability or CLI logic is duplicated.

```
┌──────────────────────────────────────────────────────────┐
│                 Browser (dependency-free)                 │
│   "No Route to Host.dc.html" + support.js (dc-runtime,    │
│    a small React-lite template engine; React vendored)    │
│         terminal · topology · ticket · debrief            │
└───────────────────────────┬──────────────────────────────┘
                            │ fetch() POST /api/*
┌───────────────────────────▼──────────────────────────────┐
│              HTTP server (Node http, no framework)        │
│   serves the UI + /vendor assets; /api/{scenarios,load,   │
│   command,check,reset,state}; /health                     │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│                  Shared Network Engine                    │
│      types · utils · reachability · cli-parser ·          │
│      scenario-loader   (pure, no I/O, no clock)           │
└───────────────────────────▲──────────────────────────────┘
          ┌──────────────────┼───────────────────┐
          │                  │                   │
┌─────────┴────────┐ ┌───────┴────────┐ ┌────────┴─────────┐
│   MCP server     │ │   Validator    │ │  On-save hook    │
│ JSON-RPC 2.0     │ │ solvable+fair  │ │ polling watcher  │
│ over stdio       │ │ (CI gate)      │ │ (authoring)      │
└──────────────────┘ └────────────────┘ └──────────────────┘
```

## Component Design

### 1. Shared Network Engine (`src/engine/`)

The single source of truth. Pure functions over a plain-data state model — no
I/O, no clock, no randomness — so it runs identically in the server, the MCP
server, and CI.

Modules: `types.ts` (data model), `utils.ts` (IP math + lookups),
`reachability.ts` (`evaluatePing`), `cli-parser.ts` (`executeCommand`),
`scenario-loader.ts` (`loadScenario`, `checkWinCondition`), `index.ts` (barrel).

#### State Model

```typescript
interface NetworkState { devices: Device[]; links: Link[]; }

interface Device {
  id: string;
  hostname: string;
  type: 'switch' | 'router' | 'firewall' | 'host' | 'ec2' | 'vpc-router';
  interfaces: NetworkInterface[];
  routing: RoutingConfig;
  firewallPolicies?: FirewallPolicy[];
  natRules?: NatRule[];
  aws?: AWSConfig;                 // security groups, NACLs, route tables, VPC peerings
}

interface NetworkInterface {
  name: string; ip?: string; mask?: string;
  status: 'up' | 'down';
  mode?: 'access' | 'trunk';
  accessVlan?: number; trunkAllowedVlans?: number[];
  gateway?: string;               // host interfaces
}

interface RoutingConfig { enabled: boolean; routes: StaticRoute[]; svis: SVI[]; }
interface StaticRoute { network: string; mask: string; nextHop: string; }
interface SVI { vlan: number; ip: string; mask: string; status: 'up' | 'down'; }
interface Link { id: string; from: LinkEndpoint; to: LinkEndpoint; }
interface FirewallPolicy { id: number; srcSubnet: string; dstSubnet: string; action: 'permit' | 'deny'; interface?: string; }
```

AWS types (`AWSConfig`) add `securityGroups[]` (stateful in/out rules),
`nacls[]` (stateless, ordered rules), `routeTables[]` (with `active`/`blackhole`
routes), and `vpcPeerings[]`.

#### Reachability Evaluator — constraint chain, NOT packet forwarding

```typescript
interface PingResult { success: boolean; reason?: string; failedCondition?: number; }
function evaluatePing(state: NetworkState, src: string, dstIp: string): PingResult;
```

`evaluatePing` checks an ordered chain and returns on the first failure:

1. Source host has a valid IP / mask / gateway.
2. Same-subnet L2 path: source access port is in a VLAN that reaches the dest.
3. Trunking: the VLAN is carried across every trunk on the path (BFS).
4. L3 routing: routing enabled, SVIs/interfaces up, a longest-prefix route to
   the destination with a reachable next-hop (recursed hop by hop).
5. Firewall: a policy permits src→dst across any firewall in the path.
6. AWS cloud: the VPC route table has an active route, the security group
   allows the traffic (stateful), and the NACL allows it (stateless, both
   directions).

Each scenario's fault disables **exactly one** condition; `failedCondition`
reports which. This mapping is locked by the engine test suite.

#### CLI Parser

```typescript
interface CommandResult { output: string; stateChanged: boolean; }
function executeCommand(state: NetworkState, deviceId: string, command: string, context: CommandContext): CommandResult;
```

A three-mode state machine (`exec → config → config-if`) that accepts IOS-style
**abbreviations** (any unambiguous prefix: `sh`, `conf t`, `int`, `sw acc
vlan`, `no shut`, …) and a small `aws ec2` subset for cloud scenarios.

### 2. CLI Command Subset

| Command | Mode | Effect |
|---------|------|--------|
| `show interfaces` / `show ip route` / `show vlan brief` / `show running-config` / `show ip int brief` / `show firewall` | exec | Formatted device state |
| `ping <ip>` | exec | Evaluate reachability from this device |
| `aws ec2 describe-*` | exec | Show security groups / route tables / NACLs / peerings |
| `configure terminal` | exec | Enter config mode |
| `interface <name>` | config | Enter interface sub-mode |
| `ip routing` / `ip route <net> <mask> <nh>` | config | L3 routing / static route |
| `set firewall policy <src> <dst> permit\|deny [interface <n>]` | config | Firewall policy |
| `aws ec2 authorize-security-group-ingress/egress`, `create-route`, `replace-route`, `create-network-acl-entry` | exec | Mutate AWS config |
| `switchport access vlan <id>` / `switchport trunk allowed vlan add <id>` | config-if | VLAN config |
| `ip address <ip> <mask>` / `no shutdown` / `shutdown` | config-if | Interface config |
| `end` / `exit` | config/-if | Mode transitions |

Vendor flavour by device: IOS-style for switches/routers, FortiOS-style `set`
for the firewall, an AWS CLI subset for `ec2` / `vpc-router`.

### 3. Scenario Data Schema (JSON)

Scenarios are JSON files in `scenarios/`. The `injected_fault` is applied at
load to produce the broken initial state.

```json
{
  "id": "wrong-access-vlan",
  "title": "Wrong Access VLAN",
  "difficulty": 1,
  "topology": { "devices": [ /* ... */ ], "links": [ /* ... */ ] },
  "injected_fault": { "device": "switch1", "interface": "Gi0/1", "field": "accessVlan", "value": 20, "action": "set" },
  "ticket": { "title": "Host A can't reach its gateway", "symptom": "...", "affected_hosts": ["host-a"] },
  "win_condition": { "type": "ping", "source": "host-a", "destination": "10.0.10.1", "expected": "success" },
  "reference_solution": [ { "device": "switch1", "commands": ["configure terminal", "interface Gi0/1", "switchport access vlan 10", "end"] } ],
  "layout": { "switch1": { "x": 200, "y": 150 } }
}
```

### 4. HTTP Server (`src/server/`)

Plain `node:http`, no framework. Serves the DC UI at `/`, `support.js` and
`public/vendor/*` (React + IBM Plex, self-hosted), and a JSON API:
`/api/scenarios`, `/api/load`, `/api/command`, `/api/check`, `/api/reset`,
`/api/state`, plus `/health`. Hardening: 64 KB body cap (413), JSON-parse
guard (400), method guard (405), and a path-traversal guard that confines
static reads to the web root. `PORT` is read from the environment.

### 5. MCP Server (`src/mcp-server/`) — hand-rolled JSON-RPC

A dependency-free JSON-RPC 2.0 implementation over stdio (newline-delimited
messages), advertising `protocolVersion` `2024-11-05`. It imports the shared
engine directly.

| Tool | Parameters | Returns |
|------|-----------|---------|
| `list_scenarios` | none | `[{id, title, difficulty}]` |
| `load_scenario` | `{id}` | `{success, title, id}` |
| `get_topology` | none | Full device/link state |
| `get_ticket` | none | `{title, symptom, affected_hosts}` |
| `run_command` | `{device, command}` | `{output, stateChanged}` |
| `check_win_condition` | none | `{resolved, details, ...}` |
| `reset_scenario` | none | `{success, title}` |

### 6. Web Client (`src/No Route to Host.dc.html` + `src/support.js`)

A single self-contained `.dc.html` "design component": a `<x-dc>` template
(landing, dashboard, play, debrief, author screens) plus an inline `Component`
class. `support.js` is a small generated **dc-runtime** — a React-lite template
compiler (`{{ }}`, `<sc-if>`, `<sc-for>`, `<helmet>`) that mounts the component.
React and the IBM Plex fonts are **vendored** under `public/vendor/` and loaded
before `support.js`, so the app boots with no internet. The client holds no
game logic — reachability, CLI parsing, and win detection all come from the
server via `/api/*`; the Play/Debrief panels render from the loaded scenario.

### 7. Validator (`src/validator/`) — CI determinism + fairness gate

For each scenario, asserts **SOLVABLE** (fault present → `false`, reference
solution → `true`, deterministic) and **FAIR**, reporting a verdict of
`already-solved | unsolvable | symptom-mismatch | unintended-solution`. The
"no unintended solution" rule is a documented bounded heuristic (read-only
investigation must not win; the fix must change state), not an exhaustive
uniqueness proof. Exits non-zero on any failure.

### 8. On-Save Hook (`src/hooks/`)

A polling `mtime` watcher over `scenarios/*.json` (no external file-watch
dependency). On change it re-parses, schema-validates, and runs the same
solvability check through the shared engine, printing `✓`/`✗` and exiting
non-zero on failure — suitable for a Kiro on-save trigger and for CI.

### 9. Engine Tests (`src/tests/`)

A zero-dependency harness (`npm test`) exercising the engine primitives
(utils, reachability conditions, CLI abbreviations) and driving all eight real
scenarios to lock the fault→condition mapping. Runs in CI before the validator.

## Data Flow

### Player Game Loop
```
Player types command → client POSTs /api/command
  → server calls engine.executeCommand(device, cmd)
  → engine mutates state + re-evaluates the win condition
  → server returns { output, stateChanged, winCheck, topology }
  → client appends terminal output, updates ticket/topology
  → if winCheck.resolved → victory → debrief
```

### Author / Validation Loop
```
Author edits a scenario JSON → save → on-save hook (or CI validator)
  → load into engine → assert broken → run reference_solution
  → assert fixed + fairness checks → report PASS / FAIL <verdict>
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Constraint-based reachability (not packet sim) | Deterministic, fast, provably solvable; each fault maps to exactly one failed condition. |
| Single shared engine module | Eliminates logic drift between the game, MCP server, and CI — one source of truth. |
| JSON scenario files | Parsed natively with `JSON.parse`; no YAML dependency; good diffs. |
| Zero runtime dependencies | The engine is pure TS; the server uses only `node:*`; React + fonts are vendored — the whole app runs offline (NFR-3). |
| Hand-rolled MCP (no SDK) | Keeps the dependency count at zero and the protocol surface explicit and auditable. |
| Polling on-save hook (no chokidar) | Small, cross-platform, dependency-free; sufficient for authoring feedback. |
| TypeScript everywhere, `tsc` only | One language and one build tool across engine, servers, validator, hooks, and tests. |

## Folder Structure

```
No-Route-to-Host-/
├── .github/workflows/ci.yml        # build → engine tests → validator (determinism + fairness gate)
├── .kiro/
│   ├── specs/                      # requirements.md, design.md, tasks.md
│   ├── steering/networking-trainer.md
│   └── hooks/on-save-validate.md
├── public/vendor/                  # self-hosted React UMD + IBM Plex woff2 + fonts.css
├── scenarios/                      # 8 JSON scenarios (5 classic + 3 AWS)
├── scripts/vendor-assets.mjs       # regenerates public/vendor/ from pinned devDeps
├── src/
│   ├── engine/                     # types, utils, reachability, cli-parser, scenario-loader, index
│   ├── server/                     # HTTP game server + JSON API
│   ├── mcp-server/                 # JSON-RPC 2.0 stdio MCP server
│   ├── validator/                  # CI solvable + fair gate
│   ├── hooks/                      # on-save polling watcher
│   ├── tests/                      # zero-dep engine test suite
│   ├── No Route to Host.dc.html    # web client (served at /)
│   └── support.js                  # dc-runtime (React-lite template engine)
├── Dockerfile
├── package.json                    # tsc build; typescript/react/@fontsource as devDeps only
└── tsconfig.json
```
