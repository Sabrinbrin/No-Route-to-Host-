import { useEffect, useMemo, useRef, useState } from 'react';
import { GameSession, getScenario, listScenarios } from './game';
import { TerminalView } from './components/Terminal';
import { TicketPanel } from './components/TicketPanel';
import { Topology } from './components/Topology';
import { AuthorStudio } from './components/AuthorStudio';

type Screen = 'landing' | 'dashboard' | 'play' | 'author';

const TAG = (d: number) => (d <= 2 ? 'Switching' : d <= 4 ? 'Routing / Firewall' : 'Cloud / OS');
const CHIP = (d: number) => (d <= 1 ? 's' : d <= 3 ? 'c' : 'f');
const DIFF = (d: number) => (d <= 1 ? 'Starter' : d <= 3 ? 'Core' : 'Advanced');

export function App() {
  const [screen, setScreen] = useState<Screen>('landing');
  const scenarios = useMemo(() => listScenarios(), []);
  const [session, setSession] = useState<GameSession | null>(null);
  const [ticketNum, setTicketNum] = useState(1);
  const [device, setDevice] = useState('');
  const [solved, setSolved] = useState(false);
  const [finalTime, setFinalTime] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const started = useRef(0);

  // Persist solved scenarios in localStorage
  const [solvedIds, setSolvedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('nrth-solved');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  function markSolved(id: string) {
    setSolvedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem('nrth-solved', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

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
    if (session) markSolved(session.scenario.id);
  }

  const hostname = session?.network.devices.find((d) => d.id === device)?.hostname ?? 'SW1';

  return (
    <div className="app">
      {screen !== 'landing' && (
        <header className="header">
          <div className="brand" onClick={() => setScreen('landing')} style={{ cursor: 'pointer' }}>
            <span style={{fontSize:20}}>🖥️</span>
            <span>No Route to Host</span>
          </div>
          <nav className="nav">
            <button className={screen === 'dashboard' ? 'active' : ''} onClick={() => setScreen('dashboard')}>Scenarios</button>
            <button className={screen === 'author' ? 'active' : ''} onClick={() => setScreen('author')}>Author studio</button>
          </nav>
          <div className="spacer" />
          <div className="pill"><span className="dot" /> Engine ready · {scenarios.length} scenarios</div>
        </header>
      )}

      <div className="content">
        {screen === 'landing' && <Landing onPlay={() => play(scenarios[0]?.id)} onBrowse={() => setScreen('dashboard')} onAuthor={() => setScreen('author')} scenarioCount={scenarios.length} />}
        {screen === 'dashboard' && <Dashboard scenarios={scenarios} solvedIds={solvedIds} onPlay={play} />}
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

      <footer style={{ padding: "16px 22px", textAlign: "center", fontSize: 12, color: "#8b949e", borderTop: "1px solid var(--border)" }}>
        Built by <a href="https://github.com/Sabrinbrin" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>@Sabrinbrin</a> with Kiro
      </footer>

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


function Landing({ onPlay, onBrowse, onAuthor, scenarioCount }: { onPlay: () => void; onBrowse: () => void; onAuthor: () => void; scenarioCount: number }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F4F6FA' }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 40, background: '#F4F6FA' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '26px 26px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#14161B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#E5484D' }}></div>
            </div>
            <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-.2px', color: '#14161B' }}>No Route to Host</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onAuthor} style={{ fontSize: 14, fontWeight: 500, color: '#14161B', padding: '9px 15px', borderRadius: 9, border: '1px solid #E3E7EE', background: '#fff', cursor: 'pointer' }}>For instructors</button>
            <button onClick={onBrowse} style={{ fontSize: 14, fontWeight: 600, color: '#fff', padding: '9px 17px', borderRadius: 9, background: '#4F46E5', border: 'none', cursor: 'pointer' }}>Start training</button>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '54px 26px 40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 500, color: '#5B21B6', background: 'rgba(124,58,237,.09)', border: '1px solid rgba(124,58,237,.2)', padding: '6px 12px', borderRadius: 999 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7C3AED' }}></span>
            Diagnostic training, validated before you play
          </div>
          <h1 style={{ fontSize: 52, lineHeight: 1.04, letterSpacing: '-1.4px', margin: '20px 0 0', fontWeight: 700, color: '#14161B' }}>Learn to find<br/>the one broken<br/>thing.</h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: '#5B6472', margin: '20px 0 0', maxWidth: 440 }}>A broken network, a vague ticket, a ticking clock. Diagnose it through a real vendor CLI and fix the misconfiguration — the way the job actually feels, not the way labs teach it.</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
            <button onClick={onPlay} style={{ fontSize: 15, fontWeight: 600, color: '#fff', padding: '12px 22px', borderRadius: 10, background: '#7C3AED', border: 'none', cursor: 'pointer', boxShadow: '0 6px 18px rgba(124,58,237,.28)' }}>Play scenario 1 →</button>
            <button onClick={onBrowse} style={{ fontSize: 15, fontWeight: 600, color: '#14161B', padding: '12px 22px', borderRadius: 10, border: '1px solid #E3E7EE', background: '#fff', cursor: 'pointer' }}>Browse scenarios</button>
          </div>
          <div style={{ display: 'flex', gap: 26, marginTop: 34 }}>
            <div><div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.5px', color: '#14161B' }}>{scenarioCount}</div><div style={{ fontSize: 12.5, color: '#5B6472', marginTop: 2 }}>scenarios, switching → firewall</div></div>
            <div style={{ width: 1, background: '#E3E7EE' }}></div>
            <div><div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.5px', color: '#14161B' }}>100%</div><div style={{ fontSize: 12.5, color: '#5B6472', marginTop: 2 }}>agent-verified solvable & fair</div></div>
            <div style={{ width: 1, background: '#E3E7EE' }}></div>
            <div><div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.5px', color: '#14161B' }}>0</div><div style={{ fontSize: 12.5, color: '#5B6472', marginTop: 2 }}>labs hand-checked by you</div></div>
          </div>
        </div>

        {/* Terminal mockup */}
        <div style={{ background: '#0E1116', borderRadius: 16, border: '1px solid #21262d', boxShadow: '0 24px 60px rgba(14,17,22,.32)', overflow: 'hidden' }}>
          <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', borderBottom: '1px solid #21262d' }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#F85149' }}></span>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#F5A623' }}></span>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#3FB950' }}></span>
            <span style={{ marginLeft: 10, fontFamily: 'var(--mono)', fontSize: 12, color: '#8B949E' }}>SW1 — console</span>
          </div>
          <div style={{ padding: '16px 18px', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.75 }}>
            <div style={{ color: '#8B949E' }}>SW1# <span style={{ color: '#E6EDF3' }}>ping 10.0.10.1</span></div>
            <div style={{ color: '#F85149' }}>.....  Success rate is 0 percent (0/5)</div>
            <div style={{ color: '#8B949E' }}>SW1# <span style={{ color: '#E6EDF3' }}>show vlan brief</span></div>
            <div style={{ color: '#C9D1D9' }}>10   DATA    active   Gi0/2, Gi0/3</div>
            <div style={{ color: '#C9D1D9' }}>20   VOICE   active   <span style={{ background: 'rgba(248,81,73,.22)', color: '#F85149' }}>Gi0/1</span> ← Host A is here?</div>
            <div style={{ color: '#8B949E', marginTop: 6 }}>SW1(config-if)# <span style={{ color: '#E6EDF3' }}>switchport access vlan 10</span></div>
            <div style={{ color: '#8B949E' }}>SW1# <span style={{ color: '#E6EDF3' }}>ping 10.0.10.1</span></div>
            <div style={{ color: '#3FB950' }}>!!!!!  Success rate is 100 percent (5/5)</div>
            <div style={{ color: '#58A6FF', marginTop: 4 }}>✓ Ticket #4471 resolved<span style={{ display: 'inline-block', width: 8, height: 15, background: '#3FB950', marginLeft: 3, verticalAlign: -2, animation: 'blink 1.1s step-end infinite' }}></span></div>
          </div>
        </div>
      </div>

      {/* Feature cards */}
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '18px 26px 40px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        <div style={{ background: '#fff', border: '1px solid #E3E7EE', borderRadius: 14, padding: 22 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(124,58,237,.1)', color: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: 'var(--mono)' }}>$</div>
          <div style={{ fontWeight: 600, fontSize: 15.5, marginTop: 14, color: '#14161B' }}>Real vendor CLI</div>
          <div style={{ fontSize: 13.5, color: '#5B6472', lineHeight: 1.55, marginTop: 6 }}>IOS, FortiOS, AWS CLI, iptables, PowerShell — with Tab autocomplete and abbreviations.</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E3E7EE', borderRadius: 14, padding: 22 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(18,161,80,.1)', color: '#12A150', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>◇</div>
          <div style={{ fontWeight: 600, fontSize: 15.5, marginTop: 14, color: '#14161B' }}>One fault, deterministic</div>
          <div style={{ fontSize: 13.5, color: '#5B6472', lineHeight: 1.55, marginTop: 6 }}>Constraint evaluation, not packet sim. Each scenario disables exactly one reachability condition.</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E3E7EE', borderRadius: 14, padding: 22 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(124,58,237,.1)', color: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>⚑</div>
          <div style={{ fontWeight: 600, fontSize: 15.5, marginTop: 14, color: '#14161B' }}>Kiro plays it first</div>
          <div style={{ fontSize: 13.5, color: '#5B6472', lineHeight: 1.55, marginTop: 6 }}>On save, a Kiro agent drives the sim through MCP and proves each lab is solvable & fair.</div>
        </div>
      </div>

    </div>
  );
}

function Dashboard({ scenarios, solvedIds, onPlay }: { scenarios: ReturnType<typeof listScenarios>; solvedIds: Set<string>; onPlay: (id: string) => void }) {
  const solvedCount = scenarios.filter(s => solvedIds.has(s.id)).length;
  return (
    <div className="wrap">
      <div className="eyebrow">Training queue</div>
      <h1>Pick a broken network</h1>
      <p className="sub">Every scenario was validated solvable &amp; fair before release. Diagnose, fix, debrief. <b>{solvedCount}/{scenarios.length}</b> solved.</p>
      <div className="grid">
        {scenarios.map((s, i) => (
          <div className={`card click ${solvedIds.has(s.id) ? 'solved' : ''}`} key={s.id} onClick={() => onPlay(s.id)}
            role="button" tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' ? onPlay(s.id) : undefined)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="ticket-num" style={{ width: 30, height: 30, borderRadius: 8, background: solvedIds.has(s.id) ? 'var(--green)' : '#14161b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontWeight: 600 }}>{solvedIds.has(s.id) ? '✓' : i + 1}</span>
                <span className="tag">{TAG(s.difficulty)}</span>
              </div>
              <span className={`chip ${CHIP(s.difficulty)}`}>{DIFF(s.difficulty)}</span>
            </div>
            <div className="title">{s.title}</div>
            <div className="foot">
              <span><span className="dot" style={{ display: 'inline-block', marginRight: 6 }} />{solvedIds.has(s.id) ? 'completed ✓' : 'agent-verified'}</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{solvedIds.has(s.id) ? 'Replay' : i === 0 ? 'Start' : 'Open'} →</span>
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
