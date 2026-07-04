# Tasks — No Route to Host

Delivery plan, mapped to the phased commit history. Every phase was verified
(`tsc -b`, engine tests, validator, MCP smoke, browser run) before the next.

## Phase 0: Engine + scenarios (foundation) ✅

- [x] State model (`NetworkState`, `Device`, interfaces, routing, SVIs, links) — *US-6*
- [x] AWS cloud types (`SecurityGroup`, `NACL`, `RouteTable`, `AWSConfig`) and OS types (`OSConfig`, `iptables`, `windowsFirewall`)
- [x] `evaluatePing` — ordered 7-condition reachability chain — *US-5, Conditions 1–7*
- [x] CLI parser: IOS subset + abbreviations, `aws ec2 *`, `iptables`, PowerShell firewall — *US-2, US-3*
- [x] `loadScenario` / `checkWinCondition` / fault injection
- [x] 11 scenarios: 5 switching/routing/firewall + 3 AWS + 3 OS host-firewall

## Phase 1: npm workspaces monorepo ✅  (`refactor: Phase 1`)

- [x] Split `src/` into `packages/{engine,mcp-server,validator,hooks}` (+ `frontend` in Phase 4)
- [x] `@nrth/engine` is browser-safe (pure, no Node imports) so the web app can import it
- [x] `tsconfig.base` + per-package tsconfig + solution references; `tsc -b` build order
- [x] Replace hand-rolled `node.d.ts` with real `@types/node`
- [x] Verify: tsc -b clean, 44/44 engine tests, 11/11 solvable+fair, MCP lists 11

## Phase 2: YAML scenarios ✅  (`feat: Phase 2`)

- [x] Add `js-yaml`; `parseScenario()` loads YAML (superset of JSON) — *US-6*
- [x] Convert all 11 `scenarios/*.json` → `*.yaml` (verified byte-for-byte round-trip)
- [x] Update every reader (validator, hooks, mcp-server, engine tests) to YAML
- [x] On-save hook glob → `scenarios/**/*.yaml`

## Phase 3: MCP server on the official SDK ✅  (`feat: Phase 3`)

- [x] Replace hand-rolled JSON-RPC with `@modelcontextprotocol/sdk` (`McpServer` + stdio) — *US-7*
- [x] 7 zod-typed tools over the shared engine
- [x] Verify with a real MCP `Client`: connect → list → play a scenario to a win

## Phase 4: React + Vite + xterm.js web app ✅  (`feat: Phase 4`)

- [x] `packages/frontend` — React 18 + Vite + TypeScript — *US-1, US-2, US-3, US-4, US-10*
- [x] xterm.js terminal with a line editor wired to `executeCommand` — *US-2*
- [x] Topology, ticket panel, device tabs, timer, debrief/score overlay — *US-1, US-4, US-10*
- [x] Author Studio: live solvable+fair validation in-browser (no mocks) — *US-8*
- [x] Scenarios bundled from `scenarios/*.yaml` via `import.meta.glob`
- [x] Client-side engine → no backend, no sessions, no CDN; honest "Engine ready" state
- [x] Retire the old dc.html server + vendored assets
- [x] Verify in a real browser (external blocked): play to win + Author Studio PASS, zero external requests

## Phase 5: quality gates, specs, docs ✅  (`chore/docs: Phase 5`)

- [x] Engine unit suite (`packages/engine/test`, zero-dep) — locks the fault→condition mapping — *US-5*
- [x] Validator enforces FAIR verdicts (`already-solved | unsolvable | symptom-mismatch | unintended-solution`) — *US-8*
- [x] CI: `npm ci` → build → engine tests → validator → MCP smoke — *US-9 as CI gate*
- [x] `.kiro/` on-save hook + validation-agent + steering aligned to the new paths
- [x] requirements.md / design.md / tasks.md match the shipped code (spec ↔ code)

## Spec → code traceability

| Requirement | Implemented in |
|-------------|----------------|
| US-1 ticket/topology | `frontend` TicketPanel, Topology |
| US-2 CLI investigate | `engine` cli-parser + `frontend` xterm Terminal |
| US-3 config fixes | `engine` cli-parser |
| US-4 win + score | `engine` checkWinCondition + `frontend` Debrief |
| US-5 reachability (Cond 1–7) | `engine` reachability.ts + `engine/test` |
| US-6 scenario data (YAML) | `engine` scenario-loader + `scenarios/*.yaml` |
| US-7 MCP API | `mcp-server` (official SDK) |
| US-8 validation (solvable+fair) | `validator` + `frontend` Author Studio |
| US-9 on-save hook | `hooks` + `.kiro/hooks/on-save-validate.md` + CI |
| US-10 live topology | `frontend` Topology (re-renders on state change) |
