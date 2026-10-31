// The radio console: a channel per unit, like a chat with each crew. Talk with the chips, type
// anything, or hold the mic and speak; crews answer in their own voice and ask you things back.
import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio/audioManager';
import { sexOfName, speakLine } from '../audio/speech';
import { CREW_CHIPS, personalityOf, speakerOf, talkToUnit, type CrewIntent } from '../sim/crew';
import type { GameEngine } from '../sim/engine';
import { SERVICE_META, isAir } from '../sim/fleet';
import type { Service, Unit } from '../sim/types';
import { useApp } from '../store';
import { Btn, Icon, SERVICE_ICON } from './common';
import { MicButton } from './Voice';

const PERSONA: Record<string, string> = { veteran: 'Veteran crew — few words', rookie: 'Rookie crew — asks a lot', joker: 'Easy-going crew', formal: 'By-the-book crew — 10-codes' };

export function RadioConsole({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const tts = useApp((s) => s.settings.tts !== false && !s.settings.muted);
  const sel = st.selected.kind === 'unit' ? st.selected.id : null;
  const [chan, setChan] = useState<string>('all');
  const [svc, setSvc] = useState<Service | 'all'>('all');
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (sel && st.units[sel]) setChan(sel); }, [sel]);
  const unit = chan !== 'all' ? st.units[chan] : undefined;
  const units = useMemo(() => Object.values(st.units).filter((u) => svc === 'all' || u.service === svc)
    .sort((a, b) => rank(a) - rank(b) || a.callsign.localeCompare(b.callsign)), [st.radio.length, svc, Object.keys(st.units).length]);
  const msgs = chan === 'all' ? st.radio.filter((m) => svc === 'all' || m.kind === 'alert' || (m.unitId && st.units[m.unitId]?.service === svc)) : st.radio.filter((m) => m.unitId === chan || (m.to && unit && m.to === unit.spoken));
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, chan]);
  const queries = (st.unitQueries ?? []).filter((q) => (q.status === 'open' || q.status === 'standby') && (chan === 'all' || q.unitId === chan));
  const unread = (u: Unit) => st.radio.slice(-12).some((m) => m.unitId === u.id && m.kind === 'unit' && st.time - m.t < 20);
  const send = (input: { intent?: CrewIntent; text?: string }) => {
    if (!unit) return;
    const r = talkToUnit(engine, unit.id, input);
    setText('');
    audio.radioBlip();
    if (r.ok && r.reply && tts) {
      const speaker = engine.crewOf(unit)[0];
      window.setTimeout(() => speakLine(r.reply!, { sex: speaker ? sexOfName(speaker.name) : 'M', age: 38, panic: unit.status === 'ON_SCENE' ? 45 : 30, radio: true, seed: unit.id.length * 7 + unit.callsign.charCodeAt(unit.callsign.length - 1) }), 380);
    }
    bump();
  };
  return (
    <div className="radiocon">
      <div className="rc-chans">
        <div className="seg">{(['all', 'police', 'fire', 'medical'] as const).map((s) => <button key={s} className={svc === s ? 'on' : ''} onClick={() => setSvc(s)}>{s === 'all' ? 'ALL' : SERVICE_META[s].short}</button>)}</div>
        <button className={`rc-chan ${chan === 'all' ? 'on' : ''}`} onClick={() => setChan('all')}><Icon n="radio" size={12} /> <b>City-wide</b><span className="small muted">all traffic</span></button>
        <div className="rc-list">
          {units.map((u) => (
            <button key={u.id} className={`rc-chan ${chan === u.id ? 'on' : ''}`} onClick={() => { setChan(u.id); engine.select('unit', u.id); bump(); }} style={{ ['--svc' as string]: SERVICE_META[u.service].color }}>
              <Icon n={SERVICE_ICON[u.service]} size={11} /> <b>{u.callsign}</b>
              <span className={`rc-st ${u.status.toLowerCase()}`}>{u.status === 'ON_SCENE' ? 'on scene' : u.status === 'EN_ROUTE' ? 'en route' : u.status.replace(/_/g, ' ').toLowerCase()}</span>
              {unread(u) && <i className="rc-dot" />}
              {(st.unitQueries ?? []).some((q) => q.unitId === u.id && q.status === 'open') && <i className="rc-ask">?</i>}
            </button>
          ))}
        </div>
      </div>
      <div className="rc-main">
        <div className="rc-head">
          {unit ? <>
            <Icon n={SERVICE_ICON[unit.service]} size={14} />
            <div className="grow"><b>{unit.callsign}</b> <span className="muted small">· {unit.typeLabel} · {speakerOf(engine, unit)} on the radio · {PERSONA[personalityOf(engine, unit)]}</span></div>
            {isAir(unit) ? null : <span className="small muted">{unit.status.replace(/_/g, ' ')}</span>}
          </> : <><Icon n="radio" size={14} /><div className="grow"><b>CITY RADIO</b> <span className="muted small">· pick a unit to talk to its crew</span></div></>}
        </div>
        <div className="rc-thread" ref={ref}>
          {msgs.slice(-160).map((m) => {
            const mine = m.kind === 'dispatch' && m.from === 'DISPATCH';
            return (
              <div key={m.id} className={`rc-msg ${mine ? 'me' : ''} ${m.kind}`}>
                {!mine && <span className="rc-from">{m.from}{m.to ? <span className="rto"> → {m.to}</span> : null}</span>}
                <span className="rc-text">{m.text}</span>
                <span className="mono rc-t">{m.clock}</span>
              </div>
            );
          })}
          {!msgs.length && <p className="muted pad">{unit ? `No traffic with ${unit.callsign} yet. Say something.` : 'No radio traffic yet.'}</p>}
        </div>
        {queries.length > 0 && (
          <div className="rc-queries">
            {queries.map((q) => {
              const opt = engine.queryOptions(q.id);
              const u = st.units[q.unitId];
              return (
                <div className="rc-q" key={q.id}>
                  <span><b>{u?.callsign}</b> asks: “{q.text}”</span>
                  <div className="btnrow">
                    <Btn size="sm" kind="primary" disabled={!opt.known} onClick={() => { engine.answerUnitQuery(q.id, 'relay'); audio.radioBlip(); bump(); }} title={opt.known ? `Relay: ${opt.known.value}` : 'You do not know yet — ask the caller'}>{opt.known ? `Relay: ${opt.known.label}` : 'Unknown yet'}</Btn>
                    {opt.canDeny && <Btn size="sm" onClick={() => { engine.answerUnitQuery(q.id, 'deny'); bump(); }}>No / none</Btn>}
                    {q.status === 'open' && <Btn size="sm" onClick={() => { engine.answerUnitQuery(q.id, 'standby'); bump(); }}>Stand by</Btn>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="rc-compose">
          {unit && <div className="rc-chips">{CREW_CHIPS.filter((c) => chipFits(c.intent, unit)).map((c) => <button key={c.intent} className="chip" onClick={() => send({ intent: c.intent })}>{c.label}</button>)}</div>}
          <form className="rc-input" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ text: text.trim() }); }}>
            <MicButton onText={(t) => setText(t)} onFinal={(t) => { if (unit) send({ text: t }); else setText(t); }} title={unit ? `Hold to talk to ${unit.callsign} (or hold V)` : 'Pick a unit first'} />
            <input value={text} disabled={!unit} onChange={(e) => setText(e.target.value)} placeholder={unit ? `Talk to ${unit.callsign} — e.g. “what do you see?”, “use caution, he's armed”, “expedite”` : 'Pick a unit on the left (or on the map) to talk to its crew'} aria-label="Radio message" />
            <Btn kind="primary" icon="send" disabled={!unit || !text.trim()}>Transmit</Btn>
          </form>
        </div>
      </div>
    </div>
  );
}

function rank(u: Unit): number {
  return u.status === 'ON_SCENE' ? 0 : u.status === 'EN_ROUTE' || u.status === 'DISPATCHED' ? 1 : u.status === 'TRANSPORTING' ? 2 : u.status === 'AVAILABLE' ? 4 : 3;
}
function chipFits(i: CrewIntent, u: Unit): boolean {
  const busy = ['EN_ROUTE', 'DISPATCHED', 'ON_SCENE', 'TRANSPORTING'].includes(u.status);
  switch (i) {
    case 'eta': case 'expedite': case 'slow': return u.status === 'EN_ROUTE' || u.status === 'DISPATCHED';
    case 'see': case 'need': return u.status === 'ON_SCENE' || u.status === 'EN_ROUTE';
    case 'caution': case 'relay': return busy;
    case 'suspect': return u.service === 'police' && busy;
    case 'patient': return u.service !== 'police' && busy;
    case 'stage': return u.service !== 'police' && (u.status === 'EN_ROUTE' || u.status === 'DISPATCHED');
    case 'return': return !busy && u.status !== 'AVAILABLE';
    default: return true;
  }
}
