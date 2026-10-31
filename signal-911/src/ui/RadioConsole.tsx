// The radio desk. Talkgroups for police and fire/EMS, the outside line to county, utilities, state and
// federal agencies, and a private channel per crew. Crews ask for what they need here and keep asking
// until they get it; you request outside help here; you hold a channel for emergency traffic, run roll
// calls, patch talkgroups together, ask for repeats when a transmission is blocked — and answer the
// orange button when an officer hits it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio/audioManager';
import { sexOfName, speakLine } from '../audio/speech';
import { CREW_CHIPS, personalityOf, speakerOf, talkToUnit, type CrewIntent } from '../sim/crew';
import { RESOURCES, RESOURCE_BY_ID, RESOURCE_GROUPS, type GameEngine } from '../sim/engine';
import { SERVICE_META, isAir } from '../sim/fleet';
import { declineNeed, isOutside, parseRequest, pendingNeeds, radioRequest } from '../sim/radioreq';
import { askFor, matchOption, pendingAsks, replyOnRadio } from '../sim/replies';
import { getAi } from '../store';
import { ackEmergency, emergencyOn, patchIncident, rollCall, sayAgainRadio, setEmergencyTraffic, talkgroupOf, TALKGROUPS, type Talkgroup } from '../sim/radioops';
import type { RadioMsg, Unit } from '../sim/types';
import { useApp } from '../store';
import { Badge, Btn, Icon, SERVICE_ICON, fmtTime } from './common';
import { MicButton } from './Voice';

const PERSONA: Record<string, string> = { veteran: 'Veteran crew — few words', rookie: 'Rookie crew — asks a lot', joker: 'Easy-going crew', formal: 'By-the-book crew — 10-codes' };
type Chan = 'all' | Talkgroup | string;
const incName = (e: GameEngine, id: string) => { const i = e.state.incidents[id]; return i ? `INC-${String(i.num).padStart(4, '0')} ${i.label}` : id; };

