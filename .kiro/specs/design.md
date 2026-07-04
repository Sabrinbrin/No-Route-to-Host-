# Design — No Route to Host

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│              Browser (DC Framework UI)                        │
│  Landing · Dashboard · Play (Terminal + Topology + Ticket)    │
│  Debrief (Score + Diagnostic Path) · Author Studio           │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP JSON API
┌──────────────────────────▼──────────────────────────────────┐
│              Game Server  (src/server/index.ts)               │
│  POST /api/load, /api/command, /api/check, /api/reset        │
│  POST /api/validate  ·  GET /api/scenarios  ·  GET /health   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│         Shared Network Engine  (src/engine/)                  │
│  types.ts · utils.ts · reachability.ts · cli-parser.ts       │
│  scenario-loader.ts · index.ts                               │
└───────────┬──────────────┬──────────────┬───────────────────┘
            │              │              │
   MCP Server         Validator       On-Save Hook
   (src/mcp-server/)  (src/validator/) (src/hooks/)
   stdio transport    direct import    file watcher
```

**Single shared engine module** — the game server, MCP server, validator, and on-save
hook all import `src/engine/`. No logic is duplicated anywhere.

---

## Component Design

### 1. Shared Network Engine (`src/engine/`)

The single source of truth for all network simulation logic.

#### State Model (`types.ts`)

```typescript
interface NetworkState {
  devices: Device[];
  links: Link[];
}

interface Device {
  id: string;
  hostname: string;
  type: 'switch' | 'router' | 'firewall' | 'host' | 'ec2' | 'vpc-router';
  interfaces: NetworkInterface[];
  routing: RoutingConfig;
  firewallPolicies?: FirewallPolicy[];
  aws?: AWSConfig;  // Security groups, NACLs, route tables, VPC peerings
}
```

#### Reachability Evaluator (`reachability.ts`)

Constraint-based, NOT packet simulation. `evaluatePing(state, src, dst)` checks 6
ordered conditions:

| # | Condition | Failure Example |
|---|-----------|-----------------|
| 1 | Source IP/mask/gateway valid | "No IP configuration on source" |
| 2 | Access VLAN path exists | "Source not in correct VLAN" |
| 3 | Trunk carries VLAN | "VLAN 30 not allowed on trunk" |
| 4 | L3 routing (enabled, SVI up, route exists) | "No route to destination" |
| 5 | Firewall policy permits | "Blocked by firewall — no permit policy" |
| 6 | AWS (SG allows, NACL allows, route table) | "Blocked by security group — no inbound ICMP rule" |

Each scenario disables exactly ONE condition. The fix re-satisfies exactly that one.

#### CLI Parser (`cli-parser.ts`)

- IOS-style abbreviation support via `abbr()` helper (any unambiguous prefix)
- Mode state machine: exec → config → config-if
- Vendor-flavoured: IOS for switches/routers, FortiOS for firewalls, AWS CLI for EC2
- Only implements commands the scenarios actually need

#### Scenario Loader (`scenario-loader.ts`)

- Parses JSON scenario files
- Applies `injected_fault` to create the broken initial state
- `checkWinCondition()` evaluates the reachability assertion

### 2. MCP Server (`src/mcp-server/index.ts`)

JSON-RPC 2.0 over stdio transport. Implements the MCP protocol directly (zero
dependencies). Exposes 7 tools:

| Tool | Parameters | Returns |
|------|-----------|---------|
| `list_scenarios` | — | `[{id, title, difficulty}]` |
| `load_scenario` | `{id}` | `{success, title}` |
| `get_topology` | — | Full device/link state |
| `get_ticket` | — | `{title, symptom, affected_hosts}` |
| `run_command` | `{device, command}` | `{output, stateChanged}` |
| `check_win_condition` | — | `{resolved, details}` |
| `reset_scenario` | — | `{success}` |

### 3. Game Server (`src/server/index.ts`)

HTTP server (Node.js `http` module, zero dependencies) providing:

- **JSON API** — `/api/load`, `/api/command`, `/api/check`, `/api/reset`, `/api/validate`, `/api/state`, `/api/scenarios`
- **Static serving** — DC HTML UI at `/`, `support.js` from `src/`
- **Health endpoint** — `GET /health` returns status + scenario count + uptime
- **Error handling** — 400 (bad JSON), 405 (wrong method), 413 (body too large), 500 (internal)
- **PORT env variable** — configurable deployment port

### 4. Frontend (`src/No Route to Host.dc.html` + `src/support.js`)

Built with the DC Framework (custom reactive component system):

- **Landing page** — Product pitch, feature cards, demo terminal mockup
- **Dashboard** — Scenario cards with difficulty, tags, real data from `/api/scenarios`
- **Play screen** — Split layout: terminal (left) + sidebar (ticket + topology + hints)
- **Debrief** — Score breakdown, diagnostic path, grade (A–D)
- **Author studio** — YAML editor with break modes + real-time validation agent panel

All state is managed in a single `Component` class with `this.state` + `this.setState()`.
API calls are async; UI re-renders on state change.

### 5. Validation Agent (`src/validator/index.ts`)

Configured in `.kiro/agents/scenario-validator.md`. Validates scenarios by:

1. Loading scenario → asserting fault present (win=false)
2. Executing reference solution commands
3. Asserting fix works (win=true)
4. Checking fairness (symptom matches fault)

### 6. On-Save Hook (`src/hooks/index.ts`)

Configured in `.kiro/hooks/on-save-validate.md`. Three modes:

- **Single file** — `node dist/hooks/index.js <file>` (on-save trigger)
- **Validate all** — `node dist/hooks/index.js` (CI gate)
- **Watch mode** — `node dist/hooks/index.js --watch` (polls every 1s)

---

## Data Flow

### Player Game Loop
```
Player types command → Terminal captures input
  → POST /api/command {device, command}
  → Server routes to Engine.executeCommand()
  → Engine mutates state + re-evaluates reachability
  → Server returns {output, stateChanged, winCheck, context}
  → UI updates: terminal output, prompt mode, topology colors
  → If winCheck.resolved → show victory → navigate to debrief
