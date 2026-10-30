import { useState } from 'react';
import { PhoneIncoming, Eye, EyeOff } from 'lucide-react';
import { useGame } from '../store/game';
import { CALL_RING_SECONDS } from '../sim/world';
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
  return (
    <>
      <h2>Incoming calls</h2>
      {ringing.length === 0 && <p className="muted small">No calls ringing.</p>}
      {ringing.map((c) => (
        <div key={c.id} className="call ringing">
          <div className="callhead"><PhoneIncoming size={15} /> <b>Emergency line</b><span className="muted mono">{Math.max(0, Math.ceil(c.deadline - w.time))}s</span></div>
          <Bar value={(c.deadline - w.time) / CALL_RING_SECONDS} kind="urgent" />
          <button className="primary" disabled={paused} onClick={() => g.answer(c.id)} title="Answer call (A)">Answer</button>
        </div>
      ))}
      <h2 className="gap">Incident queue <span className="count">{open.length}</span>
        <button className="icon" onClick={() => setClosed(!closed)} title={closed ? 'Hide closed incidents' : 'Show closed incidents'}>{closed ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      </h2>
      {rows.length === 0 && <p className="muted small">Quiet for now.</p>}
      {rows.map((i) => (
        <button key={i.id} className={`inc sev${i.severity} ${selected === i.id ? 'sel' : ''}`} onClick={() => g.selectIncident(i.id)}>
          <div className="r1"><b>#{i.id} {i.title}</b><SevChip sev={i.severity} /></div>
          <div className="r2 muted">{i.address} · {fmt(w.time - i.callAt)}</div>
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
