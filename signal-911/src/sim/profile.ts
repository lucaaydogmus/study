// The persistent career profile and the application of a finished shift to it.
import { getCity } from './city';
import { evaluateObjectives, computeScore, averageOf } from './scoring';
import { Rng } from './rng';
import { buildStartingFleet, UNIT_TYPE_BY_ID, UPGRADE_BY_ID, hireCost, makePersonnel, makeStation, makeUnit, BUILD_STATION_COST, primarySkill, personnelSalary } from './fleet';
import { rankDef, rankForXp, RANKS } from './progression';
import { ALL_DISTRICTS, CHAPTERS, baseConfig, rollStoryline, rollSurprises } from './scenarios';
import { CONTRACT_BY_ID, contractProgress, modProduct, rollExtras } from './extras';
import type { CityState, GameState, Personnel, Service, ShiftConfig, ShiftScore, Station, Unit, UpgradeLevels } from './types';
import type { ShiftSetup } from './engine';
import { TEMPLATE_BY_ID } from './content/templates';

export const PROFILE_VERSION = 4;

export interface Settings {
  master: number; effects: number; radio: number; music: number; ambience: number; muted: boolean;
  hideIntense: boolean; reduceMotion: boolean; highContrast: boolean; autoSave: boolean; showHints: boolean; defaultSpeed: number;
  aiCallers: boolean; aiMaxLines: number; heartbeat: boolean; sirens: number;
  /** cinematic 3D city or the classic 2D map */ graphics?: '3d' | '2d';
  /** 3D quality: shadows, anti-aliasing and resolution */ quality?: 'high' | 'medium' | 'low';
  /** caller voices read aloud with the browser's speech engine */ tts?: boolean;
}
export const DEFAULT_SETTINGS: Settings = { master: 0.8, effects: 0.8, radio: 0.7, music: 0.0, ambience: 0.5, muted: false, hideIntense: false, reduceMotion: false, highContrast: false, autoSave: true, showHints: true, defaultSpeed: 1, aiCallers: true, aiMaxLines: 150, heartbeat: true, sirens: 0.75, graphics: '3d', quality: 'high', tts: true };

export interface Lifetime {
  shifts: number; calls: number; answered: number; resolved: number; failed: number; casualties: number; livesHelped: number; falseAlarms: number;
  moneyEarned: number; responseSum: number; responseN: number; bestScore: number; bestGrade: string; playSeconds: number; dispatches: number;
  merges: number; pursuits: number; verifies: number; gradeA: number; calmed: number; bestStreak: number; contracts: number;
}
export interface ShiftSummary { n: number; title: string; mode: string; score: number; grade: string; resolved: number; failed: number; avgResponse: number; money: number; xp: number; at: number; difficulty: string }

export interface Profile {
  version: number; id: string; name: string; createdAt: number; updatedAt: number;
  rank: number; xp: number; money: number; reputation: number;
  stations: Station[]; units: Unit[]; personnel: Personnel[]; upgrades: UpgradeLevels;
  city: CityState; stats: Lifetime; history: ShiftSummary[];
  campaign: { completed: string[]; grades: Record<string, string> };
  scenarios: Record<string, { best: string; bestScore: number; plays: number }>;
  endless: { bestWave: number; bestScore: number; current: { wave: number; score: number; active: boolean } };
  counters: { unit: number; person: number; shift: number; seed: number };
  flags: { tutorialDone: boolean; difficulty: ShiftConfig['difficulty']; duration: number };
  achievements: Record<string, number>;
  daily: Record<string, { score: number; grade: string }>;
}

const emptyLifetime = (): Lifetime => ({ shifts: 0, calls: 0, answered: 0, resolved: 0, failed: 0, casualties: 0, livesHelped: 0, falseAlarms: 0, moneyEarned: 0, responseSum: 0, responseN: 0, bestScore: 0, bestGrade: '-', playSeconds: 0, dispatches: 0, merges: 0, pursuits: 0, verifies: 0, gradeA: 0, calmed: 0, bestStreak: 0, contracts: 0 });
export const emptyLifetimeStats = emptyLifetime;

