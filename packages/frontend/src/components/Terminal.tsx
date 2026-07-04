import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { GameSession } from '../game';

interface Props {
  session: GameSession;
  device: string;
  hostname: string;
  onWin: () => void;
}

const HELP = [
  'Commands: show interfaces | show ip route | show vlan brief | show running-config',
  '  ping <ip> | configure terminal | interface <name>',
  '  switchport access vlan <n> | switchport trunk allowed vlan add <n>',
  '  ip routing | ip route <net> <mask> <nh> | no shutdown | end | exit',
];

export function TerminalView({ session, device, hostname, onWin }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const line = useRef('');
  const history = useRef<string[]>([]);
  const hIdx = useRef(0);
  // keep latest props in refs so the onData handler (bound once) sees them
  const ctx = useRef({ session, device, hostname, onWin });
  ctx.current = { session, device, hostname, onWin };

  function prompt(): string {
    const { session, device, hostname } = ctx.current;
    const m = session.mode(device);
    const suffix = m === 'config' ? '(config)' : m === 'config-if' ? '(config-if)' : '';
    return `\x1b[32m${hostname}${suffix}#\x1b[0m `;
  }

  function writeOut(text: string, color?: string) {
    const t = termRef.current!;
    for (const raw of text.split('\n')) {
      const c = color ?? colorFor(raw);
      t.write(`${c}${raw}\x1b[0m\r\n`);
    }
  }

  function colorFor(l: string): string {
    if (l.includes('Success rate is 100') || l.includes('!!!!!')) return '\x1b[32m';
    if (l.includes('Success rate is 0') || l.startsWith('.....')) return '\x1b[31m';
    if (l.startsWith('%')) return '\x1b[90m';
    return '\x1b[37m';
  }

  function runLine(input: string) {
    const t = termRef.current!;
    const cmd = input.trim();
    t.write('\r\n');
    if (cmd) {
      history.current.push(cmd);
      hIdx.current = history.current.length;
    }
    const low = cmd.toLowerCase();
    if (!cmd) {
      // nothing
    } else if (low === '?' || low === 'help') {
      writeOut(HELP.join('\n'), '\x1b[90m');
    } else if (low === 'clear' || low === 'cls') {
      t.clear();
    } else {
      const { session, device, onWin } = ctx.current;
      const r = session.run(device, cmd);
      if (r.output) writeOut(r.output);
      if (r.won) {
        t.write('\x1b[32m\r\n✓ Reachability restored — ticket resolved.\x1b[0m\r\n');
        setTimeout(onWin, 700);
      }
    }
    line.current = '';
    t.write(prompt());
  }

  // mount once
  useEffect(() => {
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
      fontSize: 13,
      theme: { background: '#0e1116', foreground: '#e6edf3', cursor: '#58a6ff' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    fit.fit();
    termRef.current = term;

    term.write('No Route to Host — console session\r\n');
    term.write("\x1b[90mType `?` for available commands. Diagnose, then fix.\x1b[0m\r\n\r\n");
    term.write(prompt());

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    term.onData((data) => {
      const t = termRef.current!;
      if (data === '\r') {
        runLine(line.current);
      } else if (data === '\x7f') {
        if (line.current.length > 0) {
          line.current = line.current.slice(0, -1);
          t.write('\b \b');
        }
      } else if (data === '\x1b[A') {
        if (hIdx.current > 0) {
          hIdx.current--;
          replaceLine(history.current[hIdx.current] ?? '');
        }
      } else if (data === '\x1b[B') {
        if (hIdx.current < history.current.length) {
          hIdx.current++;
          replaceLine(history.current[hIdx.current] ?? '');
        }
      } else if (data >= ' ') {
        line.current += data;
        t.write(data);
      }
    });

    function replaceLine(next: string) {
      const t = termRef.current!;
      t.write('\r\x1b[K' + prompt() + next);
      line.current = next;
    }

    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when the selected device changes, drop to a fresh prompt for it
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    line.current = '';
    t.write(`\r\n\x1b[90m— now on ${hostname} —\x1b[0m\r\n`);
    t.write(prompt());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  return <div className="term-host" ref={hostRef} />;
}
