import { useMemo, useState } from 'react';
import { addressOf, fullAddress, searchAddresses } from '../sim/city';
import { CAP_LABEL, CLASSES, CLASS_BY_ID } from '../sim/content/vocab';
import { matchCoverage, recommendFor, reqText, suggestClass, gameClock, type GameEngine } from '../sim/engine';
import { SERVICE_META, UNIT_TYPE_BY_ID } from '../sim/fleet';
import type { Capability, Incident, Service, Unit } from '../sim/types';
import { audio } from '../audio/audioManager';
import { Badge, Bar, Btn, Icon, Section, fmtEta, fmtTime, SERVICE_ICON } from './common';
import { useApp } from '../store';
import { averageOf } from '../sim/scoring';
import { DispatchConsole, type Preview } from './DispatchConsole';
import { AirSupport, Consequences, DeadlineBanner, LifeMeter } from './Ops';
import { AIR_HELPS } from '../sim/engine';

export interface PanelCtx { setPreview: (p: Preview) => void; engine: GameEngine; pickLocation: (incId: string | null) => void; pickingFor: string | null; repositioning: string | null; startReposition: (unitId: string | null) => void; focus: (x: number, y: number, zoom?: number) => void; openCall: () => void; setBottom: (t: string) => void }

const STATUS_TONE: Record<string, 'neutral' | 'red' | 'amber' | 'green' | 'blue'> = {
  AVAILABLE: 'green', DISPATCHED: 'blue', EN_ROUTE: 'blue', ON_SCENE: 'amber', BUSY: 'neutral', TRANSPORTING: 'blue', RETURNING: 'neutral', OUT_OF_SERVICE: 'red',
  REPORTED: 'neutral', AWAITING_INFORMATION: 'amber', CLASSIFIED: 'amber', AWAITING_DISPATCH: 'red', UNITS_EN_ROUTE: 'blue', ESCALATING: 'red', STABILIZING: 'green', RESOLVED: 'green', CLOSED: 'neutral',
};
export const statusLabel = (s: string) => s.replace(/_/g, ' ');
export function StatusBadge({ s }: { s: string }) { return <Badge tone={STATUS_TONE[s] ?? 'neutral'}>{statusLabel(s)}</Badge>; }

export function RightPanel(ctx: PanelCtx) {
  const st = ctx.engine.state;
  const sel = st.selected;
  if (sel.kind === 'incident' && sel.id && st.incidents[sel.id]) return <IncidentPanel {...ctx} inc={st.incidents[sel.id]} />;
  if (sel.kind === 'unit' && sel.id && st.units[sel.id]) return <UnitPanel {...ctx} unit={st.units[sel.id]} />;
  if (sel.kind === 'station' && sel.id) return <StationPanel {...ctx} id={sel.id} />;
  if (sel.kind === 'district' && sel.id) return <DistrictPanel {...ctx} id={sel.id} />;
  return <CityPanel {...ctx} />;
}