export function RadioConsole({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const tts = useApp((s) => s.settings.tts !== false && !s.settings.muted);
  const resPanel = useApp((s) => s.resPanel);
  const sel = st.selected.kind === 'unit' ? st.selected.id : null;
  const [chan, setChan] = useState<Chan>('all');
  const [text, setText] = useState('');
  const [reqInc, setReqInc] = useState<string>('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (sel && st.units[sel]) setChan(sel); }, [sel]);
  // "Request on the radio" from anywhere lands here, on the outside line
  useEffect(() => { if (resPanel) { setChan('outside'); if (resPanel.incId) setReqInc(resPanel.incId); useApp.getState().closeResources(); } }, [resPanel]);
  const unit = chan.length > 7 || st.units[chan] ? st.units[chan] : undefined;
  const tg: Talkgroup | null = unit ? (unit.service === 'police' ? 'police' : 'fire') : chan === 'all' ? null : (chan as Talkgroup);
  const units = useMemo(() => Object.values(st.units).filter((u) => !tg || tg === 'outside' ? u.temp : tg === 'police' ? u.service === 'police' : u.service !== 'police')
    .sort((a, b) => rank(a) - rank(b) || a.callsign.localeCompare(b.callsign)), [st.radio.length, tg, Object.keys(st.units).length]);
  const msgs = st.radio.filter((m) => unit ? m.unitId === unit.id || (m.to && m.to === unit.spoken) : chan === 'all' ? true : chan === 'outside' ? isOutside(m) : (talkgroupOf(st, m) ?? chan) === chan);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, chan]);
  const needs = pendingNeeds(engine).filter((n) => chan === 'all' || chan === 'outside' || (unit ? n.unitId === unit.id : true));
  const allNeeds = pendingNeeds(engine);
  const asks = pendingAsks(engine).filter((a) => (unit ? a.unitId === unit.id : chan === 'outside' ? st.decisions?.find((d) => d.id === a.id)?.kind === 'aidOut' : true));
  const ems = (st.radioCtl?.emergencies ?? []).filter((x) => !x.done);
  const patchable = Object.values(st.incidents).filter((i) => i.patchAsked && !i.patched && !['RESOLVED', 'CLOSED'].includes(i.status));
  const unreadTg = (t: Talkgroup) => st.radio.slice(-10).some((m) => st.time - m.t < 15 && (t === 'outside' ? isOutside(m) : talkgroupOf(st, m) === t));
  const unread = (u: Unit) => st.radio.slice(-12).some((m) => m.unitId === u.id && m.kind === 'unit' && st.time - m.t < 20);
  const toast = (r: { ok: boolean; reason?: string; text?: string }, ok?: string) => { if (!r.ok) { audio.error(); useApp.getState().showToast(r.reason ?? 'Not possible', 'warn'); } else { audio.radioBlip(); if (ok || r.text) useApp.getState().showToast(ok ?? r.text!, 'info'); } bump(); };
  const speak = (u: Unit, line: string) => {
    if (!tts) return;
    const sp = engine.crewOf(u)[0];
    window.setTimeout(() => speakLine(line, { sex: sp ? sexOfName(sp.name) : 'M', age: 38, panic: u.status === 'ON_SCENE' ? 45 : 30, radio: true, seed: u.id.length * 7 + u.callsign.charCodeAt(u.callsign.length - 1) }, `radio:${u.id}`), 380);
  };
  /** the crew answers in their own voice when AI is on, then over the speaker */
  const voiceAndSpeak = (unitId: string, msgId: string, said: string) => {
    const u = st.units[unitId]; if (!u) return;
    const ai = getAi();
    if (!ai) { const m = st.radio.find((x) => x.id === msgId); if (m) speak(u, m.text); return; }
    void ai.voiceCrew(unitId, msgId, said).then((txt) => { const m = st.radio.find((x) => x.id === msgId); if (m) speak(u, txt ?? m.text); bump(); });
  };
  const request = (incId: string, resId: string) => toast(radioRequest(engine, incId, resId), `${RESOURCES.find((r) => r.id === resId)?.name} requested on the outside line`);
  const send = (input: { intent?: CrewIntent; text?: string }) => {
    setText('');
    // someone asked you something: what you transmit is your answer
    if (input.text) {
      const ctx = { unitId: unit?.id, channel: chan };
      const before = st.radio.length;
      const after = (r: { handled: boolean; reason?: string }) => {
        if (!r.handled) return false;
        audio.radioBlip(); if (r.reason) useApp.getState().showToast(r.reason, 'warn');
        const last = st.radio.slice(before).reverse().find((m) => m.kind === 'unit' && m.unitId);
        if (last) voiceAndSpeak(last.unitId!, last.id, input.text!);
        bump(); return true;
      };
      const target = askFor(engine, input.text, ctx);
      const d = target?.kind === 'decision' ? st.decisions?.find((x) => x.id === target.id) : undefined;
      const ai = getAi();
      // an answer the keywords cannot place: let the AI read what you meant before asking them to say again
      if (d && ai && !matchOption(input.text, d.options)) { void ai.interpret(target!.text, d.options.map((o) => ({ id: o.id, label: o.label })), input.text).then((opt) => { after(replyOnRadio(engine, input.text!, ctx, opt ?? undefined)); }); return; }
      if (after(replyOnRadio(engine, input.text, ctx))) return;
    }
    // anything that sounds like a request goes out on the outside line
    const want = input.text ? parseRequest(input.text) : null;
    const target = unit?.assignedIncidentId ?? (chan === 'outside' || !unit ? (reqInc || (st.selected.kind === 'incident' ? st.selected.id : '')) : '');
    if (want && target) { engine.radio('DISPATCH', input.text!, 'dispatch', unit?.id, target); request(target, want); return; }
    if (!unit) { if (want) toast({ ok: false, reason: 'Pick the incident it is for' }); else toast({ ok: false, reason: 'Pick a unit to talk to — or ask for something by name: "tow", "K-9", "gas company"' }); return; }
    const before = st.radio.length;
    const r = talkToUnit(engine, unit.id, input);
    audio.radioBlip();
    const last = st.radio.slice(before).reverse().find((m) => m.unitId === unit.id && m.kind !== 'dispatch');
    if (r.ok && last) voiceAndSpeak(unit.id, last.id, input.text ?? CREW_CHIPS.find((c) => c.intent === input.intent)?.label ?? '');
    else if (r.ok && r.reply) speak(unit, r.reply);
    bump();
  };
  const tgBtn = (t: Talkgroup) => {
    const def = TALKGROUPS.find((x) => x.id === t)!;
    const held = t !== 'outside' && st.radioCtl?.held[t] !== undefined;
    const n = t === 'outside' ? allNeeds.length : 0;
    return (
      <button key={t} className={`rc-tg ${chan === t ? 'on' : ''} ${held ? 'held' : ''}`} onClick={() => { setChan(t); engine.select(null, null); bump(); }}>
        <span className={`led ${unreadTg(t) ? 'lit' : ''}`} /><b>{def.short}</b><span className="small muted">{def.name}</span>
        {held && <span className="rc-held">EMERG</span>}{n > 0 && <span className="rc-badge">{n}</span>}
      </button>
    );
  };
  return (
    <div className="radiocon">
      <div className="rc-chans">
        <button className={`rc-tg ${chan === 'all' ? 'on' : ''}`} onClick={() => setChan('all')}><span className="led lit" /><b>SCAN</b><span className="small muted">every channel</span></button>
        {TALKGROUPS.map((t) => tgBtn(t.id))}
        <div className="rc-sub small muted">{tg === 'outside' ? 'Outside units on the road' : 'Crews'}</div>
        <div className="rc-list">
          {units.map((u) => (
            <button key={u.id} className={`rc-chan ${chan === u.id ? 'on' : ''}`} onClick={() => { setChan(u.id); engine.select('unit', u.id); bump(); }} style={{ ['--svc' as string]: SERVICE_META[u.service].color }}>
              <Icon n={SERVICE_ICON[u.service]} size={11} /> <b>{u.callsign}</b>
              <span className={`rc-st ${u.status.toLowerCase()}`}>{u.missedTones ? 'no ack' : u.status === 'ON_SCENE' ? 'on scene' : u.status === 'EN_ROUTE' ? 'en route' : u.status.replace(/_/g, ' ').toLowerCase()}</span>
              {unread(u) && <i className="rc-dot" />}
              {pendingAsks(engine).some((a) => a.unitId === u.id) || allNeeds.some((n) => n.unitId === u.id) ? <i className="rc-ask">?</i> : null}
            </button>
          ))}
          {!units.length && <p className="muted small pad">{tg === 'outside' ? 'No outside units rolling.' : 'No units.'}</p>}
        </div>
      </div>
      <div className="rc-main">
        <div className="rc-head">
          {unit ? <>
            <Icon n={SERVICE_ICON[unit.service]} size={14} />
            <div className="grow"><b>{unit.callsign}</b> <span className="muted small">· {unit.typeLabel} · {speakerOf(engine, unit)} on the radio · {PERSONA[personalityOf(engine, unit)]}</span></div>
            {unit.missedTones && <Btn size="sm" kind="primary" onClick={() => toast(engine.reTone(unit.id), 'Tones sent again')}>Re-tone</Btn>}
            {isAir(unit) ? null : <span className="small muted">{unit.status.replace(/_/g, ' ')}</span>}
          </> : chan === 'outside' ? <><Icon n="phone" size={14} /><div className="grow"><b>OUTSIDE LINE</b> <span className="muted small">· county, utilities, state &amp; federal — crews' requests land here</span></div></>
            : tg ? <><Icon n="radio" size={14} /><div className="grow"><b>{TALKGROUPS.find((x) => x.id === tg)!.name.toUpperCase()}</b>{st.radioCtl?.held[tg as 'police'] !== undefined && <Badge tone="red">EMERGENCY TRAFFIC ONLY · {fmtTime(st.time - st.radioCtl!.held[tg as 'police']!)}</Badge>}</div>
              <Btn size="sm" kind={st.radioCtl?.held[tg as 'police'] !== undefined ? 'primary' : emergencyOn(st, tg as 'police') ? 'danger' : 'default'} onClick={() => toast(setEmergencyTraffic(engine, tg as 'police', st.radioCtl?.held[tg as 'police'] === undefined))} title="Hold the channel for an emergency: routine chatter waits. Release it when it is over — crews pile up behind it.">{st.radioCtl?.held[tg as 'police'] !== undefined ? 'Resume normal traffic' : 'Emergency traffic only'}</Btn>
              <Btn size="sm" onClick={() => toast(rollCall(engine, tg as 'police'))} title="Every unit on the talkgroup reports where it is and what it is doing">Roll call</Btn></>
            : <><Icon n="radio" size={14} /><div className="grow"><b>SCANNER</b> <span className="muted small">· every channel — pick a talkgroup or a crew to talk</span></div></>}
        </div>
        {ems.length > 0 && (
          <div className="rc-emerg">
            {ems.map((em) => {
              const u = st.units[em.unitId];
              const left = Math.max(0, em.until - st.time);
              const backup = Object.values(st.units).filter((x) => x.service === 'police' && x.status === 'AVAILABLE' && !isAir(x)).sort((a, b) => (engine.estimate(a.id, st.incidents[em.incId]?.nodeId ?? 0)?.eta ?? 1e9) - (engine.estimate(b.id, st.incidents[em.incId]?.nodeId ?? 0)?.eta ?? 1e9))[0];
              const sent = st.incidents[em.incId]?.assignedUnits.some((id) => id !== em.unitId && st.units[id]?.service === 'police');
              return (
                <div className="rc-em" key={em.id}>
                  <span className="em-tag">EMERGENCY</span><b>{u?.callsign}</b><span className="grow small">open mic — {fmtTime(left)} to act</span>
                  <Btn size="sm" kind={em.acked ? 'default' : 'danger'} disabled={em.acked} onClick={() => toast(ackEmergency(engine, em.id))}>{em.acked ? 'Acknowledged' : 'Acknowledge'}</Btn>
                  <Btn size="sm" kind={sent ? 'default' : 'danger'} disabled={!!sent || !backup} onClick={() => { if (backup) toast(engine.dispatch(backup.id, em.incId, { code: 3 }), `${backup.callsign} responding code 3`); }}>{sent ? 'Backup rolling' : backup ? `Send ${backup.callsign}` : 'No units free'}</Btn>
                </div>
              );
            })}
          </div>
        )}
        <div className="rc-thread" ref={ref}>
          {msgs.slice(-160).map((m) => <Msg key={m.id} m={m} onRepeat={() => toast(sayAgainRadio(engine, m.id))} />)}
          {!msgs.length && <p className="muted pad">{unit ? `No traffic with ${unit.callsign} yet. Say something.` : chan === 'outside' ? 'Nothing on the outside line yet. Crews will ask here when they need something — or request it yourself below.' : 'No radio traffic yet.'}</p>}
        </div>
        {(needs.length > 0 || patchable.length > 0) && (
          <div className="rc-needs">
            {needs.map((n) => (
              <div className={`rc-need nag${Math.min(2, n.nag)}`} key={n.incId + n.resId}>
                <span><b>{n.unitId ? st.units[n.unitId]?.callsign : 'Crews'}</b> at {incName(engine, n.incId)} need <b>{n.name.toLowerCase()}</b> <span className="muted small">· asked {fmtTime(st.time - n.at)} ago{n.nag ? ` · chased ×${n.nag}` : ''} · {RESOURCE_BY_ID[n.resId]?.cost ? `$${RESOURCE_BY_ID[n.resId].cost.toLocaleString()}` : 'no charge'}</span></span>
                <div className="btnrow"><Btn size="sm" kind="primary" onClick={() => request(n.incId, n.resId)}>Request it</Btn><Btn size="sm" onClick={() => toast(declineNeed(engine, n.incId, n.resId))}>None available</Btn></div>
              </div>
            ))}
            {patchable.map((i) => (
              <div className="rc-need" key={'p' + i.id}>
                <span>Crews at <b>{incName(engine, i.id)}</b> want police and fire on one channel</span>
                <div className="btnrow"><Btn size="sm" kind="primary" onClick={() => toast(patchIncident(engine, i.id), 'Talkgroups patched')}>Patch OPS-1 + FIRE-2</Btn></div>
              </div>
            ))}
          </div>
        )}
        {asks.length > 0 && (
          <div className="rc-queries">
            {asks.map((a) => {
              const u = st.units[a.unitId];
              return (
                <div className="rc-q" key={a.id}>
                  <span className="rask-led" /><span className="grow"><b>{st.decisions?.find((d) => d.id === a.id)?.kind === 'aidOut' ? 'Harlow County' : u?.callsign}</b> is waiting: “{a.text}” <span className="muted small">— answer below in your own words ({a.hints.slice(0, 3).map((h) => `“${h}”`).join(', ')}…)</span></span>
                  <span className="mono small">{Math.ceil(Math.max(0, a.expiresAt - st.time))}s</span>
                </div>
              );
            })}
          </div>
        )}
        {chan === 'outside' ? <OutsideLine engine={engine} inc={reqInc} setInc={setReqInc} onRequest={request} /> : null}
        <div className="rc-compose">
          {unit && <div className="rc-chips">{CREW_CHIPS.filter((c) => chipFits(c.intent, unit)).map((c) => <button key={c.intent} className="chip" onClick={() => send({ intent: c.intent })}>{c.label}</button>)}</div>}
          <form className="rc-input" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ text: text.trim() }); }}>
            <MicButton onText={(t) => setText(t)} onFinal={(t) => send({ text: t })} title={unit ? `Hold to talk to ${unit.callsign} (or hold V)` : 'Hold to talk'} />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={asks[0] ? `Answer ${st.units[asks[0].unitId]?.callsign ?? 'them'} in your own words — e.g. “${asks[0].hints[0]}”` : unit ? `Talk to ${unit.callsign} — “what do you see?”, “use caution”, “I'll get a tow rolling”` : chan === 'outside' ? 'Ask for it by name: “tow truck”, “gas company”, “K-9”, “mutual aid ambulance”…' : 'Pick a crew to talk to — or ask for outside help by name'} aria-label="Radio message" />
            <Btn kind="primary" icon="send" disabled={!text.trim()}>Transmit</Btn>
          </form>
        </div>
      </div>
    </div>
  );
}

