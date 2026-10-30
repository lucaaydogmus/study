// Right-click (and hospital click) menu on the map: quick orders for incidents, units, stations,
// hospitals and empty streets, plus the drop handler for drag-to-dispatch.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { addressOf } from '../sim/city';
import { AGENCY, recommendFor, type GameEngine } from '../sim/engine';
import { SERVICE_META, isAir } from '../sim/fleet';
import type { Incident, Service, Unit } from '../sim/types';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { Icon, SERVICE_ICON, fmtEta } from './common';
import { openCctv } from './Field';

export interface MenuState { x: number; y: number; node: number; hit: { kind: string; id: string } | null; key: number }
interface MenuCtx {
  engine: GameEngine; menu: MenuState; onClose: () => void;
  focus: (x: number, y: number, zoom?: number) => void;
  startReposition: (unitId: string) => void;
  openTab: (tab: string) => void;
}

const live = (i: Incident) => !i.hidden && !['RESOLVED', 'CLOSED'].includes(i.status) && i.reportedNode !== null;
function feedback(r: { ok: boolean; reason?: string } | boolean, okText?: string) {
  const ok = typeof r === 'boolean' ? r : r.ok;
  if (ok) { audio.dispatchConfirm(); if (okText) useApp.getState().showToast(okText, 'info'); }
  else { audio.error(); useApp.getState().showToast((typeof r === 'object' && r.reason) || 'Not possible right now', 'warn'); }
  useApp.getState().bump();
  return ok;
}
/** the closest free ground unit of a service that can take this incident */
function nearestFor(engine: GameEngine, inc: Incident, service: Service): { unit: Unit; eta: number } | null {
  let best: { unit: Unit; eta: number } | null = null;
  for (const u of Object.values(engine.state.units)) {
    if (u.service !== service || isAir(u) || !['AVAILABLE', 'RETURNING'].includes(u.status) || (u.status === 'RETURNING' && u.assignedIncidentId)) continue;
    if (!engine.canDispatch(u, inc).ok) continue;
    const eta = engine.estimate(u.id, inc.reportedNode!)?.eta ?? Infinity;
    if (isFinite(eta) && (!best || eta < best.eta)) best = { unit: u, eta };
  }
  return best;
}
/** the free unit at a station that best fills what the incident still needs */
export function stationPick(engine: GameEngine, stationId: string, inc: Incident): Unit | null {
  const st = engine.state;
  const here = Object.values(st.units).filter((u) => u.stationId === stationId && !isAir(u) && ['AVAILABLE', 'RETURNING'].includes(u.status) && engine.canDispatch(u, inc).ok);
  if (!here.length) return null;
  const need = recommendFor(inc, st.rank).filter((r) => inc.assignedUnits.filter((id) => st.units[id]?.capabilities.includes(r.cap)).length < r.n).map((r) => r.cap);
  return here.find((u) => u.capabilities.some((c) => need.includes(c))) ?? here[0];
}
/** the open search sector (if any) that contains a node */
export function sectorAt(engine: GameEngine, node: number): { inc: Incident; idx: number } | null {
  const n = engine.city.nodes[node];
  for (const inc of Object.values(engine.state.incidents)) {
    const S = inc.search;
    if (!S || S.found || inc.hidden || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
    const idx = S.sectors.findIndex((sec) => sec.searched < 1 && Math.hypot(sec.x - n.x, sec.y - n.y) <= S.r);
    if (idx >= 0) return { inc, idx };
  }
  return null;
}
/** drag-to-dispatch: a unit or a station dropped on an incident, a hospital or an empty street */
export function handleDrop(engine: GameEngine, src: { kind: 'unit' | 'station' | 'incident'; id: string }, target: { kind: string; id: string } | null, node: number) {
  const st = engine.state;
  if (src.kind === 'incident') {
    const inc = st.incidents[src.id];
    if (!inc) return;
    if (target?.kind === 'incident') { const other = st.incidents[target.id]; feedback(engine.linkIncident(inc.id, target.id), `Linked to ${other?.label ?? 'incident'}`); return; }
    if (target) return;
    engine.setIncidentLocation(inc.id, node, 'map');
    feedback(true, `${inc.label} moved to ${addressOf(engine.city, node)}`);
    return;
  }
  if (target?.kind === 'incident') {
    const inc = st.incidents[target.id];
    if (!inc) return;
    const u = src.kind === 'unit' ? st.units[src.id] : stationPick(engine, src.id, inc);
    if (!u) { feedback({ ok: false, reason: 'No free unit at that station can take this call' }); return; }
    const r = u.assignedIncidentId && u.assignedIncidentId !== inc.id ? engine.divert(u.id, inc.id) : engine.dispatch(u.id, inc.id, { code: inc.severity >= 3 ? 3 : 2 });
    feedback(r, `${u.callsign} → ${inc.label}`);
    return;
  }
  if (src.kind !== 'unit') return;
  const u = st.units[src.id];
  if (!u) return;
  if (target?.kind === 'hospital') { if (u.status === 'TRANSPORTING') feedback(engine.setHospital(u.id, Number(target.id))); else feedback({ ok: false, reason: `${u.callsign} has no patient on board` }); return; }
  if (target) return;
  const sec = sectorAt(engine, node);
  if (sec) { feedback(engine.assignSearch(sec.inc.id, sec.idx, u.id), `${u.callsign} searching sector ${sec.inc.search!.sectors[sec.idx].id}`); return; }
  if (isAir(u)) { feedback({ ok: false, reason: 'Aircraft are tasked to incidents, not to street corners' }); return; }
  if (!['AVAILABLE', 'RETURNING'].includes(u.status)) { feedback({ ok: false, reason: `${u.callsign} is committed — recall it first` }); return; }
  feedback(engine.reposition(u.id, node), `${u.callsign} moving to ${addressOf(engine.city, node)}`);
}

function Item({ icon, children, sub, onClick, disabled, tone, color }: { icon: string; children: ReactNode; sub?: ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'primary' | 'danger'; color?: string }) {
  return (
    <button className={`mm-item ${tone ?? ''}`} role="menuitem" disabled={disabled} onClick={onClick}>
      <span className="mm-ico" style={color ? { color } : undefined}><Icon n={icon} size={13} /></span>
      <span className="mm-txt">{children}</span>
      {sub !== undefined && <span className="mm-sub mono">{sub}</span>}
    </button>
  );
}

export function MapMenu({ engine, menu, onClose, focus, startReposition, openTab }: MenuCtx) {
  const st = engine.state;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const [sub, setSub] = useState<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.parentElement;
    if (!el || !parent) return;
    const W = parent.clientWidth, H = parent.clientHeight;
    setPos({ x: Math.max(8, Math.min(menu.x + 6, W - el.offsetWidth - 8)), y: Math.max(8, Math.min(menu.y + 6, H - el.offsetHeight - 8)) });
  }, [menu.key, sub]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const wheel = () => onClose();
    window.addEventListener('pointerdown', down, true); window.addEventListener('wheel', wheel, { passive: true });
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('wheel', wheel); };
  }, [onClose]);
  useEffect(() => { setSub(null); }, [menu.key]);

  const run = (fn: () => void) => () => { fn(); onClose(); };
  const n = engine.city.nodes[menu.node];
  const hit = menu.hit;
  let head: ReactNode = null, body: ReactNode = null;

  if (hit?.kind === 'incident' && st.incidents[hit.id]) {
    const inc = st.incidents[hit.id];
    const sev = inc.severity >= 4 ? '#D65353' : inc.severity === 3 ? '#E5AC4D' : '#4A9CD6';
    const plan = live(inc) ? engine.buildPlan(inc.id, recommendFor(inc, st.rank)) : { units: [], uncovered: [] };
    const code: 2 | 3 = inc.severity >= 3 ? 3 : 2;
    const near = (['police', 'fire', 'medical'] as const).map((s) => ({ s, n: live(inc) ? nearestFor(engine, inc, s) : null }));
    const heli = Object.values(st.units).find((u) => isAir(u) && engine.canDispatch(u, inc).ok && !inc.assignedUnits.includes(u.id));
    const assigned = inc.assignedUnits.map((id) => st.units[id]).filter(Boolean);
    head = (
      <>
        <div className="mm-title"><i className="mm-dot" style={{ background: sev }} />{inc.label}<span className="mm-tag">P{6 - inc.severity}</span></div>
        <div className="mm-meta">{inc.reportedNode !== null ? addressOf(engine.city, inc.reportedNode) : 'location unknown'} · {assigned.length ? `${assigned.length} unit${assigned.length > 1 ? 's' : ''} assigned` : 'no units yet'}</div>
      </>
    );
    body = (
      <>
        {plan.units.length > 0 && <Item icon="send" tone="primary" sub={`${plan.units.length} · C${code}`} onClick={run(() => { let ok = 0; for (const x of plan.units) if (engine.dispatch(x.unit.id, inc.id, { code }).ok) ok++; feedback(ok > 0, `Response plan dispatched · ${ok} unit${ok > 1 ? 's' : ''}`); })}>Dispatch response plan</Item>}
        {near.map(({ s, n: x }) => (
          <Item key={s} icon={SERVICE_ICON[s]} color={SERVICE_META[s].color} disabled={!x} sub={x ? fmtEta(x.eta) : 'none free'} onClick={run(() => { if (x) feedback(engine.dispatch(x.unit.id, inc.id, { code }), `${x.unit.callsign} → ${inc.label}`); })}>
            {x ? <>Send <b>{x.unit.callsign}</b></> : <>Nearest {SERVICE_META[s].short.toLowerCase()}</>}
          </Item>
        ))}
        {heli && <Item icon="heli" sub={fmtEta(engine.estimate(heli.id, inc.reportedNode!)?.eta)} onClick={run(() => feedback(engine.dispatch(heli.id, inc.id), `${heli.callsign} launching`))}>Request air support</Item>}
        <div className="mm-sep" />
        {assigned.length > 0 && <Item icon="radio" onClick={run(() => feedback(engine.briefUnits(inc.id), 'Crews briefed'))}>Brief responding crews</Item>}
        {!inc.truth.outside && <Item icon="map" onClick={run(() => openCctv(engine, inc.id))}>Check nearest CCTV</Item>}
        {(() => { const k = engine.agencyFor(inc); const a = inc.agency; if (!k || !live(inc) || a?.calledAt != null) return null; return <Item icon="phone" tone={a?.askedAt != null ? 'primary' : undefined} sub={`$${AGENCY[k].cost}`} onClick={run(() => feedback(engine.callAgency(inc.id), `${AGENCY[k].name} called`))}>Call {AGENCY[k].name.toLowerCase()}{a?.askedAt != null ? ' — crew is waiting' : ''}</Item>; })()}
        {engine.alertInfo(inc.id).ok && (sub === 'alert' ? (
          <>
            <Item icon="alert" tone="danger" onClick={run(() => feedback(engine.issueAlert(inc.id, 'evacuate'), 'Evacuation order sent'))}>Order evacuation of the district</Item>
            <Item icon="alert" onClick={run(() => feedback(engine.issueAlert(inc.id, 'shelter'), 'Shelter-in-place order sent'))}>Order shelter in place</Item>
          </>
        ) : <Item icon="alert" sub="›" onClick={() => setSub('alert')}>Public alert…</Item>)}
        {inc.category === 'police' && (() => { const b = engine.boloInfo(inc.id); return <Item icon="search" disabled={!b.ok} sub={b.ok ? 'all units' : undefined} onClick={run(() => feedback(engine.broadcastBolo(inc.id), 'BOLO broadcast to all units'))}>{b.ok ? 'Broadcast BOLO' : <span className="muted">BOLO — {b.reason?.toLowerCase()}</span>}</Item>; })()}
        <Item icon="note" onClick={run(() => { engine.select('incident', inc.id); useApp.getState().bump(); })}>Open incident card</Item>
        {inc.reportedNode !== null && <Item icon="search" onClick={run(() => { const m = engine.city.nodes[inc.reportedNode!]; focus(m.x, m.y, 3.2); })}>Zoom to scene</Item>}
      </>
    );
  } else if (hit?.kind === 'unit' && st.units[hit.id]) {
    const u = st.units[hit.id];
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : null;
    const moving = ['DISPATCHED', 'EN_ROUTE'].includes(u.status);
    const policeCar = u.service === 'police' && !isAir(u) && ['patrol', 'motorcycle', 'traffic'].includes(u.type);
    const targets = Object.values(st.incidents).filter((i) => live(i) && i.id !== u.assignedIncidentId && engine.canDispatch(u, i).ok)
      .map((i) => ({ i, eta: engine.estimate(u.id, i.reportedNode!)?.eta ?? Infinity })).sort((a, b) => b.i.severity - a.i.severity || a.eta - b.eta).slice(0, 6);
    head = (
      <>
        <div className="mm-title"><span className="mm-ico" style={{ color: SERVICE_META[u.service].color }}><Icon n={isAir(u) ? 'heli' : SERVICE_ICON[u.service]} size={13} /></span>{u.callsign}<span className="mm-tag">{u.status.replace(/_/g, ' ')}</span></div>
        <div className="mm-meta">{u.typeLabel}{inc ? ` · ${inc.label}` : engine.onPatrol(u) ? ' · on patrol' : ''}{u.eta && moving ? ` · ETA ${fmtEta(u.eta)}` : ''}</div>
      </>
    );
    body = sub === 'send' ? (
      <>
        <Item icon="chevL" onClick={() => setSub(null)}>Back</Item>
        <div className="mm-sep" />
        {targets.length === 0 && <div className="mm-empty">No open incident this unit can take.</div>}
        {targets.map(({ i, eta }) => <Item key={i.id} icon="send" sub={fmtEta(eta)} onClick={run(() => feedback(inc || u.status === 'ON_SCENE' ? engine.divert(u.id, i.id) : engine.dispatch(u.id, i.id, { code: i.severity >= 3 ? 3 : 2 }), `${u.callsign} → ${i.label}`))}>P{6 - i.severity} · {i.label}</Item>)}
      </>
    ) : (
      <>
        <Item icon="send" disabled={!targets.length} onClick={() => setSub('send')} sub={targets.length ? `${targets.length} ›` : '—'}>{inc ? 'Divert to…' : 'Send to incident…'}</Item>
        {moving && !isAir(u) && <Item icon="bolt" tone={u.code === 3 ? 'danger' : undefined} onClick={run(() => feedback(engine.setCode(u.id, u.code === 3 ? 2 : 3)))}>{u.code === 3 ? 'Downgrade to Code 2' : 'Upgrade to Code 3'}</Item>}
        {moving && u.service !== 'police' && <Item icon="shield" onClick={run(() => feedback(engine.setStaging(u.id, !u.staging)))}>{u.staging ? 'Cancel staging' : 'Stage until PD secures'}</Item>}
        {u.status === 'ON_SCENE' && (u.checkDue != null
          ? <Item icon="radio" tone={st.time >= u.checkDue ? 'primary' : undefined} sub={st.time >= u.checkDue ? 'overdue' : fmtEta(u.checkDue - st.time)} onClick={run(() => { engine.statusCheck(u.id); audio.radioBlip(); useApp.getState().bump(); })}>Status check</Item>
          : <Item icon="radio" onClick={run(() => { engine.radioQuery(u.id); audio.radioBlip(); useApp.getState().bump(); })}>Request sitrep</Item>)}
        {u.status === 'TRANSPORTING' && <Item icon="phone" onClick={run(() => feedback(engine.prealert(u.id)))}>Pre-alert hospital</Item>}
        {policeCar && engine.onPatrol(u) && <Item icon="shield" onClick={run(() => feedback(engine.orderStop(u.id)))}>Make a traffic stop</Item>}
        {policeCar && ['AVAILABLE', 'RETURNING'].includes(u.status) && <Item icon={u.patrol === false ? 'car' : 'hosp'} onClick={run(() => { engine.setPatrol(u.id, u.patrol === false); audio.click(); useApp.getState().bump(); })}>{u.patrol === false ? 'Resume patrol' : 'Hold at station'}</Item>}
        {['AVAILABLE', 'RETURNING'].includes(u.status) && !isAir(u) && <Item icon="pin" onClick={run(() => startReposition(u.id))}>Move to cover…</Item>}
        {(inc || u.status === 'ON_SCENE') && <Item icon="x" onClick={run(() => feedback(engine.recall(u.id), `${u.callsign} returning to service`))}>Recall to station</Item>}
        <div className="mm-sep" />
        <Item icon="info" onClick={run(() => { engine.select('unit', u.id); useApp.getState().bump(); })}>Open unit card</Item>
        <Item icon="search" onClick={run(() => focus(u.x, u.y, 3.2))}>Follow on map</Item>
      </>
    );
  } else if (hit?.kind === 'station' && st.stations[hit.id]) {
    const s = st.stations[hit.id];
    const units = Object.values(st.units).filter((u) => u.stationId === s.id);
    const free = units.filter((u) => u.status === 'AVAILABLE').length;
    head = (
      <>
        <div className="mm-title"><span className="mm-ico" style={{ color: SERVICE_META[s.service].color }}><Icon n={SERVICE_ICON[s.service]} size={13} /></span>{s.name}</div>
        <div className="mm-meta">{free}/{units.length} ready · drag the station onto an incident to send its next free unit</div>
      </>
    );
    body = (
      <>
        {units.map((u) => (
          <Item key={u.id} icon={isAir(u) ? 'heli' : 'car'} color={u.status === 'AVAILABLE' ? '#54B889' : u.status === 'OUT_OF_SERVICE' ? '#D65353' : '#E5AC4D'} sub={u.status.replace(/_/g, ' ').toLowerCase()} onClick={run(() => { engine.select('unit', u.id); useApp.getState().bump(); })}>
            <b className="mono">{u.callsign}</b> <span className="muted">{u.typeLabel}</span>
          </Item>
        ))}
        <div className="mm-sep" />
        <Item icon="info" onClick={run(() => { engine.select('station', s.id); useApp.getState().bump(); })}>Open station card</Item>
      </>
    );
  } else if (hit?.kind === 'hospital') {
    const node = Number(hit.id);
    const h = st.hospitals?.[node];
    const k = h?.known;
    const closed = st.closedHospitals.includes(node);
    const age = k ? Math.round((st.time - k.at) / 60) : null;
    const inbound = Object.values(st.units).filter((u) => u.status === 'TRANSPORTING' && u.destNode === node);
    const load = k && h ? k.er / Math.max(1, h.erCap) : 0;
    head = (
      <>
        <div className="mm-title"><span className="mm-ico" style={{ color: '#D65353' }}><Icon n="hosp" size={13} /></span>{h?.name ?? 'Hospital'}{(closed || k?.diversion) && <span className="mm-tag red">DIVERTING</span>}</div>
        <div className="mm-meta">{k ? `Bed board ${age === 0 ? 'just updated' : `${age} min old`}` : 'No bed board yet — refresh it'}</div>
      </>
    );
    body = (
      <>
        {h && k && (
          <div className="mm-hosp">
            <div className="mm-er"><span>ER</span><div className="mm-bar"><i style={{ width: `${Math.min(100, load * 100)}%`, background: load > 0.9 ? '#D65353' : load > 0.7 ? '#E5AC4D' : '#54B889' }} /></div><b className="mono">{k.er}/{h.erCap}</b></div>
            <div className="mm-depts">{h.has.length ? h.has.map((d) => <i key={d} className={`dept ${k.down.includes(d) ? 'down' : 'up'}`}>{d}</i>) : <i className="dept none">minor injuries only</i>}</div>
          </div>
        )}
        {inbound.length > 0 && <div className="mm-meta">Inbound: {inbound.map((u) => u.callsign).join(', ')}</div>}
        <Item icon="radio" onClick={run(() => { engine.refreshHospitalBoard(); audio.radioBlip(); useApp.getState().bump(); })}>Refresh bed board</Item>
        <Item icon="hosp" onClick={run(() => openTab('hospitals'))}>Open hospitals tab</Item>
        <Item icon="search" onClick={run(() => { const m = engine.city.nodes[node]; focus(m.x, m.y, 3.2); })}>Zoom here</Item>
      </>
    );
  } else {
    const selInc = st.selected.kind === 'incident' && st.selected.id ? st.incidents[st.selected.id] : null;
    const cover = (service: Service) => {
      let best: { u: Unit; eta: number } | null = null;
      for (const u of Object.values(st.units)) {
        if (u.service !== service || isAir(u) || u.status !== 'AVAILABLE' || u.temp) continue;
        const eta = engine.estimate(u.id, menu.node)?.eta ?? Infinity;
        if (isFinite(eta) && (!best || eta < best.eta)) best = { u, eta };
      }
      return best;
    };
    const covers = (['police', 'fire', 'medical'] as const).map((s) => ({ s, b: cover(s) }));
    const pursuit = engine.activePursuit();
    const sector = sectorAt(engine, menu.node);
    head = (
      <>
        <div className="mm-title"><span className="mm-ico"><Icon n="pin" size={13} /></span>{addressOf(engine.city, menu.node)}</div>
        <div className="mm-meta">{engine.city.districtById[n.district]?.name ?? ''}</div>
      </>
    );
    body = (
      <>
        {sector && (() => { const sec = sector.inc.search!.sectors[sector.idx]; return <Item icon="search" tone="primary" sub={`${sec.p}%`} onClick={run(() => feedback(engine.assignSearch(sector.inc.id, sector.idx), `Crew sent to sector ${sec.id}`))}>Search sector {sec.id} here</Item>; })()}
        {selInc && !['RESOLVED', 'CLOSED'].includes(selInc.status) && <Item icon="pin" tone="primary" onClick={run(() => { engine.setIncidentLocation(selInc.id, menu.node, 'map'); feedback(true); })}>Set “{selInc.label}” here</Item>}
        {pursuit && (() => {
          const cand = engine.stingerUnits(menu.node)[0];
          const m = pursuit.mover!, d = Math.round(Math.hypot(m.x - n.x, m.y - n.y) * 4);
          return <Item icon="bolt" tone="primary" disabled={!cand} sub={cand ? fmtEta(cand.eta) : 'none free'} onClick={run(() => { if (cand) feedback(engine.deployStinger(cand.unit.id, menu.node), `${cand.unit.callsign} laying spikes`); })}>
            {cand ? <>Lay spike strip here · <b>{cand.unit.callsign}</b> <span className="muted">suspect {d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`} away</span></> : 'No police car free for spikes'}
          </Item>;
        })()}
        {covers.map(({ s, b }) => (
          <Item key={s} icon={SERVICE_ICON[s]} color={SERVICE_META[s].color} disabled={!b} sub={b ? fmtEta(b.eta) : 'none free'} onClick={run(() => { if (b) feedback(engine.reposition(b.u.id, menu.node), `${b.u.callsign} moving to cover`); })}>
            {b ? <>Move <b>{b.u.callsign}</b> here to cover</> : <>No free {SERVICE_META[s].short.toLowerCase()} unit</>}
          </Item>
        ))}
        <div className="mm-sep" />
        <Item icon="search" onClick={run(() => focus(n.x, n.y, 3.2))}>Zoom in here</Item>
      </>
    );
  }

  return (
    <div className="mapmenu" ref={ref} role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <div className="mm-head">{head}</div>
      <div className="mm-body">{body}</div>
    </div>
  );
}
