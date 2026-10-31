import { useMemo, useState } from 'react';
import { audio } from '../audio/audioManager';
import { addressOf, getCity } from '../sim/city';
import { CAP_LABEL } from '../sim/content/vocab';
import { GameEngine, DIFFICULTY } from '../sim/engine';
import { BUILD_STATION_COST, SERVICE_META, UNIT_TYPES, UNIT_TYPE_BY_ID, UPGRADES, hireCost } from '../sim/fleet';
import { WEATHER_LABEL } from '../sim/events';
import {
  assignPersonnel, buildStation, buyUnit, buyUpgrade, candidatePool, careerConfig, dismissPersonnel, hirePersonnel, sellUnit, setupFromProfile, stationCapacity, stationUnitCount, trainPersonnel, type Profile,
} from '../sim/profile';
import { nextRankXp, RANKS, rankDef } from '../sim/progression';
import { CHAPTERS, SCENARIOS } from '../sim/scenarios';
import type { Difficulty, Personnel, Service } from '../sim/types';
import { useApp, type HubTab } from '../store';
import { Badge, Bar, Btn, Grade, Icon, SERVICE_ICON, Tabs, Toast, fmtEta, fmtMoney, weatherIcon } from './common';
import { LAYERS, MapView, type LayerId } from './MapView';
import { AchievementsPage, ExtrasList } from './Extras';
import { Garage } from './Garage';
import { EVENT_DEFS } from '../sim/events';
import { isAir } from '../sim/fleet';

const TABS: Array<{ id: HubTab; label: string; icon: string }> = [
  { id: 'overview', label: 'City overview', icon: 'map' }, { id: 'prep', label: 'Shift preparation', icon: 'clock' }, { id: 'fleet', label: 'Fleet & stations', icon: 'car' },
  { id: 'crew', label: 'Personnel', icon: 'users' }, { id: 'shop', label: 'Vehicle shop', icon: 'coins' }, { id: 'upgrades', label: 'Upgrades', icon: 'wrench' },
  { id: 'career', label: 'Career & campaign', icon: 'trophy' }, { id: 'achievements', label: 'Achievements', icon: 'star' }, { id: 'stats', label: 'Statistics', icon: 'book' },
];

export function HubScreen() {
  const p = useApp((s) => s.profile)!;
  const tab = useApp((s) => s.hubTab);
  const setTab = useApp((s) => s.setTab);
  const go = useApp((s) => s.go);
  const slot = useApp((s) => s.slot);
  useApp((s) => s.rev);
  const [saved, setSaved] = useState(false);
  return (
    <div className="hub">
      <header className="hub-top">
        <button className="brand-btn" onClick={() => go('menu')}><span className="logo">◉</span><b>SIGNAL 911</b></button>
        <span className="muted">·</span><b>{p.name}</b><Badge tone="blue">{rankDef(p.rank).title}</Badge>
        <div className="grow" />
        <div className="stat"><Icon n="coins" size={14} /> <b className="mono">{fmtMoney(p.money)}</b></div>
        <div className="stat"><Icon n="star" size={14} /> <b className="mono">{Math.round(p.reputation)}</b> <span className="muted small">reputation</span></div>
        <Btn size="sm" icon="save" onClick={async () => { await useApp.getState().saveSlot('slot1'); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>{saved ? 'Saved' : 'Save'}</Btn>
        <Btn size="sm" icon="gear" onClick={() => go('settings')}>Settings</Btn>
        <Btn size="sm" icon="chevL" onClick={() => go('menu')}>Menu</Btn>
      </header>
      <div className="hub-body">
        <nav className="hub-nav" aria-label="Career sections">
          {TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id} onClick={() => { audio.click(); setTab(t.id); }}><Icon n={t.icon} size={15} />{t.label}</button>)}
          <div className="grow" />
          <Btn kind="primary" size="lg" icon="play" onClick={() => setTab('prep')}>Next shift →</Btn>
          <div className="muted small pad">Autosave {useApp.getState().settings.autoSave ? 'on' : 'off'} · slot {slot}</div>
        </nav>
        <main className="hub-main">
          {tab === 'overview' && <Overview p={p} />}
          {tab === 'prep' && <Prep p={p} />}
          {tab === 'fleet' && <Fleet p={p} />}
          {tab === 'crew' && <Crew p={p} />}
          {tab === 'shop' && <Shop p={p} />}
          {tab === 'upgrades' && <Upgrades p={p} />}
          {tab === 'career' && <CareerTab p={p} />}
          {tab === 'achievements' && <AchievementsPage p={p} />}
          {tab === 'stats' && <StatsTab p={p} />}
        </main>
      </div>
      <Toast />
    </div>
  );
}

