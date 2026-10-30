// Operational widgets added in remaster 3: patient survival meter, touchdown countdowns,
// air support controls, guidance consequences and the records terminal for officer requests.
import { useEffect, useState } from 'react';
import { addressOf } from '../sim/city';
import { AIR_HELPS, type GameEngine } from '../sim/engine';
import { isAir } from '../sim/fleet';
import { CHECK_LABEL, PERSON_ANSWERS, PLATE_ANSWERS, recordLines } from '../sim/records';
import type { CheckResult, Incident, OfficerRequest } from '../sim/types';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { Badge, Bar, Btn, Icon, Section, fmtEta, fmtTime } from './common';

const THREAT_LABEL = { arrest: 'NOT BREATHING', airway: 'UNCONSCIOUS — AIRWAY AT RISK', bleed: 'SEVERE BLEEDING' } as const;
const THREAT_FIX = { arrest: 'Coach CPR now', airway: 'Recovery position', bleed: 'Pressure on the wound' } as const;
const THREAT_AID = { arrest: 'cpr', airway: 'recovery', bleed: 'pressure' } as const;

/** the player only sees the clock once they have learnt about the life threat on the call */
export function threatKnown(inc: Incident): boolean {
  const f = (k: string) => inc.facts.find((x) => x.key === k && x.confidence !== 'contradicted')?.value;
  if (inc.lifeThreat === 'arrest') return f('breathing') === false;
  if (inc.lifeThreat === 'airway') return f('conscious') === false || f('conscious') === 'drifting';
  if (inc.lifeThreat === 'bleed') return typeof f('injured') === 'number' && Number(f('injured')) > 0;
  return false;
}

export function LifeMeter({ inc, compact }: { inc: Incident; compact?: boolean }) {
  if (!inc.lifeThreat || inc.survival === undefined || !threatKnown(inc)) return null;
  const s = Math.round(inc.survival);
  const inCare = inc.careAt != null;
  const aid = inc.aid;
  const helping = aid?.fit === 'good' && aid.kind === THREAT_AID[inc.lifeThreat];
  const harmful = aid?.fit === 'bad';
  const tone = s > 66 ? 'green' : s > 35 ? 'amber' : 'red';
  return (
    <div className={`life ${tone} ${compact ? 'compact' : ''} ${!inCare && !helping ? 'urgent' : ''}`} role="status" aria-label={`Patient survival ${s} percent`}>
      <span className="life-ic"><Icon n="pulse" size={compact ? 14 : 16} /></span>
      <div className="life-main">
        <div className="life-top"><b>{THREAT_LABEL[inc.lifeThreat]}</b><span className="mono">{s}%</span></div>
        <Bar value={s} tone={tone === 'green' ? 'green' : tone === 'amber' ? 'amber' : 'red'} label="Survival chance" />
        <div className="life-sub small">
          {inCare ? <><Icon n="check" size={11} /> Crews have the patient</>
            : helping ? <><Icon n="check" size={11} /> {aid!.kind === 'cpr' ? 'Caller doing CPR — keep encouraging them' : 'First aid in progress'}</>
            : harmful ? <><Icon n="alert" size={11} /> Your last instruction is making it worse</>
            : <><Icon n="alert" size={11} /> No first aid — {THREAT_FIX[inc.lifeThreat]}</>}
        </div>
      </div>
    </div>
  );
}

export function DeadlineBanner({ engine, inc }: { engine: GameEngine; inc: Incident }) {
  if (inc.deadlineAt == null) return null;
  const st = engine.state;
  if (inc.deadlineMet != null) return <div className={`deadline done ${inc.deadlineMet ? 'ok' : 'bad'}`}><Icon n={inc.deadlineMet ? 'check' : 'x'} size={13} /> {inc.deadlineMet ? 'Crews were in position on touchdown' : 'Nobody was ready when it touched down'}</div>;
  const left = Math.max(0, inc.deadlineAt - st.time);
  const here = engine.onScene(inc);
  const need = inc.requires.reduce((s, r) => s + r.n, 0);
  const have = inc.requires.reduce((s, r) => s + Math.min(r.n, here.filter((u) => u.capabilities.includes(r.cap)).length), 0);
  return (
    <div className={`deadline ${left < 45 ? 'hot' : ''}`} role="timer">
      <Icon n="clock" size={15} />
      <div className="grow">
        <div className="dl-top"><b>TOUCHDOWN IN</b><span className="mono big">{fmtTime(left)}</span></div>
        <Bar value={left} max={200} tone={left < 45 ? 'red' : 'amber'} label="Time to touchdown" />
        <div className="small">{have}/{need} required crews staged on the runway</div>
      </div>
    </div>
  );
}

