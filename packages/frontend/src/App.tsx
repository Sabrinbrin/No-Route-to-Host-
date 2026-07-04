import { useEffect, useMemo, useRef, useState } from 'react';
import { GameSession, getScenario, listScenarios } from './game';
import { TerminalView } from './components/Terminal';
import { TicketPanel } from './components/TicketPanel';
import { Topology } from './components/Topology';
import { AuthorStudio } from './components/AuthorStudio';

type Screen = 'dashboard' | 'play' | 'author';

const TAG = (d: number) => (d <= 2 ? 'Switching' : d <= 4 ? 'Routing / Firewall' : 'Cloud / OS');
const CHIP = (d: number) => (d <= 1 ? 's' : d <= 3 ? 'c' : 'f');
const DIFF = (d: number) => (d <= 1 ? 'Starter' : d <= 3 ? 'Core' : 'Advanced');

export function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const scenarios = useMemo(() => listScenarios(), []);
  const [session, setSession] = useState<GameSession | null>(null);
  const [ticketNum, setTicketNum] = useState(1);
  const [device, setDevice] = useState('');
  const [solved, setSolved] = useState(false);
  const [finalTime, setFinalTime] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const started = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = finalTime ?? (started.current ? Math.floor((Date.now() - started.current) / 1000) : 0);
  void tick;

  function play(id: string) {
    const scenario = getScenario(id);
    if (!scenario) return;
    const s = new GameSession(scenario);
    const first =
      s.network.devices.find((d) => ['switch', 'router', 'firewall', 'vpc-router'].includes(d.type)) ??
      s.network.devices[0];
    setSession(s);
    setTicketNum(scenarios.findIndex((m) => m.id === id) + 1);
    setDevice(first?.id ?? '');
    setSolved(false);
    setFinalTime(null);
    started.current = Date.now();
    setScreen('play');
  }

  function onWin() {
    setFinalTime(Math.floor((Date.now() - started.current) / 1000));
    setSolved(true);
  }

  const hostname = session?.network.devices.find((d) => d.id === device)?.hostname ?? 'SW1';

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo"><i /></span> No Route to Host
        </div>
        <nav className="nav">
          <button className={screen === 'dashboard' ? 'active' : ''} onClick={() => setScreen('dashboard')}>Scenarios</button>
          <button className={screen === 'author' ? 'active' : ''} onClick={() => setScreen('author')}>Author studio</button>
        </nav>
        <div className="spacer" />
        <div className="pill"><span className="dot" /> Engine ready · {scenarios.length} scenarios</div>
      </header>

      <div className="content">
        {screen === 'dashboard' && <Dashboard scenarios={scenarios} onPlay={play} />}
        {screen === 'author' && <AuthorStudio />}
        {screen === 'play' && session && (
          <Play
            session={session}
            device={device}
            hostname={hostname}
            ticketNum={ticketNum}
            solved={solved}
            elapsed={elapsed}
            onDevice={setDevice}
            onWin={onWin}
            onExit={() => setScreen('dashboard')}
            onReset={() => play(session.scenario.id)}
          />
        )}
      </div>

      {solved && session && (
        <Debrief
          scenario={session.scenario}
          seconds={finalTime ?? elapsed}
          commands={session.commandCount}
          onNext={() => { setSolved(false); setScreen('dashboard'); }}
        />
      )}
    </div>
  );
}

