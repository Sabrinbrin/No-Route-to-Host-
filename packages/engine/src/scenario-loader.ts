import yaml from 'js-yaml';
import {
  Scenario,
  NetworkState,
  GameState,
  Device,
  NetworkInterface,
  WinCondition,
  CommandContext,
} from './types.js';
import { deepClone, findDevice, findInterface } from './utils.js';
import { evaluatePing } from './reachability.js';

/**
 * Load a scenario from parsed data and create the initial (broken) game state.
 */
export function loadScenario(scenarioData: Scenario): GameState {
  // Deep clone the topology to create mutable state
  const network: NetworkState = {
    devices: deepClone(scenarioData.topology.devices),
    links: deepClone(scenarioData.topology.links),
  };

  // Apply the injected fault
  applyFault(network, scenarioData.injected_fault);

  // Initialize command contexts for each device
  const contexts: Record<string, CommandContext> = {};
  for (const device of network.devices) {
    contexts[device.id] = {
      mode: 'exec',
      currentDevice: device.id,
    };
  }

  return {
    scenario: scenarioData,
    network,
    commandCount: 0,
    startTime: Date.now(),
    resolved: false,
    contexts,
  };
}

/**
 * Apply an injected fault to the network state.
 */
function applyFault(
  state: NetworkState,
  fault: Scenario['injected_fault']
): void {
  const device = findDevice(state, fault.device);
  if (!device) return;

  const action = fault.action || 'set';

  if (fault.interface) {
    // Fault is on a specific interface
    const iface = findInterface(device, fault.interface);
    if (!iface) return;

    if (action === 'set') {
      (iface as any)[fault.field] = fault.value;
    } else if (action === 'remove') {
      delete (iface as any)[fault.field];
    }
  } else {
    // Fault on device-level field
    if (fault.field === 'routing.enabled') {
      device.routing.enabled = fault.value;
    } else if (fault.field === 'routes') {
      if (action === 'remove') {
        device.routing.routes = device.routing.routes.filter(
          (r) =>
            !(
              r.network === fault.value.network &&
              r.mask === fault.value.mask
            )
        );
      } else if (action === 'set') {
        device.routing.routes = fault.value;
      }
    } else if (fault.field === 'svis') {
      if (action === 'set') {
        device.routing.svis = fault.value;
      }
    } else if (fault.field.startsWith('svi.')) {
      const parts = fault.field.split('.');
      const sviVlan = parseInt(parts[1]);
      const sviField = parts[2];
      const svi = device.routing.svis.find((s) => s.vlan === sviVlan);
      if (svi) {
        (svi as any)[sviField] = fault.value;
      }
    } else if (fault.field === 'firewallPolicies') {
      if (action === 'remove') {
        device.firewallPolicies = (device.firewallPolicies || []).filter(
          (p) => p.id !== fault.value.id
        );
      } else if (action === 'set') {
        device.firewallPolicies = fault.value;
      }
    } else {
      (device as any)[fault.field] = fault.value;
    }
  }
}

/**
 * Check if the win condition is satisfied.
 */
export function checkWinCondition(
  state: NetworkState,
  winCondition: WinCondition
): { resolved: boolean; details: string } {
  if (winCondition.type === 'ping') {
    const result = evaluatePing(
      state,
      winCondition.source,
      winCondition.destination
    );
    if (winCondition.expected === 'success') {
      return {
        resolved: result.success,
        details: result.success
          ? `Ping from ${winCondition.source} to ${winCondition.destination} succeeded.`
          : `Ping failed: ${result.reason}`,
      };
    } else {
      return {
        resolved: !result.success,
        details: result.success
          ? 'Ping succeeded but expected failure.'
          : `Ping correctly fails: ${result.reason}`,
      };
    }
  }

  return { resolved: false, details: 'Unknown win condition type.' };
}

/**
 * Parse a scenario file. Scenarios are authored as YAML (see design.md);
 * YAML is a superset of JSON, so this also accepts JSON content.
 */
export function parseScenario(content: string): Scenario {
  return yaml.load(content) as Scenario;
}

/** @deprecated Use parseScenario — kept as an alias for back-compat. */
export function parseScenarioJson(content: string): Scenario {
  return parseScenario(content);
}
