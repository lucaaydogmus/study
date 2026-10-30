// The authoritative game engine: a deterministic, tick-based simulation of Ravenport dispatch.
// The UI only reads `engine.state` and calls the public action methods; the caller dialogue
// layer (dialogue.ts) can never mutate protected state directly — it only returns lines that the
// engine validates and applies.
import { addressOf, fullAddress, getCity, type City } from './city';
import { Rng } from './rng';
import { ARCHETYPES, CLASSES, CLASS_BY_ID, FACT_LABELS, adaptReqForRank, CAP_LABEL } from './content/vocab';
import { TEMPLATES, TEMPLATE_BY_ID, type Template } from './content/templates';
import { backgroundClue } from './content/clues';
import { aidVerdict, lifeThreatOf, FIRE_LIKE, TOPIC_FACTS, aliLookup, classifyIntent, makeCallerProfile, makeLocPlan, makeVars, fill, openingLines, replyTo, spontaneous, verifyReply, QUICK_QUESTIONS, type DialogueEnv, type Intent } from './dialogue';
import { EVENT_DEFS, WEATHER_SPEED, WEATHER_TRAFFIC, WEATHER_LABEL, nextWeather } from './events';
import { numWord, UNIT_TYPE_BY_ID, makeUnit, isAir, AIR_SPEED } from './fleet';
import { makeRequest, requestText, replyText, CHECK_LABEL, DANGEROUS } from './records';
import { edgeSpeed, findRoute, makeClosedMask, multiSourceTimes, routeTime, TIME_COMPRESS, type TrafficModel } from './routing';
import { computeScore, evaluateObjectives } from './scoring';
import { modProduct, MODIFIER_BY_ID } from './extras';
import type {
  Call, CallerProfile, CityEvent, CityState, Capability, Fact, FactVal, GameState, HeardLocation, Incident, IncidentStatus, Outcome, Personnel, Req,
  Service, ShiftConfig, ShiftStats, Station, Unit, UpgradeLevels, TimelineEntry, OfficerRequest, CheckResult,
} from './types';

export const DT = 0.5;
/** topics a free-form AI answer may reveal, mapped to the fact keys the engine then records */
export const REVEAL_KEYS = TOPIC_FACTS as Record<string, string[]>;
export const STATE_VERSION = 1;
/** global pacing knob: scales how quickly unattended incidents deteriorate */
export const THREAT_SCALE = 0.55;

/** incidents where a helicopter overhead speeds up the job (searching, overwatch) */
export const AIR_HELPS = new Set(['lost_hiker', 'kidnapping', 'active_shooter', 'bank_robbery', 'hostage_barricade', 'water_rescue', 'boat_fire', 'escaped_animal', 'train_derailment', 'missing_person', 'brush_fire', 'crowd_crush', 'tanker_fire']);

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
  | { type: 'ai_request'; callId: string; lineIds: number[]; intent: string; playerText: string }
  | { type: 'resolved'; incidentId: string } | { type: 'failed'; incidentId: string } | { type: 'notify'; level: string } | { type: 'ended' } | { type: 'status'; unitId: string };

