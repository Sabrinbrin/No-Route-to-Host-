import { useMemo } from 'react';
import type { NetworkState, Device, Link } from '@nrth/engine';
import { evaluatePing } from '@nrth/engine';

const ICON: Record<string, string> = {
  switch: '🔀', router: '🌐', firewall: '🛡️', host: '🖥️',
  ec2: '☁️', 'vpc-router': '🔗', 'linux-server': '🐧',
  'windows-server': '🪟', 'docker-host': '🐳',
};

interface Pos { x: number; y: number; }

/**
 * Auto-layout devices in a horizontal row or grid and draw SVG links between them.
 */
function computeLayout(devices: Device[]): Map<string, Pos> {
  const positions = new Map<string, Pos>();
  const n = devices.length;

  if (n <= 4) {
    // Single row — evenly spaced
    const spacing = 320 / Math.max(n - 1, 1);
    devices.forEach((d, i) => {
      positions.set(d.id, { x: 20 + i * spacing, y: 60 });
    });
  } else {
    // Two rows for larger topologies
    const topRow = Math.ceil(n / 2);
    const botRow = n - topRow;
    devices.forEach((d, i) => {
      if (i < topRow) {
        const spacing = 320 / Math.max(topRow - 1, 1);
        positions.set(d.id, { x: 20 + i * spacing, y: 35 });
      } else {
        const bi = i - topRow;
        const spacing = 320 / Math.max(botRow - 1, 1);
        positions.set(d.id, { x: 20 + bi * spacing, y: 95 });
      }
    });
  }

  return positions;
}

/**
 * Evaluate whether a link is healthy by checking reachability between
 * the two devices it connects.  Returns 'healthy' | 'broken' | 'unknown'.
 */
function evaluateLinkHealth(network: NetworkState, link: Link): 'healthy' | 'broken' | 'unknown' {
  const fromDev = network.devices.find(d => d.id === link.from.device);
  const toDev = network.devices.find(d => d.id === link.to.device);
  if (!fromDev || !toDev) return 'unknown';

  const fromIf = fromDev.interfaces.find(i => i.name === link.from.interface);
  const toIf = toDev.interfaces.find(i => i.name === link.to.interface);

  // If either interface is admin-down, the link is clearly broken
  if (fromIf?.status === 'down' || toIf?.status === 'down') return 'broken';

  // Try to evaluate reachability between the two endpoints.
  // We pick the device that has an IP on its interface to ping the other.
  const srcIp = fromIf?.ip || fromDev.interfaces.find(i => i.ip)?.ip;
  const dstIp = toIf?.ip || toDev.interfaces.find(i => i.ip)?.ip
    || toDev.routing.svis?.[0]?.ip;

  if (!srcIp && !dstIp) {
    // Neither side has an IP (e.g. pure L2 switch-to-switch trunk)
    // Check if the interfaces are up — that's the best we can do
    return (fromIf?.status === 'up' && toIf?.status === 'up') ? 'healthy' : 'broken';
  }

  // If source device has an IP, ping the destination
  if (srcIp && dstIp) {
    const result = evaluatePing(network, link.from.device, dstIp);
    if (result.success) return 'healthy';
    // Also try the reverse direction
    const reverseResult = evaluatePing(network, link.to.device, srcIp);
    if (reverseResult.success) return 'healthy';
    return 'broken';
  }

  // One side has an IP — try the direction that works
  if (dstIp) {
    const result = evaluatePing(network, link.from.device, dstIp);
    return result.success ? 'healthy' : 'broken';
  }
  if (srcIp) {
    const result = evaluatePing(network, link.to.device, srcIp);
    return result.success ? 'healthy' : 'broken';
  }

  return 'unknown';
}

