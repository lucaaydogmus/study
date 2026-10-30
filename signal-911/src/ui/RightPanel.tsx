import { useMemo } from 'react';
import { Send, X, Undo2, CheckCircle2, AlertTriangle, Flag } from 'lucide-react';
import { useGame } from '../store/game';
import { SEVERITY_LABEL } from '../sim/incidents';
import { DECISIONS, type DecisionOption } from '../sim/decisions';
import { CAP_LABEL, VEHICLES, type Unit } from '../sim/units';
import { coverers, currentRisk, decisionOptions, modActive, optionBlocked, matchSlots, planRoute, shownCaps, shownSeverity, slotStates, trafficAt, type Incident, type World } from '../sim/world';
import { totalUpkeep } from '../sim/fleet';
import { EQUIPMENT } from '../sim/equipment';
import { Bar, CapChip, NoteList, SevChip, StatusChip, money } from './common';
import { SERVICE_COLOR } from './MapCanvas';
import type { Difficulty } from '../sim/types';

export function RightPanel() {
  const phase = useGame((s) => s.phase);
  const incidentId = useGame((s) => s.sel.incidentId);
  const unitId = useGame((s) => s.sel.unitId);
  const stationId = useGame((s) => s.sel.stationId);
  const districtId = useGame((s) => s.sel.districtId);
  useGame((s) => s.rev);
  const w = useGame.getState().world;
  const inc = incidentId !== null ? w.incidents.find((i) => i.id === incidentId) : null;
  return (
    <aside className="panel right">
      {phase === 'preshift' && <Briefing />}
      {inc ? <IncidentView w={w} inc={inc} />
        : unitId ? <UnitView w={w} id={unitId} />
        : stationId ? <StationView w={w} id={stationId} />
        : districtId ? <DistrictView w={w} id={districtId} />
        : phase === 'shift' && <Hint />}
    </aside>
  );
}

function Hint() {
  return (
    <>
      <h2>Dispatch</h2>
      <p className="muted">Select an incident from the queue or the map to see what it needs and who can get there.</p>
      <ul className="keys muted small">
        <li><kbd>A</kbd> answer next call · <kbd>E</kbd> end call</li><li><kbd>Enter</kbd> confirm dispatch</li><li><kbd>Esc</kbd> clear selection</li>
        <li><kbd>Space</kbd> pause · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> speed</li>
      </ul>
    </>
  );
}

function Briefing() {
  const cfg = useGame((s) => s.config);
  const g = useGame.getState();
  const lengths = [5, 8, 10, 12];
  const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
  return (
    <section className="brief">
      <h2>Shift briefing</h2>
      <label>Shift length</label>
      <div className="seg">{lengths.map((m) => <button key={m} className={cfg.shiftMinutes === m ? 'on' : ''} onClick={() => g.setConfig({ shiftMinutes: m })}>{m} min</button>)}</div>
      <label>Difficulty</label>
      <div className="seg">{diffs.map((d) => <button key={d} className={cfg.difficulty === d ? 'on' : ''} onClick={() => g.setConfig({ difficulty: d })} title={{ easy: 'Fewer calls, more time before incidents fail', normal: 'Balanced', hard: 'More calls, less time before incidents fail' }[d]}>{d}</button>)}</div>
      <label>Weather</label>
      <div className="seg">{(['clear', 'rain'] as const).map((x) => <button key={x} className={cfg.weather === x ? 'on' : ''} onClick={() => g.setConfig({ weather: x })} title={x === 'rain' ? 'All vehicles travel 15% slower' : 'Normal road conditions'}>{x}</button>)}</div>
      <label>Seed <span className="muted mono">{cfg.seed}</span> <button className="link" onClick={g.rerollSeed}>reroll</button></label>
      <p className="muted small">Click districts, stations and units on the map to review coverage. Toggle the coverage overlay (radar icon) to see 25-second reach.</p>
      <div className="row"><span className="muted small">{useGame.getState().save.fleet.length} units · upkeep {money(totalUpkeep(useGame.getState().save.fleet))}/shift</span></div>
      <button className="big" onClick={() => g.openDepot(true)} title="Move units, equip vehicles, buy vehicles, review coverage">Open depot</button>
      <button className="primary big" onClick={g.startShift}>Start shift</button>
    </section>
  );
}

/* ------------------------------------------------------------ incidents */

/** Would this unit cover a requirement that nobody assigned to the incident covers yet? */
function fillsOpenSlot(w: World, inc: Incident, u: Unit) {
  const mine = coverers(w, inc);
  const count = (us: Unit[]) => matchSlots(shownCaps(inc), us).filter(Boolean).length;
  return count([...mine, u]) > count(mine);
}