export function Consequences({ inc }: { inc: Incident }) {
  if (!inc.consequences?.length) return null;
  return (
    <Section title="Consequences" id="cons" right={<Badge tone={inc.consequences.some((c) => /saved|kept/.test(c)) ? 'green' : 'red'}>{inc.consequences.length}</Badge>}>
      <ul className="cons">{inc.consequences.map((c, i) => <li key={i} className={/kept the patient alive/.test(c) ? 'good' : 'bad'}><Icon n={/kept the patient alive/.test(c) ? 'heart' : 'alert'} size={12} /> {c}</li>)}</ul>
    </Section>
  );
}

/** air support for pursuits and searches: request the aircraft, ask it, relay its position to ground units */
export function AirSupport({ engine, inc }: { engine: GameEngine; inc: Incident }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  if (!inc.pursuit && !AIR_HELPS.has(inc.templateId)) return null;
  const air = inc.assignedUnits.map((id) => st.units[id]).find((u) => u && isAir(u));
  const fleet = Object.values(st.units).filter(isAir);
  if (!fleet.length) return null;
  const m = inc.mover;
  const eyes = !!m && !!air && m.heliId === air.id;
  const toast = (r: { ok: boolean; reason?: string }) => { if (!r.ok) useApp.getState().showToast(r.reason ?? 'Not possible', 'warn'); else audio.dispatchConfirm(); bump(); };
  if (!air) {
    const free = fleet.filter((u) => u.status === 'AVAILABLE' || (u.status === 'RETURNING' && !u.assignedIncidentId && (u.fuel ?? 100) > 40));
    const best = free[0];
    return (
      <div className="air">
        <div className="air-head"><Icon n="heli" size={15} /> <b>Air support</b><span className="grow" />{st.weather === 'storm' ? <Badge tone="red">GROUNDED</Badge> : best ? <Badge tone="green">AVAILABLE</Badge> : <Badge>BUSY</Badge>}</div>
        <p className="small muted">{inc.pursuit ? 'The helicopter’s camera can follow the vehicle from far away — ground crews lose suspects in traffic.' : 'An aircraft overhead speeds up searches and gives crews overwatch.'}</p>
        {best && st.weather !== 'storm' && <Btn size="sm" kind="primary" icon="heli" onClick={() => toast(engine.dispatch(best.id, inc.id))}>Request {best.callsign} · ETA {fmtEta(engine.estimate(best.id, inc.reportedNode ?? inc.nodeId)?.eta)}</Btn>}
        {!best && <p className="small muted">{fleet.map((u) => `${u.callsign}: ${u.note ?? u.status.toLowerCase().replace('_', ' ')}`).join(' · ')}</p>}
      </div>
    );
  }
  const since = inc.relayedAt != null ? st.time - inc.relayedAt : null;
  const stale = eyes && (since === null || since > 12);
  return (
    <div className={`air ${eyes ? 'eyes' : ''}`}>
      <div className="air-head"><Icon n="heli" size={15} /> <b className="mono">{air.callsign}</b><span className="grow" /><Badge tone={eyes ? 'green' : air.status === 'ON_SCENE' ? 'blue' : 'neutral'}>{eyes ? 'EYES ON SUSPECT' : air.status === 'ON_SCENE' ? (m ? 'SEARCHING' : 'OVERHEAD') : air.status.replace('_', ' ')}</Badge></div>
      <div className="kv"><span>Fuel</span><Bar value={air.fuel ?? 100} tone={(air.fuel ?? 100) < 30 ? 'red' : (air.fuel ?? 100) < 55 ? 'amber' : 'green'} label="Fuel" /></div>
      {m && (
        <div className="btnrow">
          <Btn size="sm" icon="radio" onClick={() => toast(engine.askAir(inc.id))}>Where is he?</Btn>
          <Btn size="sm" kind={stale ? 'primary' : 'default'} className={stale ? 'pulse' : ''} icon="send" disabled={!eyes} onClick={() => toast(engine.relayAir(inc.id))} title="Send ground units to an intercept point ahead of the suspect (R)">Relay to ground units <kbd>R</kbd></Btn>
        </div>
      )}
      {m && <div className="small muted">{eyes ? (since === null ? 'Ground units are working from old information — relay the air unit’s position.' : `Last relay ${fmtTime(since)} ago · position ${addressOf(engine.city, inc.reportedNode ?? inc.nodeId)}`) : 'Waiting for the camera to pick the vehicle up.'}</div>}
    </div>
  );
}