function CityPanel({ engine }: PanelCtx) {
  const st = engine.state;
  const open = Object.values(st.incidents).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status) && !i.hidden);
  const units = Object.values(st.units);
  const avail = (s: Service) => units.filter((u) => u.service === s && u.status === 'AVAILABLE').length;
  const tot = (s: Service) => units.filter((u) => u.service === s).length;
  return (
    <div className="panel-scroll">
      <Section title="City status" id="city">
        <div className="kvs">
          <div><span>Open incidents</span><b>{open.length}</b></div>
          <div><span>Resolved</span><b>{st.stats.resolved}</b></div>
          <div><span>Calls answered</span><b>{st.stats.callsAnswered}/{st.stats.callsReceived}</b></div>
          <div><span>Avg response</span><b>{st.stats.responseTimes.length ? fmtEta(averageOf(st.stats.responseTimes)) : '—'}</b></div>
          <div><span>Casualties</span><b className={st.stats.casualties ? 'red' : ''}>{st.stats.casualties}</b></div>
          <div><span>Workload</span><b>{Math.round(st.dispatcherLoad * 100)}%</b></div>
        </div>
        <Bar value={st.dispatcherLoad * 100} tone={st.dispatcherLoad > 0.75 ? 'red' : st.dispatcherLoad > 0.5 ? 'amber' : 'green'} label="Dispatcher workload" />
      </Section>
      <Section title="Resources" id="res">
        {(['police', 'fire', 'medical'] as Service[]).map((s) => (
          <div className="resrow" key={s}>
            <span className="svc" style={{ color: SERVICE_META[s].color }}><Icon n={SERVICE_ICON[s]} size={13} /> {SERVICE_META[s].label}</span>
            <span className="mono">{avail(s)} / {tot(s)} available</span>
            <Bar value={tot(s) ? (avail(s) / tot(s)) * 100 : 0} tone={avail(s) === 0 ? 'red' : avail(s) <= 1 ? 'amber' : 'green'} label={`${s} availability`} />
          </div>
        ))}
        <div className="resrow"><span className="svc">Coverage (≤ 100 s)</span><span className="mono">{Math.round(st.lastCoverage * 100)}%</span><Bar value={st.lastCoverage * 100} tone="blue" label="Coverage" /></div>
      </Section>
      {st.events.filter((e) => e.announced).length > 0 && (
        <Section title="Citywide events" id="events">
          {st.events.filter((e) => e.announced).map((e) => (
            <div key={e.id} className="event"><Badge tone={e.active ? 'red' : e.end < st.time ? 'neutral' : 'amber'}>{e.active ? 'ACTIVE' : e.end < st.time ? 'ENDED' : 'ADVISORY'}</Badge> <b>{e.name}</b><div className="muted small">{e.description}</div></div>
          ))}
        </Section>
      )}
      <Section title="Hints" id="hints">
        <ul className="hints">
          <li>Click a ringing call, then <b>ANSWER</b>. Ask questions; the caller only knows what they can see.</li>
          <li>Set a location from what the caller says, then verify it with them if you’re unsure.</li>
          <li>Right-click an available unit on the map, then right-click a destination to reposition it.</li>
          <li>Keep at least one unit of each service free for the next call.</li>
        </ul>
      </Section>
    </div>
  );
}

