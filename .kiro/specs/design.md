# Design — No Route to Host

This design describes the system and matches the shipped code. The build is an
npm-workspaces monorepo: one shared, browser-safe engine consumed by a React +
Vite + xterm.js web app, an MCP server (official SDK), a CI validator, and an
on-save hook. Scenarios are authored in YAML.

## Architecture Overview

The engine is the single source of truth. It is a **pure, browser-safe
package** (`@nrth/engine`, no Node imports), so the React app runs the entire
simulation client-side, while the Node tools import the same package.

```
┌───────────────────────────────────────────────────────────────┐
│                  packages/frontend  (React + Vite)             │
│   xterm.js terminal · SVG topology · ticket · debrief ·        │
│   Author Studio (live solvable+fair validation)               │
│   imports @nrth/engine — the whole game runs in the browser    │
└───────────────────────────────┬───────────────────────────────┘
                                │  (no backend API — client-side)
┌───────────────────────────────▼───────────────────────────────┐
│                    packages/engine  (@nrth/engine)             │
│   types · utils · reachability · cli-parser · scenario-loader  │
│   pure · deterministic · no I/O · no clock · no randomness     │
└───────────────┬───────────────┬───────────────┬───────────────┘
                │               │               │
   ┌────────────┴──────┐ ┌──────┴────────┐ ┌────┴──────────────┐
   │ packages/         │ │ packages/     │ │ packages/hooks    │
   │ mcp-server        │ │ validator     │ │ on-save watcher   │
   │ @modelcontext-    │ │ solvable+fair │ │ (authoring)       │
   │ protocol/sdk      │ │ (CI gate)     │ │                   │
   │ stdio transport   │ └───────────────┘ └───────────────────┘
   └───────────────────┘
```

## Monorepo Layout

```
packages/
├── engine/        # @nrth/engine — shared simulation (pure, browser-safe)
│   ├── src/       #   types, utils, reachability, cli-parser, scenario-loader
│   └── test/      #   zero-dep engine test suite (npm test)
├── frontend/      # React 18 + Vite + TypeScript + xterm.js web app
├── mcp-server/    # MCP server on @modelcontextprotocol/sdk (stdio)
├── validator/     # CI determinism + fairness gate
└── hooks/         # on-save YAML scenario validator
```

TypeScript project references (`tsconfig.base.json` + per-package `tsconfig` +
a solution `tsconfig.json`) build in dependency order via `tsc -b`. The
frontend is built by Vite (`vite build`).

## Component Design

### 1. Shared Engine (`@nrth/engine`)

Pure functions over a plain-data state model. No I/O, no clock, no randomness —
so it produces identical results in the browser, the MCP server, and CI.

#### State Model

```typescript
interface NetworkState { devices: Device[]; links: Link[]; }

interface Device {
  id: string;
  hostname: string;
  type: 'switch' | 'router' | 'firewall' | 'host' | 'ec2' | 'vpc-router'
      | 'linux-server' | 'windows-server' | 'docker-host';
  interfaces: NetworkInterface[];
  routing: RoutingConfig;
  firewallPolicies?: FirewallPolicy[];
  natRules?: NatRule[];
  aws?: AWSConfig;      // security groups, NACLs, route tables, VPC peerings
  os?: OSConfig;        // iptables / Windows Firewall (host-firewall scenarios)
}
```

Plus `NetworkInterface`, `RoutingConfig` (enabled + `routes[]` + `svis[]`),
`Link`, `FirewallPolicy`, and the AWS/OS config blocks.

#### Reachability Evaluator — ordered constraint chain (NOT packet forwarding)

```typescript
function evaluatePing(state: NetworkState, src: string, dstIp: string): PingResult;
// { success, reason?, failedCondition? }
```

Returns on the first failing condition:

1. Source host has a valid IP / mask / gateway.
2. Same-subnet L2 path (access VLAN reaches the destination).
3. Trunking carries the VLAN across every trunk on the path (BFS).
4. L3 routing (enabled, SVIs/interfaces up, longest-prefix route + reachable next-hop).
5. Firewall policy permits src→dst across any firewall in the path.
6. AWS cloud (VPC route table active route + stateful security group + stateless NACL).
7. Host firewall (Linux `iptables` INPUT/FORWARD, Docker, Windows Firewall).

Each scenario's fault disables **exactly one** condition; `failedCondition`
reports which. The mapping is locked by the engine test suite
(`packages/engine/test/scenarios.test.ts`).

