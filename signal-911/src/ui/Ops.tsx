// Operational widgets added in remaster 3: patient survival meter, touchdown countdowns,
// air support controls, guidance consequences and the records terminal for officer requests.
import { useEffect, useState } from 'react';
import { addressOf } from '../sim/city';
import { AIR_HELPS, type GameEngine } from '../sim/engine';
import { isAir } from '../sim/fleet';
import { CHECK_LABEL, PERSON_ANSWERS, PLATE_ANSWERS } from '../sim/records';
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
  const reqs = st.requests.filter((r) => r.at <= st.time).slice(-12).reverse();
  const open = reqs.filter((r) => r.status === 'open');
  const [sel, setSel] = useState<string | null>(open[0]?.id ?? reqs[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState<string | null>(null);
  const r: OfficerRequest | undefined = reqs.find((x) => x.id === sel) ?? open[0];
  useEffect(() => { if (r) setQuery(r.kind === 'plate' ? `PLATE/${r.subject}` : `NAME/${r.subject.split(' ').reverse().join(', ').toUpperCase()}`); }, [r?.id]);
  useEffect(() => { if (!searching) return; const t = setTimeout(() => { engine.runRequest(searching); setSearching(null); audio.click(); bump(); }, 900); return () => clearTimeout(t); }, [searching]);
  const unit = r ? st.units[r.unitId] : undefined;
  const answers: CheckResult[] = r?.kind === 'plate' ? PLATE_ANSWERS : PERSON_ANSWERS;
  const answer = (a: CheckResult) => { if (!r) return; const res = engine.answerRequest(r.id, a); if (res.ok) { if (res.correct) audio.dispatchConfirm(); else audio.error(); } bump(); const next = openReqs(engine).find((x) => x.id !== r.id); if (next) setSel(next.id); };
  return (
    <div className="term-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="term" role="dialog" aria-label="Records terminal" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
        <div className="term-head"><span className="term-logo">RCIS</span><span>Ravenport Criminal Information System</span><span className="grow" /><span className="mono small">{open.length} pending</span><button className="icon-btn" onClick={onClose} aria-label="Close terminal"><Icon n="x" size={14} /></button></div>
        <div className="term-body">
          <div className="term-list">
            {!reqs.length && <div className="term-empty">No requests yet. Officers on traffic stops and at scenes will radio for checks.</div>}
            {reqs.map((x) => {
              const u = st.units[x.unitId];
              const wait = (x.answeredAt ?? st.time) - x.at;
              return (
                <button key={x.id} className={`term-req ${x.id === r?.id ? 'sel' : ''} ${x.status}`} onClick={() => setSel(x.id)}>
                  <span className="mono">{u?.callsign ?? '—'}</span>
                  <span className="grow">{x.kind === 'plate' ? 'PLATE' : 'PERSON'} · {x.subject}</span>
                  <span className={`mono small ${x.status === 'open' && wait > 35 ? 'late' : ''}`}>{x.status === 'open' ? fmtTime(wait) : x.status === 'expired' ? 'NO RETURN' : x.correct ? '✓' : '✗'}</span>
                </button>
              );
            })}
          </div>
          {r && (
            <div className="term-main">
              <div className="term-radio"><Icon n="radio" size={13} /> <b>{unit?.spoken ?? 'Unit'}:</b> {r.kind === 'plate' ? `Run plate ${r.subject}, ${r.detail}.` : `Wants and warrants on ${r.subject}, ${r.detail}.`}</div>
              <form className="term-query" onSubmit={(e) => { e.preventDefault(); if (!r.ran && !searching) setSearching(r.id); }}>
                <span className="prompt">&gt;</span>
                <input aria-label="Records query" value={query} onChange={(e) => setQuery(e.target.value)} disabled={r.ran} spellCheck={false} />
                <Btn size="sm" kind="primary" icon="search" disabled={r.ran || !!searching} onClick={() => { if (!r.ran && !searching) setSearching(r.id); }}>RUN</Btn>
              </form>
              <div className="term-out" aria-live="polite">
                {searching === r.id && <div className="blink">QUERYING RCIS / NCIC…</div>}
                {!r.ran && searching !== r.id && <div className="dim">Press RUN to query the database. Read the return carefully — names repeat; the date of birth decides.</div>}
                {r.ran && (
                  <>
                    <div className="dim">{r.hits.length} RECORD{r.hits.length > 1 ? 'S' : ''} RETURNED{r.hits.length > 1 ? ' — VERIFY DATE OF BIRTH' : ''}</div>
                    {r.hits.map((h, i) => (
                      <div key={i} className="hit">
                        <div className="dim">── RECORD {i + 1} ──────────────</div>
                        {h.lines.map((l, k) => <div key={k} className={/\*\*\*|!!!|SUSPENDED|EXPIRED/.test(l) ? 'flag' : ''}>{l}</div>)}
                      </div>
                    ))}
                  </>
                )}
              </div>
              {r.status === 'open' ? (
                <div className="term-answers">
                  <span className="small">Radio the return to {unit?.callsign ?? 'the unit'}:</span>
                  {answers.map((a) => <Btn key={a} size="sm" kind={a === 'caution' || a === 'stolen' ? 'danger' : a === 'clear' ? 'success' : 'default'} onClick={() => answer(a)}>{CHECK_LABEL[a]}</Btn>)}
                </div>
              ) : (
                <div className={`term-result ${r.correct ? 'ok' : 'bad'}`}>
                  {r.status === 'expired' ? <>No return was given — the officer acted without it. Record showed: <b>{CHECK_LABEL[r.truth]}</b>.</>
                    : r.correct ? <>Correct return: <b>{CHECK_LABEL[r.truth]}</b>.</>
                    : <>You radioed <b>{CHECK_LABEL[r.answer!]}</b> — the record showed <b>{CHECK_LABEL[r.truth]}</b>.</>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
