import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listScenarios,
  getScenarioYaml,
  validateScenario,
  ValidationReport,
} from '../game';
import { parseScenario } from '@nrth/engine';

const BLANK_TEMPLATE = `id: my-new-scenario
title: My New Scenario
difficulty: 2

topology:
  devices:
    - id: client
      hostname: ClientPC
      type: host
      interfaces:
        - name: eth0
          ip: 192.168.1.10
          mask: 255.255.255.0
          gateway: 192.168.1.1
          status: up
      routing:
        enabled: false
        routes: []
        svis: []

    - id: switch1
      hostname: SW1
      type: switch
      interfaces:
        - name: Gi0/1
          mode: access
          accessVlan: 10
          status: up
        - name: Gi0/2
          mode: access
          accessVlan: 10
          status: up
      routing:
        enabled: true
        routes: []
        svis:
          - vlan: 10
            ip: 192.168.1.1
            mask: 255.255.255.0
            status: up

    - id: server
      hostname: Server
      type: host
      interfaces:
        - name: eth0
          ip: 192.168.1.20
          mask: 255.255.255.0
          gateway: 192.168.1.1
          status: up
      routing:
        enabled: false
        routes: []
        svis: []

  links:
    - id: link1
      from: { device: client, interface: eth0 }
      to: { device: switch1, interface: Gi0/1 }
    - id: link2
      from: { device: server, interface: eth0 }
      to: { device: switch1, interface: Gi0/2 }

injected_fault:
  device: switch1
  interface: Gi0/1
  field: accessVlan
  value: 99
  action: set

ticket:
  title: Client can't reach the server
  symptom: ClientPC (192.168.1.10) cannot ping Server (192.168.1.20). Both are connected to SW1.
  affected_hosts:
    - client

win_condition:
  type: ping
  source: client
  destination: 192.168.1.20
  expected: success

reference_solution:
  - device: switch1
    commands:
      - configure terminal
      - interface Gi0/1
      - switchport access vlan 10
      - end
`;

/**
 * Author Studio — a full scenario authoring tool with live validation.
 *
 * Authors can:
 * 1. Create a brand new scenario from a blank template
 * 2. Load and edit any existing scenario
 * 3. Write YAML from scratch (topology, fault, ticket, solution)
 * 4. See live validation results (auto-validates on edit, debounced)
 * 5. Download the scenario as a .yaml file
 *
 * The validation is identical to what the CI gate and on-save hook run —
 * same engine, same fairness checks, same pass/fail criteria.
 */
