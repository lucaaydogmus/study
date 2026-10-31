import { useEffect, useRef, useState } from 'react';
import { addressOf } from '../sim/city';
import { gameClock, type GameEngine } from '../sim/engine';
import { classifyIntent, QUICK_QUESTIONS, type Intent } from '../sim/dialogue';
import { SERVICE_META } from '../sim/fleet';
import type { Call, Service } from '../sim/types';
import { useApp } from '../store';
import { Badge, Bar, Btn, Icon, fmtEta, fmtTime, SERVICE_ICON } from './common';
import { StatusBadge } from './RightPanel';
import { DeadlineBanner, LifeMeter } from './Ops';
import { TraceStatus } from './Field';
import { CallerAvatar, CallerLine, CallerQuestionPrompt, CprCoach, SuggestedReplies, suggestFor } from './CallExtras';

export type BottomTab = 'call' | 'radio' | 'units' | 'hospitals' | 'log' | 'transcripts';

export function BottomPanel({ engine, tab, setTab, openDispatch, tutorialHint }: { engine: GameEngine; tab: BottomTab; setTab: (t: BottomTab) => void; openDispatch: () => void; tutorialHint?: string }) {
  const st = engine.state;
  const calls = Object.values(st.calls);
  const live = calls.filter((c) => c.state === 'active' || c.state === 'hold' || c.state === 'ringing').length;
  const [radioSeen, setRadioSeen] = useState(0);
  useEffect(() => { if (tab === 'radio') setRadioSeen(st.radio.length); }, [tab, st.radio.length]);
  const unread = st.radio.length - radioSeen;
  const tabs: Array<{ id: BottomTab; label: string; icon: string; badge?: number }> = [
    { id: 'call', label: 'Call', icon: 'phone', badge: live || undefined }, { id: 'radio', label: 'Radio', icon: 'radio', badge: tab === 'radio' ? undefined : Math.min(unread, 99) || undefined },
    { id: 'units', label: 'Units', icon: 'car' }, { id: 'hospitals', label: 'Hospitals', icon: 'hosp' }, { id: 'log', label: 'Timeline', icon: 'clock' }, { id: 'transcripts', label: 'Transcripts', icon: 'note' },
  ];
  return (
    <div className="bottom">
      <div className="btabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <Icon n={t.icon} size={13} /> {t.label}{t.badge ? <span className="tabbadge">{t.badge}</span> : null}
          </button>
        ))}
        <div className="grow" />
        {tutorialHint && <span className="small muted pad">{tutorialHint}</span>}
      </div>
      <div className="bbody">
        {tab === 'call' && <CallConsole engine={engine} setTab={setTab} openDispatch={openDispatch} />}
        {tab === 'radio' && <RadioLog engine={engine} />}
        {tab === 'units' && <UnitRoster engine={engine} />}
        {tab === 'hospitals' && <HospitalBoard engine={engine} />}
        {tab === 'log' && <Timeline engine={engine} />}
        {tab === 'transcripts' && <Transcripts engine={engine} />}
      </div>
    </div>
  );
}

