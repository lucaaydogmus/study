import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio/audioManager';
import { GameEngine, DIFFICULTY } from '../sim/engine';
import { temporarySetup } from '../sim/profile';
import { CHAPTERS, SCENARIOS, ALL_DISTRICTS, baseConfig } from '../sim/scenarios';
import { getCity } from '../sim/city';
import { WEATHER_LABEL } from '../sim/events';
import type { CityEventType, Difficulty, WeatherType } from '../sim/types';
import { saves, useApp } from '../store';
import { Badge, Btn, Confirm, DISCLAIMER, Grade, Icon, Toast, fmtMoney, weatherIcon } from './common';
import { MapView } from './MapView';
import { rankDef } from '../sim/progression';
import { CATEGORY_NAMES } from './report-helpers';
import { ExtrasList } from './Extras';
import { todayKey, dailyConfig } from '../sim/scenarios';

// ── Living backdrop: an autopiloted city behind the menu ─────────────────────
function useDemoEngine() {
  return useMemo(() => {
    const cfg = baseConfig({ title: 'Demo', briefing: '', durationSec: 99999, incidentRate: 1.6, seed: 31337, weather: 'clear', startHour: 18, ignoreGovernor: false, districts: ['downtown', 'oldtown', 'westres', 'riverside', 'financial', 'university', 'southside', 'industrial'] });
    const e = GameEngine.fromConfig(cfg, temporarySetup({ rank: 6 }));
    e.setSpeed(2);
    for (let i = 0; i < 160; i++) e.step(0.5);
    return e;
  }, []);
}
function autopilot(e: GameEngine) {
  const st = e.state;
  for (const c of Object.values(st.calls)) {
    if (c.state === 'ringing' && st.time - c.ringStart > 2) { e.answerCall(c.id); }
    else if (c.state === 'active') {
      const inc = st.incidents[c.incidentId];
      if (inc.reportedNode === null) { e.setIncidentLocation(inc.id, inc.nodeId, 'candidate'); }
      else if (st.time - (c.answeredAt ?? 0) > 6) e.endCall(c.id);
    }
  }
  for (const inc of Object.values(st.incidents)) {
    if (inc.reportedNode === null || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.hidden) continue;
    const covered = new Set(inc.assignedUnits.map((id) => st.units[id]?.capabilities).flat());
    for (const r of inc.requires) {
      if (covered.has(r.cap)) continue;
      const u = Object.values(st.units).filter((x) => x.status === 'AVAILABLE' && x.capabilities.includes(r.cap)).sort((a, b) => (e.estimate(a.id, inc.reportedNode!)?.eta ?? 1e9) - (e.estimate(b.id, inc.reportedNode!)?.eta ?? 1e9))[0];
      if (u) e.dispatch(u.id, inc.id);
    }
  }
}
export function DemoMap({ dim = true }: { dim?: boolean }) {
  const engine = useDemoEngine();
  useEffect(() => {
    let raf = 0, last = performance.now(), acc = 0;
    const loop = (now: number) => { raf = requestAnimationFrame(loop); const dt = (now - last) / 1000; last = now; engine.update(dt); acc += dt; if (acc > 1) { acc = 0; autopilot(engine); } if (engine.state.time > 1400 || engine.state.phase === 'ended') { engine.state.time = 0; } };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);
  return (
    <div className={`demo ${dim ? 'dim' : ''}`} aria-hidden="true">
      <MapView engine={engine} layer="normal" mode="select" selected={{ kind: null, id: null }} onSelect={() => undefined} reduceMotion={false} lockedLabel={false} />
    </div>
  );
}

export function MainMenu() {
  const { profile, saveList, hasShiftSnapshot, go, resumeShift } = useApp();
  const auto = saveList.find((s) => s.slot === 'auto');
  const loadSlot = useApp((s) => s.loadSlot);
  const startTutorial = useApp((s) => s.startTutorial);
  return (
    <div className="menu">
      <DemoMap />
      <div className="menu-panel">
        <div className="title"><span className="logo big">◉</span><div><h1>SIGNAL 911</h1><div className="sub">EMERGENCY DISPATCH SIMULATOR · RAVENPORT</div></div></div>
        <nav className="menu-list" aria-label="Main menu">
          {hasShiftSnapshot && <Btn kind="success" size="lg" icon="play" onClick={() => resumeShift()}>Resume interrupted shift</Btn>}
          {(profile || auto) && <Btn kind="primary" size="lg" icon="play" onClick={async () => { if (profile) go('hub'); else await loadSlot('auto'); }}>Continue career{profile ? ` — ${profile.name}` : auto ? ` — ${auto.name}` : ''}</Btn>}
          <Btn size="lg" kind={profile || auto ? 'default' : 'primary'} icon="plus" onClick={() => go('newCareer')}>New career</Btn>
          <Btn size="lg" icon="save" onClick={() => go('load')}>Load career</Btn>
          <Btn size="lg" icon="layers" onClick={() => go('modes')}>Game modes</Btn>
          <Btn size="lg" icon="book" onClick={() => startTutorial()}>Tutorial</Btn>
          <Btn size="lg" icon="gear" onClick={() => go('settings')}>Settings</Btn>
        </nav>
        <p className="disclaimer">{DISCLAIMER}</p>
      </div>
      <Toast />
    </div>
  );
}

export function NewCareer() {
  const { newCareer, goBack, startTutorial } = useApp();
  const [name, setName] = useState('');
  const [diff, setDiff] = useState<Difficulty>('standard');
  const [tut, setTut] = useState(true);
  return (
    <div className="screen">
      <header className="screen-head"><Btn kind="ghost" icon="chevL" onClick={goBack}>Back</Btn><h1>New career</h1></header>
      <div className="screen-body narrow">
        <div className="card">
          <p>You are a <b>Trainee Dispatcher</b> at Ravenport Emergency Dispatch with 12 vehicles, 4 core districts and a $250,000 budget. Earn experience, get promoted, and grow the service into a city-wide operation.</p>
          <div className="field"><label htmlFor="nm">Your name</label><input id="nm" value={name} placeholder="Dispatcher" maxLength={24} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>Default difficulty</label>
            <div className="seg">{(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => <button key={d} className={diff === d ? 'on' : ''} onClick={() => setDiff(d)}>{DIFFICULTY[d].label}</button>)}</div></div>
          <label className="toggle"><input type="checkbox" checked={tut} onChange={(e) => setTut(e.target.checked)} /><span className="tg" /><span><b>Play the tutorial first</b><span className="muted small block">About five minutes. Strongly recommended for new dispatchers.</span></span></label>
          <div className="row end"><Btn kind="primary" size="lg" icon="play" onClick={async () => { await newCareer(name.trim() || 'Dispatcher', diff); if (tut) startTutorial(); }}>Start career</Btn></div>
        </div>
      </div>
    </div>
  );
}

export function LoadScreen() {
  const { saveList, goBack, loadSlot, profile, saveSlot, refreshSaves } = useApp();
  const [del, setDel] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void refreshSaves(); }, []);
  const slots = ['auto', 'slot1', 'slot2', 'slot3'];
  const exportSave = async (slot: string) => { const env = await saves.load(slot); if (!env) return; const blob = new Blob([JSON.stringify(env)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `signal911-${slot}.json`; a.click(); };
  const importSave = async (f: File) => {
    try { const env = JSON.parse(await f.text()); if (!env.profile) throw new Error('not a save'); await saves.save('slot3', env.profile, env.settings ?? useApp.getState().settings, env.label); await refreshSaves(); useApp.getState().showToast('Imported into slot 3', 'good'); } catch { useApp.getState().showToast('That file is not a valid save', 'bad'); }
  };
  return (
    <div className="screen">
      <header className="screen-head"><Btn kind="ghost" icon="chevL" onClick={goBack}>Back</Btn><h1>Load career</h1></header>
      <div className="screen-body narrow">
        {slots.map((s) => {
          const m = saveList.find((x) => x.slot === s);
          return (
            <div className="card saveslot" key={s}>
              <div className="grow">
                <h3>{s === 'auto' ? 'Autosave' : `Slot ${s.slice(4)}`}</h3>
                {m ? <><div><b>{m.name}</b> · {rankDef(m.rank).title} · {fmtMoney(m.money)} · {m.shifts} shifts</div><div className="muted small">{new Date(m.savedAt).toLocaleString()}</div></> : <div className="muted">Empty</div>}
              </div>
              <div className="btnrow">
                {m && <Btn kind="primary" onClick={() => loadSlot(s)}>Load</Btn>}
                {profile && s !== 'auto' && <Btn onClick={() => saveSlot(s)}>Save here</Btn>}
                {m && <Btn size="sm" kind="ghost" onClick={() => exportSave(s)}>Export</Btn>}
                {m && <Btn size="sm" kind="ghost" icon="trash" onClick={() => setDel(s)} aria-label="Delete save" />}
              </div>
            </div>
          );
        })}
        <div className="row gap"><Btn icon="plus" onClick={() => file.current?.click()}>Import save file…</Btn><input ref={file} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSave(f); }} /></div>
      </div>
      {del && <Confirm title="Delete this save?" text="This cannot be undone." confirm="Delete" danger onYes={async () => { await saves.remove(del); setDel(null); await refreshSaves(); }} onNo={() => setDel(null)} />}
      <Toast />
    </div>
  );
}

