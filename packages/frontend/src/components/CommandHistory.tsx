import { useRef, useEffect } from 'react';

export interface HistoryEntry {
  id: number;
  device: string;
  hostname: string;
  command: string;
  timestamp: number;
  stateChanged: boolean;
}

interface Props {
  entries: HistoryEntry[];
  startTime: number;
}

/**
 * Command History panel — scrollable log of every command issued during
 * the current play session, with timestamps and state-change indicators.
 */
export function CommandHistory({ entries, startTime }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  const elapsed = (ts: number) => {
    const s = Math.floor((ts - startTime) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="block" style={{ marginTop: 14 }}>
      <div className="h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Command log</span>
        <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 400 }}>
          {entries.length} cmd{entries.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{
        marginTop: 8, maxHeight: 160, overflowY: 'auto', fontSize: 11,
        fontFamily: 'var(--mono)', lineHeight: 1.7,
      }}>
        {entries.length === 0 && (
          <div style={{ color: 'var(--dim)', fontStyle: 'italic', padding: '8px 0' }}>
            Commands will appear here as you type them...
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '2px 0' }}>
            <span style={{ color: '#8b949e', flexShrink: 0 }}>{elapsed(e.timestamp)}</span>
            <span style={{ color: '#58a6ff', flexShrink: 0 }}>{e.hostname}</span>
            <span style={{ color: e.stateChanged ? 'var(--green)' : '#c9d1d9', wordBreak: 'break-all' }}>
              {e.command}
              {e.stateChanged && <span style={{ color: 'var(--green)', marginLeft: 4 }}>*</span>}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