const emptyStats = (): ShiftStats => ({
  callsReceived: 0, callsAnswered: 0, callsMissed: 0, answerTimes: [], responseTimes: [], resolved: 0, failed: 0, falseAlarms: 0, mishandled: 0,
  casualties: 0, livesHelped: 0, unnecessary: 0, dispatches: 0, correctDispatches: 0, wrongLocations: 0, locationChecks: 0, costs: 0, income: 0, bonus: 0,
  coverageSamples: { police: [], fire: [], medical: [] }, districtCoverage: {}, serviceResponse: { police: [], fire: [], medical: [] },
  unitBusySeconds: 0, unitSeconds: 0, handedOver: 0, byCategory: {}, callbacks: 0, escalations: 0, promisesBroken: 0,
  merges: 0, wrongLinks: 0, pursuitsCaught: 0, verifiedOk: 0, cleanFalseAlarms: 0, bestStreak: 0, calmedCallers: 0, transfersOk: 0, mutualAid: 0, contractBonus: 0,
  aidGood: 0, aidBad: 0, unitCrashes: 0, breakdowns: 0, aiLines: 0,
  heliRelays: 0, heliSightings: 0, checksOk: 0, checksBad: 0, checksMissed: 0, guidanceDeaths: 0, guidanceSaves: 0, harmfulAdvice: 0,
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
    streak: 0, fx: [], fxCounter: 0, closedHospitals: [], lineCounter: 0,
    requests: [], requestCounter: 0, nextStopAt: config.script ? Infinity : 95 + rng.range(0, 70),
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
    state.fx ??= []; state.streak ??= 0; state.fxCounter ??= 0; state.closedHospitals ??= []; state.lineCounter ??= 0;
    state.requests ??= []; state.requestCounter ??= 0; state.nextStopAt ??= state.time + 120;
    // lines held for AI voicing cannot survive a reload: release their scripted text
    for (const c of Object.values(state.calls)) for (const l of c.pending) if (l.hold) { l.hold = false; l.at = state.time + 0.5; }
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
    this.processForced();
    this.updateEvents();
    this.updateWeather();
    if (st.time - this.lastTrafficUpdate >= 4) this.updateTraffic();
    this.spawnTick();
    this.updateCallbacks();
    this.updatePersonnel();
    this.updateWorkload();
    this.spawnDuplicates();
    this.updateRequests();
    this.trafficStops();
    if (!st.config.script) this.breakdowns();
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

  /** scenario set pieces: guaranteed incidents on top of the random ones */
  private processForced() {
    const st = this.state;
    const f = st.config.forced;
    if (!f) return;
    st.forcedIndex ??= 0;
    while (st.forcedIndex < f.length && st.time >= f[st.forcedIndex].at) {
      const s = f[st.forcedIndex++];
      const d = s.district && st.config.districts.includes(s.district) ? s.district : this.rng.pick(st.config.districts);
      this.spawnIncident(s.template, d, { archetype: s.archetype });
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
    const majorOpen = Object.values(st.incidents).some((i) => TEMPLATE_BY_ID[i.templateId]?.major && !['RESOLVED', 'CLOSED'].includes(i.status));
    for (const dId of cfg.districts) {
      const d = this.city.districtById[dId];
      if (!d) continue;
      for (const tpl of TEMPLATES) {
        if (tpl.minRank > Math.max(st.rank, 1)) continue;
        if (cfg.hideIntense && tpl.intense) continue;
        if (tpl.id === 'wrong_jurisdiction' && st.rank < 1) continue;
        if (tpl.spawnOnly) continue;
        if (tpl.major && (majorOpen || cfg.forced?.length)) continue;
        let w = 0;
        for (const tag of d.tags) w += tpl.w[tag] ?? 0;
        w += tpl.w[d.id] ?? 0;
        // runways, rail lines and terminals only exist in their own districts
        if (w <= 0 && (tpl.nodeHint === 'runway' || tpl.nodeHint === 'rail' || (tpl.w.airport && Object.keys(tpl.w).length === 1))) continue;
        if (w <= 0) w = 0.06;
        w *= d.weights[tpl.category];
        if (tpl.category === 'unusual') w *= cfg.unusualBias ?? 1;
        w *= tpl.weather?.[st.weather] ?? 1;
        w *= this.eventMult(tpl.category, tpl.id, d.id);
        if (night && tpl.category === 'police') w *= 1.35;
        if (night && tpl.id === 'burglary_progress') w *= 1.8;
        if (tpl.id === 'wrong_jurisdiction') w *= 0.35;
        if (tpl.major) w *= 0.3;
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
  spawnIncident(templateId: string, districtId: string, opts: { archetype?: string; accuracy?: CallerProfile['locationAccuracy']; severity?: number; forceEvent?: string; tutorial?: boolean; duplicateOf?: Incident; connectedTo?: Incident; noCall?: boolean; nodeId?: number } = {}): Incident {
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
    if (tpl.nodeHint) { const h = this.hintNodes(tpl.nodeHint, districtId, candidates); if (h.length) candidates = h; }
    if (!candidates.length) candidates = dNodes;
    const nodeId = src ? src.nodeId : opts.nodeId ?? rng.pick(candidates);
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
    const callId = opts.noCall ? null : `c${++st.callCounter}`;
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
      deadlineAt: tpl.deadline && !src ? st.time + tpl.deadline : null, deadlineMet: null, parentId: opts.connectedTo?.id ?? null,
    };
    if (src) { inc.label = src.label; inc.maxStage = 0; inc.growth = 0; inc.threat = 0; inc.district = src.district; inc.blockedEdge = null; }
    if (inc.pursuit) {
      const n = this.city.nodes[nodeId];
      inc.mover = { x: n.x, y: n.y, prev: nodeId, next: -1, came: -1, speed: tpl.pursuitSpeed ?? 5.6, tracked: true, trail: [], startAt: st.time + (opts.noCall ? 3 : 10), lastUpdate: st.time, lastSighting: st.time, contact: 0, heading: 0 };
    }
    // big incidents draw more than one caller
    const dupable = !src && !opts.tutorial && !tpl.pursuit && !tpl.outside && sev >= 3 && (tpl.category === 'fire' || tpl.id.startsWith('collision') || ['robbery', 'public_disturbance', 'domestic_disturbance', 'water_rescue', 'industrial_accident'].includes(tpl.id));
    if (tpl.dupes && !src && !opts.tutorial) {
      // major incidents light up the switchboard: several people phone about the same thing
      for (let k = 0; k < tpl.dupes; k++) if (k === 0 || rng.chance(Math.min(0.95, 0.7 * modProduct(st.config, 'dupes')))) inc.dupPlan.push(st.time + 14 + k * 24 + rng.range(0, 14));
    } else if (dupable && rng.chance(Math.min(0.95, 0.5 * modProduct(st.config, 'dupes')))) {
      inc.dupPlan.push(st.time + rng.range(18, 40));
      if (sev >= 4 && rng.chance(Math.min(0.9, 0.45 * modProduct(st.config, 'dupes')))) inc.dupPlan.push(st.time + rng.range(45, 75));
    }
    if (tpl.closesRoad && !src) {
      const eid = this.city.adj[nodeId].find((e) => this.city.edges[e].cls === 'local' || this.city.edges[e].cls === 'arterial');
      if (eid !== undefined && !st.closedEdges.includes(eid) && rng.chance(0.5)) { inc.blockedEdge = eid; }
    }
    st.incidents[id] = inc;
    if (opts.connectedTo) { inc.relatedIds.push(opts.connectedTo.id); opts.connectedTo.relatedIds.push(id); }
    if (!callId) {
      // reported over the radio, not by phone: location and basic facts are already known
      inc.answeredAt = st.time; inc.reportedNode = nodeId; inc.locationConfirmed = true; inc.locatedAt = st.time; inc.callerName = 'Unit report';
      for (const k of tpl.reported) if (k in truth) this.addFact(inc, k, truth[k], 'confirmed', 'scene');
      this.refreshIncidentStatus(inc);
      return inc;
    }
    // link to related open incidents of the same event
    if (inc.eventId) for (const o of Object.values(st.incidents)) if (o.id !== id && o.eventId === inc.eventId && o.district === inc.district && !['RESOLVED', 'CLOSED'].includes(o.status) && inc.relatedIds.length < 3) { inc.relatedIds.push(o.id); o.relatedIds.push(id); }
    const mood = { panic: profile.panicLevel, base: profile.panicLevel, cooperation: profile.cooperationLevel, frustration: Math.round(rng.range(arch.frustration[0], arch.frustration[1])), trust: 50 };
    void opts.noCall;
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

  /** where location-bound incidents can happen: on a runway, along the rail line, at the bank... */
  private hintNodes(hint: NonNullable<Template['nodeHint']>, districtId: string, base: number[]): number[] {
    const city = this.city;
    const all = city.nodesInDistrict[districtId] ?? [];
    const nearLm = (kinds: string[], r = 75) => {
      const out: number[] = [];
      for (const kind of kinds) {
        for (const l of city.landmarks) {
          if (l.kind !== kind || l.district !== districtId) continue;
          const c = city.nodes[l.nodeId];
          for (const n of base) if (Math.hypot(city.nodes[n].x - c.x, city.nodes[n].y - c.y) <= r) out.push(n);
        }
        if (out.length) return out;
      }
      return out;
    };
    switch (hint) {
      case 'runway': return all.filter((n) => { const m = city.nodes[n]; return m.j >= 3 && m.j <= 7 && m.i >= 31 && m.i <= 38; });
      case 'highway': return all.filter((n) => city.adj[n].some((e) => city.edges[e].cls === 'highway'));
      case 'rail': return all.filter((n) => { const j = city.nodes[n].j; return j === 20 || j === 21; });
      case 'water': return base.filter((n) => [17, 24].includes(city.nodes[n].j));
      case 'pool': return nearLm(['pool', 'park']);
      case 'stadium': return nearLm(['stadium', 'campus', 'plaza']);
      case 'mall': return nearLm(['mall', 'campus', 'market', 'plaza', 'airport']);
      case 'transit': return nearLm(['transit', 'airport', 'terminal', 'campus', 'plaza']);
      case 'bank': return nearLm(['bank', 'tower', 'plaza', 'market']);
    }
  }

  /** a new incident that breaks out of an existing one: a getaway van, a victim fleeing a shooting */
  private spawnConnected(parent: Incident, templateId: string, opts: { noCall?: boolean } = {}): Incident | null {
    const tpl = TEMPLATE_BY_ID[templateId];
    if (!tpl) return null;
    const st = this.state;
    const city = this.city;
    if (tpl.pursuit || opts.noCall) {
      const child = this.spawnIncident(templateId, parent.district, { connectedTo: parent, noCall: true, nodeId: parent.nodeId });
      this.radio('DISPATCH', tpl.pursuit ? `All units, ${child.label.toLowerCase()} from ${addressOf(city, parent.nodeId)}. Units at INC-${String(parent.num).padStart(4, '0')} may break off to pursue.` : `All units, ${child.label.toLowerCase()} at ${addressOf(city, parent.nodeId)}. All available units respond.`, 'alert', undefined, child.id);
      this.notify(`NEW — ${child.label} (from INC-${String(parent.num).padStart(4, '0')})`, 'bad', child.id);
      this.fx('bad', parent.nodeId, child.label);
      this.emit({ type: 'alert', text: child.label });
      return child;
    }
    const p = city.nodes[parent.nodeId];
    const near = (city.nodesInDistrict[parent.district] ?? []).filter((n) => { const d = Math.hypot(city.nodes[n].x - p.x, city.nodes[n].y - p.y); return d > 40 && d < 170 && city.adj[n].some((e) => city.edges[e].cls !== 'highway'); });
    const nodeId = near.length ? this.rng.pick(near) : parent.nodeId;
    void st;
    return this.spawnIncident(templateId, city.nodes[nodeId].district, { connectedTo: parent, nodeId });
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
      if (call.state === 'active' && !call.heardSirens && inc && !inc.pursuit) this.checkSirens(call, inc);
      // deliver pending lines (only on active calls)
      if (call.state === 'active') {
        while (call.pending.length && !call.pending[0].hold && call.pending[0].at <= st.time) {
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

  /** the caller only hears sirens once a unit running lights-and-sirens is genuinely close */
  private checkSirens(call: Call, inc: Incident) {
    const st = this.state;
    const n = this.city.nodes[inc.nodeId];
    for (const id of inc.assignedUnits) {
      const u = st.units[id];
      if (!u) continue;
      if (u.status === 'ON_SCENE' && this.unitAtScene(u, inc)) { call.heardSirens = true; return; }
      if (u.status !== 'EN_ROUTE' || !this.sirenFor(u) || isAir(u)) continue;
      if (Math.hypot(u.x - n.x, u.y - n.y) < 240) {
        call.heardSirens = true;
        if (!call.pending.some((l) => !l.hold) && st.time - call.lastSpontaneous > 1.5) call.pending.push({ at: st.time + 0.6, text: spontaneous(this.env(call), 'sirens') });
        return;
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
        const clue = backgroundClue(inc.templateId, st.weather, inc.truth);
        if (clue) this.addTranscript(call, 'SYSTEM', clue);
        lines.forEach((l, i) => call.pending.push({ ...l, at: st.time + 1.2 + i * 1.5 }));
        if (this.aiMode) this.holdForAi(call, call.pending.filter((l) => !l.hold && l.at > st.time), 'opening', '');
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
    if (r.aid) this.applyAid(inc, call, r.aid);
    if (inc.aid?.kind === 'cpr' && ['calm', 'stay', 'inst_cpr', 'promise'].includes(intent)) inc.aid.encouragedAt = st.time;
    // schedule reply lines with a natural pace
    const arch = ARCHETYPES[call.profile.archetype];
    let at = Math.max(st.time, ...call.pending.filter((p) => !p.hold).map((p) => p.at));
    const added: import('./types').PendingLine[] = [];
    for (const l of r.lines) {
      const len = l.text.length;
      const pace = (arch.slow ? 1.5 : 1) * (m.panic > 70 ? 0.7 : 1) * (call.profile.archetype === 'terse' ? 1.2 : 1);
      at += Math.min(4.5, (0.9 + len * 0.028) * pace);
      const line = { ...l, at };
      call.pending.push(line);
      added.push(line);
    }
    if (this.aiMode && added.length && !r.hangup) this.holdForAi(call, added, intent, text);
  }

  // ── AI voicing hooks (the dialogue model rewrites lines; the engine stays authoritative) ──
  get aiMode(): boolean { return !!this.state.flags.ai; }
  private holdForAi(call: Call, lines: import('./types').PendingLine[], intent: string, playerText: string) {
    const st = this.state;
    const ids: number[] = [];
    for (const l of lines) { l.id = ++st.lineCounter; l.hold = true; ids.push(l.id); }
    this.emit({ type: 'ai_request', callId: call.id, lineIds: ids, intent, playerText });
  }
  /** apply an AI-written reply to held lines. Facts, locations and twists come only from the engine's own lines or validated reveal keys. */
  voiceLines(callId: string, lineIds: number[], text: string, extra: { calm?: number; coop?: number; reveal?: string[] } = {}): boolean {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state === 'ended' || call.state === 'missed') return false;
    const held = call.pending.filter((l) => l.id !== undefined && lineIds.includes(l.id) && l.hold);
    if (!held.length) return false;
    const first = held[0];
    for (const l of held.slice(1)) {
      first.facts = { ...(first.facts ?? {}), ...(l.facts ?? {}) };
      first.unsure = [...(first.unsure ?? []), ...(l.unsure ?? [])];
      first.heard = [...(first.heard ?? []), ...(l.heard ?? [])];
      first.twist = first.twist || l.twist; first.hangup = first.hangup || l.hangup;
    }
    call.pending = call.pending.filter((l) => !held.includes(l) || l === first);
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 420);
    if (clean) first.text = clean;
    // validated reveals for free-form questions
    const inc = st.incidents[call.incidentId];
    for (const key of extra.reveal ?? []) {
      if (key === 'address' || key === 'landmark') {
        const r = replyTo(this.env(call), key as Intent, '');
        for (const l of r.lines) { if (l.heard) first.heard = [...(first.heard ?? []), ...l.heard]; if (l.facts) first.facts = { ...(first.facts ?? {}), ...l.facts }; }
        call.asked[key] = (call.asked[key] ?? 0) + 1;
        continue;
      }
      const allowed = REVEAL_KEYS[key];
      if (!allowed) continue;
      const tpl = this.instanceTemplate(inc);
      for (const fk of allowed) if (fk in inc.truth && !(tpl.blind ?? []).includes(fk)) first.facts = { ...(first.facts ?? {}), [fk]: inc.truth[fk] };
      if (inc.twist && !inc.twistRevealed && inc.twist.topics.includes(key)) {
        call.pending.push({ at: st.time + 2.5, text: fill(inc.twist.say[0], inc.vars), facts: inc.twist.facts, twist: true });
      }
    }
    first.hold = false;
    first.at = Math.max(st.time + 0.3, first.at - 1e9 > 0 ? st.time + 0.3 : st.time + 0.3);
    const m = call.mood;
    const calm = Math.max(-3, Math.min(3, extra.calm ?? 0)), coop = Math.max(-3, Math.min(3, extra.coop ?? 0));
    m.panic = Math.max(0, Math.min(100, m.panic - calm * 4)); m.base = Math.max(0, Math.min(100, m.base - calm * 3));
    m.cooperation = Math.max(0, Math.min(100, m.cooperation + coop * 4)); m.frustration = Math.max(0, Math.min(100, m.frustration - calm * 2));
    st.stats.aiLines++;
    return true;
  }
  /** give up on AI voicing: deliver the scripted lines */
  releaseLines(callId: string, lineIds: number[]) {
    const st = this.state;
    const call = st.calls[callId];
    if (!call) return;
    let at = st.time + 0.3;
    for (const l of call.pending) if (l.id !== undefined && lineIds.includes(l.id) && l.hold) { l.hold = false; l.at = at; at += 1.4; }
  }
  /** flavour-only persona details from the procedural persona generator */
  applyPersona(callId: string, persona: NonNullable<CallerProfile['persona']> & { name?: string; age?: number }) {
    const call = this.state.calls[callId];
    if (!call || call.isCallback) return;
    const p = call.profile;
    if (persona.name && /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(persona.name)) { p.name = persona.name; const inc = this.state.incidents[call.incidentId]; if (inc && inc.callerProfile.id === p.id) { inc.callerName = p.name; inc.callerProfile.name = p.name; } }
    const clip = (x: unknown, n: number) => String(x ?? '').slice(0, n);
    p.persona = { occupation: clip(persona.occupation, 60), quirk: clip(persona.quirk, 120), background: clip(persona.background, 200), catchphrase: clip(persona.catchphrase, 80), voice: clip(persona.voice, 120) };
  }

  // ── Pre-arrival instructions ──────────────────────────────────────────────
  private applyAid(inc: Incident, call: Call, aid: { kind: string; fit: 'good' | 'bad' | 'neutral' }) {
    const st = this.state;
    if (aid.fit === 'neutral') return;
    const prev = inc.aid;
    inc.aid = { kind: aid.kind, fit: aid.fit, at: st.time, encouragedAt: st.time };
    if (prev && prev.kind === aid.kind && prev.fit === aid.fit) return;
    const label: Record<string, string> = { cpr: 'CPR in progress', recovery: 'Recovery position', pressure: 'Pressure on wound', still: 'Patient kept still', lock: 'Caller hiding', evacuate: 'Evacuated', water: 'Small sips of water', lift: 'Helped out of danger' };
    if (aid.fit === 'good') { st.stats.aidGood++; this.addFact(inc, 'aid', label[aid.kind] ?? aid.kind, 'confirmed', 'caller'); this.fx('good', inc.reportedNode ?? inc.nodeId, label[aid.kind] ?? 'First aid'); return; }
    st.stats.aidBad++;
    this.fx('bad', inc.reportedNode ?? inc.nodeId, 'Harmful instruction');
    this.harm(inc, call, aid.kind);
  }

  private consequence(inc: Incident, text: string) {
    (inc.consequences ??= []).push(text);
    this.log('failed', `${inc.label}: ${text}`, { incidentId: inc.id, good: false });
  }
  /** what a wrong instruction actually does to the people on the other end of the line */
  private harm(inc: Incident, call: Call, kind: string) {
    const st = this.state;
    const t = inc.truth;
    const hurt = (n = 1) => { t.injured = (typeof t.injured === 'number' ? t.injured : 0) + n; inc.requires = mergeReqs(inc.requires, [{ cap: 'als', n: 1 }, { cap: 'transport', n: Math.min(3, Number(t.injured)) }].map((r) => adaptReqForRank(r as Req, st.rank))); inc.needsTransport = true; };
    st.stats.harmfulAdvice++;
    switch (kind) {
      case 'cpr': if (inc.survival !== undefined) inc.survival = Math.max(0, inc.survival - 8); this.consequence(inc, 'CPR was ordered on a patient who was breathing'); break;
      case 'recovery': this.consequence(inc, 'A patient in cardiac arrest was put in the recovery position instead of receiving CPR'); break;
      case 'water': if (inc.survival !== undefined) inc.survival = Math.max(0, inc.survival - 18); inc.threat = Math.min(99, inc.threat + 12); this.consequence(inc, 'The caller was told to give water — the patient choked'); break;
      case 'lift':
        if (inc.survival !== undefined) inc.survival = Math.max(0, inc.survival - 12);
        inc.threat = Math.min(99, inc.threat + 15);
        if (inc.lifeThreat !== 'arrest') { inc.severity = Math.min(5, inc.severity + 1); this.consequence(inc, 'The patient was moved against medical advice — the injury got worse'); }
        else this.consequence(inc, 'Precious seconds were lost moving a patient who needed CPR');
        break;
      case 'still': case 'lock':
        this.consequence(inc, kind === 'lock' ? 'The caller was told to shelter inside a building that was on fire' : 'The caller was told to stay put inside a burning building');
        inc.threat = Math.min(99, inc.threat + 10);
        break;
      case 'goback':
        hurt(1);
        t.trapped = (typeof t.trapped === 'number' ? t.trapped : 0) + 1;
        inc.requires = mergeReqs(inc.requires, [adaptReqForRank({ cap: 'rescue', n: 1 }, st.rank)]);
        inc.threat = Math.min(99, inc.threat + 20);
        this.consequence(inc, 'The caller was sent back into the fire and was overcome by smoke');
        call.pending.push({ at: st.time + 6, text: '(the line fills with coughing, then goes quiet)', hangup: true });
        break;
      case 'confront':
        hurt(1);
        inc.threat = Math.min(99, inc.threat + 18);
        this.consequence(inc, 'The caller was told to confront the suspect and was attacked');
        call.pending.push({ at: st.time + 5, text: '(the call disconnects)', hangup: true });
        break;
    }
    if (['goback', 'confront'].includes(kind)) { inc.casualties += 0; this.notify(`Your instruction put the caller in danger — ${inc.label}`, 'bad', inc.id); }
  }

  /** survival clock for patients with a life threat: falls until professional care arrives, faster without good instructions */
  private updateSurvival(inc: Incident, here: Unit[], dt: number) {
    const st = this.state;
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    const threat = lifeThreatOf(tpl, inc.truth, inc.severity);
    if (!threat) { if (inc.lifeThreat && inc.careAt == null) inc.lifeThreat = null; return; }
    if (inc.lifeThreat !== threat) { inc.lifeThreat = threat; inc.survival ??= 100; }
    if (inc.careAt != null) return;
    const care = here.some((u) => threat === 'arrest' ? u.capabilities.includes('als') || u.capabilities.includes('bls') : u.capabilities.some((c) => c === 'als' || c === 'bls'));
    if (care) {
      inc.careAt = st.time;
      const u = here.find((x) => x.capabilities.includes('als') || x.capabilities.includes('bls'));
      if (u) this.radio(u.spoken, `Dispatch, ${u.spoken}. We have the patient${inc.aid?.fit === 'good' ? ` — the bystander's ${inc.aid.kind === 'cpr' ? 'CPR' : 'first aid'} bought us time` : ''}.`, 'unit', u.id, inc.id);
      return;
    }
    const a = inc.aid;
    let rate: number;
    if (threat === 'arrest') {
      if (a?.kind === 'cpr' && a.fit === 'good') {
        const call = this.callFor(inc);
        const coached = !!call && call.state === 'active';
        const since = st.time - a.encouragedAt;
        rate = 0.1 + Math.min(0.42, Math.max(0, since - (coached ? 60 : 20)) / (coached ? 500 : 200));
      } else rate = a && a.fit === 'bad' ? 0.72 : 0.62;
    } else if (threat === 'airway') rate = a?.kind === 'recovery' && a.fit === 'good' ? 0.03 : a?.fit === 'bad' ? 0.3 : 0.16;
    else rate = a?.kind === 'pressure' && a.fit === 'good' ? 0.06 : a?.fit === 'bad' ? 0.42 : 0.3;
    inc.survival = Math.max(0, (inc.survival ?? 100) - rate * dt);
    if (inc.survival <= 0) this.patientDied(inc, threat);
  }

  private patientDied(inc: Incident, threat: 'arrest' | 'bleed' | 'airway') {
    const st = this.state;
    const a = inc.aid;
    const guided = a?.fit === 'good' && (threat === 'arrest' ? a.kind === 'cpr' : threat === 'airway' ? a.kind === 'recovery' : a.kind === 'pressure');
    const why = guided ? 'Help did not arrive in time.' : threat === 'arrest' ? (a?.fit === 'bad' ? 'The wrong instructions were given — nobody did CPR.' : 'Nobody started CPR before help arrived.') : threat === 'airway' ? 'The airway was never protected — no recovery position.' : 'The bleeding was never controlled — no pressure on the wound.';
    if (!guided) st.stats.guidanceDeaths++;
    this.consequence(inc, `The patient died. ${why}`);
    inc.casualties++; st.stats.casualties++;
    inc.lostReason = why;
    this.finishIncident(inc, 'failed');
    st.stats.failed++;
    this.notify(`PATIENT DIED — ${inc.label}. ${why}`, 'bad', inc.id);
    this.emit({ type: 'failed', incidentId: inc.id });
    this.emit({ type: 'alert', text: 'Patient died' });
    const call = this.callFor(inc);
    if (call && call.state === 'active') call.pending.push({ at: st.time + 1.2, text: fill("(sobbing) {He}'s... {he}'s gone. {He}'s not— oh god...", inc.vars) });
  }
  /** how instructions given over the phone change how fast the incident deteriorates */
  aidFactor(inc: Incident): number {
    const a = inc.aid;
    if (!a) return 1;
    if (a.fit === 'bad') return a.kind === 'cpr' ? 1.15 : 1.2;
    const base: Record<string, number> = { cpr: 0.4, recovery: 0.7, pressure: 0.7, still: 0.85, lock: 0.75, evacuate: 0.85 };
    let f = base[a.kind] ?? 1;
    if (a.kind === 'cpr') {
      // a caller doing CPR tires quickly without coaching
      const call = this.callFor(inc);
      const coached = call && call.state === 'active';
      const since = this.state.time - a.encouragedAt;
      f = Math.min(0.9, 0.4 + Math.max(0, since - (coached ? 60 : 20)) / (coached ? 400 : 160));
    }
    return f;
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
      if (['RESOLVED', 'CLOSED'].includes(inc.status) || inc.callId === null) { inc.callbackAt = null; continue; }
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
    if (u.status === 'ON_SCENE' && !(inc.parentId && u.assignedIncidentId === inc.parentId)) return { ok: false, reason: 'Unit is on scene elsewhere — recall it first' };
    if (u.assignedIncidentId === inc.id && u.status !== 'RETURNING') return { ok: false, reason: 'Already assigned here' };
    if (!checkCrew(this.state, u)) return { ok: false, reason: 'Understaffed' };
    if (isAir(u)) {
      if (this.state.weather === 'storm') return { ok: false, reason: 'Grounded — weather beyond flight limits' };
      if ((u.fuel ?? 100) < 30 && u.status !== 'AVAILABLE') return { ok: false, reason: 'Low fuel — must refuel first' };
    }
    return { ok: true };
  }

  dispatch(unitId: string, incId: string, opts: { code?: 2 | 3; self?: boolean } = {}): { ok: boolean; reason?: string } {
    const st = this.state;
    const u = st.units[unitId], inc = st.incidents[incId];
    if (!u || !inc) return { ok: false, reason: 'Unknown' };
    const can = this.canDispatch(u, inc);
    if (!can.ok) return can;
    // detach from a previous incident
    if (u.assignedIncidentId && u.assignedIncidentId !== incId) this.detach(u, true);
    u.assignedIncidentId = incId;
    u.status = 'DISPATCHED';
    u.code = opts.code ?? 3;
    if (u.code === 2 && !opts.self) st.flags.code2 = true;
    u.crashAt = null;
    if (u.code === 3 && !u.temp && !isAir(u)) {
      // running with lights and sirens is faster but not risk-free
      const wx = { clear: 1, heat: 1, rain: 1.7, fog: 1.8, snow: 2.6, storm: 2.3 }[st.weather];
      const crew = this.crewOf(u);
      const fat = crew.length ? crew.reduce((s, p) => s + p.fatigue, 0) / crew.length : 0;
      if (this.rng.chance(0.012 * wx * (1 + fat / 120))) u.crashAt = st.time + u.timer + this.rng.range(8, 40);
    }
    u.timer = isAir(u) ? 14 : this.mobilizationTime(u);
    u.deployments++;
    u.note = undefined;
    inc.assignedUnits.push(u.id);
    if (!inc.everAssigned.includes(u.id)) inc.everAssigned.push(u.id);
    if (inc.firstDispatchAt === null) inc.firstDispatchAt = st.time;
    if (['REPORTED', 'AWAITING_INFORMATION', 'CLASSIFIED', 'AWAITING_DISPATCH', 'ESCALATING'].includes(inc.status) || !inc.assignedUnits.length) inc.status = inc.status === 'ESCALATING' ? 'ESCALATING' : 'UNITS_EN_ROUTE';
    if (inc.status === 'AWAITING_DISPATCH' || inc.status === 'CLASSIFIED') inc.status = 'UNITS_EN_ROUTE';
    const reqs = inc.duplicateOf ? (st.incidents[inc.duplicateOf]?.requires ?? []) : inc.requires;
    const useful = reqs.some((r) => u.capabilities.includes(r.cap)) || (isAir(u) && (inc.pursuit || AIR_HELPS.has(inc.templateId)));
    if (!opts.self) {
      st.stats.dispatches++;
      if (useful) st.stats.correctDispatches++;
      const cost = isAir(u) ? 700 : u.service === 'fire' ? 320 : u.service === 'medical' ? 220 : 150;
      st.stats.costs += cost; st.budget -= cost;
    }
    if (!opts.self) this.radio('DISPATCH', `${u.spoken}, respond to ${addressOf(this.city, inc.reportedNode!)}, ${inc.label.toLowerCase()}.`, 'dispatch', u.id, inc.id);
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
    if (!u || !['AVAILABLE', 'RETURNING'].includes(u.status) || isAir(u)) return false;
    u.postNode = nodeId;
    u.status = 'RETURNING';
    this.routeUnit(u, nodeId, false);
    this.radio(u.spoken, `Copy, moving to cover ${addressOf(this.city, nodeId)}.`, 'unit', u.id);
    return true;
  }

  routeUnit(u: Unit, destNode: number, siren: boolean): boolean {
    if (isAir(u)) {
      // aircraft fly straight lines
      const n = this.city.nodes[destNode];
      u.destNode = destNode; u.route = []; u.eta = Math.hypot(n.x - u.x, n.y - u.y) / AIR_SPEED;
      return true;
    }
    const startNode = u.route.length ? u.route[0] : u.prevNode;
    const startPos = u.route.length ? { x: this.city.nodes[startNode].x, y: this.city.nodes[startNode].y } : { x: u.x, y: u.y };
    void startPos;
    const res = findRoute(this.city, startNode, destNode, this.tm(siren && this.sirenFor(u) || u.status === 'DISPATCHED' && u.code !== 2), this.unitSpeedFactor(u));
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
    if (isAir(u)) {
      const n = this.city.nodes[nodeId];
      const d = Math.hypot(n.x - u.x, n.y - u.y);
      const mob = u.status === 'AVAILABLE' ? 14 : u.status === 'DISPATCHED' ? u.timer : 0;
      const v = { eta: mob + d / AIR_SPEED, dist: d * 4 / 1000 };
      this.etaCache.set(key, { t: this.state.time, v });
      return v;
    }
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
      if (isAir(u)) { this.updateAir(u, dt); continue; }
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
              const near = Math.hypot(u.x - m.x, u.y - m.y) < 230 && st.time >= (m.evadeUntil ?? 0);
              const target = near ? (m.next >= 0 ? m.next : m.prev) : inc.reportedNode;
              if (target !== null && target !== u.destNode) this.routeUnit(u, target, true);
              if (u.route.length) this.advance(u, dt); else { u.speed = 0; u.note = 'Searching area'; }
              break;
            }
            if (inc.reportedNode !== null && u.destNode !== inc.reportedNode) this.routeUnit(u, inc.reportedNode, this.sirenFor(u));
            if (u.crashAt && st.time >= u.crashAt && u.route.length > 2) this.unitCrash(u, inc);
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

  sirenFor(u: Unit): boolean { return u.status === 'TRANSPORTING' || ((u.status === 'EN_ROUTE' || u.status === 'DISPATCHED') && u.code !== 2); }

  private unitCrash(u: Unit, inc: Incident) {
    const st = this.state;
    u.crashAt = null;
    u.stoppedUntil = st.time + 35;
    u.note = 'Minor collision en route';
    st.stats.unitCrashes++;
    st.stats.costs += 2000; st.budget -= 2000;
    for (const p of this.crewOf(u)) p.morale = Math.max(10, p.morale - 8);
    this.radio(u.spoken, `Dispatch, ${u.spoken}. We've been involved in a collision at an intersection. Crew okay, vehicle damaged — we're delayed.`, 'alert', u.id, inc.id);
    this.notify(`${u.callsign} crashed en route (Code 3) — delayed ~35 s`, 'bad', inc.id);
    this.fx('bad', u.prevNode, 'Unit collision');
    this.emit({ type: 'alert', text: 'Unit collision' });
  }

  private breakdowns() {
    const st = this.state;
    const pool = Object.values(st.units).filter((u) => u.status === 'AVAILABLE' && !u.temp);
    if (!pool.length || st.time < 60) return;
    for (const u of pool) {
      const crew = this.crewOf(u);
      const rel = crew.length ? crew.reduce((s, p) => s + p.reliability, 0) / crew.length : 70;
      if (this.rng.chance((1.6 - rel / 100) / (900 * Math.max(6, pool.length)))) {
        u.status = 'OUT_OF_SERVICE'; u.note = 'Mechanical fault'; u.timer = 150 + this.rng.range(0, 90);
        st.stats.breakdowns++;
        this.radio(u.spoken, `Dispatch, ${u.spoken}. We have a mechanical fault — out of service until the mechanic clears us.`, 'unit', u.id);
        this.notify(`${u.callsign} is out of service — mechanical fault`, 'warn');
        return;
      }
    }
  }

  private advance(u: Unit, dt: number) {
    const city = this.city;
    let remaining = dt;
    if (u.stoppedUntil && this.state.time < u.stoppedUntil) { u.speed = 0; return; }
    const tm = this.tm(this.sirenFor(u));
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
        // officers' own traffic stops are not responses the dispatcher made
        if (inc.templateId !== 'traffic_stop') { st.stats.responseTimes.push(rt); st.stats.serviceResponse[u.service].push(rt); }
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
      if (inc.deadlineAt != null && inc.deadlineMet == null) {
        if (st.time < inc.deadlineAt) { this.deadlineCountdown(inc); this.checkPromise(inc); continue; }
        this.deadlineReached(inc, here);
        if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      }
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
      this.updateSurvival(inc, here, dt);
      if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      if (inc.sceneSeen && !inc.checkRolled) this.rollOfficerCheck(inc, here);
      const cov = matchCoverage(inc.requires, here);
      const usedUnits = here.filter((u) => cov.used.has(u.id));
      const eff = usedUnits.length ? usedUnits.reduce((s, u) => s + this.unitEffectiveness(u), 0) / usedUnits.length : 1;
      const f = cov.f;
      // threat grows without adequate response, subsides with it
      inc.threat += inc.growth * this.aidFactor(inc) * (1 - f) * dt - inc.clear * eff * f * f * 0.35 * dt;
      inc.threat = Math.max(0, inc.threat);
      if (f > 0 && here.length) inc.workProgress += dt * eff * f * f * (AIR_HELPS.has(inc.templateId) && here.some(isAir) ? 1.35 : 1);
      if (inc.status === 'ESCALATING' && st.time - (inc.escalatedAt ?? 0) > 10) inc.status = here.length ? 'ON_SCENE' : inc.assignedUnits.length ? 'UNITS_EN_ROUTE' : 'AWAITING_DISPATCH';
      if (inc.threat >= 100) { this.escalate(inc); continue; }
      if (inc.workProgress >= inc.work && f >= 1 && !st.requests.some((r) => r.incidentId === inc.id && r.status === 'open')) this.completeWork(inc, here);
      // caller impatience when a promise has not been kept
      this.checkPromise(inc);
    }
  }

  /** the tower keeps the dispatcher updated while the aircraft is inbound */
  private deadlineCountdown(inc: Incident) {
    const st = this.state;
    const say = TEMPLATE_BY_ID[inc.templateId].deadlineSay;
    const call = this.callFor(inc);
    if (!say || !call || call.state !== 'active' || call.pending.length || st.time - call.lastSpontaneous < 24) return;
    const left = Math.max(0, (inc.deadlineAt ?? st.time) - st.time);
    if (left < 8) return;
    call.lastSpontaneous = st.time;
    const t = left >= 75 ? `${Math.round(left / 60 * 2) / 2} minutes`.replace('.5 minutes', ' and a half minutes').replace(/^1 minutes/, 'One minute') : `${Math.round(left / 5) * 5} seconds`;
    call.pending.push({ at: st.time + 0.5, text: say.count.replace('{t}', t) });
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
    if (call && call.state === 'active') call.pending.push({ at: st.time + 1.3, text: esc.say?.length ? fill(this.rng.pick(esc.say), inc.vars) : spontaneous(this.env(call), 'escalated') });
    else if (inc.answeredAt !== null && !call && inc.callId !== null) inc.callbackAt = st.time + 12 + this.rng.range(0, 10);
    if (esc.spawn && st.phase === 'running') this.spawnConnected(inc, esc.spawn);
  }

  /** the moment that cannot be postponed (an aircraft touching down): were crews in position? */
  private deadlineReached(inc: Incident, here: Unit[]) {
    const st = this.state;
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    const cov = matchCoverage(inc.requires, here);
    inc.deadlineMet = cov.f >= 0.66;
    const say = tpl.deadlineSay;
    if (inc.deadlineMet) {
      inc.threat = Math.min(inc.threat, 28);
      inc.workProgress += inc.work * 0.25;
      const b = Math.round(1500 * modProduct(st.config, 'bonus'));
      st.stats.bonus += b; st.budget += b;
      this.fx('good', inc.nodeId, `In position +$${b}`);
      this.radio(here[0].spoken, `Dispatch, ${here[0].spoken}. ${say?.good ?? "It's happening now — we were in position and we're working it."}`, 'unit', here[0].id, inc.id);
      this.notify(`${inc.label}: crews were in position in time`, 'good', inc.id);
      this.log('arrival', `${inc.label}: responders staged before ${say?.moment ?? 'impact'}`, { incidentId: inc.id, good: true });
    } else {
      this.notify(`${inc.label}: ${say?.bad ?? 'it happened before crews were in place'}`, 'bad', inc.id);
      this.log('escalation', `${inc.label}: responders not in position`, { incidentId: inc.id, good: false });
      inc.growth *= 1.35;
      this.escalate(inc);
    }
    const call = this.callFor(inc);
    if (call && call.state === 'active' && say) call.pending.push({ at: st.time + 1, text: inc.deadlineMet ? say.callerGood : say.callerBad });
  }

  private failIncident(inc: Incident) {
    const st = this.state;
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    // a patient with an untreated life threat: say plainly what was (not) done on the phone
    if (inc.lifeThreat && inc.careAt == null && inc.survival !== undefined) { this.patientDied(inc, inc.lifeThreat); return; }
    let cas = 0;
    if (tpl.lethal) cas = 1 + (inc.category === 'fire' || inc.severity >= 5 ? 1 : 0);
    else if (inc.category === 'fire') cas = this.rng.chance(inc.safetyAdvised ? 0.2 : 0.6) ? 1 : 0;
    else if (inc.pursuit) cas = this.rng.chance(0.2) ? 1 : 0;
    else if (inc.category === 'police' && inc.severity >= 3) cas = this.rng.chance(0.4) ? 1 : 0;
    if (inc.safetyAdvised && cas > 1) cas--;
    if (typeof inc.truth.injured === 'number' && inc.truth.injured >= 1 && tpl.category === 'medical') cas = Math.min(cas, inc.truth.injured);
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
    const assigned = inc.everAssigned.map((id) => st.units[id]).filter((u): u is Unit => !!u && !isAir(u));
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
    if (inc.lifeThreat && inc.survival !== undefined) {
      const risk = Math.max(0, (55 - inc.survival) / 100);
      if (this.rng.chance(risk)) {
        inc.casualties++; st.stats.casualties++;
        const guided = inc.aid?.fit === 'good';
        if (!guided) st.stats.guidanceDeaths++;
        this.consequence(inc, `The patient died in hospital${guided ? '' : ' — too long without first aid before crews arrived'}`);
        this.notify(`${inc.label}: the patient later died in hospital`, 'bad', inc.id);
      } else if (inc.aid?.fit === 'good' && inc.survival < 92) {
        st.stats.guidanceSaves++;
        (inc.consequences ??= []).push(`Your instructions kept the patient alive (survival ${Math.round(inc.survival)}% at hand-over)`);
        this.notify(`Doctors say the ${inc.aid.kind === 'cpr' ? 'CPR' : 'first aid'} you coached saved ${fill('{his}', inc.vars)} life`, 'good', inc.id);
        this.fx('good', inc.nodeId, 'Life saved');
      }
    }
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
    if (inc.templateId === 'traffic_stop') return;
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
    const all = inc.assignedUnits.map((id) => st.units[id]).filter((u): u is Unit => !!u);
    const assigned = all.filter((u) => !isAir(u));
    const evading = st.time < (m.evadeUntil ?? 0);
    const contacts = assigned.filter((u) => (u.status === 'ON_SCENE' && u.note === 'In pursuit') || (!evading && u.status === 'EN_ROUTE' && Math.hypot(u.x - m.x, u.y - m.y) < 42));
    // air support: the camera picks the vehicle up from far further away than a crew in a car
    const air = all.filter((u) => isAir(u) && (u.status === 'ON_SCENE' || u.status === 'EN_ROUTE'));
    if (m.heliId && !air.some((u) => u.id === m.heliId)) m.heliId = null;
    if (!m.heliId) {
      const spot = air.find((u) => Math.hypot(u.x - m.x, u.y - m.y) < (st.weather === 'fog' ? 105 : 150));
      if (spot) {
        m.heliId = spot.id; m.heliSince = st.time; m.lastHeliReport = st.time;
        spot.status = 'ON_SCENE'; spot.note = 'Eyes on suspect';
        st.stats.heliSightings++;
        const w = this.moverWhere(m);
        this.radio(spot.spoken, `Dispatch, ${spot.spoken}. We have the suspect vehicle on camera — ${w.dir} on ${w.street}. We'll stay on it.`, 'alert', spot.id, inc.id);
        this.notify(`${spot.callsign} has eyes on the suspect — relay its position to ground units`, 'good', inc.id);
        this.fx('good', inc.nodeId, 'Air has eyes');
        if (inc.firstArrivalAt === null) inc.sceneSeen = true;
      }
    } else if (st.time - (m.lastHeliReport ?? 0) >= 9 && st.time >= m.startAt) {
      const h = st.units[m.heliId];
      if (h) this.heliCommentary(inc, h);
    }
    if (contacts.length && m.contact === 0) {
      const u = contacts[0];
      this.radio(u.spoken, `Dispatch, ${u.spoken}. Suspect vehicle in sight — in pursuit!`, 'alert', u.id, inc.id);
      inc.sceneSeen = true; inc.sceneReported = true; inc.knownReqs = inc.requires.map((r) => ({ ...r }));
      if (inc.firstArrivalAt === null) { inc.firstArrivalAt = st.time; const rt = st.time - (inc.answeredAt ?? inc.createdAt); st.stats.responseTimes.push(rt); st.stats.serviceResponse.police.push(rt); }
      if (inc.status !== 'ESCALATING') inc.status = 'ON_SCENE';
    }
    m.contact = contacts.length;
    // a lone car can lose the suspect in traffic; with the helicopter overhead there is nowhere to hide
    if (contacts.length === 1 && !m.heliId && st.time >= m.startAt) {
      const night = st.timeOfDay % 24 >= 21 || st.timeOfDay % 24 < 5;
      const wx = ({ fog: 1.6, rain: 1.25, storm: 1.5, snow: 1.3 } as Record<string, number>)[st.weather] ?? 1;
      if (this.rng.chance(0.009 * wx * (night ? 1.25 : 1))) {
        const u = contacts[0];
        const w = this.moverWhere(m);
        u.status = 'EN_ROUTE'; u.note = 'Lost visual'; this.routeUnit(u, m.prev, true);
        m.evadeUntil = st.time + 14; m.contact = 0;
        inc.reportedNode = inc.nodeId;
        const heli = Object.values(st.units).some((x) => isAir(x) && x.status === 'AVAILABLE');
        this.radio(u.spoken, `Dispatch, ${u.spoken}. We've lost him! Last seen ${w.dir} on ${w.street}.`, 'alert', u.id, inc.id);
        this.notify(`${u.callsign} lost the suspect${heli ? ' — air support could find him' : ''}`, 'warn', inc.id);
        contacts.length = 0;
      }
    }
    // the suspect keeps driving unless boxed in
    if (st.time >= m.startAt && contacts.length < 2) {
      let remaining = m.speed * TIME_COMPRESS / 2.4 * WEATHER_SPEED[st.weather] * (contacts.length ? 0.45 : evading ? 1.25 : 1) * dt;
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
    // the live position only reaches ground units through the caller or a crew with eyes on (air positions are relayed by dispatch)
    m.tracked = following || contacts.length > 0 || assigned.some((u) => Math.hypot(u.x - m.x, u.y - m.y) < 120 && !evading);
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
      inc.workProgress += dt * eff * (contacts.length >= 2 ? 3 : 1) * (m.heliId ? 1.5 : 1);
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

  // ── Officer radio requests (ID / warrant / plate checks) ──────────────────
  private static PLATE_TPL = new Set(['traffic_stop', 'collision_minor', 'collision_injury', 'collision_trapped', 'collision_multi', 'dangerous_driving', 'stolen_vehicle', 'street_racing']);
  private static PERSON_TPL = new Set(['domestic_disturbance', 'public_disturbance', 'shoplifting', 'trespassing', 'suspicious_activity', 'burglary_report', 'burglary_progress', 'public_intoxication', 'robbery', 'vandalism', 'unruly_passenger', 'welfare_check', 'missing_person', 'lost_child', 'fireworks', 'hostage_barricade', 'bank_robbery']);

  private rollOfficerCheck(inc: Incident, here: Unit[]) {
    const st = this.state;
    const cop = here.find((u) => u.service === 'police' && !isAir(u) && u.capabilities.includes('patrol'));
    if (!cop || st.time < (inc.sceneAt ?? st.time) + 6) return;
    inc.checkRolled = true;
    const plate = GameEngine.PLATE_TPL.has(inc.templateId);
    const person = GameEngine.PERSON_TPL.has(inc.templateId);
    if (!plate && !person) return;
    const p = inc.templateId === 'traffic_stop' ? 1 : st.config.mode === 'tutorial' ? 0 : 0.55;
    if (!this.rng.chance(p) || st.requests.filter((r) => r.status === 'open').length >= 3) return;
    this.officerRequest(cop, inc, plate ? 'plate' : 'person', !!inc.truth.weapon);
    // a stop sometimes needs both: the plate first, then the driver
    if (inc.templateId === 'traffic_stop' && this.rng.chance(0.35)) this.officerRequest(cop, inc, 'person', false, 14);
  }
  private officerRequest(u: Unit, inc: Incident | null, kind: 'person' | 'plate', risky: boolean, delay = 0) {
    const st = this.state;
    const id = `q${++st.requestCounter}`;
    const r = makeRequest(this.rng, id, u.id, inc?.id ?? null, kind, st.time + delay, risky);
    st.requests.push(r);
    if (st.requests.length > 40) st.requests.splice(0, st.requests.length - 40);
    if (!delay) this.announceRequest(r);
    return r;
  }
  private announceRequest(r: OfficerRequest) {
    const u = this.state.units[r.unitId];
    if (!u) return;
    (r as OfficerRequest & { announced?: boolean }).announced = true;
    this.radio(u.spoken, requestText(r, u.spoken, this.rng), 'alert', u.id, r.incidentId ?? undefined);
    this.emit({ type: 'alert', text: 'Records request' });
  }

  private updateRequests() {
    const st = this.state;
    for (const r of st.requests) {
      if (r.status !== 'open') continue;
      const u = st.units[r.unitId];
      const inc = r.incidentId ? st.incidents[r.incidentId] : undefined;
      if (st.time < r.at) continue;
      if (!(r as OfficerRequest & { announced?: boolean }).announced) { this.announceRequest(r); continue; }
      if (!u || (inc && ['RESOLVED', 'CLOSED'].includes(inc.status))) { r.status = 'expired'; continue; }
      const waited = st.time - r.at;
      if (waited > 35 && r.reminded === 0) { r.reminded = 1; this.radio(u.spoken, `Dispatch, ${u.spoken}. Still waiting on that return${r.kind === 'plate' ? ` on ${r.subject}` : ` on ${r.subject.split(' ')[1]}`}.`, 'unit', u.id, r.incidentId ?? undefined); }
      else if (waited > 60 && r.reminded === 1) { r.reminded = 2; this.radio(u.spoken, `Dispatch — ${u.spoken}, I need that return now, subject is getting agitated.`, 'alert', u.id, r.incidentId ?? undefined); }
      else if (waited > 80) {
        r.status = 'expired';
        st.stats.checksMissed++;
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Disregard — no return, we're releasing ${r.kind === 'plate' ? 'the vehicle' : 'the subject'}.`, 'unit', u.id, r.incidentId ?? undefined);
        this.notify(`${u.callsign}'s records request went unanswered`, 'warn', r.incidentId ?? undefined);
        this.checkConsequence(r, 'clear', true);
      }
    }
  }

  /** the dispatcher runs the query on the records terminal */
  runRequest(id: string): OfficerRequest | null {
    const r = this.state.requests.find((x) => x.id === id);
    if (!r) return null;
    if (!r.ran) { r.ran = true; r.ranAt = this.state.time; }
    return r;
  }

  /** the dispatcher radios the return back to the officer */
  answerRequest(id: string, answer: CheckResult): { ok: boolean; correct?: boolean; reason?: string } {
    const st = this.state;
    const r = st.requests.find((x) => x.id === id);
    if (!r || r.status !== 'open') return { ok: false, reason: 'Request no longer open' };
    const u = st.units[r.unitId];
    r.status = 'answered'; r.answer = answer; r.answeredAt = st.time; r.correct = answer === r.truth;
    const spoken = u?.spoken ?? 'Unit';
    this.radio('DISPATCH', `${spoken}, return on ${r.subject}: ${CHECK_LABEL[answer].toLowerCase()}.`, 'dispatch', u?.id, r.incidentId ?? undefined);
    if (u) this.radio(u.spoken, replyText(answer, u.spoken), 'unit', u.id, r.incidentId ?? undefined);
    const where = (r.incidentId ? st.incidents[r.incidentId]?.nodeId : undefined) ?? u?.prevNode ?? 0;
    if (r.correct) {
      st.stats.checksOk++;
      const fast = st.time - r.at < 30;
      const b = Math.round((fast ? 380 : 200) * (r.ran ? 1 : 0.5) * modProduct(st.config, 'bonus'));
      st.stats.bonus += b; st.budget += b;
      this.fx('good', where, `Return ✓ +$${b}`);
    } else {
      st.stats.checksBad++;
      this.fx('bad', where, 'Wrong return');
    }
    this.checkConsequence(r, answer, false);
    return { ok: true, correct: r.correct };
  }

  /** what happens on the street after the officer acts on (or without) the return */
  private checkConsequence(r: OfficerRequest, given: CheckResult, expired: boolean) {
    const st = this.state;
    const u = st.units[r.unitId];
    const inc = r.incidentId ? st.incidents[r.incidentId] : undefined;
    const missedDanger = DANGEROUS.includes(r.truth) && !DANGEROUS.includes(given);
    const falseAlarm = !DANGEROUS.includes(r.truth) && DANGEROUS.includes(given);
    if (given === r.truth) {
      if (r.truth === 'caution' && inc) {
        // officer waits for a second unit before approaching
        inc.requires = mergeReqs(inc.requires, [{ cap: 'patrol', n: 2 }]);
        inc.knownReqs = inc.requires.map((x) => ({ ...x }));
        this.notify(`${u?.callsign ?? 'Unit'} requests a second unit before approaching — send backup`, 'warn', inc.id);
      }
      if (r.truth === 'caution' && inc) inc.growth = Math.max(inc.growth, 0.3);
      if (r.truth === 'stolen' && inc && this.rng.chance(0.35)) {
        if (u) this.radio(u.spoken, `Dispatch, ${u.spoken}! Vehicle's taking off — we're in pursuit!`, 'alert', u.id, inc.id);
        this.chaseFromStop(inc, u);
      }
      return;
    }
    if (missedDanger) {
      if (r.truth === 'caution' && inc && this.rng.chance(expired ? 0.5 : 0.75)) {
        if (u) this.radio(u.spoken, `10-33! ${u.spoken} — officer down, officer down! Subject had a weapon!`, 'alert', u.id, inc.id);
        this.consequence(inc, `An officer was attacked after being told ${r.subject} was ${CHECK_LABEL[given].toLowerCase()}`);
        st.reputation = Math.max(0, st.reputation - 2);
        const down = this.spawnConnected(inc, 'officer_down', { noCall: true });
        if (u) { this.detach(u, true); u.status = 'OUT_OF_SERVICE'; u.note = 'Officer injured'; u.timer = 300; u.route = []; u.destNode = null; }
        if (inc.templateId === 'traffic_stop') this.finishIncident(inc, 'success');
        if (down) this.notify('OFFICER DOWN — the subject was armed and dangerous', 'bad', down.id);
      } else if (r.truth === 'stolen' && inc) {
        if (u) this.radio(u.spoken, `Dispatch, ${u.spoken}. Vehicle just took off on us!`, 'alert', u.id, inc.id);
        this.chaseFromStop(inc, u);
      } else {
        st.reputation = Math.max(0, st.reputation - 1);
        this.notify(`A wanted ${r.kind === 'plate' ? 'vehicle owner' : 'person'} was released — the warrant was missed`, 'bad', r.incidentId ?? undefined);
        if (inc) this.consequence(inc, `A wanted subject (${r.subject}) was let go`);
      }
    } else if (falseAlarm) {
      const cost = 1500;
      st.stats.costs += cost; st.budget -= cost; st.reputation = Math.max(0, st.reputation - 1);
      this.notify(`Wrongful detention complaint — ${r.subject} had no warrant (−$${cost})`, 'bad', r.incidentId ?? undefined);
      if (inc) this.consequence(inc, `${r.subject} was wrongly detained on a bad records return`);
    }
  }

  private chaseFromStop(stop: Incident, u: Unit | undefined) {
    const child = this.spawnConnected(stop, 'pursuit');
    if (!child) return;
    child.label = 'Vehicle fled traffic stop';
    if (u && u.assignedIncidentId === stop.id) { this.detach(u, true); u.status = 'AVAILABLE'; this.dispatch(u.id, child.id, { code: 3, self: true }); u.timer = 1; }
    if (stop.templateId === 'traffic_stop') this.finishIncident(stop, 'success');
  }

  /** officers on patrol pull cars over on their own — it ties them up and generates records requests */
  private trafficStops() {
    const st = this.state;
    if (st.config.mode === 'tutorial' || st.time < st.nextStopAt || st.time > st.config.durationSec - 60) return;
    st.nextStopAt = st.time + 120 + this.rng.range(0, 110) / Math.max(0.6, DIFFICULTY[st.config.difficulty].rate);
    if (st.dispatcherLoad > 0.75 || st.requests.filter((r) => r.status === 'open').length >= 2) return;
    const free = Object.values(st.units).filter((u) => u.service === 'police' && !isAir(u) && !u.temp && u.status === 'AVAILABLE' && u.capabilities.includes('patrol') && checkCrew(st, u) && st.config.districts.includes(this.city.nodes[u.prevNode].district));
    if (free.length < 3) return;
    const u = this.rng.pick(free);
    const here = this.city.nodes[u.prevNode];
    const near = (this.city.nodesInDistrict[here.district] ?? []).filter((n) => { const m = this.city.nodes[n]; const d = Math.hypot(m.x - here.x, m.y - here.y); return d > 50 && d < 190 && this.city.adj[n].some((e) => this.city.edges[e].cls !== 'highway'); });
    if (!near.length) return;
    const node = this.rng.pick(near);
    const inc = this.spawnIncident('traffic_stop', here.district, { noCall: true, nodeId: node });
    inc.label = 'Traffic stop';
    this.radio(u.spoken, `Dispatch, ${u.spoken}. Show me out on a traffic stop, ${addressOf(this.city, node)}.`, 'unit', u.id, inc.id);
    this.dispatch(u.id, inc.id, { code: 2, self: true });
  }

  // ── Air support ───────────────────────────────────────────────────────────
  private fly(u: Unit, tx: number, ty: number, dt: number, mult = 1) {
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    const step = AIR_SPEED * mult * dt * (this.state.weather === 'fog' ? 0.85 : 1);
    if (d <= step) { u.x = tx; u.y = ty; } else { u.x += (dx / d) * step; u.y += (dy / d) * step; }
    u.speed = Math.min(d / dt, AIR_SPEED * mult);
  }
  private airHome(u: Unit) { u.status = 'RETURNING'; u.destNode = u.postNode; u.route = []; u.note = undefined; }

  private updateAir(u: Unit, dt: number) {
    const st = this.state, city = this.city;
    const airborne = u.status === 'EN_ROUTE' || u.status === 'ON_SCENE' || u.status === 'RETURNING';
    u.fuel ??= 100;
    if (airborne) u.fuel = Math.max(0, u.fuel - dt * 100 / 420);
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    if (airborne && u.status !== 'RETURNING') {
      const why = st.weather === 'storm' ? "Weather's beyond our limits — we're returning to base." : u.fuel < 15 ? 'Bingo fuel — returning to base to refuel.' : null;
      if (why) {
        this.radio(u.spoken, `Dispatch, ${u.spoken}. ${why}`, 'alert', u.id, inc?.id);
        this.notify(`${u.callsign} returning to base — ${st.weather === 'storm' ? 'weather' : 'low fuel'}`, 'warn', inc?.id);
        if (inc) this.detach(u, true);
        this.airHome(u);
        return;
      }
    }
    if (airborne && Math.floor(st.time / dt) % 4 === 0) u.prevNode = city.nearestNode(u.x, u.y);
    switch (u.status) {
      case 'DISPATCHED': {
        u.timer -= dt;
        if (u.timer > 0) break;
        if (!inc || inc.reportedNode === null) { u.status = 'AVAILABLE'; u.assignedIncidentId = undefined; break; }
        u.status = 'EN_ROUTE';
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Wheels up, en route to ${addressOf(city, inc.reportedNode)}.`, 'unit', u.id, inc.id);
        this.emit({ type: 'status', unitId: u.id });
        break;
      }
      case 'EN_ROUTE': case 'ON_SCENE': {
        if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) { u.assignedIncidentId = undefined; this.airHome(u); break; }
        const m = inc.pursuit ? inc.mover : null;
        const locked = !!m && m.heliId === u.id;
        const n = city.nodes[inc.reportedNode ?? inc.nodeId];
        const tx = locked ? m!.x : n.x, ty = locked ? m!.y : n.y;
        const d = Math.hypot(tx - u.x, ty - u.y);
        if (u.status === 'EN_ROUTE') {
          this.fly(u, tx, ty, dt);
          u.eta = d / AIR_SPEED;
          if (d < 26) {
            u.status = 'ON_SCENE'; u.eta = 0;
            this.emit({ type: 'arrive', unitId: u.id });
            if (m) { u.note = locked ? 'Eyes on suspect' : 'Searching'; if (!locked) this.radio(u.spoken, `Dispatch, ${u.spoken}. Over the last known position — searching with the camera.`, 'unit', u.id, inc.id); }
            else { u.note = 'Overhead'; this.radio(u.spoken, `Dispatch, ${u.spoken}. Overhead ${addressOf(city, inc.reportedNode ?? inc.nodeId)}, providing air support.`, 'unit', u.id, inc.id); }
          }
        } else {
          // orbit the scene, or sit right on top of the vehicle we are tracking
          const ang = st.time * (locked ? 1.4 : 0.55) + u.id.charCodeAt(u.id.length - 1);
          const r = locked ? 14 : 36;
          this.fly(u, tx + Math.cos(ang) * r, ty + Math.sin(ang) * r, dt, locked ? 1.3 : 0.45);
          if (!locked && d > 110) { u.status = 'EN_ROUTE'; u.note = undefined; }
          if (m && !locked) u.note = 'Searching';
        }
        break;
      }
      case 'RETURNING': {
        const n = city.nodes[u.postNode];
        const d = Math.hypot(n.x - u.x, n.y - u.y);
        this.fly(u, n.x, n.y, dt);
        u.eta = d / AIR_SPEED;
        if (d < 2) {
          u.x = n.x; u.y = n.y; u.prevNode = u.postNode; u.eta = 0; u.speed = 0; u.destNode = null; u.assignedIncidentId = undefined;
          const need = 100 - u.fuel;
          if (need > 6) { u.status = 'BUSY'; u.timer = 10 + need * 0.8; u.note = 'Refuelling'; }
          else { u.status = 'AVAILABLE'; u.note = undefined; u.fuel = 100; }
          this.emit({ type: 'status', unitId: u.id });
        }
        break;
      }
      case 'BUSY': {
        u.timer -= dt;
        if (u.timer > 0) break;
        const n = city.nodes[u.postNode];
        if (Math.hypot(n.x - u.x, n.y - u.y) < 4) {
          const refuelled = u.note === 'Refuelling';
          u.status = 'AVAILABLE'; u.fuel = 100; u.note = undefined;
          if (refuelled) this.radio(u.spoken, `Dispatch, ${u.spoken}. Refuelled and available.`, 'unit', u.id);
        } else { u.assignedIncidentId = undefined; this.airHome(u); }
        break;
      }
      case 'OUT_OF_SERVICE': {
        if (u.timer > 0) { u.timer -= dt; if (u.timer <= 0) { u.status = 'AVAILABLE'; u.note = undefined; } }
        break;
      }
      default: break;
    }
  }

  private compass(heading: number): string {
    const a = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return ['eastbound', 'southbound', 'westbound', 'northbound'][Math.round(a / (Math.PI / 2)) % 4];
  }
  /** street the vehicle is on and the next cross street, for air-to-ground commentary */
  private moverWhere(m: NonNullable<Incident['mover']>): { street: string; cross: string; dir: string } {
    const city = this.city;
    const ahead = m.next >= 0 ? m.next : m.prev;
    const eid = m.next >= 0 ? city.edgeBetween.get(m.prev * 100000 + m.next) : undefined;
    const street = eid !== undefined ? city.edges[eid].name : city.nodes[ahead].addrStreet;
    const n = city.nodes[ahead];
    const cross = n.addrStreet === street ? n.crossStreet : n.addrStreet;
    return { street, cross, dir: this.compass(m.heading) };
  }
  private straightAhead(from: number, at: number): number {
    const city = this.city;
    const a = city.nodes[from], b = city.nodes[at];
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    let best = -1, bd = 0.9;
    for (const eid of city.adj[at]) {
      const e = city.edges[eid];
      const n = e.a === at ? e.b : e.a;
      if (n === from || this.closedMask[eid]) continue;
      const c = city.nodes[n];
      let diff = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - dir);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < bd) { bd = diff; best = n; }
    }
    return best;
  }

  /** ask the aircraft where the suspect is right now */
  askAir(incId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const inc = st.incidents[incId];
    const m = inc?.mover;
    if (!inc || !m) return { ok: false, reason: 'No pursuit selected' };
    const h = inc.assignedUnits.map((id) => st.units[id]).find((u) => u && isAir(u));
    if (!h) return { ok: false, reason: 'No air unit assigned to this pursuit' };
    this.radio('DISPATCH', `${h.spoken}, dispatch. What's your suspect's location?`, 'dispatch', h.id, inc.id);
    if (m.heliId === h.id) { this.heliCommentary(inc, h, true); return { ok: true }; }
    this.radio(h.spoken, h.status === 'ON_SCENE' ? `Dispatch, ${h.spoken}. Negative contact — still searching around ${addressOf(this.city, inc.reportedNode ?? inc.nodeId)}.` : `Dispatch, ${h.spoken}. Not on scene yet, ${Math.max(5, Math.round((h.eta ?? 0) / 5) * 5)} seconds out.`, 'unit', h.id, inc.id);
    return { ok: true };
  }
  private heliCommentary(inc: Incident, h: Unit, asked = false) {
    const m = inc.mover!;
    const w = this.moverWhere(m);
    const lines = [
      `Suspect ${w.dir} on ${w.street}, approaching ${w.cross}.`,
      `Vehicle still ${w.dir} on ${w.street} — coming up on ${w.cross}, speed increasing.`,
      `He's on ${w.street} ${w.dir}, next junction ${w.cross}. Ground units, he's running lights.`,
      `Still got him. ${w.street}, ${w.dir}, toward ${w.cross}.`,
    ];
    m.lastHeliReport = this.state.time;
    this.radio(h.spoken, `${asked ? 'Dispatch, ' + h.spoken + '. ' : ''}${this.rng.pick(lines)}`, 'unit', h.id, inc.id);
  }

  /** dispatcher relays the aircraft's position: ground units are sent to an intercept point ahead of the suspect */
  relayAir(incId: string): { ok: boolean; reason?: string } {
    const st = this.state, city = this.city;
    const inc = st.incidents[incId];
    const m = inc?.mover;
    if (!inc || !m || ['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'No active pursuit' };
    const h = m.heliId ? st.units[m.heliId] : undefined;
    if (!h) return { ok: false, reason: 'Air support has no eyes on the suspect' };
    let prev = m.next >= 0 ? m.prev : m.came, node = m.next >= 0 ? m.next : m.prev;
    for (let k = 0; k < 2 && prev >= 0; k++) { const a = this.straightAhead(prev, node); if (a < 0) break; prev = node; node = a; }
    inc.reportedNode = node; inc.relayedAt = st.time; m.lastUpdate = st.time;
    st.stats.heliRelays++;
    const w = this.moverWhere(m);
    const ground = inc.assignedUnits.map((id) => st.units[id]).filter((u): u is Unit => !!u && !isAir(u));
    const names = ground.slice(0, 3).map((u) => u.spoken).join(', ');
    this.radio('DISPATCH', `All units, ${h.spoken} has the suspect ${w.dir} on ${w.street}.${names ? ` ${names} — set up to intercept at ${addressOf(city, node)}.` : ' Any unit able, respond.'}`, 'dispatch', undefined, inc.id);
    for (const u of ground) if (u.status === 'EN_ROUTE') { this.routeUnit(u, node, true); u.note = undefined; }
    const g = ground.find((u) => u.status === 'EN_ROUTE');
    if (g) this.radio(g.spoken, this.rng.pick(['Copy, moving to intercept.', `${g.spoken} copies, en route to the intercept.`, 'Copy that — cutting across now.']), 'unit', g.id, inc.id);
    this.fx('info', node, 'Intercept point');
    return { ok: true };
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
    if (isAir(u)) msg = msg.replace(/\.$/, '') + `. Fuel ${Math.round(u.fuel ?? 100)} percent.`;
    this.radio(u.spoken, msg, 'unit', u.id, inc?.id);
    return msg;
  }

  // ── Dispatch planning helpers (UI) ────────────────────────────────────────
  private impactCache = new Map<string, { t: number; v: { service: Service; before: number; after: number; exposed: string | null } }>();
  /** how much of the active city loses its sub-100 s cover for this service if the unit leaves */
  coverageImpact(unitId: string): { service: Service; before: number; after: number; exposed: string | null } | null {
    const st = this.state;
    const u = st.units[unitId];
    if (!u || !['AVAILABLE', 'RETURNING'].includes(u.status) || isAir(u)) return null;
    const key = `${unitId}:${Math.floor(st.time / 3)}`;
    const c = this.impactCache.get(unitId);
    if (c && Math.floor(c.t / 3) === Math.floor(st.time / 3)) return c.v;
    void key;
    const thr = 100;
    const nodes = st.config.districts.flatMap((d) => this.city.nodesInDistrict[d]);
    const before = this.coverageTimes(u.service);
    const sources: Array<{ node: number; offset: number }> = [];
    for (const o of Object.values(st.units)) {
      if (o.id === u.id || o.service !== u.service || o.temp || isAir(o)) continue;
      if (o.status === 'AVAILABLE') sources.push({ node: o.prevNode, offset: this.mobilizationTime(o) });
      else if (o.status === 'RETURNING' && o.destNode !== null && !o.assignedIncidentId) sources.push({ node: o.destNode, offset: this.mobilizationTime(o) + Math.max(0, o.eta ?? 0) });
    }
    const after = sources.length ? multiSourceTimes(this.city, sources, this.tm(true), 1) : new Float32Array(this.city.nodes.length).fill(Infinity);
    const frac = (t: Float32Array) => nodes.filter((n) => t[n] <= thr).length / Math.max(1, nodes.length);
    let exposed: string | null = null, worst = 0;
    for (const d of st.config.districts) {
      const ids = this.city.nodesInDistrict[d];
      const drop = (ids.filter((n) => before[n] <= thr).length - ids.filter((n) => after[n] <= thr).length) / ids.length;
      if (drop > worst) { worst = drop; exposed = drop > 0.35 ? this.city.districtById[d].name : null; }
    }
    const v = { service: u.service, before: frac(before), after: frac(after), exposed };
    this.impactCache.set(unitId, { t: st.time, v });
    return v;
  }
  private previewCache = new Map<string, { t: number; path: number[] }>();
  previewRoute(unitId: string, nodeId: number): number[] {
    const u = this.state.units[unitId];
    if (!u) return [];
    const key = `${unitId}:${nodeId}`;
    const c = this.previewCache.get(key);
    if (c && this.state.time - c.t < 3) return c.path;
    if (isAir(u)) return [u.prevNode, nodeId];
    const start = u.route.length && ['EN_ROUTE', 'RETURNING', 'DISPATCHED'].includes(u.status) ? u.route[0] : u.prevNode;
    const r = findRoute(this.city, start, nodeId, this.tm(true), this.unitSpeedFactor(u));
    const path = r ? [start, ...r.path] : [];
    this.previewCache.set(key, { t: this.state.time, path });
    return path;
  }
  /** nearest free units that together cover the suggested response */
  buildPlan(incId: string, reqs: Req[]): { units: Array<{ unit: Unit; covers: Capability[]; eta: number }>; uncovered: Capability[] } {
    const st = this.state;
    const inc = st.incidents[incId];
    const out: Array<{ unit: Unit; covers: Capability[]; eta: number }> = [];
    const uncovered: Capability[] = [];
    if (!inc || inc.reportedNode === null) return { units: out, uncovered };
    const assigned = inc.assignedUnits.map((id) => st.units[id]).filter(Boolean);
    const chosen = new Set<string>();
    for (const r of reqs) {
      let have = assigned.filter((u) => u.capabilities.includes(r.cap)).length + out.filter((x) => x.unit.capabilities.includes(r.cap)).length;
      for (const x of out) if (x.unit.capabilities.includes(r.cap) && !x.covers.includes(r.cap)) x.covers.push(r.cap);
      while (have < r.n) {
        const cands = Object.values(st.units).filter((u) => !chosen.has(u.id) && !inc.assignedUnits.includes(u.id) && u.capabilities.includes(r.cap) && (u.status === 'AVAILABLE' || (u.status === 'RETURNING' && !u.assignedIncidentId)) && checkCrew(st, u))
          .map((u) => ({ u, eta: this.estimate(u.id, inc.reportedNode!)?.eta ?? Infinity }))
          .sort((a, b) => a.eta - b.eta || a.u.capabilities.length - b.u.capabilities.length);
        if (!cands.length || !isFinite(cands[0].eta)) { uncovered.push(r.cap); break; }
        chosen.add(cands[0].u.id);
        out.push({ unit: cands[0].u, covers: [r.cap], eta: cands[0].eta });
        have++;
      }
    }
    return { units: out, uncovered };
  }

  // ── Coverage ──────────────────────────────────────────────────────────────
  coverageTimes(service: Service): Float32Array {
    const c = this.covCache[service];
    if (c && this.state.time - c.t < 3) return c.times;
    const sources: Array<{ node: number; offset: number }> = [];
    for (const u of Object.values(this.state.units)) {
      if (u.service !== service || u.temp || isAir(u)) continue;
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
      if (inc.templateId === 'traffic_stop') { inc.outcome = 'success'; inc.status = 'RESOLVED'; continue; }
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
