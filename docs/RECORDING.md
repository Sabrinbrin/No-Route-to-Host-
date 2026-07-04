# Recording Guide — Demo Video

Tips for recording the demo video for the BuildFest submission.

## What to show (in order)

### 1. The problem (30s)
- Open the landing page — show the tagline and the stats (11 scenarios, 100% agent-verified)
- Briefly explain: "Junior engineers learn config syntax but never practise the diagnostic loop"

### 2. Gameplay (60–90s)
- Pick **Scenario 1 (Wrong Access VLAN)** for a clean, fast demo
- Show the ticket panel — read the symptom aloud
- Show the topology — links are red/broken
- Demonstrate investigation: `show vlan brief`, `ping 10.0.10.1` (fails)
- Apply the fix: `conf t` → `int Gi0/1` → `sw acc vlan 10` → `end`
- Ping again — succeeds, links turn green, "Ticket Resolved" overlay appears
- Show the debrief (grade + explanation)

### 3. Author Studio (30s)
- Switch to Author Studio tab
- Load an existing scenario — show YAML on the left, live validation on the right
- Modify something (e.g. change the VLAN in reference_solution to a wrong value)
- Watch it fail: "FAIL unsolvable"
- Fix it back — "PASS: Solvable in 4 steps, fair"
- Key point: "Same engine as CI — an instructor can't ship a broken lab"

### 4. Kiro + MCP (30–45s)
- Show the MCP server config in `kiro.json` (or screenshot)
- In Kiro chat, use the `validate-scenario` prompt
- Show the agent calling `load_scenario`, `check_win_condition`, `run_command`, etc.
- Agent reports PASS — "Kiro literally plays the game to prove it works"

### 5. On-save hook (15s)
- Show terminal with `npm run watch:scenarios`
- Edit a scenario YAML, save
- Hook fires: "✓ Wrong Access VLAN — Solvable in 4 steps"
- Break it, save again: "✗ ... FAIL unsolvable"

### 6. Architecture wrap-up (15s)
- Show the project structure briefly (monorepo, shared engine)
- Emphasize: "One engine, imported by the game, the MCP server, and CI — zero duplication"

## Recording tips

- **Resolution:** 1920x1080 minimum, 60fps preferred
- **Terminal font size:** bump to 14–16px so it's readable in video
- **Browser zoom:** 110–125% makes the UI easier to read on video
- **Audio:** record a voiceover — even a simple narration wins over silent video
- **Length:** aim for 3–4 minutes total (judges appreciate concise demos)
- **Thumbnail:** pause on the landing page hero for a clean thumbnail frame

## Tools

- **OBS Studio** (free) for screen recording
- **QuickTime** (macOS) for simple capture
- Upload to **YouTube** (unlisted) and link in the README + Devpost submission

## What NOT to show

- Don't show `npm install` or `git clone` — judges don't need setup steps
- Don't read the README aloud — they'll read it themselves
- Don't show every scenario — one well-played scenario is more compelling than 11 rushed ones
- Don't show code scrolling — show the *product* running, not files being read