export function newProfile(name = 'Dispatcher', seed = Date.now() % 2 ** 31): Profile {
  const rng = new Rng(seed);
  const fleet = buildStartingFleet(rng);
  return {
    version: PROFILE_VERSION, id: `p-${seed}`, name, createdAt: Date.now(), updatedAt: Date.now(), rank: 1, xp: 0, money: 250000, reputation: 50,
    stations: fleet.stations, units: fleet.units, personnel: fleet.personnel, upgrades: { ali: 1 },
    city: { closedRoads: [], districtTraffic: {}, damagedStations: {}, log: [] }, stats: emptyLifetime(), history: [],
    campaign: { completed: [], grades: {} }, scenarios: {}, endless: { bestWave: 0, bestScore: 0, current: { wave: 0, score: 0, active: false } },
    counters: { unit: fleet.units.length + 1, person: fleet.personnel.length + 1, shift: 1, seed }, flags: { tutorialDone: false, difficulty: 'hard', duration: 15 * 60 },
    achievements: {}, daily: {},
  };
}

export function unlockedDistricts(rank: number): string[] {
  const city = getCity();
  return city.districts.filter((d) => d.unlockRank <= rank).map((d) => d.id);
}

export function setupFromProfile(p: Profile): ShiftSetup {
  return {
    rank: p.rank, reputation: p.reputation, budget: p.money, stations: p.stations, units: p.units, personnel: p.personnel, upgrades: p.upgrades,
    city: p.city,
  };
}

/** free-play / scenario setup: a clean fleet configured independently of the career profile */
export function temporarySetup(opts: { units?: number; budget?: number; rank?: number; reduced?: boolean; seed?: number; fleet?: { stations?: Array<[Service, string]>; units?: Array<[string, string]> } } = {}): ShiftSetup {
  const rng = new Rng(opts.seed ?? 77);
  const fleet = buildStartingFleet(rng);
  // the helicopter is kept out of the vehicle count (and out of reduced fleets)
  const air = opts.reduced ? [] : fleet.units.filter((u) => u.type === 'helicopter');
  let units = fleet.units.filter((u) => u.type !== 'helicopter');
  let personnel = fleet.personnel.filter((pp) => !pp.unitId || units.some((u) => u.id === pp.unitId) || air.some((u) => u.id === pp.unitId));
  const target = opts.units ?? (opts.reduced ? 7 : 12);
  if (target < units.length) {
    const keep = new Set<string>();
    // keep a balanced mix
    for (const svc of ['police', 'fire', 'medical'] as Service[]) units.filter((u) => u.service === svc).slice(0, Math.max(1, Math.round(target / 3))).forEach((u) => keep.add(u.id));
    units = units.filter((u) => keep.has(u.id));
    personnel = personnel.filter((pp) => pp.unitId && (keep.has(pp.unitId) || air.some((u) => u.id === pp.unitId)));
  } else if (target > units.length) {
    const extraTypes = ['patrol', 'engine', 'ambulance', 'patrol', 'advanced_ambulance', 'rescue', 'engine', 'motorcycle'];
    const stationsByService = (s: Service) => fleet.stations.filter((x) => x.service === s);
    let pid = 5000, uid = 5000;
    for (let i = 0; units.length < target; i++) {
      const def = UNIT_TYPE_BY_ID[extraTypes[i % extraTypes.length]];
      const st = stationsByService(def.service)[i % 2];
      const u = makeUnit(def, st, units, uid++);
      for (let k = 0; k < def.crew; k++) { const pp = makePersonnel(rng, def.service, `p${pid++}`, 1, u.id); personnel.push(pp); u.personnelIds.push(pp.id); }
      units = [...units, u];
    }
  }
  units = [...units, ...air];
  // scenario set pieces bring their own stations and specialist vehicles
  const stations = [...fleet.stations];
  for (const [svc, d] of opts.fleet?.stations ?? []) if (!stations.some((x) => x.id === `${svc}-${d}`)) stations.push(makeStation(svc, d));
  let xid = 7000, xp = 7000;
  for (const [type, sid] of opts.fleet?.units ?? []) {
    const def = UNIT_TYPE_BY_ID[type];
    const stn = stations.find((x) => x.id === sid);
    if (!def || !stn) continue;
    const u = makeUnit(def, stn, units, xid++);
    for (let k = 0; k < def.crew; k++) { const pp = makePersonnel(rng, def.service, `p${xp++}`, 1.1, u.id); personnel.push(pp); u.personnelIds.push(pp.id); }
    units = [...units, u];
  }
  return { rank: opts.rank ?? 7, reputation: 50, budget: opts.budget ?? 200000, stations, units, personnel, upgrades: { ali: 2, console: 1 }, city: { closedRoads: [], districtTraffic: {}, damagedStations: {}, log: [] } };
}

