# No Route to Host — Project Brief (v3)

> **For Kiro:** Use this as the seed for a spec-driven build. Generate a real
> `requirements.md` (user stories + testable acceptance criteria), `design.md`
> (components, data flow, decisions), and `tasks.md` from it. This document is the
> input to the spec, not the spec. Build against the spec you generate, and let task
> progress and commits show the spec guiding the build.

## What this is

A diagnostic-training platform for network engineering, delivered as a troubleshooting
game. A student is dropped into a broken network with a symptom ticket and a ticking
clock; they diagnose it through a simulated vendor CLI and fix it by configuring the
devices. **The platform's core feature is authoring:** an instructor writes a
broken-network scenario as data, hits save, and Kiro — driving the simulation through a
custom MCP server — verifies the scenario is solvable and fair *before it reaches a
student*.

The game is the delivery mechanism. The authoring-plus-validation loop is the product.

## Who it's for (two users, both real)

- **Student / player:** a junior network engineer or student who knows config syntax but
  has never practised the actual job — reading a vague symptom, forming a hypothesis, and
  hunting one misconfiguration in a working-looking network.
- **Instructor / author:** a lecturer or lab designer who needs to ship gradeable
  diagnostic labs without hand-verifying each one. They author a scenario; the platform
  proves it works.

## Problem worth solving

Labs (Packet Tracer, GNS3) simulate the wire but don't teach or grade the diagnostic
loop, and building fair diagnostic exercises by hand is slow and error-prone — it's easy
to ship a scenario that's unsolvable, has an unintended second solution, or whose symptom
doesn't match the injected fault. This targets both gaps: a gradeable trainer for the
diagnostic loop, and an authoring tool that guarantees each scenario is solvable and fair
before release.

## The Kiro-native core

Scenarios are data. A **self-built MCP server** wraps the simulation engine and exposes:

- `get_topology()` — devices, links, current state
- `get_ticket()` — the scenario's symptom briefing
- `run_command(device, command)` — execute a CLI command; mutates or reads state
- `check_win_condition()` — is the target reachability restored?
- `reset_scenario()`

A **Kiro validation agent** uses these tools to *play* a scenario on save: it reads the
ticket, runs the author's reference solution, and asserts the win condition is reached. It
also checks the scenario is fair — the fault is fixable, the ticket's symptom matches the
injected fault, and there's no trivial unintended fix. A **steering file**
(`.kiro/steering/networking-trainer.md`, `inclusion: always`) encodes the conventions the
agent must follow (CLI grammar, what "solvable" and "fair" mean, how to report failures).

An **on-save hook** runs this validation automatically whenever a scenario file changes,
so authoring a broken scenario fails loudly and immediately.

## Two loops

**Play loop (student):** pick up ticket -> investigate with `show` / `ping` -> hypothesise
-> apply config -> win-condition check -> post-scenario debrief.

**Author loop (instructor):** write a scenario file -> save -> on-save hook fires ->
validation agent plays it via MCP -> pass ("solvable in N steps, fair") or fail
("unsolvable / symptom mismatch / unintended solution") -> fix and re-save.

## Architecture

**Shared engine (single source of truth).** One library module imported by the game
backend, the MCP server, AND the CI test suite. No duplicated logic.

**State model — the world is data, not a live network.**
`devices[]` -> `interfaces[]` (vlan, ip, mask, status, trunk_allowed_vlans, mode),
`routing` (enabled flag, routes[], svis[]); firewalls add `policies[]` + `nat[]`.

**Reachability as constraint evaluation — NOT packet forwarding.** `ping(src, dst)`
succeeds only if an ordered chain of conditions all hold (5 conditions implemented,
6th reserved for cloud bonus).

**CLI + realistic `show` output.** IOS-style abbreviations supported (any unambiguous
prefix). Curated subset of IOS / FortiOS commands.

**Scenario format (JSON).** `id`, `title`, `difficulty`, `topology`, `injected_fault`,
`ticket`, `win_condition`, `reference_solution`.

## Scenario set

1. Wrong access VLAN (Starter)
2. Trunk allowed-list gap (Core)
3. Inter-VLAN routing down (Core)
4. Missing default route (Core)
5. Tunnel up, traffic blackholed (Finale / Firewall)

## Category targeting

- **Best Overall (primary):** problem worth solving, working end-to-end demo, coherent
  execution, genuine Kiro use, clear story.
- **Most Creative Use of Kiro:** the tool authors and QAs its own training game by playing
  it.
- **Best Kiro Power-User:** self-built MCP + agent + steering + on-save hook, all central.
- **Best Spec-Driven Build:** real spec generated from this brief; commits show it guided
  the build.
- **Most Practical Solution:** instructor authoring flow, plus CI gate guaranteeing fair
  labs.
