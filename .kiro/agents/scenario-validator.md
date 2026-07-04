# Agent: Scenario Validator

## Purpose

Validates that authored network scenarios are **solvable** and **fair** by playing them
through the MCP server's simulation tools.

## Trigger

- On-save of any `scenarios/*.json` file
- Manual invocation via `npm run validate`

## Tools Used

This agent connects to the `no-route-to-host` MCP server and uses:

1. `load_scenario({id})` — Load the scenario into the engine
2. `check_win_condition()` — Verify fault is present (should return false)
3. `run_command({device, command})` — Execute each step of `reference_solution`
4. `check_win_condition()` — Verify fix works (should return true)

## Validation Flow

```
1. LOAD     → load_scenario(id)
2. ASSERT   → check_win_condition() === false  (fault present)
3. EXECUTE  → run_command() for each reference_solution step
4. ASSERT   → check_win_condition() === true   (fix works)
5. FAIRNESS → verify symptom matches fault
6. REPORT   → PASS or FAIL with details
```

## Steering Reference

This agent follows the rules in `.kiro/steering/networking-trainer.md`:

- Never edit engine source or scenario files to make validation pass
- Never invent commands the engine doesn't implement
- Report failures — don't silently repair them
- Use only the implemented CLI subset (IOS abbreviations OK)

## Pass/Fail Criteria

**PASS** requires ALL of:
- Win condition is false at start (fault injected correctly)
- Win condition is true after reference solution (fix works)
- Ticket symptom matches the injected fault
- No trivial unintended alternative fix

**FAIL** categories:
- `already-solved` — win condition true before any fix
- `unsolvable` — reference solution doesn't restore reachability
- `symptom-mismatch` — ticket text doesn't match the fault
- `unintended-solution` — a simpler fix exists

## MCP Configuration

```json
{
  "mcpServers": {
    "no-route-to-host": {
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"],
      "cwd": "."
    }
  }
}
```

## Example Output

```
✓ Wrong Access VLAN (wrong-access-vlan) — PASS: Solvable in 4 steps, fair.
✓ EC2 Security Group Blocking ICMP (aws-security-group) — PASS: Solvable in 1 steps, fair.
✗ Broken Scenario (broken-id) — FAIL unsolvable: Ping failed: VLAN 99 doesn't match.
```