export function ModeSelect() {
  const { go, profile, startTutorial, startDaily } = useApp();
  const key = todayKey();
  const today = profile?.daily?.[key];
  const cards: Array<{ t: string; d: string; icon: string; act: () => void; tag?: string }> = [
    { t: 'Career', d: 'Progress through seven ranks, run the campaign, build stations and grow your fleet.', icon: 'trophy', act: () => (profile ? go('hub') : go('newCareer')), tag: profile ? rankDef(profile.rank).title : 'New' },
    { t: 'Daily challenge', d: `Today’s shift (${key}) is the same for everyone: fixed weather, events, conditions and contracts. Beat your best score.`, icon: 'clock', act: () => startDaily(), tag: today ? `Best today: ${today.score} (${today.grade})` : 'New today' },
    { t: 'Free play', d: 'Configure budget, units, call frequency, weather, districts and events.', icon: 'gear', act: () => go('freeplay') },
    { t: 'Endless', d: 'Each shift is busier than the last. Survive as long as you can and chase a high score.', icon: 'bolt', act: () => go('endless'), tag: profile?.endless.bestScore ? `Best ${profile.endless.bestScore}` : undefined },
    { t: 'Scenarios', d: 'Handcrafted challenges: The Night Shift, Storm Warning, City Festival, Power Failure, Rush Hour.', icon: 'layers', act: () => go('scenarios') },
    { t: 'Tutorial', d: 'Six short lessons: answer, gather, dispatch, monitor, juggle, finish.', icon: 'book', act: () => startTutorial(), tag: profile?.flags.tutorialDone ? 'Completed' : undefined },
  ];
  return (
    <div className="screen">
      <header className="screen-head"><Btn kind="ghost" icon="chevL" onClick={() => go('menu')}>Menu</Btn><h1>Game modes</h1></header>
      <div className="screen-body">
        <div className="modegrid">{cards.map((c) => (
          <button className={`modecard ${c.t === 'Daily challenge' ? 'daily' : ''}`} key={c.t} onClick={() => { audio.unlock(); c.act(); }}>
            <Icon n={c.icon} size={26} /><h2>{c.t}</h2>{c.tag && <Badge tone="blue">{c.tag}</Badge>}<p>{c.d}</p>
          </button>))}</div>
      </div>
    </div>
  );
}