function CallConsole({ engine, setTab, openDispatch }: { engine: GameEngine; setTab: (t: BottomTab) => void; openDispatch: () => void }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const call = st.activeCallId ? st.calls[st.activeCallId] : null;
  const [text, setText] = useState('');
  const [grp, setGrp] = useState<'Opening' | 'Location' | 'Situation' | 'Guidance' | 'Instructions'>('Opening');
  const aiActive = useApp((s) => s.aiActive);
  const scroll = useRef<HTMLDivElement>(null);
  const len = call?.transcript.length ?? 0;
  useEffect(() => { const el = scroll.current; if (el) el.scrollTop = el.scrollHeight; }, [len, call?.id, call?.typing, call?.question?.at]);
  const onHold = Object.values(st.calls).filter((c) => c.state === 'hold');
  const ringing = Object.values(st.calls).filter((c) => c.state === 'ringing');

  if (!call) {
    return (
      <div className="nocall">
        <Icon n="phone" size={28} />
        <div>
          <b>{ringing.length ? `${ringing.length} call${ringing.length > 1 ? 's' : ''} ringing` : onHold.length ? `${onHold.length} on hold` : 'Line clear'}</b>
          <div className="muted small">{ringing.length ? 'Press A or click ANSWER in the call queue.' : 'Waiting for the next 911 call. Use the time to position units — select an available unit, then click Reposition.'}</div>
        </div>
        <div className="btnrow">
          {ringing[0] && <Btn kind="primary" icon="phone" onClick={() => { engine.answerCall(ringing[0].id); bump(); }}>Answer next call</Btn>}
          {onHold.map((c) => <Btn key={c.id} icon="phone" onClick={() => { engine.answerCall(c.id); bump(); }}>Resume {c.profile.name.split(' ')[0]}</Btn>)}
        </div>
      </div>
    );
  }
  const inc = st.incidents[call.incidentId];
  const send = (intent?: Intent, t?: string) => { engine.ask(call.id, { intent, text: t }); setText(''); bump(); };
  const submit = () => { const t = text.trim(); if (!t) return; send(undefined, t); };
  const detected = text.trim().length > 3 ? classifyIntent(text) : null;
  const mood = call.mood;
  const stateTone = mood.panic > 72 ? 'red' : mood.frustration > 55 ? 'amber' : mood.panic > 45 ? 'amber' : 'green';
  const elapsed = st.time - (call.answeredAt ?? st.time);
  const transferLabel = inc.truth.outside ? 'Transfer to county' : 'Transfer';
  const lastLine = call.transcript[call.transcript.length - 1];
  const speaking = call.typing || (lastLine?.who === 'CALLER' && st.time - lastLine.t < 1.5);
  const sugg = suggestFor(engine, call, inc);
  const cpr = inc.aid?.kind === 'cpr' && inc.aid.fit === 'good' && inc.careAt == null && inc.lifeThreat === 'arrest';
  return (
    <div className="callgrid">
      <div className="callmain">
        <div className="callhead">
          <div className="callid"><CallerAvatar call={call} speaking={speaking} /> <b>{call.profile.name}</b> <span className="muted">· {call.callerId}</span> {call.isCallback && <Badge tone="amber">CALLBACK</Badge>}{aiActive && <span className="aibadge" title="This caller's lines are improvised by Claude">AI</span>}</div>
          <span className="mono">{fmtTime(elapsed)}</span>
          <Badge tone={stateTone}>{call.profile.emotionalState.toUpperCase()}</Badge>
          <div className="meters">
            <div title="Caller stress"><span>Stress</span><Bar value={mood.panic} tone={mood.panic > 70 ? 'red' : mood.panic > 45 ? 'amber' : 'green'} label="Stress" /></div>
            <div title="Cooperation"><span>Cooperation</span><Bar value={mood.cooperation} tone="blue" label="Cooperation" /></div>
          </div>
        </div>
        <LifeMeter inc={inc} compact />
        <TraceStatus call={call} />
        {inc.deadlineAt != null && inc.deadlineMet == null && <DeadlineBanner engine={engine} inc={inc} />}
        {cpr && <CprCoach engine={engine} call={call} inc={inc} />}
        <div className="transcript" ref={scroll} aria-live="polite" aria-label="Call transcript">
          {call.transcript.map((l, i) => (
            <div key={i} className={`tline ${l.who.toLowerCase()}`}>
              <span className="tt mono">{l.clock}</span><span className="tw">{l.who}</span><span className="tx">{l.who === 'SYSTEM' ? l.text : l.who === 'CALLER' ? <CallerLine engine={engine} call={call} inc={inc} line={l} fresh={i === call.transcript.length - 1 && st.time - l.t < 2} /> : `“${l.text}”`}</span>
            </div>
          ))}
          <CallerQuestionPrompt engine={engine} call={call} />
          {call.typing && <div className="tline caller typing"><span className="tt mono">{gameClock(st)}</span><span className="tw">CALLER</span><span className="tx"><i className="dots"><b /><b /><b /></i></span></div>}
        </div>
        <SuggestedReplies items={sugg} onPick={(q) => send(q.intent, q.text)} />
        <div className="inputrow">
          <input aria-label="Say to caller" placeholder={aiActive ? 'Talk to the caller in your own words — they hear exactly what you type…' : 'Type what you say… (e.g. “What is the address?”) — or use the quick questions →'} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); else if (e.key === 'Tab' && !text.trim() && sugg[0]) { e.preventDefault(); send(sugg[0].intent, sugg[0].text); } e.stopPropagation(); }} />
          {detected && detected !== 'unknown' && <span className="detect small muted">{detected}</span>}
          <Btn kind="primary" icon="send" onClick={submit} disabled={!text.trim()}>Say</Btn>
        </div>
      </div>
      <div className="callside">
        <div className="qgroups" role="tablist">
          {(['Opening', 'Location', 'Situation', 'Guidance', 'Instructions'] as const).map((g) => <button key={g} role="tab" aria-selected={grp === g} className={grp === g ? 'on' : ''} onClick={() => setGrp(g)}>{g}</button>)}
        </div>
        <div className="qchips">
          {QUICK_QUESTIONS.filter((q) => q.group === grp).map((q) => (
            <button key={q.intent} className={`chip ${call.asked[q.intent] ? 'asked' : ''}`} title={q.text} onClick={() => send(q.intent, q.text)}>
              {call.asked[q.intent] ? <Icon n="check" size={11} /> : null}{q.label}
            </button>
          ))}
        </div>
        <div className="callctl">
          <Btn size="sm" kind="danger" icon="phoneoff" onClick={() => { engine.endCall(call.id); bump(); }} title="End call (E)">End call</Btn>
          <Btn size="sm" icon="hold" onClick={() => { engine.holdCall(call.id); bump(); }} title="Hold call (H)">Hold</Btn>
          <Btn size="sm" icon="transfer" onClick={() => { const m = engine.transferCall(call.id); useApp.getState().showToast(m, 'info'); bump(); }} title={inc.truth.outside ? 'Hand the caller to the neighbouring agency' : 'Hand the call to a dispatch assistant'}>{transferLabel}</Btn>
          <Btn size="sm" icon="pin" disabled={!!call.trace} onClick={() => { const r = engine.startTrace(call.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); bump(); }} title="Ask the carrier for the caller's location — keep them on the line while it refines">{call.trace ? (call.trace.done ? 'Traced' : 'Tracing…') : 'Trace call'}</Btn>
          {call.profile.language && <Btn size="sm" kind={call.interpreter ? 'default' : 'primary'} icon="users" disabled={!!call.interpreter} onClick={() => { const r = engine.requestInterpreter(call.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); bump(); }} title="Conference a Language Line interpreter">{call.interpreter === 'on' ? 'Interpreter on' : call.interpreter ? 'Connecting…' : `${call.profile.language} interpreter`}</Btn>}
          <Btn size="sm" icon="map" onClick={openDispatch} title="Open the incident and dispatch panel">Dispatch panel</Btn>
          <Btn size="sm" icon="note" onClick={() => setTab('transcripts')} title="View full transcript">Transcript</Btn>
        </div>
        {onHold.length > 0 && <div className="small muted">On hold: {onHold.map((c) => c.profile.name).join(', ')}</div>}
      </div>
    </div>
  );
}

