# Requirements — No Route to Host

## User Stories & Acceptance Criteria

### US-1: Receive a Trouble Ticket

**As a** player (junior network engineer),
**I want to** receive a trouble ticket describing a network symptom,
**so that** I can begin diagnosing the problem.

**Acceptance Criteria:**
1. When a scenario loads, a ticket panel displays: title, symptom description, and affected hosts.
2. The topology diagram renders all devices and links from the scenario data.
3. Links with broken reachability display in red; healthy links display in green.
4. The timer starts counting from 0 upon scenario load.

---

### US-2: Investigate via Simulated CLI

**As a** player,
**I want to** run diagnostic commands (`show`, `ping`) on network devices,
**so that** I can gather information to form a hypothesis.

**Acceptance Criteria:**
1. A web terminal accepts input and dispatches commands to a target device.
2. `show interfaces` on a device returns interface status (up/down), VLAN assignment, IP, mask, and mode (access/trunk).
3. `show ip route` returns the device's routing table (connected + static routes).
4. `show vlan brief` returns VLAN-to-port mappings on switches.
5. `show running-config` returns a formatted config representation of the device state.
6. `ping <destination-ip>` from a device evaluates reachability and returns success/failure with a reason on failure.
7. Invalid commands return a helpful "unknown command" message listing available commands.
8. Each command issued increments the player's command counter.

---

### US-3: Apply Configuration Fixes

**As a** player,
**I want to** enter configuration mode and apply changes to devices,
**so that** I can fix the diagnosed fault.

**Acceptance Criteria:**
1. `configure terminal` (or `conf t`) enters config mode on the selected device.
2. `interface <name>` enters interface sub-config mode.
3. `switchport access vlan <id>` changes the access VLAN of the current interface.
4. `switchport trunk allowed vlan add <id>` adds a VLAN to the trunk allowed list.
5. `ip routing` enables L3 routing on a switch.
6. `no shutdown` enables a disabled interface/SVI.
7. `ip route <network> <mask> <next-hop>` adds a static route.
8. Firewall-specific: `set policy` or equivalent adds a firewall permit policy.
9. `end` exits configuration mode.
10. After each config change, the engine re-evaluates reachability; the topology diagram updates link colors accordingly.

---

### US-4: Win Condition & Scoring

**As a** player,
**I want to** know when I've fixed the network and see my score,
**so that** I feel a sense of accomplishment and can improve.

**Acceptance Criteria:**
1. After each config change, the engine evaluates the scenario's win condition (a specific reachability assertion).
2. When the win condition is met, a "Ticket Resolved!" overlay appears.
3. The score displays: elapsed time (seconds) and total commands issued.
4. Lower time and fewer commands yield a better score (displayed as a grade: A/B/C/D).
5. The player can restart the scenario or choose another.

---

### US-5: Reachability Engine — Constraint Evaluation

**As a** system,
**I need to** evaluate ping reachability as a chain of ordered conditions (NOT packet simulation),
**so that** results are deterministic and scenarios are provably solvable.

**Acceptance Criteria:**
1. **Condition 1 — Host IP valid:** Source has an IP, mask, and gateway configured. Failure → "No IP configuration on source."
2. **Condition 2 — Access VLAN path:** Source port is in a VLAN that has a valid L2 path to the destination (same switch or trunked). Failure → "Source not in correct VLAN" or "No L2 path."
3. **Condition 3 — Trunk carries VLAN:** If the path crosses a trunk, the destination VLAN must be in the trunk's allowed list. Failure → "VLAN not allowed on trunk."
4. **Condition 4 — L3 routing:** If source and destination are in different subnets, routing must be enabled, relevant SVIs/interfaces must be up, and a route to the destination subnet must exist. Failure → "Routing disabled," "SVI down," or "No route to destination."
5. **Condition 5 — Firewall policy:** If the path crosses a firewall, a policy must permit src→dst traffic, and any required NAT must be configured. Failure → "Blocked by firewall policy" or "NAT misconfigured."
6. **Condition 6 — AWS cloud path:** For `ec2` / `vpc-router` devices, the VPC route table must have an active route to the destination, the security group must allow the traffic (stateful), and the NACL must allow it (stateless, evaluated in both directions). Failure → "No route in route table," "Blocked by security group," or "Blocked by NACL."
7. **Condition 7 — Host firewall:** For OS-level hosts (Linux `iptables`, Docker, Windows Firewall), the host's local firewall must permit the traffic — the relevant chain policy/rule (e.g. iptables `INPUT`/`FORWARD`, a Windows inbound rule) must allow it. Failure → "Blocked by iptables," "INPUT/FORWARD chain policy is DROP," or "Blocked by Windows Firewall."
8. Each scenario's injected fault disables exactly ONE condition; fixing that condition satisfies the win condition.

