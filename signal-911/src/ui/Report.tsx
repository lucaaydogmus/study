import { auditCalls } from '../sim/ops';
import { useEffect, useMemo, useRef, useState } from 'react';
import { gameClock } from '../sim/engine';
import { averageOf } from '../sim/scoring';
import { rankDef } from '../sim/progression';
import { SERVICE_META } from '../sim/fleet';
import { getCity, WORLD_H, WORLD_W } from '../sim/city';
import { CHAPTERS } from '../sim/scenarios';
import type { Service, TimelineEntry } from '../sim/types';
import { useApp } from '../store';
import { Badge, Bar, Btn, Grade, Icon, fmtEta, fmtMoney, fmtTime } from './common';
import { CATEGORY_NAMES } from './report-helpers';
import { AchievementCard, ExtrasList } from './Extras';

const KIND_COLOR: Record<string, string> = { call: '#4A9CD6', dispatch: '#98A6B5', arrival: '#54B889', escalation: '#E5AC4D', resolved: '#54B889', failed: '#D65353', event: '#c58bd6', info: '#6b7a8a', missed: '#D65353', radio: '#6b7a8a' };

export function ReportScreen() {
  const { result, endState: st, session, profile, go, endlessOver, newAchievements } = useApp();
  const [filter, setFilter] = useState<Record<string, boolean>>({ call: true, dispatch: true, arrival: true, escalation: true, resolved: true, failed: true, event: true, missed: true, info: false });
  const [hot, setHot] = useState<number | null>(null);
  const city = getCity();
  if (!result || !st || !session) return <div className="screen"><Btn onClick={() => go('menu')}>Menu</Btn></div>;
  const s = st.stats, sc = result.score;
  const career = session.kind === 'career' || session.kind === 'chapter';
  const incs = Object.values(st.incidents);
  const events = useMemo(() => st.timeline.filter((t) => filter[t.kind]), [filter, st]);
  const dur = Math.max(st.time, 1);
  const chapter = result.chapterCompleted ? CHAPTERS.find((c) => c.id === result.chapterCompleted) : null;
  const finish = () => {
    if (career) go('hub', 'overview');
    else if (session.kind === 'endless' && !endlessOver) useApp.getState().startEndless(false);
    else if (session.kind === 'tutorial') go('modes');
    else go('modes');
  };
  const retry = () => {
    const sess = { ...session, config: { ...session.config, seed: Math.floor(Math.random() * 2 ** 31) } };
    if (session.kind === 'tutorial') useApp.getState().startTutorial();
    else if (career) { go('hub', 'prep'); }
    else useApp.getState().brief(sess);
  };
  const acc = s.dispatches ? Math.round(((s.correctDispatches) / s.dispatches) * 100) : 100;
  const Row = ({ k, v, tone }: { k: string; v: string | number; tone?: string }) => <div className="kv"><span>{k}</span><b className={tone}>{v}</b></div>;
  return (
    <div className="screen report">
      <header className="screen-head"><h1>Shift report — {st.config.title}</h1><div className="grow" />{session.kind === 'endless' && <Badge tone={endlessOver ? 'red' : 'green'}>{endlessOver ? 'RUN OVER' : 'SURVIVED'}</Badge>}</header>
      <div className="screen-body">
        <div className="report-top">
          <div className="card gradecard"><Grade g={sc.grade} size={120} /><div><div className="bignum">{sc.total}<span className="muted small"> / 100</span></div><div className="muted">Performance score</div></div></div>
          <div className="card grow">
            {(['response', 'outcomes', 'accuracy', 'calls', 'coverage'] as const).map((k) => (
              <div className="kv" key={k}><span>{{ response: 'Response time', outcomes: 'Incident outcomes', accuracy: 'Dispatch accuracy', calls: 'Call handling', coverage: 'District coverage' }[k]}</span><Bar value={sc[k] * 100} tone={sc[k] > 0.75 ? 'green' : sc[k] > 0.5 ? 'blue' : sc[k] > 0.3 ? 'amber' : 'red'} /><span className="mono small">{Math.round(sc[k] * 100)}</span></div>
            ))}
            {sc.penalties > 0 && <div className="kv"><span>Penalties</span><b className="red">−{Math.round(sc.penalties)}</b></div>}
          </div>
          <div className="card rewards">
            <h3>Rewards</h3>
            <div className="kv"><span>XP earned</span><b>+{result.xp}</b></div>
            {career && <><div className="kv"><span>Net funds</span><b className={result.money >= 0 ? 'green' : 'red'}>{fmtMoney(result.money)}</b></div><div className="kv"><span>Reputation</span><b className={result.repDelta >= 0 ? 'green' : 'red'}>{result.repDelta >= 0 ? '+' : ''}{result.repDelta}</b></div></>}
            {result.promotedTo && <div className="promo"><Icon n="trophy" size={18} /> <div><b>Promoted to {rankDef(result.promotedTo).title}!</b><div className="small">Unlocked: {result.unlocked.join(' · ')}</div></div></div>}
            {chapter && <div className="promo"><Icon n="check" size={18} /> <div><b>Chapter complete: {chapter.title}</b><div className="small">{chapter.outro}</div></div></div>}
          </div>
        </div>

        {newAchievements.length > 0 && <div className="card"><h3><Icon n="trophy" size={14} /> Achievements unlocked</h3><div className="newach">{newAchievements.map((id) => <AchievementCard key={id} id={id} got />)}</div></div>}
        {((st.config.contracts?.length ?? 0) > 0 || (st.config.modifiers?.length ?? 0) > 0) && <div className="card"><h3>Conditions & contracts</h3><ExtrasList config={st.config} st={st} /><div className="kv"><span>Best streak</span><b>{st.stats.bestStreak}</b></div></div>}
        {st.config.objectives.length > 0 && <div className="card"><h3>Objectives</h3><div className="objrow">{st.config.objectives.map((o) => <div key={o.id} className={`obj ${o.done ? 'ok' : 'no'}`}><Icon n={o.done ? 'check' : 'x'} size={14} /> {o.text}{o.optional ? ' (optional)' : ''}<span className="mono small muted"> {o.value !== undefined ? `· ${o.value}` : ''}</span></div>)}</div></div>}

        {(() => {
          const cons = incs.flatMap((i) => (i.consequences ?? []).map((c) => ({ c, i })));
          const any = cons.length || s.aidGood || s.aidBad || (s.checksOk ?? 0) + (s.checksBad ?? 0) + (s.checksMissed ?? 0) || (s.heliRelays ?? 0);
          if (!any) return null;
          return (
            <div className="card guidance"><h3><Icon n="pulse" size={14} /> Your guidance & radio work</h3>
              <div className="cols3 tight">
                <div><Row k="Correct first-aid instructions" v={s.aidGood} tone={s.aidGood ? 'green' : ''} /><Row k="Harmful instructions" v={s.aidBad} tone={s.aidBad ? 'red' : ''} /><Row k="Lives saved by your coaching" v={s.guidanceSaves ?? 0} tone={(s.guidanceSaves ?? 0) ? 'green' : ''} /><Row k="Deaths without first aid" v={s.guidanceDeaths ?? 0} tone={(s.guidanceDeaths ?? 0) ? 'red' : ''} /></div>
                <div><Row k="Records returns correct" v={s.checksOk ?? 0} tone={(s.checksOk ?? 0) ? 'green' : ''} /><Row k="Wrong returns" v={s.checksBad ?? 0} tone={(s.checksBad ?? 0) ? 'red' : ''} /><Row k="Requests left unanswered" v={s.checksMissed ?? 0} tone={(s.checksMissed ?? 0) ? 'amber' : ''} /></div>
                <div><Row k="Air sightings" v={s.heliSightings ?? 0} /><Row k="Air positions relayed" v={s.heliRelays ?? 0} tone={(s.heliRelays ?? 0) ? 'green' : ''} /><Row k="Pursuits stopped" v={s.pursuitsCaught} /></div>
              </div>
              {cons.length > 0 && <ul className="cons">{cons.map(({ c, i }, k) => <li key={k} className={/kept the patient alive/.test(c) ? 'good' : 'bad'}><Icon n={/kept the patient alive/.test(c) ? 'heart' : 'alert'} size={12} /> <b>{i.label}:</b> {c}</li>)}</ul>}
            </div>
          );
        })()}

        <div className="cols3">
          <div className="card"><h3>Calls & incidents</h3>
            <Row k="Calls received" v={s.callsReceived} /><Row k="Calls answered" v={s.callsAnswered} /><Row k="Calls missed" v={s.callsMissed} tone={s.callsMissed ? 'red' : ''} />
            <Row k="Avg time to answer" v={s.answerTimes.length ? `${averageOf(s.answerTimes).toFixed(1)} s` : '—'} /><Row k="Incidents resolved" v={s.resolved} /><Row k="Incidents failed" v={s.failed} tone={s.failed ? 'red' : ''} />
            <Row k="Handed to next shift" v={s.handedOver} /><Row k="Escalations" v={s.escalations} /><Row k="Callbacks" v={s.callbacks} />
            <Row k="Duplicate calls linked" v={s.merges} /><Row k="Pursuits stopped" v={s.pursuitsCaught} /><Row k="Callers calmed" v={s.calmedCallers} /><Row k="Best streak" v={s.bestStreak} />
          </div>
          <div className="card"><h3>Response & dispatch</h3>
            <Row k="Avg response time" v={s.responseTimes.length ? fmtEta(averageOf(s.responseTimes)) : '—'} />
            {(['police', 'fire', 'medical'] as Service[]).map((x) => <Row key={x} k={`${SERVICE_META[x].label} response`} v={s.serviceResponse[x].length ? fmtEta(averageOf(s.serviceResponse[x])) : '—'} />)}
            <Row k="Dispatch accuracy" v={`${acc}%`} /><Row k="Unnecessary deployments" v={s.unnecessary} tone={s.unnecessary ? 'amber' : ''} /><Row k="Wrong-address dispatches" v={s.wrongLocations} tone={s.wrongLocations ? 'amber' : ''} />
            <Row k="Broken promises" v={s.promisesBroken} tone={s.promisesBroken ? 'amber' : ''} /><Row k="Unit utilisation" v={`${Math.round((s.unitBusySeconds / Math.max(1, s.unitSeconds)) * 100)}%`} />
          </div>
          <div className="card"><h3>People</h3>
            <Row k="Lives helped" v={s.livesHelped} tone="green" /><Row k="Casualties" v={s.casualties} tone={s.casualties ? 'red' : 'green'} /><Row k="Cases mishandled" v={s.mishandled} tone={s.mishandled ? 'red' : ''} /><Row k="False alarms identified" v={s.falseAlarms} />
            <h4>By category</h4>
            {Object.entries(s.byCategory).map(([k, v]) => <div className="kv" key={k}><span>{CATEGORY_NAMES[k] ?? k}</span><b>{v.ok}/{v.n} successful</b></div>)}
          </div>
        </div>

        {(st.replay?.length ?? 0) > 5 && <div className="card"><h3><Icon n="clock" size={14} /> Your shift in 30 seconds</h3><ShiftReplay st={st} /></div>}
        {(() => { const audits = auditCalls(st); return audits.length ? (
          <div className="card audit"><h3><Icon n="note" size={14} /> Supervisor’s call review</h3>
            <p className="small muted">Okafor pulled {audits.length} of your calls and graded them against the protocol.</p>
            <div className="auditgrid">{audits.map((a) => (
              <div className="auditcall" key={a.incId}>
                <div className="ac-head"><b>{a.label}</b><span className="muted small">· {a.caller}</span><span className={`ac-score ${a.score >= 80 ? 'good' : a.score >= 55 ? 'mid' : 'bad'}`}>{a.score}%</span></div>
                {a.items.map((i, k) => <div key={k} className={`ac-item ${i.ok ? 'ok' : 'no'}`}><Icon n={i.ok ? 'check' : 'x'} size={11} /> {i.text}</div>)}
              </div>))}</div>
            <div className="small muted">{[st.stats.hoaxesCaught ? `${st.stats.hoaxesCaught} hoax${st.stats.hoaxesCaught > 1 ? 'es' : ''} caught` : '', st.stats.emergenciesHandled ? `${st.stats.emergenciesHandled} emergency activation${st.stats.emergenciesHandled > 1 ? 's' : ''} handled` : '', st.stats.needsMissed ? `${st.stats.needsMissed} crew request${st.stats.needsMissed > 1 ? 's' : ''} never answered` : '', st.stats.directivesDone ? `${st.stats.directivesDone} supervisor directive${st.stats.directivesDone > 1 ? 's' : ''} met` : '', st.stats.pursuitCrashes ? `${st.stats.pursuitCrashes} pursuit crash${st.stats.pursuitCrashes > 1 ? 'es' : ''}` : ''].filter(Boolean).join(' · ')}</div>
          </div>) : null; })()}
        {career && <div className="card"><h3>Budget</h3><div className="moneytable">{result.moneyBreakdown.map(([k, v]) => <div className="kv" key={k}><span>{k}</span><b className={v >= 0 ? 'green' : 'red'}>{fmtMoney(v)}</b></div>)}<div className="kv total"><span>Net</span><b className={result.money >= 0 ? 'green' : 'red'}>{fmtMoney(result.money)}</b></div></div>
          <h4>XP breakdown</h4>{result.xpBreakdown.map(([k, v]) => <div className="kv" key={k}><span>{k}</span><b>+{v}</b></div>)}</div>}

        <div className="card"><h3>District coverage during the shift</h3>
          <div className="covgrid">{st.config.districts.map((d) => { const arr = s.districtCoverage[d] ?? []; const v = arr.length ? averageOf(arr) : 0; return <div key={d} className="kv"><span>{city.districtById[d].name}</span><Bar value={v * 100} tone={v > 0.6 ? 'green' : v > 0.35 ? 'amber' : 'red'} /><span className="mono small">{Math.round(v * 100)}%</span></div>; })}</div></div>

        <div className="card"><h3>Incident log</h3>
          <table className="tbl"><thead><tr><th>#</th><th>Incident</th><th>District</th><th>Severity</th><th>Outcome</th><th>Response</th><th>Notes</th></tr></thead>
            <tbody>{incs.map((i) => (<tr key={i.id}><td className="mono">{String(i.num).padStart(3, '0')}</td><td>{i.label}</td><td>{city.districtById[i.district].name}</td><td>{'●'.repeat(i.severity)}</td>
              <td><Badge tone={i.outcome === 'success' || i.outcome === 'false_alarm' ? 'green' : i.outcome === 'merged' ? 'blue' : i.outcome === 'partial' || i.outcome === 'handover' ? 'amber' : 'red'}>{(i.outcome ?? 'open').replace('_', ' ').toUpperCase()}</Badge></td>
              <td className="mono">{i.firstArrivalAt !== null ? fmtEta(i.firstArrivalAt - (i.answeredAt ?? i.createdAt)) : '—'}</td>
              <td className="small muted">{[i.stage ? `escalated ×${i.stage}` : '', i.casualties ? `${i.casualties} casualt${i.casualties > 1 ? 'ies' : 'y'}` : '', i.mislocated ? 'wrong address' : '', i.unnecessary ? `${i.unnecessary} unneeded unit(s)` : '', i.twistRevealed && i.requires.length === 0 ? 'false alarm' : ''].filter(Boolean).join(' · ')}</td></tr>))}
              {!incs.length && <tr><td colSpan={7} className="muted">No incidents.</td></tr>}</tbody></table></div>

        <div className="card"><h3>Timeline</h3>
          <div className="seg wrap">{Object.keys(KIND_COLOR).filter((k) => k !== 'radio').map((k) => <button key={k} className={filter[k] ? 'on' : ''} aria-pressed={!!filter[k]} onClick={() => setFilter({ ...filter, [k]: !filter[k] })}><i className="kdot" style={{ background: KIND_COLOR[k] }} /> {k}</button>)}</div>
          <svg className="timeline" viewBox="0 0 1000 70" preserveAspectRatio="none" role="img" aria-label="Shift timeline">
            <line x1="10" y1="35" x2="990" y2="35" stroke="#2b3747" strokeWidth="2" />
            {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={10 + f * 980} x2={10 + f * 980} y1="30" y2="40" stroke="#3a4a5e" /><text x={10 + f * 980} y="64" fill="#98A6B5" fontSize="11" textAnchor="middle">{fmtTime(f * dur)}</text></g>)}
            {events.map((t, i) => { const x = 10 + (t.t / dur) * 980; const y = 35 + ((i % 5) - 2) * 6; return <circle key={i} cx={x} cy={y} r={hot === i ? 7 : 4.5} fill={KIND_COLOR[t.kind]} stroke={hot === i ? '#fff' : 'none'} onMouseEnter={() => setHot(i)} onClick={() => setHot(i)} style={{ cursor: 'pointer' }} />; })}
          </svg>
          <div className="tlpane">{events.map((t: TimelineEntry, i) => (<div key={i} className={`tl ${hot === i ? 'hot' : ''} ${t.good === false ? 'bad' : t.good ? 'good' : ''}`} onMouseEnter={() => setHot(i)}><span className="mono tt">{gameClock(st, t.t)}</span><span className={`tk ${t.kind}`}>{t.kind.toUpperCase()}</span><span>{t.text}</span></div>))}</div>
        </div>

        <div className="row end gap sticky-foot">
          {session.kind === 'endless' && <span className="grow muted">Run total: {profile?.endless.current.score ?? 0} points · {endlessOver ? 'run ended' : 'next shift is busier'}</span>}
          <Btn onClick={retry} icon="play">{career ? 'Prepare next shift' : 'Play again'}</Btn>
          <Btn kind="primary" onClick={finish}>{career ? 'Return to headquarters' : session.kind === 'endless' && !endlessOver ? 'Next shift' : 'Continue'}</Btn>
        </div>
      </div>
    </div>
  );
}