function RadioLog({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const [f, setF] = useState<Service | 'all'>('all');
  const ref = useRef<HTMLDivElement>(null);
  const msgs = st.radio.filter((m) => f === 'all' || m.kind === 'alert' || (m.unitId && st.units[m.unitId]?.service === f));
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [st.radio.length]);
  const lastTx = st.radio.length ? st.time - st.radio[st.radio.length - 1].t : 999;
  return (
    <div className="listpane">
      <div className="listhead">
        <span className={`txdot ${lastTx < 3 ? 'on' : ''}`} aria-label={lastTx < 3 ? 'Radio traffic' : 'Radio idle'} /> <b>CITY RADIO</b>
        <div className="seg">{(['all', 'police', 'fire', 'medical'] as const).map((s) => <button key={s} className={f === s ? 'on' : ''} onClick={() => setF(s)} aria-pressed={f === s}>{s === 'all' ? 'ALL' : SERVICE_META[s].short}</button>)}</div>
      </div>
      <div className="scrolly" ref={ref}>
        {msgs.map((m) => (
          <div key={m.id} className={`rline ${m.kind}`}>
            <span className="mono tt">{m.clock}</span>
            <span className="rfrom">{m.from}{m.to ? <span className="rto"> → {m.to}</span> : null}</span>
            <span>{m.text}</span>
          </div>
        ))}
        {!msgs.length && <p className="muted pad">No radio traffic yet. Select a unit and use “Radio check” for a status report.</p>}
      </div>
    </div>
  );
}