function usePreview(p: Profile) {
  return useMemo(() => {
    const e = GameEngine.fromConfig(careerConfig(p), setupFromProfile(p));
    e.state.paused = true;
    return e;
  }, [p.updatedAt, p.units.length, p.rank, p.stations.length]);
}

function Overview({ p }: { p: Profile }) {
  const engine = usePreview(p);
  const bump = useApp((s) => s.bump);
  const mutate = useApp((s) => s.mutateProfile);
  const [layer, setLayer] = useState<LayerId>('coverage');
  const city = getCity();
  const st = engine.state;
  const sel = st.selected;
  const cfg = careerConfig(p);
  const cov = (s: Service) => { const t = engine.coverageTimes(s); const ids = cfg.districts.flatMap((d) => city.nodesInDistrict[d]); return ids.filter((n) => t[n] <= 100).length / ids.length; };
  const onContext = (node: number) => {
    if (sel.kind === 'unit' && sel.id) { mutate((pp) => { const u = pp.units.find((x) => x.id === sel.id); if (u) { u.postNode = node; u.prevNode = node; const n = city.nodes[node]; u.x = n.x; u.y = n.y; } }); useApp.getState().showToast('Unit post updated', 'good'); }
  };
  return (
    <div className="hub-split">
      <div className="hub-map">
        <MapView world3d engine={engine} layer={layer} mode="select" selected={sel} onSelect={(k, id) => { engine.select(k, id); bump(); }} onContext={onContext} showIncidents={false} />
        <div className="maptools"><div className="seg wrap">{LAYERS.filter((l) => l.id !== 'incidents').map((l) => <button key={l.id} className={layer === l.id ? 'on' : ''} onClick={() => setLayer(l.id)}>{l.label}</button>)}</div></div>
        <div className="legend"><b>RESPONSE TIME</b>{[['#54B889', '< 45 s'], ['#8fbf6a', '< 85 s'], ['#E5AC4D', '< 125 s'], ['#D68a4d', '< 175 s'], ['#D65353', 'Uncovered']].map(([c, l]) => <span key={l}><i className="lg" style={{ background: c }} /> {l}</span>)}</div>
        <div className="maphint">Select a unit, then right-click the map to change where it waits.</div>
      </div>
      <div className="hub-side">
        <div className="card"><h3>Strategic coverage <span className="muted small">(units reaching nodes within 100 s)</span></h3>
          {(['police', 'fire', 'medical'] as Service[]).map((s) => <div className="kv" key={s}><span style={{ color: SERVICE_META[s].color }}><Icon n={SERVICE_ICON[s]} size={12} /> {SERVICE_META[s].label}</span><Bar value={cov(s) * 100} tone={cov(s) > 0.6 ? 'green' : cov(s) > 0.35 ? 'amber' : 'red'} /><span className="mono small">{Math.round(cov(s) * 100)}%</span></div>)}
        </div>
        {sel.kind === 'unit' && sel.id && p.units.find((u) => u.id === sel.id) && <UnitCard p={p} id={sel.id} />}
        {sel.kind === 'district' && sel.id && <DistrictCard id={sel.id} p={p} />}
        {p.city.log.length > 0 && <div className="card warnc"><h3><Icon n="alert" size={14} /> Consequences from last shift</h3>{p.city.log.map((l, i) => <p key={i} className="small">{l}</p>)}</div>}
        {p.city.closedRoads.length > 0 && <div className="card"><h3>Road closures</h3>{p.city.closedRoads.map((r) => <div key={r.edge} className="kv"><span>{city.edges[r.edge].name} ({city.districtById[city.nodes[city.edges[r.edge].a].district].name})</span><b>{r.shifts} shift{r.shifts > 1 ? 's' : ''}</b></div>)}</div>}
        <div className="card"><h3>Districts</h3>
          <div className="dlist">{city.districts.map((d) => (
            <button key={d.id} className={`drow ${d.unlockRank > p.rank ? 'locked' : ''}`} onClick={() => { engine.select('district', d.id); bump(); }}>
              <span>{d.unlockRank > p.rank ? <Icon n="lock" size={12} /> : <Icon n="check" size={12} />} {d.name}</span>
              <span className="muted small">{d.unlockRank > p.rank ? `Rank ${d.unlockRank}` : d.tags[0]}</span>
            </button>))}</div>
        </div>
      </div>
    </div>
  );
}
function DistrictCard({ id, p }: { id: string; p: Profile }) {
  const d = getCity().districtById[id];
  return <div className="card"><h3>{d.name} {d.unlockRank > p.rank ? <Badge>LOCKED · RANK {d.unlockRank}</Badge> : <Badge tone="green">ACTIVE</Badge>}</h3><p className="muted small">{d.blurb}</p><div className="chips">{d.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div><div className="kv"><span>Base traffic</span><Bar value={d.baseTraffic * 100} /></div></div>;
}
function UnitCard({ p, id }: { p: Profile; id: string }) {
  const u = p.units.find((x) => x.id === id)!;
  const mutate = useApp((s) => s.mutateProfile);
  const crew = u.personnelIds.map((pid) => p.personnel.find((x) => x.id === pid)).filter(Boolean) as Personnel[];
  return (
    <div className="card"><h3><span className="mono">{u.callsign}</span> <span className="muted small">{u.typeLabel}</span></h3>
      <div className="kv"><span>Station</span><b>{p.stations.find((s) => s.id === u.stationId)?.name}</b></div>
      <div className="kv"><span>Waiting at</span><b>{addressOf(getCity(), u.postNode)}</b></div>
      <div className="kv"><span>Crew</span><b>{crew.length}/{u.crewSeats} (min {u.minCrew})</b></div>
      <div className="chips">{u.capabilities.map((c) => <Badge key={c}>{CAP_LABEL[c]}</Badge>)}</div>
      <div className="btnrow"><Btn size="sm" icon="hosp" onClick={() => mutate((pp) => { const uu = pp.units.find((x) => x.id === id)!; const st = pp.stations.find((s) => s.id === uu.stationId)!; uu.postNode = st.nodeId; uu.prevNode = st.nodeId; const n = getCity().nodes[st.nodeId]; uu.x = n.x; uu.y = n.y; })}>Back to station</Btn>
        <Btn size="sm" kind="danger" icon="trash" onClick={() => mutate((pp) => { if (!sellUnit(pp, id)) useApp.getState().showToast('Keep at least two units per service', 'warn'); })}>Sell ({fmtMoney(Math.round(u.value * 0.45))})</Btn></div>
    </div>
  );
}

function Prep({ p }: { p: Profile }) {
  const engine = usePreview(p);
  const mutate = useApp((s) => s.mutateProfile);
  const startShift = useApp((s) => s.startCareerShift);
  const startChapter = useApp((s) => s.startChapter);
  const cfg = careerConfig(p);
  const city = getCity();
  const st = engine.state;
  const [layer, setLayer] = useState<LayerId>('coverage');
  const [pane, setPane] = useState<'map' | 'garage'>('map');
  const bump = useApp((s) => s.bump);
  const fitted = p.units.filter((u) => u.fit && (u.fit.kits.length || u.fit.livery !== 'classic' || (u.fit.chassis && !['sedan', 'pumper', 'van'].includes(u.fit.chassis)))).length;
  /** pre-position the fleet before the shift */
  const deploy = (how: 'stations' | 'spread') => mutate((pp) => {
    for (const svc of ['police', 'fire', 'medical'] as Service[]) {
      const us = pp.units.filter((u) => u.service === svc && !isAir(u));
      us.forEach((u, i) => {
        let node: number;
        if (how === 'stations') node = pp.stations.find((x) => x.id === u.stationId)?.nodeId ?? u.postNode;
        else {
          const d = city.districtById[cfg.districts[(i * 5 + (svc === 'fire' ? 1 : svc === 'medical' ? 3 : 0)) % cfg.districts.length]];
          const ns = city.nodesInDistrict[d.id].filter((n) => city.adj[n].some((e) => city.edges[e].cls !== 'highway'));
          node = ns.reduce((b, n) => (Math.hypot(city.nodes[n].x - d.center.x, city.nodes[n].y - d.center.y) < Math.hypot(city.nodes[b].x - d.center.x, city.nodes[b].y - d.center.y) ? n : b), ns[0]);
        }
        u.postNode = node; u.prevNode = node; u.x = city.nodes[node].x; u.y = city.nodes[node].y;
      });
    }
  });
  const known = cfg.events.filter((e) => ['protest', 'marathon', 'festival', 'transit_strike', 'rush_hour', 'storm', 'winter_storm', 'heat_wave', 'flood'].includes(e.type));
  const at = (sec: number) => { const h = (cfg.startHour + sec / 3600) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };
  const threat = cfg.threatLevel ?? 'low';
  const THREAT = { low: ['LOW', 'green', 'Quiet on the intelligence side. No credible threats on the board.'], guarded: ['GUARDED', 'blue', 'Routine chatter. Nothing specific — stay sharp.'], elevated: ['ELEVATED', 'amber', 'Analysts report elevated risk today. Something may be planned — keep specialists in mind.'], severe: ['SEVERE', 'red', 'Multiple credible threats. Expect at least one major incident this shift.'] } as const;
  const cov = (s: Service) => { const t = engine.coverageTimes(s); const ids = cfg.districts.flatMap((d) => city.nodesInDistrict[d]); return ids.filter((n) => t[n] <= 100).length / ids.length; };
  const under = Object.values(st.units).filter((u) => u.status === 'OUT_OF_SERVICE');
  const next = CHAPTERS.find((c) => !p.campaign.completed.includes(c.id));
  const chOk = next && p.rank >= next.minRank;
  const onContext = (node: number) => {
    const sel = st.selected;
    if (sel.kind === 'unit' && sel.id) mutate((pp) => { const u = pp.units.find((x) => x.id === sel.id); if (u) { u.postNode = node; u.prevNode = node; const n = city.nodes[node]; u.x = n.x; u.y = n.y; } });
  };
  return (
    <div className="hub-split">
      <div className={`hub-map prep-left ${pane}`}>
        <div className="prep-tabs">
          <button className={pane === 'map' ? 'on' : ''} onClick={() => setPane('map')}><Icon n="map" size={13} /> Deployment</button>
          <button className={pane === 'garage' ? 'on' : ''} onClick={() => setPane('garage')}><Icon n="wrench" size={13} /> Garage{fitted ? <span className="pill">{fitted}</span> : null}</button>
        </div>
        {pane === 'map' ? (
          <>
            <MapView world3d engine={engine} layer={layer} mode="select" selected={st.selected} onSelect={(k, id) => { engine.select(k, id); bump(); }} onContext={onContext} showIncidents={false} />
            <div className="maptools"><div className="seg wrap">{(['coverage', 'police', 'fire', 'medical', 'traffic', 'weather', 'normal'] as LayerId[]).map((l) => <button key={l} className={layer === l ? 'on' : ''} onClick={() => setLayer(l)}>{LAYERS.find((x) => x.id === l)!.label}</button>)}</div>
              <div className="seg"><button onClick={() => deploy('stations')} title="Every vehicle starts at its station">All at stations</button><button onClick={() => deploy('spread')} title="Spread vehicles across your districts for faster first response">Spread out</button></div></div>
            <div className="maphint">Reposition: select a unit, then right-click the map.</div>
          </>
        ) : <div className="prep-garage"><Garage p={p} /></div>}
      </div>
      <div className="hub-side">
        <div className="card brief">
          <h3>Shift {p.counters.shift} — briefing</h3>
          <p className="muted">{rankDef(p.rank).title}. {cfg.districts.length} of 12 districts under your jurisdiction.</p>
          <div className="kv"><span>Starts</span><b className="mono">{String(Math.floor(cfg.startHour)).padStart(2, '0')}:{String(Math.round((cfg.startHour % 1) * 60)).padStart(2, '0')}</b></div>
          <div className="kv"><span>Forecast</span><b><Icon n={weatherIcon(cfg.weather)} size={13} /> {WEATHER_LABEL[cfg.weather]}</b></div>
          <div className="kv"><span>Call volume</span><b>{cfg.incidentRate < 1 ? 'Light' : cfg.incidentRate < 1.2 ? 'Moderate' : 'Heavy'}</b></div>
          <div className="field"><label>Difficulty</label>
            <div className="seg">{(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => <button key={d} className={p.flags.difficulty === d ? 'on' : ''} onClick={() => mutate((pp) => { pp.flags.difficulty = d; })}>{DIFFICULTY[d].label}</button>)}</div>
            <small className="muted">{{ casual: 'Calmer callers, fewer calls, slower escalation.', standard: 'The intended experience.', hard: 'More calls, less cooperative callers, faster escalation — and no assists: no response plans, auto-classification, suggested replies or one-click locations.', expert: 'Short fuses, wrong addresses, relentless volume — and no assists at all.' }[p.flags.difficulty]}</small></div>
          <div className="field"><label>Shift length</label>
            <div className="seg">{[10, 15, 20, 30].map((m) => <button key={m} className={p.flags.duration === m * 60 ? 'on' : ''} onClick={() => mutate((pp) => { pp.flags.duration = m * 60; })}>{m} min</button>)}</div></div>
          <ExtrasList config={cfg} />
          <div className={`intel ${THREAT[threat][1]}`}>
            <div className="intel-head"><Icon n="shield" size={12} /> THREAT LEVEL <b>{THREAT[threat][0]}</b></div>
            <div className="small">{THREAT[threat][2]}</div>
            {known.map((e, i) => <div className="small intel-ev" key={i}><Icon n="clock" size={11} /> {['storm', 'winter_storm', 'heat_wave', 'flood'].includes(e.type) ? 'Forecast' : 'Scheduled'}: <b>{EVENT_DEFS[e.type].name}</b> from about {at(e.at)}</div>)}
          </div>
          <h4>Readiness check</h4>
          {(['police', 'fire', 'medical'] as Service[]).map((s) => <div className="kv" key={s}><span style={{ color: SERVICE_META[s].color }}><Icon n={SERVICE_ICON[s]} size={12} /> {SERVICE_META[s].label}: {Object.values(st.units).filter((u) => u.service === s && u.status !== 'OUT_OF_SERVICE').length} units</span><Bar value={cov(s) * 100} tone={cov(s) > 0.6 ? 'green' : cov(s) > 0.35 ? 'amber' : 'red'} /><span className="mono small">{Math.round(cov(s) * 100)}%</span></div>)}
          {under.length > 0 && <div className="note-line warn"><Icon n="alert" size={12} /> {under.length} unit(s) out of service: {under.map((u) => `${u.callsign} (${u.note ?? 'unavailable'})`).join(', ')}</div>}
          <div className="btnrow col">
            <Btn kind="primary" size="lg" icon="play" onClick={() => startShift()}>BEGIN SHIFT</Btn>
            {next && <Btn size="lg" icon="book" disabled={!chOk} onClick={() => startChapter(next.id)} title={chOk ? next.story : `Requires rank ${next.minRank}`}>{chOk ? `Campaign: ${next.title}` : `Campaign: ${next.title} (rank ${next.minRank})`}</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Fleet({ p }: { p: Profile }) {
  const mutate = useApp((s) => s.mutateProfile);
  const city = getCity();
  return (
    <div className="page">
      <h2>Fleet & stations</h2>
      <div className="cardgrid">
        {p.stations.map((s) => (
          <div className="card" key={s.id}>
            <h3 style={{ color: SERVICE_META[s.service].color }}><Icon n={SERVICE_ICON[s.service]} size={14} /> {s.name}</h3>
            <div className="kv"><span>District</span><b>{city.districtById[s.district].name}</b></div>
            <div className="kv"><span>Bays</span><b>{stationUnitCount(p, s.id)} / {stationCapacity(p, s)}</b></div>
            {s.disabledShifts > 0 && <Badge tone="red">OUT OF SERVICE — {s.disabledShifts} shift</Badge>}
            {p.units.filter((u) => u.stationId === s.id).map((u) => {
              const crew = u.personnelIds.length;
              return <div key={u.id} className="kv"><span className="mono">{u.callsign}</span><span className="muted small">{u.typeLabel}</span><Badge tone={crew >= u.minCrew ? 'green' : 'red'}>{crew}/{u.crewSeats} crew</Badge></div>;
            })}
          </div>
        ))}
      </div>
      <h3>Build a new station</h3>
      <div className="card">
        <p className="muted small">New stations let you base units closer to unreliable districts. Each has {4} bays (more with Garage Expansion).</p>
        <div className="buildgrid">
          {city.districts.filter((d) => d.unlockRank <= p.rank).map((d) => (
            <div key={d.id} className="bd"><b>{d.name}</b>
              <div className="btnrow">{(['police', 'fire', 'medical'] as Service[]).map((s) => {
                const has = p.stations.some((x) => x.service === s && x.district === d.id);
                return <Btn key={s} size="sm" disabled={has || p.money < BUILD_STATION_COST[s]} title={has ? 'Already built' : `${fmtMoney(BUILD_STATION_COST[s])}`} onClick={() => mutate((pp) => { const r = buildStation(pp, s, d.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); else useApp.getState().showToast(`${SERVICE_META[s].label} station built in ${d.name}`, 'good'); })}>{has ? '✓ ' : ''}{SERVICE_META[s].short}{has ? '' : ` ${fmtMoney(BUILD_STATION_COST[s])}`}</Btn>;
              })}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PersonRow({ p, per, onAssign }: { p: Profile; per: Personnel; onAssign: (unitId: string | null) => void }) {
  const mutate = useApp((s) => s.mutateProfile);
  const skill = per.service === 'medical' ? per.medical : per.service === 'fire' ? per.fire : per.policing;
  const unit = p.units.find((u) => u.id === per.unitId);
  const free = p.units.filter((u) => u.service === per.service && (u.personnelIds.length < u.crewSeats || u.id === per.unitId));
  return (
    <tr>
      <td><b>{per.name}</b><div className="muted small">{per.specialty}</div></td>
      <td><span style={{ color: SERVICE_META[per.service].color }}><Icon n={SERVICE_ICON[per.service]} size={12} /></span></td>
      <td className="w120"><Bar value={skill} tone="blue" label="Skill" /><span className="small mono">{Math.round(skill)}</span></td>
      <td className="w120"><Bar value={per.training} tone="blue" label="Training" /></td>
      <td className="w120"><Bar value={per.experience} tone="blue" label="Experience" /></td>
      <td className="w120"><Bar value={per.driving} tone="blue" label="Driving" /></td>
      <td className="w120"><Bar value={per.fatigue} tone={per.fatigue > 60 ? 'red' : 'green'} label="Fatigue" /></td>
      <td className="w120"><Bar value={per.morale} tone="green" label="Morale" /></td>
      <td className="mono small">{fmtMoney(per.salary)}</td>
      <td>
        <select aria-label={`Assign ${per.name}`} value={unit?.id ?? ''} onChange={(e) => onAssign(e.target.value || null)}>
          <option value="">Reserve</option>{free.map((u) => <option key={u.id} value={u.id}>{u.callsign}</option>)}
        </select>
      </td>
      <td className="nowrap"><Btn size="sm" onClick={() => mutate((pp) => { const r = trainPersonnel(pp, per.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); })} title="$2,500: +8 training, +4 skill">Train</Btn> <Btn size="sm" kind="ghost" icon="trash" onClick={() => mutate((pp) => dismissPersonnel(pp, per.id))} title="Dismiss" /></td>
    </tr>
  );
}
function Crew({ p }: { p: Profile }) {
  const mutate = useApp((s) => s.mutateProfile);
  const [svc, setSvc] = useState<Service | 'all'>('all');
  const cands = useMemo(() => candidatePool(p), [p.counters.shift, p.personnel.length]);
  const list = p.personnel.filter((x) => svc === 'all' || x.service === svc);
  const total = p.personnel.reduce((s, x) => s + x.salary, 0);
  return (
    <div className="page">
      <h2>Personnel</h2>
      <div className="row gap"><div className="seg">{(['all', 'police', 'fire', 'medical'] as const).map((s) => <button key={s} className={svc === s ? 'on' : ''} onClick={() => setSvc(s)}>{s === 'all' ? 'All' : SERVICE_META[s].label}</button>)}</div><div className="grow" /><span className="muted">Payroll per shift: <b className="mono">{fmtMoney(total)}</b></span></div>
      <div className="card tablecard">
        <table className="tbl"><thead><tr><th>Name</th><th></th><th>Skill</th><th>Training</th><th>Experience</th><th>Driving</th><th>Fatigue</th><th>Morale</th><th>Salary</th><th>Assigned</th><th></th></tr></thead>
          <tbody>{list.map((x) => <PersonRow key={x.id} p={p} per={x} onAssign={(u) => mutate((pp) => { const r = assignPersonnel(pp, x.id, u); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); })} />)}</tbody></table>
      </div>
      <p className="muted small">Skill, training and experience change how quickly crews resolve incidents; driving affects travel speed; fatigue and morale reduce effectiveness. Units without their minimum crew cannot deploy.</p>
      <h3>Recruitment — this shift’s candidates</h3>
      <div className="cardgrid">
        {cands.map((c) => {
          const cost = hireCost(c);
          const skill = c.service === 'medical' ? c.medical : c.service === 'fire' ? c.fire : c.policing;
          const open = p.units.filter((u) => u.service === c.service && u.personnelIds.length < u.crewSeats);
          return (
            <div className="card" key={c.id}>
              <h3 style={{ color: SERVICE_META[c.service].color }}><Icon n={SERVICE_ICON[c.service]} size={13} /> {c.name}</h3>
              <div className="muted small">{c.specialty} · salary {fmtMoney(c.salary)}/shift</div>
              <div className="kv"><span>Skill</span><Bar value={skill} /></div><div className="kv"><span>Training</span><Bar value={c.training} /></div><div className="kv"><span>Driving</span><Bar value={c.driving} /></div><div className="kv"><span>Reliability</span><Bar value={c.reliability} /></div>
              <div className="btnrow">
                <Btn size="sm" kind="primary" disabled={p.money < cost || !open.length} title={!open.length ? 'No free seat in a matching unit — hire into reserve instead' : ''} onClick={() => mutate((pp) => { const u = pp.units.filter((x) => x.service === c.service && x.personnelIds.length < x.crewSeats).sort((a, b) => a.personnelIds.length - b.personnelIds.length)[0]; const r = hirePersonnel(pp, c, u?.id ?? null); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); else useApp.getState().showToast(`${c.name} hired`, 'good'); })}>Hire {fmtMoney(cost)}</Btn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Shop({ p }: { p: Profile }) {
  const mutate = useApp((s) => s.mutateProfile);
  const [svc, setSvc] = useState<Service>('police');
  const [target, setTarget] = useState<Record<string, string>>({});
  const items = UNIT_TYPES.filter((u) => u.service === svc && u.minRank < 99);
  const stations = p.stations.filter((s) => s.service === svc);
  return (
    <div className="page">
      <h2>Vehicle shop</h2>
      <Tabs tabs={(['police', 'fire', 'medical'] as Service[]).map((s) => ({ id: s, label: SERVICE_META[s].label }))} value={svc} onChange={setSvc} />
      <div className="cardgrid">
        {items.map((d) => {
          const locked = d.minRank > p.rank;
          const chosen = target[d.type] ?? stations.find((s) => stationUnitCount(p, s.id) < stationCapacity(p, s))?.id ?? stations[0]?.id;
          const full = chosen ? stationUnitCount(p, chosen) >= stationCapacity(p, stations.find((s) => s.id === chosen)!) : true;
          return (
            <div className={`card ${locked ? 'locked' : ''}`} key={d.type}>
              <h3>{d.label} {locked && <Badge><Icon n="lock" size={10} /> Rank {d.minRank}</Badge>}</h3>
              <p className="muted small">{d.blurb}</p>
              <div className="chips">{d.caps.map((c) => <Badge key={c}>{CAP_LABEL[c]}</Badge>)}</div>
              <div className="kv"><span>Crew</span><b>{d.crew} (min {d.minCrew})</b></div><div className="kv"><span>Speed</span><b>{d.speed >= 1.1 ? 'Fast' : d.speed >= 0.95 ? 'Normal' : 'Heavy'}</b></div><div className="kv"><span>Equipment</span><b>{d.equipment}</b></div>
              <div className="kv"><span>Station</span>
                <select aria-label="Station" value={chosen} onChange={(e) => setTarget({ ...target, [d.type]: e.target.value })}>{stations.map((s) => <option key={s.id} value={s.id}>{s.name} ({stationUnitCount(p, s.id)}/{stationCapacity(p, s)})</option>)}</select></div>
              <Btn kind="primary" disabled={locked || p.money < d.cost || full} title={locked ? `Requires rank ${d.minRank}` : full ? 'Station is full' : ''} onClick={() => mutate((pp) => { const r = buyUnit(pp, d.type, chosen!); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); else { audio.good(); useApp.getState().showToast(`${d.label} purchased — rookies hired to crew it`, 'good'); } })}>Buy {fmtMoney(d.cost)}</Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Upgrades({ p }: { p: Profile }) {
  const mutate = useApp((s) => s.mutateProfile);
  const groups = [...new Set(UPGRADES.map((u) => u.group))];
  return (
    <div className="page">
      <h2>Upgrades</h2>
      {groups.map((g) => (
        <div key={g}><h3>{g}</h3>
          <div className="cardgrid">{UPGRADES.filter((u) => u.group === g).map((u) => {
            const lvl = p.upgrades[u.id] ?? 0, max = u.costs.length, locked = u.minRank > p.rank;
            return (
              <div className={`card ${locked ? 'locked' : ''}`} key={u.id}>
                <h3>{u.name} {locked && <Badge><Icon n="lock" size={10} /> Rank {u.minRank}</Badge>}</h3>
                <p className="muted small">{u.desc}</p>
                <div className="pips big">{Array.from({ length: max }, (_, i) => <i key={i} className={i < lvl ? 'on' : ''} />)}<span className="small muted">Level {lvl}/{max}</span></div>
                <p className="small"><Icon n="check" size={11} /> {u.effect}</p>
                <Btn kind="primary" disabled={locked || lvl >= max || p.money < (u.costs[lvl] ?? 0)} onClick={() => mutate((pp) => { const r = buyUpgrade(pp, u.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); else { audio.good(); useApp.getState().showToast(`${u.name} upgraded`, 'good'); } })}>{lvl >= max ? 'Maxed' : `Upgrade ${fmtMoney(u.costs[lvl])}`}</Btn>
              </div>
            );
          })}</div></div>
      ))}
    </div>
  );
}

function CareerTab({ p }: { p: Profile }) {
  const nxt = nextRankXp(p.rank);
  const start = useApp((s) => s.startChapter);
  const prev = RANKS[p.rank - 1].xp;
  return (
    <div className="page">
      <h2>Career & campaign</h2>
      <div className="card">
        <div className="row gap center"><Icon n="trophy" size={26} /><div><h3>{rankDef(p.rank).title}</h3><div className="muted small">{rankDef(p.rank).perk}</div></div><div className="grow" /><b className="mono">{p.xp} XP</b></div>
        {nxt !== null ? <><Bar value={p.xp - prev} max={nxt - prev} label="Rank progress" /><div className="muted small">{nxt - p.xp} XP to {RANKS[p.rank].title}</div></> : <div className="muted small">Maximum rank reached.</div>}
      </div>
      <div className="ranklist">
        {RANKS.map((r) => (
          <div key={r.rank} className={`rankrow ${r.rank <= p.rank ? 'done' : ''} ${r.rank === p.rank ? 'cur' : ''}`}>
            <div className="rn">{r.rank <= p.rank ? <Icon n="check" size={13} /> : <Icon n="lock" size={13} />}</div>
            <div className="grow"><b>{r.rank}. {r.title}</b> <span className="muted small">{r.xp} XP</span><div className="muted small">Unlocks: {r.unlocks.join(' · ')}</div></div>
          </div>))}
      </div>
      <h3>Campaign — Ravenport Emergency Dispatch</h3>
      <div className="chapters">
        {CHAPTERS.map((c, i) => {
          const done = p.campaign.completed.includes(c.id);
          const unlocked = i === 0 || p.campaign.completed.includes(CHAPTERS[i - 1].id);
          const ok = unlocked && p.rank >= c.minRank;
          return (
            <div className={`chapter ${done ? 'done' : ''} ${!ok ? 'locked' : ''}`} key={c.id}>
              <div className="chnum">{done ? <Icon n="check" size={16} /> : i + 1}</div>
              <div className="grow"><div className="muted small">{c.subtitle}</div><h3>{c.title} {p.campaign.grades[c.id] && <Grade g={p.campaign.grades[c.id]} size={24} />}</h3><p className="muted small">{c.story}</p>
                <div className="small muted">Reward: {fmtMoney(c.reward.money)} · {c.reward.xp} XP{!ok ? ` · ${!unlocked ? 'finish the previous chapter' : `rank ${c.minRank} required`}` : ''}</div></div>
              <Btn kind={done ? 'default' : 'primary'} disabled={!ok} onClick={() => start(c.id)}>{done ? 'Replay' : 'Start'}</Btn>
            </div>
          );
        })}
      </div>
      <h3>Scenario achievements</h3>
      <div className="cardgrid">{SCENARIOS.map((s) => { const r = p.scenarios[s.id]; return <div className="card" key={s.id}><h3>{s.title}</h3><div className="row gap center">{r ? <Grade g={r.best} size={34} /> : <span className="muted">Not played</span>}{r && <span className="muted small">best {r.bestScore} · {r.plays} play{r.plays > 1 ? 's' : ''}</span>}</div></div>; })}</div>
    </div>
  );
}

function StatsTab({ p }: { p: Profile }) {
  const L = p.stats;
  const rows: Array<[string, string | number]> = [['Shifts completed', L.shifts], ['Calls received', L.calls], ['Calls answered', L.answered], ['Incidents resolved', L.resolved], ['Incidents failed', L.failed], ['Lives helped', L.livesHelped], ['Casualties', L.casualties], ['False alarms identified', L.falseAlarms], ['Units dispatched', L.dispatches], ['Average response', L.responseN ? fmtEta(L.responseSum / L.responseN) : '—'], ['Best shift', `${L.bestScore} (${L.bestGrade})`], ['Total earned', fmtMoney(L.moneyEarned)], ['Play time', `${Math.round(L.playSeconds / 60)} min`], ['Endless best', `${p.endless.bestWave} shifts / ${p.endless.bestScore} pts`]];
  return (
    <div className="page">
      <h2>Statistics</h2>
      <div className="statgrid">{rows.map(([k, v]) => <div className="statcard" key={k}><span>{k}</span><b>{v}</b></div>)}</div>
      <h3>Recent shifts</h3>
      <div className="card tablecard"><table className="tbl"><thead><tr><th>#</th><th>Shift</th><th>Mode</th><th>Grade</th><th>Score</th><th>Resolved</th><th>Failed</th><th>Avg response</th><th>Net</th><th>XP</th></tr></thead>
        <tbody>{[...p.history].reverse().map((h, i) => <tr key={i}><td>{h.n}</td><td>{h.title}</td><td>{h.mode}</td><td><Grade g={h.grade} size={24} /></td><td>{h.score}</td><td>{h.resolved}</td><td>{h.failed}</td><td className="mono">{fmtEta(h.avgResponse)}</td><td className="mono">{fmtMoney(h.money)}</td><td>{h.xp}</td></tr>)}
          {!p.history.length && <tr><td colSpan={10} className="muted">No shifts played yet.</td></tr>}</tbody></table></div>
      {p.history.length > 1 && <Trend values={p.history.map((h) => h.score)} />}
    </div>
  );
}
function Trend({ values }: { values: number[] }) {
  const w = 600, h = 120, max = 100;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * (w - 20) + 10},${h - 10 - (v / max) * (h - 20)}`).join(' ');
  return <div className="card"><h3>Score trend</h3><svg viewBox={`0 0 ${w} ${h}`} className="trend" role="img" aria-label="Score trend"><polyline points={pts} fill="none" stroke="#4A9CD6" strokeWidth="2" />{values.map((v, i) => <circle key={i} cx={(i / Math.max(1, values.length - 1)) * (w - 20) + 10} cy={h - 10 - (v / max) * (h - 20)} r="3" fill="#4A9CD6" />)}</svg></div>;
}
void UNIT_TYPE_BY_ID;
