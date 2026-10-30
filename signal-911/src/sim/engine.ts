// The authoritative game engine: a deterministic, tick-based simulation of Ravenport dispatch.
// The UI only reads `engine.state` and calls the public action methods; the caller dialogue
// layer (dialogue.ts) can never mutate protected state directly — it only returns lines that the
// engine validates and applies.
import { addressOf, fullAddress, getCity, type City } from './city';
import { Rng } from './rng';
import { ARCHETYPES, CLASSES, CLASS_BY_ID, FACT_LABELS, adaptReqForRank, CAP_LABEL } from './content/vocab';
import { TEMPLATES, TEMPLATE_BY_ID, type Template } from './content/templates';
import { aliLookup, classifyIntent, makeCallerProfile, makeLocPlan, makeVars, fill, openingLines, replyTo, spontaneous, verifyReply, QUICK_QUESTIONS, type DialogueEnv, type Intent } from './dialogue';
import { EVENT_DEFS, WEATHER_SPEED, WEATHER_TRAFFIC, WEATHER_LABEL, nextWeather } from './events';
import { numWord, UNIT_TYPE_BY_ID, makeUnit } from './fleet';
import { edgeSpeed, findRoute, makeClosedMask, multiSourceTimes, routeTime, TIME_COMPRESS, type TrafficModel } from './routing';
import { computeScore, evaluateObjectives } from './scoring';
import { modProduct, MODIFIER_BY_ID } from './extras';
import type {
  Call, CallerProfile, CityEvent, CityState, Capability, Fact, FactVal, GameState, HeardLocation, Incident, IncidentStatus, Outcome, Personnel, Req,
  Service, ShiftConfig, ShiftStats, Station, Unit, UpgradeLevels, TimelineEntry,
} from './types';

export const DT = 0.5;
export const STATE_VERSION = 1;
/** global pacing knob: scales how quickly unattended incidents deteriorate */
export const THREAT_SCALE = 0.55;

export const DIFFICULTY = {
  casual: { rate: 0.7, ring: 55, coop: 8, esc: 0.8, wrong: 0.4, label: 'Casual' },
  standard: { rate: 1, ring: 42, coop: 0, esc: 1, wrong: 1, label: 'Standard' },
  hard: { rate: 1.25, ring: 34, coop: -6, esc: 1.15, wrong: 1.3, label: 'Hard' },
  expert: { rate: 1.5, ring: 28, coop: -10, esc: 1.3, wrong: 1.6, label: 'Expert' },
} as const;

export interface ShiftSetup { rank: number; reputation: number; budget: number; stations: Station[]; units: Unit[]; personnel: Personnel[]; upgrades: UpgradeLevels; city: CityState }

export type EngineEvent =
  | { type: 'ring'; callId: string } | { type: 'answer'; callId: string } | { type: 'hangup'; callId: string } | { type: 'caller_line'; callId: string }
  | { type: 'radio'; unitId?: string } | { type: 'dispatch'; unitId: string } | { type: 'arrive'; unitId: string } | { type: 'alert'; text: string }
  | { type: 'resolved'; incidentId: string } | { type: 'failed'; incidentId: string } | { type: 'notify'; level: string } | { type: 'ended' } | { type: 'status'; unitId: string };

const emptyStats = (): ShiftStats => ({
  callsReceived: 0, callsAnswered: 0, callsMissed: 0, answerTimes: [], responseTimes: [], resolved: 0, failed: 0, falseAlarms: 0, mishandled: 0,
  casualties: 0, livesHelped: 0, unnecessary: 0, dispatches: 0, correctDispatches: 0, wrongLocations: 0, locationChecks: 0, costs: 0, income: 0, bonus: 0,
  coverageSamples: { police: [], fire: [], medical: [] }, districtCoverage: {}, serviceResponse: { police: [], fire: [], medical: [] },
  unitBusySeconds: 0, unitSeconds: 0, handedOver: 0, byCategory: {}, callbacks: 0, escalations: 0, promisesBroken: 0,
  merges: 0, wrongLinks: 0, pursuitsCaught: 0, verifiedOk: 0, cleanFalseAlarms: 0, bestStreak: 0, calmedCallers: 0, transfersOk: 0, mutualAid: 0, contractBonus: 0,
});

export function createShiftState(config: ShiftConfig, setup: ShiftSetup): GameState {
  const city = getCity();
  const units: Record<string, Unit> = {};
  for (const u of setup.units) units[u.id] = JSON.parse(JSON.stringify(u));
  const stations: Record<string, Station> = {};
  for (const s of setup.stations) stations[s.id] = { ...s };
  const personnel: Record<string, Personnel> = {};
  for (const p of setup.personnel) personnel[p.id] = { ...p };
  const closed: number[] = setup.city.closedRoads.filter((r) => r.shifts > 0).map((r) => r.edge);
  const rng = new Rng(config.seed);
  const districtTraffic: Record<string, number> = {};
  for (const d of city.districts) districtTraffic[d.id] = d.baseTraffic;
  const st: GameState = {
    version: STATE_VERSION, seed: config.seed, rngState: rng.state, config, time: 0, speed: 1, paused: false, phase: 'running',
    weather: config.weather, weatherIntensity: config.weather === 'clear' ? 0 : 0.7, nextWeatherChange: 150 + rng.range(0, 120), timeOfDay: config.startHour,
    units, stations, personnel, incidents: {}, calls: {}, activeCallId: null, incidentCounter: 0, callCounter: 0,
    events: [], closedEdges: closed, districtTraffic, radio: [], timeline: [], notifications: [],
    stats: emptyStats(), upgrades: { ...setup.upgrades }, rank: setup.rank, reputation: setup.reputation, budget: setup.budget,
    nextSpawnAt: config.script ? Infinity : rng.range(5, 9), spawnedScripted: 0, scriptIndex: 0,
    selected: { kind: null, id: null }, flags: {}, dispatcherLoad: 0, assistantFreeAt: 0, lastCoverage: 0, uniqueNameCounter: 0, endingAt: null,
    streak: 0, fx: [], fxCounter: 0, closedHospitals: [],
  };
  // persistent consequences: stations that are damaged keep their units out of service
  for (const sid of Object.keys(setup.city.damagedStations)) {
    const stn = stations[sid];
    if (stn && setup.city.damagedStations[sid] > 0) {
      stn.disabledShifts = setup.city.damagedStations[sid];
      for (const u of Object.values(units)) if (u.stationId === sid) { u.status = 'OUT_OF_SERVICE'; u.note = 'Station damaged'; u.timer = 0; }
    }
  }
  // districts with lingering congestion
  for (const k of Object.keys(setup.city.districtTraffic)) st.districtTraffic[k] = Math.min(1, (st.districtTraffic[k] ?? 0.3) + setup.city.districtTraffic[k]);
  return st;
}

export function checkCrew(state: GameState, u: Unit): boolean {
  const n = u.personnelIds.filter((id) => state.personnel[id]).length;
  return n >= u.minCrew;
}