export function AuthorStudio() {
  const scenarios = useMemo(() => listScenarios(), []);
  const [mode, setMode] = useState<'new' | 'edit'>('new');
  const [id, setId] = useState('');
  const [yaml, setYaml] = useState(BLANK_TEMPLATE);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [autoValidate, setAutoValidate] = useState(true);
  const [dirty, setDirty] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [originalYaml, setOriginalYaml] = useState(BLANK_TEMPLATE);

  // Start new scenario
  function startNew() {
    setMode('new');
    setId('');
    setYaml(BLANK_TEMPLATE);
    setOriginalYaml(BLANK_TEMPLATE);
    setReport(null);
    setParseError(null);
    setDirty(false);
  }

  // Load existing scenario
  function loadExisting(scenarioId: string) {
    setMode('edit');
    setId(scenarioId);
    const content = getScenarioYaml(scenarioId);
    setYaml(content);
    setOriginalYaml(content);
    setReport(null);
    setParseError(null);
    setDirty(false);
  }

  // Validate current YAML content
  const runValidation = useCallback((content: string) => {
    try {
      const scenario = parseScenario(content);
      if (!scenario || !scenario.id || !scenario.topology) {
        setParseError('Invalid scenario: missing required fields (id, topology, injected_fault, ticket, win_condition, reference_solution)');
        setReport(null);
        return;
      }
      if (!scenario.injected_fault) {
        setParseError('Missing field: injected_fault');
        setReport(null);
        return;
      }
      if (!scenario.ticket) {
        setParseError('Missing field: ticket (needs title, symptom, affected_hosts)');
        setReport(null);
        return;
      }
      if (!scenario.win_condition) {
        setParseError('Missing field: win_condition (needs type, source, destination, expected)');
        setReport(null);
        return;
      }
      if (!scenario.reference_solution || !Array.isArray(scenario.reference_solution)) {
        setParseError('Missing field: reference_solution (array of {device, commands[]})');
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
    setDirty(newContent !== originalYaml);

    if (autoValidate) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runValidation(newContent), 600);
    }
  }

  // Manual validate
  function validate() {
    runValidation(yaml);
  }

  // Reset
  function reset() {
    setYaml(originalYaml);
    setDirty(false);
    setParseError(null);
    if (originalYaml) runValidation(originalYaml);
    else setReport(null);
  }

  // Download scenario YAML
  function download() {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    let filename = 'new-scenario';
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
    if (yaml && yaml !== BLANK_TEMPLATE) runValidation(yaml);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Get filename for display
  let displayFile = mode === 'new' ? 'new-scenario.yaml' : `${id}.yaml`;
  try {
    const parsed = parseScenario(yaml);
    if (parsed?.id) displayFile = parsed.id + '.yaml';
  } catch { /* keep default */ }

  return (
    <div className="wrap">
      <div className="eyebrow">Author studio</div>
      <h1>Create &amp; validate scenarios</h1>
      <p className="sub">
        Write a scenario from scratch or edit an existing one. The engine validates live —
        the same checks the <b>on-save hook</b> and <b>CI pipeline</b> run.
      </p>

      {/* Mode selector + Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className={`btn ${mode === 'new' ? 'primary' : ''}`}
          onClick={startNew}
          title="Start with a blank template"
        >
          + New scenario
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>or</span>
        <select
          value={id}
          onChange={(e) => loadExisting(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', fontSize: 14 }}
        >
          <option value="" disabled>Load existing…</option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />
        <button className="btn primary" onClick={validate}>Validate</button>
        <button className="btn" onClick={reset} disabled={!dirty} title="Reset to original">Reset</button>
        <button className="btn" onClick={download} title="Download as .yaml file">
          ↓ Download
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={autoValidate}
            onChange={(e) => setAutoValidate(e.target.checked)}
          />
          Live validation
        </label>
      </div>

      {/* Editor + Validation Panel */}
      <div className="studio">
        {/* YAML Editor */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
              scenarios/{displayFile}
            </span>
            {mode === 'new' && !dirty && (
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'rgba(46,92,255,.08)', padding: '2px 8px', borderRadius: 6 }}>
                ✦ new
              </span>
            )}
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
            placeholder="Write your scenario YAML here..."
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
                {autoValidate
                  ? 'Edit the YAML to see live validation…'
                  : 'Hit Validate to check this scenario.'}
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

          {/* Schema reference */}
          <div className="block" style={{ marginTop: 16 }}>
            <div className="h">Required fields</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginTop: 8, fontFamily: 'var(--mono)' }}>
              <div><b>id:</b> unique-kebab-case</div>
              <div><b>title:</b> Human Readable Title</div>
              <div><b>difficulty:</b> 1-5</div>
              <div><b>topology:</b></div>
              <div>&nbsp; <b>devices:</b> [{'{'}id, hostname, type, interfaces, routing{'}'}]</div>
              <div>&nbsp; <b>links:</b> [{'{'}id, from, to{'}'}]</div>
              <div><b>injected_fault:</b> {'{'}device, field, value, action{'}'}</div>
              <div><b>ticket:</b> {'{'}title, symptom, affected_hosts{'}'}</div>
              <div><b>win_condition:</b> {'{'}type: ping, source, destination, expected{'}'}</div>
              <div><b>reference_solution:</b> [{'{'}device, commands[]'}{'}]</div>
            </div>
          </div>

          {/* Supported device types */}
          <div className="block" style={{ marginTop: 16 }}>
            <div className="h">Device types</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginTop: 8 }}>
              <div><code>switch</code> · <code>router</code> · <code>firewall</code> · <code>host</code></div>
              <div><code>ec2</code> · <code>vpc-router</code> (AWS)</div>
              <div><code>linux-server</code> · <code>windows-server</code> · <code>docker-host</code></div>
            </div>
          </div>

          {/* Fairness rules */}
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

          {/* Workflow */}
          <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.3px', textTransform: 'uppercase' }}>
              Workflow
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 6 }}>
              1. Click <b>+ New scenario</b> or load an existing one<br/>
              2. Edit topology, fault, ticket, and solution<br/>
              3. Watch the live validation — aim for <b>PASS</b><br/>
              4. Click <b>↓ Download</b> and drop in <code>scenarios/</code><br/>
              5. The on-save hook confirms it on disk
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