/** live hospital capacity: departments, ER load and diversions, as of the last bed-board refresh */
function HospitalBoard({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const hs = Object.values(st.hospitals ?? {});
  const inbound = (node: number) => Object.values(st.units).filter((u) => u.status === 'TRANSPORTING' && u.destNode === node);
  const oldest = hs.reduce((m, h) => Math.max(m, h.known ? st.time - h.known.at : 999), 0);
  return (
    <div className="listpane">
      <div className="listhead"><b>HOSPITAL BED BOARD</b><span className={`small ${oldest > 120 ? 'warn' : 'muted'}`}>{oldest > 900 ? 'never refreshed' : `updated ${fmtTime(oldest)} ago`}</span><div className="grow" /><Btn size="sm" icon="radio" onClick={() => { engine.refreshHospitalBoard(); bump(); }}>Refresh</Btn></div>
      <div className="scrolly hboard">
        {hs.map((h) => {
          const k = h.known;
          const ins = inbound(h.node);
          return (
            <div key={h.node} className={`hrow ${k?.diversion ? 'divert' : ''}`}>
              <div className="hr-name"><b>{h.name}</b><span className="small muted">{addressOf(engine.city, h.node)}</span></div>
              <div className="depts">{h.has.length ? h.has.map((d) => <i key={d} className={`dept ${k?.down.includes(d) ? 'down' : 'up'}`}>{d}</i>) : <i className="dept none">minor injuries only</i>}</div>
              <div className="hr-er"><span className="small">ER</span><Bar value={k?.er ?? 0} max={h.erCap} tone={(k?.er ?? 0) >= h.erCap ? 'red' : (k?.er ?? 0) >= h.erCap * 0.75 ? 'amber' : 'green'} label="ER load" /><span className="mono small">{k ? `${k.er}/${h.erCap}` : '?'}</span></div>
              <div className="hr-in small">{k?.diversion ? <Badge tone="red">ON DIVERSION</Badge> : null}{ins.length ? <span>{ins.map((u) => `${u.callsign}${h.prealerts.includes(u.assignedIncidentId ?? '') ? ' ✓' : ''}`).join(', ')} inbound</span> : <span className="muted">no ambulances inbound</span>}</div>
            </div>
          );
        })}
        <p className="muted small pad">Departments go down and ERs fill up during the shift — the board only shows what you knew at the last refresh. Pre-alert the hospital from a transporting ambulance so the team is waiting.</p>
      </div>
    </div>
  );
}

function UnitRoster({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const [f, setF] = useState<Service | 'all'>('all');
  const units = Object.values(st.units).filter((u) => f === 'all' || u.service === f);
  return (
    <div className="listpane">
      <div className="listhead"><b>UNIT ROSTER</b><span className="muted small">{units.length} units</span>
        <div className="seg">{(['all', 'police', 'fire', 'medical'] as const).map((s) => <button key={s} className={f === s ? 'on' : ''} onClick={() => setF(s)} aria-pressed={f === s}>{s === 'all' ? 'ALL' : SERVICE_META[s].short}</button>)}</div>
      </div>
      <div className="scrolly">
        <table className="tbl">
          <thead><tr><th>Unit</th><th>Type</th><th>Status</th><th>Location</th><th>Assignment</th><th>ETA</th><th>Fatigue</th></tr></thead>
          <tbody>
            {units.map((u) => {
              const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : null;
              const crew = engine.crewOf(u);
              const fat = crew.reduce((s, p) => s + p.fatigue, 0) / Math.max(1, crew.length);
              return (
                <tr key={u.id} className={st.selected.id === u.id ? 'sel' : ''} onClick={() => { engine.select('unit', u.id); bump(); }}>
                  <td><span className="svcdot" style={{ color: SERVICE_META[u.service].color }}><Icon n={SERVICE_ICON[u.service]} size={12} /></span> <b className="mono">{u.callsign}</b></td>
                  <td className="muted">{u.typeLabel}</td><td><StatusBadge s={u.status} /></td>
                  <td>{addressOf(engine.city, engine.city.nearestNode(u.x, u.y))}</td>
                  <td>{inc ? inc.label : '—'}</td><td className="mono">{['EN_ROUTE', 'RETURNING', 'TRANSPORTING', 'DISPATCHED'].includes(u.status) ? fmtEta(u.eta) : '—'}</td>
                  <td><Bar value={fat} tone={fat > 70 ? 'red' : fat > 45 ? 'amber' : 'green'} label="Fatigue" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Timeline({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const items = st.timeline.filter((t) => t.kind !== 'radio').slice(-120).reverse();
  return (
    <div className="listpane"><div className="listhead"><b>ACTIVITY TIMELINE</b><span className="muted small">{items.length} events</span></div>
      <div className="scrolly">
        {items.map((t, i) => (<div key={i} className={`tl ${t.good === true ? 'good' : t.good === false ? 'bad' : ''}`}><span className="mono tt">{gameClock(st, t.t)}</span><span className={`tk ${t.kind}`}>{t.kind.toUpperCase()}</span><span>{t.text}</span></div>))}
      </div></div>
  );
}

function Transcripts({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const calls = Object.values(st.calls).filter((c) => c.transcript.length > 0).sort((a, b) => b.ringStart - a.ringStart);
  const [sel, setSel] = useState<string | null>(null);
  const call: Call | undefined = calls.find((c) => c.id === (sel ?? st.activeCallId)) ?? calls[0];
  return (
    <div className="tgrid">
      <div className="tlist scrolly">
        {calls.map((c) => (
          <button key={c.id} className={`rowbtn ${call?.id === c.id ? 'sel' : ''}`} onClick={() => setSel(c.id)}>
            <span><b>{c.profile.name}</b> <span className="muted small">{st.incidents[c.incidentId]?.label}</span></span>
            <Badge tone={c.state === 'active' ? 'green' : c.state === 'hold' ? 'amber' : 'neutral'}>{c.state.toUpperCase()}</Badge>
          </button>
        ))}
        {!calls.length && <p className="muted pad">No calls yet.</p>}
      </div>
      <div className="scrolly transcript">
        {call?.transcript.map((l, i) => (<div key={i} className={`tline ${l.who.toLowerCase()}`}><span className="tt mono">{l.clock}</span><span className="tw">{l.who}</span><span className="tx">{l.who === 'SYSTEM' ? l.text : `“${l.text}”`}</span></div>))}
      </div>
    </div>
  );
}
