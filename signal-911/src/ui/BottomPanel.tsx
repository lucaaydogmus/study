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
import { CallConsole } from './CallConsole';

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
        {tab === 'call' && <CallConsole engine={engine} setTab={(t) => setTab(t as BottomTab)} openDispatch={openDispatch} />}
        {tab === 'radio' && <RadioLog engine={engine} />}
        {tab === 'units' && <UnitRoster engine={engine} />}
        {tab === 'hospitals' && <HospitalBoard engine={engine} />}
        {tab === 'log' && <Timeline engine={engine} />}
        {tab === 'transcripts' && <Transcripts engine={engine} />}
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
