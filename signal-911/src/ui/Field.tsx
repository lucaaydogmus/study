// Field operations UI: unit radio commands, tactical decision cards, CCTV viewer, call trace status,
// the breaking-news banner and the news ticker.
import { useEffect, useRef, useState } from 'react';
import { addressOf, getCity } from '../sim/city';
import { AGENCY, gameClock, type GameEngine } from '../sim/engine';
import { isAir } from '../sim/fleet';
import type { Call, Incident, Unit } from '../sim/types';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { Badge, Btn, Icon, fmtEta, fmtTime } from './common';
import { drawBuildings3D, drawCity, drawModels } from './scenery';

const toast = (r: { ok: boolean; reason?: string } | boolean, okText?: string) => {
  const ok = typeof r === 'boolean' ? r : r.ok;
  if (!ok) { audio.error(); useApp.getState().showToast((typeof r === 'object' && r.reason) || 'Not possible right now', 'warn'); }
  else { audio.radioBlip(); if (okText) useApp.getState().showToast(okText, 'info'); }
};

/** radio commands for one unit (shown in the unit panel) */
export function UnitCommands({ engine, unit }: { engine: GameEngine; unit: Unit }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const inc = unit.assignedIncidentId ? st.incidents[unit.assignedIncidentId] : null;
  const [divertTo, setDivertTo] = useState('');
  const moving = ['DISPATCHED', 'EN_ROUTE'].includes(unit.status);
  const open = Object.values(st.incidents).filter((i) => !i.hidden && !['RESOLVED', 'CLOSED'].includes(i.status) && i.reportedNode !== null && i.id !== unit.assignedIncidentId).sort((a, b) => b.severity - a.severity);
  const need = inc ? engine.patientNeed(inc) : 'general';
  const hospitals = engine.city.hospitals.map((h) => { const hs = st.hospitals?.[h]; const k = hs?.known; return { h, name: hs?.name ?? 'Hospital', has: hs?.has ?? [], down: k?.down ?? [], er: k?.er, cap: hs?.erCap ?? 0, divert: !!k?.diversion, closed: st.closedHospitals.includes(h), eta: engine.estimate(unit.id, h)?.eta, pre: !!(inc && hs?.prealerts.includes(inc.id)) }; });
  const policeCar = unit.service === 'police' && !isAir(unit) && ['patrol', 'motorcycle', 'traffic'].includes(unit.type);
  return (
    <div className="ucmd">
      <div className="sub">RADIO COMMANDS</div>
      <div className="btnrow">
        {moving && !isAir(unit) && <Btn size="sm" kind={unit.code === 3 ? 'danger' : 'default'} icon="bolt" onClick={() => { toast(engine.setCode(unit.id, unit.code === 3 ? 2 : 3)); bump(); }} title="Lights and sirens are faster but riskier">{unit.code === 3 ? 'Downgrade to Code 2' : 'Upgrade to Code 3'}</Btn>}
        {moving && unit.service !== 'police' && <Btn size="sm" kind={unit.staging ? 'primary' : 'default'} icon="shield" onClick={() => { toast(engine.setStaging(unit.id, !unit.staging)); bump(); }} title="Hold short of the scene until police make it safe">{unit.staging ? 'Cancel staging' : 'Stage until PD secures'}</Btn>}
        {unit.status === 'ON_SCENE' && (unit.checkDue != null
          ? <Btn size="sm" icon="radio" kind={st.time >= unit.checkDue ? 'warn' : 'default'} onClick={() => { engine.statusCheck(unit.id); audio.radioBlip(); bump(); }} title="Officers on scene should be checked on regularly">{st.time >= unit.checkDue ? 'Status check — overdue' : `Status check · due in ${fmtTime(unit.checkDue - st.time)}`}</Btn>
          : <Btn size="sm" icon="radio" onClick={() => { engine.radioQuery(unit.id); audio.radioBlip(); bump(); }}>Request sitrep</Btn>)}
        {policeCar && engine.onPatrol(unit) && <Btn size="sm" icon="shield" onClick={() => { toast(engine.orderStop(unit.id)); bump(); }} title="Pull the next vehicle over and run its plate">Make a traffic stop</Btn>}
        {policeCar && <Btn size="sm" icon={unit.patrol === false ? 'car' : 'hosp'} onClick={() => { engine.setPatrol(unit.id, unit.patrol === false); audio.click(); bump(); }} title="Patrolling cars respond faster and run their own traffic stops">{unit.patrol === false ? 'Resume patrol' : 'Hold at station'}</Btn>}
      </div>
      {['DISPATCHED', 'EN_ROUTE', 'ON_SCENE', 'AVAILABLE', 'RETURNING'].includes(unit.status) && open.length > 0 && (
        <div className="searchrow">
          <select aria-label="Divert to incident" value={divertTo} onChange={(e) => setDivertTo(e.target.value)}>
            <option value="">{inc ? 'Divert to another incident…' : 'Send to incident…'}</option>
            {open.map((i) => <option key={i.id} value={i.id}>P{6 - i.severity} · {i.label} · {addressOf(engine.city, i.reportedNode!)}</option>)}
          </select>
          <Btn size="sm" kind="primary" disabled={!divertTo} onClick={() => { const r = engine.divert(unit.id, divertTo); toast(r); setDivertTo(''); bump(); }}>{inc ? 'Divert' : 'Send'}</Btn>
        </div>
      )}
      {unit.status === 'TRANSPORTING' && (
        <div className="hosps">
          <div className="sub">DESTINATION HOSPITAL {need !== 'general' && <Badge tone="amber">{need.toUpperCase()} PATIENT</Badge>}</div>
          {hospitals.map((x) => (
            <button key={x.h} className={`hosp ${unit.destNode === x.h ? 'on' : ''}`} disabled={x.closed} onClick={() => { toast(engine.setHospital(unit.id, x.h)); bump(); }}>
              <b>{x.name}{x.pre ? ' · pre-alerted' : ''}</b>
              <span className="depts">{x.has.length ? x.has.map((d) => <i key={d} className={`dept ${x.down.includes(d) ? 'down' : 'up'} ${d === need ? 'need' : ''}`}>{d}</i>) : <i className="dept none">minor injuries only</i>}{x.divert && <i className="dept down">DIVERT</i>}</span>
              <span className="mono small">{fmtEta(x.eta)}{x.er !== undefined ? ` · ER ${x.er}/${x.cap}` : ''}</span>
            </button>
          ))}
          <div className="btnrow"><Btn size="sm" kind="primary" icon="phone" onClick={() => { toast(engine.prealert(unit.id)); bump(); }} title="Call ahead so the team is waiting">Pre-alert hospital</Btn><Btn size="sm" icon="radio" onClick={() => { engine.refreshHospitalBoard(); audio.radioBlip(); bump(); }}>Refresh bed board</Btn></div>
        </div>
      )}
    </div>
  );
}

