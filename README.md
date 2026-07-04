# No Route to Host

A browser-based troubleshooting game where the player is the on-call network engineer:
you're handed a broken network and a symptom ticket, you diagnose it through a simulated
CLI, and you fix it by configuring the devices — against a ticking clock.

## The Kiro-Native Mechanic

The game engine is exposed through a **self-built MCP server**. A Kiro validation agent
drives the simulation through MCP tools to prove each scenario is solvable. An on-save
hook fires automatically when scenario files change — authoring a broken scenario fails
loudly and immediately.

## Quick Start

```bash
# Build the project
tsc -p tsconfig.json

# Start the game server
node dist/server/index.js
# Open http://localhost:3000

# Validate all scenarios
node dist/validator/index.js

# Watch scenarios for changes (on-save hook)
node dist/hooks/index.js --watch

# Start the MCP server (for Kiro agent)
node dist/mcp-server/index.js
```

## Architecture

```
┌─────────────────────────────────────────────┐
│         Browser (Vanilla HTML/JS)            │
│  Terminal + SVG Topology + Ticket Panel      │
└──────────────────┬──────────────────────────┘
                   │ HTTP API
┌──────────────────▼──────────────────────────┐
│         HTTP Server (Node.js)                │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│       Shared Network Engine                  │
│  (State Model + Reachability + CLI Parser)   │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   MCP Server  Validator   On-Save Hook
   (stdio)     (direct)    (file watcher)
```

**Single shared engine** — both the game and the MCP server import the same module.
No duplicated logic.

## Scenarios

| # | Title | Difficulty | Fix |
|---|-------|-----------|-----|
| 1 | Wrong Access VLAN | ★☆☆☆☆ | Correct port VLAN assignment |
| 2 | Trunk Allowed-List Gap | ★★☆☆☆ | Add VLAN to trunk allowed list |
| 3 | Inter-VLAN Routing Down | ★★☆☆☆ | Enable SVI / no shutdown |
| 4 | Missing Default Route | ★★★☆☆ | Add default static route |
| 5 | Firewall Tunnel Blackhole | ★★★★☆ | Add firewall permit policy |

## MCP Server Tools

| Tool | Description |
|------|-------------|
| `list_scenarios` | Get all available scenario IDs |
| `load_scenario` | Load a scenario by ID |
| `get_topology` | Get current network state |
| `get_ticket` | Get the trouble ticket |
| `run_command` | Execute a CLI command on a device |
| `check_win_condition` | Check if the issue is resolved |
| `reset_scenario` | Reset to initial broken state |

### MCP Configuration

```json
{
  "mcpServers": {
    "no-route-to-host": {
      "command": "node",
      "args": ["dist/mcp-server/index.js"],
      "cwd": "/path/to/No-Route-to-Host-"
    }
  }
}
```

## CLI Commands

The simulated CLI supports a curated subset of IOS/FortiOS commands:

- `show interfaces` / `show ip route` / `show vlan brief` / `show running-config`
- `ping <ip>`
- `configure terminal` → `interface <name>` → config commands → `end`
- `switchport access vlan <id>` / `switchport trunk allowed vlan add <id>`
- `ip routing` / `ip route <network> <mask> <next-hop>`
- `no shutdown` / `shutdown`
- `set firewall policy <src> <dst> permit|deny`

## Adding New Scenarios

1. Create a JSON file in `scenarios/` following the schema.
2. Define: `topology`, `injected_fault`, `ticket`, `win_condition`, `reference_solution`.
3. Save — the on-save hook validates automatically.
4. The validator confirms the scenario is solvable before it reaches players.

## Project Structure

```
├── .kiro/
│   ├── specs/          # Requirements, design, and task specs
│   └── steering/       # Validation agent steering file
├── public/             # Frontend (self-contained HTML/JS)
├── scenarios/          # Scenario data files (JSON)
├── src/
│   ├── engine/         # Shared network simulation engine
│   ├── mcp-server/     # MCP server (stdio transport)
│   ├── server/         # HTTP game server
│   ├── validator/      # Scenario validation script
│   └── hooks/          # On-save file watcher
├── package.json
└── tsconfig.json
```

## Tech Stack

- **TypeScript** end-to-end (zero external dependencies)
- **Node.js** HTTP server + MCP stdio server
- **Vanilla HTML/CSS/JS** frontend (no framework, no bundler)
- **JSON** scenario data format
- **MCP Protocol** (JSON-RPC 2.0 over stdio)

## License

MIT

---

Created by [@Sabrinbrin](https://github.com/Sabrinbrin)
