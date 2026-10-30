import { useState } from 'react';
import { useEffect, useRef } from 'react';
import { PhoneIncoming, PhoneOff, Phone, Eye, EyeOff, Check, RotateCcw } from 'lucide-react';
import { useGame } from '../store/game';
import { CALL_RING_SECONDS, shownSeverity } from '../sim/world';
import { questionStates } from '../sim/calls';
import { PERSONALITIES } from '../sim/dialogueData';
import { Bar, SevChip, StatusChip, fmt } from './common';
import { SERVICE_COLOR } from './MapCanvas';
import { VEHICLES } from '../sim/units';

export function LeftPanel() {
  const phase = useGame((s) => s.phase);
  return <aside className="panel left">{phase === 'preshift' ? <Fleet /> : <Calls />}</aside>;
}

function Calls() {
  useGame((s) => s.rev);
  const [closed, setClosed] = useState(false);
  const g = useGame.getState();
  const w = g.world;
  const selected = g.sel.incidentId;
  const paused = g.clock.paused;
  const ringing = w.calls.filter((c) => c.status === 'ringing');
  const open = w.incidents.filter((i) => i.status !== 'RESOLVED' && i.status !== 'FAILED');
  const rows = (closed ? w.incidents : open).slice().sort((a, b) => {
    const ao = a.status === 'RESOLVED' || a.status === 'FAILED', bo = b.status === 'RESOLVED' || b.status === 'FAILED';
    if (ao !== bo) return ao ? 1 : -1;
    return b.severity - a.severity || b.pressure / b.failAfter - a.pressure / a.failAfter;
  });
  const active = w.activeCall !== null ? w.incidents.find((i) => i.id === w.activeCall) : undefined;
  return (
    <>
      {active?.session && <ActiveCall />}
      <h2>Incoming calls</h2>
      {ringing.length === 0 && <p className="muted small">No calls ringing.</p>}
      {ringing.map((c) => (
        <div key={c.id} className="call ringing">
          <div className="callhead"><PhoneIncoming size={15} /> <b>Emergency line</b><span className="muted mono">{Math.max(0, Math.ceil(c.deadline - w.time))}s</span></div>
          <Bar value={(c.deadline - w.time) / CALL_RING_SECONDS} kind="urgent" />
          <button className="primary" disabled={paused || !!active} onClick={() => g.answer(c.id)}
            title={active ? 'Finish the current call first' : 'Answer call (A)'}>{active ? 'On another call' : 'Answer'}</button>
        </div>
      ))}
      <h2 className="gap">Incident queue <span className="count">{open.length}</span>
        <button className="icon" onClick={() => setClosed(!closed)} title={closed ? 'Hide closed incidents' : 'Show closed incidents'}>{closed ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      </h2>
      {rows.length === 0 && <p className="muted small">Quiet for now.</p>}
      {rows.map((i) => (
        <button key={i.id} className={`inc sev${shownSeverity(i)} ${selected === i.id ? 'sel' : ''}`} onClick={() => g.selectIncident(i.id)}>
          <div className="r1"><b>#{i.id} {i.title}</b><SevChip sev={shownSeverity(i)} /></div>
          <div className="r2 muted">{i.believedNode === null ? 'Location unknown' : i.address} · {fmt(w.time - i.callAt)}{i.session ? ' · on the line' : ''}</div>
          <div className="r3"><StatusChip s={i.status} /></div>
          {i.status !== 'RESOLVED' && i.status !== 'FAILED' && <Bar value={i.pressure / i.failAfter} kind="danger" title="Danger: unattended time until the incident fails" />}
        </button>
      ))}
    </>
  );
}

function Fleet() {
  const g = useGame.getState();
  useGame((s) => s.sel.stationId);
  const w = g.world;
  return (
    <>
      <h2>Stations &amp; fleet</h2>
      {w.city.stations.map((s) => (
        <button key={s.id} className={`inc ${g.sel.stationId === s.id ? 'sel' : ''}`} onClick={() => { g.selectStation(s.id); const n = w.city.nodes[s.nodeId]; g.focusOn(n.x, n.y); }}>
          <div className="r1"><b style={{ color: SERVICE_COLOR[s.service] }}>{s.name}</b></div>
          <div className="r2 muted">{w.city.districts.find((d) => d.id === s.district)!.name}</div>
          <div className="r3 wrapchips">{w.units.filter((u) => u.stationId === s.id).map((u) => <span key={u.id} className="chip">{u.callsign}</span>)}</div>
        </button>
      ))}
      <p className="muted small gap">{w.units.length} units · {Object.keys(VEHICLES).length} vehicle types</p>
    </>
  );
}

function ActiveCall() {
  useGame((s) => s.rev);
  const g = useGame.getState();
  const w = g.world;
  const inc = w.incidents.find((i) => i.id === w.activeCall);
  const box = useRef<HTMLDivElement>(null);
  const n = inc?.transcript.length ?? 0;
  const pending = !!inc?.session?.pending;
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [n, pending]);
  if (!inc || !inc.session) return null;
  const s = inc.session;
  const groups = ['Location', 'Situation', 'Safety', 'Caller'] as const;
  const qs = questionStates(inc);
  return (
    <section className="phone">
      <div className="phonehead">
        <Phone size={14} /> <b>Call #{inc.id}</b>
        <span className="chip" title="How the caller sounds">{PERSONALITIES[s.personality].label}</span>
        <button className="danger" onClick={g.hangUp} title="End call (E)"><PhoneOff size={13} /> End</button>
      </div>
      <div className="patience" title="Caller patience: each question uses some. Reassuring the caller restores a little.">
        {Array.from({ length: s.maxPatience }, (_, i) => <i key={i} className={i < s.patience ? 'on' : ''} />)}
      </div>
      <div className="transcript" ref={box}>
        {inc.transcript.map((t, i) => <div key={i} className={`line ${t.who}`}><span className="who">{t.who === 'caller' ? 'Caller' : t.who === 'dispatcher' ? 'You' : '·'}</span>{t.text}</div>)}
        {pending && <div className="line caller typing"><span className="who">Caller</span>…</div>}
      </div>
      <div className="choices">
        {groups.map((gr) => {
          const items = qs.filter((v) => v.q.group === gr);
          return items.length ? (
            <div key={gr}><div className="ghead">{gr}</div>
              {items.map(({ q, state }) => (
                <button key={q.key} className={`choice ${state}`} disabled={pending || state === 'done'} onClick={() => g.askQuestion(q.key)}
                  title={state === 'again' ? 'The caller was unsure or did not answer. Ask again to get a firm answer.' : state === 'done' ? 'Answered' : 'Ask'}>
                  {state === 'done' ? <Check size={12} /> : state === 'again' ? <RotateCcw size={12} /> : null}<span>{q.text}</span>
                </button>
              ))}
            </div>
          ) : null;
        })}
      </div>
    </section>
  );
}
