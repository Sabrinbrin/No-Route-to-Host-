import type { NetworkState, Device, Link } from '@nrth/engine';

const ICON: Record<string, string> = {
  switch: '🔀', router: '🌐', firewall: '🛡️', host: '🖥️',
  ec2: '☁️', 'vpc-router': '🔗', 'linux-server': '🐧',
  'windows-server': '🪟', 'docker-host': '🐳',
};

interface Pos { x: number; y: number; }

/**
 * Auto-layout devices in a horizontal row or grid and draw SVG links between them.
 */
function computeLayout(devices: Device[], links: Link[]): Map<string, Pos> {
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

export function Topology({ network, solved, activeDevice, onDevice }: { network: NetworkState; solved: boolean; activeDevice?: string; onDevice?: (id: string) => void }) {
  const { devices, links } = network;
  const positions = computeLayout(devices, links);

  // Determine link health (simple: both endpoints up = green)
  function linkColor(link: Link): string {
    if (solved) return 'var(--green)';
    const fromDev = devices.find(d => d.id === link.from.device);
    const toDev = devices.find(d => d.id === link.to.device);
    if (!fromDev || !toDev) return '#30363d';
    const fromIf = fromDev.interfaces.find(i => i.name === link.from.interface);
    const toIf = toDev.interfaces.find(i => i.name === link.to.interface);
    if (fromIf?.status === 'down' || toIf?.status === 'down') return 'var(--red)';
    return '#f5a623'; // investigating = amber
  }

  const svgWidth = 360;
  const svgHeight = devices.length <= 4 ? 130 : 150;

  return (
    <div className="block">
      <div className="h" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Topology</span>
        <span style={{ color: solved ? 'var(--green)' : 'var(--amber)', fontSize: 12 }}>
          {solved ? '● reachable' : '● investigating'}
        </span>
      </div>

      {/* SVG Topology Diagram */}
      <div style={{ marginTop: 10, position: 'relative' }}>
        <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ display: 'block' }}>
          {/* Draw links */}
          {links.map((link) => {
            const from = positions.get(link.from.device);
            const to = positions.get(link.to.device);
            if (!from || !to) return null;
            const color = linkColor(link);
            const dashArray = solved ? undefined : '4 3';
            return (
              <line
                key={link.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={dashArray}
                style={{ transition: 'stroke 0.5s ease' }}
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
              <g key={d.id} onClick={() => onDevice?.(d.id)} style={{ cursor: onDevice ? 'pointer' : 'default' }}>
                {/* Device circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={16}
                  fill={isActive ? 'rgba(88,166,255,.15)' : '#161b22'}
                  stroke={isActive ? '#58a6ff' : solved ? 'var(--green)' : '#30363d'}
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
          <span style={{ width: 16, height: 2, background: solved ? 'var(--green)' : '#f5a623', display: 'inline-block', borderRadius: 1 }} />
          {solved ? 'healthy' : 'under investigation'}
        </span>
        <span>Click a device to open its terminal</span>
      </div>
    </div>
  );
}