function DistrictPanel({ engine, id }: PanelCtx & { id: string }) {
  const city = engine.city, st = engine.state;
  const d = city.districtById[id];
  const active = st.config.districts.includes(id);
  const cov = (s: Service) => { const t = engine.coverageTimes(s); const ids = city.nodesInDistrict[id]; return ids.filter((n) => t[n] <= 100).length / ids.length; };
  const inc = Object.values(st.incidents).filter((i) => i.district === id && !['RESOLVED', 'CLOSED'].includes(i.status) && !i.hidden);
  return (
    <div className="panel-scroll">
      <Section title={d.name} collapsible={false} right={active ? <Badge tone="green">ACTIVE</Badge> : <Badge tone="neutral">LOCKED · RANK {d.unlockRank}</Badge>}>
        <p className="muted">{d.blurb}</p>
        <div className="kv"><span>Traffic</span><Bar value={(st.districtTraffic[id] ?? 0) * 100} tone={(st.districtTraffic[id] ?? 0) > 0.6 ? 'red' : (st.districtTraffic[id] ?? 0) > 0.4 ? 'amber' : 'green'} /></div>
        {(['police', 'fire', 'medical'] as Service[]).map((s) => (<div className="kv" key={s}><span>{SERVICE_META[s].label} coverage</span><Bar value={cov(s) * 100} tone={cov(s) > 0.6 ? 'green' : cov(s) > 0.3 ? 'amber' : 'red'} /></div>))}
        <div className="kv"><span>Open incidents</span><b>{inc.length}</b></div>
        <div className="chips">{d.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
      </Section>
    </div>
  );
}

function StationPanel({ engine, id }: PanelCtx & { id: string }) {
  const s = engine.state.stations[id];
  if (!s) return null;
  const units = Object.values(engine.state.units).filter((u) => u.stationId === id);
  const select = useApp.getState;
  return (
    <div className="panel-scroll">
      <Section title={s.name} collapsible={false} right={<Badge tone={s.disabledShifts ? 'red' : 'green'}>{s.disabledShifts ? 'OUT OF SERVICE' : 'IN SERVICE'}</Badge>}>
        <div className="kv"><span>District</span><b>{engine.city.districtById[s.district].name}</b></div>
        <div className="kv"><span>Address</span><b>{addressOf(engine.city, s.nodeId)}</b></div>
        <div className="kv"><span>Based here</span><b>{units.length} / {s.capacity + (engine.state.upgrades.garage ?? 0)}</b></div>
        {units.map((u) => (<button key={u.id} className="rowbtn" onClick={() => { engine.select('unit', u.id); select().bump(); }}><span className="mono">{u.callsign}</span><StatusBadge s={u.status} /></button>))}
      </Section>
    </div>
  );
}

function UnitPanel({ engine, unit, startReposition, repositioning, focus, setBottom }: PanelCtx & { unit: Unit }) {
  const st = engine.state;
  const inc = unit.assignedIncidentId ? st.incidents[unit.assignedIncidentId] : null;
  const crew = engine.crewOf(unit);
  const bump = useApp((s) => s.bump);
  const eff = engine.unitEffectiveness(unit);
  const canRecall = !['TRANSPORTING', 'OUT_OF_SERVICE', 'BUSY'].includes(unit.status) && (unit.assignedIncidentId || unit.status !== 'AVAILABLE' && unit.status !== 'RETURNING');
  return (
    <div className="panel-scroll">
      <Section title={<span className="mono">{unit.callsign}</span>} collapsible={false} right={<StatusBadge s={unit.status} />}>
        <div className="kv"><span>Type</span><b>{unit.typeLabel}</b></div>
        <div className="kv"><span>Service</span><b style={{ color: SERVICE_META[unit.service].color }}>{SERVICE_META[unit.service].label}</b></div>
        <div className="kv"><span>Equipment</span><b>{unit.equipment}</b></div>
        <div className="kv"><span>Capabilities</span><span className="chips">{unit.capabilities.map((c) => <Badge key={c}>{CAP_LABEL[c]}</Badge>)}</span></div>
        <div className="kv"><span>Home station</span><b>{st.stations[unit.stationId]?.name ?? 'Mutual aid'}</b></div>
        <div className="kv"><span>Position</span><b>{addressOf(engine.city, engine.city.nearestNode(unit.x, unit.y))}</b></div>
        {unit.destNode !== null && ['EN_ROUTE', 'TRANSPORTING', 'RETURNING', 'DISPATCHED'].includes(unit.status) && <div className="kv"><span>ETA</span><b className="mono">{fmtEta(unit.eta)}</b></div>}
        <div className="kv"><span>Speed</span><b className="mono">{unit.speed ? `${Math.round(unit.speed / 2.4 * 4 * 3.6)} km/h` : '—'}</b></div>
        <div className="kv"><span>Effectiveness</span><Bar value={Math.min(100, eff * 62)} tone={eff > 1 ? 'green' : eff > 0.7 ? 'blue' : 'amber'} /></div>
        {unit.fuel !== undefined && <div className="kv"><span>Fuel</span><Bar value={unit.fuel} tone={unit.fuel < 30 ? 'red' : unit.fuel < 55 ? 'amber' : 'green'} label="Fuel" /></div>}
        {unit.note && <div className="note-line"><Icon n="info" size={12} /> {unit.note}</div>}
        {inc && <button className="rowbtn" onClick={() => { engine.select('incident', inc.id); bump(); }}><span>Assigned: <b>{inc.label}</b></span><Icon n="chevR" size={12} /></button>}
        <div className="btnrow">
          <Btn size="sm" icon="radio" onClick={() => { engine.radioQuery(unit.id); setBottom('radio'); bump(); }}>Radio check</Btn>
          <Btn size="sm" icon="x" disabled={!canRecall} onClick={() => { engine.recall(unit.id); bump(); }}>Recall</Btn>
          <Btn size="sm" icon="hosp" disabled={!['AVAILABLE', 'RETURNING'].includes(unit.status)} onClick={() => { engine.recall(unit.id); bump(); }} title="Return to home station">Return to station</Btn>
          <Btn size="sm" icon="pin" kind={repositioning === unit.id ? 'primary' : 'default'} disabled={!['AVAILABLE', 'RETURNING'].includes(unit.status)} onClick={() => startReposition(repositioning === unit.id ? null : unit.id)}>{repositioning === unit.id ? 'Click map…' : 'Reposition'}</Btn>
          <Btn size="sm" icon="map" onClick={() => focus(unit.x, unit.y, 1.8)}>Locate</Btn>
        </div>
      </Section>
      <Section title="Crew" id="crew">
        {crew.map((p) => (
          <div key={p.id} className="crewrow">
            <div className="crewname"><b>{p.name}</b><span className="muted small">{p.specialty}</span></div>
            <div className="mini"><span>Skill</span><Bar value={p.service === 'medical' ? p.medical : p.service === 'fire' ? p.fire : p.policing} tone="blue" /></div>
            <div className="mini"><span>Fatigue</span><Bar value={p.fatigue} tone={p.fatigue > 70 ? 'red' : p.fatigue > 45 ? 'amber' : 'green'} /></div>
            <div className="mini"><span>Morale</span><Bar value={p.morale} tone="green" /></div>
          </div>
        ))}
        {!crew.length && <p className="muted">No crew assigned.</p>}
      </Section>
    </div>
  );
}

function IncidentPanel({ engine, inc, pickLocation, pickingFor, focus, openCall, setPreview }: PanelCtx & { inc: Incident }) {
  const st = engine.state, city = engine.city;
  const bump = useApp((s) => s.bump);
  const [q, setQ] = useState('');
  const call = Object.values(st.calls).filter((c) => c.incidentId === inc.id).sort((a, b) => b.ringStart - a.ringStart)[0];
  const liveCall = call && (call.state === 'active') ? call : null;
  const heard = useMemo(() => (call ? call.heard : []), [call, st.time > 0 ? call?.heard.length : 0]);
  const results = q.length >= 2 ? searchAddresses(city, q, 6) : [];
  const rec = recommendFor(inc, st.rank);
  const suggested = suggestClass(inc);
  const cls = inc.classification ?? suggested;
  const done = ['RESOLVED', 'CLOSED'].includes(inc.status);
  const assigned = inc.assignedUnits.map((id) => st.units[id]).filter(Boolean);
  const here = engine.onScene(inc);
  const cov = matchCoverage(rec, assigned);
  const coveredCaps = new Set<Capability>();
  for (const r of rec) { const have = assigned.filter((u) => u.capabilities.includes(r.cap)).length; if (have >= r.n) coveredCaps.add(r.cap); }
  const missing = inc.sceneSeen ? matchCoverage(inc.requires, assigned.concat(here)).missing : [];
  const dupCands = done ? [] : engine.duplicateCandidates(inc.id);

  return (
    <div className="panel-scroll">
      <Section title={<span><span className="mono dim">INC-{String(inc.num).padStart(4, '0')}</span> {inc.label}</span>} collapsible={false} right={<StatusBadge s={inc.status} />}>
        <div className="kv"><span>Priority</span><span className="pips" aria-label={`Priority ${inc.severity} of 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= inc.severity ? 'on' : ''} />)}<b className="mono">P{6 - inc.severity}</b></span></div>
        <div className="kv"><span>Reported</span><b className="mono">{fmtTime(st.time - inc.createdAt)} ago</b></div>
        {inc.stage > 0 && <div className="kv"><span>Escalation</span><Badge tone="red">STAGE {inc.stage}</Badge></div>}
        {inc.relatedIds.length > 0 && <div className="kv"><span>Related</span><b>{inc.relatedIds.map((r) => st.incidents[r] && `INC-${String(st.incidents[r].num).padStart(4, '0')}`).join(', ')}</b></div>}
        {call && <div className="kv"><span>Caller</span><span><b>{call.profile.name}</b> · {call.callerId}</span></div>}
        {call && (call.state === 'active' || call.state === 'hold') && <Btn size="sm" icon="phone" onClick={openCall}>Go to call</Btn>}
        {inc.truth.outside && <div className="note-line warn"><Icon n="alert" size={12} /> Caller is outside Ravenport. Use <b>TRANSFER</b> to hand them to the neighbouring agency.</div>}
        {inc.parentId && st.incidents[inc.parentId] && <div className="note-line"><Icon n="layers" size={12} /> Broke out of INC-{String(st.incidents[inc.parentId].num).padStart(4, '0')} {st.incidents[inc.parentId].label} — crews there can be sent straight here.</div>}
        <DeadlineBanner engine={engine} inc={inc} />
        {!done && <LifeMeter inc={inc} />}
      </Section>

      {inc.pursuit && inc.mover && !done && (
        <Section title="Pursuit" id="pursuit" right={<Badge tone={inc.mover.contact ? 'green' : inc.mover.heliId ? 'green' : inc.mover.tracked ? 'blue' : 'amber'}>{inc.mover.contact ? `IN CONTACT ×${inc.mover.contact}` : inc.mover.heliId ? 'AIR HAS EYES' : inc.mover.tracked ? 'TRACKING' : 'LOST VISUAL'}</Badge>}>
          <p className="small muted">{inc.mover.contact ? 'Units are on the suspect’s tail. A second unit boxes it in much faster.' : inc.mover.heliId ? 'The helicopter is following the vehicle. Ground units only know what you relay to them.' : inc.mover.tracked ? 'The location updates live while the caller follows the car or crews have it in sight.' : 'Nobody has eyes on the vehicle. Sightings will update its last known position — put the helicopter up or keep units moving toward it.'}</p>
          <AirSupport engine={engine} inc={inc} />
          <div className="kv"><span>Box-in</span><Bar value={inc.workProgress} max={inc.work} tone="green" label="Box-in progress" /></div>
          <div className="kv"><span>Public risk</span><Bar value={inc.threat} tone={inc.threat > 70 ? 'red' : inc.threat > 40 ? 'amber' : 'blue'} label="Public risk" /></div>
          {inc.reportedNode === null && <div className="note-line warn"><Icon n="pin" size={12} /> Set an initial location from the caller to start tracking.</div>}
        </Section>
      )}

      {!done && !inc.pursuit && AIR_HELPS.has(inc.templateId) && <Section title="Air support" id="airsup"><AirSupport engine={engine} inc={inc} /></Section>}

      {!done && !inc.truth.outside && dupCands.length > 0 && (
        <Section title="Same incident?" id="dups" right={<Badge tone="blue">{dupCands.length} NEARBY</Badge>}>
          <p className="small muted">Big incidents draw many callers. If this call is about an incident you already have, link it — the units already assigned cover it. Linking unrelated emergencies loses the call.</p>
          {dupCands.map(({ inc: o, dist }) => (
            <div key={o.id} className="dupc">
              <div className="grow"><b>INC-{String(o.num).padStart(4, '0')} {o.label}</b><div className="small muted">{Math.round(dist)} m away · {statusLabel(o.status)} · {o.assignedUnits.length} unit{o.assignedUnits.length === 1 ? '' : 's'}</div></div>
              <Btn size="sm" kind="primary" icon="layers" onClick={() => { const r = engine.linkIncident(inc.id, o.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); bump(); }}>Link</Btn>
            </div>
          ))}
        </Section>
      )}

      {!inc.truth.outside && (
        <Section title="Location" id="loc" right={inc.reportedNode !== null ? <Badge tone={inc.locationConfirmed ? 'green' : 'amber'}>{inc.locationConfirmed ? 'VERIFIED' : 'UNVERIFIED'}</Badge> : <Badge tone="red">NOT SET</Badge>}>
          <div className="bigline">{inc.reportedNode !== null ? <><Icon n="pin" size={14} /> {fullAddress(city, inc.reportedNode)}</> : <span className="muted">Ask for the address, then choose below.</span>}</div>
          {inc.reportedNode !== null && <div className="btnrow"><Btn size="sm" icon="map" onClick={() => { const n = city.nodes[inc.reportedNode!]; focus(n.x, n.y, 2.2); }}>Show on map</Btn>{liveCall && !done && <Btn size="sm" icon="check" onClick={() => { engine.verifyLocation(liveCall.id, inc.reportedNode!); bump(); }}>Read back to caller</Btn>}</div>}
          {!done && (
            <>
              {heard.length > 0 && <div className="sub">HEARD ON THIS CALL</div>}
              {heard.map((h) => (
                <div key={h.id} className={`cand ${h.reliability}`}>
                  <div className="grow"><div className="clabel">{h.label}</div><div className="small muted">{h.source === 'ali' ? 'Automatic lookup' : h.source === 'cross' ? 'Cross street' : h.source === 'landmark' ? 'Landmark' : h.source === 'district' ? 'Area only' : 'Stated address'} · {h.reliability === 'sure' ? 'caller sure' : h.reliability === 'unsure' ? 'caller unsure' : 'contradicted'}</div></div>
                  <Btn size="sm" onClick={() => { engine.setIncidentLocation(inc.id, h.nodeId, 'candidate'); bump(); }}>Use</Btn>
                  {liveCall && <Btn size="sm" kind="ghost" onClick={() => { engine.verifyLocation(liveCall.id, h.nodeId); bump(); }} title="Read this back to the caller">Verify</Btn>}
                </div>
              ))}
              <div className="searchrow">
                <input aria-label="Search address" placeholder="Search address or landmark…" value={q} onChange={(e) => setQ(e.target.value)} />
                <Btn size="sm" icon="pin" kind={pickingFor === inc.id ? 'primary' : 'default'} onClick={() => pickLocation(pickingFor === inc.id ? null : inc.id)}>{pickingFor === inc.id ? 'Click map…' : 'Pick on map'}</Btn>
              </div>
              {results.map((n) => (<button className="rowbtn" key={n} onClick={() => { engine.setIncidentLocation(inc.id, n, 'search'); setQ(''); bump(); }}><span>{fullAddress(city, n)}</span><span className="muted small">at {city.nodes[n].crossStreet}</span></button>))}
              {liveCall && (st.upgrades.ali ?? 0) > 0 && !liveCall.aliUsed && <Btn size="sm" icon="radio" onClick={() => { const m = engine.requestLocation(liveCall.id); useApp.getState().showToast(m, 'info'); bump(); }}>Request caller location (ALI)</Btn>}
              {liveCall && (st.upgrades.ali ?? 0) === 0 && <p className="muted small">Caller location lookup is not installed — buy Enhanced Caller Location.</p>}
            </>
          )}
        </Section>
      )}

      <Section title="Classification" id="cls" right={<Badge tone={inc.classification ? 'blue' : 'neutral'}>{inc.classification ? 'SET' : 'AUTO'}</Badge>}>
        <select aria-label="Classification" value={inc.classification ?? ''} onChange={(e) => { engine.setClassification(inc.id, e.target.value || null); bump(); }}>
          <option value="">Auto: {CLASS_BY_ID[suggested]?.label ?? 'Unclassified'}</option>
          {CLASSES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <div className="sub">SUGGESTED RESPONSE <span className="muted">(from what you know)</span></div>
        <div className="chips">
          {rec.length ? rec.map((r) => (<Badge key={r.cap} tone={coveredCaps.has(r.cap) ? 'green' : 'amber'}>{coveredCaps.has(r.cap) ? '✓ ' : ''}{r.n > 1 ? `${r.n}× ` : ''}{CAP_LABEL[r.cap]}</Badge>)) : <span className="muted small">No response suggested.</span>}
        </div>
        {inc.sceneReported && <div className="note-line"><Icon n="check" size={12} /> Confirmed by crews on scene: {reqText(inc.knownReqs)}</div>}
        {missing.length > 0 && !done && (
          <div className="note-line warn"><Icon n="alert" size={12} /> Crews need: {reqText(missing)}
            <div className="btnrow">{missing.map((m) => <Btn key={m.cap} size="sm" onClick={() => { const r = engine.requestMutualAid(inc.id, m.cap); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); bump(); }}>Mutual aid: {CAP_LABEL[m.cap]} (−$4,000)</Btn>)}</div>
          </div>
        )}
        {cls === 'no_response' && !done && <Btn size="sm" kind="success" icon="check" onClick={() => { engine.dismissIncident(inc.id); bump(); }}>Close — no emergency</Btn>}
      </Section>

      {!done && !inc.truth.outside && <DispatchConsole engine={engine} inc={inc} rec={rec} setPreview={setPreview} />}

      <Section title={`Assigned units (${assigned.length})`} id="assigned" right={inc.outcome ? <Badge tone={inc.outcome === 'success' || inc.outcome === 'false_alarm' ? 'green' : 'red'}>{inc.outcome.replace('_', ' ').toUpperCase()}</Badge> : null}>
        {!assigned.length && <p className="muted small">No units assigned.</p>}
        {assigned.map((u) => (
          <div className="unitrow" key={u.id}>
            <button className="linkish mono" onClick={() => { engine.select('unit', u.id); bump(); }}>{u.callsign}</button>
            <StatusBadge s={u.status} />
            <span className="mono grow right">{u.status === 'ON_SCENE' ? (u.note ?? 'on scene') : fmtEta(u.eta)}</span>
            {u.status !== 'TRANSPORTING' && <button className="icon-btn" aria-label={`Recall ${u.callsign}`} title="Recall" onClick={() => { engine.recall(u.id); bump(); }}><Icon n="x" size={13} /></button>}
          </div>
        ))}
        {inc.status === 'ON_SCENE' && here.length > 0 && !done && <div className="small muted">Work in progress on scene…</div>}
      </Section>

      <Section title={`Information (${inc.facts.length})`} id="facts">
        {!inc.facts.length && <p className="muted small">Nothing established yet. Ask questions on the call.</p>}
        <ul className="facts">
          {inc.facts.map((f, i) => (
            <li key={i} className={f.confidence}>
              <span className="fmark" aria-label={f.confidence}>{f.confidence === 'confirmed' ? '✓' : f.confidence === 'unconfirmed' ? '?' : '✕'}</span>
              <span className="flabel">{f.label}</span>
              <b>{typeof f.value === 'boolean' ? (f.value ? 'Yes' : 'No') : String(f.value)}</b>
              <span className="muted small">{f.source === 'scene' ? 'crew' : f.source === 'ali' ? 'ALI' : f.confidence === 'unconfirmed' ? 'unsure' : f.confidence === 'contradicted' ? 'changed' : ''}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Consequences inc={inc} />

      <Section title="Dispatcher notes" id="notes">
        <textarea aria-label="Incident notes" rows={3} value={inc.notes} placeholder="Add incident notes…" onChange={(e) => { engine.setNotes(inc.id, e.target.value); bump(); }} />
      </Section>
      {!done && !inc.truth.outside && (
        <div className="panel-foot"><Btn size="sm" kind="ghost" icon="x" onClick={() => { engine.dismissIncident(inc.id); bump(); audio.click(); }} title="Dismiss as no emergency. If the situation is real, it will get worse.">Dismiss as no emergency</Btn></div>
      )}
      {done && <div className="note-line"><Icon n="clock" size={12} /> Resolved at {gameClock(st, inc.resolvedAt ?? st.time)}</div>}
    </div>
  );
}