function Dashboard({ scenarios, onPlay }: { scenarios: ReturnType<typeof listScenarios>; onPlay: (id: string) => void }) {
  return (
    <div className="wrap">
      <div className="eyebrow">Training queue</div>
      <h1>Pick a broken network</h1>
      <p className="sub">Every scenario was validated solvable &amp; fair before release. Diagnose, fix, debrief.</p>
      <div className="grid">
        {scenarios.map((s, i) => (
          <div className="card click" key={s.id} onClick={() => onPlay(s.id)}
            role="button" tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' ? onPlay(s.id) : undefined)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="ticket-num" style={{ width: 30, height: 30, borderRadius: 8, background: '#14161b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontWeight: 600 }}>{i + 1}</span>
                <span className="tag">{TAG(s.difficulty)}</span>
              </div>
              <span className={`chip ${CHIP(s.difficulty)}`}>{DIFF(s.difficulty)}</span>
            </div>
            <div className="title">{s.title}</div>
            <div className="foot">
              <span><span className="dot" style={{ display: 'inline-block', marginRight: 6 }} />agent-verified</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{i === 0 ? 'Start' : 'Open'} →</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Play(props: {
  session: GameSession; device: string; hostname: string; ticketNum: number;
  solved: boolean; elapsed: number; onDevice: (id: string) => void; onWin: () => void; onExit: () => void; onReset: () => void;
}) {
  const { session, device, hostname, ticketNum, solved, elapsed, onDevice, onWin, onExit, onReset } = props;
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="topbar">
        <button className="btn ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={onExit}>← Exit</button>
        <span className="num">{ticketNum}</span>
        <b>{session.scenario.title}</b>
        <span className={`status ${solved ? 'ok' : 'inv'}`}>{solved ? 'Resolved' : 'Investigating'}</span>
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, background: 'var(--bg)', border: '1px solid var(--border)', padding: '5px 11px', borderRadius: 9 }}>{fmt(elapsed)}</span>
      </div>
      <div className="play">
        <div className="term-col">
          <div className="term-bar">
            <span className="b" style={{ background: '#f85149' }} />
            <span className="b" style={{ background: '#f5a623' }} />
            <span className="b" style={{ background: '#3fb950' }} />
            <span className="name">{hostname} — {session.network.devices.find(d => d.id === device)?.type ?? 'device'} console</span>
            <button className="reset" onClick={onReset}>reset</button>
          </div>
          <TerminalView session={session} device={device} hostname={hostname} onWin={onWin} />
        </div>
        <div className="side">
          <TicketPanel scenario={session.scenario} ticketNum={ticketNum} />
          <Topology network={session.network} solved={solved} activeDevice={device} onDevice={onDevice} />
          <div style={{ marginTop: 14, fontFamily: 'var(--mono)', fontSize: 12, color: '#8b949e', padding: '0 4px' }}>
            try: show running-config · ping {session.scenario.win_condition.destination} · ?
          </div>
        </div>
      </div>
    </div>
  );
}

function Debrief({ scenario, seconds, commands, onNext }: { scenario: any; seconds: number; commands: number; onNext: () => void }) {
  const grade = seconds < 90 && commands < 12 ? 'A' : seconds < 180 && commands < 20 ? 'B' : seconds < 300 ? 'C' : 'D';
  const color = grade === 'A' ? 'var(--green)' : grade === 'B' ? 'var(--accent)' : grade === 'C' ? 'var(--amber)' : 'var(--red)';
  const explanation = getExplanation(scenario.id);
  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 620, textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div className="grade" style={{ color, margin: 0, fontSize: 38 }}>{grade}</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: 'var(--green)' }}>Ticket resolved</h2>
            <div className="sub" style={{ margin: '2px 0 0' }}>{scenario.title} · {seconds}s · {commands} commands</div>
          </div>
        </div>

        {explanation && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--accent)', marginBottom: 8 }}>Why this fix works</div>
            <p style={{ fontSize: 13.5, lineHeight: 1.7, margin: '0 0 12px', color: 'var(--ink)' }}>{explanation.why}</p>

            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--amber)', marginBottom: 6 }}>The underlying concept</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 12px', color: 'var(--muted)' }}>{explanation.concept}</p>

            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--red)', marginBottom: 6 }}>In production</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: 'var(--muted)' }}>{explanation.production}</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn primary" onClick={onNext}>Next scenario →</button>
        </div>
      </div>
    </div>
  );
}