/** a full service for every worn vehicle, between shifts */
export function serviceCost(p: Profile): number { return p.units.reduce((s, u) => s + Math.round(Math.max(0, 100 - (u.condition ?? 100)) * 60), 0); }
export function serviceFleet(p: Profile): boolean {
  const c = serviceCost(p);
  if (!c || c > p.money) return false;
  p.money -= c; for (const u of p.units) u.condition = 100;
  return true;
}

export function careerConfig(p: Profile, over: Partial<ShiftConfig> = {}): ShiftConfig {
  const rank = p.rank;
  const rankRate = 0.8 + rank * 0.07;
  const seed = (p.counters.seed + p.counters.shift * 7919) % 2 ** 31;
  const extras = rollExtras(seed, rank);
  const cfg = rollStoryline(baseConfig({
    mode: 'career', title: `Shift ${p.counters.shift}`, briefing: `${rankDef(rank).title} — routine shift`, difficulty: p.flags.difficulty, durationSec: p.flags.duration,
    districts: unlockedDistricts(rank), incidentRate: rankRate, startHour: [8, 12, 16, 20, 2][p.counters.shift % 5], weather: (['clear', 'clear', 'rain', 'clear', 'fog', 'heat', 'clear'] as const)[p.counters.shift % 7],
    seed, modifiers: extras.modifiers, contracts: extras.contracts,
    ...over,
  }), rank, seed);
  // chapters are handcrafted; ordinary shifts can go sideways at any moment
  return over.chapterId ? cfg : rollSurprises(cfg, rank, seed);
}

export interface ShiftResult {
  score: ShiftScore; xp: number; xpBreakdown: Array<[string, number]>; money: number; moneyBreakdown: Array<[string, number]>; repDelta: number;
  promotedTo?: number; unlocked: string[]; chapterCompleted?: string; log: string[]; newRank: number; objectivesMet: number;
}

const DIFF_MULT = { casual: 0.85, standard: 1, hard: 1.2, expert: 1.4 };

