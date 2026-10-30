import { useGame } from '../store/game';
import { money } from './common';

export function SummaryModal() {
  const s = useGame((x) => x.summary);
  const next = useGame((x) => x.nextShift);
  const saveOk = useGame((x) => x.saveOk);
  if (!s) return null;
  const rows: [string, string][] = [
    ['Calls answered', String(s.answered)],
    ['Calls missed', String(s.missed)],
    ['Callers lost (hung up or disconnected)', String(s.hungUp)],
    ['Incidents resolved', String(s.resolved)],
    ['Incidents failed', String(s.failed)],
    ['Unresolved at shift end', String(s.unresolved)],
    ['Average response time', s.avgResponse === null ? '—' : `${Math.round(s.avgResponse)}s`],
    ['Dispatch accuracy', `${Math.round(s.accuracy * 100)}%`],
    ['Unnecessary deployments', String(s.unnecessary)],
    ['On-scene decisions made', String(s.decisions)],
    ['Scene complications', String(s.complications)],
    ['Linked incidents', String(s.linked)],
    ['Dispatch spending', money(-s.spent)],
    ['Incident payouts', money(s.reward)],
    ['Net budget change (incl. $2,000 base)', money(s.net)],
    ['Experience earned', `+${s.xp}`],
    ['Reputation change', `${s.reputation >= 0 ? '+' : ''}${s.reputation}`],
  ];
  return (
    <div className="modal">
      <div className="card">
        <div className="gradewrap"><div className={`grade g${s.grade}`}>{s.grade}</div><div><h1>Shift complete</h1><div className="muted">Performance grade</div></div></div>
        <table className="stats"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{v}</td></tr>)}</tbody></table>
        {s.significant.length > 0 && <><h3>Significant incidents</h3><ul className="notes">{s.significant.map((t) => <li key={t}>{t}</li>)}</ul></>}
        {!saveOk && <p className="warnc small">Your browser blocked saving. This progress will be lost on reload.</p>}
        <button className="primary big" onClick={next} autoFocus>Back to briefing</button>
      </div>
    </div>
  );
}