// ── Pure helpers ────────────────────────────────────────────────────────────
export function matchCoverage(reqs: Req[], units: Unit[]): { f: number; used: Set<string>; missing: Req[] } {
  const used = new Set<string>();
  let total = 0, got = 0;
  const missing: Req[] = [];
  for (const req of reqs) {
    const cands = units.filter((u) => u.capabilities.includes(req.cap)).sort((a, b) => a.capabilities.length - b.capabilities.length);
    const have = Math.min(req.n, cands.length);
    for (let i = 0; i < have; i++) used.add(cands[i].id);
    total += req.n; got += have;
    if (have < req.n) missing.push({ cap: req.cap, n: req.n - have });
  }
  return { f: total ? got / total : 1, used, missing };
}
export function mergeReqs(a: Req[], b: Req[]): Req[] {
  const m = new Map<Capability, number>();
  for (const r of [...a, ...b]) m.set(r.cap, Math.max(m.get(r.cap) ?? 0, r.n));
  return [...m.entries()].map(([cap, n]) => ({ cap, n }));
}
export function reqText(reqs: Req[]): string {
  return reqs.map((r) => (r.n > 1 ? `${r.n}× ` : '') + CAP_LABEL[r.cap]).join(', ') || 'none';
}
const fmtClock = (hour: number) => {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor((((h - hh) * 60) - mm) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};
export const gameClock = (st: GameState, t = st.time) => fmtClock(st.config.startHour + t / 3600);

export function suggestClass(inc: Incident): string {
  const tpl = TEMPLATE_BY_ID[inc.templateId];
  const f: Record<string, FactVal> = {};
  for (const x of inc.facts) if (x.confidence !== 'contradicted') f[x.key] = x.value;
  if (inc.twistRevealed && inc.twist?.hint) return inc.twist.hint;
  if (f.false_alarm === true) return 'no_response';
  if (f.conscious === false || f.breathing === false) return 'medical_critical';
  if (f.weapon) return 'crime_progress';
  if (f.water) return 'water';
  if (f.fire === true || (f.smoke === true && !(typeof f.vehicles === 'number' && f.vehicles > 0))) return tpl.hint === 'fire_other' ? 'fire_other' : 'fire_structure';
  if (typeof f.hazard === 'string' && /gas/.test(f.hazard)) return 'hazmat';
  if (typeof f.trapped === 'number' && f.trapped > 0 && tpl.hint !== 'collision') return tpl.hint === 'collision' ? 'collision' : 'rescue';
  return tpl.hint ?? 'unknown';
}

export function recommendFor(inc: Incident, rank = 7): Req[] {
  const cls = inc.classification ?? suggestClass(inc);
  const def = CLASS_BY_ID[cls] ?? CLASS_BY_ID.unknown;
  let rec: Req[] = def.rec.map((r) => ({ ...r }));
  const f: Record<string, FactVal> = {};
  for (const x of inc.facts) if (x.confidence !== 'contradicted') f[x.key] = x.value;
  const add = (cap: Capability, n = 1) => { rec = mergeReqs(rec, [{ cap, n }]); };
  if (typeof f.injured === 'number' && f.injured > 0 && !rec.some((r) => r.cap === 'bls' || r.cap === 'als')) { add('bls'); add('transport'); }
  if (f.conscious === false || f.breathing === false || f.breathing === 'labored') { rec = rec.filter((r) => r.cap !== 'bls'); add('als'); add('transport'); }
  if ((f.fire === true || f.smoke === true) && !rec.some((r) => r.cap === 'fire_suppression')) add('fire_suppression');
  if (typeof f.trapped === 'number' && f.trapped > 0 && !rec.some((r) => r.cap === 'rescue')) add('rescue');
  if ((f.suspect === true || f.weapon) && !rec.some((r) => r.cap === 'patrol')) add('patrol');
  if (typeof f.vehicles === 'number' && f.vehicles > 0 && !rec.some((r) => r.cap === 'patrol')) add('patrol');
  if (f.water) add('water_rescue');
  if (inc.knownReqs.length) return inc.knownReqs;
  return rec.map((r) => adaptReqForRank(r, rank));
}

// ── Engine ──────────────────────────────────────────────────────────────────
type Listener = (e: EngineEvent) => void;

export class GameEngine {
  state: GameState;
  city: City;
  rng: Rng;
  private acc = 0;
  private listeners: Listener[] = [];
  private closedMask: Uint8Array;
  private covCache: Partial<Record<Service, { t: number; times: Float32Array }>> = {};
  private etaCache = new Map<string, { t: number; v: { eta: number; dist: number } | null }>();
  private lastTrafficUpdate = -99;
  private lastReroute = 0;
  private lastSample = 0;
  private recentTemplates: string[] = [];
  private tickSecond = 0;

  constructor(state: GameState) {
    this.state = state;
    // tolerate snapshots from older versions
    state.fx ??= []; state.streak ??= 0; state.fxCounter ??= 0; state.closedHospitals ??= [];
    const base = emptyStats() as unknown as Record<string, unknown>;
    for (const k of Object.keys(base)) if ((state.stats as unknown as Record<string, unknown>)[k] === undefined) (state.stats as unknown as Record<string, unknown>)[k] = base[k];
    for (const inc of Object.values(state.incidents)) { inc.dupPlan ??= []; inc.duplicateOf ??= null; inc.pursuit ??= false; inc.mover ??= null; inc.mergedInto ??= null; }
    this.city = getCity();
    this.rng = new Rng(state.rngState);
    this.closedMask = makeClosedMask(this.city, state.closedEdges);
    this.updateTraffic(true);
    this.refreshOutOfService();
  }

  static fromConfig(config: ShiftConfig, setup: ShiftSetup): GameEngine {
    const e = new GameEngine(createShiftState(config, setup));
    e.log('info', `Shift started — ${config.title}`);
    e.applyModifiers();
    e.sampleCoverage();
    e.scheduleEvents();
    return e;
  }

  on(l: Listener): () => void { this.listeners.push(l); return () => { this.listeners = this.listeners.filter((x) => x !== l); }; }
  emit(e: EngineEvent) { for (const l of this.listeners) l(e); }

  serialize(): GameState { this.state.rngState = this.rng.state; return JSON.parse(JSON.stringify(this.state)); }

  // ── logging helpers ───────────────────────────────────────────────────────
  log(kind: TimelineEntry['kind'], text: string, extra: Partial<TimelineEntry> = {}) {
    this.state.timeline.push({ t: this.state.time, kind, text, ...extra });
    if (this.state.timeline.length > 600) this.state.timeline.shift();
  }
  notify(text: string, level: 'info' | 'good' | 'warn' | 'bad' = 'info', incidentId?: string) {
    const st = this.state;
    st.notifications.push({ id: `n${st.notifications.length}-${Math.floor(st.time)}`, t: st.time, text, level, incidentId });
    if (st.notifications.length > 80) st.notifications.shift();
    this.emit({ type: 'notify', level });
  }
  radio(from: string, text: string, kind: 'unit' | 'dispatch' | 'alert' = 'unit', unitId?: string, incidentId?: string) {
    const st = this.state;
    st.radio.push({ id: `r${st.radio.length}-${Math.floor(st.time * 10)}`, t: st.time, clock: gameClock(st), from, text, unitId, incidentId, kind });
    if (st.radio.length > 250) st.radio.shift();
    this.emit({ type: 'radio', unitId });
  }

  /** floating map feedback (score popups etc.) */
  fx(kind: 'good' | 'bad' | 'warn' | 'info', nodeId: number, text: string) {
    const st = this.state;
    const n = this.city.nodes[nodeId];
    if (!n) return;
    st.fx.push({ id: ++st.fxCounter, t: st.time, kind, x: n.x, y: n.y, text });
    if (st.fx.length > 40) st.fx.shift();
  }

  private applyModifiers() {
    const st = this.state;
    for (const id of st.config.modifiers ?? []) {
      const m = MODIFIER_BY_ID[id];
      if (!m) continue;
      if (m.oos) {
        const pool = this.rng.shuffle(Object.values(st.units).filter((u) => u.status === 'AVAILABLE' && !u.temp));
        // never take out a service's last unit
        let taken = 0;
        for (const u of pool) {
          if (taken >= m.oos) break;
          if (Object.values(st.units).filter((x) => x.service === u.service && x.status === 'AVAILABLE').length <= 1) continue;
          u.status = 'OUT_OF_SERVICE'; u.note = 'Crew shortage'; u.timer = 240; taken++;
        }
      }
      if (m.fresh) for (const p of Object.values(st.personnel)) { p.fatigue = 0; p.morale = Math.min(100, p.morale + 10); }
      if (m.roadworks) {
        const cands = this.city.edges.filter((e) => e.cls === 'local' && st.config.districts.includes(this.city.nodes[e.a].district) && !st.closedEdges.includes(e.id));
        for (let i = 0; i < m.roadworks && cands.length; i++) st.closedEdges.push(this.rng.pick(cands).id);
        this.closedMask = makeClosedMask(this.city, st.closedEdges);
      }
      if (m.closeHospital && this.city.hospitals.length > 1) {
        const open = this.city.hospitals.filter((h) => st.config.districts.includes(this.city.nodes[h].district));
        st.closedHospitals = [this.rng.pick(open.length > 1 ? open : this.city.hospitals)];
      }
      this.notify(`Shift condition: ${m.name} — ${m.desc}`, m.tone === 'good' ? 'good' : m.tone === 'bad' ? 'warn' : 'info');
    }
  }

  // ── main loop ─────────────────────────────────────────────────────────────
  setSpeed(s: number) { this.state.speed = s; this.state.paused = s === 0; }
  togglePause() { this.state.paused = !this.state.paused; }

  update(realDt: number) {
    const st = this.state;
    if (st.phase !== 'running' || st.paused) return;
    this.acc += Math.min(0.25, realDt) * st.speed;
    let guard = 0;
    while (this.acc >= DT && guard++ < 40 && st.phase === 'running') { this.acc -= DT; this.step(DT); }
  }

  step(dt: number) {
    const st = this.state;
    st.time += dt;
    st.timeOfDay = st.config.startHour + st.time / 3600;
    this.tickSecond += dt;
    if (this.tickSecond >= 1) { this.tickSecond -= 1; this.everySecond(); }
    this.updateUnits(dt);
    this.updateIncidents(dt);
    this.updateCalls(dt);
    if (st.time - this.lastReroute > 10) { this.lastReroute = st.time; this.rerouteAll(); }
    if (st.time - this.lastSample > 10) { this.lastSample = st.time; this.sampleCoverage(); }
    this.checkEnd();
  }

  private everySecond() {
    const st = this.state;
    this.processScript();
    this.updateEvents();
    this.updateWeather();
    if (st.time - this.lastTrafficUpdate >= 4) this.updateTraffic();
    this.spawnTick();
    this.updateCallbacks();
    this.updatePersonnel();
    this.updateWorkload();
    this.spawnDuplicates();
  }

  // ── Weather, events, traffic ──────────────────────────────────────────────
  private updateWeather() {
    const st = this.state;
    const ev = st.events.find((e) => e.active && EVENT_DEFS[e.type].weather);
    if (ev) {
      const w = EVENT_DEFS[ev.type].weather!;
      if (st.weather !== w) { st.weather = w; this.notify(`Weather: ${WEATHER_LABEL[w]}`, 'warn'); }
      st.weatherIntensity = Math.min(1, st.weatherIntensity + 0.02);
      return;
    }
    if (st.time >= st.nextWeatherChange && !st.config.events.length) {
      const nw = nextWeather(st.weather, this.rng.next(), st.timeOfDay);
      if (nw !== st.weather) { st.weather = nw; st.weatherIntensity = 0.4; this.notify(`Weather change: ${WEATHER_LABEL[nw]}`, 'info'); }
      st.nextWeatherChange = st.time + 150 + this.rng.range(0, 150);
    }
    if (st.weather === 'clear') st.weatherIntensity = Math.max(0, st.weatherIntensity - 0.02);
    else st.weatherIntensity = Math.min(1, st.weatherIntensity + 0.01);
  }

  private scheduleEvents() { /* events are activated in updateEvents by config times */ }

  private updateEvents() {
    const st = this.state;
    for (const c of st.config.events) {
      const id = `${c.type}@${c.at}`;
      let ev = st.events.find((e) => e.id === id);
      if (!ev && st.time >= c.at - 20) {
        const def = EVENT_DEFS[c.type];
        const districts = c.districts ?? this.defaultEventDistricts(c.type);
        const eff = def.make(districts);
        ev = { id, type: c.type, name: def.name, start: c.at, end: c.at + c.duration, districts, ...eff, closedEdges: [], announced: false, active: false, description: def.description };
        st.events.push(ev);
      }
      if (!ev) continue;
      if (!ev.announced && st.time >= ev.start - 20) {
        ev.announced = true;
        this.notify(`Advisory: ${ev.name} expected shortly — ${ev.description}`, 'warn');
        this.log('event', `Advisory issued: ${ev.name}`);
      }
      if (!ev.active && st.time >= ev.start && st.time < ev.end) {
        ev.active = true;
        this.notify(`${ev.name} is now in effect`, 'bad');
        this.radio('DISPATCH', `All units, ${ev.name} now in effect. Expect elevated call volume.`, 'alert');
        this.log('event', `${ev.name} began`);
        this.emit({ type: 'alert', text: ev.name });
        this.applyEventStart(ev);
      } else if (ev.active && st.time >= ev.end) {
        ev.active = false;
        this.notify(`${ev.name} has eased`, 'good');
        this.log('event', `${ev.name} ended`);
        this.removeEventClosures(ev);
      }
    }
  }
  private defaultEventDistricts(t: CityEvent['type']): string[] {
    const all = this.state.config.districts;
    const pick = (ids: string[]) => ids.filter((i) => all.includes(i));
    switch (t) {
      case 'festival': return pick(['downtown', 'oldtown']);
      case 'flood': return pick(['riverside', 'southside', 'harbor', 'industrial']);
      case 'industrial_fire': return pick(['industrial', 'harbor']);
      case 'blackout': return all.slice(0, Math.max(3, Math.ceil(all.length * 0.6)));
      default: return all;
    }
  }
  private applyEventStart(ev: CityEvent) {
    const st = this.state;
    const closable = this.city.edges.filter((e) => e.cls !== 'highway' && ev.districts.includes(this.city.nodes[e.a].district) && e.cls !== 'bridge');
    const nClose = ev.type === 'storm' ? 3 : ev.type === 'winter_storm' ? 3 : ev.type === 'flood' ? 4 : 0;
    for (let i = 0; i < nClose && closable.length; i++) { const e = this.rng.pick(closable); if (!ev.closedEdges.includes(e.id)) { ev.closedEdges.push(e.id); st.closedEdges.push(e.id); } }
    if (ev.type === 'flood') {
      const bridges = this.city.edges.filter((e) => e.cls === 'bridge' && this.city.nodes[e.a].i !== 20);
      if (bridges.length) { const b = this.rng.pick(bridges); ev.closedEdges.push(b.id); st.closedEdges.push(b.id); this.notify('A river bridge has been closed by rising water', 'warn'); }
    }
    if (ev.closedEdges.length) { this.closedMask = makeClosedMask(this.city, st.closedEdges); this.notify(`${ev.closedEdges.length} road(s) closed — routes will adapt`, 'warn'); this.rerouteAll(true); }
    if (ev.type === 'industrial_fire' && st.config.districts.includes('industrial')) this.spawnIncident('warehouse_smoke', 'industrial', { severity: 4, forceEvent: ev.id });
  }
  private removeEventClosures(ev: CityEvent) {
    const st = this.state;
    st.closedEdges = st.closedEdges.filter((e) => !ev.closedEdges.includes(e) || st.config.mode === 'career' && false);
    this.closedMask = makeClosedMask(this.city, st.closedEdges);
  }
  private eventMult(cat: string, tplId: string, district: string): number {
    let m = 1;
    for (const ev of this.state.events) {
      if (!ev.active) continue;
      const here = ev.districts.includes(district) ? 1 : 0.55;
      m *= 1 + (ev.incidentMult - 1) * here;
      m *= (ev.categoryBias as Record<string, number>)[cat] ?? 1;
      m *= ev.templateBias[tplId] ? 1 + (ev.templateBias[tplId] - 1) * here : 1;
    }
    return m;
  }

  private updateTraffic(force = false) {
    const st = this.state;
    this.lastTrafficUpdate = st.time;
    const hour = ((st.timeOfDay % 24) + 24) % 24;
    const tf = hour >= 7 && hour < 9.5 ? 1.5 : hour >= 16 && hour < 19 ? 1.55 : hour >= 22 || hour < 5 ? 0.35 : hour < 7 ? 0.5 : 1;
    for (const d of this.city.districts) {
      let v = d.baseTraffic * tf + WEATHER_TRAFFIC[st.weather] * st.weatherIntensity;
      for (const ev of st.events) {
        if (!ev.active) continue;
        const here = ev.districts.includes(d.id);
        v *= 1 + (ev.trafficMult - 1) * (here ? 1 : 0.5);
        if (ev.type === 'blackout' && here) v += 0.25;
        if (ev.type === 'festival' && here) v += 0.2;
      }
      // open incidents add congestion at their district
      const blockers = Object.values(st.incidents).filter((i) => i.district === d.id && i.blockedEdge !== null && i.status !== 'RESOLVED' && i.status !== 'CLOSED').length;
      v += blockers * 0.08;
      v = Math.max(0.05, Math.min(0.92, v));
      const cur = st.districtTraffic[d.id] ?? v;
      st.districtTraffic[d.id] = force ? v : cur + (v - cur) * 0.35;
    }
  }

  tm(siren: boolean): TrafficModel {
    const st = this.state;
    return { district: st.districtTraffic, weatherMult: WEATHER_SPEED[st.weather] * (1 - 0.05 * st.weatherIntensity), closed: this.closedMask, preempt: (st.upgrades.preempt ?? 0) / 3, siren };
  }

  // ── Personnel / unit effectiveness ────────────────────────────────────────
  crewOf(u: Unit): Personnel[] { return u.personnelIds.map((id) => this.state.personnel[id]).filter(Boolean); }
  unitSpeedFactor(u: Unit): number {
    const crew = this.crewOf(u);
    const drive = crew.length ? crew.reduce((s, p) => s + p.driving, 0) / crew.length : 50;
    const fat = crew.length ? crew.reduce((s, p) => s + p.fatigue, 0) / crew.length : 0;
    return u.speedModifier * Math.max(0.86, Math.min(1.14, drive / 68)) * (1 - Math.max(0, fat - 60) / 400);
  }
  unitEffectiveness(u: Unit): number {
    const crew = this.crewOf(u);
    if (!crew.length) return 0.4;
    const avg = (f: (p: Personnel) => number) => crew.reduce((s, p) => s + f(p), 0) / crew.length;
    const skill = avg((p) => (u.service === 'medical' ? p.medical : u.service === 'fire' ? p.fire : p.policing));
    const eff = 0.55 * (skill / 65) + 0.25 * (avg((p) => p.training) / 65) + 0.2 * (avg((p) => p.experience) / 65);
    const fatigue = 1 - Math.max(0, avg((p) => p.fatigue) - 45) / 160;
    const morale = 0.92 + (avg((p) => p.morale) / 100) * 0.16;
    const up = this.state.upgrades;
    const equip = 1 + 0.12 * (u.service === 'medical' ? up.medkit ?? 0 : u.service === 'fire' ? up.firegear ?? 0 : up.policegear ?? 0);
    const seatFactor = Math.sqrt(Math.min(1, crew.length / u.crewSeats));
    return Math.max(0.35, Math.min(2.2, eff * fatigue * morale * equip * seatFactor * modProduct(this.state.config, 'eff')));
  }
  private updatePersonnel() {
    const st = this.state;
    const barracks = st.upgrades.barracks ?? 0;
    for (const u of Object.values(st.units)) {
      const working = u.status === 'ON_SCENE' || u.status === 'EN_ROUTE' || u.status === 'TRANSPORTING' || u.status === 'DISPATCHED';
      for (const p of this.crewOf(u)) {
        if (working) p.fatigue = Math.min(100, p.fatigue + 0.6 * (1 - 0.2 * barracks));
        else p.fatigue = Math.max(0, p.fatigue - (u.status === 'AVAILABLE' ? 0.35 : 0.15) * (1 + 0.3 * barracks));
      }
      if (u.status === 'AVAILABLE' && !checkCrew(st, u)) { u.status = 'OUT_OF_SERVICE'; u.note = 'Understaffed'; }
      if (u.status === 'OUT_OF_SERVICE' && u.note === 'Understaffed' && checkCrew(st, u)) { u.status = 'AVAILABLE'; u.note = undefined; }
    }
  }
  private refreshOutOfService() {
    for (const u of Object.values(this.state.units)) if (u.status === 'AVAILABLE' && !checkCrew(this.state, u)) { u.status = 'OUT_OF_SERVICE'; u.note = 'Understaffed'; }
  }
  private updateWorkload() {
    const st = this.state;
    const open = Object.values(st.incidents).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status) && !i.hidden).length;
    const calls = Object.values(st.calls).filter((c) => c.state === 'ringing' || c.state === 'hold' || c.state === 'active').length;
    st.dispatcherLoad = Math.min(1, (open * 0.12 + calls * 0.2));
  }

  // ── Spawning ──────────────────────────────────────────────────────────────
  private processScript() {
    const st = this.state;
    const sc = st.config.script;
    if (!sc) return;
    while (st.scriptIndex < sc.length && st.time >= sc[st.scriptIndex].at) {
      const s = sc[st.scriptIndex++];
      this.spawnIncident(s.template, s.district ?? 'downtown', { archetype: s.archetype, accuracy: s.accuracy, tutorial: true });
    }
  }

  private spawnTick() {
    const st = this.state;
    const cfg = st.config;
    if (cfg.script) return;
    if (st.time < st.nextSpawnAt) return;
    if (st.time > (cfg.noSpawnAfterSec ?? cfg.durationSec - 25)) { st.nextSpawnAt = Infinity; return; }
    // governor
    const inService = Object.values(st.units).filter((u) => u.status !== 'OUT_OF_SERVICE').length;
    const open = Object.values(st.incidents).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status) && !i.hidden).length;
    const ringing = Object.values(st.calls).filter((c) => c.state === 'ringing').length;
    const hold = Object.values(st.calls).filter((c) => c.state === 'hold').length;
    const cap = Math.max(2, Math.min(14, Math.round(inService * 0.62) + 1 + (st.rank >= 4 ? 1 : 0)));
    if (!cfg.ignoreGovernor && (open + ringing >= cap || ringing + hold >= 4)) { st.nextSpawnAt = st.time + 6; return; }
    // pick template + district
    const choice = this.pickIncident();
    if (choice) this.spawnIncident(choice.tpl.id, choice.district);
    // schedule next
    const diff = DIFFICULTY[cfg.difficulty];
    const ramp = Math.max(0.4, Math.min(1.45, 0.45 + 1.15 * (st.time / cfg.durationSec)));
    let evM = 1;
    for (const e of st.events) if (e.active) evM *= e.incidentMult;
    const perMin = 0.92 * diff.rate * cfg.incidentRate * ramp * evM * (1 + (cfg.endlessWave ?? 0) * 0.06) * modProduct(cfg, 'rate');
    const mean = 60 / perMin;
    st.nextSpawnAt = st.time + Math.max(4, -Math.log(1 - this.rng.next() * 0.98) * mean * 0.7 + mean * 0.35);
  }

  pickIncident(): { tpl: Template; district: string } | null {
    const st = this.state;
    const cfg = st.config;
    const hour = ((st.timeOfDay % 24) + 24) % 24;
    const night = hour >= 22 || hour < 5;
    const list: Array<{ tpl: Template; district: string; w: number }> = [];
    for (const dId of cfg.districts) {
      const d = this.city.districtById[dId];
      if (!d) continue;
      for (const tpl of TEMPLATES) {
        if (tpl.minRank > Math.max(st.rank, 1)) continue;
        if (cfg.hideIntense && tpl.intense) continue;
        if (tpl.id === 'wrong_jurisdiction' && st.rank < 1) continue;
        let w = 0;
        for (const tag of d.tags) w += tpl.w[tag] ?? 0;
        w += tpl.w[d.id] ?? 0;
        if (w <= 0) w = 0.06;
        w *= d.weights[tpl.category];
        if (tpl.category === 'unusual') w *= cfg.unusualBias ?? 1;
        w *= tpl.weather?.[st.weather] ?? 1;
        w *= this.eventMult(tpl.category, tpl.id, d.id);
        if (night && tpl.category === 'police') w *= 1.35;
        if (night && tpl.id === 'burglary_progress') w *= 1.8;
        if (tpl.id === 'wrong_jurisdiction') w *= 0.35;
        const recent = this.recentTemplates.filter((x) => x === tpl.id).length;
        w *= Math.pow(0.45, recent);
        list.push({ tpl, district: dId, w });
      }
    }
    const pick = this.rng.weighted(list, (x) => x.w);
    if (!pick) return null;
    this.recentTemplates.push(pick.tpl.id);
    if (this.recentTemplates.length > 5) this.recentTemplates.shift();
    return pick;
  }

  /** create an incident plus its ringing call */
  spawnIncident(templateId: string, districtId: string, opts: { archetype?: string; accuracy?: CallerProfile['locationAccuracy']; severity?: number; forceEvent?: string; tutorial?: boolean; duplicateOf?: Incident } = {}): Incident {
    const st = this.state;
    const rng = this.rng;
    const diff = DIFFICULTY[st.config.difficulty];
    const base = TEMPLATE_BY_ID[templateId];
    const src = opts.duplicateOf;
    let tpl: Template = src ? { ...base, twist: undefined } : base.build ? base.build(() => rng.next(), base) : base;
    if (st.config.hideIntense && tpl.intense && !base.intense) tpl = base;
    // location
    const dNodes = this.city.nodesInDistrict[districtId] ?? this.city.nodesInDistrict.downtown;
    let candidates = dNodes.filter((n) => this.city.adj[n].some((e) => this.city.edges[e].cls !== 'highway'));
    if (templateId === 'water_rescue') { const w = candidates.filter((n) => [17, 24].includes(this.city.nodes[n].j)); if (w.length) candidates = w; }
    if (!candidates.length) candidates = dNodes;
    const nodeId = src ? src.nodeId : rng.pick(candidates);
    // caller
    const archetypeId = opts.archetype ?? (rng.weighted(tpl.archetypes, (a) => a[1]) ?? tpl.archetypes[0])[0];
    const vars = makeVars(rng, tpl, archetypeId);
    if (src) for (const k of ['he', 'him', 'his', 'He', 'Him', 'His', 'age', 'kid', 'pname']) vars[k] = src.vars[k];
    let accuracy = opts.accuracy;
    const profile = makeCallerProfile(rng, tpl, archetypeId, this.city, nodeId, accuracy, vars);
    if (!accuracy && profile.locationAccuracy !== 'exact' && !rng.chance(Math.min(0.97, diff.wrong * 0.9 + 0.1))) profile.locationAccuracy = 'exact';
    if (opts.tutorial && !accuracy) profile.locationAccuracy = 'exact';
    profile.cooperationLevel = Math.max(5, Math.min(100, profile.cooperationLevel + diff.coop));
    const locPlan = makeLocPlan(rng, this.city, nodeId);
    // truth
    const truth: Record<string, FactVal> = {};
    for (const [k, v] of Object.entries(tpl.truth)) truth[k] = typeof v === 'string' ? fill(v, vars) : v;
    if (tpl.patient && tpl.patient !== 'none') truth.age = parseInt(vars.age, 10);
    if (src) Object.assign(truth, src.truth);
    const sev = src ? src.severity : opts.severity ?? Math.max(1, Math.min(5, rng.int(tpl.sev[0], tpl.sev[1]) + (st.config.difficulty === 'expert' && rng.chance(0.25) ? 1 : 0)));
    const requires = src ? [] : tpl.requires.map((r) => adaptReqForRank(r, st.rank));
    const num = ++st.incidentCounter;
    const id = `i${num}`;
    const esc = DIFFICULTY[st.config.difficulty].esc;
    const arch = ARCHETYPES[archetypeId];
    const callId = `c${++st.callCounter}`;
    const inc: Incident = {
      id, num, templateId, category: tpl.category, label: tpl.label, severity: sev, status: 'REPORTED', nodeId, district: districtId, reportedNode: null, locationConfirmed: false,
      classification: null, callId, callerName: profile.name, requires, knownReqs: [], stage: 0, maxStage: tpl.escalate?.length ?? 0,
      threat: Math.min(80, tpl.threat[0] * (0.9 + rng.next() * 0.3)), growth: tpl.threat[1] * THREAT_SCALE * esc * (0.9 + rng.next() * 0.25) * (tpl.weather?.[st.weather] && tpl.weather[st.weather]! > 1 ? 1.0 : 1), clear: tpl.threat[2], work: tpl.work,
      assignedUnits: [], everAssigned: [], createdAt: st.time, answeredAt: null, locatedAt: null, firstArrivalAt: null, resolvedAt: null, lastStageAt: st.time,
      facts: [], truth, knows: [], unsureKeys: tpl.unsure ? [...tpl.unsure] : [], notes: '', casualties: 0, saved: 0, needsTransport: !!tpl.transport,
      twistRevealed: false, dismissed: false, hidden: false, stabilizeTimer: 0, callbackAt: null, callbackCount: 0, missedCalls: 0, safetyAdvised: false,
      wrongLocationArrivals: 0, sceneReported: false, unnecessary: 0, relatedIds: [], eventId: opts.forceEvent ?? this.activeEventFor(districtId)?.id, workProgress: 0, patientsTransported: 0,
      mislocated: false, firstDispatchAt: null, timelineBlock: false, callerProfile: profile, vars, blockedEdge: null, sceneSeen: false, twist: tpl.twist ?? null, sceneAt: null,
      escalatedAt: null, mutualAid: 0,
      duplicateOf: src ? src.id : null, dupPlan: [], pursuit: !!tpl.pursuit && !src, mover: null, mergedInto: null,
    };
    if (src) { inc.label = src.label; inc.maxStage = 0; inc.growth = 0; inc.threat = 0; inc.district = src.district; inc.blockedEdge = null; }
    if (inc.pursuit) {
      const n = this.city.nodes[nodeId];
      inc.mover = { x: n.x, y: n.y, prev: nodeId, next: -1, came: -1, speed: 5.6, tracked: true, trail: [], startAt: st.time + 10, lastUpdate: st.time, lastSighting: st.time, contact: 0, heading: 0 };
    }
    // big incidents draw more than one caller
    const dupable = !src && !opts.tutorial && !tpl.pursuit && !tpl.outside && sev >= 3 && (tpl.category === 'fire' || tpl.id.startsWith('collision') || ['robbery', 'public_disturbance', 'domestic_disturbance', 'water_rescue', 'industrial_accident'].includes(tpl.id));
    if (dupable && rng.chance(Math.min(0.95, 0.5 * modProduct(st.config, 'dupes')))) {
      inc.dupPlan.push(st.time + rng.range(18, 40));
      if (sev >= 4 && rng.chance(Math.min(0.9, 0.45 * modProduct(st.config, 'dupes')))) inc.dupPlan.push(st.time + rng.range(45, 75));
    }
    if (tpl.closesRoad && !src) {
      const eid = this.city.adj[nodeId].find((e) => this.city.edges[e].cls === 'local' || this.city.edges[e].cls === 'arterial');
      if (eid !== undefined && !st.closedEdges.includes(eid) && rng.chance(0.5)) { inc.blockedEdge = eid; }
    }
    st.incidents[id] = inc;
    // link to related open incidents of the same event
    if (inc.eventId) for (const o of Object.values(st.incidents)) if (o.id !== id && o.eventId === inc.eventId && o.district === inc.district && !['RESOLVED', 'CLOSED'].includes(o.status) && inc.relatedIds.length < 3) { inc.relatedIds.push(o.id); o.relatedIds.push(id); }
    const mood = { panic: profile.panicLevel, base: profile.panicLevel, cooperation: profile.cooperationLevel, frustration: Math.round(rng.range(arch.frustration[0], arch.frustration[1])), trust: 50 };
    const call: Call = {
      id: callId, incidentId: id, state: 'ringing', profile, isCallback: false, callerId: this.callerId(profile),
      ringStart: st.time, ringTimeout: diff.ring + (st.rank <= 1 ? 8 : 0), answeredAt: null, endedAt: null, transcript: [], mood, asked: {}, promises: [], promiseAt: null, complained: 0,
      heard: [], usedLines: {}, pending: [], holdSince: null, holdTotal: 0, aliUsed: false, verifyAsked: [], locPlan, typing: false, spokeFirst: false, misunderstood: 0, lastSpontaneous: st.time, stateNote: '',
    };
    st.calls[callId] = call;
    st.stats.callsReceived++;
    this.log('call', `Incoming call — ${call.callerId}`, { incidentId: id });
    this.emit({ type: 'ring', callId });
    return inc;
  }

  private activeEventFor(district: string): CityEvent | undefined {
    return this.state.events.find((e) => e.active && e.districts.includes(district));
  }
  private callerId(p: CallerProfile): string {
    const t = p.callerIdType === 'mobile' ? 'WIRELESS' : p.callerIdType === 'landline' ? 'LANDLINE' : p.callerIdType === 'voip' ? 'VOIP' : 'PAYPHONE';
    return `${t} ${p.phone}`;
  }
  instanceTemplate(inc: Incident): Template {
    const base = TEMPLATE_BY_ID[inc.templateId];
    return { ...base, twist: inc.twist ?? undefined };
  }
  private env(call: Call): DialogueEnv {
    const inc = this.state.incidents[call.incidentId];
    return { rng: this.rng, city: this.city, inc, call, tpl: this.instanceTemplate(inc), now: this.state.time };
  }

  // ── Calls ─────────────────────────────────────────────────────────────────
  private updateCalls(dt: number) {
    const st = this.state;
    for (const call of Object.values(st.calls)) {
      const inc = st.incidents[call.incidentId];
      if (call.state === 'ringing') {
        if (st.time - call.ringStart >= call.ringTimeout) this.missCall(call);
        continue;
      }
      if (call.state === 'ended' || call.state === 'missed') continue;
      // deliver pending lines (only on active calls)
      if (call.state === 'active') {
        while (call.pending.length && call.pending[0].at <= st.time) {
          const line = call.pending.shift()!;
          this.deliver(call, line);
          if (call.state !== 'active') break;
        }
        call.typing = call.state === 'active' && call.pending.length > 0;
      }
      if ((call.state as string) === 'ended') continue;
      // emotional model: panic eases toward its baseline
      const m = call.mood;
      if (call.state === 'hold') { call.holdTotal += dt; m.base = Math.min(100, m.base + 0.55 * dt); m.trust = Math.max(0, m.trust - 0.2 * dt); m.cooperation = Math.max(0, m.cooperation - 0.12 * dt); }
      const danger = inc ? Math.max(0, inc.threat - 45) / 55 : 0;
      const target = Math.min(100, m.base + danger * 12);
      m.panic += (target - m.panic) * 0.05 * dt * 2;
      m.panic = Math.max(0, Math.min(100, m.panic));
      call.peakPanic = Math.max(call.peakPanic ?? 0, m.panic);
      if (!call.calmed && call.state === 'active' && (call.peakPanic ?? 0) > 72 && m.panic < 38) { call.calmed = true; st.stats.calmedCallers++; this.notify(`${call.profile.name.split(' ')[0]} has calmed down`, 'good', inc?.id); }
      m.frustration = Math.max(0, m.frustration - 0.04 * dt);
      m.cooperation = Math.max(0, Math.min(100, m.cooperation + (call.profile.cooperationLevel - m.cooperation) * 0.004 * dt));
      call.profile.emotionalState = m.panic > 72 ? 'Panicked' : m.frustration > 58 ? 'Angry' : m.panic > 48 ? 'Frightened' : m.cooperation < 30 ? 'Uncooperative' : m.panic < 15 ? 'Calm' : 'Shaken';
      if (call.state === 'hold' && call.holdSince !== null && st.time - call.holdSince > 20 && st.time - call.lastSpontaneous > 20) {
        call.lastSpontaneous = st.time;
        this.addTranscript(call, 'CALLER', '(still on hold) ' + spontaneous(this.env(call), 'hold'));
      }
      if (call.state === 'hold' && call.holdSince !== null && st.time - call.holdSince > 75 && !inc.dismissed) {
        // caller gives up
        this.endCall(call.id, 'caller_hung_up');
      }
    }
  }

  private missCall(call: Call) {
    const st = this.state;
    const inc = st.incidents[call.incidentId];
    call.state = 'missed'; call.endedAt = st.time;
    st.stats.callsMissed++;
    st.streak = 0;
    inc.missedCalls++;
    this.log('missed', `Missed call — ${call.callerId}`, { incidentId: inc.id, good: false });
    this.notify('Missed call — the caller hung up', 'bad', inc.id);
    this.emit({ type: 'hangup', callId: call.id });
    if (inc.missedCalls < 2 && inc.reportedNode === null) { inc.callbackAt = st.time + 20; inc.status = 'REPORTED'; }
    else this.loseIncident(inc, 'Unanswered call');
  }

  private loseIncident(inc: Incident, reason: string) {
    const st = this.state;
    inc.hidden = true; inc.dismissed = true; inc.lostReason = reason;
    st.streak = 0;
    if (inc.callbackCount < 2) { inc.callbackAt = st.time + 50 + this.rng.range(0, 15); inc.callbackCount++; }
    this.log('failed', `${inc.label}: unhandled (${reason})`, { incidentId: inc.id, good: false });
  }

  private addTranscript(call: Call, who: 'CALLER' | 'DISPATCHER' | 'SYSTEM', text: string) {
    call.transcript.push({ t: this.state.time, clock: gameClock(this.state), who, text });
  }

  private deliver(call: Call, line: import('./types').PendingLine) {
    const st = this.state;
    const inc = st.incidents[call.incidentId];
    this.addTranscript(call, line.hangup ? 'SYSTEM' : 'CALLER', line.text);
    call.spokeFirst = true;
    call.lastSpontaneous = st.time;
    this.emit({ type: 'caller_line', callId: call.id });
    if (line.facts) for (const [k, v] of Object.entries(line.facts)) this.addFact(inc, k, v, line.unsure?.includes(k) ? 'unconfirmed' : 'confirmed', 'caller');
    if (line.heard) for (const h of line.heard) this.addHeard(call, h);
    if (line.twist) this.revealTwist(inc, 'caller');
    if (line.hangup) this.endCall(call.id, 'caller_hung_up');
    this.refreshIncidentStatus(inc);
  }

  addFact(inc: Incident, key: string, value: FactVal, confidence: Fact['confidence'], source: Fact['source']) {
    const label = FACT_LABELS[key] ?? key;
    const existing = inc.facts.filter((f) => f.key === key);
    const same = existing.find((f) => f.value === value && f.confidence !== 'contradicted');
    if (same) { if (confidence === 'confirmed') same.confidence = 'confirmed'; return; }
    for (const f of existing) if (f.confidence !== 'contradicted') f.confidence = 'contradicted';
    inc.facts.push({ key, label, value, confidence, source, at: this.state.time });
    if (!inc.knows.includes(key)) inc.knows.push(key);
  }

  private addHeard(call: Call, h: Omit<HeardLocation, 'id' | 'at'>) {
    // new, different statements contradict older unsure ones on a different node
    const dup = call.heard.find((x) => x.nodeId === h.nodeId && x.source === h.source);
    if (dup) { if (h.reliability === 'sure') dup.reliability = 'sure'; return; }
    if (h.reliability === 'sure' || h.source === 'cross') {
      for (const x of call.heard) if (x.nodeId !== h.nodeId && x.source !== 'district' && x.reliability === 'unsure' && Math.hypot(this.city.nodes[x.nodeId].x - this.city.nodes[h.nodeId].x, this.city.nodes[x.nodeId].y - this.city.nodes[h.nodeId].y) > 150) x.reliability = 'contradicted';
    }
    call.heard.push({ ...h, id: `h${call.heard.length + 1}`, at: this.state.time });
  }

  private revealTwist(inc: Incident, source: 'caller' | 'scene') {
    const tw = inc.twist;
    if (!tw || inc.twistRevealed) return;
    inc.twistRevealed = true;
    for (const [k, v] of Object.entries(tw.facts)) { inc.truth[k] = v; this.addFact(inc, k, v, 'confirmed', source === 'scene' ? 'scene' : 'caller'); }
    if (tw.requires) {
      inc.requires = tw.requires.map((r) => adaptReqForRank(r, this.state.rank));
      if (!tw.requires.length) { inc.truth.false_alarm = true; this.addFact(inc, 'false_alarm', true, 'confirmed', source === 'scene' ? 'scene' : 'caller'); }
      else inc.truth.false_alarm = false;
      if (tw.requires.some((r) => r.cap === 'bls' || r.cap === 'als')) inc.needsTransport = true;
    }
    if (tw.label) inc.label = tw.label;
    if (tw.severity) inc.severity = tw.severity;
    if (tw.threat !== undefined) inc.threat = tw.threat;
    if (tw.requires && tw.requires.length && inc.status === 'STABILIZING') inc.status = 'ON_SCENE';
    this.log('info', `Revealed: ${inc.label}`, { incidentId: inc.id });
    if (source === 'caller') this.notify(`New information — ${inc.label}`, 'warn', inc.id);
  }

  answerCall(callId: string): boolean {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || (call.state !== 'ringing' && call.state !== 'hold')) return false;
    const inc = st.incidents[call.incidentId];
    // put the current call on hold
    if (st.activeCallId && st.activeCallId !== callId) { const cur = st.calls[st.activeCallId]; if (cur && cur.state === 'active') this.holdCall(cur.id); }
    const wasRinging = call.state === 'ringing';
    if (call.state === 'hold' && call.holdSince !== null) { call.holdSince = null; }
    call.state = 'active';
    st.activeCallId = callId;
    if (wasRinging) {
      call.answeredAt = st.time;
      if (!call.isCallback) { st.stats.callsAnswered++; st.stats.answerTimes.push(st.time - call.ringStart); }
      else { st.stats.callbacks++; }
      inc.answeredAt = inc.answeredAt ?? st.time;
      if (inc.status === 'REPORTED') inc.status = 'AWAITING_INFORMATION';
      this.addTranscript(call, 'SYSTEM', `Call connected — ${call.callerId}`);
      this.log('call', `Call answered — ${call.callerId}`, { incidentId: inc.id });
      if (call.isCallback) {
        for (const p of call.pending) if (p.at < 0) p.at = st.time + 1.4;
      } else {
        const lines = openingLines(this.env(call));
        lines.forEach((l, i) => call.pending.push({ ...l, at: st.time + 1.2 + i * 1.5 }));
      }
    } else {
      this.addTranscript(call, 'SYSTEM', 'Call resumed');
    }
    this.select('incident', inc.id);
    this.emit({ type: 'answer', callId });
    this.refreshIncidentStatus(inc);
    return true;
  }

  holdCall(callId: string) {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return;
    call.state = 'hold'; call.holdSince = st.time; call.pending = call.pending.filter((p) => p.at < 0);
    if (st.activeCallId === callId) st.activeCallId = null;
    this.addTranscript(call, 'SYSTEM', 'Caller placed on hold');
  }

  /** player asks / says something */
  ask(callId: string, input: { intent?: Intent; text?: string }) {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return;
    const inc = st.incidents[call.incidentId];
    const text = (input.text ?? QUICK_QUESTIONS.find((q) => q.intent === input.intent)?.text ?? '').trim();
    if (!text) return;
    const intent: Intent = input.intent ?? classifyIntent(text);
    this.addTranscript(call, 'DISPATCHER', text);
    const env = this.env(call);
    const r = replyTo(env, intent, text);
    call.asked[intent] = (call.asked[intent] ?? 0) + 1;
    const m = call.mood;
    if (r.mood.panic) m.panic = Math.max(0, Math.min(100, m.panic + r.mood.panic));
    if (r.mood.base) m.base = Math.max(0, Math.min(100, m.base + r.mood.base));
    if (r.mood.cooperation) m.cooperation = Math.max(0, Math.min(100, m.cooperation + r.mood.cooperation));
    if (r.mood.frustration) m.frustration = Math.max(0, Math.min(100, m.frustration + r.mood.frustration));
    if (r.mood.trust) m.trust = Math.max(0, Math.min(100, m.trust + r.mood.trust));
    if (r.promise) { call.promises.push('help'); call.promiseAt = st.time; }
    if (r.safety && ['fire', 'police', 'unusual'].includes(inc.category)) inc.safetyAdvised = true;
    // schedule reply lines with a natural pace
    const arch = ARCHETYPES[call.profile.archetype];
    let at = Math.max(st.time, call.pending.length ? call.pending[call.pending.length - 1].at : st.time);
    for (const l of r.lines) {
      const len = l.text.length;
      const pace = (arch.slow ? 1.5 : 1) * (m.panic > 70 ? 0.7 : 1) * (call.profile.archetype === 'terse' ? 1.2 : 1);
      at += Math.min(4.5, (0.9 + len * 0.028) * pace);
      call.pending.push({ ...l, at });
    }
  }

  say(callId: string, text: string) { this.ask(callId, { text }); }

  /** read-back verification of a candidate location with the caller */
  verifyLocation(callId: string, nodeId: number) {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return;
    const inc = st.incidents[call.incidentId];
    this.addTranscript(call, 'DISPATCHER', `Let me confirm — you are at ${fullAddress(this.city, nodeId)}. Is that correct?`);
    const v = verifyReply(this.env(call), nodeId);
    call.verifyAsked.push(nodeId);
    st.stats.locationChecks++;
    const at = st.time + 1.6;
    call.pending.push({ at, text: v.text });
    if (v.ok === true) { st.stats.verifiedOk++; inc.locationConfirmed = inc.reportedNode === nodeId; this.addHeard(call, { nodeId: inc.nodeId, label: `${addressOf(this.city, nodeId)} (read-back confirmed)`, source: 'address', reliability: 'sure' }); }
    if (v.ok === false) for (const h of call.heard) if (h.nodeId === nodeId) h.reliability = 'contradicted';
  }

  requestLocation(callId: string): string {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || (call.state !== 'active' && call.state !== 'hold')) return 'No active call';
    const level = st.upgrades.ali ?? 0;
    if (call.aliUsed) return 'Location lookup already performed for this call';
    const res = aliLookup(this.env(call), level);
    if (!res) return 'Caller location lookup is not installed';
    call.aliUsed = true;
    this.addTranscript(call, 'SYSTEM', res.message);
    this.addHeard(call, res.heard);
    return res.message;
  }

  endCall(callId: string, reason = 'dispatcher'): void {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state === 'ended' || call.state === 'missed') return;
    const inc = st.incidents[call.incidentId];
    call.state = 'ended'; call.endedAt = st.time; call.endReason = reason; call.pending = []; call.typing = false;
    if (st.activeCallId === callId) st.activeCallId = null;
    this.addTranscript(call, 'SYSTEM', reason === 'caller_hung_up' ? 'Caller disconnected' : reason === 'transferred' ? 'Call transferred' : 'Call ended by dispatcher');
    this.log('call', `Call ended (${reason === 'dispatcher' ? 'dispatcher' : reason.replace('_', ' ')}) — ${inc.label}`, { incidentId: inc.id });
    this.emit({ type: 'hangup', callId });
    if (inc.truth.outside && reason !== 'transferred') { this.resolveOutside(inc, false); return; }
    if (inc.reportedNode === null && !inc.truth.outside && !inc.dismissed) {
      // location never established — the caller will try again
      if (inc.callbackCount < 2) { inc.callbackAt = st.time + 14 + this.rng.range(0, 8); inc.callbackCount++; this.notify('Call ended before a location was set — expect a callback', 'warn', inc.id); }
      else this.loseIncident(inc, 'No location');
    }
    this.refreshIncidentStatus(inc);
  }

  /** transfer — to the neighbouring agency for out-of-area calls, or to a dispatch assistant */
  transferCall(callId: string): string {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return 'No active call';
    const inc = st.incidents[call.incidentId];
    if (inc.truth.outside) {
      this.addTranscript(call, 'DISPATCHER', "You're outside Ravenport — I'm transferring you to the neighbouring county's dispatch now. Stay on the line.");
      this.endCall(callId, 'transferred');
      this.resolveOutside(inc, true);
      return 'Transferred to the neighbouring agency';
    }
    const lvl = st.upgrades.assistant ?? 0;
    if (lvl <= 0) return 'No dispatch assistants available — upgrade Dispatch Assistants';
    if (st.assistantFreeAt > st.time) return `Assistant busy for ${Math.ceil(st.assistantFreeAt - st.time)}s`;
    this.addTranscript(call, 'DISPATCHER', "I'm handing you to a colleague who will confirm your location and send help.");
    const delay = lvl >= 2 ? 14 : 22;
    st.assistantFreeAt = st.time + delay + 20;
    this.endCall(callId, 'transferred');
    inc.callbackAt = null;
    // assistant finishes later
    const accuracy = lvl >= 2 ? 0.92 : 0.78;
    inc.notes += (inc.notes ? '\n' : '') + `Transferred to assistant at ${gameClock(st)}`;
    const when = st.time + delay;
    (this as unknown as { _assist?: Array<{ at: number; id: string; acc: number }> })._assist ??= [];
    (this as unknown as { _assist: Array<{ at: number; id: string; acc: number }> })._assist.push({ at: when, id: inc.id, acc: accuracy });
    this.notify('Call transferred to an assistant — location pending', 'info', inc.id);
    return 'Transferred to assistant';
  }
  private runAssistants() {
    const arr = (this as unknown as { _assist?: Array<{ at: number; id: string; acc: number }> })._assist;
    if (!arr || !arr.length) return;
    const st = this.state;
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (st.time < a.at) continue;
      arr.splice(i, 1);
      const inc = st.incidents[a.id];
      if (!inc || inc.reportedNode !== null) continue;
      const call = Object.values(st.calls).filter((c) => c.incidentId === inc.id).sort((x, y) => y.ringStart - x.ringStart)[0];
      const best = call?.heard.filter((h) => h.reliability !== 'contradicted').sort((x, y) => (y.reliability === 'sure' ? 1 : 0) - (x.reliability === 'sure' ? 1 : 0))[0];
      if (best && this.rng.chance(a.acc)) { this.setIncidentLocation(inc.id, best.nodeId, 'assistant'); this.notify(`Assistant set location for ${inc.label}`, 'good', inc.id); }
      else { inc.callbackAt = st.time + 8; inc.callbackCount = Math.min(inc.callbackCount, 1); this.notify('Assistant could not confirm the location — caller will call back', 'warn', inc.id); }
    }
  }

  private resolveOutside(inc: Incident, ok: boolean) {
    const st = this.state;
    inc.status = 'CLOSED'; inc.resolvedAt = st.time; inc.outcome = ok ? 'success' : 'mishandled';
    st.stats.byCategory.unusual = st.stats.byCategory.unusual ?? { n: 0, ok: 0 };
    st.stats.byCategory.unusual.n++;
    if (ok) { st.stats.byCategory.unusual.ok++; st.stats.resolved++; st.stats.transfersOk++; st.streak++; st.stats.bestStreak = Math.max(st.stats.bestStreak, st.streak); st.stats.bonus += 400; this.notify('Out-of-area call transferred correctly', 'good', inc.id); this.log('resolved', 'Out-of-area call transferred', { incidentId: inc.id, good: true }); }
    else { st.stats.mishandled++; this.notify('Out-of-area caller was dropped without a transfer', 'bad', inc.id); this.log('failed', 'Out-of-area caller dropped', { incidentId: inc.id, good: false }); }
  }

  private updateCallbacks() {
    const st = this.state;
    this.runAssistants();
    for (const inc of Object.values(st.incidents)) {
      if (inc.callbackAt === null || st.time < inc.callbackAt) continue;
      if (['RESOLVED', 'CLOSED'].includes(inc.status)) { inc.callbackAt = null; continue; }
      // don't stack callbacks while a call for this incident is live
      if (Object.values(st.calls).some((c) => c.incidentId === inc.id && (c.state === 'ringing' || c.state === 'active' || c.state === 'hold'))) { inc.callbackAt = st.time + 8; continue; }
      inc.callbackAt = null;
      this.createCallback(inc);
    }
  }

  createCallback(inc: Incident, reason?: string) {
    const st = this.state;
    const prev = Object.values(st.calls).filter((c) => c.incidentId === inc.id).sort((a, b) => b.ringStart - a.ringStart)[0];
    const profile: CallerProfile = JSON.parse(JSON.stringify(inc.callerProfile));
    const tpl = this.instanceTemplate(inc);
    const why = reason ?? (inc.wrongLocationArrivals > 0 && inc.mislocated ? 'nothing_found' : inc.hidden ? 'dismissed' : inc.reportedNode === null ? 'no_location' : inc.stage > 0 ? 'escalated' : 'waiting');
    const id = `c${++st.callCounter}`;
    const mood = prev ? { ...prev.mood, panic: Math.min(100, prev.mood.panic + 14), base: Math.min(100, prev.mood.base + 14), frustration: Math.min(100, prev.mood.frustration + 12), trust: Math.max(0, prev.mood.trust - 12) } : { panic: 60, base: 60, cooperation: 55, frustration: 20, trust: 40 };
    if (why === 'nothing_found') profile.locationAccuracy = 'exact';
    const call: Call = {
      id, incidentId: inc.id, state: 'ringing', profile, isCallback: true, callerId: this.callerId(profile) + ' (callback)', ringStart: st.time,
      ringTimeout: DIFFICULTY[st.config.difficulty].ring, answeredAt: null, endedAt: null, transcript: [], mood, asked: {}, promises: prev?.promises ?? [], promiseAt: prev?.promiseAt ?? null,
      complained: 0, heard: prev ? prev.heard.map((h) => ({ ...h })) : [], usedLines: {}, pending: [], holdSince: null, holdTotal: 0, aliUsed: prev?.aliUsed ?? false, verifyAsked: [],
      locPlan: prev?.locPlan ?? makeLocPlan(this.rng, this.city, inc.nodeId), typing: false, spokeFirst: true, misunderstood: 0, lastSpontaneous: st.time, stateNote: why, callbackOf: prev?.id,
    };
    const env: DialogueEnv = { rng: this.rng, city: this.city, inc, call, tpl, now: st.time };
    const cause = tpl.cause.length ? fill(this.rng.pick(tpl.cause), inc.vars) : 'it has not stopped';
    let text: string;
    switch (why) {
      case 'nothing_found': text = `Hello? I called earlier — the officers came but they went to the wrong place! We're not where they went. ${spontaneous(env, 'nothing_found')}`; break;
      case 'no_location': text = `Hello? I called a minute ago and we got cut off. You never got my location! ${spontaneous(env, 'waiting')}`; break;
      case 'escalated': text = `It's me again, I called earlier. ${spontaneous(env, 'escalated')}`; break;
      case 'dismissed': text = `I called earlier and nobody came. ${cause} It's getting worse!`; break;
      default: text = `Hello? I called a while ago and nobody has arrived. ${spontaneous(env, 'waiting')}`;
    }
    call.pending.push({ at: -1, text });
    if (why === 'escalated' || why === 'dismissed') call.mood.base = Math.min(100, call.mood.base + 10);
    st.calls[id] = call;
    inc.hidden = false; inc.dismissed = false;
    st.stats.callsReceived++;
    this.log('call', `Callback — ${inc.label}`, { incidentId: inc.id });
    this.emit({ type: 'ring', callId: id });
    this.notify(`Callback incoming — ${inc.label}`, 'warn', inc.id);
  }

  // ── Incident bookkeeping ──────────────────────────────────────────────────
  setIncidentLocation(incId: string, nodeId: number, source: 'map' | 'candidate' | 'search' | 'assistant' = 'candidate') {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.truth.outside) return;
    const first = inc.reportedNode === null;
    inc.reportedNode = nodeId;
    inc.locationConfirmed = nodeId === inc.nodeId && (source === 'candidate' || source === 'assistant');
    if (first) { inc.locatedAt = st.time; this.log('info', `Location set: ${fullAddress(this.city, nodeId)}`, { incidentId: incId }); }
    else this.log('info', `Location corrected: ${fullAddress(this.city, nodeId)}`, { incidentId: incId });
    inc.callbackAt = null;
    // the committed location might be wrong; track mislocated
    inc.mislocated = Math.hypot(this.city.nodes[nodeId].x - this.city.nodes[inc.nodeId].x, this.city.nodes[nodeId].y - this.city.nodes[inc.nodeId].y) > 90;
    // redirect units
    for (const uid of inc.assignedUnits) {
      const u = st.units[uid];
      if (u && (u.status === 'EN_ROUTE' || u.status === 'DISPATCHED' || (u.status === 'ON_SCENE' && !inc.pursuit && !this.unitAtScene(u, inc)))) {
        if (u.status === 'ON_SCENE') { u.status = 'EN_ROUTE'; this.radio(u.spoken, `Copy, redirecting to ${addressOf(this.city, nodeId)}.`, 'unit', u.id, inc.id); }
        this.routeUnit(u, nodeId, true);
      }
    }
    this.refreshIncidentStatus(inc);
  }

  setClassification(incId: string, cls: string | null) {
    const inc = this.state.incidents[incId];
    if (!inc) return;
    inc.classification = cls;
    this.refreshIncidentStatus(inc);
  }

  setNotes(incId: string, text: string) { const inc = this.state.incidents[incId]; if (inc) inc.notes = text; }

  refreshIncidentStatus(inc: Incident) {
    if (!['REPORTED', 'AWAITING_INFORMATION', 'CLASSIFIED', 'AWAITING_DISPATCH'].includes(inc.status)) return;
    const hasCall = inc.answeredAt !== null;
    if (!hasCall) { inc.status = 'REPORTED'; return; }
    const classified = inc.classification !== null || (inc.facts.length > 0 && suggestClass(inc) !== 'unknown');
    if (inc.reportedNode !== null && classified) inc.status = 'AWAITING_DISPATCH';
    else if (inc.reportedNode !== null || classified) inc.status = 'CLASSIFIED';
    else inc.status = 'AWAITING_INFORMATION';
  }

  select(kind: 'incident' | 'unit' | 'station' | 'district' | null, id: string | null) { this.state.selected = { kind, id }; }

  /** false alarm / no response decision */
  dismissIncident(incId: string) {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) return;
    if (inc.requires.length === 0 && !inc.duplicateOf) {
      if (inc.everAssigned.length === 0) st.stats.cleanFalseAlarms++;
      this.closeIncident(inc, 'false_alarm');
      return;
    }
    // wrong call: the problem keeps developing out of sight; the caller will phone again
    inc.hidden = true; inc.dismissed = true;
    inc.callbackAt = st.time + 35 + this.rng.range(0, 12);
    for (const uid of [...inc.assignedUnits]) this.recall(uid);
    this.log('failed', `${inc.label}: dismissed as no emergency (incorrect)`, { incidentId: inc.id, good: false });
    this.notify('Incident dismissed — but this may have been a real emergency', 'warn', inc.id);
    st.stats.mishandled += 0;
    if (st.activeCallId) { const c = st.calls[st.activeCallId]; if (c && c.incidentId === incId) this.endCall(c.id); }
  }

  // ── Units ─────────────────────────────────────────────────────────────────
  private mobilizationTime(u: Unit): number {
    const lvl = this.state.upgrades.console ?? 0;
    const crew = this.crewOf(u);
    const rel = crew.length ? crew.reduce((s, p) => s + p.reliability, 0) / crew.length : 70;
    return Math.max(2.5, 10 - 2.5 * lvl - (rel - 70) / 20);
  }

  canDispatch(u: Unit, inc: Incident): { ok: boolean; reason?: string } {
    if (!u) return { ok: false, reason: 'Unknown unit' };
    if (['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'Incident closed' };
    if (inc.reportedNode === null) return { ok: false, reason: 'Set the incident location first' };
    if (inc.truth.outside) return { ok: false, reason: 'Out of jurisdiction' };
    if (u.status === 'OUT_OF_SERVICE') return { ok: false, reason: 'Unit out of service' };
    if (u.status === 'TRANSPORTING') return { ok: false, reason: 'Unit is transporting a patient' };
    if (u.status === 'BUSY') return { ok: false, reason: 'Unit is busy' };
    if (u.status === 'ON_SCENE') return { ok: false, reason: 'Unit is on scene elsewhere — recall it first' };
    if (u.assignedIncidentId === inc.id && u.status !== 'RETURNING') return { ok: false, reason: 'Already assigned here' };
    if (!checkCrew(this.state, u)) return { ok: false, reason: 'Understaffed' };
    return { ok: true };
  }

  dispatch(unitId: string, incId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const u = st.units[unitId], inc = st.incidents[incId];
    if (!u || !inc) return { ok: false, reason: 'Unknown' };
    const can = this.canDispatch(u, inc);
    if (!can.ok) return can;
    // detach from a previous incident
    if (u.assignedIncidentId && u.assignedIncidentId !== incId) this.detach(u, true);
    u.assignedIncidentId = incId;
    u.status = 'DISPATCHED';
    u.timer = this.mobilizationTime(u);
    u.deployments++;
    u.note = undefined;
    inc.assignedUnits.push(u.id);
    if (!inc.everAssigned.includes(u.id)) inc.everAssigned.push(u.id);
    if (inc.firstDispatchAt === null) inc.firstDispatchAt = st.time;
    if (['REPORTED', 'AWAITING_INFORMATION', 'CLASSIFIED', 'AWAITING_DISPATCH', 'ESCALATING'].includes(inc.status) || !inc.assignedUnits.length) inc.status = inc.status === 'ESCALATING' ? 'ESCALATING' : 'UNITS_EN_ROUTE';
    if (inc.status === 'AWAITING_DISPATCH' || inc.status === 'CLASSIFIED') inc.status = 'UNITS_EN_ROUTE';
    const reqs = inc.duplicateOf ? (st.incidents[inc.duplicateOf]?.requires ?? []) : inc.requires;
    const useful = reqs.some((r) => u.capabilities.includes(r.cap));
    st.stats.dispatches++;
    if (useful) st.stats.correctDispatches++;
    const cost = u.service === 'fire' ? 320 : u.service === 'medical' ? 220 : 150;
    st.stats.costs += cost; st.budget -= cost;
    this.radio('DISPATCH', `${u.spoken}, respond to ${addressOf(this.city, inc.reportedNode!)}, ${inc.label.toLowerCase()}.`, 'dispatch', u.id, inc.id);
    this.log('dispatch', `${u.callsign} dispatched → ${inc.label} (${addressOf(this.city, inc.reportedNode!)})`, { incidentId: inc.id, unitId: u.id });
    this.routeUnit(u, inc.reportedNode!, true);
    this.emit({ type: 'dispatch', unitId: u.id });
    // caller reaction
    const call = this.callFor(inc);
    if (call && call.state === 'active' && !call.pending.length && this.rng.chance(0.65)) call.pending.push({ at: st.time + 2.2, text: spontaneous(this.env(call), 'dispatched') });
    return { ok: true };
  }

  private callFor(inc: Incident): Call | undefined {
    return Object.values(this.state.calls).find((c) => c.incidentId === inc.id && (c.state === 'active' || c.state === 'hold' || c.state === 'ringing'));
  }

  /** remove the unit from its incident (does not change the unit's own status) */
  private detach(u: Unit, silent = false) {
    const st = this.state;
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    if (inc) {
      inc.assignedUnits = inc.assignedUnits.filter((x) => x !== u.id);
      if (!silent && inc.assignedUnits.length === 0 && ['UNITS_EN_ROUTE', 'ON_SCENE'].includes(inc.status)) inc.status = 'AWAITING_DISPATCH';
      if (silent && inc.assignedUnits.length === 0 && ['UNITS_EN_ROUTE', 'ON_SCENE'].includes(inc.status)) inc.status = 'AWAITING_DISPATCH';
      // sending a unit that never contributed counts as unnecessary
      const hadContribution = inc.requires.some((r) => u.capabilities.includes(r.cap));
      if (!hadContribution && u.status === 'ON_SCENE') { inc.unnecessary++; }
    }
    u.assignedIncidentId = undefined;
  }

  recall(unitId: string): boolean {
    const st = this.state;
    const u = st.units[unitId];
    if (!u || u.status === 'TRANSPORTING' || u.status === 'OUT_OF_SERVICE' || u.status === 'BUSY') return false;
    if (u.temp) { this.detach(u); delete st.units[u.id]; this.radio(u.spoken, 'Copy, standing down.', 'unit'); return true; }
    const wasScene = u.status === 'ON_SCENE';
    this.detach(u);
    u.status = 'RETURNING';
    u.patients = 0;
    this.routeUnit(u, u.postNode, false);
    this.radio('DISPATCH', `${u.spoken}, return to service.`, 'dispatch', u.id);
    this.radio(u.spoken, wasScene ? 'Copy, clear of the scene, returning.' : 'Copy, returning to station.', 'unit', u.id);
    this.log('dispatch', `${u.callsign} recalled`, { unitId: u.id });
    return true;
  }

  reposition(unitId: string, nodeId: number): boolean {
    const u = this.state.units[unitId];
    if (!u || !['AVAILABLE', 'RETURNING'].includes(u.status)) return false;
    u.postNode = nodeId;
    u.status = 'RETURNING';
    this.routeUnit(u, nodeId, false);
    this.radio(u.spoken, `Copy, moving to cover ${addressOf(this.city, nodeId)}.`, 'unit', u.id);
    return true;
  }

  routeUnit(u: Unit, destNode: number, siren: boolean): boolean {
    const startNode = u.route.length ? u.route[0] : u.prevNode;
    const startPos = u.route.length ? { x: this.city.nodes[startNode].x, y: this.city.nodes[startNode].y } : { x: u.x, y: u.y };
    void startPos;
    const res = findRoute(this.city, startNode, destNode, this.tm(siren), this.unitSpeedFactor(u));
    u.destNode = destNode;
    if (!res) { u.route = []; u.eta = null; return false; }
    u.route = u.route.length ? [startNode, ...res.path] : res.path;
    this.updateEta(u);
    return true;
  }

  private rerouteAll(force = false) {
    for (const u of Object.values(this.state.units)) {
      if (!['EN_ROUTE', 'RETURNING', 'TRANSPORTING'].includes(u.status) || u.destNode === null || !u.route.length) continue;
      const siren = u.status !== 'RETURNING';
      const cur = routeTime(this.city, u.prevNode, u.route, this.tm(siren), this.unitSpeedFactor(u), u.x, u.y);
      const res = findRoute(this.city, u.route[0], u.destNode, this.tm(siren), this.unitSpeedFactor(u));
      if (!res) continue;
      const blocked = u.route.some((n, i) => { const prev = i === 0 ? u.prevNode : u.route[i - 1]; const eid = this.city.edgeBetween.get(prev * 100000 + n); return eid !== undefined && this.closedMask[eid]; });
      if (force || blocked || res.time < cur * 0.88) { u.route = [u.route[0], ...res.path]; }
    }
  }

  updateEta(u: Unit) {
    if (!u.route.length) { u.eta = 0; return; }
    const siren = u.status !== 'RETURNING';
    u.eta = routeTime(this.city, u.prevNode, u.route, this.tm(siren), this.unitSpeedFactor(u), u.x, u.y);
  }

  /** estimated time (seconds) and distance (km) for a unit to reach a node, used by the dispatch list */
  estimate(unitId: string, nodeId: number): { eta: number; dist: number } | null {
    const u = this.state.units[unitId];
    if (!u) return null;
    const key = `${unitId}:${nodeId}`;
    const c = this.etaCache.get(key);
    if (c && this.state.time - c.t < 3) return c.v;
    const startNode = u.route.length && ['EN_ROUTE', 'RETURNING', 'DISPATCHED'].includes(u.status) ? u.route[0] : u.prevNode;
    const res = findRoute(this.city, startNode, nodeId, this.tm(true), this.unitSpeedFactor(u));
    let v: { eta: number; dist: number } | null = null;
    if (res) {
      const sn = this.city.nodes[startNode];
      const lead = Math.hypot(sn.x - u.x, sn.y - u.y);
      const mob = u.status === 'AVAILABLE' ? this.mobilizationTime(u) : u.status === 'DISPATCHED' ? u.timer : 0;
      v = { eta: res.time + mob + lead / 6, dist: (res.dist + lead) * 4 / 1000 };
    }
    this.etaCache.set(key, { t: this.state.time, v });
    return v;
  }

  private unitAtScene(u: Unit, inc: Incident): boolean {
    const n = this.city.nodes[inc.nodeId];
    return Math.hypot(u.x - n.x, u.y - n.y) < 90;
  }

  private updateUnits(dt: number) {
    const st = this.state;
    for (const u of Object.values(st.units)) {
      st.stats.unitSeconds += dt;
      if (u.status !== 'AVAILABLE' && u.status !== 'OUT_OF_SERVICE') st.stats.unitBusySeconds += dt;
      switch (u.status) {
        case 'DISPATCHED': {
          u.timer -= dt;
          if (u.timer <= 0) {
            const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
            if (!inc || inc.reportedNode === null) { u.status = 'AVAILABLE'; u.assignedIncidentId = undefined; break; }
            u.status = 'EN_ROUTE';
            this.routeUnit(u, inc.reportedNode, true);
            this.radio(u.spoken, `Dispatch, ${u.spoken}. Copy, en route to ${addressOf(this.city, inc.reportedNode)}.`, 'unit', u.id, inc.id);
            this.emit({ type: 'status', unitId: u.id });
            // already there?
            if (!u.route.length) this.arrive(u);
          } else this.updateEta(u);
          break;
        }
        case 'EN_ROUTE': case 'RETURNING': case 'TRANSPORTING': {
          // retarget if the incident location changed
          if (u.status === 'EN_ROUTE') {
            const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
            if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) { u.assignedIncidentId = undefined; u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false); break; }
            if (inc.pursuit && inc.mover) {
              // crews who can see the suspect chase it directly; others head for the last known position
              const m = inc.mover;
              const near = Math.hypot(u.x - m.x, u.y - m.y) < 230;
              const target = near ? (m.next >= 0 ? m.next : m.prev) : inc.reportedNode;
              if (target !== null && target !== u.destNode) this.routeUnit(u, target, true);
              if (u.route.length) this.advance(u, dt); else { u.speed = 0; u.note = 'Searching area'; }
              break;
            }
            if (inc.reportedNode !== null && u.destNode !== inc.reportedNode) this.routeUnit(u, inc.reportedNode, true);
          }
          this.advance(u, dt);
          break;
        }
        case 'BUSY': {
          u.timer -= dt;
          if (u.timer <= 0) { u.status = 'RETURNING'; u.assignedIncidentId = undefined; this.routeUnit(u, u.postNode, false); }
          break;
        }
        case 'ON_SCENE': {
          const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
          if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) {
            if (u.temp) { delete st.units[u.id]; break; }
            u.assignedIncidentId = undefined; u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false);
          } else if (!inc.pursuit && inc.reportedNode !== null && !this.unitAtScene(u, inc) && Math.hypot(this.city.nodes[inc.reportedNode].x - u.x, this.city.nodes[inc.reportedNode].y - u.y) > 90) {
            u.status = 'EN_ROUTE'; this.routeUnit(u, inc.reportedNode, true);
          }
          break;
        }
        case 'OUT_OF_SERVICE': {
          if (u.timer > 0) { u.timer -= dt; if (u.timer <= 0) { u.status = 'AVAILABLE'; u.note = undefined; } }
          break;
        }
        default: break;
      }
    }
  }

  private advance(u: Unit, dt: number) {
    const city = this.city;
    let remaining = dt;
    const tm = this.tm(u.status !== 'RETURNING');
    const vf = this.unitSpeedFactor(u);
    let guard = 0;
    while (remaining > 1e-6 && u.route.length && guard++ < 20) {
      const target = city.nodes[u.route[0]];
      const eid = city.edgeBetween.get(u.prevNode * 100000 + u.route[0]);
      let speed = eid !== undefined ? edgeSpeed(city, city.edges[eid], tm, vf) : (35 / 3.6 / 4) * TIME_COMPRESS * vf;
      if (speed <= 0) { this.routeUnit(u, u.destNode ?? u.postNode, u.status !== 'RETURNING'); u.speed = 0; return; }
      u.speed = speed;
      const dx = target.x - u.x, dy = target.y - u.y;
      const dist = Math.hypot(dx, dy);
      const step = speed * remaining;
      if (step >= dist) {
        u.x = target.x; u.y = target.y; remaining -= dist / speed; u.prevNode = u.route.shift()!;
      } else { u.x += (dx / dist) * step; u.y += (dy / dist) * step; remaining = 0; }
    }
    if (!u.route.length) { u.speed = 0; this.arrive(u); }
    else this.updateEta(u);
  }

  private arrive(u: Unit) {
    const st = this.state;
    u.eta = 0; u.route = [];
    if (u.status === 'RETURNING') {
      if (u.temp) { delete st.units[u.id]; return; }
      u.status = 'AVAILABLE'; u.assignedIncidentId = undefined; u.destNode = null;
      this.emit({ type: 'status', unitId: u.id });
      return;
    }
    if (u.status === 'TRANSPORTING') {
      const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
      const hosp = this.nearestLandmarkName(u.prevNode, 'hospital');
      this.radio(u.spoken, `Dispatch, ${u.spoken}. Arrived at ${hosp}, transferring care.`, 'unit', u.id, inc?.id);
      u.patients = 0; u.status = 'BUSY'; u.timer = 12;
      if (inc) {
        inc.patientsTransported++;
        const needed = this.transportsNeeded(inc);
        const stillMoving = inc.assignedUnits.some((id) => st.units[id]?.status === 'TRANSPORTING');
        if (inc.patientsTransported >= needed && !stillMoving && inc.status !== 'RESOLVED') this.resolveIncident(inc, 'success');
      }
      this.emit({ type: 'arrive', unitId: u.id });
      return;
    }
    if (u.status === 'EN_ROUTE') {
      const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
      if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) { u.status = 'RETURNING'; u.assignedIncidentId = undefined; this.routeUnit(u, u.postNode, false); return; }
      if (inc.pursuit) { u.note = 'Searching area'; u.speed = 0; return; }
      u.status = 'ON_SCENE';
      this.emit({ type: 'arrive', unitId: u.id });
      if (!this.unitAtScene(u, inc)) {
        // wrong place
        inc.wrongLocationArrivals++;
        inc.mislocated = true;
        st.stats.wrongLocations++;
        u.note = 'Nothing found';
        this.fx('bad', inc.reportedNode ?? u.prevNode, 'Nothing here');
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Nothing found at ${addressOf(this.city, inc.reportedNode ?? inc.nodeId)}. Please verify the location.`, 'unit', u.id, inc.id);
        this.notify(`${u.callsign} found nothing at the reported address — verify the location`, 'bad', inc.id);
        this.log('arrival', `${u.callsign} arrived at wrong location`, { incidentId: inc.id, unitId: u.id, good: false });
        if (inc.callbackAt === null && !this.callFor(inc)) inc.callbackAt = st.time + 6;
        else { const c = this.callFor(inc); if (c && c.state === 'active') c.pending.push({ at: st.time + 1.5, text: spontaneous(this.env(c), 'nothing_found') }); }
        return;
      }
      u.note = undefined;
      this.radio(u.spoken, `Dispatch, ${u.spoken}. On scene at ${addressOf(this.city, inc.nodeId)}.`, 'unit', u.id, inc.id);
      this.log('arrival', `${u.callsign} on scene — ${inc.label}`, { incidentId: inc.id, unitId: u.id, good: true });
      if (inc.firstArrivalAt === null) {
        inc.firstArrivalAt = st.time;
        const rt = st.time - (inc.answeredAt ?? inc.createdAt);
        st.stats.responseTimes.push(rt);
        st.stats.serviceResponse[u.service].push(rt);
      }
      if (inc.status === 'UNITS_EN_ROUTE' || inc.status === 'AWAITING_DISPATCH' || inc.status === 'CLASSIFIED') inc.status = 'ON_SCENE';
      if (inc.sceneAt === null) inc.sceneAt = st.time + 6;
      const call = this.callFor(inc);
      if (call && call.state === 'active') call.pending.push({ at: st.time + 1.6, text: spontaneous(this.env(call), 'arrived') });
    }
  }

  private nearestLandmarkName(fromNode: number, kind: string): string {
    const n = this.city.nodes[fromNode];
    let best = '', bd = Infinity;
    for (const l of this.city.landmarks) if (l.kind === kind) { const m = this.city.nodes[l.nodeId]; const d = Math.hypot(m.x - n.x, m.y - n.y); if (d < bd) { bd = d; best = l.name; } }
    return best;
  }
  private nearestHospitalNode(fromNode: number): number {
    const n = this.city.nodes[fromNode];
    const open = this.city.hospitals.filter((h) => !this.state.closedHospitals.includes(h));
    let best = open[0] ?? this.city.hospitals[0], bd = Infinity;
    for (const h of open.length ? open : this.city.hospitals) { const m = this.city.nodes[h]; const d = Math.hypot(m.x - n.x, m.y - n.y); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  private transportsNeeded(inc: Incident): number {
    const r = inc.requires.find((x) => x.cap === 'transport');
    return r ? r.n : 0;
  }

  // ── Incident simulation ───────────────────────────────────────────────────
  onScene(inc: Incident): Unit[] {
    return inc.assignedUnits.map((id) => this.state.units[id]).filter((u) => u && u.status === 'ON_SCENE' && this.unitAtScene(u, inc));
  }

  private updateIncidents(dt: number) {
    const st = this.state;
    for (const inc of Object.values(st.incidents)) {
      if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      if (inc.truth.outside) continue;
      if (inc.duplicateOf) { this.updateDuplicate(inc); continue; }
      if (inc.pursuit && inc.mover) { this.updatePursuit(inc, dt); continue; }
      const here = this.onScene(inc);
      // scene size-up report
      if (here.length && inc.sceneAt !== null && st.time >= inc.sceneAt && !inc.sceneSeen) this.sceneReport(inc, here[0]);
      // auto-expire pointless no-response items
      if (inc.requires.length === 0) {
        if (here.length && inc.sceneSeen) { this.closeIncident(inc, 'false_alarm'); continue; }
        if (!here.length && inc.answeredAt !== null && !this.callFor(inc) && st.time - inc.answeredAt > 100) { this.closeIncident(inc, 'false_alarm', true); continue; }
        continue;
      }
      if (inc.status === 'STABILIZING') {
        if (!inc.needsTransport || this.transportsNeeded(inc) === 0) { inc.stabilizeTimer -= dt; if (inc.stabilizeTimer <= 0) this.resolveIncident(inc, 'success'); }
        continue;
      }
      const cov = matchCoverage(inc.requires, here);
      const usedUnits = here.filter((u) => cov.used.has(u.id));
      const eff = usedUnits.length ? usedUnits.reduce((s, u) => s + this.unitEffectiveness(u), 0) / usedUnits.length : 1;
      const f = cov.f;
      // threat grows without adequate response, subsides with it
      inc.threat += inc.growth * (1 - f) * dt - inc.clear * eff * f * f * 0.35 * dt;
      inc.threat = Math.max(0, inc.threat);
      if (f > 0 && here.length) inc.workProgress += dt * eff * f * f;
      if (inc.status === 'ESCALATING' && st.time - (inc.escalatedAt ?? 0) > 10) inc.status = here.length ? 'ON_SCENE' : inc.assignedUnits.length ? 'UNITS_EN_ROUTE' : 'AWAITING_DISPATCH';
      if (inc.threat >= 100) { this.escalate(inc); continue; }
      if (inc.workProgress >= inc.work && f >= 1) this.completeWork(inc, here);
      // caller impatience when a promise has not been kept
      this.checkPromise(inc);
    }
  }

  private checkPromise(inc: Incident) {
    const st = this.state;
    const call = this.callFor(inc);
    if (!call || call.state !== 'active' || call.promiseAt === null) return;
    if (inc.assignedUnits.length === 0 && st.time - call.promiseAt > 40 && call.complained < 2 && !call.pending.length) {
      call.complained++;
      call.promiseAt = st.time;
      call.mood.trust = Math.max(0, call.mood.trust - 15); call.mood.base = Math.min(100, call.mood.base + 12); call.mood.frustration = Math.min(100, call.mood.frustration + 10);
      call.pending.push({ at: st.time + 1.2, text: spontaneous(this.env(call), 'broken_promise') });
      st.stats.promisesBroken++;
    }
  }

  private sceneReport(inc: Incident, u: Unit) {
    const st = this.state;
    inc.sceneSeen = true;
    inc.sceneReported = true;
    const tpl = this.instanceTemplate(inc);
    if (inc.twist && !inc.twistRevealed) {
      this.revealTwist(inc, 'scene');
      this.radio(u.spoken, `Dispatch, ${u.spoken}. ${inc.twist.scene}`, 'unit', u.id, inc.id);
    } else {
      this.radio(u.spoken, `Dispatch, ${u.spoken}. ${fill(tpl.scene, inc.vars) || 'Scene assessed.'}`, 'unit', u.id, inc.id);
    }
    inc.knownReqs = inc.requires.map((r) => ({ ...r }));
    const cov = matchCoverage(inc.requires, this.onScene(inc).concat(inc.assignedUnits.map((id) => st.units[id]).filter((x) => x && x.status !== 'ON_SCENE')));
    if (cov.missing.length) this.radio(u.spoken, `Dispatch, requesting ${reqText(cov.missing)} at this location.`, 'unit', u.id, inc.id);
    for (const [k, v] of Object.entries(inc.truth)) if (['fire', 'smoke', 'injured', 'trapped', 'vehicles', 'hazard', 'people'].includes(k) && inc.facts.every((x) => x.key !== k)) this.addFact(inc, k, v, 'confirmed', 'scene');
    // upgrade confidence of existing
    for (const x of inc.facts) if (x.confidence === 'unconfirmed' && inc.truth[x.key] === x.value) x.confidence = 'confirmed';
  }

  private escalate(inc: Incident) {
    const st = this.state;
    if (inc.stage >= inc.maxStage) { this.failIncident(inc); return; }
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    const esc = tpl.escalate![inc.stage];
    inc.stage++;
    inc.severity = Math.min(5, inc.severity + (esc.sev ?? 1));
    inc.requires = mergeReqs(inc.requires, esc.reqs.map((r) => adaptReqForRank(r, st.rank)));
    inc.threat = 52;
    inc.escalatedAt = st.time; inc.lastStageAt = st.time;
    inc.status = 'ESCALATING';
    inc.workProgress *= 0.6;
    if (esc.casualties) { inc.casualties += esc.casualties; st.stats.casualties += esc.casualties; }
    st.stats.escalations++;
    this.fx('bad', inc.reportedNode ?? inc.nodeId, 'Escalating!');
    this.log('escalation', `${inc.label} escalated: ${esc.text}`, { incidentId: inc.id, good: false });
    this.notify(`ESCALATION — ${inc.label}: ${esc.text}`, 'bad', inc.id);
    this.emit({ type: 'alert', text: esc.text });
    const here = this.onScene(inc);
    if (here.length) { inc.knownReqs = inc.requires.map((r) => ({ ...r })); this.radio(here[0].spoken, `Dispatch, ${esc.text.toLowerCase()}. Requesting ${reqText(matchCoverage(inc.requires, here).missing)}.`, 'alert', here[0].id, inc.id); }
    const call = this.callFor(inc);
    if (call && call.state === 'active') call.pending.push({ at: st.time + 1.3, text: spontaneous(this.env(call), 'escalated') });
    else if (inc.answeredAt !== null && !call) inc.callbackAt = st.time + 12 + this.rng.range(0, 10);
  }

  private failIncident(inc: Incident) {
    const st = this.state;
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    let cas = 0;
    if (tpl.lethal) cas = 1 + (inc.category === 'fire' || inc.severity >= 5 ? 1 : 0);
    else if (inc.category === 'fire') cas = this.rng.chance(inc.safetyAdvised ? 0.2 : 0.6) ? 1 : 0;
    else if (inc.pursuit) cas = this.rng.chance(0.2) ? 1 : 0;
    else if (inc.category === 'police' && inc.severity >= 3) cas = this.rng.chance(0.4) ? 1 : 0;
    if (inc.safetyAdvised && cas > 1) cas--;
    inc.casualties += cas; st.stats.casualties += cas;
    this.finishIncident(inc, cas > 0 ? 'failed' : 'partial');
    inc.lostReason = TEMPLATE_BY_ID[inc.templateId].failed;
    this.notify(`FAILED — ${inc.label}: ${tpl.failed}${cas ? ` (${cas} casualt${cas === 1 ? 'y' : 'ies'})` : ''}`, 'bad', inc.id);
    this.log('failed', `${inc.label}: ${tpl.failed}`, { incidentId: inc.id, good: false });
    st.stats.failed++;
    this.emit({ type: 'failed', incidentId: inc.id });
    // lasting damage is applied at shift end through the profile (see persistence of city state)
    const call = this.callFor(inc);
    if (call && call.state === 'active') call.pending.push({ at: st.time + 1, text: '(sobbing) ...no...' });
  }

  private completeWork(inc: Incident, here: Unit[]) {
    const st = this.state;
    inc.status = 'STABILIZING';
    inc.stabilizeTimer = 5;
    if (inc.needsTransport && this.transportsNeeded(inc) > 0) {
      const carriers = here.filter((u) => u.capabilities.includes('transport'));
      const n = this.transportsNeeded(inc);
      carriers.slice(0, n).forEach((u) => {
        const hosp = this.nearestHospitalNode(inc.nodeId);
        u.status = 'TRANSPORTING'; u.patients = 1; this.routeUnit(u, hosp, true);
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Transporting to ${this.nearestLandmarkName(hosp, 'hospital')}.`, 'unit', u.id, inc.id);
      });
      // release everything not carrying a patient
      for (const u of [...here]) if (u.status === 'ON_SCENE') this.releaseUnit(u, inc);
      inc.stabilizeTimer = 9999;
    } else {
      // release non-needed units later at resolution
    }
    this.log('info', `${inc.label}: scene stabilised`, { incidentId: inc.id });
    void st;
  }

  private releaseUnit(u: Unit, inc: Incident, silent = false) {
    inc.assignedUnits = inc.assignedUnits.filter((x) => x !== u.id);
    u.assignedIncidentId = undefined;
    if (u.temp) { delete this.state.units[u.id]; return; }
    u.status = 'BUSY'; u.timer = 6;
    u.destNode = null;
    if (!silent) this.radio(u.spoken, `Dispatch, ${u.spoken}. Clear of the scene, returning to service.`, 'unit', u.id, inc.id);
  }

  private resolveIncident(inc: Incident, outcome: Outcome) {
    const st = this.state;
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    // surplus units
    const here = inc.everAssigned.map((id) => st.units[id]).filter((u) => u && u.assignedIncidentId === inc.id && ['ON_SCENE', 'EN_ROUTE', 'DISPATCHED'].includes(u.status));
    const assigned = inc.everAssigned.map((id) => st.units[id]).filter((u): u is Unit => !!u);
    const base = matchCoverage(inc.requires, assigned).f;
    let surplus = 0;
    for (const u of assigned) {
      if (matchCoverage(inc.requires, assigned.filter((x) => x.id !== u.id)).f >= base) surplus++;
    }
    surplus = Math.min(surplus, Math.max(0, assigned.length - 1));
    inc.unnecessary += surplus;
    st.stats.unnecessary += inc.unnecessary;
    for (const u of here) { if (u.status === 'ON_SCENE') this.releaseUnit(u, inc); else { this.detach(u); u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false); } }
    inc.saved = Math.max(1, Number(typeof inc.truth.injured === 'number' ? inc.truth.injured : 0), Number(typeof inc.truth.trapped === 'number' ? inc.truth.trapped : 0));
    this.finishIncident(inc, inc.casualties > 0 ? 'partial' : inc.stage > 1 ? 'partial' : outcome);
    if (['medical', 'fire'].includes(inc.category) && tpl.sev[0] >= 3) st.stats.livesHelped += inc.saved; else if (inc.category === 'police' && inc.severity >= 3) st.stats.livesHelped += 1;
    this.notify(`Resolved — ${inc.label}`, 'good', inc.id);
    this.log('resolved', `${inc.label} resolved: ${tpl.resolved}`, { incidentId: inc.id, good: true });
    const call = this.callFor(inc);
    if (call && call.state === 'active') call.pending.push({ at: st.time + 1.5, text: spontaneous(this.env(call), 'resolved') });
    this.emit({ type: 'resolved', incidentId: inc.id });
  }

  private closeIncident(inc: Incident, outcome: Outcome, quiet = false) {
    const st = this.state;
    for (const uid of [...inc.assignedUnits]) {
      const u = st.units[uid];
      if (u) {
        if (u.status === 'ON_SCENE' || u.status === 'EN_ROUTE' || u.status === 'DISPATCHED') { inc.unnecessary++; st.stats.unnecessary++; this.detach(u, true); if (u.status === 'ON_SCENE') this.radio(u.spoken, `Dispatch, ${u.spoken}. No emergency found, returning to service.`, 'unit', u.id, inc.id); u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false); }
      }
    }
    this.finishIncident(inc, outcome);
    if (outcome === 'false_alarm') { st.stats.falseAlarms++; if (!quiet) { this.notify(`Closed — ${inc.label} (no emergency)`, 'good', inc.id); this.log('resolved', `${inc.label}: confirmed no emergency`, { incidentId: inc.id, good: true }); } }
    this.emit({ type: 'resolved', incidentId: inc.id });
  }

  private finishIncident(inc: Incident, outcome: Outcome) {
    const st = this.state;
    inc.outcome = outcome; inc.status = 'RESOLVED'; inc.resolvedAt = st.time;
    inc.assignedUnits = [];
    if (inc.blockedEdge !== null) inc.blockedEdge = null;
    if (outcome === 'merged') return;
    const cat = st.stats.byCategory[inc.category] ?? { n: 0, ok: 0 };
    cat.n++; if (outcome === 'success' || outcome === 'false_alarm') cat.ok++;
    st.stats.byCategory[inc.category] = cat;
    const where = inc.reportedNode ?? inc.nodeId;
    if (outcome === 'success' || outcome === 'false_alarm') { st.streak++; st.stats.bestStreak = Math.max(st.stats.bestStreak, st.streak); }
    else st.streak = 0;
    if (outcome !== 'failed') {
      st.stats.resolved++;
      const q = outcome === 'success' || outcome === 'false_alarm' ? 1 : 0.55;
      const streakMult = 1 + Math.min(0.5, 0.05 * Math.max(0, st.streak - 1));
      const bonus = Math.round((outcome === 'false_alarm' ? 250 : 900 * inc.severity * q) * streakMult * modProduct(st.config, 'bonus'));
      st.stats.bonus += bonus; st.budget += bonus;
      this.fx(q === 1 ? 'good' : 'warn', where, `+$${bonus.toLocaleString('en-US')}${st.streak >= 3 ? `  ×${streakMult.toFixed(2)}` : ''}`);
    } else this.fx('bad', where, 'Failed');
    // remaining duplicate callers are folded into this record
    for (const o of Object.values(st.incidents)) if (o.duplicateOf === inc.id && !['RESOLVED', 'CLOSED'].includes(o.status)) this.mergeDuplicate(o, inc, false, true);
    // callers who were told help is coming but nothing happened: nothing more to do
    for (const c of Object.values(st.calls)) if (c.incidentId === inc.id && (c.state === 'hold')) this.endCall(c.id, 'resolved');
    // close any temporary mutual-aid units
    // then archive after a short delay (status CLOSED is set by cleanup)
  }

  // ── Duplicate callers ─────────────────────────────────────────────────────
  private spawnDuplicates() {
    const st = this.state;
    for (const inc of Object.values(st.incidents)) {
      if (!inc.dupPlan?.length || st.time < inc.dupPlan[0]) continue;
      inc.dupPlan.shift();
      if (['RESOLVED', 'CLOSED'].includes(inc.status) || inc.hidden || st.time > st.config.durationSec - 25) continue;
      const archetype = this.rng.pick(['witness', 'witness', 'worried_neighbor', 'angry_motorist', 'shopkeeper', 'calm_serious']);
      this.spawnIncident(inc.templateId, inc.district, { duplicateOf: inc, archetype });
    }
  }

  private updateDuplicate(inc: Incident) {
    const st = this.state;
    const src = inc.duplicateOf ? st.incidents[inc.duplicateOf] : undefined;
    if (!src || ['RESOLVED', 'CLOSED'].includes(src.status)) { this.mergeDuplicate(inc, src ?? null, false, true); return; }
    // units sent to the duplicate discover the original response there
    const here = inc.assignedUnits.map((id) => st.units[id]).filter((u) => u && u.status === 'ON_SCENE' && this.unitAtScene(u, inc));
    if (here.length) {
      this.radio(here[0].spoken, `Dispatch, ${here[0].spoken}. This is the same incident as INC-${String(src.num).padStart(4, '0')} — joining that response.`, 'unit', here[0].id, src.id);
      this.mergeDuplicate(inc, src, false);
    }
  }

  /** fold a duplicate record into its source incident */
  private mergeDuplicate(dup: Incident, src: Incident | null, linked: boolean, quiet = false) {
    const st = this.state;
    const srcOpen = !!src && !['RESOLVED', 'CLOSED'].includes(src.status);
    for (const uid of [...dup.assignedUnits]) {
      const u = st.units[uid];
      dup.assignedUnits = dup.assignedUnits.filter((x) => x !== uid);
      if (!u) continue;
      if (srcOpen && src) {
        u.assignedIncidentId = src.id;
        if (!src.assignedUnits.includes(uid)) src.assignedUnits.push(uid);
        if (!src.everAssigned.includes(uid)) src.everAssigned.push(uid);
        if (src.firstDispatchAt === null) src.firstDispatchAt = dup.firstDispatchAt;
      } else if (['ON_SCENE', 'EN_ROUTE', 'DISPATCHED'].includes(u.status)) {
        u.assignedIncidentId = undefined; u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false);
      }
    }
    if (srcOpen && src) {
      if (src.reportedNode === null && dup.reportedNode !== null) { src.reportedNode = dup.reportedNode; src.locatedAt = st.time; src.mislocated = Math.hypot(this.city.nodes[dup.reportedNode].x - this.city.nodes[src.nodeId].x, this.city.nodes[dup.reportedNode].y - this.city.nodes[src.nodeId].y) > 90; }
      for (const f of dup.facts) if (!src.facts.some((x) => x.key === f.key && x.value === f.value)) src.facts.push({ ...f });
      for (const c of Object.values(st.calls)) if (c.incidentId === dup.id && ['active', 'hold', 'ringing'].includes(c.state)) c.incidentId = src.id;
      if (src.assignedUnits.length && ['REPORTED', 'AWAITING_INFORMATION', 'CLASSIFIED', 'AWAITING_DISPATCH'].includes(src.status)) src.status = 'UNITS_EN_ROUTE';
      if (this.onScene(src).length && src.status === 'UNITS_EN_ROUTE') src.status = 'ON_SCENE';
      this.refreshIncidentStatus(src);
    }
    dup.mergedInto = src?.id ?? null;
    this.finishIncident(dup, 'merged');
    if (linked && src) {
      st.stats.merges++;
      const b = Math.round(600 * modProduct(st.config, 'bonus'));
      st.stats.bonus += b; st.budget += b;
      this.fx('info', src.reportedNode ?? src.nodeId, `Linked +$${b}`);
      this.notify(`Linked duplicate call to INC-${String(src.num).padStart(4, '0')}`, 'good', src.id);
      this.log('resolved', `Duplicate call linked to ${src.label}`, { incidentId: src.id, good: true });
    } else if (!quiet && src) this.log('info', `Duplicate report merged into ${src.label}`, { incidentId: src.id });
    if (st.selected.kind === 'incident' && st.selected.id === dup.id && src) this.select('incident', src.id);
  }

  /** dispatcher decision: "this call is about that incident" */
  linkIncident(aId: string, bId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const a = st.incidents[aId], b = st.incidents[bId];
    const open = (i?: Incident) => !!i && !['RESOLVED', 'CLOSED'].includes(i.status);
    if (!open(a) || !open(b) || aId === bId) return { ok: false, reason: 'Both incidents must be open' };
    const related = a.duplicateOf === b.id || b.duplicateOf === a.id || (a.duplicateOf !== null && a.duplicateOf === b.duplicateOf);
    if (related) {
      if (a.duplicateOf === b.id) this.mergeDuplicate(a, b, true);
      else if (b.duplicateOf === a.id) this.mergeDuplicate(b, a, true);
      else { const src = st.incidents[a.duplicateOf!]; this.mergeDuplicate(a, open(src) ? src : b, true); }
      return { ok: true };
    }
    // they were different emergencies: the linked call drops out of sight and will get worse
    a.hidden = true; a.dismissed = true; a.callbackAt = st.time + 40 + this.rng.range(0, 12);
    for (const uid of [...a.assignedUnits]) this.recall(uid);
    for (const c of Object.values(st.calls)) if (c.incidentId === a.id && (c.state === 'active' || c.state === 'hold')) this.endCall(c.id);
    st.stats.wrongLinks++; st.streak = 0;
    this.notify(`Linked to INC-${String(b.num).padStart(4, '0')}`, 'info', b.id);
    this.log('failed', `${a.label} linked to an unrelated incident`, { incidentId: a.id, good: false });
    this.select('incident', b.id);
    return { ok: true };
  }

  /** open incidents near this one that could be the same emergency */
  duplicateCandidates(incId: string): Array<{ inc: Incident; dist: number }> {
    const st = this.state;
    const a = st.incidents[incId];
    if (!a) return [];
    const anchors: number[] = [];
    if (a.reportedNode !== null) anchors.push(a.reportedNode);
    for (const c of Object.values(st.calls)) if (c.incidentId === a.id) for (const h of c.heard) if (h.reliability !== 'contradicted' && h.source !== 'district') anchors.push(h.nodeId);
    if (!anchors.length) return [];
    const out: Array<{ inc: Incident; dist: number }> = [];
    for (const b of Object.values(st.incidents)) {
      if (b.id === a.id || b.hidden || b.reportedNode === null || ['RESOLVED', 'CLOSED'].includes(b.status)) continue;
      const bn = this.city.nodes[b.reportedNode];
      const d = Math.min(...anchors.map((n) => Math.hypot(this.city.nodes[n].x - bn.x, this.city.nodes[n].y - bn.y)));
      if (d < 280) out.push({ inc: b, dist: d * 4 });
    }
    return out.sort((x, y) => x.dist - y.dist).slice(0, 3);
  }

  // ── Pursuits ──────────────────────────────────────────────────────────────
  private chooseEscape(m: NonNullable<Incident['mover']>, chasers: Unit[]): number {
    const city = this.city;
    const opts = city.adj[m.prev].map((eid) => city.edges[eid]).filter((e) => !this.closedMask[e.id]);
    if (!opts.length) return m.prev;
    let best = -1, bs = -Infinity;
    for (const e of opts) {
      const n = e.a === m.prev ? e.b : e.a;
      const nn = city.nodes[n];
      let score = this.rng.next() * 22 + (e.cls === 'arterial' || e.cls === 'highway' ? 9 : 0) + (n === m.came ? -60 : 0);
      if (chasers.length) score += Math.min(...chasers.map((u) => Math.hypot(u.x - nn.x, u.y - nn.y))) * 0.05;
      if (score > bs) { bs = score; best = n; }
    }
    return best;
  }

  private updatePursuit(inc: Incident, dt: number) {
    const st = this.state, city = this.city, m = inc.mover!;
    if (inc.status === 'STABILIZING') return;
    const assigned = inc.assignedUnits.map((id) => st.units[id]).filter((u): u is Unit => !!u);
    const contacts = assigned.filter((u) => (u.status === 'ON_SCENE' && u.note === 'In pursuit') || (u.status === 'EN_ROUTE' && Math.hypot(u.x - m.x, u.y - m.y) < 42));
    if (contacts.length && m.contact === 0) {
      const u = contacts[0];
      this.radio(u.spoken, `Dispatch, ${u.spoken}. Suspect vehicle in sight — in pursuit!`, 'alert', u.id, inc.id);
      inc.sceneSeen = true; inc.sceneReported = true; inc.knownReqs = inc.requires.map((r) => ({ ...r }));
      if (inc.firstArrivalAt === null) { inc.firstArrivalAt = st.time; const rt = st.time - (inc.answeredAt ?? inc.createdAt); st.stats.responseTimes.push(rt); st.stats.serviceResponse.police.push(rt); }
      if (inc.status !== 'ESCALATING') inc.status = 'ON_SCENE';
    }
    m.contact = contacts.length;
    // the suspect keeps driving unless boxed in
    if (st.time >= m.startAt && contacts.length < 2) {
      let remaining = m.speed * TIME_COMPRESS / 2.4 * WEATHER_SPEED[st.weather] * (contacts.length ? 0.45 : 1) * dt;
      let guard = 0;
      while (remaining > 1e-6 && guard++ < 8) {
        if (m.next < 0) m.next = this.chooseEscape(m, assigned);
        const tgt = city.nodes[m.next];
        const dx = tgt.x - m.x, dy = tgt.y - m.y, d = Math.hypot(dx, dy);
        if (d <= remaining || d < 1e-3) { m.x = tgt.x; m.y = tgt.y; remaining -= d; m.came = m.prev; m.prev = m.next; m.next = -1; if (d < 1e-3 && guard > 3) break; }
        else { m.x += (dx / d) * remaining; m.y += (dy / d) * remaining; m.heading = Math.atan2(dy, dx); remaining = 0; }
      }
      const last = m.trail[m.trail.length - 1];
      if (!last || Math.hypot(last.x - m.x, last.y - m.y) > 10) { m.trail.push({ x: m.x, y: m.y }); if (m.trail.length > 26) m.trail.shift(); }
    }
    const dPrev = Math.hypot(city.nodes[m.prev].x - m.x, city.nodes[m.prev].y - m.y);
    inc.nodeId = m.next >= 0 && Math.hypot(city.nodes[m.next].x - m.x, city.nodes[m.next].y - m.y) < dPrev ? m.next : m.prev;
    inc.district = city.nodes[inc.nodeId].district;
    // crews in contact stay on the suspect's tail
    contacts.forEach((u, i) => {
      u.status = 'ON_SCENE'; u.note = 'In pursuit'; u.route = []; u.eta = 0; u.destNode = null;
      const ang = m.heading + Math.PI + (i - (contacts.length - 1) / 2) * 0.7;
      u.x = m.x + Math.cos(ang) * 14; u.y = m.y + Math.sin(ang) * 14; u.prevNode = m.prev;
    });
    // tracking: a caller still following, or crews with eyes on it, keep the location live
    const call = this.callFor(inc);
    const following = !!call && call.state === 'active' && st.time - (call.answeredAt ?? st.time) < 160;
    m.tracked = following || contacts.length > 0 || assigned.some((u) => Math.hypot(u.x - m.x, u.y - m.y) < 230);
    if (inc.reportedNode !== null) {
      if (m.tracked && st.time - m.lastUpdate >= 2.5) { m.lastUpdate = st.time; inc.reportedNode = inc.nodeId; }
      else if (!m.tracked && st.time - m.lastSighting > 22) {
        m.lastSighting = st.time;
        if (this.rng.chance(0.6)) {
          inc.reportedNode = inc.nodeId;
          this.radio('DISPATCH', `All units, suspect vehicle sighted near ${addressOf(city, inc.nodeId)}.`, 'dispatch', undefined, inc.id);
          this.notify(`Sighting: suspect vehicle near ${addressOf(city, inc.nodeId)}`, 'warn', inc.id);
        }
      }
    }
    if (following && call && st.time >= m.startAt && st.time - call.lastSpontaneous > 11 && !call.pending.length) {
      const n = city.nodes[inc.nodeId];
      const lines = [`He's on ${n.addrStreet} now, near ${n.crossStreet}!`, `Turning onto ${n.addrStreet}! He's still going!`, `We're passing ${n.crossStreet} — he's not stopping!`, `${n.addrStreet}, heading toward ${n.crossStreet}. I can't keep up much longer!`];
      call.pending.push({ at: st.time + 0.4, text: this.rng.pick(lines), heard: [{ nodeId: inc.nodeId, label: `Suspect at ${n.addrStreet} & ${n.crossStreet} (live)`, source: 'cross', reliability: 'sure' }] });
      call.lastSpontaneous = st.time;
    }
    // risk to the public grows until the car is stopped
    if (contacts.length) {
      inc.threat = Math.max(0, inc.threat - 0.6 * dt);
      const eff = contacts.reduce((s, u) => s + this.unitEffectiveness(u), 0) / contacts.length;
      inc.workProgress += dt * eff * (contacts.length >= 2 ? 3 : 1);
      if (inc.workProgress >= inc.work) {
        this.radio(contacts[0].spoken, `Dispatch, ${contacts[0].spoken}. Suspect vehicle stopped, driver in custody.`, 'unit', contacts[0].id, inc.id);
        st.stats.pursuitsCaught++;
        this.fx('good', inc.nodeId, 'Suspect detained');
        inc.reportedNode = inc.nodeId;
        this.resolveIncident(inc, 'success');
        return;
      }
    } else if (st.time >= m.startAt) inc.threat += inc.growth * dt;
    if (inc.status === 'ESCALATING' && st.time - (inc.escalatedAt ?? 0) > 10) inc.status = contacts.length ? 'ON_SCENE' : inc.assignedUnits.length ? 'UNITS_EN_ROUTE' : inc.reportedNode !== null ? 'AWAITING_DISPATCH' : inc.status;
    if (inc.threat >= 100) this.escalate(inc);
  }

  // ── Mutual aid ────────────────────────────────────────────────────────────
  requestMutualAid(incId: string, cap: Capability): { ok: boolean; reason?: string } {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || inc.reportedNode === null) return { ok: false, reason: 'Set the incident location first' };
    if (inc.mutualAid >= 2) return { ok: false, reason: 'Mutual aid limit reached for this incident' };
    const defs = Object.values(UNIT_TYPE_BY_ID).filter((d) => d.caps.includes(cap)).sort((a, b) => a.cost - b.cost);
    const def = defs[0];
    if (!def) return { ok: false, reason: 'No such resource' };
    const cost = 4000;
    inc.mutualAid++; st.stats.mutualAid++;
    st.stats.costs += cost; st.budget -= cost;
    // enters from the nearest edge of the city
    const n = this.city.nodes[inc.reportedNode];
    const edgeNodes = this.city.nodes.filter((x) => x.i === 0 || x.i === 40 || x.j === 0);
    let best = edgeNodes[0], bd = Infinity;
    for (const e of edgeNodes) { const d = Math.hypot(e.x - n.x, e.y - n.y); if (d < bd) { bd = d; best = e; } }
    const fakeStation: Station = { id: 'mutual', name: 'Mutual aid', service: def.service, nodeId: best.id, district: best.district, capacity: 99, disabledShifts: 0 };
    const idn = 9000 + Object.keys(st.units).length + st.uniqueNameCounter++;
    const u = makeUnit(def, fakeStation, Object.values(st.units), idn);
    u.id = `ma${idn}`; u.callsign = `MA-${numWord(st.uniqueNameCounter).toUpperCase()}`; u.spoken = `Mutual Aid ${numWord(st.uniqueNameCounter)}`;
    u.temp = true; u.minCrew = 0; u.stationId = 'mutual'; u.speedModifier = def.speed * 0.95; u.timer = 18; u.postNode = best.id;
    st.units[u.id] = u;
    this.notify(`Mutual aid requested: ${CAP_LABEL[cap]} (−$${cost.toLocaleString()})`, 'info', incId);
    this.dispatch(u.id, incId);
    return { ok: true };
  }

  // ── Radio queries ─────────────────────────────────────────────────────────
  radioQuery(unitId: string): string {
    const st = this.state;
    const u = st.units[unitId];
    if (!u) return '';
    this.radio('DISPATCH', `${u.spoken}, status check.`, 'dispatch', u.id);
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    const eta = u.eta ?? 0;
    const t = eta >= 60 ? `about ${Math.round(eta / 60)} minute${Math.round(eta / 60) === 1 ? '' : 's'}` : `${Math.max(5, Math.round(eta / 5) * 5)} seconds`;
    let msg: string;
    switch (u.status) {
      case 'AVAILABLE': msg = `Dispatch, ${u.spoken}. Available${u.postNode ? ` at ${addressOf(this.city, u.postNode)}` : ''}.`; break;
      case 'DISPATCHED': msg = `Dispatch, ${u.spoken}. Mobilising now.`; break;
      case 'EN_ROUTE': msg = `Dispatch, ${u.spoken}. En route to ${inc ? addressOf(this.city, inc.reportedNode ?? inc.nodeId) : 'the scene'}, ${t} out.`; break;
      case 'ON_SCENE': {
        if (inc) {
          const cov = matchCoverage(inc.requires, this.onScene(inc));
          msg = u.note === 'Nothing found' ? `Dispatch, ${u.spoken}. Still nothing at this address. Need a verified location.` : cov.missing.length && inc.sceneSeen ? `Dispatch, ${u.spoken}. On scene — we could use ${reqText(cov.missing)}.` : `Dispatch, ${u.spoken}. On scene, working the incident.`;
        } else msg = `Dispatch, ${u.spoken}. On scene.`;
        break;
      }
      case 'TRANSPORTING': msg = `Dispatch, ${u.spoken}. Transporting, ${t} from the hospital.`; break;
      case 'RETURNING': msg = `Dispatch, ${u.spoken}. Returning to ${addressOf(this.city, u.postNode)}, ${t} out.`; break;
      case 'BUSY': msg = `Dispatch, ${u.spoken}. Tied up for a few more moments.`; break;
      default: msg = `Dispatch, ${u.spoken}. Out of service${u.note ? ` — ${u.note.toLowerCase()}` : ''}.`;
    }
    this.radio(u.spoken, msg, 'unit', u.id, inc?.id);
    return msg;
  }

  // ── Coverage ──────────────────────────────────────────────────────────────
  coverageTimes(service: Service): Float32Array {
    const c = this.covCache[service];
    if (c && this.state.time - c.t < 3) return c.times;
    const sources: Array<{ node: number; offset: number }> = [];
    for (const u of Object.values(this.state.units)) {
      if (u.service !== service || u.temp) continue;
      if (u.status === 'AVAILABLE') sources.push({ node: u.prevNode, offset: this.mobilizationTime(u) });
      else if (u.status === 'RETURNING' && u.destNode !== null && !u.assignedIncidentId) sources.push({ node: u.destNode, offset: this.mobilizationTime(u) + Math.max(0, (u.eta ?? 0)) });
    }
    const times = sources.length ? multiSourceTimes(this.city, sources, this.tm(true), 1) : new Float32Array(this.city.nodes.length).fill(Infinity);
    this.covCache[service] = { t: this.state.time, times };
    return times;
  }
  sampleCoverage() {
    const st = this.state;
    const thr = 100;
    const active = st.config.districts;
    const nodeIds = active.flatMap((d) => this.city.nodesInDistrict[d]);
    const cov: Record<string, number[]> = {};
    for (const s of ['police', 'fire', 'medical'] as const) {
      const t = this.coverageTimes(s);
      const ok = nodeIds.filter((n) => t[n] <= thr).length / Math.max(1, nodeIds.length);
      st.stats.coverageSamples[s].push(ok);
      for (const d of active) {
        const ids = this.city.nodesInDistrict[d];
        (cov[d] ??= []).push(ids.filter((n) => t[n] <= thr).length / ids.length / 3);
      }
    }
    for (const d of Object.keys(cov)) {
      const sum = cov[d].reduce((a, b) => a + b, 0);
      (st.stats.districtCoverage[d] ??= []).push(sum);
    }
    st.lastCoverage = (st.stats.coverageSamples.police.at(-1)! + st.stats.coverageSamples.fire.at(-1)! + st.stats.coverageSamples.medical.at(-1)!) / 3;
  }

  // ── End of shift ──────────────────────────────────────────────────────────
  private checkEnd() {
    const st = this.state;
    // the tutorial finishes as soon as every scripted incident has been handled
    if (st.config.mode === 'tutorial' && st.config.script && st.scriptIndex >= st.config.script.length && st.time > 30) {
      const all = Object.values(st.incidents);
      if (all.length && all.every((i) => ['RESOLVED', 'CLOSED'].includes(i.status)) && !Object.values(st.calls).some((c) => c.state === 'ringing' || c.state === 'active' || c.state === 'hold')) {
        if (st.endingAt === null) st.endingAt = st.time + 6;
        if (st.time >= st.endingAt) { this.endShift(); return; }
      }
    }
    if (st.time < st.config.durationSec) return;
    const pendingCalls = Object.values(st.calls).some((c) => c.state === 'ringing' || c.state === 'active');
    if (pendingCalls && st.time < st.config.durationSec + 25) return;
    this.endShift();
  }
  endShift(early = false) {
    const st = this.state;
    if (st.phase === 'ended') return;
    st.phase = 'ended';
    for (const c of Object.values(st.calls)) if (c.state === 'ringing' || c.state === 'active' || c.state === 'hold') { c.state = c.state === 'ringing' ? 'missed' : 'ended'; c.endedAt = st.time; }
    for (const inc of Object.values(st.incidents)) {
      if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      if (inc.truth.outside) continue;
      if (inc.duplicateOf) { inc.outcome = 'merged'; inc.status = 'RESOLVED'; continue; }
      inc.outcome = inc.hidden ? 'lost' : 'handover';
      if (inc.hidden) { st.stats.mishandled++; if (TEMPLATE_BY_ID[inc.templateId].lethal) { st.stats.casualties++; inc.casualties++; } } else st.stats.handedOver++;
      this.log('failed', `${inc.label}: ${inc.hidden ? 'never handled' : 'handed over to the next shift'}`, { incidentId: inc.id, good: false });
    }
    void early;
    st.scoreBreakdown = computeScore(st);
    evaluateObjectives(st);
    this.log('info', `Shift complete — grade ${st.scoreBreakdown.grade}`);
    this.emit({ type: 'ended' });
  }
}

export { CLASSES };
export type { Fact, IncidentStatus, Service };
void ({} as Unit);