export function computeResult(st: GameState): ShiftResult {
  const score = st.scoreBreakdown ?? computeScore(st);
  evaluateObjectives(st);
  const s = st.stats;
  const mult = DIFF_MULT[st.config.difficulty];
  const cfg = st.config;
  const len = cfg.durationSec / 900; // pay and costs scale with shift length (15 min = 1)
  const contract = Math.round(44000 * Math.max(0.6, len) * mult * (0.5 + 0.5 * score.total / 100) * (0.8 + st.reputation / 250) * modProduct(cfg, 'pay'));
  const bonus = Math.round(s.bonus * mult);
  let salaries = 0;
  // the air unit is funded by the city: its crew and upkeep are not charged to dispatch
  for (const u of Object.values(st.units)) if (!u.temp && u.type !== 'helicopter') for (const pid of u.personnelIds) salaries += st.personnel[pid]?.salary ?? 0;
  for (const p of Object.values(st.personnel)) if (!p.unitId) salaries += p.salary;
  salaries = Math.round(salaries * modProduct(cfg, 'salary') * len);
  const maintenance = Math.round(Object.values(st.units).filter((u) => !u.temp && u.type !== 'helicopter').length * 260 * len);
  const dispatchCosts = Math.round(s.costs);
  const penalties = s.casualties * 4000;
  const contracts = (cfg.contracts ?? []).map((c) => ({ c, p: contractProgress(st, c), def: CONTRACT_BY_ID[c.id] })).filter((x) => x.def);
  const contractMoney = contracts.filter((x) => x.p.done).reduce((a, x) => a + x.def.reward, 0);
  const contractXp = contracts.filter((x) => x.p.done).reduce((a, x) => a + x.def.xp, 0);
  s.contractBonus = contracts.filter((x) => x.p.done).length;
  // the city pays a hazard grant for every major incident brought to a good end (duplicate reports excluded)
  const majorsOk = Object.values(st.incidents).filter((i) => !i.duplicateOf && TEMPLATE_BY_ID[i.templateId]?.major && i.outcome === 'success').length;
  s.majorsHandled = majorsOk;
  const majorGrant = Math.round(majorsOk * 9000 * mult);
  const money = contract + bonus + contractMoney + majorGrant - salaries - maintenance - dispatchCosts - penalties;
  const objDone = st.config.objectives.filter((o) => o.done).length;
  const objBonus = st.config.objectives.filter((o) => o.done && !o.optional).length * 40 + st.config.objectives.filter((o) => o.done && o.optional).length * 25;
  const xpBreakdown: Array<[string, number]> = [
    ['Performance score', Math.round(score.total * 2.1)], ['Incidents resolved', s.resolved * 12], ['Objectives', objBonus],
    ['Grade bonus', { S: 120, A: 70, B: 35, C: 10, D: 0, F: 0 }[score.grade]], ['Contracts', contractXp], ['Best streak', Math.min(60, s.bestStreak * 6)],
    ...(majorsOk ? [['Major incidents handled', majorsOk * 60] as [string, number]] : []),
  ];
  const xp = Math.max(10, Math.round(xpBreakdown.reduce((a, [, v]) => a + v, 0) * (0.8 + mult * 0.2)));
  const repDelta = Math.round(((score.total - 62) / 9 - s.casualties * 1.2) * modProduct(cfg, 'rep') * 10) / 10;
  return {
    score, xp, xpBreakdown, money,
    moneyBreakdown: [['City contract', contract], ['Incident bonuses', bonus], ...contracts.filter((x) => x.p.done).map((x) => [`Contract — ${x.p.text}`, x.def.reward] as [string, number]), ...(majorGrant ? [['Major incident hazard grant', majorGrant] as [string, number]] : []), ['Salaries', -salaries], ['Vehicle maintenance', -maintenance], ['Dispatch operating costs', -dispatchCosts], ['Casualty settlements', -penalties]],
    repDelta, unlocked: [], log: [], newRank: rankForXp(0), objectivesMet: objDone,
  };
}