// ── Records terminal ────────────────────────────────────────────────────────
const openReqs = (engine: GameEngine) => engine.state.requests.filter((r) => r.status === 'open' && r.at <= engine.state.time);

export function RecordsDock({ engine, onOpen }: { engine: GameEngine; onOpen: () => void }) {
  const open = openReqs(engine);
  if (!open.length) return null;
  const oldest = Math.max(...open.map((r) => engine.state.time - r.at));
  return (
    <button className={`recdock ${oldest > 35 ? 'late' : ''}`} onClick={onOpen} title="Open the records terminal (T)">
      <Icon n="terminal" size={15} /> <b>{open.length} records request{open.length > 1 ? 's' : ''}</b> <span className="mono small">{fmtTime(oldest)}</span> <kbd>T</kbd>
    </button>
  );
}

export function RecordsTerminal({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const reqs = st.requests.filter((r) => r.at <= st.time && r.announced).slice(-14).reverse();
  const open = reqs.filter((r) => r.status === 'open');
  const [sel, setSel] = useState<string | null>(open[0]?.id ?? reqs[0]?.id ?? null);
  const r: OfficerRequest | undefined = reqs.find((x) => x.id === sel) ?? open[0] ?? reqs[0];
  const [q, setQ] = useState({ last: '', first: '', dob: '', sex: '', plate: '' });
  const [results, setResults] = useState<number[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  // a fresh form for every request
  useEffect(() => { setQ({ last: '', first: '', dob: '', sex: '', plate: '' }); setResults(null); setPick(null); setFeedback(null); }, [r?.id]);
  const run = () => {
    if (!r || searching) return;
    setSearching(true); setPick(null);
    window.setTimeout(() => { setResults(engine.searchRequest(r.id, r.kind === 'plate' ? { plate: q.plate } : q)); setSearching(false); audio.click(); bump(); }, 750);
  };
  const unit = r ? st.units[r.unitId] : undefined;
  const answers: CheckResult[] = r?.kind === 'plate' ? PLATE_ANSWERS : PERSON_ANSWERS;
  const transmit = (a: CheckResult) => {
    if (!r) return;
    const res = engine.answerRequest(r.id, a, pick ?? -1);
    if (res.mismatch) { audio.error(); setFeedback('The officer says that is not their subject — compare the details again.'); }
    else if (res.ok) { if (res.correct) audio.dispatchConfirm(); else audio.error(); const next = openReqs(engine).find((x) => x.id !== r.id); if (next) setSel(next.id); }
    bump();
  };
  const field = (k: keyof typeof q, label: string, ph: string, w = 1) => (
    <label className="tf" style={{ flex: w }}><span>{label}</span><input value={q[k]} placeholder={ph} spellCheck={false} disabled={!r || r.status !== 'open'} onChange={(e) => setQ({ ...q, [k]: e.target.value.toUpperCase() })} /></label>
  );
  return (
    <div className="term-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="term" role="dialog" aria-label="Records terminal" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
        <div className="term-head"><span className="term-logo">RCIS</span><span>Ravenport Criminal Information System · NCIC link</span><span className="grow" /><span className="mono small">{open.length} pending</span><button className="icon-btn" onClick={onClose} aria-label="Close terminal"><Icon n="x" size={14} /></button></div>
        <div className="term-body">
          <div className="term-list">
            {!reqs.length && <div className="term-empty">No requests yet. Officers on patrol, on traffic stops and at scenes radio in for checks.</div>}
            {reqs.map((x) => {
              const u = st.units[x.unitId];
              const wait = (x.answeredAt ?? st.time) - x.at;
              return (
                <button key={x.id} className={`term-req ${x.id === r?.id ? 'sel' : ''} ${x.status}`} onClick={() => setSel(x.id)}>
                  <span className="mono">{u?.callsign ?? '—'}</span>
                  <span className="grow">{x.kind === 'plate' ? '10-28 PLATE' : '10-29 PERSON'}</span>
                  <span className={`mono small ${x.status === 'open' && wait > 35 ? 'late' : ''}`}>{x.status === 'open' ? fmtTime(wait) : x.status === 'expired' ? 'NO RETURN' : x.correct ? '✓' : '✗'}</span>
                </button>
              );
            })}
          </div>
          {r && (
            <div className="term-main">
              <div className="term-radio">
                <Icon n="radio" size={13} /> <span className="grow">{r.text ?? `${unit?.spoken}: request on file.`}{(() => { const last = st.radio.filter((m) => m.unitId === r.unitId && m.t > r.at + 1 && m.kind !== 'dispatch').slice(-1)[0]; return last && r.status === 'open' ? <span className="term-last"><br />Latest: {last.text}</span> : null; })()}</span>
                {r.status === 'open' && <Btn size="sm" kind="ghost" icon="radio" onClick={() => { engine.repeatRequest(r.id); bump(); }}>Say again</Btn>}
              </div>
              <form className="term-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
                {r.kind === 'person' ? (<>{field('last', 'LAST NAME', 'SANDOVAL', 1.4)}{field('first', 'FIRST', 'RUBEN', 1.1)}{field('dob', 'DOB (MM/DD/YYYY)', '09/23/1960', 1.2)}{field('sex', 'SEX', 'M', 0.4)}</>)
                  : (<>{field('plate', 'PLATE', '7KQ482', 1.4)}<label className="tf" style={{ flex: 0.5 }}><span>STATE</span><input value="RV" disabled /></label></>)}
                <Btn size="sm" kind="primary" icon="search" disabled={!r || r.status !== 'open' || searching} onClick={run}>QUERY</Btn>
              </form>
              <div className="term-out" aria-live="polite">
                {searching && <div className="blink">QUERYING RCIS / NCIC…</div>}
                {!searching && results === null && <div className="dim">Type what the officer gave you and press QUERY (Enter). Names repeat and spellings are close — the date of birth decides.</div>}
                {!searching && results !== null && results.length === 0 && <div className="flag">NO RECORD ON FILE FOR THAT QUERY — check the spelling, date of birth or plate.</div>}
                {!searching && results !== null && results.length > 0 && (
                  <>
                    <div className="dim">{results.length} RECORD{results.length > 1 ? 'S' : ''} RETURNED{results.length > 1 ? ' — SELECT YOUR SUBJECT' : ''}</div>
                    {results.map((i) => (
                      <button key={i} type="button" className={`hit ${pick === i ? 'picked' : ''}`} onClick={() => { setPick(i); audio.click(); }}>
                        {recordLines(r.db[i]).map((l, k) => <div key={k} className={/\*\*\*|!!!|SUSPENDED|EXPIRED|NONE ON FILE$/.test(l) && !/WANTS\/WARRANTS: NONE/.test(l) ? 'flag' : ''}>{l}</div>)}
                        <div className="hit-sel">{pick === i ? '▶ SELECTED AS SUBJECT' : 'click to select'}</div>
                      </button>
                    ))}
                  </>
                )}
              </div>
              {feedback && r.status === 'open' && <div className="term-result bad">{feedback}</div>}
              {r.status === 'open' ? (
                <div className="term-answers">
                  <span className="small">{pick !== null ? `Relay return on the selected record to ${unit?.callsign ?? 'the unit'}:` : results && results.length === 0 ? 'Nothing found — you can relay "no record", or correct the query.' : 'Select a record, then relay the return:'}</span>
                  {pick !== null ? answers.map((a) => <Btn key={a} size="sm" kind={a === 'caution' || a === 'stolen' ? 'danger' : a === 'clear' ? 'success' : 'default'} onClick={() => transmit(a)}>{CHECK_LABEL[a]}</Btn>)
                    : <Btn size="sm" disabled={results === null} onClick={() => transmit('clear')}>No record on file</Btn>}
                </div>
              ) : (
                <div className={`term-result ${r.correct ? 'ok' : 'bad'}`}>
                  {r.status === 'expired' ? <>No return was given — the officer acted without it. The record showed: <b>{CHECK_LABEL[r.truth]}</b>.</>
                    : r.correct ? <>Correct return: <b>{CHECK_LABEL[r.truth]}</b>{r.mistakes ? ' (after a wrong record)' : ''}.</>
                    : <>You radioed <b>{CHECK_LABEL[r.answer!]}</b> — the subject's record showed <b>{CHECK_LABEL[r.truth]}</b>.</>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