export function ScenarioScreen() {
  const { go, startScenario, profile } = useApp();
  return (
    <div className="screen">
      <header className="screen-head"><Btn kind="ghost" icon="chevL" onClick={() => go('modes')}>Back</Btn><h1>Scenarios</h1></header>
      <div className="screen-body">
        <div className="cardgrid wide">
          {SCENARIOS.map((s) => { const r = profile?.scenarios[s.id]; return (
            <div className="card scen" key={s.id} style={{ borderTopColor: s.accent }}>
              <h2>{s.title}</h2><div className="tagline">{s.tagline}</div><p className="muted">{s.description}</p>
              <div className="chips"><Badge>{s.minutes} min</Badge><Badge tone={s.difficulty === 'hard' ? 'amber' : 'blue'}>{DIFFICULTY[s.difficulty].label}</Badge>{s.reducedFleet && <Badge tone="red">Reduced staff</Badge>}</div>
              <div className="row gap center">{r ? <><Grade g={r.best} size={32} /><span className="muted small">best {r.bestScore} · {r.plays} plays</span></> : <span className="muted small">Not yet played</span>}<div className="grow" /><Btn kind="primary" icon="play" onClick={() => startScenario(s.id)}>Play</Btn></div>
            </div>); })}
        </div>
      </div>
    </div>
  );
}

