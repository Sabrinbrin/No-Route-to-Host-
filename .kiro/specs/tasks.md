# Tasks — No Route to Host

## Phase 1: Foundation (Engine + First Scenario Playable) ✅

### Task 1.1: Project Scaffolding ✅
- [x] Initialize project with `package.json` and `tsconfig.json`
- [x] Create `src/engine/` for the shared simulation engine
- [x] Create `src/mcp-server/` for the MCP server
- [x] Create `src/server/` for the HTTP game server
- [x] Create `src/validator/` for scenario validation
- [x] Create `src/hooks/` for on-save automation
- [x] Create `scenarios/` directory for scenario data
- [x] Update `.gitignore` for TypeScript project

### Task 1.2: Engine — State Model ✅
- [x] Define TypeScript interfaces: `NetworkState`, `Device`, `Interface`, `RoutingConfig`, `StaticRoute`, `SVI`, `Link`, `FirewallPolicy`, `NatRule`
- [x] Define AWS cloud types: `SecurityGroup`, `NACL`, `RouteTable`, `VPCPeering`, `AWSConfig`
- [x] Implement `loadScenario(scenario)` — builds broken state from scenario data
- [x] Implement fault injection via `injected_fault` field
- [x] Export all types and functions

### Task 1.3: Engine — Reachability Evaluator ✅
- [x] Implement `evaluatePing(state, sourceDevice, destIP)` with ordered condition chain
- [x] Condition 1: Validate source host has IP/mask/gateway
- [x] Condition 2: Validate source access VLAN has valid L2 path
- [x] Condition 3: Validate trunk carries the required VLAN
- [x] Condition 4: Validate L3 routing (enabled, SVI up, route exists)
- [x] Condition 5: Validate firewall policy permits traffic
- [x] Condition 6: Validate AWS security groups, NACLs, and route tables
- [x] Return `PingResult` with success/failure and reason
- [x] Handle direct router/firewall/EC2 connections (no VLAN needed)

### Task 1.4: Engine — CLI Parser ✅
- [x] Implement IOS-style command abbreviation (`abbr()` helper)
- [x] Implement `show interfaces` / `show ip route` / `show vlan brief` / `show running-config`
- [x] Implement `show ip int brief` / `show firewall`
- [x] Implement `ping <ip>` — calls reachability evaluator
- [x] Implement `configure terminal` (+ `conf t` shortform)
- [x] Implement `interface <name>` (+ `int` shortform)
- [x] Implement `switchport access vlan <id>` (+ `sw acc vlan` shortform)
- [x] Implement `switchport trunk allowed vlan add <id>`
- [x] Implement `ip routing` / `ip route <net> <mask> <nh>`
- [x] Implement `no shutdown` / `shutdown` (+ `no shut` shortform)
- [x] Implement `set firewall policy` — state mutation
- [x] Implement AWS CLI: `aws ec2 describe-security-groups`, `authorize-security-group-ingress/egress`
- [x] Implement AWS CLI: `aws ec2 create-route`, `replace-route`, `create-network-acl-entry`
- [x] Implement `end` / `exit` — mode transitions
- [x] Handle unknown commands with help text

### Task 1.5: Engine — Scenario Loader ✅
- [x] Implement JSON parser for scenario format
- [x] Validate scenario schema (required fields present)
- [x] Build `NetworkState` from `topology` field
- [x] Apply `injected_fault` to produce broken initial state
- [x] Implement `checkWinCondition(state, winCondition)` — evaluates win assertion

### Task 1.6: Scenarios 1–5 (Traditional Networking) ✅
- [x] Scenario 1: Wrong Access VLAN — verified solvable in 4 steps
- [x] Scenario 2: Trunk Allowed-List Gap — verified solvable in 4 steps
- [x] Scenario 3: Inter-VLAN Routing Down — verified solvable in 4 steps
- [x] Scenario 4: Missing Default Route — verified solvable in 3 steps
- [x] Scenario 5: Firewall Tunnel Blackhole — verified solvable in 3 steps

### Task 1.7: Scenarios 6–8 (AWS Cloud Networking) ✅
- [x] Scenario 6: EC2 Security Group Blocking ICMP — verified solvable in 1 step
- [x] Scenario 7: VPC Route Table Missing Peering Route — verified solvable in 1 step
- [x] Scenario 8: NACL Blocking Return Traffic — verified solvable in 1 step

