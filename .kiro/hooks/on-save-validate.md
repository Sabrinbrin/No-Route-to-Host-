---
trigger: on-save
match: scenarios/**/*.yaml
---

# On-Save: Validate Scenario

When a scenario file (`scenarios/*.yaml`) is saved, automatically validate it
by running the reference solution through the shared engine and checking the
win condition.

## What this hook does

1. Parses the saved JSON file and validates the schema.
2. Loads the scenario into the engine (applies the injected fault).
3. Asserts the win condition is **not** met (fault is present).
4. Executes the `reference_solution` commands via the engine.
5. Asserts the win condition **is** met (fault is fixed).
6. Reports PASS or FAIL with details.

## Command

```bash
node packages/hooks/dist/index.js {{filePath}}
```

## Success criteria

- Exit code 0 = scenario is solvable and fair
- Exit code 1 = scenario has a problem (unsolvable, bad schema, symptom mismatch)

## Why this matters

This hook guarantees that no broken scenario can be committed. If an author
accidentally breaks the reference solution, changes the fault without updating
the fix, or introduces a symptom/fault mismatch, the hook catches it instantly
— before a student ever encounters an unfair lab.

## Example output

```
✓ Wrong Access VLAN (wrong-access-vlan) — Solvable in 4 steps.
```

```
✗ Broken Scenario (broken-id) — Reference solution failed: Ping failed: VLAN 99 doesn't match destination SVI VLAN 10.
```
