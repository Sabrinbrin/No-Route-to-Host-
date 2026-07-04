import { useMemo } from 'react';
import { listScenarios } from '../game';

interface ScenarioStats {
  id: string;
  title: string;
  difficulty: number;
  bestTime: number | null;   // seconds
  bestCommands: number | null;
  bestGrade: string | null;
  attempts: number;
}

interface GlobalStats {
  totalSolved: number;
  totalAttempts: number;
  totalScenarios: number;
  averageTime: number | null;
  averageCommands: number | null;
  scenarioStats: ScenarioStats[];
}

const STORAGE_KEY = 'nrth-stats';

export interface CompletionRecord {
  id: string;
  time: number;
  commands: number;
  grade: string;
  timestamp: number;
}

function getGrade(time: number, commands: number): string {
  if (time < 90 && commands < 12) return 'A';
  if (time < 180 && commands < 20) return 'B';
  if (time < 300) return 'C';
  return 'D';
}

export function recordCompletion(id: string, time: number, commands: number): void {
  const grade = getGrade(time, commands);
  const record: CompletionRecord = { id, time, commands, grade, timestamp: Date.now() };
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as CompletionRecord[];
    existing.push(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch { /* localStorage unavailable */ }
}

function loadStats(): CompletionRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as CompletionRecord[];
  } catch { return []; }
}

function computeStats(records: CompletionRecord[]): GlobalStats {
  const scenarios = listScenarios();
  const byId = new Map<string, CompletionRecord[]>();
  for (const r of records) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id)!.push(r);
  }

  const scenarioStats: ScenarioStats[] = scenarios.map(s => {
    const runs = byId.get(s.id) || [];
    if (runs.length === 0) {
      return { id: s.id, title: s.title, difficulty: s.difficulty, bestTime: null, bestCommands: null, bestGrade: null, attempts: 0 };
    }
    const best = runs.reduce((a, b) => {
      const ag = gradeValue(a.grade);
      const bg = gradeValue(b.grade);
      if (ag !== bg) return ag < bg ? a : b;
      return a.time < b.time ? a : b;
    });
    return {
      id: s.id, title: s.title, difficulty: s.difficulty,
      bestTime: best.time, bestCommands: best.commands, bestGrade: best.grade, attempts: runs.length,
    };
  });

  const solved = scenarioStats.filter(s => s.bestGrade !== null);
  const avgTime = solved.length > 0 ? Math.round(solved.reduce((s, x) => s + (x.bestTime ?? 0), 0) / solved.length) : null;
  const avgCmds = solved.length > 0 ? Math.round(solved.reduce((s, x) => s + (x.bestCommands ?? 0), 0) / solved.length) : null;

  return {
    totalSolved: solved.length,
    totalAttempts: records.length,
    totalScenarios: scenarios.length,
    averageTime: avgTime,
    averageCommands: avgCmds,
    scenarioStats,
  };
}

function gradeValue(g: string): number {
  switch (g) { case 'A': return 1; case 'B': return 2; case 'C': return 3; default: return 4; }
}

const GRADE_COLOR: Record<string, string> = { A: 'var(--green)', B: 'var(--accent)', C: 'var(--amber)', D: 'var(--red)' };
const DIFF_LABEL = (d: number) => (d <= 1 ? 'Starter' : d <= 3 ? 'Core' : 'Advanced');

export function StatsView() {
  const records = useMemo(() => loadStats(), []);
  const stats = useMemo(() => computeStats(records), [records]);

  const fmt = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div className="wrap">
      <div className="eyebrow">Progress</div>
      <h1>Training stats</h1>
      <p className="sub">Your performance across all scenarios. Data stored locally in your browser.</p>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 28 }}>
        <StatCard label="Scenarios solved" value={`${stats.totalSolved}/${stats.totalScenarios}`} accent={stats.totalSolved === stats.totalScenarios ? 'var(--green)' : 'var(--accent)'} />
        <StatCard label="Total attempts" value={String(stats.totalAttempts)} accent="var(--accent)" />
        <StatCard label="Avg. time" value={stats.averageTime !== null ? fmt(stats.averageTime) : '—'} accent="var(--amber)" />
        <StatCard label="Avg. commands" value={stats.averageCommands !== null ? String(stats.averageCommands) : '—'} accent="var(--dim)" />
      </div>

      {/* Per-scenario table */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg)', textAlign: 'left' }}>
              <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.3px' }}>Scenario</th>
              <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.3px' }}>Difficulty</th>
              <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.3px' }}>Grade</th>
              <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.3px' }}>Best time</th>
              <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.3px' }}>Commands</th>
              <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.3px' }}>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {stats.scenarioStats.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 500 }}>{s.title}</td>
                <td style={{ padding: '10px 14px', color: 'var(--dim)' }}>{DIFF_LABEL(s.difficulty)}</td>
                <td style={{ padding: '10px 14px' }}>
                  {s.bestGrade ? (
                    <span style={{ fontWeight: 700, fontSize: 15, color: GRADE_COLOR[s.bestGrade] ?? 'var(--dim)' }}>{s.bestGrade}</span>
                  ) : (
                    <span style={{ color: 'var(--dim)' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 12 }}>
                  {s.bestTime !== null ? fmt(s.bestTime) : '—'}
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 12 }}>
                  {s.bestCommands !== null ? s.bestCommands : '—'}
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 12 }}>
                  {s.attempts > 0 ? s.attempts : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {stats.totalAttempts === 0 && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--dim)' }}>
          <p style={{ fontSize: 14 }}>No completions yet. Solve a scenario to see your stats here!</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent, letterSpacing: '-.5px' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>{label}</div>
    </div>
  );
}
