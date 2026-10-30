import { useGame } from '../store/game';
import { money } from './common';

export function SummaryModal() {
  const s = useGame((x) => x.summary);
  const outcome = useGame((x) => x.outcome);
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
    ['Vehicles broken down', String(s.breakdowns)],
    ['Dispatch spending', money(-s.spent)],
    ['Fleet upkeep', money(-s.upkeep)],
    ['Incident payouts', money(s.reward)],
    ['Net budget change (incl. $2,000 base)', money(s.net)],
    ...(outcome && outcome.money ? ([['Career rewards', money(outcome.money)]] as [string, string][]) : []),
    ['Experience earned', `+${outcome?.xp ?? s.xp}`],
    ['Reputation change', `${s.reputation >= 0 ? '+' : ''}${s.reputation}`],
  ];
  return (
    <div className="modal">
      <div className="card">
        <div className="gradewrap"><div className={`grade g${s.grade}`}>{s.grade}</div><div><h1>Shift complete</h1><div className="muted">Performance grade</div></div></div>
        <table className="stats"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{v}</td></tr>)}</tbody></table>
        {outcome && (
          <>
            {outcome.scenario && <p className={outcome.scenario.passed ? 'goodc' : 'warnc'}><b>{outcome.scenario.name}:</b> {outcome.scenario.passed ? (outcome.scenario.first ? 'completed for the first time, with a bonus.' : 'completed again.') : 'goal not reached.'}</p>}
            {outcome.completed.length > 0 && <><h3>Objectives completed</h3><ul className="notes">{outcome.completed.map((o) => <li key={o.id} className="goodc">{o.title} (+{money(o.reward.money)}, +{o.reward.xp} XP)</li>)}</ul></>}
            {outcome.levelUp && <p className="goodc"><b>Level up!</b> You are now level {outcome.level}. +$2,000 bonus.</p>}
            {outcome.unlocked.length > 0 && <p className="goodc">Unlocked: {outcome.unlocked.join(', ')}.</p>}
          </>
        )}
        {s.significant.length > 0 && <><h3>Significant incidents</h3><ul className="notes">{s.significant.map((t) => <li key={t}>{t}</li>)}</ul></>}
        {!saveOk && <p className="warnc small">Your browser blocked saving. This progress will be lost on reload.</p>}
        <button className="primary big" onClick={next} autoFocus>Back to briefing</button>
      </div>
    </div>
  );
}