/** pass caller information to responding crews; warn when a scene needs securing first */
export function CrewBriefing({ engine, inc }: { engine: GameEngine; inc: Incident }) {
  const bump = useApp((s) => s.bump);
  const st = engine.state;
  const assigned = inc.assignedUnits.map((id) => st.units[id]).filter(Boolean);
  const facts = inc.facts.filter((f) => f.confidence !== 'contradicted' && f.key !== 'aid').length;
  const unsafeKnown = inc.facts.some((f) => (f.key === 'weapon' && !!f.value && f.value !== 'none') || (f.key === 'suspect' && f.value === true));
  const exposed = assigned.filter((u) => u.service !== 'police' && ['DISPATCHED', 'EN_ROUTE'].includes(u.status) && !u.staging);
  const policeHere = engine.policeOnScene(inc);
  if (!assigned.length) return null;
  return (
    <div className="brief">
      <Btn size="sm" icon="send" kind={inc.briefedAt == null && facts >= 2 ? 'primary' : 'default'} onClick={() => { toast(engine.briefUnits(inc.id)); bump(); }} title="Relay what the caller told you — informed crews work faster">{inc.briefedAt == null ? 'Brief responding crews' : `Update crews (${facts - (inc.briefedFacts ?? 0)} new)`}</Btn>
      {inc.briefedAt != null && <Badge tone="green">BRIEFED</Badge>}
      {inc.accessNeeded && !inc.accessNeeded.relayed && (
        <div className="note-line warn"><Icon n="pin" size={12} /> Crews asked how to get in. {inc.facts.some((f) => f.key === 'access') ? 'You have it — brief the crews.' : 'Ask the caller "How do crews get in?" (Location questions), then brief the crews.'}</div>
      )}
      {unsafeKnown && !policeHere && exposed.length > 0 && (
        <div className="note-line warn"><Icon n="shield" size={12} /> Scene not secure — {exposed.map((u) => u.callsign).join(', ')} {exposed.length > 1 ? 'are' : 'is'} heading into it.
          <div className="btnrow">{exposed.map((u) => <Btn key={u.id} size="sm" onClick={() => { toast(engine.setStaging(u.id, true)); bump(); }}>Stage {u.callsign}</Btn>)}</div>
        </div>
      )}
    </div>
  );
}

