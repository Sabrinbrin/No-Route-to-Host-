# Tasks — No Route to Host

## Phase 1: Foundation (Engine + First Scenario Playable)

### Task 1.1: Project Scaffolding
- [ ] Initialize npm workspace root with `package.json` (workspaces: `packages/*`)
- [ ] Create `tsconfig.base.json` with shared compiler options
- [ ] Create `packages/engine/` with package.json and tsconfig.json
- [ ] Create `packages/frontend/` with Vite + React setup
- [ ] Create `packages/mcp-server/` with package.json
- [ ] Create `packages/validator/` with package.json
- [ ] Create `packages/hooks/` with package.json
- [ ] Create `scenarios/` directory
- [ ] Update `.gitignore` for Node.js/TypeScript project

### Task 1.2: Engine — State Model
- [ ] Define TypeScript interfaces: `NetworkState`, `Device`, `Interface`, `RoutingConfig`, `StaticRoute`, `SVI`, `Link`, `FirewallPolicy`, `NatRule`
- [ ] Implement `createInitialState(scenario)` — builds state from scenario data
- [ ] Implement `applyFault(state, fault)` — applies the injected fault to create the broken state
- [ ] Export all types and functions

### Task 1.3: Engine — Reachability Evaluator
- [ ] Implement `evaluatePing(state, sourceDevice, destIP)` with 5-condition chain
- [ ] Condition 1: Validate source host has IP/mask/gateway
- [ ] Condition 2: Validate source access VLAN has valid L2 path
- [ ] Condition 3: Validate trunk carries the required VLAN
- [ ] Condition 4: Validate L3 routing (enabled, SVI up, route exists)
- [ ] Condition 5: Validate firewall policy permits traffic
- [ ] Return `PingResult` with success/failure and reason
- [ ] Implement helper: `findPath(state, srcDevice, dstIP)` — determines L2/L3 path

### Task 1.4: Engine — CLI Parser
- [ ] Implement command mode state machine (exec → config → config-if)
- [ ] Implement `show interfaces` — format interface table output
- [ ] Implement `show ip route` — format routing table
- [ ] Implement `show vlan brief` — format VLAN table
- [ ] Implement `show running-config` — format full config
- [ ] Implement `show ip int brief` — brief IP summary
- [ ] Implement `ping <ip>` — calls reachability evaluator
- [ ] Implement `configure terminal` — mode transition
- [ ] Implement `interface <name>` — mode transition
- [ ] Implement `switchport access vlan <id>` — state mutation
- [ ] Implement `switchport trunk allowed vlan add <id>` — state mutation
- [ ] Implement `ip routing` — state mutation
- [ ] Implement `no shutdown` / `shutdown` — state mutation
- [ ] Implement `ip route <net> <mask> <nh>` — state mutation
- [ ] Implement `set firewall policy` — state mutation
- [ ] Implement `end` / `exit` — mode transitions
- [ ] Handle unknown commands with help text

### Task 1.5: Engine — Scenario Loader
- [ ] Implement YAML parser for scenario format
- [ ] Validate scenario schema (required fields present)
- [ ] Build `NetworkState` from `topology` field
- [ ] Apply `injected_fault` to produce broken initial state
- [ ] Implement `checkWinCondition(state, winCondition)` — evaluates win assertion

### Task 1.6: Scenario 1 — Wrong Access VLAN
- [ ] Author `scenarios/01-wrong-access-vlan.yaml` with full topology, fault, ticket, win condition, and reference solution
- [ ] Verify manually: loading + running reference solution triggers win

---

## Phase 2: Web Frontend (Playable in Browser)

### Task 2.1: Frontend Shell
- [ ] Set up Vite + React 18 with TypeScript
- [ ] Create `App.tsx` with split layout (terminal + topology + ticket panel)
- [ ] Create `GameContext` providing engine state to all components
- [ ] Implement scenario selection screen (list scenarios from bundled data)

### Task 2.2: Terminal Component
- [ ] Integrate xterm.js
- [ ] Implement device-selection prompt (e.g., `SW1#`)
- [ ] Route typed commands to engine `executeCommand()`
- [ ] Display command output in terminal
- [ ] Implement command history (up/down arrows)
- [ ] Support `connect <device>` to switch target device

