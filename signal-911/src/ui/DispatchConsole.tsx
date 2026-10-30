import { useMemo, useState } from 'react';
import { CAP_LABEL } from '../sim/content/vocab';
import type { GameEngine } from '../sim/engine';
import { SERVICE_META } from '../sim/fleet';
import type { Capability, Incident, Req, Service, Unit } from '../sim/types';
import { useApp } from '../store';
import { Badge, Btn, Icon, Section, fmtEta, SERVICE_ICON } from './common';
import { StatusBadge } from './RightPanel';

export type Preview = { unitId: string; path: number[] } | null;

function fatigueOf(engine: GameEngine, u: Unit) {
  const c = engine.crewOf(u);
  return c.length ? c.reduce((s, p) => s + p.fatigue, 0) / c.length : 0;
}

export function DispatchConsole({ engine, inc, rec, setPreview }: { engine: GameEngine; inc: Incident; rec: Req[]; setPreview: (p: Preview) => void }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const [svc, setSvc] = useState<Service | 'all'>('all');
  const [code, setCode] = useState<2 | 3>(inc.severity >= 3 ? 3 : 2);
  const [showBusy, setShowBusy] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const tick = Math.floor(st.time / 2);
  const node = inc.reportedNode;
  const plan = useMemo(() => (node === null ? { units: [], uncovered: [] as Capability[] } : engine.buildPlan(inc.id, rec)), [tick, node, inc.assignedUnits.length, rec.map((r) => r.cap + r.n).join()]);
  const cands = useMemo(() => {
    if (node === null) return [];
    return Object.values(st.units)
      .filter((u) => !(u.assignedIncidentId === inc.id && u.status !== 'RETURNING') && (svc === 'all' || u.service === svc) && (showBusy || ['AVAILABLE', 'RETURNING'].includes(u.status) || (u.status === 'EN_ROUTE' && u.assignedIncidentId !== inc.id)))
      .map((u) => ({ u, est: engine.estimate(u.id, node), can: engine.canDispatch(u, inc) }))
      .sort((a, b) => Number(b.can.ok) - Number(a.can.ok) || (a.est?.eta ?? 1e9) - (b.est?.eta ?? 1e9))
      .slice(0, 14);
  }, [tick, node, svc, showBusy, inc.assignedUnits.length]);
  const maxEta = Math.max(60, ...cands.map((c) => (c.est && isFinite(c.est.eta) ? c.est.eta : 0)));
  const recCaps = new Set(rec.map((r) => r.cap));
  const send = (ids: string[]) => {
    let ok = 0;
    for (const id of ids) { const r = engine.dispatch(id, inc.id, { code }); if (r.ok) ok++; else useApp.getState().showToast(r.reason ?? 'Cannot dispatch', 'warn'); }
    if (ok) { setSel([]); setPreview(null); bump(); }
  };
  const hover = (u: Unit | null) => setPreview(u && node !== null ? { unitId: u.id, path: engine.previewRoute(u.id, node) } : null);
  if (node === null) return <Section title="Dispatch" id="dispatch"><p className="muted small">Set the incident location to plan a response.</p></Section>;
  return (
    <Section title="Dispatch" id="dispatch" right={
      <div className="seg" role="group" aria-label="Response code">
        <button className={code === 3 ? 'on red' : ''} onClick={() => setCode(3)} title="Lights and sirens: fastest, small risk of a crash en route (higher in bad weather)">CODE 3</button>
        <button className={code === 2 ? 'on' : ''} onClick={() => setCode(2)} title="No lights or sirens: slower, but no crash risk">CODE 2</button>
      </div>}>
      {/* Response plan */}
      <div className="plan">
        <div className="plan-head"><Icon n="layers" size={13} /> <b>Response plan</b><span className="grow" /><span className="small muted">{code === 3 ? 'lights & sirens' : 'routine driving'}</span></div>
        {plan.units.length === 0 && plan.uncovered.length === 0 && <div className="small muted">Suggested response already covered{inc.assignedUnits.length ? ' by assigned units' : ''}.</div>}
        {plan.units.map(({ unit: u, covers, eta }) => (
          <div className="plan-row" key={u.id} onMouseEnter={() => hover(u)} onMouseLeave={() => hover(null)}>
            <span className="svcico" style={{ color: SERVICE_META[u.service].color }}><Icon n={SERVICE_ICON[u.service]} size={12} /></span>
            <b className="mono">{u.callsign}</b><span className="small muted">{covers.map((c) => CAP_LABEL[c]).join(', ')}</span><span className="grow" /><b className="mono">{fmtEta(eta)}</b>
          </div>
        ))}
        {plan.uncovered.map((c) => (
          <div className="plan-row miss" key={c}><Icon n="alert" size={12} /> No free unit for <b>{CAP_LABEL[c]}</b><span className="grow" /><Btn size="sm" onClick={() => { const r = engine.requestMutualAid(inc.id, c); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); bump(); }}>Mutual aid −$4k</Btn></div>
        ))}
        {plan.units.length > 0 && <Btn kind="primary" icon="send" className="full" onClick={() => send(plan.units.map((x) => x.unit.id))}>Dispatch plan · {plan.units.length} unit{plan.units.length > 1 ? 's' : ''} · Code {code}</Btn>}
      </div>

      <div className="dc-filters">
        <div className="seg">{(['all', 'police', 'fire', 'medical'] as const).map((s) => <button key={s} className={svc === s ? 'on' : ''} onClick={() => setSvc(s)} aria-pressed={svc === s}>{s === 'all' ? 'ALL' : SERVICE_META[s].short}</button>)}</div>
        <label className="small muted chk"><input type="checkbox" checked={showBusy} onChange={(e) => setShowBusy(e.target.checked)} /> show busy</label>
      </div>
      <div className="dclist">
        {cands.map(({ u, est, can }, i) => {
          const eta = est?.eta;
          const matches = u.capabilities.filter((c) => recCaps.has(c));
          const imp = i < 8 && can.ok ? engine.coverageImpact(u.id) : null;
          const drop = imp ? (imp.before - imp.after) * 100 : 0;
          const fat = fatigueOf(engine, u);
          const checked = sel.includes(u.id);
          return (
            <div key={u.id} className={`dcu ${can.ok ? '' : 'off'} ${checked ? 'sel' : ''}`} onMouseEnter={() => hover(u)} onMouseLeave={() => hover(null)}>
              <input type="checkbox" aria-label={`Select ${u.callsign}`} disabled={!can.ok} checked={checked} onChange={() => setSel(checked ? sel.filter((x) => x !== u.id) : [...sel, u.id])} />
              <div className="dcu-main">
                <div className="dcu-top">
                  <span className="svcico" style={{ color: SERVICE_META[u.service].color }}><Icon n={SERVICE_ICON[u.service]} size={12} /></span>
                  <b className="mono">{u.callsign}</b><span className="small muted">{u.typeLabel}</span>
                  {matches.length > 0 && <span className="rec" title="Matches the suggested response">★</span>}
                  <span className="grow" /><StatusBadge s={u.status} />
                </div>
                <div className="etabar" title={`ETA ${fmtEta(eta)}`}><i style={{ width: `${eta && isFinite(eta) ? Math.max(4, (eta / maxEta) * 100) : 100}%` }} className={eta && eta < 90 ? 'g' : eta && eta < 160 ? 'a' : 'r'} /><span className="mono">{fmtEta(eta)}</span><span className="small muted">{est ? `${est.dist.toFixed(1)} km` : ''}</span></div>
                <div className="dcu-meta small">
                  {u.capabilities.map((c) => <span key={c} className={`cap ${recCaps.has(c) ? 'hit' : ''}`}>{CAP_LABEL[c]}</span>)}
                  <span className={`fat ${fat > 70 ? 'r' : fat > 45 ? 'a' : 'g'}`} title={`Crew fatigue ${Math.round(fat)}%`}>● crew {engine.crewOf(u).length}</span>
                </div>
                {drop >= 6 && <div className={`impact ${drop >= 15 ? 'r' : 'a'}`}><Icon n="alert" size={11} /> Leaves {SERVICE_META[imp!.service].short} cover at {Math.round(imp!.after * 100)}% (−{Math.round(drop)}%){imp!.exposed ? ` · ${imp!.exposed} exposed` : ''}</div>}
                {u.assignedIncidentId && u.assignedIncidentId !== inc.id && st.incidents[u.assignedIncidentId] && <div className="small warn">Diverting from: {st.incidents[u.assignedIncidentId].label}</div>}
                {!can.ok && <div className="small muted">{can.reason}</div>}
              </div>
              <Btn size="sm" kind={matches.length ? 'primary' : 'default'} disabled={!can.ok} onClick={() => send([u.id])}>{u.assignedIncidentId && u.assignedIncidentId !== inc.id ? 'Divert' : 'Send'}</Btn>
            </div>
          );
        })}
        {!cands.length && <p className="muted small">No units match this filter.</p>}
      </div>
      {sel.length > 0 && <div className="dc-foot"><span>{sel.length} selected</span><span className="grow" /><Btn kind="ghost" size="sm" onClick={() => setSel([])}>Clear</Btn><Btn kind="primary" icon="send" onClick={() => send(sel)}>Dispatch selected · Code {code}</Btn></div>}
      {inc.assignedUnits.length === 0 && <Badge tone="red">NO UNITS ASSIGNED</Badge>}
    </Section>
  );
}