---

### US-6: Scenario Data Format

**As a** content author,
**I want to** define scenarios as structured data files,
**so that** new scenarios can be added without code changes.

**Acceptance Criteria:**
1. Scenarios are defined in JSON files under `scenarios/` (eleven ship today: five switching/routing/firewall, three AWS cloud, and three OS-level host firewall — Linux iptables, Docker, Windows).
2. Each scenario file contains: `id`, `title`, `difficulty`, `topology` (devices + links), `injected_fault`, `ticket`, `win_condition`, and `reference_solution`.
3. The `topology` field defines devices (with interfaces, routing config, firewall policies) and links between interfaces.
4. The `injected_fault` field specifies the state delta applied at load (what breaks the network).
5. The `win_condition` is a reachability assertion: `{source, destination, expected: "success"}`.
6. The `reference_solution` is an ordered list of CLI commands that fix the fault.
7. The engine can load any valid scenario file and initialize game state from it.

---

### US-7: MCP Server — Simulation API

**As a** Kiro validation agent (or external tool),
**I want to** interact with the simulation via MCP tools,
**so that** I can programmatically play and validate scenarios.

**Acceptance Criteria:**
1. `get_topology()` returns the current device/link/state summary as structured data.
2. `get_ticket()` returns the current scenario's ticket (title, symptom, affected hosts).
3. `run_command(device, command)` executes a CLI command on a device and returns the output string. State mutations apply immediately.
4. `check_win_condition()` returns `{resolved: boolean, details: string}`.
5. `reset_scenario()` reloads the current scenario to its initial (broken) state.
6. `load_scenario(id)` loads a specific scenario by ID.
7. The MCP server imports the shared engine — no duplicated logic.

---

### US-8: Validation Agent

**As a** content author,
**I want** an automated agent to verify each scenario is solvable,
**so that** broken or misleading scenarios are caught before they reach players.

**Acceptance Criteria:**
1. The validation agent loads a scenario via the MCP server.
2. It executes the `reference_solution` commands in order.
3. After executing all steps, it calls `check_win_condition()`.
4. **Pass:** win condition returns `resolved: true`.
5. **Fail:** win condition returns `resolved: false` — agent reports which step failed and why.
6. The agent also verifies the scenario is **fair**, reporting one of the verdicts `already-solved` | `unsolvable` | `symptom-mismatch` | `unintended-solution`: (a) the fault is present at start (initial `check_win_condition()` returns false); (b) the ticket has a symptom and the win-condition source is one of its `affected_hosts`; (c) read-only investigation does not resolve the win; and (d) the fix is deterministic.
7. Results are reported as structured output (pass/fail + verdict + details).

---

### US-9: On-Save Hook

**As a** content author,
**I want** scenario validation to run automatically when I save a scenario file,
**so that** I get immediate feedback on correctness.

**Acceptance Criteria:**
1. A file-watcher monitors `scenarios/*.json`.
2. On change, it spawns the validation agent against the modified scenario.
3. Results are printed to the console (or a notification): "✓ Scenario X solvable in N steps" or "✗ Scenario X: <failure reason>."
4. The hook exits with code 0 on pass, non-zero on fail.

---

### US-10: Topology Diagram Updates

**As a** player,
**I want** the network diagram to update in real time as I make changes,
**so that** I get visual feedback on my progress.

**Acceptance Criteria:**
1. The topology view renders devices as labeled nodes and links as colored edges.
2. Red edges indicate broken reachability on that segment; green indicates healthy.
3. When a config change restores reachability on a link, it transitions from red to green within 500ms.
4. Device nodes show their hostname; hovering shows IP/interface summary.

---

## Non-Functional Requirements

| ID | Requirement | Criterion |
|----|-------------|-----------|
| NFR-1 | Performance | CLI commands respond in < 100ms; reachability evaluation in < 50ms for ≤ 20 devices. |
| NFR-2 | Browser support | Works in latest Chrome, Firefox, and Safari. |
| NFR-3 | No external dependencies at runtime | The web app is a static Vite build that runs the shared engine client-side — no backend API, no sessions, and no CDN or cloud call at runtime (React and all assets are bundled). |
| NFR-4 | Single-language stack | Engine, React web app, MCP server, validator, and hooks are all TypeScript, in an npm-workspaces monorepo built with `tsc -b` (engine/tools) and Vite (web). |
| NFR-5 | Determinism | Given the same scenario and commands, the engine always produces identical results (the engine is pure — no clock, no randomness, no I/O). |
| NFR-6 | Extensibility | Adding a scenario requires only a new YAML file under `scenarios/` (and optionally new CLI commands); the on-save hook and CI gate validate it automatically. The same YAML is bundled into the web app via `import.meta.glob`. |