/** a time-lapse of the whole shift: every unit and every open incident, frame by frame */
function ShiftReplay({ st }: { st: import('../sim/types').GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const frames = st.replay ?? [];
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setK((x) => (x + 1) % frames.length), Math.max(40, 30000 / Math.max(1, frames.length)));
    return () => clearInterval(id);
  }, [playing, frames.length]);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    const city = getCity();
    const W = c.width, H = c.height, sx = W / WORLD_W, sy = H / WORLD_H;
    ctx.fillStyle = '#0b1219'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,150,180,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); for (const e of city.edges) { const a = city.nodes[e.a], b = city.nodes[e.b]; ctx.moveTo(a.x * sx, a.y * sy); ctx.lineTo(b.x * sx, b.y * sy); } ctx.stroke();
    const f = frames[k]; if (!f) return;
    for (const [node, sev] of f.i) { const n = city.nodes[node]; ctx.fillStyle = `rgba(230,80,70,${0.25 + sev * 0.1})`; ctx.beginPath(); ctx.arc(n.x * sx, n.y * sy, 3 + sev * 1.6, 0, 7); ctx.fill(); }
    const col = ['#5aa0ff', '#ff6a5a', '#5ad69a'];
    for (const [x, y, s, busy] of f.u) { ctx.fillStyle = col[s]; ctx.globalAlpha = busy ? 1 : 0.45; ctx.fillRect(x * sx - 1.5, y * sy - 1.5, 3, 3); }
    ctx.globalAlpha = 1;
    ctx.font = '600 12px ui-monospace, monospace'; ctx.fillStyle = '#cfe0f0'; ctx.fillText(gameClock(st, f.t).slice(0, 5), 10, 18);
    ctx.fillText(`${f.i.length} open · ${f.u.filter((u) => u[3]).length} units busy`, 10, H - 10);
  }, [k, frames]);
  return (
    <div className="replay">
      <canvas ref={ref} width={560} height={340} />
      <div className="row gap center"><Btn size="sm" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</Btn><input type="range" min={0} max={Math.max(0, frames.length - 1)} value={k} onChange={(e) => { setPlaying(false); setK(+e.target.value); }} style={{ flex: 1 }} aria-label="Scrub the replay" /></div>
      <div className="small muted">Blue police, red fire, green medical — bright when busy. Red circles are open incidents, bigger when more serious.</div>
    </div>
  );
}
