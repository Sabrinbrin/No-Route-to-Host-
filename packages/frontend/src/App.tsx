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
          title={session.scenario.title}
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
            <span className="name">{hostname} — console session</span>
            <button className="reset" onClick={onReset}>reset</button>
          </div>
          <TerminalView session={session} device={device} hostname={hostname} onWin={onWin} />
          <div className="devtabs">
            {session.network.devices.map((d) => (
              <button key={d.id} className={`devtab ${d.id === device ? 'active' : ''}`} onClick={() => onDevice(d.id)}>
                {d.hostname}
              </button>
            ))}
          </div>
        </div>
        <div className="side">
          <TicketPanel scenario={session.scenario} ticketNum={ticketNum} />
          <Topology network={session.network} solved={solved} />
          <div style={{ marginTop: 14, fontFamily: 'var(--mono)', fontSize: 12, color: '#8b949e', padding: '0 4px' }}>
            try: show running-config · ping {session.scenario.win_condition.destination} · ?
          </div>
        </div>
      </div>
    </div>
  );
}

function Debrief({ title, seconds, commands, onNext }: { title: string; seconds: number; commands: number; onNext: () => void }) {
  const grade = seconds < 90 && commands < 12 ? 'A' : seconds < 180 && commands < 20 ? 'B' : seconds < 300 ? 'C' : 'D';
  const color = grade === 'A' ? 'var(--green)' : grade === 'B' ? 'var(--accent)' : grade === 'C' ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="overlay">
      <div className="modal">
        <h2>Ticket resolved</h2>
        <div className="sub" style={{ margin: 0 }}>{title}</div>
        <div className="grade" style={{ color }}>{grade}</div>
        <div className="sub" style={{ margin: 0 }}>{seconds}s · {commands} commands</div>
        <div className="row">
          <button className="btn primary" onClick={onNext}>Next scenario →</button>
        </div>
      </div>
    </div>
  );
}
