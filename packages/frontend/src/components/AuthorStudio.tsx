import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listScenarios,
  getScenario,
  getScenarioYaml,
  validateScenario,
  ValidationReport,
} from '../game';
import { parseScenario } from '@nrth/engine';

/**
 * Author Studio — a real scenario editor with live validation.
 *
 * Authors can:
 * 1. Select any scenario from the dropdown
 * 2. Edit the YAML directly in the textarea
 * 3. See live validation results (auto-validates on edit, debounced)
 * 4. Download the edited scenario as a .yaml file
 * 5. Reset to the original scenario content
 *
 * The validation is identical to what the CI gate and on-save hook run —
 * same engine, same fairness checks, same pass/fail criteria.
 */
export function AuthorStudio() {
  const scenarios = useMemo(() => listScenarios(), []);
  const [id, setId] = useState(scenarios[0]?.id ?? '');
  const [yaml, setYaml] = useState(() => getScenarioYaml(scenarios[0]?.id ?? ''));
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [autoValidate, setAutoValidate] = useState(true);
  const [dirty, setDirty] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Switch scenario
  function selectScenario(newId: string) {
    setId(newId);
    const original = getScenarioYaml(newId);
    setYaml(original);
    setReport(null);
    setParseError(null);
    setDirty(false);
  }

  // Validate current YAML content
  const runValidation = useCallback((content: string) => {
    try {
      const scenario = parseScenario(content);
      if (!scenario || !scenario.id || !scenario.topology) {
        setParseError('Invalid scenario: missing required fields (id, topology)');
        setReport(null);
        return;
      }
      setParseError(null);
      const result = validateScenario(scenario);
      setReport(result);
    } catch (e: any) {
      setParseError(e.message || 'YAML parse error');
      setReport(null);
    }
  }, []);

  // Handle YAML edit
  function handleYamlChange(newContent: string) {
    setYaml(newContent);
    setDirty(newContent !== getScenarioYaml(id));

    if (autoValidate) {
      // Debounce validation to avoid running on every keystroke
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runValidation(newContent), 600);
    }
  }

  // Manual validate
  function validate() {
    runValidation(yaml);
  }

  // Reset to original
  function reset() {
    const original = getScenarioYaml(id);
    setYaml(original);
    setDirty(false);
    setParseError(null);
    runValidation(original);
  }

  // Download scenario YAML
  function download() {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Use the scenario id for filename, fallback to selected id
    let filename = id;
    try {
      const parsed = parseScenario(yaml);
      if (parsed?.id) filename = parsed.id;
    } catch { /* use fallback */ }
    a.download = `${filename}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Auto-validate on first load
  useEffect(() => {
    if (yaml) runValidation(yaml);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return (
    <div className="wrap">
      <div className="eyebrow">Author studio</div>
      <h1>Edit &amp; validate scenarios live</h1>
      <p className="sub">
        Edit the YAML below. The engine validates in real-time — the same checks the{' '}
        <b>on-save hook</b> and <b>CI pipeline</b> run. Download when you're done.
      </p>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={id}
          onChange={(e) => selectScenario(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', fontSize: 14 }}
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        <button className="btn primary" onClick={validate}>Validate</button>
        <button className="btn" onClick={reset} disabled={!dirty} title="Reset to original">Reset</button>
        <button className="btn" onClick={download} title="Download as .yaml file">
          ↓ Download .yaml
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={autoValidate}
            onChange={(e) => setAutoValidate(e.target.checked)}
          />
          Auto-validate on edit
        </label>
      </div>

      {/* Editor + Validation Panel */}
      <div className="studio">
        {/* YAML Editor */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
              scenarios/{id}.yaml
            </span>
            {dirty && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#f5a623', background: 'rgba(245,166,35,.12)', padding: '2px 8px', borderRadius: 6 }}>
                ● modified
              </span>
            )}
          </div>
          <textarea
            className="yaml-editor"
            value={yaml}
            onChange={(e) => handleYamlChange(e.target.value)}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {/* Validation Panel */}
        <div>
          <div className="block" style={{ marginTop: 0 }}>
            <div className="h">Validation agent</div>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Same engine as <code>npm run validate</code> and the on-save hook.
            </p>

            {parseError && (
              <div className="verdict fail" style={{ marginTop: 12 }}>
                <b>PARSE ERROR</b>
                <div style={{ marginTop: 4, fontSize: 13, fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap' }}>
                  {parseError}
                </div>
              </div>
            )}

            {!parseError && !report && (
              <p className="sub" style={{ margin: '14px 0 0' }}>
                {autoValidate ? 'Start typing to see live validation...' : 'Hit Validate to check this scenario.'}
              </p>
            )}

            {!parseError && report && (
              <>
                <div className={`verdict ${report.passed ? 'pass' : 'fail'}`}>
                  <b>{report.passed ? `PASS · solvable in ${report.steps} steps, fair` : `FAIL · ${report.verdict}`}</b>
                  <div style={{ marginTop: 4, fontSize: 13 }}>{report.details}</div>
                </div>
                <Steps report={report} />
              </>
            )}
          </div>

          {/* Fairness rules reference */}
          <div className="block" style={{ marginTop: 16 }}>
            <div className="h">Fairness rules</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 8 }}>
              <div>◇ Fault must be present at load (win=false)</div>
              <div>◇ Ticket symptom must match the injected fault</div>
              <div>◇ Reference solution must restore reachability</div>
              <div>◇ No trivial unintended alternative fix</div>
              <div>◇ The fix must actually change device state</div>
            </div>
          </div>

          {/* Workflow hint */}
          <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.3px', textTransform: 'uppercase' }}>
              Workflow
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 6 }}>
              1. Edit the YAML (topology, fault, ticket, solution)<br/>
              2. Watch the live validation update<br/>
              3. When it says PASS, click <b>Download</b><br/>
              4. Drop the file in <code>scenarios/</code> — the on-save hook confirms it
            </div>
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
    { label: 'Fix changes device state', ok: report.verdict !== 'unintended-solution' },
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
