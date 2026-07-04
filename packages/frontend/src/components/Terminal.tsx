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
  'Commands (abbreviations work — e.g. sh ip int bri, conf t, sw acc vlan):',
  '  show interfaces | show ip route | show vlan brief | show running-config',
  '  show ip int brief | show firewall',
  '  ping <ip>                test reachability',
  '  configure terminal       enter config mode (conf t)',
  '  interface <name>         enter interface config (int Gi0/1)',
  '  switchport access vlan <n>   (sw acc vlan)',
  '  switchport trunk allowed vlan add <n>',
  '  ip routing | ip route <net> <mask> <nh>',
  '  no shutdown | shutdown | end | exit',
  '  --- AWS ---',
  '  aws ec2 describe-security-groups | authorize-security-group-ingress',
  '  aws ec2 create-route | describe-route-tables | describe-network-acls',
  '  --- Linux ---',
  '  iptables -L | -A INPUT -p icmp -j ACCEPT | -D INPUT <n>',
  '  systemctl status|start|stop <service> | cat /etc/resolv.conf',
  '  docker ps | docker network ls',
  '  --- Windows (PowerShell) ---',
  '  Get-NetFirewallRule | New-NetFirewallRule | Set-NetFirewallRule',
  '',
  'Tip: Use Tab for autocomplete. Abbreviations work everywhere.',
];

// All known commands/keywords for autocomplete
const COMPLETIONS = [
  'show', 'show interfaces', 'show ip route', 'show ip int brief', 'show ip interface brief',
  'show vlan brief', 'show running-config', 'show firewall',
  'ping', 'configure terminal', 'interface', 'end', 'exit',
  'switchport access vlan', 'switchport trunk allowed vlan add', 'switchport mode',
  'ip routing', 'ip route', 'ip address', 'no shutdown', 'shutdown',
  'set firewall policy',
  'aws ec2 describe-security-groups', 'aws ec2 describe-route-tables',
  'aws ec2 describe-network-acls', 'aws ec2 describe-vpc-peering-connections',
  'aws ec2 authorize-security-group-ingress', 'aws ec2 authorize-security-group-egress',
  'aws ec2 create-route', 'aws ec2 replace-route', 'aws ec2 create-network-acl-entry',
  'iptables -L', 'iptables -A', 'iptables -D', 'iptables -I', 'iptables -P',
  'systemctl status', 'systemctl start', 'systemctl stop', 'systemctl restart',
  'cat /etc/resolv.conf', 'cat /etc/hosts',
  'docker ps', 'docker network ls', 'docker network inspect', 'docker start', 'docker stop',
  'Get-NetFirewallRule', 'New-NetFirewallRule', 'Set-NetFirewallRule',
];

export function TerminalView({ session, device, hostname, onWin }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const line = useRef('');
  const history = useRef<string[]>([]);
  const hIdx = useRef(0);
  const tabMatches = useRef<string[]>([]);
  const tabIdx = useRef(0);
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

  function handleTab() {
    const t = termRef.current!;
    const input = line.current.toLowerCase();
    if (!input) return;

    // If user presses Tab again, cycle through matches
    if (tabMatches.current.length > 0) {
      tabIdx.current = (tabIdx.current + 1) % tabMatches.current.length;
      const match = tabMatches.current[tabIdx.current];
      replaceLine(match);
      return;
    }

    // Find completions that start with current input
    const matches = COMPLETIONS.filter(c => c.toLowerCase().startsWith(input) && c.toLowerCase() !== input);

    if (matches.length === 0) {
      // No exact prefix match — try matching the last word
      const parts = input.split(/\s+/);
      const lastWord = parts[parts.length - 1];
      const prefix = parts.slice(0, -1).join(' ');
      const wordMatches = COMPLETIONS
        .filter(c => c.toLowerCase().startsWith(input.slice(0, input.lastIndexOf(' ') + 1)))
        .filter(c => c.toLowerCase() !== input);

      if (wordMatches.length === 1) {
        replaceLine(wordMatches[0]);
      } else if (wordMatches.length > 1) {
        // Show options
        t.write('\r\n');
        writeOut(wordMatches.slice(0, 8).join('  '), '\x1b[90m');
        t.write(prompt() + line.current);
      }
      return;
    }

    if (matches.length === 1) {
      // Single match — complete it
      replaceLine(matches[0]);
      tabMatches.current = [];
    } else {
      // Multiple matches — complete common prefix and show options
      tabMatches.current = matches;
      tabIdx.current = 0;

      // Find longest common prefix
      let common = matches[0];
      for (const m of matches) {
        while (!m.toLowerCase().startsWith(common.toLowerCase())) {
          common = common.slice(0, -1);
        }
      }

      if (common.length > input.length) {
        replaceLine(common);
      } else {
        // Show all options
        t.write('\r\n');
        writeOut(matches.slice(0, 8).join('  '), '\x1b[90m');
        t.write(prompt() + line.current);
      }
    }
  }

  function runLine(input: string) {
    const t = termRef.current!;
    const cmd = input.trim();
    t.write('\r\n');
    tabMatches.current = [];
    tabIdx.current = 0;

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
        t.write('\x1b[32m\r\n\u2713 Reachability restored \u2014 ticket resolved.\x1b[0m\r\n');
        setTimeout(onWin, 700);
      }
    }
    line.current = '';
    t.write(prompt());
  }

  function replaceLine(next: string) {
    const t = termRef.current!;
    t.write('\r\x1b[K' + prompt() + next);
    line.current = next;
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

    term.write('No Route to Host \u2014 console session\r\n');
    term.write("\x1b[90mType `?` for commands. Tab to autocomplete. Abbreviations work.\x1b[0m\r\n\r\n");
    term.write(prompt());

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    term.onData((data) => {
      const t = termRef.current!;
      if (data === '\r') {
        // Enter
        runLine(line.current);
      } else if (data === '\t') {
        // Tab — autocomplete
        handleTab();
      } else if (data === '\x7f') {
        // Backspace
        if (line.current.length > 0) {
          line.current = line.current.slice(0, -1);
          t.write('\b \b');
          tabMatches.current = [];
          tabIdx.current = 0;
        }
      } else if (data === '\x1b[A') {
        // Arrow Up — history
        if (hIdx.current > 0) {
          hIdx.current--;
          replaceLine(history.current[hIdx.current] ?? '');
        }
      } else if (data === '\x1b[B') {
        // Arrow Down — history
        if (hIdx.current < history.current.length) {
          hIdx.current++;
          replaceLine(history.current[hIdx.current] ?? '');
        }
      } else if (data === '\x03') {
        // Ctrl+C — clear line
        line.current = '';
        tabMatches.current = [];
        t.write('^C\r\n' + prompt());
      } else if (data >= ' ') {
        // Printable character
        line.current += data;
        t.write(data);
        tabMatches.current = [];
        tabIdx.current = 0;
      }
    });

    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when the selected device changes, drop to a fresh prompt
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    line.current = '';
    t.write(`\r\n\x1b[90m\u2014 now on ${hostname} \u2014\x1b[0m\r\n`);
    t.write(prompt());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  return <div className="term-host" ref={hostRef} />;
}