---

## Phase 2: MCP Server + Validation ✅

### Task 2.1: MCP Server Implementation ✅
- [x] Implement JSON-RPC 2.0 protocol over stdio transport
- [x] Import shared engine (single source of truth)
- [x] Implement `get_topology` tool
- [x] Implement `get_ticket` tool
- [x] Implement `run_command` tool
- [x] Implement `check_win_condition` tool
- [x] Implement `reset_scenario` tool
- [x] Implement `load_scenario` tool
- [x] Implement `list_scenarios` tool
- [x] Tested end-to-end: load → detect fault → fix → confirm resolution

### Task 2.2: Validation Agent ✅
- [x] Implement validation flow: load → assert broken → run solution → assert fixed
- [x] Verify initial state is broken (`check_win_condition()` → false)
- [x] Execute `reference_solution` commands via engine
- [x] Assert `check_win_condition()` → true after fix
- [x] Implement detailed reporting (pass/fail with reasons)
- [x] Run against all 8 scenarios — all pass

### Task 2.3: Steering File ✅
- [x] Create `.kiro/steering/networking-trainer.md` with `inclusion: always`
- [x] Document architecture invariants (constraint-based, no packet sim)
- [x] Document CLI grammar rules and abbreviation conventions
- [x] Document validation definitions (SOLVABLE + FAIR criteria)
- [x] Document agent behaviour rules (never edit engine, report failures)
- [x] Document MCP tool contracts and configuration

### Task 2.4: On-Save Hook ✅
- [x] Implement file watcher on `scenarios/*.json`
- [x] On change: parse JSON, validate schema, run validation
- [x] Format output: ✓/✗ with scenario name and details
- [x] Exit code: 0 = pass, 1 = fail (CI-compatible)
- [x] Support modes: validate-all, single-file, --watch
- [x] Tested: catches intentionally broken scenarios

---

## Phase 3: Web Frontend ✅

### Task 3.1: Game Server ✅
- [x] HTTP server with JSON API + static file serving
- [x] API endpoints: /api/scenarios, /api/load, /api/command, /api/check, /api/reset, /api/state
- [x] Support PORT env variable for flexible deployment
- [x] CORS headers for cross-origin access
- [x] Serve DC HTML UI at root `/`

### Task 3.2: Frontend UI (DC Framework) ✅
- [x] Landing page with project pitch and feature highlights
- [x] Scenario dashboard with all 8 scenarios, difficulty ratings
- [x] Play screen: terminal + topology diagram + ticket panel
- [x] Terminal with command input, history, and coloured output
- [x] Real-time prompt updates reflecting CLI mode (exec/config/config-if)
- [x] Live MCP status indicator (green/red dot, polls every 10s)
- [x] Victory/debrief screen with efficiency scoring (grade A–D)
- [x] Author studio with YAML editor and animated validation agent
- [x] Hints system with escalating cost
- [x] Timer and command counter

### Task 3.3: Backend Wiring ✅
- [x] All terminal commands routed to `POST /api/command` (real engine)
- [x] Scenario loading via `POST /api/load`
- [x] Win condition checked automatically after state changes
- [x] Reset via `POST /api/reset`
- [x] Dashboard fetches real scenario list from `GET /api/scenarios`

---

## Phase 4: Polish & Deployment ✅

### Task 4.1: Dockerfile ✅
- [x] Multi-stage build: TypeScript compile → minimal Node.js runtime
- [x] Expose port 3000
- [x] One-command start: `docker build -t nrth . && docker run -p 8080:3000 nrth`

### Task 4.2: Error Handling ✅
- [x] Server gracefully handles malformed JSON
- [x] Server returns proper error responses for unknown endpoints
- [x] CLI parser returns helpful messages for unknown commands
- [x] Scenario loader validates schema before loading

### Task 4.3: Documentation ✅
- [x] README with compelling pitch, quick start, architecture, scenario table
- [x] MCP configuration documented
- [x] How to add new scenarios documented
- [x] Demo script for hackathon presentation

### Task 4.4: End-to-End Verification ✅
- [x] All 8 scenarios pass validation
- [x] MCP server handles all tools correctly
- [x] HTTP server serves game and API
- [x] On-save hook catches broken scenarios
- [x] IOS abbreviations work (sh ip int bri, conf t, sw acc vlan, etc.)
