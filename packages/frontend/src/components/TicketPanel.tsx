import type { Scenario } from '@nrth/engine';

export function TicketPanel({
  scenario,
  ticketNum,
}: {
  scenario: Scenario;
  ticketNum: number;
}) {
  const { ticket, win_condition, difficulty } = scenario;
  const priority = difficulty <= 1 ? 'P3' : difficulty <= 3 ? 'P2' : 'P1';
  const srcHost =
    scenario.topology.devices.find((d) => d.id === win_condition.source)?.hostname ||
    win_condition.source;
  return (
    <div className="ticket">
      <div className="head">
        <span className="id">TICKET #{4470 + ticketNum}</span>
        <span className="pri">{priority}</span>
      </div>
      <div className="body">
        <div className="t">{ticket.title}</div>
        <p className="sym">{ticket.symptom}</p>
        <div className="win">
          <span style={{ color: 'var(--dim)' }}>Win condition&nbsp;·&nbsp;</span>
          <code>
            ping {srcHost} → {win_condition.destination}
          </code>
        </div>
      </div>
    </div>
  );
}
