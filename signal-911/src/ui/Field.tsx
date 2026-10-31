// Field operations UI: unit radio commands, tactical decision cards, call trace status,
// the breaking-news banner and the news ticker.
import { useEffect, useRef, useState } from 'react';
import { addressOf, getCity } from '../sim/city';
import { RESOURCES, gameClock, type GameEngine } from '../sim/engine';
import { isAir } from '../sim/fleet';
import type { Call, Incident, Unit } from '../sim/types';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { SECTORS, assignSector, commandFactor, sectorFit, setCommander, type Sector } from '../sim/field';
import { Badge, Btn, Icon, fmtEta, fmtTime } from './common';

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
  const queries = (st.unitQueries ?? []).filter((q) => q.status === 'open' || q.status === 'standby');
  if (!live.length && !recent.length && !queries.length) return null;
  return (
    <div className="decisions">
      {queries.map((q) => {
        const u = st.units[q.unitId], inc = st.incidents[q.incId];
        const o = engine.queryOptions(q.id);
        const left = Math.max(0, q.expiresAt - now);
        const ans = (mode: 'relay' | 'deny' | 'standby') => { const r = engine.answerUnitQuery(q.id, mode); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); else audio.radioBlip(); bump(); };
        return (
          <div key={q.id} className={`decision query ${q.status}`} role="alertdialog" aria-label="Crew asking for information">
            <div className="dc-head"><Icon n="radio" size={13} /> <b>{u?.callsign ?? 'Unit'}</b><span className="muted small">· {inc?.label} · en route</span><span className="grow" /><span className="mono small">{Math.ceil(left)}s</span></div>
            <div className="dc-bar"><i style={{ width: `${(left / (q.status === 'standby' ? 40 : 30)) * 100}%` }} /></div>
            <div className="dc-q">“Dispatch — {q.text}”</div>
            <div className="dc-opts">
              {o.known ? <button className="dc-opt" onClick={() => ans('relay')}><b>Relay: {o.known.label} — {o.known.value}</b><span>What the caller told you</span></button>
                : <button className="dc-opt" disabled><b>You don't know yet</b><span>Ask the caller, then relay it here</span></button>}
              {o.canDeny && <button className="dc-opt" onClick={() => ans('deny')}><b>{q.key === 'weapon' ? 'No weapons reported' : q.key === 'trapped' ? 'Nobody inside that we know of' : 'No hazards reported'}</b><span>Only if you're sure — wrong is dangerous</span></button>}
              {q.status === 'open' && <button className="dc-opt" onClick={() => ans('standby')}><b>Stand by — I'll find out</b><span>Buys time to ask the caller</span></button>}
            </div>
            {inc && <button className="linkish small" onClick={() => { engine.select('incident', inc.id); bump(); }}>Open incident</button>}
          </div>
        );
      })}
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

// ── CCTV terminal launcher ───────────────────────────────────────────────────
/** open the CCTV terminal (it never picks a camera for you) */
export function openCctv() { audio.click(); useApp.getState().setCctvOpen(true); }

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

/** outside resources on this incident, and a way into the resources panel */
function ResourceSummary({ engine, inc }: { engine: GameEngine; inc: Incident }) {
  const open = useApp((s) => s.openResources);
  const rows = RESOURCES.map((r) => ({ r, i: engine.resourceInfo(inc.id, r.id) })).filter((x) => x.i.status !== 'none' || x.i.recommended);
  const asked = rows.filter((x) => x.i.asked);
  return (
    <div className={`agency ressum ${asked.length ? 'ask' : ''}`}>
      <Icon n="phone" size={13} />
      <div className="grow">
        <b>Outside resources</b>
        <div className="small muted">{rows.length ? rows.map((x) => `${x.r.short} ${x.i.status === 'here' ? '✓ on scene' : x.i.status === 'none' ? (x.i.asked ? '— crew asked' : '— suggested') : `· ${fmtTime(Math.max(0, x.i.eta ?? 0))}`}`).join('  ·  ') : 'Tow, utilities, K-9, negotiators, hazmat, USAR, Coast Guard, federal team, Guard EOD, mutual aid'}</div>
      </div>
      <Btn size="sm" kind={asked.length ? 'primary' : 'default'} icon="radio" onClick={() => open(inc.id)}>Request on radio (Q)</Btn>
    </div>
  );
}

/** incident card: outside agency, public alert and the search grid */
export function FieldOps({ engine, inc }: { engine: GameEngine; inc: Incident }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const [alertOpen, setAlertOpen] = useState(false);
  const S = inc.search;
  const al = engine.alertInfo(inc.id);
  const district = al.district ? engine.city.districtById[al.district]?.name : inc.reportedNode !== null ? engine.city.districtById[engine.city.nodes[inc.reportedNode].district]?.name : '';
  return (
    <>
      <ResourceSummary engine={engine} inc={inc} />
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

/** incident command at a big fire: name a commander and give each company a job */
export function SceneCommand({ engine, inc }: { engine: GameEngine; inc: Incident }) {
  const bump = useApp((s) => s.bump);
  const c = inc.command!;
  const crews = engine.onScene(inc).filter((u) => u.service === 'fire' && !isAir(u));
  const { f, notes } = commandFactor(engine, inc);
  const act = (r: { ok: boolean; reason?: string }) => { toast(r); bump(); };
  return (
    <div className="card scenecmd">
      <div className="sc-head"><Icon n="flame" size={13} /><b>Scene command</b><span className="grow" /><Badge tone={f >= 0.95 ? 'green' : f >= 0.8 ? 'amber' : 'red'}>Fireground {Math.round(f * 100)}%</Badge></div>
      <div className="sc-line"><label>Incident commander</label>
        <select value={c.ic ?? ''} onChange={(e) => act(setCommander(engine, inc.id, e.target.value || null))}>
          <option value="">— nobody —</option>
          {crews.map((u) => <option key={u.id} value={u.id}>{u.callsign} · {u.typeLabel}</option>)}
        </select></div>
      {SECTORS.map((s) => {
        const cur = c.sectors[s.id as Sector];
        const u = cur ? engine.state.units[cur] : null;
        return (
          <div className="sc-line" key={s.id} title={s.hint}><label>{s.label}</label>
            <select value={cur ?? ''} onChange={(e) => act(assignSector(engine, inc.id, s.id as Sector, e.target.value || null))}>
              <option value="">— unassigned —</option>
              {crews.map((x) => <option key={x.id} value={x.id}>{x.callsign} · {x.typeLabel}{x.id === c.ic ? ' (IC)' : ''}</option>)}
            </select>
            {u && <span className={`fit ${sectorFit(s.id as Sector, u) >= 0.9 ? 'ok' : sectorFit(s.id as Sector, u) >= 0.6 ? 'meh' : 'bad'}`}>{sectorFit(s.id as Sector, u) >= 0.9 ? 'right crew' : sectorFit(s.id as Sector, u) >= 0.6 ? 'can do it' : 'wrong crew'}</span>}
          </div>
        );
      })}
      {notes.length > 0 && <ul className="sc-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </div>
  );
}

/** the shift supervisor's current ask, and how you are doing on it */
export function DirectiveCard({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const d = (st.directives ?? []).filter((x) => !x.result || st.time - x.until < 6).slice(-1)[0];
  if (!d) return null;
  const left = Math.max(0, d.until - st.time);
  return (
    <div className={`directive ${d.result ?? ''}`}>
      <span className="dv-tag">SUPERVISOR</span>
      <span className="dv-text">{d.text}</span>
      <span className="mono small">{d.result === 'done' ? 'MET ✓' : d.result === 'failed' ? 'FAILED' : d.kind === 'clear' ? `${d.progress}/${d.target} · ${fmtTime(left)}` : fmtTime(left)}</span>
    </div>
  );
}