#### CLI Parser

`executeCommand(state, deviceId, command, context)` — a three-mode state
machine (`exec → config → config-if`) accepting IOS-style abbreviations plus an
`aws ec2` subset and host-firewall commands (Linux `iptables`, PowerShell
`New-NetFirewallRule`).

### 2. Web App (`packages/frontend`)

- **React 18 + Vite + TypeScript.**
- **Terminal:** xterm.js with a small line editor (history, backspace, coloured
  output) dispatching lines to `@nrth/engine`'s `executeCommand`.
- **Topology / ticket / debrief:** React components rendered from the loaded
  scenario's `GameState`.
- **Author Studio:** runs `validateScenario()` (the same solvable + fair logic
  as CI) live in the browser and reports the verdict + fairness checks.
- **Scenario loading:** `import.meta.glob('scenarios/*.yaml', '?raw')` bundles
  every scenario at build time — the same YAML files the Node tools read.
- Because the engine is client-side, gameplay needs **no server** and makes
  **no external requests**; the header shows an honest "Engine ready" state.

### 3. Scenario Schema (YAML)

```yaml
id: wrong-access-vlan
title: Wrong Access VLAN
difficulty: 1
topology: { devices: [...], links: [...] }
injected_fault: { device: switch1, interface: Gi0/1, field: accessVlan, value: 20, action: set }
ticket: { title: "...", symptom: "...", affected_hosts: [host-a] }
win_condition: { type: ping, source: host-a, destination: 10.0.10.1, expected: success }
reference_solution:
  - { device: switch1, commands: [configure terminal, interface Gi0/1, switchport access vlan 10, end] }
```

`parseScenario()` in the engine loads YAML (a superset of JSON) with `js-yaml`.

### 4. MCP Server (`packages/mcp-server`)

Built on the official **`@modelcontextprotocol/sdk`** (`McpServer` +
`StdioServerTransport`, zod-typed inputs). Imports `@nrth/engine`. Tools:

| Tool | Parameters | Returns |
|------|-----------|---------|
| `list_scenarios` | none | `[{id, title, difficulty}]` |
| `load_scenario` | `{id}` | `{success, title, id}` |
| `get_topology` | none | Full device/link state |
| `get_ticket` | none | `{title, symptom, affected_hosts}` |
| `run_command` | `{device, command}` | `{output, stateChanged}` |
| `check_win_condition` | none | `{resolved, details, ...}` |
| `reset_scenario` | none | `{success, title}` |

### 5. Validator (`packages/validator`) — CI determinism + fairness gate

For each scenario asserts **SOLVABLE** (fault present → reference solution
fixes → deterministic) and **FAIR**, reporting a verdict:
`already-solved | unsolvable | symptom-mismatch | unintended-solution`. The
"no unintended solution" check is a documented bounded heuristic.

### 6. On-Save Hook (`packages/hooks`)

Watches `scenarios/**/*.yaml`; on change it schema-validates, plays the
reference solution through the shared engine, and reports PASS/FAIL — the same
check Kiro's on-save hook fires (`.kiro/hooks/on-save-validate.md`).

## Data Flow

### Player loop (all client-side)
```
Player types command in xterm → engine.executeCommand(device, cmd)
  → engine mutates state + re-checks the win condition
  → React re-renders terminal output + topology
  → win → debrief overlay
```

### Author / validation loop
```
Author edits a scenario YAML → save → Kiro on-save hook (and CI validator)
  → engine: assert broken → run reference_solution → assert fixed + fairness
  → PASS / FAIL <verdict>
The same validateScenario() also runs live in the browser Author Studio.
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Constraint-based reachability (not packet sim) | Deterministic, fast, provably solvable; one fault ↔ one failed condition. |
| Browser-safe pure engine | The React app runs the whole game client-side — no API, no sessions, no server to break or host. |
| npm workspaces monorepo | Clear package boundaries; one engine imported everywhere via `tsc -b` project references. |
| React + Vite + xterm.js | Real, familiar web stack; xterm gives an authentic terminal; Vite bundles everything (zero CDN at runtime). |
| Official MCP SDK | Spec-compliant, auditable MCP surface for the Kiro agent. |
| YAML scenarios | Human-readable authoring; parsed once in the engine; good diffs. |
| TypeScript end to end | One language across engine, web, MCP, validator, and hooks. |
