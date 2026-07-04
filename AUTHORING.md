# Scenario Authoring Guide

How to create new diagnostic scenarios for No Route to Host.

## Quick Start

1. Copy an existing scenario from `scenarios/` as a template
2. Modify the topology, fault, ticket, and solution
3. Save → the on-save hook validates automatically
4. If it passes, your scenario is guaranteed solvable and fair

## Scenario Schema

Scenarios are **YAML** files (`scenarios/*.yaml`). The examples below are shown
as JSON for clarity — YAML is a superset of JSON, so the same field structure
applies (copy an existing `.yaml` as your starting point). Each scenario has
this structure:

```json
{
  "id": "unique-kebab-case-id",
  "title": "Human-Readable Title",
  "difficulty": 3,
  "topology": {
    "devices": [...],
    "links": [...]
  },
  "injected_fault": {...},
  "ticket": {...},
  "win_condition": {...},
  "reference_solution": [...],
  "layout": {...}
}
```

## Fields Explained

### `id` (string, required)
Unique identifier. Use kebab-case: `wrong-access-vlan`, `aws-security-group`.

### `title` (string, required)
Displayed in the scenario dashboard and play screen.

### `difficulty` (number, required)
Rating 1–5. Determines the star display and suggested time.

### `topology.devices[]`

Each device has:

```json
{
  "id": "switch1",
  "hostname": "SW1",
  "type": "switch",
  "interfaces": [...],
  "routing": { "enabled": false, "routes": [], "svis": [] }
}
```

**Device types:** `switch`, `router`, `firewall`, `host`, `ec2`, `vpc-router`

**Interface fields:**
- `name`: e.g., "Gi0/1", "eth0", "port1"
- `ip`, `mask`: IP configuration (optional for switch access ports)
- `status`: "up" or "down"
- `mode`: "access" or "trunk" (switches only)
- `accessVlan`: VLAN number (access ports)
- `trunkAllowedVlans`: array of allowed VLANs (trunk ports)
- `gateway`: default gateway IP (hosts/EC2 only)

**AWS config** (for `ec2` and `vpc-router` types):
```json
"aws": {
  "securityGroups": [...],
  "nacls": [...],
  "routeTables": [...],
  "vpcPeerings": [...]
}
```

### `topology.links[]`

Connections between device interfaces:
```json
{
  "id": "link1",
  "from": { "device": "host-a", "interface": "eth0" },
  "to": { "device": "switch1", "interface": "Gi0/1" }
}
```

### `injected_fault`

The state delta that breaks the network. Applied at load time.

```json
{
  "device": "switch1",
  "interface": "Gi0/1",
  "field": "accessVlan",
  "value": 20,
  "action": "set"
}
```

- `device`: which device to modify
- `interface`: (optional) which interface on that device
- `field`: which field to change
- `value`: what to set it to
- `action`: "set" (default), "remove", or "add"

**Special fault fields:**
- `routing.enabled` — enable/disable L3 routing
- `svi.20.status` — set SVI for VLAN 20 status
- `routes` — with action "remove" to delete a route
- `firewallPolicies` — set entire policy list
- `aws` — set entire AWS config (security groups, NACLs, route tables)

### `ticket`

What the player sees:
```json
{
  "title": "Host A can't reach its default gateway",
  "symptom": "Host A reports 'destination unreachable' when pinging 10.0.10.1.",
  "affected_hosts": ["host-a"]
}
```

**Rules:**
- The symptom must accurately describe what the injected fault causes
- Don't give away the answer — describe the symptom, not the fix
- Include enough detail to start investigating

### `win_condition`

A reachability assertion:
```json
{
  "type": "ping",
  "source": "host-a",
  "destination": "10.0.10.1",
  "expected": "success"
}
```

### `reference_solution`

The minimal correct fix:
```json
[
  {
    "device": "switch1",
    "commands": [
      "configure terminal",
      "interface Gi0/1",
      "switchport access vlan 10",
      "end"
    ]
  }
]
```

**Rules:**
- Use full command forms (the engine accepts abbreviations but reference solutions should be explicit)
- Include mode transitions (`configure terminal`, `end`)
- Should be the **minimal** fix — don't add unnecessary commands

### `layout` (optional)

SVG positioning hints for the topology view:
```json
{
  "host-a": { "x": 100, "y": 50 },
  "switch1": { "x": 300, "y": 150 }
}
```

## The Reachability Model

The engine evaluates ping reachability via 6 ordered conditions:

1. **Source IP valid** — host has IP/mask/gateway
2. **Access VLAN path** — port is in correct VLAN
3. **Trunk carries VLAN** — VLAN allowed on trunk links
4. **L3 routing** — routing enabled, SVIs up, route exists
5. **Firewall permits** — policy allows src→dst traffic
6. **AWS conditions** — security group allows, NACL allows, route table has route

Your fault should disable **exactly one** condition. The fix should re-enable exactly that one.

## Validation

Run manually:
```bash
node packages/hooks/dist/index.js scenarios/your-new-scenario.yaml
```

Or use watch mode:
```bash
npm run watch:scenarios
```

## Example: Creating a New Scenario

Let's say you want a scenario where a trunk port is accidentally set to access mode.

1. Design the topology: two switches with a trunk link
2. Pick the fault: change one end's mode from "trunk" to "access"
3. Write the ticket: "Cross-switch traffic on all VLANs is broken"
4. Define the win condition: ping from a host on switch A to a host on switch B
5. Write the fix: `switchport mode trunk` + re-add allowed VLANs

The validator will confirm it's solvable before any student sees it.