### Task 2.3: Topology Diagram
- [ ] Render devices as labeled SVG nodes (positioned from layout data)
- [ ] Render links as SVG edges between device nodes
- [ ] Color edges based on reachability status (red/green)
- [ ] Animate color transitions on state change (CSS transition, 500ms)
- [ ] Show device hostname; tooltip on hover with interface details

### Task 2.4: Ticket & Score UI
- [ ] Display ticket panel: title, symptom, affected hosts
- [ ] Display running timer (elapsed seconds)
- [ ] Display command counter
- [ ] Implement victory overlay: "Ticket Resolved!" + final score + grade
- [ ] Implement restart and scenario-select buttons

---

## Phase 3: Remaining Scenarios

### Task 3.1: Scenario 2 — Trunk Allowed-List Gap
- [ ] Author `scenarios/02-trunk-allowed-list.yaml`
- [ ] Topology: two switches with trunk link, VLAN 30 hosts on both
- [ ] Fault: trunk allowed-list omits VLAN 30
- [ ] Win: cross-switch VLAN 30 ping succeeds

### Task 3.2: Scenario 3 — Inter-VLAN Routing Down
- [ ] Author `scenarios/03-inter-vlan-routing.yaml`
- [ ] Topology: L3 switch with VLAN 10 and 20 SVIs
- [ ] Fault: `ip routing` disabled or SVI shut
- [ ] Win: cross-VLAN ping succeeds

### Task 3.3: Scenario 4 — Missing Default Route
- [ ] Author `scenarios/04-missing-default-route.yaml`
- [ ] Topology: internal switch/router + upstream next-hop + external test host
- [ ] Fault: no default route or wrong next-hop
- [ ] Win: internal host pings external test IP

### Task 3.4: Scenario 5 — Firewall Tunnel Blackhole
- [ ] Author `scenarios/05-firewall-tunnel.yaml`
- [ ] Topology: two sites connected via IPsec tunnel (firewall device)
- [ ] Fault: missing permit policy for tunnel subnets (or missing static route to remote via tunnel interface)
- [ ] Win: cross-tunnel ping succeeds

---

## Phase 4: MCP Server + Validation

### Task 4.1: MCP Server Implementation
- [ ] Set up `@modelcontextprotocol/sdk` with stdio transport
- [ ] Import shared engine
- [ ] Implement `get_topology` tool
- [ ] Implement `get_ticket` tool
- [ ] Implement `run_command` tool
- [ ] Implement `check_win_condition` tool
- [ ] Implement `reset_scenario` tool
- [ ] Implement `load_scenario` tool
- [ ] Build and verify server starts

### Task 4.2: Validation Agent
- [ ] Create validation script that connects to MCP server (or uses engine directly)
- [ ] Implement validation flow: load → assert broken → run solution → assert fixed
- [ ] Implement detailed reporting (step-by-step output, pass/fail with reasons)
- [ ] Run against all 5 scenarios and confirm all pass

### Task 4.3: Steering File
- [ ] Create `.kiro/steering/validation-agent.md` with:
  - CLI grammar rules (what commands are valid)
  - Definition of "solvable" (fault present + reference solution fixes it)
  - Reporting format conventions
  - Scenario file schema expectations

### Task 4.4: On-Save Hook
- [ ] Implement file watcher using chokidar on `scenarios/*.yaml`
- [ ] On change: parse YAML, validate schema, run validation
- [ ] Format output: ✓/✗ with scenario name and details
- [ ] Exit code: 0 = pass, 1 = fail
- [ ] Add npm script: `npm run watch:scenarios`

---

## Phase 5: Polish & Integration

### Task 5.1: End-to-End Verification
- [ ] Run all 5 scenarios through the game (manual play path)
- [ ] Run all 5 scenarios through the validator
- [ ] Verify MCP server handles all tools correctly
- [ ] Verify on-save hook catches intentionally broken scenario

### Task 5.2: Documentation
- [ ] Update README.md with project overview, setup instructions, and usage
- [ ] Document how to add new scenarios
- [ ] Document MCP server tool API

### Task 5.3: Build & Package
- [ ] Ensure `npm run build` builds all packages
- [ ] Ensure `npm run dev` starts frontend in dev mode
- [ ] Ensure `npm run validate` runs all scenario validations
- [ ] Ensure `npm run mcp` starts the MCP server