export function FreePlayScreen() {
  const { go, startFree } = useApp();
  const [units, setUnits] = useState(12);
  const [budget, setBudget] = useState(200000);
  const [rate, setRate] = useState(1);
  const [unusual, setUnusual] = useState(1);
  const [diff, setDiff] = useState<Difficulty>('standard');
  const [mins, setMins] = useState(12);
  const [weather, setWeather] = useState<WeatherType>('clear');
  const [hour, setHour] = useState(12);
  const [districts, setDistricts] = useState<string[]>(ALL_DISTRICTS);
  const [events, setEvents] = useState<CityEventType[]>([]);
  const city = getCity();
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const evs: Array<[CityEventType, string]> = [['storm', 'Thunderstorm'], ['blackout', 'Blackout'], ['flood', 'Flooding'], ['festival', 'Festival'], ['rush_hour', 'Rush hour'], ['industrial_fire', 'Industrial fire'], ['winter_storm', 'Winter storm'], ['heat_wave', 'Heat wave']];
  return (
    <div className="screen">
      <header className="screen-head"><Btn kind="ghost" icon="chevL" onClick={() => go('modes')}>Back</Btn><h1>Free play</h1></header>
      <div className="screen-body">
        <div className="formgrid">
          <div className="card">
            <h3>Resources</h3>
            <label className="slider"><span>Emergency units</span><input type="range" min={6} max={24} value={units} onChange={(e) => setUnits(+e.target.value)} /><span className="mono">{units}</span></label>
            <label className="slider"><span>Starting budget</span><input type="range" min={50000} max={800000} step={25000} value={budget} onChange={(e) => setBudget(+e.target.value)} /><span className="mono">{fmtMoney(budget)}</span></label>
            <h3>Pressure</h3>
            <label className="slider"><span>Incident frequency</span><input type="range" min={0.4} max={2.2} step={0.1} value={rate} onChange={(e) => setRate(+e.target.value)} /><span className="mono">{rate.toFixed(1)}×</span></label>
            <label className="slider"><span>Unusual / prank calls</span><input type="range" min={0} max={4} step={0.25} value={unusual} onChange={(e) => setUnusual(+e.target.value)} /><span className="mono">{unusual.toFixed(2)}×</span></label>
            <div className="field"><label>Difficulty</label><div className="seg">{(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => <button key={d} className={diff === d ? 'on' : ''} onClick={() => setDiff(d)}>{DIFFICULTY[d].label}</button>)}</div></div>
            <label className="slider"><span>Shift duration</span><input type="range" min={5} max={30} step={1} value={mins} onChange={(e) => setMins(+e.target.value)} /><span className="mono">{mins} min</span></label>
          </div>
          <div className="card">
            <h3>Conditions</h3>
            <div className="field"><label>Weather</label><div className="seg wrap">{(Object.keys(WEATHER_LABEL) as WeatherType[]).map((w) => <button key={w} className={weather === w ? 'on' : ''} onClick={() => setWeather(w)}><Icon n={weatherIcon(w)} size={12} /> {WEATHER_LABEL[w]}</button>)}</div></div>
            <label className="slider"><span>Start time</span><input type="range" min={0} max={23} value={hour} onChange={(e) => setHour(+e.target.value)} /><span className="mono">{String(hour).padStart(2, '0')}:00</span></label>
            <div className="field"><label>Citywide events</label><div className="seg wrap">{evs.map(([t, l]) => <button key={t} className={events.includes(t) ? 'on' : ''} onClick={() => setEvents(toggle(events, t))}>{l}</button>)}</div></div>
            <div className="field"><label>Districts in play ({districts.length})</label>
              <div className="seg wrap">{city.districts.map((d) => <button key={d.id} className={districts.includes(d.id) ? 'on' : ''} onClick={() => setDistricts(districts.length > 1 || !districts.includes(d.id) ? toggle(districts, d.id) : districts)}>{d.name}</button>)}</div></div>
          </div>
        </div>
        <div className="row end"><Btn kind="primary" size="lg" icon="play" onClick={() => startFree(baseConfig({ mode: 'free', title: 'Free play', briefing: 'A shift built to your settings.', difficulty: diff, durationSec: mins * 60, incidentRate: rate, unusualBias: unusual, weather, startHour: hour, districts, startBudget: budget, events: events.map((t, i) => ({ type: t, at: 60 + i * 80, duration: Math.max(180, mins * 60 - 120 - i * 80) })), objectives: [] }), { units, budget, rank: 7 })}>Continue to briefing</Btn></div>
      </div>
    </div>
  );
}

