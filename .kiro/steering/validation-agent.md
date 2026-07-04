# Validation Agent Steering

This file guides the Kiro validation agent when testing scenarios via the MCP server.

## Purpose

The validation agent plays each scenario to prove it is **solvable** and has no dead ends.
It connects to the MCP server (or uses the engine directly) and executes a structured
validation flow.

## MCP Server Configuration

```json
{
  "mcpServers": {
    "no-route-to-host": {
      "command": "node",
      "args": ["dist/mcp-server/index.js"],
      "cwd": "<project-root>"
    }
  }
}
```

## Available Tools

| Tool | Purpose |
|------|---------|
| `list_scenarios` | Get all scenario IDs and titles |
| `load_scenario` | Load a scenario by ID (applies fault, initializes state) |
| `get_topology` | Inspect current device/interface/routing state |
| `get_ticket` | Read the trouble ticket (symptom, affected hosts) |
| `run_command` | Execute a CLI command on a device |
| `check_win_condition` | Test if the network fault is resolved |
| `reset_scenario` | Restart current scenario to broken state |

## Validation Flow

For each scenario, the agent MUST follow this sequence:

1. **Load** — Call `load_scenario({id})`.
2. **Assert broken** — Call `check_win_condition()`. It MUST return `resolved: false`.
   If it returns `true`, the fault was not injected correctly → **FAIL**.
3. **Read ticket** — Call `get_ticket()` to understand what symptom to investigate.
4. **Execute reference solution** — Run the commands from the scenario's `reference_solution`
   field using `run_command({device, command})` for each step in order.
5. **Assert fixed** — Call `check_win_condition()`. It MUST return `resolved: true`.
   If it returns `false`, the reference solution does not fix the fault → **FAIL**.
6. **Report** — Output structured result.

## CLI Grammar Rules

The agent should use only these command patterns:

### Exec Mode
- `show interfaces` — interface table
- `show ip route` — routing table
- `show vlan brief` — VLAN port mapping
- `show running-config` — full config
- `show ip int brief` — IP summary
- `show firewall` — firewall policies
- `ping <ip>` — test reachability

### Config Mode (enter via `configure terminal`)
- `interface <name>` — enter interface config
- `ip routing` — enable L3 routing
- `ip route <network> <mask> <next-hop>` — add static route
- `set firewall policy <src> <dst> permit|deny [interface <name>]`
- `end` — return to exec mode
- `exit` — go up one level

### Interface Config Mode
- `switchport access vlan <id>`
- `switchport trunk allowed vlan add <id>`
- `no shutdown`
- `shutdown`
- `ip address <ip> <mask>`
- `end` / `exit`

## Definition of "Solvable"

A scenario is **solvable** if and only if:
1. After loading, `check_win_condition()` returns `resolved: false` (fault is present).
2. After executing the `reference_solution` commands, `check_win_condition()` returns
   `resolved: true` (fault is fixed).
3. The ticket symptom text accurately describes the failure condition injected by the fault.

## Reporting Format

```
✓ <scenario-title> (<scenario-id>) — Solvable in N steps.
✗ <scenario-title> (<scenario-id>) — FAIL: <reason>
```

Reasons include:
- "Win condition already satisfied — fault not injected"
- "Win condition not met after reference solution — <details>"
- "Scenario file has invalid schema"

## Scenario File Schema

Each `.json` file in `scenarios/` must contain:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique scenario identifier |
| `title` | string | yes | Human-readable title |
| `difficulty` | number | yes | 1-5 difficulty rating |
| `topology.devices` | array | yes | Device definitions |
| `topology.links` | array | yes | Link definitions |
| `injected_fault` | object | yes | State delta that breaks the network |
| `ticket` | object | yes | Player-facing symptom info |
| `win_condition` | object | yes | Reachability assertion |
| `reference_solution` | array | yes | Steps that fix the fault |
| `layout` | object | no | SVG position hints for topology view |

## Conventions

- Always reset between scenario runs.
- Report results immediately — don't batch.
- If the MCP server is unreachable, exit with code 1 and message.
- The agent does NOT attempt creative solutions — it only verifies the `reference_solution`.
- Time limit: each scenario validation should complete in < 5 seconds.