```

### Author Validation Loop
```
Author clicks Save → POST /api/validate {id}
  → Server loads scenario, asserts broken
  → Executes reference_solution via engine
  → Asserts fixed, checks fairness
  → Returns {passed, verdict, steps[]}
  → UI streams steps with animation (500ms per step)
  → Final verdict: PASS (green) or FAIL (red) with details
```

### On-Save Hook Loop
```
File saved → Hook detects change (1s poll)
  → Parse JSON → Validate schema
  → Load scenario into engine → Assert broken
  → Execute reference_solution → Assert fixed
  → Print ✓/✗ to console
  → Exit code 0 (pass) or 1 (fail)
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Constraint-based reachability (not packet sim) | Deterministic, fast, provably solvable; avoids complexity of real forwarding |
| Single shared engine module | Eliminates logic drift between game, MCP server, and CI |
| JSON scenario files | Human-readable, easy to author, good for version control diffs |
| TypeScript end-to-end | One language; engine runs identically in all contexts |
| Zero npm dependencies | Works in any Node.js 18+ environment without network access |
| IOS-style abbreviations | Authenticity — feels like the real CLI |
| 6-condition model (extensible) | Covers traditional networking + cloud; new domains add conditions |
| MCP over stdio | Standard transport, works with Kiro tooling out of the box |
| Polling file watcher (not chokidar) | Zero dependencies; good enough for authoring workflow |
| DC Framework for frontend | Pre-existing UI kit; no React/bundler needed |
| Multi-stage Dockerfile | Minimal runtime image; one-command deploy |

---

## Folder Structure

```
No-Route-to-Host-/
├── .kiro/
│   ├── agents/
│   │   └── scenario-validator.md     # Agent config
│   ├── hooks/
│   │   └── on-save-validate.md       # Hook config
│   ├── specs/
│   │   ├── brief.md                  # Project brief (input to spec)
│   │   ├── requirements.md           # User stories + acceptance criteria
│   │   ├── design.md                 # This file
│   │   └── tasks.md                  # Implementation tasks (all ✅)
│   └── steering/
│       └── networking-trainer.md     # Agent behaviour rules
├── scenarios/                         # 8 scenario data files
│   ├── 01-wrong-access-vlan.json
│   ├── 02-trunk-allowed-list.json
│   ├── 03-inter-vlan-routing.json
│   ├── 04-missing-default-route.json
│   ├── 05-firewall-tunnel.json
│   ├── 06-aws-security-group.json
│   ├── 07-aws-route-table.json
│   └── 08-aws-nacl-deny.json
├── src/
│   ├── engine/                        # Shared simulation engine
│   │   ├── types.ts                   # State model + AWS types
│   │   ├── utils.ts                   # IP math, device lookups
│   │   ├── reachability.ts            # 6-condition ping evaluator
│   │   ├── cli-parser.ts             # Command parsing + execution
│   │   ├── scenario-loader.ts        # JSON loader + fault injection
│   │   └── index.ts                   # Re-exports
│   ├── mcp-server/
│   │   └── index.ts                   # MCP server (stdio, JSON-RPC 2.0)
│   ├── server/
│   │   └── index.ts                   # HTTP game server + API
│   ├── validator/
│   │   └── index.ts                   # Standalone validation script
│   ├── hooks/
│   │   └── index.ts                   # On-save file watcher
│   ├── No Route to Host.dc.html      # Frontend UI (DC Framework)
│   ├── support.js                     # DC runtime library
│   └── node.d.ts                      # Minimal Node.js type declarations
├── AUTHORING.md                       # How to create new scenarios
├── Dockerfile                         # Multi-stage production build
├── .dockerignore
├── package.json
├── tsconfig.json
└── README.md
```