/** tactical questions from crews, as cards over the map */
export function DecisionCards({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const now = st.time;
  const live = (st.decisions ?? []).filter((d) => !d.chosen);
  const recent = (st.decisions ?? []).filter((d) => d.chosen && d.outcome && now - (d.expiresAt - 25) < 40 && now - d.at < 45).slice(-2);
  if (!live.length && !recent.length) return null;
  return (
    <div className="decisions">
      {live.map((d) => {
        const u = st.units[d.unitId], inc = st.incidents[d.incId];
        const left = Math.max(0, d.expiresAt - now);
        return (
          <div key={d.id} className="decision" role="alertdialog" aria-label="Crew needs a decision">
            <div className="dc-head"><Icon n={d.kind === 'break' ? 'clock' : 'radio'} size={13} /> <b>{u?.callsign ?? 'Unit'}</b><span className="muted small">· {d.kind === 'break' ? 'Code 7 request' : inc?.label}</span><span className="grow" /><span className="mono small">{Math.ceil(left)}s</span></div>
            <div className="dc-bar"><i style={{ width: `${(left / 25) * 100}%` }} /></div>
            <div className="dc-q">{d.prompt.replace(/^[^:]+: /, '')}</div>
            <div className="dc-opts">{d.options.map((o) => <button key={o.id} className="dc-opt" onClick={() => { engine.decide(d.id, o.id); audio.radioBlip(); bump(); }}><b>{o.label}</b><span>{o.hint}</span></button>)}</div>
            {inc ? <button className="linkish small" onClick={() => { engine.select('incident', d.incId); bump(); }}>Open incident</button> : u && <button className="linkish small" onClick={() => { engine.select('unit', u.id); bump(); }}>Open unit</button>}
          </div>
        );
      })}
      {recent.map((d) => <div key={d.id} className={`decision done ${/hurt|shot|did not|went off|cost|wrong|not happy/.test(d.outcome ?? '') ? 'bad' : 'good'}`}><b>{d.options.find((o) => o.id === d.chosen)?.label}{d.auto ? ' (crew decided)' : ''}</b> — {d.outcome}</div>)}
    </div>
  );
}

/** status of the location trace on the live call */
export function TraceStatus({ call }: { call: Call }) {
  const tr = call.trace;
  if (!tr) return null;
  const next = tr.stages[tr.stage + 1];
  return (
    <div className={`trace ${tr.done ? 'done' : ''}`}>
      <Icon n="pin" size={13} />
      <span className="grow">{tr.stage < 0 ? 'Trace requested — waiting for the carrier…' : `${tr.label} · ±${Math.max(10, Math.round(tr.radius * 4 / 10) * 10)} m`}</span>
      {!tr.done && next && <span className="mono small">refining…</span>}
      {!tr.done && call.state !== 'active' && call.state !== 'hold' && <span className="small">stopped — the line dropped</span>}
    </div>
  );
}

/** CCTV feed: a rendered, grainy view of the street from the nearest city camera */
export function CctvViewer({ engine, view, onClose }: { engine: GameEngine; view: { cam: string; x: number; y: number; sees: boolean; text: string; incId: string }; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = engine.state;
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const inc = st.incidents[view.incId];
    const t = getCity().nodes[inc?.nodeId ?? 0];
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const z = 3.4, cx = view.sees ? (view.x + t.x) / 2 : view.x, cy = (view.sees ? (view.y + t.y) / 2 : view.y) + 10;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#10161c'; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.filter = 'saturate(0.35) contrast(1.15) brightness(1.05)';
      ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cx, -cy);
      const v = { x0: cx - W / 2 / z - 20, y0: cy - H / 2 / z - 20, x1: cx + W / 2 / z + 20, y1: cy + H / 2 / z + 60 };
      drawCity(ctx, 2, v, new Set(st.config.districts), z, { skipRoofs: true, tilt: 0.9 });
      drawBuildings3D(ctx, v, 0.9, 0, z, false);
      drawModels(ctx, v, 0.9, 0, z);
      if (view.sees && inc) {
        if (inc.category === 'fire') {
          const g = ctx.createRadialGradient(t.x, t.y - 6, 0, t.x, t.y - 6, 26 + Math.sin(now / 90) * 3); g.addColorStop(0, 'rgba(255,170,80,0.9)'); g.addColorStop(1, 'rgba(255,120,40,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(t.x, t.y - 6, 28, 0, 7); ctx.fill(); for (let k = 0; k < 5; k++) { ctx.fillStyle = `rgba(255,${150 + k * 15},60,${0.8 - k * 0.12})`; ctx.beginPath(); ctx.ellipse(t.x + (k - 2) * 3, t.y - 8 - Math.abs(Math.sin(now / 120 + k)) * 6, 2.2, 5 + Math.sin(now / 80 + k) * 1.5, 0, 0, 7); ctx.fill(); }
          for (let k = 0; k < 7; k++) { const a = ((now / 1600 + k / 7) % 1); ctx.fillStyle = `rgba(80,80,85,${0.5 * (1 - a)})`; ctx.beginPath(); ctx.arc(t.x + a * 16 + k, t.y - a * 40, 4 + a * 10, 0, 7); ctx.fill(); }
        } else {
          for (let k = 0; k < 6; k++) { const a = k * 1.1 + now / 3000; ctx.fillStyle = k === 0 ? '#e8edf2' : '#9aa6b2'; ctx.beginPath(); ctx.arc(t.x + Math.cos(a) * (k ? 7 : 0), t.y + Math.sin(a) * (k ? 5 : 0), 1.4, 0, 7); ctx.fill(); }
        }
      }
      ctx.restore();
      // grain, scanlines, overlay
      const img = ctx.getImageData(0, 0, W, H); const d = img.data;
      for (let i = 0; i < d.length; i += 4 * 3) { const n = (Math.random() - 0.5) * 34; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      ctx.font = '600 12px ui-monospace, monospace'; ctx.fillStyle = 'rgba(235,240,245,0.92)'; ctx.textAlign = 'left';
      ctx.fillText(`${view.cam}  ${addressOf(getCity(), getCity().nearestNode(view.x, view.y)).toUpperCase()}`, 12, 20);
      ctx.textAlign = 'right'; ctx.fillText(gameClock(st), W - 12, 20);
      if (Math.floor(now / 600) % 2) { ctx.fillStyle = '#ff4040'; ctx.beginPath(); ctx.arc(W - 70, H - 16, 5, 0, 7); ctx.fill(); }
      ctx.fillStyle = 'rgba(235,240,245,0.9)'; ctx.fillText('REC', W - 32, H - 12);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [view]);
  return (
    <div className="cctv-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cctv" role="dialog" aria-label="CCTV camera">
        <div className="cctv-head"><Icon n="map" size={13} /> <b>City CCTV</b><span className="grow" /><button className="icon-btn" onClick={onClose} aria-label="Close camera"><Icon n="x" size={14} /></button></div>
        <canvas ref={ref} width={560} height={315} />
        <div className={`cctv-text ${view.sees ? 'ok' : ''}`}>{view.text}</div>
      </div>
    </div>
  );
}

/** headline crawl and the big banner when a storyline breaks */
export function NewsTicker({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const news = (st.news ?? []).slice(-6).reverse();
  if (!news.length) return null;
  const latest = news[0];
  const breaking = latest.text.startsWith('BREAKING') && st.time - latest.t < 9;
  return (
    <>
      {breaking && <div className="breaking" role="alert"><span className="bk-tag">BREAKING</span><span className="bk-text">{latest.text.replace(/^BREAKING:\s*/, '')}</span></div>}
      <div className="ticker" aria-label="Ravenport news">
        <span className="tk-tag">RAVENPORT NEWS</span>
        <div className="tk-track"><div className="tk-run" style={{ animationDuration: `${Math.max(30, news.length * 12)}s` }}>{[...news, ...news].map((n, i) => <span key={i} className={`tk-item ${n.tone}`}>{gameClock(st, n.t).slice(0, 5)} · {n.text}</span>)}</div></div>
      </div>
    </>
  );
}
void fmtTime;

// ── CCTV launcher (panels ask, the game screen shows the viewer) ─────────────
type CctvView = { cam: string; x: number; y: number; sees: boolean; text: string; incId: string };
let cctvSink: ((v: CctvView | null) => void) | null = null;
export function useCctvSink(set: (v: CctvView | null) => void) { useEffect(() => { cctvSink = set; return () => { if (cctvSink === set) cctvSink = null; }; }, [set]); }
export function openCctv(engine: GameEngine, incId: string) {
  const r = engine.viewCctv(incId);
  if (!r.ok) { toast(r); return; }
  audio.click();
  cctvSink?.({ cam: r.cam!, x: r.x!, y: r.y!, sees: !!r.sees, text: r.text!, incId });
}

/** active BOLOs, with the time left on each */
export function BoloDock({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const live = (st.bolos ?? []).filter((b) => b.status === 'active' || (b.status === 'found' && st.time - b.at < 600 && st.time < b.expiresAt));
  if (!live.length) return null;
  return (
    <div className="bolodock">
      {live.slice(-3).map((b) => {
        const inc = st.incidents[b.incId];
        return (
          <button key={b.id} className={`bolo ${b.status}`} onClick={() => { if (inc) { engine.select('incident', inc.id); useApp.getState().bump(); } }} title={b.text}>
            <span className="bolo-tag">{b.status === 'found' ? 'BOLO HIT' : 'BOLO'}</span>
            <span className="bolo-txt">{b.text}</span>
            <span className="mono small">{b.status === 'found' ? st.units[b.foundBy ?? '']?.callsign ?? '' : fmtTime(b.expiresAt - st.time)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** incident card: outside agency, public alert and the search grid */
export function FieldOps({ engine, inc }: { engine: GameEngine; inc: Incident }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const [alertOpen, setAlertOpen] = useState(false);
  const kind = engine.agencyFor(inc);
  const a = inc.agency;
  const S = inc.search;
  const al = engine.alertInfo(inc.id);
  const district = al.district ? engine.city.districtById[al.district]?.name : inc.reportedNode !== null ? engine.city.districtById[engine.city.nodes[inc.reportedNode].district]?.name : '';
  const asked = a?.askedAt != null && a.calledAt == null;
  return (
    <>
      {kind && inc.reportedNode !== null && (
        <div className={`agency ${asked ? 'ask' : ''} ${a?.here ? 'here' : ''}`}>
          <Icon n="phone" size={13} />
          <div className="grow">
            <b>{AGENCY[kind].name}</b>
            <div className="small muted">{a?.here ? 'On scene' : a?.calledAt != null ? `En route · ${fmtTime((a.arriveAt ?? st.time) - st.time)}` : asked ? `Crew asked ${fmtTime(st.time - a!.askedAt!)} ago — the scene can't clear without it` : 'Likely needed — calling ahead saves time'}</div>
          </div>
          {a?.calledAt == null && <Btn size="sm" kind={asked ? 'primary' : 'default'} onClick={() => { toast(engine.callAgency(inc.id), `${AGENCY[kind].name} called`); bump(); }}>Call · ${AGENCY[kind].cost}</Btn>}
        </div>
      )}
      {S && !S.found && (
        <div className="searchgrid">
          <div className="sub">SEARCH SECTORS {S.exhausted && <Badge tone="red">AREA EXHAUSTED</Badge>}</div>
          {S.sectors.map((sec, i) => {
            const crews = inc.assignedUnits.map((id) => st.units[id]).filter((u) => u && u.searchSector === i);
            const clear = sec.searched >= 1;
            return (
              <div className={`sector ${clear ? 'clear' : ''}`} key={sec.id}>
                <b className="sec-id">{sec.id}</b>
                <span className="mono sec-p">{sec.p}%</span>
                <div className="sec-bar"><i style={{ width: `${Math.round(sec.searched * 100)}%` }} /></div>
                <span className="small muted sec-who">{clear ? 'clear' : crews.map((u) => u.callsign).join(', ')}</span>
                {!clear && <Btn size="sm" onClick={() => { toast(engine.assignSearch(inc.id, i)); bump(); }} title="Send an idle crew on scene, or the nearest free unit">Send</Btn>}
              </div>
            );
          })}
          <div className="small muted">Likelier sectors first. Drag a unit onto a sector on the map, or right-click a sector. A helicopter sweeps every sector at once.</div>
        </div>
      )}
      {inc.alert ? (
        <div className={`note-line ${inc.alert.kind === 'evacuate' ? 'bad' : 'warn'}`}><Icon n="alert" size={12} /> {inc.alert.kind === 'evacuate' ? 'Evacuation order' : 'Shelter-in-place order'} out for {district}.</div>
      ) : al.ok && (
        <div className="alertrow">
          {!alertOpen ? <button className="linkish small" onClick={() => setAlertOpen(true)}><Icon n="alert" size={11} /> Public alert for {district}…</button> : (
            <>
              <span className="small muted">Alert every phone in {district}:</span>
              <Btn size="sm" kind="danger" onClick={() => { toast(engine.issueAlert(inc.id, 'evacuate'), 'Evacuation order sent'); setAlertOpen(false); bump(); }} title="Get people out: fires, gas, explosions, derailments, bomb threats">Evacuate</Btn>
              <Btn size="sm" kind="warn" onClick={() => { toast(engine.issueAlert(inc.id, 'shelter'), 'Shelter-in-place order sent'); setAlertOpen(false); bump(); }} title="Keep people indoors: shooters, hostage scenes, toxic smoke">Shelter in place</Btn>
              <button className="linkish small" onClick={() => setAlertOpen(false)}>Cancel</button>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** officers waiting on a status check */
export function StatusDock({ engine }: { engine: GameEngine }) {
  const bump = useApp((s) => s.bump);
  const due = engine.overdueChecks();
  if (!due.length) return null;
  return (
    <button className="recdock statusdock" onClick={() => { engine.statusCheck(due[0].id); audio.radioBlip(); bump(); }} title="Ask the most overdue officer for a status (S)">
      <Icon n="radio" size={15} /> <b>{due.length} status check{due.length > 1 ? 's' : ''} due</b> <span className="mono small">{due[0].callsign}</span> <kbd>S</kbd>
    </button>
  );
}

/** units picked with a Shift+drag box */
export function MultiBar({ engine, ids, onClear }: { engine: GameEngine; ids: string[]; onClear: () => void }) {
  const bump = useApp((s) => s.bump);
  const units = ids.map((id) => engine.state.units[id]).filter(Boolean);
  if (!units.length) return null;
  return (
    <div className="multibar">
      <Icon n="users" size={14} /> <b>{units.length} unit{units.length > 1 ? 's' : ''}</b>
      <span className="small muted">{units.slice(0, 4).map((u) => u.callsign).join(', ')}{units.length > 4 ? '…' : ''} — right-click an incident to send them all</span>
      <Btn size="sm" onClick={() => { let n = 0; for (const u of units) if (engine.recall(u.id)) n++; toast(n > 0, `${n} unit${n === 1 ? '' : 's'} recalled`); onClear(); bump(); }}>Recall all</Btn>
      <Btn size="sm" kind="ghost" onClick={onClear}>Clear</Btn>
    </div>
  );
}