interface Explanation { why: string; concept: string; production: string; }

function getExplanation(id: string): Explanation | null {
  const explanations: Record<string, Explanation> = {
    'wrong-access-vlan': {
      why: 'The access port was assigned to VLAN 20, but the host needed VLAN 10 (where the gateway SVI lives). By setting the correct VLAN, the host\'s traffic reaches the SVI and gets routed.',
      concept: 'Access VLANs determine which broadcast domain a port belongs to. A host can only reach its gateway if they share the same VLAN. This is Layer 2 segmentation — the most common cause of "one host is down" tickets.',
      production: 'This happens after port moves, cable swaps, or template misapplies. Always verify with "show vlan brief" before blaming Layer 3. In production, you\'d also check the MAC address table to confirm the host is learned on the expected port.',
    },
    'trunk-allowed-list': {
      why: 'The trunk between switches had an allowed-VLAN list that omitted VLAN 30. Traffic for that VLAN was silently dropped at the trunk boundary. Adding it back restored cross-switch connectivity.',
      concept: 'Trunk links carry multiple VLANs using 802.1Q tagging. The "allowed vlan" list acts as a filter — only listed VLANs traverse the trunk. A missing VLAN means complete isolation between switches for that VLAN.',
      production: 'This is common after trunk security hardening (only allowing needed VLANs) when a new VLAN is added but the trunk filter isn\'t updated. Check both ends — the list must match on both sides of the trunk.',
    },
    'inter-vlan-routing': {
      why: 'The Layer 3 switch had IP routing enabled, but the VLAN 20 SVI was administratively shut down. Without the SVI up, the switch had no Layer 3 interface in that subnet and couldn\'t route traffic to/from it.',
      concept: 'Inter-VLAN routing requires a Layer 3 interface (SVI) in each VLAN that needs routing. The SVI acts as the default gateway for hosts in that VLAN. If it\'s down, the VLAN is isolated at Layer 3 even though Layer 2 works fine.',
      production: 'SVIs can be shut during maintenance or by accident. "show ip int brief" shows SVI status quickly. In production, you\'d also check HSRP/VRRP if the gateway is redundant — the standby might not have taken over.',
    },
    'missing-default-route': {
      why: 'The core router had no default route (0.0.0.0/0) pointing upstream. Internal routing worked because those subnets were directly connected, but any traffic destined for the internet had nowhere to go.',
      concept: 'A default route is the "route of last resort" — it matches any destination not covered by more specific routes. Without it, the router drops traffic to unknown destinations with "no route to host." It\'s the most critical single route in any network.',
      production: 'Default routes disappear after router reloads (if not saved), during routing protocol issues, or when a static route\'s next-hop becomes unreachable. Always check "show ip route" first — it\'s the fastest way to spot missing routes.',
    },
    'firewall-tunnel': {
      why: 'The IPsec tunnel was established (Phase 1 + Phase 2 up), but the branch firewall had no policy permitting traffic FROM the HQ subnet TO the branch subnet through the tunnel interface. Firewalls are default-deny — no policy means no traffic.',
      concept: 'VPN tunnels separate the crypto plane (tunnel establishment) from the traffic plane (what\'s allowed through). A tunnel being "up" only means the devices agreed on encryption — it doesn\'t mean traffic is permitted. Firewall policies must explicitly allow the desired traffic flows.',
      production: 'This is the #1 "tunnel up but no traffic" issue in production. Verify with packet captures on the tunnel interface and check policy hit counters. Also watch for asymmetric policies — both sides need to permit the traffic.',
    },
    'aws-security-group': {
      why: 'The security group on the app server only allowed TCP/443 inbound. ICMP (ping) was not in the inbound rules, so the VPC silently dropped the ping packets before they reached the instance.',
      concept: 'AWS Security Groups are stateful firewalls at the instance level. They default-deny all inbound traffic. Each protocol/port must be explicitly allowed. "Stateful" means you only need an inbound rule — return traffic is automatically allowed.',
      production: 'This is the most common AWS connectivity issue. Use VPC Flow Logs to confirm traffic is being rejected at the SG level. Remember: SGs are stateful (no need for outbound rules for return traffic), but NACLs are stateless (you need both directions).',
    },
    'aws-route-table': {
      why: 'The VPC peering connection was active, but the route table in the prod VPC had no route pointing to the peer VPC\'s CIDR via the peering connection. Without the route, traffic had nowhere to go.',
      concept: 'VPC Peering connects two VPCs, but it\'s not automatic routing — you must add routes in BOTH VPC route tables pointing to each other\'s CIDR blocks via the peering connection. It\'s a common gotcha: peering is "up" but traffic doesn\'t flow without routes.',
      production: 'Always check route tables on both sides of a peering connection. Also verify there\'s no overlapping CIDR (peering won\'t work with overlapping address spaces). Use VPC Reachability Analyzer for complex multi-VPC troubleshooting.',
    },
    'aws-nacl-deny': {
      why: 'The NACL on the API subnet allowed TCP inbound (rule 100) but had no rule allowing ICMP inbound. NACLs are stateless — unlike security groups, you need explicit rules for both the request AND response directions.',
      concept: 'Network ACLs are stateless subnet-level firewalls evaluated by rule number (lowest first). Unlike Security Groups (stateful), NACLs require explicit allow rules in both directions. A common mistake is adding a TCP allow but forgetting ICMP for ping.',
      production: 'NACL issues are tricky because traffic works for some protocols but not others (since each protocol needs its own rule). Check both inbound AND outbound rules. Use VPC Flow Logs with "REJECT" filter to identify NACL blocks vs SG blocks.',
    },
    'linux-iptables': {
      why: 'The iptables INPUT chain policy was DROP, and while rules existed for SSH (22) and HTTP (80/443), the ICMP accept rule was removed during hardening. The firewall dropped ping packets at the kernel level.',
      concept: 'iptables processes rules top-to-bottom per chain. When no rule matches, the chain policy applies (ACCEPT or DROP). A DROP policy with no ICMP rule means silent packet loss — the sender gets no response, not even a "rejected" message.',
      production: 'After iptables hardening, always test ICMP connectivity. Use "iptables -L -n -v" to see hit counters on each rule — zero hits on an expected rule means traffic isn\'t reaching it. Order matters: a DROP rule above your ACCEPT will win.',
    },
    'docker-networking': {
      why: 'An iptables flush removed all rules including the ICMP accept in the INPUT chain. With policy DROP, the host became unreachable from the network. Docker\'s own FORWARD chain rules survived (containers work internally) but host-level INPUT was empty.',
      concept: 'Docker heavily uses iptables for its networking (NAT, port mapping, container isolation). Flushing iptables to "fix" Docker issues often breaks host connectivity because it removes ALL rules while keeping restrictive chain policies.',
      production: 'Never "iptables -F" on a production Docker host without checking chain policies first. Use "iptables-save" to backup before changes. Better: use "docker network" commands to troubleshoot Docker networking, not raw iptables.',
    },
    'windows-firewall': {
      why: 'Windows Firewall had an "ICMP Echo Request" allow rule, but it was disabled (Enabled=False). The Domain profile default is Block Inbound, so without an active allow rule, ICMP was silently dropped. Re-enabling the rule restored ping.',
      concept: 'Windows Firewall evaluates rules per-profile (Domain/Private/Public). Rules can exist but be disabled — "Get-NetFirewallRule" shows the Enabled status. Group Policy refreshes can disable rules, especially after domain migrations.',
      production: 'After GP refreshes or domain changes, check "Get-NetFirewallRule | Where Enabled -eq False" for recently disabled rules. In production, also check if the firewall profile changed (Domain→Public) which applies different default rules.',
    },
  };
  return explanations[id] ?? null;
}
