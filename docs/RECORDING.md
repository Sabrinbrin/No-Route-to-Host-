# Recording Demo GIFs

The README references three GIF files. Record them on your Kali machine:

## 1. Gameplay demo (`demo-gameplay.gif`)

```bash
# Start the dev server
npm run dev

# In another terminal, record the browser interaction:
# - Open http://localhost:5173
# - Select "Wrong Access VLAN"
# - Type: sh vlan brief → conf t → int Gi0/1 → sw acc vlan 10 → end → ping 10.0.10.1
# - Show the ticket resolved + grade

# Tools: OBS (screen record → convert to GIF) or LICEcap (direct GIF)
```

## 2. On-save hook demo (`demo-onsave-hook.gif`)

```bash
# Record your terminal:
asciinema rec onsave.cast

# Run these commands:
npm run build:engine
node packages/validator/dist/index.js    # Shows all 11 PASS

# Break scenario 1 (edit the YAML: change vlan 10 → vlan 99 in reference_solution)
# Then validate just that file:
node packages/hooks/dist/index.js scenarios/01-wrong-access-vlan.yaml
# → FAIL unsolvable

# Fix it back (vlan 99 → vlan 10):
node packages/hooks/dist/index.js scenarios/01-wrong-access-vlan.yaml
# → PASS: Solvable in 4 steps

# Stop recording:
# Ctrl+D

# Convert to GIF:
agg onsave.cast docs/demo-onsave-hook.gif --cols 100 --rows 24
```

## 3. MCP validate tool demo (`demo-mcp-validate.gif`)

```bash
asciinema rec mcp.cast

# Show the MCP server responding to validate_scenario:
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_scenarios","arguments":{}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"validate_scenario","arguments":{"id":"wrong-access-vlan"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"validate_scenario","arguments":{"id":"linux-iptables"}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"validate_scenario","arguments":{"id":"windows-firewall"}}}' \
| node packages/mcp-server/dist/index.js 2>/dev/null | python3 -m json.tool

# Ctrl+D
agg mcp.cast docs/demo-mcp-validate.gif --cols 100 --rows 30
```

## Tools

- **asciinema** — terminal recording: `pip install asciinema`
- **agg** — asciinema to GIF: https://github.com/asciinema/agg
- **LICEcap** — direct screen-to-GIF (Windows/Mac)
- **OBS** — screen record, then `ffmpeg -i vid.mp4 -vf "fps=10,scale=720:-1" demo.gif`