function IncidentView({ w, inc }: { w: World; inc: Incident }) {
  const g = useGame.getState();
  const pending = useGame((s) => s.sel.pending);
  const phase = g.phase;
  const closed = inc.status === 'RESOLVED' || inc.status === 'FAILED';
  const slots = slotStates(w, inc);
  const assigned = w.units.filter((u) => u.incidentId === inc.id);
  const district = w.city.districts.find((d) => d.id === (inc.believedNode === null ? inc.district : w.city.nodes[inc.believedNode].district))!;

  const rev = useGame((s) => s.rev);
  const cands = useMemo(() => {
    if (closed) return [];
    return w.units
      .filter((u) => u.status === 'AVAILABLE' || u.status === 'RETURNING')
      .map((u) => ({ u, eta: (inc.believedNode === null ? Infinity : planRoute(w, u, inc.believedNode)?.eta ?? Infinity), fills: fillsOpenSlot(w, inc, u) }))
      // units that fill an open requirement first, then fastest
      .sort((a, b) => Number(b.fills) - Number(a.fills) || a.eta - b.eta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, inc.id, closed]);

  const caps = shownCaps(inc);
  const open = caps.filter((_, i) => slots[i] === 'open');
  const assignedAll = coverers(w, inc);
  const pendU = pending.map((id) => w.units.find((u) => u.id === id)!).filter(Boolean);
  const stillOpenAfter = caps.filter((_, i) => !matchSlots(caps, [...assignedAll, ...pendU])[i]);
  const cost = pendU.reduce((a, u) => a + VEHICLES[u.vehicle].cost, 0);

  return (
    <>
      <h2>Incident #{inc.id}</h2>
      <div className="title">{inc.title}</div>
      <div className="row"><SevChip sev={shownSeverity(inc)} /><StatusChip s={inc.status} />
        <span className={`chip ${inc.truthKnown ? 'cap met' : ''}`} title={inc.truthKnown ? 'Confirmed by responders on scene' : 'Based on what callers have said so far. Responders will confirm on scene.'}>{inc.truthKnown ? 'Verified' : 'Reported'}</span></div>
      {inc.believedNode === null
        ? <div className="locwarn"><AlertTriangle size={13} /> Location unknown. Ask the caller for the address.</div>
        : <div className="muted small">{inc.truthKnown ? `${inc.label} · ` : ''}{inc.address}, {district.name} · {inc.addrConfirmed ? 'address confirmed' : 'address unverified'} · traffic ×{trafficAt(w, district.id).toFixed(2)}</div>}

      {inc.decision && !closed && <DecisionCard w={w} inc={inc} />}
      {inc.linkedTo !== null && <div className="small">Linked to <button className="link" onClick={() => g.selectIncident(inc.linkedTo)}>#{inc.linkedTo}</button></div>}
      {w.incidents.filter((i) => i.linkedTo === inc.id).map((i) => <div key={i.id} className="small">Spawned <button className="link" onClick={() => g.selectIncident(i.id)}>#{i.id} {i.title}</button></div>)}
      <h3>Requires {!inc.truthKnown && <span className="muted small">(as reported)</span>}</h3>
      <div className="wrapchips">{caps.map((c, i) => <CapChip key={i} cap={c} state={slots[i]} />)}</div>
      {!inc.truthKnown && !closed && <p className="muted small">Not yet verified on scene. More units may be needed than the caller described.</p>}
      {open.length > 0 && !closed && <p className="small warnc">Unassigned: {open.map((c) => CAP_LABEL[c]).join(', ')}</p>}

      {!closed && (
        <>
          <h3>Danger</h3>
          <Bar value={inc.pressure / inc.failAfter} kind="danger" title="Fills while the needed capabilities are not on scene" />
          <div className="muted small">Unattended {Math.round(inc.pressure)}s of {Math.round(inc.failAfter)}s. It grows fully with nobody on scene and slowly with a partial team. {inc.status === 'STABILIZING' && 'Crew is working the scene.'}</div>
          {inc.workProgress > 0 && <><h3>Scene progress</h3><Bar value={inc.workProgress} kind="good" /></>}
        </>
      )}
      {inc.truthKnown && !closed && <SceneStatus w={w} inc={inc} />}
      {closed && <p className={inc.status === 'RESOLVED' ? 'goodc' : 'badc'}>{inc.status === 'RESOLVED' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {inc.outcome}</p>}

      <h3>Incident notes</h3>
      <NoteList notes={inc.notes} />
      {inc.transcript.length > 0 && (
        <details className="transcriptbox"><summary>Call transcript</summary>
          {inc.transcript.map((t, i) => <div key={i} className={`line ${t.who}`}><span className="who">{t.who === 'caller' ? 'Caller' : t.who === 'dispatcher' ? 'You' : '·'}</span>{t.text}</div>)}
        </details>
      )}

      {assigned.length > 0 && (
        <>
          <h3>Assigned units</h3>
          {assigned.map((u) => (
            <div key={u.id} className="urow">
              <button className="link" onClick={() => g.selectUnit(u.id)} style={{ color: SERVICE_COLOR[u.service] }}>{u.callsign}</button>
              <StatusChip s={u.status} />
              <span className="muted mono">{u.eta ? `${Math.round(u.eta)}s` : ''}</span>
              <button className="icon" title="Recall unit to station" onClick={() => g.recallUnit(u.id)}><Undo2 size={13} /></button>
            </div>
          ))}
        </>
      )}

      {!closed && phase === 'shift' && inc.believedNode !== null && (
        <>
          <h3>Available responders <span className="muted small">(click to select)</span></h3>
          {cands.length === 0 && <p className="muted small">No free units. Recall or wait for a unit to clear a scene.</p>}
          {cands.map(({ u, eta, fills }) => {
            const on = pending.includes(u.id);
            return (
              <button key={u.id} className={`cand ${on ? 'on' : ''}`} onClick={(e) => { e.currentTarget.blur(); g.togglePending(u.id); }}
                title={fills ? 'Fills an open requirement' : 'Would not fill any open requirement'}>
                <span className="dot" style={{ background: SERVICE_COLOR[u.service] }} />
                <b>{u.callsign}</b>
                <span className="muted small">{VEHICLES[u.vehicle].name}{u.status === 'RETURNING' ? ' (returning)' : ''}</span>
                <span className="wrapchips">{u.caps.map((c) => <CapChip key={c} cap={c} />)}</span>
                <span className="mono eta">{isFinite(eta) ? `${Math.round(eta)}s` : '—'}</span>
                {!fills && <span className="chip warnchip">not needed</span>}
              </button>
            );
          })}
          <div className="confirm">
            {pendU.length === 0 ? <span className="muted small">Select units to dispatch.</span> : (
              <>
                <div className="small">{pendU.map((u) => u.callsign).join(', ')} · cost {money(cost)}{stillOpenAfter.length > 0 && <span className="warnc"> · still missing {stillOpenAfter.map((c) => CAP_LABEL[c]).join(', ')}</span>}</div>
                <div className="row">
                  <button className="primary" onClick={g.confirmDispatch} title="Confirm dispatch (Enter)"><Send size={13} /> Dispatch {pendU.length}</button>
                  <button onClick={() => useGame.setState({ sel: { ...useGame.getState().sel, pending: [] } })}><X size={13} /> Clear</button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------- unit/station */

function UnitView({ w, id }: { w: World; id: string }) {
  const g = useGame.getState();
  const u = w.units.find((x) => x.id === id);
  if (!u) return null;
  const v = VEHICLES[u.vehicle];
  const st = w.city.stations.find((s) => s.id === u.stationId)!;
  return (
    <>
      <h2>Unit</h2>
      <div className="title" style={{ color: SERVICE_COLOR[u.service] }}>{u.callsign}</div>
      <div className="row"><StatusChip s={u.status} /><span className="muted">{v.name}</span></div>
      <h3>Capabilities</h3>
      <div className="wrapchips">{u.caps.map((c) => <CapChip key={c} cap={c} />)}</div>
      <dl className="kv">
        <dt>Station</dt><dd>{st.name}</dd>
        <dt>Personnel</dt><dd>{u.personnel}</dd>
        <dt>Equipment</dt><dd>{[...u.equipment, ...u.upgrades.map((g2) => EQUIPMENT[g2].name)].join(', ')}</dd>
        <dt>Condition</dt><dd className={u.condition < 40 ? 'badc' : u.condition < 70 ? 'warnc' : ''}>{Math.round(u.condition)}%</dd>
        <dt>Dispatch cost</dt><dd>{money(v.cost)}</dd>
        <dt>Assigned</dt><dd>{u.incidentId ? <button className="link" onClick={() => g.selectIncident(u.incidentId)}>Incident #{u.incidentId}</button> : '—'}</dd>
        <dt>ETA</dt><dd>{u.eta ? `${Math.round(u.eta)}s` : '—'}</dd>
      </dl>
      {(u.status === 'EN ROUTE' || u.status === 'ON SCENE') && <button onClick={() => g.recallUnit(u.id)}><Undo2 size={13} /> Recall to station</button>}
    </>
  );
}

function StationView({ w, id }: { w: World; id: string }) {
  const g = useGame.getState();
  const s = w.city.stations.find((x) => x.id === id);
  if (!s) return null;
  return (
    <>
      <h2>Station</h2>
      <div className="title" style={{ color: SERVICE_COLOR[s.service] }}>{s.name}</div>
      <div className="muted">{w.city.districts.find((d) => d.id === s.district)!.name} · {w.city.nodes[s.nodeId].name}</div>
      <h3>Units based here</h3>
      {w.units.filter((u) => u.stationId === s.id).map((u) => (
        <div key={u.id} className="urow"><button className="link" onClick={() => g.selectUnit(u.id)}>{u.callsign}</button><span className="muted small">{VEHICLES[u.vehicle].name}</span><StatusChip s={u.status} /></div>
      ))}
    </>
  );
}

function DistrictView({ w, id }: { w: World; id: string }) {
  const d = w.city.districts.find((x) => x.id === id);
  if (!d) return null;
  const inD = (x: number, y: number) => x >= d.x - 8 && x <= d.x + d.w + 8 && y >= d.y - 8 && y <= d.y + d.h + 8;
  const free = w.units.filter((u) => (u.status === 'AVAILABLE' || u.status === 'RETURNING') && inD(u.x, u.y));
  const count = (s: string) => free.filter((u) => u.service === s).length;
  return (
    <>
      <h2>District</h2>
      <div className="title">{d.name}</div>
      <div className="muted">{d.blurb}</div>
      <dl className="kv">
        <dt>Traffic now</dt><dd>×{trafficAt(w, d.id).toFixed(2)}</dd>
        <dt>Free police</dt><dd className={count('police') ? '' : 'warnc'}>{count('police')}</dd>
        <dt>Free fire</dt><dd className={count('fire') ? '' : 'warnc'}>{count('fire')}</dd>
        <dt>Free medical</dt><dd className={count('medical') ? '' : 'warnc'}>{count('medical')}</dd>
        <dt>Open incidents</dt><dd>{w.incidents.filter((i) => i.district === d.id && i.status !== 'RESOLVED' && i.status !== 'FAILED').length}</dd>
      </dl>
      <p className="muted small">Severity scale: {SEVERITY_LABEL.slice(1).join(' · ')}</p>
    </>
  );
}

/* ------------------------------------------------------- decisions */

const effectChips = (o: DecisionOption) => {
  const out: string[] = [];
  if (o.speed && o.speed !== 1) out.push(o.speed > 1 ? `Work ${Math.round((o.speed - 1) * 100)}% faster` : `Work ${Math.round((1 - o.speed) * 100)}% slower`);
  if (o.risk) out.push(o.risk < 0 ? `Risk ${Math.round(o.risk * 100)}%` : `Risk +${Math.round(o.risk * 100)}%`);
  if (o.fetch) out.push(`Sends nearest ${o.fetch} unit`);
  if (o.needs) out.push(`Needs ${o.needs} on scene`);
  if (o.liftBlock) out.push('Reopens road');
  if (o.cost) out.push(money(-o.cost));
  return out;
};

function DecisionCard({ w, inc }: { w: World; inc: Incident }) {
  const g = useGame.getState();
  if (!inc.decision) return null;
  const left = Math.max(0, inc.decision.expiresAt - w.time);
  return (
    <section className="decision">
      <div className="dhead"><Flag size={14} /> <b>Decision needed</b><span className="mono muted">{Math.ceil(left)}s</span></div>
      <Bar value={left / 40} kind="urgent" title="If you do nothing the response continues with current resources" />
      <p>{DECISIONS[inc.templateId]?.prompt}</p>
      {decisionOptions(inc).map((o) => {
        const why = optionBlocked(w, inc, o);
        return (
          <button key={o.id} className={`opt ${why ? 'off' : ''}`} disabled={!!why} onClick={() => g.decide(o.id)}>
            <b>{o.label}</b>
            <span className="muted small">{o.detail}</span>
            <span className="wrapchips">{effectChips(o).map((c) => <span key={c} className="chip">{c}</span>)}{why && <span className="chip warnchip">{why}</span>}</span>
          </button>
        );
      })}
    </section>
  );
}

function SceneStatus({ w, inc }: { w: World; inc: Incident }) {
  const risk = currentRisk(w, inc);
  const level = risk >= 0.45 ? 'High' : risk >= 0.2 ? 'Moderate' : 'Low';
  return (
    <>
      <h3>Scene risk</h3>
      <div className="row"><span className={`chip ${level === 'High' ? 'sev3' : level === 'Moderate' ? 'sev2' : 'sev1'}`}>{level}</span>
        <span className="muted small">{inc.complications ? `${inc.complications} complication(s) so far. ` : ''}Chance of a complication while responders work.</span></div>
      {inc.mods.length > 0 && (
        <ul className="notelist">{inc.mods.map((m) => (
          <li key={m.id} className={`note ${modActive(w, inc, m) ? 'confirmed' : 'unconfirmed'}`}>
            <span>{m.label} {modActive(w, inc, m) ? '· active' : '· waiting for unit to arrive'}</span>
          </li>
        ))}</ul>
      )}
    </>
  );
}