/** Apply a finished career shift to the profile in place. */
export function applyShift(p: Profile, st: GameState): ShiftResult {
  const res = computeResult(st);
  const s = st.stats;
  const oldRank = p.rank;
  p.money += res.money;
  p.xp += res.xp;
  // wear and tear carries over to the next shift
  for (const u of p.units) { const live = st.units[u.id]; if (live && live.condition !== undefined) u.condition = Math.round(live.condition); }
  p.reputation = Math.max(0, Math.min(100, p.reputation + res.repDelta));
  p.rank = rankForXp(p.xp);
  res.newRank = p.rank;
  if (p.rank > oldRank) {
    res.promotedTo = p.rank;
    res.unlocked = RANKS[p.rank - 1].unlocks;
  }
  // chapter completion
  const chId = st.config.chapterId;
  if (chId) {
    const ch = CHAPTERS.find((c) => c.id === chId);
    const must = st.config.objectives.filter((o) => !o.optional);
    if (ch && must.length && must.every((o) => o.done) && res.score.grade !== 'F') {
      if (!p.campaign.completed.includes(chId)) { p.campaign.completed.push(chId); p.money += ch.reward.money; p.xp += ch.reward.xp; res.chapterCompleted = chId; res.moneyBreakdown.push([`Chapter reward — ${ch.title}`, ch.reward.money]); res.money += ch.reward.money; res.xp += ch.reward.xp; p.rank = rankForXp(p.xp); res.newRank = p.rank; }
      const prev = p.campaign.grades[chId];
      if (!prev || 'FDCBAS'.indexOf(res.score.grade) > 'FDCBAS'.indexOf(prev)) p.campaign.grades[chId] = res.score.grade;
    }
  }
  // personnel growth
  const academy = p.upgrades.academy ?? 0;
  for (const per of p.personnel) {
    const sim = st.personnel[per.id];
    if (!sim) continue;
    per.fatigue = Math.max(0, sim.fatigue * 0.35);
    const work = Object.values(st.units).find((u) => u.id === per.unitId)?.deployments ?? 0;
    const gain = (0.5 + work * 0.35) * (1 + 0.4 * academy);
    per.experience = Math.min(99, per.experience + gain);
    per.training = Math.min(99, per.training + 0.4 * (1 + 0.4 * academy));
    if (per.service === 'medical') per.medical = Math.min(99, per.medical + gain * 0.5);
    if (per.service === 'fire') per.fire = Math.min(99, per.fire + gain * 0.5);
    if (per.service === 'police') per.policing = Math.min(99, per.policing + gain * 0.5);
    per.driving = Math.min(99, per.driving + 0.1);
    per.morale = Math.max(10, Math.min(100, per.morale + (res.score.total - 60) / 12 + academy * 0.8));
    per.salary = personnelSalary(per);
  }
  // units reset
  for (const u of p.units) {
    const sim = st.units[u.id];
    if (sim) u.deployments += sim.deployments;
    u.status = 'AVAILABLE'; u.route = []; u.assignedIncidentId = undefined; u.eta = null; u.patients = 0; u.note = undefined; u.timer = 0; u.destNode = null; u.prevNode = u.postNode;
    const n = getCity().nodes[u.postNode]; u.x = n.x; u.y = n.y;
  }
  // persistent city consequences
  const c = p.city;
  c.closedRoads = c.closedRoads.map((r) => ({ ...r, shifts: r.shifts - 1 })).filter((r) => r.shifts > 0);
  for (const k of Object.keys(c.districtTraffic)) { c.districtTraffic[k] = c.districtTraffic[k] * 0.5; if (c.districtTraffic[k] < 0.02) delete c.districtTraffic[k]; }
  for (const k of Object.keys(c.damagedStations)) { c.damagedStations[k]--; if (c.damagedStations[k] <= 0) { delete c.damagedStations[k]; const stn = p.stations.find((x) => x.id === k); if (stn) stn.disabledShifts = 0; } }
  c.log = [];
  const city = getCity();
  for (const inc of Object.values(st.incidents)) {
    const heavy = inc.outcome === 'failed' && (inc.category === 'fire' || inc.templateId === 'collision_multi' || inc.templateId === 'building_collapse');
    if (heavy) {
      const eid = city.adj[inc.nodeId].find((e) => city.edges[e].cls !== 'highway' && city.edges[e].cls !== 'bridge');
      if (eid !== undefined && !c.closedRoads.some((r) => r.edge === eid)) { c.closedRoads.push({ edge: eid, shifts: 2 }); c.log.push(`${city.nodes[inc.nodeId].addrStreet} in ${city.districtById[inc.district].name} is closed for repairs after the ${inc.label.toLowerCase()}.`); }
      c.districtTraffic[inc.district] = Math.min(0.25, (c.districtTraffic[inc.district] ?? 0) + 0.08);
      const fireStn = p.stations.find((x) => x.service === 'fire' && x.district === inc.district);
      if (inc.category === 'fire' && fireStn && !c.damagedStations[fireStn.id] && inc.severity >= 4 && inc.id.length % 2 === 0) { c.damagedStations[fireStn.id] = 1; c.log.push(`${fireStn.name} lost power in the fire and is out of service for one shift.`); }
    }
  }
  for (const m of c.closedRoads) void m;
  // stats
  const L = p.stats;
  L.shifts++; L.calls += s.callsReceived; L.answered += s.callsAnswered; L.resolved += s.resolved; L.failed += s.failed; L.casualties += s.casualties; L.livesHelped += s.livesHelped; L.falseAlarms += s.falseAlarms;
  L.moneyEarned += Math.max(0, res.money); L.responseSum += s.responseTimes.reduce((a, b) => a + b, 0); L.responseN += s.responseTimes.length; L.dispatches += s.dispatches;
  L.playSeconds += Math.round(st.time);
  L.merges = (L.merges ?? 0) + s.merges; L.pursuits = (L.pursuits ?? 0) + s.pursuitsCaught; L.verifies = (L.verifies ?? 0) + s.verifiedOk;
  L.calmed = (L.calmed ?? 0) + s.calmedCallers; L.bestStreak = Math.max(L.bestStreak ?? 0, s.bestStreak); L.contracts = (L.contracts ?? 0) + s.contractBonus;
  if (res.score.grade === 'A' || res.score.grade === 'S') L.gradeA = (L.gradeA ?? 0) + 1;
  if (res.score.total > L.bestScore) { L.bestScore = res.score.total; L.bestGrade = res.score.grade; }
  p.history.push({ n: p.counters.shift, title: st.config.title, mode: st.config.mode, score: res.score.total, grade: res.score.grade, resolved: s.resolved, failed: s.failed, avgResponse: Math.round(averageOf(s.responseTimes)), money: res.money, xp: res.xp, at: Date.now(), difficulty: st.config.difficulty });
  if (p.history.length > 40) p.history.shift();
  p.counters.shift++;
  p.updatedAt = Date.now();
  res.log = [...c.log];
  return res;
}

