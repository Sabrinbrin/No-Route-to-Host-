# No Route to Host

**A diagnostic-training platform for network engineers, where Kiro validates every scenario before a student ever sees it.**

You're the on-call engineer. A broken network, a vague ticket, a ticking clock. Diagnose it through a real vendor CLI. Fix the one misconfiguration. Beat the clock.

The twist: **Kiro plays every scenario first** — driving the simulation through a self-built MCP server — to prove it's solvable and fair. Authoring a broken lab fails loudly and immediately.

---

## 30-Second Demo

<p align="center">
  <img src="docs/demo-gameplay.gif" alt="Gameplay: diagnose wrong VLAN, fix, ticket resolved" width="720" />
</p>

> **Play loop:** Pick up a ticket → investigate with `show vlan brief` → spot the wrong VLAN → fix with `sw acc vlan 10` → link goes green → ticket resolved.

---

## Demo Evidence: Kiro Validates via MCP

### On-save hook: break a scenario → instant FAIL

```bash
$ node packages/hooks/dist/index.js scenarios/01-wrong-access-vlan.yaml
  ✓ Wrong Access VLAN (wrong-access-vlan) — Solvable in 4 steps.

# Now break the reference solution (change vlan 10 → vlan 99):
$ node packages/hooks/dist/index.js scenarios/01-wrong-access-vlan.yaml
  ✗ Wrong Access VLAN (wrong-access-vlan) — FAIL unsolvable: Win not met after reference solution

# Fix it back:
$ node packages/hooks/dist/index.js scenarios/01-wrong-access-vlan.yaml
  ✓ Wrong Access VLAN (wrong-access-vlan) — Solvable in 4 steps.
```

<p align="center">
  <img src="docs/demo-onsave-hook.gif" alt="On-save hook: break scenario → FAIL, fix → PASS" width="720" />
</p>

### MCP agent plays the game (validate_scenario tool)

```bash
$ echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"validate_scenario","arguments":{"id":"wrong-access-vlan"}}}
' | node packages/mcp-server/dist/index.js 2>/dev/null

# Response:
{
  "scenarioId": "wrong-access-vlan",
  "passed": true,
  "verdict": "PASS",
  "steps": 4,
  "details": "Solvable in 4 steps, fair."
}
```

<p align="center">
  <img src="docs/demo-mcp-validate.gif" alt="MCP server: agent calls validate_scenario tool" width="720" />
</p>

> **How to record these GIFs yourself:**
> ```bash
> # Install asciinema + agg (or use ttyrec/terminalizer)
> asciinema rec demo.cast
> # Run the commands above
> # Ctrl+D to stop, then convert:
> agg demo.cast demo.gif
> ```
> Place GIFs in `docs/` and they'll render in the README.

---

## Quick Start

An npm-workspaces monorepo. The game is a static React app that runs the
shared engine **client-side** — no backend needed to play.

```bash
git clone https://github.com/Sabrinbrin/No-Route-to-Host-.git
cd No-Route-to-Host-
npm install

# Play the game (Vite dev server)
npm run dev                 # open the printed http://localhost:5173

# Or build once and preview the static bundle
npm run build && npm run preview   # http://localhost:8080

# Or use Docker
docker build -t nrth .
docker run -p 8080:8080 nrth
```

### Other commands

```bash
npm test                    # engine unit tests (44)
npm run validate            # validate all 11 scenarios (solvable + fair)
npm run watch:scenarios     # on-save hook (re-validates YAML on change)
npm run mcp                 # MCP server (stdio) for the Kiro agent
```

---

## The Problem

Junior network engineers learn config syntax from labs, but rarely practise the **actual job**: reading a vague symptom, forming a hypothesis, and hunting one misconfiguration in a working-looking network. Existing tools (Packet Tracer, GNS3) simulate the wire — they don't gamify the diagnostic loop or grade you.

And for instructors: building fair diagnostic exercises by hand is slow and error-prone. It's easy to ship a scenario that's unsolvable, has an unintended shortcut, or whose symptom doesn't match the injected fault.

**No Route to Host** solves both:
- A gradeable trainer for the diagnostic loop (student)
- An authoring tool that **guarantees** each scenario is solvable and fair before release (instructor)

---

## 11 Scenarios

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
| 9 | Linux iptables Blocking Inbound | OS Host | ★★★☆☆ | INPUT chain policy DROP |
| 10 | Docker Container Unreachable | OS Host | ★★★★☆ | iptables FORWARD blocked |
| 11 | Windows Firewall Blocking ICMP | OS Host | ★★★☆☆ | No inbound allow rule |

Every scenario is **agent-verified solvable & fair** before it reaches the player.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│         Browser — React + Vite + xterm.js        │
│  Terminal + Topology + Ticket + Author Studio    │
│      imports the engine → runs client-side        │
└──────────────────────┬──────────────────────────┘
                       │  (no backend — static app)
┌──────────────────────▼──────────────────────────┐
│      @nrth/engine (pure, browser-safe, TS)       │
│  State Model + Reachability (7 conds) + CLI       │
└──────────┬───────────┬───────────┬──────────────┘
           │           │           │
      MCP Server   Validator   On-Save Hook
      (MCP SDK)    (CI gate)   (file watcher)
```

**One shared engine** (`@nrth/engine`) — the web app, MCP server, validator, and hook all import the same package. Zero logic duplication.

---

## The Kiro-Native Mechanic

This project demonstrates Kiro's full capability stack working together:

### MCP Server (official SDK)
7 tools on `@modelcontextprotocol/sdk` (stdio transport): `list_scenarios`, `load_scenario`, `get_topology`, `get_ticket`, `run_command`, `check_win_condition`, `reset_scenario`.

```json
{
  "mcpServers": {
    "no-route-to-host": {
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"],
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
npm run watch:scenarios
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
├── scenarios/           # 11 scenario data files (YAML)
├── packages/
│   ├── engine/          # @nrth/engine — shared engine (pure, browser-safe) + tests
│   ├── frontend/        # React + Vite + xterm.js web app (client-side engine)
│   ├── mcp-server/      # MCP server on @modelcontextprotocol/sdk (stdio)
│   ├── validator/       # CI solvable + fair gate
│   └── hooks/           # On-save YAML scenario watcher
├── Dockerfile           # Builds the web app, serves the static bundle
├── package.json         # npm workspaces
├── tsconfig.base.json
└── tsconfig.json        # solution (project references)
```

---

## Tech Stack

- **TypeScript** end-to-end, in an **npm-workspaces monorepo**
- **React 18 + Vite + xterm.js** web app — runs the engine client-side (no backend)
- **@nrth/engine** — pure, deterministic, browser-safe simulation engine
- **@modelcontextprotocol/sdk** — the MCP server (stdio)
- **YAML** scenario data (`js-yaml`)
- **Docker** for deployment

---

## License

MIT

---

Built by [@Sabrinbrin](https://github.com/Sabrinbrin) with [Kiro](https://kiro.dev)