function Msg({ m, onRepeat }: { m: RadioMsg; onRepeat: () => void }) {
  const mine = m.kind === 'dispatch' && m.from === 'DISPATCH';
  const emerg = m.from.startsWith('EMERGENCY');
  return (
    <div className={`rc-msg ${mine ? 'me' : ''} ${m.kind} ${emerg ? 'emerg' : ''} ${m.broken ? 'broken' : ''}`}>
      {!mine && <span className="rc-from">{m.from}{m.to ? <span className="rto"> → {m.to}</span> : null}</span>}
      {m.broken
        ? <span className="rc-text">▒▒ {m.brokenWhy === 'stepped' ? 'two units keyed up at once' : 'broken and unreadable'} ▒▒ <button className="linkish" onClick={onRepeat}>Say again</button></span>
        : <span className="rc-text">{m.text}</span>}
      {m.understood && <span className="understood">understood as: {m.understood}</span>}
      <span className="mono rc-t">{m.clock}</span>
    </div>
  );
}

/** the outside line's phone book: pick the incident, see what helps, put the request in */
function OutsideLine({ engine, inc, setInc, onRequest }: { engine: GameEngine; inc: string; setInc: (id: string) => void; onRequest: (incId: string, resId: string) => void }) {
  const st = engine.state;
  const [group, setGroup] = useState<string>('Useful here');
  const open = Object.values(st.incidents).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status) && !i.hidden && !i.duplicateOf && i.requires.length > 0).sort((a, b) => b.num - a.num);
  const id = inc && st.incidents[inc] ? inc : (st.selected.kind === 'incident' && st.selected.id) || open[0]?.id || '';
  const infos = id ? Object.fromEntries(RESOURCES.map((r) => [r.id, engine.resourceInfo(id, r.id)])) : {};
  const list = RESOURCES.filter((r) => group === 'Useful here' ? infos[r.id] && (infos[r.id].ok || infos[r.id].status !== 'none') : r.group === group);
  return (
    <div className="rc-book">
      <div className="rcb-top">
        <select value={id} onChange={(e) => setInc(e.target.value)} aria-label="Incident">
          {!open.length && <option value="">No open incidents</option>}
          {open.map((i) => <option key={i.id} value={i.id}>{incName(engine, i.id)}{i.reportedNode === null ? ' (no location)' : ''}</option>)}
        </select>
        <div className="rcb-groups">{['Useful here', ...RESOURCE_GROUPS].map((g) => <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{g.replace(' & city services', '').replace(' specialists', '')}</button>)}</div>
      </div>
      <div className="rcb-list">
        {list.map((r) => {
          const i = infos[r.id];
          const status = i?.status ?? 'none';
          return (
            <div key={r.id} className={`rcb-row ${i?.asked ? 'asked' : ''} ${!i?.ok && status === 'none' ? 'na' : ''}`} title={r.desc}>
              <Icon n={r.icon} size={13} /><b>{r.name}</b>
              <span className="mono small muted">{r.cost ? `$${r.cost.toLocaleString()}` : 'free'} · {fmtTime(r.eta[0])}–{fmtTime(r.eta[1])}</span>
              {status !== 'none' ? <Badge tone={status === 'here' ? 'green' : 'blue'}>{status === 'here' ? 'ON SCENE' : `ROLLING · ${fmtTime(Math.max(0, i?.eta ?? 0))}`}</Badge>
                : <Btn size="sm" kind={i?.asked ? 'primary' : 'default'} disabled={!i?.ok} title={i?.reason} onClick={() => onRequest(id, r.id)}>{i?.ok ? (i.asked ? 'Crew asked — request' : 'Request') : i?.reason ?? 'No'}</Btn>}
            </div>
          );
        })}
        {!list.length && <p className="muted small pad">{id ? 'Nothing outside your fleet helps here. Browse the groups to send something anyway.' : 'No open incidents.'}</p>}
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
