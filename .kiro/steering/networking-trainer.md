---
inclusion: always
---

# No Route to Host — Project Steering

> **Critical:** Kiro does NOT auto-load steering into *custom agents*. The validation agent
> is a custom agent, so its resources config MUST explicitly include `.kiro/steering/*.md`.
> If it doesn't, the agent will validate scenarios without these rules and the whole
> author-mode guarantee is void. Verify this before relying on the on-save hook.

## Product context

We build a network-engineering diagnostic trainer delivered as a troubleshooting game.
Two users: a **student** who diagnoses and fixes a broken network via a simulated CLI, and
an **instructor** who authors scenarios as data. The product's core is that Kiro validates
each authored scenario (solvable + fair) before it reaches a student. The game is the
delivery mechanism; the authoring-plus-validation loop is the product.

## Architecture invariants (non-negotiable)

- The engine is a **deterministic constraint-evaluator**, not a network simulator. Never
  introduce packet forwarding, routing-protocol convergence, timing, latency, or randomness.
- **Never** use real network stacks (FRR, VyOS, Open vSwitch, containerlab, GNS3) as the
  engine. If a task appears to need one, stop and flag it — the correct response is to
  extend the state model, not add a real stack.
- **One shared engine module** is the single source of truth, imported by the game backend,
  the MCP server, and the CI tests. Never duplicate reachability logic across them.
- **Production ships two images: `frontend` + `engine`.** The MCP server, validation agent,
  and on-save hook are the authoring/CI layer and must never be on the live player path.

## Engine contract (the reachability model)

`ping(src, dst)` returns success only if this ordered condition chain all holds:
1. Source host has valid IP / mask / gateway.
2. Source access port is in a VLAN with a valid path.
3. Same-subnet: destination VLAN is carried across all trunks on the path.
4. Different-subnet: L3 routing enabled, relevant SVIs/interfaces up, and a route to the
   destination subnet exists with a valid next-hop.
5. Firewall crossing: a policy permits src→dst and any required NAT is correct.
6. (Cloud bonus) AWS crossing: route table has a route to the destination, the security
   group allows it (stateful), and the NACL allows it (stateless, both directions).

Each scenario disables **exactly one** condition; the fix re-satisfies exactly that one.
Adding a device type means adding state fields and condition(s) — never a forwarding engine.

## CLI conventions

- Implement only the command subset the scenarios actually require. Do not build full vendor
  parsers.
- Accept IOS-style abbreviations (any unambiguous prefix): `sh` = `show`, `conf t` =
  `configure terminal`, `int` = `interface`, `sw acc vlan` = `switchport access vlan`, etc.
- Use vendor-flavoured syntax: IOS-style for switches/routers, FortiOS-style for the
  firewall, an AWS CLI subset for the cloud bonus.
- `show` / read output must look realistic — real column layouts and field names
  (`show vlan brief`, `show ip route`, `show interface trunk`, `aws ec2
  describe-route-tables`). Authenticity is the product's credibility; do not stub it.
- Never ship or reference proprietary vendor OS images. We emulate the CLI surface only.

## Scenario schema rules

- Fields: `id`, `title`, `difficulty`, `topology`, `injected_fault`, `ticket`,
  `win_condition`, `reference_solution`.
- Exactly one injected fault per scenario.
- `reference_solution` is the **minimal** correct fix, expressed as `run_command` steps.
- `win_condition` is a reachability assertion the engine can evaluate.
- Scenarios are data the app consumes. They are NOT the Kiro spec — never treat a scenario
  file as spec content.

## Validation definitions (the agent MUST use these exactly)

- **SOLVABLE:** applying `reference_solution` via `run_command` drives `check_win_condition`
  from false to true.
- **FAIR** — all four must hold:
  1. `win_condition` is false at scenario start (the fault actually breaks something).
  2. The ticket's symptom is genuinely caused by the injected fault (no symptom/fault
     mismatch).
  3. The fault is fixable within the implemented CLI subset.
  4. No trivial unintended solution (the win must not already be true, nor reachable by an
     obviously unrelated one-liner).
- **VERDICT format:** `PASS` with the step count, or `FAIL` with one category —
  `unsolvable` | `symptom-mismatch` | `unintended-solution` | `already-solved` — plus the
  specific offending detail.

## Agent behaviour rules

- Work the loop: plan → act **via MCP tools only** → verify against `check_win_condition`.
- Never assume device state; always read it through `get_topology` / `run_command`.
- **Never edit engine source, `reference_solution`, or `win_condition` to make validation
  pass.** If a scenario fails, report the failure — do not silently repair it.
- Do not invent commands the engine doesn't implement; if a needed command is missing, flag
  it as an engine/scenario gap rather than pretending it ran.

## MCP server tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `get_topology` | none | Full device/link state as JSON |
| `get_ticket` | none | `{title, symptom, affected_hosts}` |
| `run_command` | `{device, command}` | `{output, stateChanged}` |
| `check_win_condition` | none | `{resolved, details}` |
| `reset_scenario` | none | `{success}` |
| `load_scenario` | `{id}` | `{success, title}` |
| `list_scenarios` | none | `[{id, title, difficulty}]` |

### MCP server configuration

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

## Automation boundaries

- The **on-save hook + validation agent** check fairness/reasoning at authoring time. The
  **CI determinism gate** checks solvability at deploy time. Keep them as two distinct
  layers; do not collapse one into the other.
- Do not let the agent redesign the reachability model to satisfy a stubborn scenario. That
  is a human decision — escalate.

## Tech & coding conventions

- One language end to end (TypeScript) so the engine is shared unchanged across backend,
  MCP server, and CI.
- The engine is pure and dependency-light: no I/O, no clock, no randomness — so it runs
  identically in the backend, the MCP server, and CI.
- Every scenario must pass the CI determinism gate (fault → win=false; reference_solution →
  win=true) before merge.
- Nothing sensitive in git. Secrets live in `.env` (gitignored) and CI secret stores, never
  in source, compose files, or steering.

## Validation flow (step by step)

For each scenario, the validation agent MUST follow this sequence:

1. **Load** — Call `load_scenario({id})`.
2. **Assert broken** — Call `check_win_condition()`. It MUST return `resolved: false`.
   If it returns `true` → verdict: `FAIL already-solved`.
3. **Read ticket** — Call `get_ticket()` to understand the symptom.
4. **Execute reference solution** — Run commands from `reference_solution` using
   `run_command({device, command})` for each step in order.
5. **Assert fixed** — Call `check_win_condition()`. It MUST return `resolved: true`.
   If it returns `false` → verdict: `FAIL unsolvable`.
6. **Fairness checks** — Verify symptom matches fault; verify no trivial alternative fix.
7. **Report** — Output structured verdict.

## Reporting format

```
✓ <title> (<id>) — PASS: Solvable in N steps, fair.
✗ <title> (<id>) — FAIL unsolvable: <details>
✗ <title> (<id>) — FAIL symptom-mismatch: <details>
✗ <title> (<id>) — FAIL already-solved: <details>
```