// ── Shopping / management actions ───────────────────────────────────────────
/** aircraft sit on the roof helipad and do not take a garage bay */
export function stationUnitCount(p: Profile, stationId: string) { return p.units.filter((u) => u.stationId === stationId && u.type !== 'helicopter').length; }
export function stationCapacity(p: Profile, st: Station) { return st.capacity + (p.upgrades.garage ?? 0); }

export function buyUnit(p: Profile, type: string, stationId: string): { ok: boolean; reason?: string } {
  const def = UNIT_TYPE_BY_ID[type];
  const stn = p.stations.find((s) => s.id === stationId);
  if (!def || !stn) return { ok: false, reason: 'Unknown item' };
  if (def.minRank > p.rank) return { ok: false, reason: `Requires rank ${def.minRank}` };
  if (stn.service !== def.service) return { ok: false, reason: 'Wrong station type' };
  if (stationUnitCount(p, stationId) >= stationCapacity(p, stn)) return { ok: false, reason: 'Station is at capacity' };
  if (p.money < def.cost) return { ok: false, reason: 'Not enough funds' };
  const rng = new Rng(p.counters.seed + p.counters.unit * 31);
  const u = makeUnit(def, stn, p.units, p.counters.unit++);
  u.id = `u${p.counters.unit}`;
  for (let k = 0; k < def.crew; k++) {
    const per = makePersonnel(rng, def.service, `p${p.counters.person++}`, 0.7, u.id);
    per.experience = Math.max(10, per.experience - 8);
    p.personnel.push(per); u.personnelIds.push(per.id);
  }
  p.units.push(u);
  p.money -= def.cost;
  p.updatedAt = Date.now();
  return { ok: true };
}
export function sellUnit(p: Profile, unitId: string): boolean {
  const u = p.units.find((x) => x.id === unitId);
  if (!u) return false;
  if (p.units.filter((x) => x.service === u.service).length <= 2) return false;
  p.money += Math.round(u.value * 0.45);
  for (const pid of u.personnelIds) { const per = p.personnel.find((x) => x.id === pid); if (per) per.unitId = null; }
  p.units = p.units.filter((x) => x.id !== unitId);
  return true;
}
export function buyUpgrade(p: Profile, id: string): { ok: boolean; reason?: string } {
  const def = UPGRADE_BY_ID[id];
  if (!def) return { ok: false, reason: 'Unknown' };
  const lvl = p.upgrades[id] ?? 0;
  if (lvl >= def.costs.length) return { ok: false, reason: 'Maxed' };
  if (def.minRank > p.rank) return { ok: false, reason: `Requires rank ${def.minRank}` };
  const cost = def.costs[lvl];
  if (p.money < cost) return { ok: false, reason: 'Not enough funds' };
  p.money -= cost; p.upgrades[id] = lvl + 1; p.updatedAt = Date.now();
  return { ok: true };
}
export function buildStation(p: Profile, service: Service, districtId: string): { ok: boolean; reason?: string } {
  const city = getCity();
  const d = city.districtById[districtId];
  if (!d) return { ok: false, reason: 'Unknown district' };
  if (d.unlockRank > p.rank) return { ok: false, reason: 'District not unlocked' };
  if (p.stations.some((s) => s.service === service && s.district === districtId)) return { ok: false, reason: 'Station already exists' };
  const cost = BUILD_STATION_COST[service];
  if (p.money < cost) return { ok: false, reason: 'Not enough funds' };
  p.stations.push(makeStation(service, districtId));
  p.money -= cost; p.updatedAt = Date.now();
  return { ok: true };
}
export function trainPersonnel(p: Profile, personId: string): { ok: boolean; reason?: string } {
  const per = p.personnel.find((x) => x.id === personId);
  if (!per) return { ok: false, reason: 'Unknown' };
  const cost = 2500;
  if (p.money < cost) return { ok: false, reason: 'Not enough funds' };
  p.money -= cost;
  per.training = Math.min(99, per.training + 8);
  per.experience = Math.min(99, per.experience + 3);
  per.morale = Math.min(100, per.morale + 5);
  if (per.service === 'medical') per.medical = Math.min(99, per.medical + 4);
  if (per.service === 'fire') per.fire = Math.min(99, per.fire + 4);
  if (per.service === 'police') per.policing = Math.min(99, per.policing + 4);
  per.salary = personnelSalary(per);
  return { ok: true };
}
export function candidatePool(p: Profile): Personnel[] {
  const rng = new Rng(p.counters.seed + p.counters.shift * 977);
  const out: Personnel[] = [];
  for (const svc of ['police', 'fire', 'medical'] as Service[]) for (let i = 0; i < 3; i++) { const c = makePersonnel(rng, svc, `cand-${svc}-${p.counters.shift}-${i}`, 0.9 + i * 0.35); out.push(c); }
  return out;
}
export function hirePersonnel(p: Profile, cand: Personnel, unitId: string | null): { ok: boolean; reason?: string } {
  const cost = hireCost(cand);
  if (p.money < cost) return { ok: false, reason: 'Not enough funds' };
  if (unitId) {
    const u = p.units.find((x) => x.id === unitId);
    if (!u || u.service !== cand.service) return { ok: false, reason: 'Wrong unit' };
    if (u.personnelIds.length >= u.crewSeats) return { ok: false, reason: 'No free seat' };
    u.personnelIds.push(cand.id);
    cand.unitId = unitId;
  }
  const per = { ...cand, id: `p${p.counters.person++}`, unitId };
  if (unitId) { const u = p.units.find((x) => x.id === unitId)!; u.personnelIds[u.personnelIds.length - 1] = per.id; }
  p.personnel.push(per);
  p.money -= cost;
  return { ok: true };
}
export function dismissPersonnel(p: Profile, pid: string): boolean {
  const per = p.personnel.find((x) => x.id === pid);
  if (!per) return false;
  if (per.unitId) { const u = p.units.find((x) => x.id === per.unitId); if (u) u.personnelIds = u.personnelIds.filter((x) => x !== pid); }
  p.personnel = p.personnel.filter((x) => x.id !== pid);
  return true;
}
export function assignPersonnel(p: Profile, pid: string, unitId: string | null): { ok: boolean; reason?: string } {
  const per = p.personnel.find((x) => x.id === pid);
  if (!per) return { ok: false, reason: 'Unknown' };
  if (unitId) {
    const u = p.units.find((x) => x.id === unitId);
    if (!u || u.service !== per.service) return { ok: false, reason: 'Wrong service' };
    if (u.personnelIds.length >= u.crewSeats) return { ok: false, reason: 'No free seat' };
    if (per.unitId) { const o = p.units.find((x) => x.id === per.unitId); if (o) o.personnelIds = o.personnelIds.filter((x) => x !== pid); }
    u.personnelIds.push(pid); per.unitId = unitId;
  } else {
    if (per.unitId) { const o = p.units.find((x) => x.id === per.unitId); if (o) o.personnelIds = o.personnelIds.filter((x) => x !== pid); }
    per.unitId = null;
  }
  return { ok: true };
}
void ALL_DISTRICTS; void primarySkill;