export function EndlessScreen() {
  const { go, profile, startEndless } = useApp();
  const e = profile?.endless;
  return (
    <div className="screen">
      <header className="screen-head"><Btn kind="ghost" icon="chevL" onClick={() => go('modes')}>Back</Btn><h1>Endless mode</h1></header>
      <div className="screen-body narrow">
        <div className="card"><p>Shifts of eight minutes with a steadily rising call rate, harsher weather and citywide events. Finish a shift with a <b>C or better and fewer than three casualties</b> to survive into the next one. Your score is the sum of every shift’s performance score.</p>
          <div className="statgrid"><div className="statcard"><span>Best run</span><b>{e?.bestWave ?? 0} shifts</b></div><div className="statcard"><span>High score</span><b>{e?.bestScore ?? 0}</b></div>{e?.current.active && <div className="statcard"><span>Current run</span><b>{e.current.wave} shifts · {e.current.score} pts</b></div>}</div>
          <div className="row gap end">{e?.current.active && <Btn kind="primary" size="lg" icon="play" onClick={() => startEndless(false)}>Continue run (shift {e.current.wave + 1})</Btn>}<Btn size="lg" kind={e?.current.active ? 'default' : 'primary'} icon="plus" onClick={() => startEndless(true)}>New run</Btn></div>
        </div>
      </div>
    </div>
  );
}

export function BriefingScreen() {
  const { pending, go, beginPending, setPending } = useApp();
  if (!pending) { return <div className="screen"><Btn onClick={() => go('menu')}>Back</Btn></div>; }
  const c = pending.config;
  const city = getCity();
  const engine = useMemo(() => { const e = GameEngine.fromConfig(c, temporarySetup({ ...pending.setupOpts, rank: c.mode === 'tutorial' ? 1 : pending.setupOpts?.rank ?? 7 })); e.state.paused = true; return e; }, [pending]);
  return (
    <div className="screen">
      <header className="screen-head"><Btn kind="ghost" icon="chevL" onClick={() => { setPending(null); useApp.getState().goBack(); }}>Back</Btn><h1>Briefing — {c.title}</h1></header>
      <div className="screen-body">
        <div className="hub-split">
          <div className="hub-map"><MapView engine={engine} layer="coverage" mode="select" selected={{ kind: null, id: null }} onSelect={() => undefined} showIncidents={false} /><div className="maphint">Opening coverage with your starting fleet.</div></div>
          <div className="hub-side">
            <div className="card brief"><h3>Situation</h3><p>{c.briefing}</p>
              <div className="kv"><span>Difficulty</span><b>{DIFFICULTY[c.difficulty].label}</b></div><div className="kv"><span>Length</span><b>{Math.round(c.durationSec / 60)} min</b></div>
              <div className="kv"><span>Weather</span><b><Icon n={weatherIcon(c.weather)} size={13} /> {WEATHER_LABEL[c.weather]}</b></div>
              <div className="kv"><span>Starts</span><b className="mono">{String(Math.floor(c.startHour)).padStart(2, '0')}:00</b></div>
              <div className="kv"><span>Districts</span><b>{c.districts.length} / 12</b></div>
              <div className="kv"><span>Units</span><b>{Object.keys(engine.state.units).length}</b></div>
              {c.events.length > 0 && <div className="note-line warn"><Icon n="alert" size={12} /> Expect: {c.events.map((e) => e.type.replace('_', ' ')).join(', ')}</div>}
              <ExtrasList config={c} />
              {c.objectives.length > 0 && <><h4>Objectives</h4><ul className="objs">{c.objectives.map((o) => <li key={o.id}><Icon n="chevR" size={11} /> {o.text}{o.optional ? ' (optional)' : ''}</li>)}</ul></>}
              <div className="btnrow col"><Btn kind="primary" size="lg" icon="play" onClick={() => { audio.unlock(); beginPending(); }}>BEGIN SHIFT</Btn></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
void CHAPTERS; void CATEGORY_NAMES;
