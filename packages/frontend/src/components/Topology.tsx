import type { NetworkState } from '@nrth/engine';

const ICON: Record<string, string> = {
  switch: '🔀', router: '🌐', firewall: '🧱', host: '🖥️',
  ec2: '☁️', 'vpc-router': '🔗',
};

export function Topology({ network, solved }: { network: NetworkState; solved: boolean }) {
  const devices = network.devices;
  return (
    <div className="block">
      <div className="h" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Topology</span>
        <span style={{ color: solved ? 'var(--green)' : 'var(--amber)' }}>
          {solved ? 'reachable' : 'investigating'}
        </span>
      </div>
      <div style={{ marginTop: 10 }}>
        {devices.map((d) => {
          const ip =
            d.interfaces.find((i) => i.ip)?.ip ||
            d.routing.svis?.[0]?.ip ||
            '';
          return (
            <div className="node" key={d.id}>
              <div className="ico">{ICON[d.type] ?? '📦'}</div>
              <div>
                <div className="nm">{d.hostname}</div>
                <div className="meta">
                  {d.type}
                  {ip ? ` · ${ip}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
