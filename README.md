# No Route to Host

**A diagnostic-training platform for network engineers, where Kiro validates every scenario before a student ever sees it.**

You're the on-call engineer. A broken network, a vague ticket, a ticking clock. Diagnose it through a real vendor CLI. Fix the one misconfiguration. Beat the clock.

The twist: **Kiro plays every scenario first** — driving the simulation through a self-built MCP server — to prove it's solvable and fair. Authoring a broken lab fails loudly and immediately.

---

## 30-Second Demo

```
SW1# sh vlan brief
VLAN  Name       Status  Ports
───────────────────────────────────────────────────────
10    VLAN10     active  Gi0/2
20    VLAN20     active  Gi0/1    ← Host A is here? Wrong VLAN!

SW1# conf t
SW1(config)# int Gi0/1
SW1(config-if)# sw acc vlan 10
% Access VLAN set to 10.
SW1(config-if)# end
SW1# ping 10.0.10.1
!!!!!  Success rate is 100 percent (5/5)

✓ Ticket resolved. Grade: A. Time: 47s.
```

Then open a scenario file, break the reference solution, save — the on-save hook fires, the agent reports "FAIL: unsolvable." Fix it, save, "PASS: solvable in 4 steps."

---

## Quick Start

```bash
# Clone and build
git clone https://github.com/Sabrinbrin/No-Route-to-Host-.git
cd No-Route-to-Host-
tsc -p tsconfig.json

# Play the game
PORT=8080 node dist/server/index.js
# Open http://localhost:8080

# Or use Docker
docker build -t nrth .
docker run -p 8080:3000 nrth
```

### Other commands

```bash
node dist/validator/index.js         # Validate all 8 scenarios
node dist/hooks/index.js --watch     # Watch mode (on-save hook)
node dist/mcp-server/index.js        # Start MCP server for Kiro agent
```

---

## The Problem

Junior network engineers learn config syntax from labs, but rarely practise the **actual job**: reading a vague symptom, forming a hypothesis, and hunting one misconfiguration in a working-looking network. Existing tools (Packet Tracer, GNS3) simulate the wire — they don't gamify the diagnostic loop or grade you.

And for instructors: building fair diagnostic exercises by hand is slow and error-prone. It's easy to ship a scenario that's unsolvable, has an unintended shortcut, or whose symptom doesn't match the injected fault.

**No Route to Host** solves both:
- A gradeable trainer for the diagnostic loop (student)
- An authoring tool that **guarantees** each scenario is solvable and fair before release (instructor)

---

## 8 Scenarios

| # | Title | Domain | Difficulty | Fault |
|---|-------|--------|-----------|-------|
| 1 | Wrong Access VLAN | Switching | ★☆☆☆☆ | Port in wrong VLAN |
| 2 | Trunk Allowed-List Gap | Switching | ★★☆☆☆ | VLAN not allowed on trunk |
| 3 | Inter-VLAN Routing Down | Routing | ★★☆☆☆ | SVI shutdown |
| 4 | Missing Default Route | Routing | ★★★☆☆ | No default route |
| 5 | Tunnel Up, Traffic Blackholed | Firewall/VPN | ★★★★☆ | Missing permit policy |
| 6 | EC2 Security Group Blocking | AWS Cloud | ★★★☆☆ | SG missing ICMP rule |
| 7 | VPC Peering Route Missing | AWS Cloud | ★★★★☆ | Route table has no peering route |
| 8 | NACL Blocking Traffic | AWS Cloud | ★★★★☆ | NACL missing allow entry |

Every scenario is **agent-verified solvable** before it reaches the player.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Browser (DC Framework)              │
│  Terminal + Topology + Ticket + Scoring          │
└──────────────────────┬──────────────────────────┘
                       │ HTTP JSON API
┌──────────────────────▼──────────────────────────┐
│              Game Server (Node.js)               │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│         Shared Network Engine (TypeScript)       │
│  State Model + Reachability Evaluator + CLI      │
└──────────┬───────────┬───────────┬──────────────┘
           │           │           │
      MCP Server   Validator   On-Save Hook
      (stdio)      (direct)    (file watcher)
```

**One shared engine** — the game server, MCP server, validator, and hook all import the same module. Zero logic duplication.

---

## The Kiro-Native Mechanic

This project demonstrates Kiro's full capability stack working together:

### Self-Built MCP Server
7 tools over JSON-RPC 2.0 (stdio transport): `get_topology`, `get_ticket`, `run_command`, `check_win_condition`, `reset_scenario`, `load_scenario`, `list_scenarios`.

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

### Validation Agent + Steering
The agent follows `.kiro/steering/networking-trainer.md` to validate scenarios:
1. Load scenario → assert fault is present (win=false)
2. Execute reference solution via `run_command`
3. Assert fix works (win=true)
4. Check fairness (symptom matches fault, no unintended fix)

### On-Save Hook
```bash
node dist/hooks/index.js --watch
# Save a scenario file → instant validation feedback
# ✓ Wrong Access VLAN (wrong-access-vlan) — Solvable in 4 steps.
# ✗ Broken Scenario (broken) — FAIL: Reference solution does not fix it.
```

---

## CLI Commands

Real IOS/FortiOS/AWS CLI feel with abbreviation support:

| Short | Full | Effect |
|-------|------|--------|
| `sh ip int bri` | `show ip interface brief` | Interface summary |
| `sh vl br` | `show vlan brief` | VLAN-to-port map |
| `sh run` | `show running-config` | Full config |
| `conf t` | `configure terminal` | Enter config mode |
| `int Gi0/1` | `interface Gi0/1` | Select interface |
| `sw acc vlan 10` | `switchport access vlan 10` | Set access VLAN |
| `no shut` | `no shutdown` | Enable interface |
| `aws ec2 describe-security-groups` | — | Show SG rules |
| `aws ec2 authorize-security-group-ingress` | — | Add SG rule |
| `aws ec2 create-route` | — | Add VPC route |

---

## Adding New Scenarios

1. Create a JSON file in `scenarios/`
2. Define: `topology`, `injected_fault`, `ticket`, `win_condition`, `reference_solution`
3. Save → the on-save hook validates automatically
4. If it passes, it's guaranteed solvable and fair

See existing scenarios for the schema. Each scenario disables exactly **one** reachability condition; the fix re-satisfies exactly that one.

---

## Project Structure

```
├── .kiro/
│   ├── specs/           # Requirements, design, tasks (spec-driven build)
│   │   ├── requirements.md
│   │   ├── design.md
│   │   ├── tasks.md
│   │   └── brief.md
│   ├── steering/        # Agent behaviour rules
│   │   └── networking-trainer.md
│   └── hooks/           # On-save hook configuration
│       └── on-save-validate.md
├── scenarios/           # 8 scenario data files (JSON)
├── src/
│   ├── engine/          # Shared network simulation engine
│   ├── mcp-server/      # MCP server (stdio, JSON-RPC 2.0)
│   ├── server/          # HTTP game server
│   ├── validator/       # Scenario validation script
│   └── hooks/           # On-save file watcher
├── Dockerfile           # One-command deployment
├── package.json
└── tsconfig.json
```

---

## Tech Stack

- **TypeScript** end-to-end (zero external npm dependencies)
- **Node.js** HTTP server + MCP stdio server
- **DC Framework** for the frontend (custom reactive UI)
- **JSON** scenario data format
- **MCP Protocol** (JSON-RPC 2.0 over stdio)
- **Docker** for deployment

---

## License

MIT

---

Built by [@Sabrinbrin](https://github.com/Sabrinbrin) with [Kiro](https://kiro.dev)