export function Topology({ network, solved, activeDevice, onDevice }: { network: NetworkState; solved: boolean; activeDevice?: string; onDevice?: (id: string) => void }) {
  const { devices, links } = network;
  const positions = computeLayout(devices);

  // Compute link health (memoized on device/link state changes via reference)
  const linkHealthMap = useMemo(() => {
    const map = new Map<string, 'healthy' | 'broken' | 'unknown'>();
    for (const link of links) {
      if (solved) {
        map.set(link.id, 'healthy');
      } else {
        map.set(link.id, evaluateLinkHealth(network, link));
      }
    }
    return map;
  }, [network, links, solved]);

  function linkColor(link: Link): string {
    const health = linkHealthMap.get(link.id) ?? 'unknown';
    switch (health) {
      case 'healthy': return 'var(--green)';
      case 'broken': return 'var(--red)';
      default: return '#f5a623';
    }
  }

  // Count healthy vs total for the status indicator
  const healthyCount = [...linkHealthMap.values()].filter(h => h === 'healthy').length;
  const allHealthy = healthyCount === links.length;

  const svgWidth = 360;
  const svgHeight = devices.length <= 4 ? 130 : 150;

  return (
    <div className="block">
      <div className="h" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Topology</span>
        <span style={{ color: allHealthy || solved ? 'var(--green)' : 'var(--red)', fontSize: 12 }}>
          {allHealthy || solved ? '● all reachable' : `● ${healthyCount}/${links.length} links healthy`}
        </span>
      </div>

      {/* SVG Topology Diagram */}
      <div style={{ marginTop: 10, position: 'relative' }}>
        <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ display: 'block' }} role="img" aria-label="Network topology diagram — click a device to switch terminal">
          {/* Draw links */}
          {links.map((link) => {
            const from = positions.get(link.from.device);
            const to = positions.get(link.to.device);
            if (!from || !to) return null;
            const color = linkColor(link);
            const health = linkHealthMap.get(link.id);
            return (
              <line
                key={link.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={health === 'broken' ? '4 3' : undefined}
                style={{ transition: 'stroke 0.4s ease, stroke-dasharray 0.4s ease' }}
              />
            );
          })}

          {/* Draw devices */}
          {devices.map((d) => {
            const pos = positions.get(d.id);
            if (!pos) return null;
            const ip = d.interfaces.find(i => i.ip)?.ip || d.routing.svis?.[0]?.ip || '';
            const isActive = d.id === activeDevice;
            return (
              <g key={d.id} onClick={() => onDevice?.(d.id)} onKeyDown={(e: any) => { if ((e.key === 'Enter' || e.key === ' ') && onDevice) { e.preventDefault(); onDevice(d.id); }}} tabIndex={onDevice ? 0 : undefined} role={onDevice ? 'button' : undefined} aria-label={`Switch to ${d.hostname} (${d.type})`} style={{ cursor: onDevice ? 'pointer' : 'default', outline: 'none' }}>
                {/* Device circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={16}
                  fill={isActive ? 'rgba(88,166,255,.15)' : '#fef9e7'}
                  stroke={isActive ? '#58a6ff' : solved || allHealthy ? 'var(--green)' : '#d4a017'}
                  strokeWidth={isActive ? 2.5 : 1.5}
                  style={{ transition: 'stroke 0.3s ease, fill 0.3s ease' }}
                />
                {/* Icon */}
                <text x={pos.x} y={pos.y + 5} textAnchor="middle" fontSize={14}>
                  {ICON[d.type] ?? '📦'}
                </text>
                {/* Hostname label */}
                <text x={pos.x} y={pos.y + 30} textAnchor="middle" fontSize={9} fontWeight={isActive ? 700 : 600} fill={isActive ? '#58a6ff' : '#e6edf3'} fontFamily="var(--mono)">
                  {d.hostname}
                </text>
                {/* IP label */}
                {ip && (
                  <text x={pos.x} y={pos.y + 40} textAnchor="middle" fontSize={8} fill="#8b949e" fontFamily="var(--mono)">
                    {ip}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: '#8b949e', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 16, height: 2, background: 'var(--green)', display: 'inline-block', borderRadius: 1 }} />
          healthy
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 16, height: 2, background: 'var(--red)', display: 'inline-block', borderRadius: 1, borderStyle: 'dashed' }} />
          broken
        </span>
        <span>Click a device to open its terminal</span>
      </div>
    </div>
  );
}
