import { useState } from 'react';
import { Search } from 'lucide-react';
import { useGame } from '../store/game';
import { VEHICLES } from '../sim/units';
import { StatusChip, fmt } from './common';
import { SERVICE_COLOR } from './MapCanvas';

type SortKey = 'callsign' | 'status' | 'eta' | 'station';

export function BottomPanel() {
  useGame((s) => s.rev);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('callsign');
  const [tab, setTab] = useState<'radio' | 'history'>('radio');
  const g = useGame.getState();
  const w = g.world;
  const filters = g.filters;
  const stationName = (id: string) => w.city.stations.find((s) => s.id === id)!.name;
  const units = w.units
    .filter((u) => filters[u.service])
    .filter((u) => `${u.callsign} ${VEHICLES[u.vehicle].name} ${u.status} ${stationName(u.stationId)}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      sort === 'eta' ? (b.eta || -1) - (a.eta || -1)
        : sort === 'status' ? a.status.localeCompare(b.status)
        : sort === 'station' ? a.stationId.localeCompare(b.stationId)
        : a.callsign.localeCompare(b.callsign));
  const th = (k: SortKey, label: string) => <th className={sort === k ? 'sorted' : ''} onClick={() => setSort(k)} title={`Sort by ${label}`}>{label}</th>;
  const history = w.incidents.filter((i) => i.status === 'RESOLVED' || i.status === 'FAILED').slice().reverse();

  return (
    <footer className="bottom">
      <section className="panel roster">
        <div className="rhead"><h2>Unit roster</h2>
          <label className="search"><Search size={12} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search units" aria-label="Search units" /></label>
        </div>
        <table>
          <thead><tr>{th('callsign', 'Unit')}<th>Vehicle</th>{th('station', 'Station')}{th('status', 'Status')}{th('eta', 'ETA')}<th>Cond.</th><th>Crew</th></tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className={g.sel.unitId === u.id ? 'sel' : ''} onClick={() => g.selectUnit(u.id)}>
                <td><span className="dot" style={{ background: SERVICE_COLOR[u.service] }} /> <b>{u.callsign}</b></td>
                <td>{VEHICLES[u.vehicle].name}</td><td>{stationName(u.stationId)}</td>
                <td><StatusChip s={u.status} />{u.incidentId ? <span className="muted"> #{u.incidentId}</span> : null}</td>
                <td className="mono">{u.eta ? `${Math.round(u.eta)}s` : '—'}</td><td className={u.condition < 40 ? 'badc' : u.condition < 70 ? 'warnc' : 'muted'} title="Vehicle condition: worn vehicles can break down">{Math.round(u.condition)}%</td><td>{u.personnel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel log">
        <div className="rhead"><h2>Activity</h2>
          <div className="seg small"><button className={tab === 'radio' ? 'on' : ''} onClick={() => setTab('radio')}>Radio</button><button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button></div>
        </div>
        {tab === 'radio'
          ? w.log.slice().reverse().map((l, i) => <div key={i} className={`logline ${l.kind}`}><span className="mono muted">{fmt(l.t)}</span> {l.text}</div>)
          : history.length === 0 ? <p className="muted small">No closed incidents yet.</p>
            : history.map((i) => <div key={i.id} className={`logline ${i.status === 'RESOLVED' ? 'good' : 'bad'}`}><span className="mono muted">{fmt(i.resolvedAt ?? 0)}</span> #{i.id} {i.title} — {i.status.toLowerCase()}. {i.outcome}</div>)}
      </section>
    </footer>
  );
}
