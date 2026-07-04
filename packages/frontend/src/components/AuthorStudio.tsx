import { useMemo, useState } from 'react';
import {
  listScenarios,
  getScenario,
  getScenarioYaml,
  validateScenario,
  ValidationReport,
} from '../game';

/**
 * Author Studio — runs the real solvable + fair validation in-browser via the
 * shared engine (the same checks the CI validator and the on-save hook run).
 * No mocks: the verdict is computed live from the selected scenario.
 */
export function AuthorStudio() {
  const scenarios = useMemo(() => listScenarios(), []);
  const [id, setId] = useState(scenarios[0]?.id ?? '');
  const [report, setReport] = useState<ValidationReport | null>(null);
  const yaml = id ? getScenarioYaml(id) : '';

  function validate() {
    const s = getScenario(id);
    if (s) setReport(validateScenario(s));
  }

  return (
    <div className="wrap">
      <div className="eyebrow">Author studio</div>
      <h1>Validate a scenario before it ships</h1>
      <p className="sub">
        The engine plays the scenario and checks it is <b>solvable</b> and <b>fair</b> — the
        identical logic Kiro runs on save and CI runs on every push.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={id} onChange={(e) => { setId(e.target.value); setReport(null); }}
          style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', fontSize: 14 }}>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        <button className="btn primary" onClick={validate}>Validate</button>
      </div>

      <div className="studio">
        <div className="yaml">{yaml}</div>
        <div>
          <div className="block" style={{ marginTop: 0 }}>
            <div className="h">Validation agent</div>
            {!report && <p className="sub" style={{ margin: '10px 0 0' }}>Hit Validate to play this scenario through the engine.</p>}
            {report && (
              <>
                <div className={`verdict ${report.passed ? 'pass' : 'fail'}`}>
                  <b>{report.passed ? 'PASS' : `FAIL · ${report.verdict}`}</b>
                  <div style={{ marginTop: 4, fontSize: 13 }}>{report.details}</div>
                </div>
                <Steps report={report} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Steps({ report }: { report: ValidationReport }) {
  const checks = [
    { label: 'Fault present at load', ok: report.verdict !== 'already-solved' },
    { label: 'Ticket symptom matches fault', ok: report.verdict !== 'symptom-mismatch' },
    { label: 'No trivial unintended fix', ok: report.verdict !== 'unintended-solution' },
    {
      label: `Reference solution restores reachability${report.steps ? ` (${report.steps} steps)` : ''}`,
      ok: report.verdict !== 'unsolvable',
    },
  ];
  return (
    <div style={{ marginTop: 12 }}>
      {checks.map((c) => (
        <div className="step" key={c.label}>
          <span className="mark" style={{ background: c.ok ? 'var(--green)' : 'var(--red)' }}>
            {c.ok ? '✓' : '✕'}
          </span>
          <span>{c.label}</span>
        </div>
      ))}
    </div>
  );
}
