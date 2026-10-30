import { createRng, type Rng } from './rng';
import { getCity } from './city';
import { findPath } from './pathfinding';
import { STARTING_FLEET, VEHICLES, type Leg, type Unit } from './units';
import { TEMPLATES, type Template } from './incidents';
import type {
  Capability, City, DistrictId, Difficulty, Edge, IncidentStatus, Weather,
} from './types';

export interface Config { seed: number; shiftMinutes: number; difficulty: Difficulty; weather: Weather }
export interface LogEntry { t: number; text: string; kind: 'info' | 'call' | 'dispatch' | 'arrive' | 'warn' | 'good' | 'bad' }

export interface Spec {
  templateId: string; variationId: string; district: DistrictId; nodeId: number; address: string; opening: string;
}
export interface Call {
  id: number; ringAt: number; deadline: number; status: 'ringing' | 'answered' | 'missed'; spec: Spec; incidentId?: number;
}
export interface Incident {
  id: number; templateId: string; title: string; label: string; district: DistrictId; nodeId: number;
  x: number; y: number; address: string; severity: number; required: Capability[]; status: IncidentStatus;
  callAt: number; notes: string[]; assigned: string[]; firstArrival: number | null;
  pressure: number; failAfter: number; workProgress: number; duration: number;
  escalations: number; complication: boolean; resolvedAt: number | null; outcome: string;
  surplus: number;
}
export interface Stats {
  answered: number; missed: number; resolved: number; failed: number; dispatched: number; unnecessary: number;
  responseTimes: number[]; spent: number; reward: number; fastResponses: number;
}

export interface World {
  config: Config; rng: Rng; city: City; time: number; length: number; over: boolean;
  units: Unit[]; incidents: Incident[]; calls: Call[]; log: LogEntry[]; stats: Stats;
  nextIncidentId: number; nextCallId: number; nextCallAt: number;
  recentTemplates: string[]; recentOpenings: string[]; finalSpawned: boolean;
  blocked: Set<number>; trafficPhase: Record<DistrictId, number>;
}

export const BASE_SPEED = 18;
const CLASS_MULT = { arterial: 1.0, street: 0.7, bridge: 0.9, narrow: 0.45 } as const;
export const CALL_RING_SECONDS = 20;
const BUSY_SECONDS = 4;
const MAX_ESCALATIONS = 2;

const DIFF = {
  easy: { interval: 1.3, fail: 1.25 },
  normal: { interval: 1, fail: 1 },
  hard: { interval: 0.75, fail: 0.85 },
} as const;

export function createWorld(config: Config): World {
  const city = getCity();
  const rng = createRng(config.seed);
  const counts: Record<string, number> = {};
  const units: Unit[] = STARTING_FLEET.map(([stationId, vehicle]) => {
    const v = VEHICLES[vehicle];
    const station = city.stations.find((s) => s.id === stationId)!;
    const n = (counts[vehicle] = (counts[vehicle] ?? 0) + 1);
    const node = city.nodes[station.nodeId];
    return {
      id: `${v.prefix}-${n}`, callsign: `${v.prefix}-${n}`, vehicle, service: v.service, stationId,
      x: node.x, y: node.y, node: node.id, status: 'AVAILABLE', caps: [...v.caps], personnel: v.personnel,
      equipment: [...v.equipment], incidentId: null, legs: [], eta: 0, busyUntil: 0,
    };
  });
  const phase = {} as Record<DistrictId, number>;
  for (const d of city.districts) phase[d.id] = rng.next() * Math.PI * 2;
  return {
    config, rng, city, time: 0, length: config.shiftMinutes * 60, over: false, units, incidents: [], calls: [],
    log: [{ t: 0, kind: 'info', text: 'Shift briefing complete. Ravenport dispatch is online.' }],
    stats: { answered: 0, missed: 0, resolved: 0, failed: 0, dispatched: 0, unnecessary: 0, responseTimes: [], spent: 0, reward: 0, fastResponses: 0 },
    nextIncidentId: 1, nextCallId: 1, nextCallAt: 6 + rng.next() * 6,
    recentTemplates: [], recentOpenings: [], finalSpawned: false, blocked: new Set(), trafficPhase: phase,
  };
}

/* ---------------------------------------------------------------- travel */

export function trafficAt(w: World, d: DistrictId): number {
  const base = w.city.districts.find((x) => x.id === d)!.traffic;
  return base * (1 + 0.2 * Math.sin(w.time / 90 + w.trafficPhase[d]));
}

/** Units/second for a unit on an edge: road class, vehicle, weather and local traffic. */
export function edgeSpeed(w: World, u: Unit, edge: Edge | null): number {
  const cls = edge ? CLASS_MULT[edge.cls] : 0.7;
  const t = trafficAt(w, edge ? edge.district : w.city.nodes[u.node].district);
  const penalty = 1 + (t - 1) * 0.5; // emergency vehicles are only partly slowed by traffic
  return (BASE_SPEED * VEHICLES[u.vehicle].speed * cls * (w.config.weather === 'rain' ? 0.85 : 1)) / penalty;
}

interface Plan { legs: Leg[]; eta: number }

/** Route a unit to a node starting from where it will next reach a junction. */
export function planRoute(w: World, u: Unit, dest: number): Plan | null {
  const first = u.legs[0];
  const start = first ? first.to : u.node;
  const path = findPath(w.city, start, dest, (e) => edgeSpeed(w, u, e), w.blocked);
  if (!path) return null;
  const legs: Leg[] = path.nodes.slice(1).map((n, i) => ({ to: n, edge: path.edges[i] }));
  let eta = path.time;
  if (first) {
    const n = w.city.nodes[first.to];
    eta += Math.hypot(n.x - u.x, n.y - u.y) / edgeSpeed(w, u, first.edge);
    return { legs: [first, ...legs], eta };
  }
  return { legs, eta };
}

export function unitEta(w: World, u: Unit): number {
  let t = 0, x = u.x, y = u.y;
  for (const leg of u.legs) {
    const n = w.city.nodes[leg.to];
    t += Math.hypot(n.x - x, n.y - y) / edgeSpeed(w, u, leg.edge);
    x = n.x; y = n.y;
  }
  return t;
}

/* ------------------------------------------------------- capability match */

const RARITY: Record<Capability, number> = { ADV_MEDICAL: 0, SECURITY: 0, RESCUE: 1, FIRE: 1, MEDICAL: 2, LAW: 2, TRAFFIC: 3 };

/** Assign units to requirement slots. A unit may fill one slot per capability it has. */
export function matchSlots(required: Capability[], units: Unit[]): (Unit | null)[] {
  const used = new Map<string, Set<Capability>>();
  const out: (Unit | null)[] = required.map(() => null);
  const order = required.map((_, i) => i).sort((a, b) => RARITY[required[a]] - RARITY[required[b]]);
  for (const i of order) {
    const cap = required[i];
    const cands = units
      .filter((u) => u.caps.includes(cap) && !used.get(u.id)?.has(cap))
      .sort((a, b) => a.caps.length - b.caps.length);
    if (cands.length) {
      const u = cands[0];
      out[i] = u;
      if (!used.has(u.id)) used.set(u.id, new Set());
      used.get(u.id)!.add(cap);
    }
  }
  return out;
}

export type SlotState = 'met' | 'enroute' | 'open';
export function slotStates(w: World, inc: Incident): SlotState[] {
  const mine = w.units.filter((u) => u.incidentId === inc.id);
  const onScene = matchSlots(inc.required, mine.filter((u) => u.status === 'ON SCENE'));
  const all = matchSlots(inc.required, mine);
  return inc.required.map((_, i) => (onScene[i] ? 'met' : all[i] ? 'enroute' : 'open'));
}

/* -------------------------------------------------------------- logging */

function log(w: World, kind: LogEntry['kind'], text: string) {
  w.log.push({ t: w.time, kind, text });
  if (w.log.length > 200) w.log.splice(0, w.log.length - 200);
}

/* --------------------------------------------------------------- calls */

const tplOf = (id: string): Template => TEMPLATES.find((t) => t.id === id)!;

function makeSpec(w: World, severe: boolean): Spec {
  const { rng, city } = w;
  const wt = TEMPLATES.map((t) => {
    if (severe && !t.variations.some((v) => v.severity >= 3)) return 0;
    const recent = w.recentTemplates.includes(t.id) ? 0.25 : 1;
    return recent * Object.values(t.districtWeights).reduce((a, b) => a + b, 0);
  });
  const tpl = TEMPLATES[weighted(rng, wt)];
  const dIds = Object.keys(tpl.districtWeights) as DistrictId[];
  const district = dIds[weighted(rng, dIds.map((d) => tpl.districtWeights[d]!))];
  const nodeId = rng.pick(city.nodesByDistrict[district]);
  const vars = tpl.variations.filter((v) => !severe || v.severity >= 3);
  const variation = vars[weighted(rng, vars.map((v) => v.weight))];
  const fresh = variation.openings.filter((o) => !w.recentOpenings.includes(o));
  const opening = rng.pick(fresh.length ? fresh : variation.openings);
  w.recentTemplates = [tpl.id, ...w.recentTemplates].slice(0, 2);
  w.recentOpenings = [opening, ...w.recentOpenings].slice(0, 5);
  const n = city.nodes[nodeId];
  return { templateId: tpl.id, variationId: variation.id, district, nodeId, address: `${rng.int(10, 98) * 10} ${n.street}`, opening };
}

function weighted(rng: Rng, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

const activeIncidents = (w: World) => w.incidents.filter((i) => i.status !== 'RESOLVED' && i.status !== 'FAILED');

/** Pacing: calm start, build-up, a breather, a harder stretch, then a final severe call. */
function phaseFactor(p: number): number {
  if (p < 0.08) return 2.0;
  if (p < 0.4) return 1.0;
  if (p < 0.5) return 1.6;
  if (p < 0.88) return 0.8;
  return 1.1;
}

function directorStep(w: World) {
  if (w.time < w.nextCallAt || w.time > w.length - 40) return;
  const ringing = w.calls.filter((c) => c.status === 'ringing').length;
  const load = activeIncidents(w).length + ringing;
  if (load >= 8) { w.nextCallAt = w.time + 10; return; }
  const p = w.time / w.length;
  const severe = p >= 0.88 && !w.finalSpawned;
  if (severe) w.finalSpawned = true;
  const spec = makeSpec(w, severe);
  const call: Call = { id: w.nextCallId++, ringAt: w.time, deadline: w.time + CALL_RING_SECONDS, status: 'ringing', spec };
  w.calls.push(call);
  log(w, 'call', `Incoming call from ${w.city.districts.find((d) => d.id === spec.district)!.name}.`);
  const free = w.units.filter((u) => u.status === 'AVAILABLE').length;
  const base = 18 + w.rng.next() * 14;
  w.nextCallAt = w.time + base * phaseFactor(p) * DIFF[w.config.difficulty].interval * (1 + 0.35 * Math.max(0, load - 2)) * (free === 0 ? 1.5 : 1);
}

function createIncident(w: World, call: Call, late: boolean): Incident {
  const spec = call.spec;
  const tpl = tplOf(spec.templateId);
  const v = tpl.variations.find((x) => x.id === spec.variationId)!;
  const n = w.city.nodes[spec.nodeId];
  const inc: Incident = {
    id: w.nextIncidentId++, templateId: tpl.id, title: tpl.title, label: v.label, district: spec.district,
    nodeId: spec.nodeId, x: n.x, y: n.y, address: spec.address, severity: v.severity, required: [...v.caps],
    status: 'AWAITING DISPATCH', callAt: call.ringAt,
    notes: late
      ? [`Reported late by a passerby (the call went unanswered). Location: ${spec.address}.`]
      : [`Caller: ${spec.opening}`, `Location: ${spec.address}.`],
    assigned: [], firstArrival: null, pressure: 0, failAfter: tpl.failAfter * DIFF[w.config.difficulty].fail,
    workProgress: 0, duration: tpl.duration * (0.8 + 0.2 * v.severity), escalations: 0, complication: false,
    resolvedAt: null, outcome: '', surplus: 0,
  };
  w.incidents.push(inc);
  call.incidentId = inc.id;
  log(w, 'info', `Incident #${inc.id}: ${inc.title} (${inc.label}) at ${inc.address}.`);
  return inc;
}

export function answerCall(w: World, callId: number): Incident | null {
  const c = w.calls.find((x) => x.id === callId);
  if (!c || c.status !== 'ringing' || w.over) return null;
  c.status = 'answered';
  w.stats.answered++;
  return createIncident(w, c, false);
}

/* ------------------------------------------------------------ dispatch */

const isOpen = (i: Incident) => i.status !== 'RESOLVED' && i.status !== 'FAILED';
const dispatchable = (u: Unit) => u.status === 'AVAILABLE' || u.status === 'RETURNING';

export function dispatch(w: World, incidentId: number, unitIds: string[]): { sent: number; error?: string } {
  const inc = w.incidents.find((i) => i.id === incidentId);
  if (!inc || !isOpen(inc)) return { sent: 0, error: 'Incident is no longer active.' };
  let sent = 0;
  for (const id of unitIds) {
    const u = w.units.find((x) => x.id === id);
    if (!u || !dispatchable(u)) continue;
    const plan = planRoute(w, u, inc.nodeId);
    if (!plan) { log(w, 'warn', `${u.callsign} cannot find a route to ${inc.address}.`); continue; }
    // Does this unit fill a still-open slot? Otherwise it is an unnecessary deployment.
    const before = matchSlots(inc.required, w.units.filter((x) => x.incidentId === inc.id)).filter(Boolean).length;
    const after = matchSlots(inc.required, [...w.units.filter((x) => x.incidentId === inc.id), u]).filter(Boolean).length;
    if (after === before) { w.stats.unnecessary++; inc.surplus++; }
    w.stats.dispatched++;
    w.stats.spent += VEHICLES[u.vehicle].cost;
    u.legs = plan.legs; u.eta = plan.eta; u.incidentId = inc.id; u.status = 'EN ROUTE';
    inc.assigned.push(u.id);
    sent++;
    log(w, 'dispatch', `${u.callsign} dispatched to #${inc.id} ${inc.title}, ETA ${Math.round(plan.eta)}s.`);
    if (!u.legs.length) arrive(w, u);
  }
  if (sent) refreshStatus(w, inc);
  return { sent };
}

function sendHome(w: World, u: Unit) {
  const station = w.city.stations.find((s) => s.id === u.stationId)!;
  u.incidentId = null;
  const plan = planRoute(w, u, station.nodeId);
  if (!plan || (!plan.legs.length && u.node === station.nodeId)) {
    const n = w.city.nodes[station.nodeId];
    u.legs = []; u.x = n.x; u.y = n.y; u.node = n.id; u.status = 'AVAILABLE'; u.eta = 0;
    return;
  }
  u.legs = plan.legs; u.eta = plan.eta; u.status = 'RETURNING';
}

export function recall(w: World, unitId: string) {
  const u = w.units.find((x) => x.id === unitId);
  if (!u || (u.status !== 'EN ROUTE' && u.status !== 'ON SCENE')) return;
  const inc = w.incidents.find((i) => i.id === u.incidentId);
  if (inc) { inc.assigned = inc.assigned.filter((id) => id !== u.id); refreshStatus(w, inc); }
  log(w, 'info', `${u.callsign} recalled to station.`);
  sendHome(w, u);
}

function arrive(w: World, u: Unit) {
  u.legs = []; u.eta = 0;
  if (u.status === 'EN ROUTE') {
    const inc = w.incidents.find((i) => i.id === u.incidentId);
    if (!inc || !isOpen(inc)) { sendHome(w, u); return; }
    u.status = 'ON SCENE';
    if (inc.firstArrival === null) {
      inc.firstArrival = w.time;
      const rt = w.time - inc.callAt;
      w.stats.responseTimes.push(rt);
      if (rt <= 45) w.stats.fastResponses++;
    }
    log(w, 'arrive', `${u.callsign} on scene at #${inc.id} ${inc.address}.`);
    refreshStatus(w, inc);
  } else if (u.status === 'RETURNING') {
    const n = w.city.nodes[w.city.stations.find((s) => s.id === u.stationId)!.nodeId];
    u.x = n.x; u.y = n.y; u.node = n.id; u.status = 'AVAILABLE';
  }
}

function refreshStatus(w: World, inc: Incident) {
  if (!isOpen(inc)) return;
  const mine = w.units.filter((u) => u.incidentId === inc.id);
  const onScene = mine.filter((u) => u.status === 'ON SCENE');
  const covered = matchSlots(inc.required, onScene).every(Boolean);
  if (mine.length === 0) inc.status = 'AWAITING DISPATCH';
  else if (onScene.length && covered) inc.status = 'STABILIZING';
  else if (inc.complication && !covered) inc.status = 'COMPLICATION';
  else if (onScene.length) inc.status = 'ON SCENE';
  else inc.status = 'RESPONDING';
}

/* ----------------------------------------------------------- simulation */

function moveUnit(w: World, u: Unit, dt: number) {
  let remaining = dt;
  while (u.legs.length && remaining > 1e-9) {
    const leg = u.legs[0];
    const tgt = w.city.nodes[leg.to];
    const v = edgeSpeed(w, u, leg.edge);
    const dist = Math.hypot(tgt.x - u.x, tgt.y - u.y);
    if (v * remaining >= dist) {
      u.x = tgt.x; u.y = tgt.y; u.node = leg.to; remaining -= dist / v;
      u.legs.shift();
    } else {
      u.x += ((tgt.x - u.x) / dist) * v * remaining;
      u.y += ((tgt.y - u.y) / dist) * v * remaining;
      remaining = 0;
    }
  }
  if (!u.legs.length && (u.status === 'EN ROUTE' || u.status === 'RETURNING')) arrive(w, u);
  else if (u.legs.length) u.eta = unitEta(w, u);
}

function finishIncident(w: World, inc: Incident, status: 'RESOLVED' | 'FAILED', outcome: string) {
  inc.status = status; inc.outcome = outcome; inc.resolvedAt = w.time;
  for (const u of w.units.filter((x) => x.incidentId === inc.id)) {
    if (status === 'RESOLVED') { u.status = 'BUSY'; u.busyUntil = w.time + BUSY_SECONDS; u.legs = []; u.eta = 0; }
    else sendHome(w, u);
  }
  inc.assigned = [];
  if (status === 'RESOLVED') {
    w.stats.resolved++;
    const tpl = tplOf(inc.templateId);
    const fast = inc.firstArrival !== null && inc.firstArrival - inc.callAt <= 45 ? 1.25 : 1;
    const gain = Math.round(tpl.reward * (0.7 + 0.3 * inc.severity) * fast);
    w.stats.reward += gain;
    log(w, 'good', `#${inc.id} ${inc.title} resolved. ${outcome} (+$${gain})`);
  } else {
    w.stats.failed++;
    log(w, 'bad', `#${inc.id} ${inc.title} FAILED. ${outcome}`);
  }
}

function updateIncident(w: World, inc: Incident, dt: number) {
  const tpl = tplOf(inc.templateId);
  const onScene = w.units.filter((u) => u.incidentId === inc.id && u.status === 'ON SCENE');
  const covered = matchSlots(inc.required, onScene).every(Boolean);
  if (covered) {
    inc.workProgress += dt / inc.duration;
    inc.complication = false;
  } else {
    inc.pressure += dt * (onScene.length ? 0.4 : 1);
  }
  if (inc.escalations < MAX_ESCALATIONS && inc.pressure >= tpl.escalateEvery * (inc.escalations + 1)) {
    inc.escalations++;
    inc.severity = Math.min(4, inc.severity + 1);
    if (tpl.escalateAdd) { inc.required.push(tpl.escalateAdd); inc.complication = true; }
    inc.notes.push(`Update: ${tpl.escalateText}`);
    log(w, 'warn', `#${inc.id} escalated: ${tpl.escalateText}`);
  }
  if (inc.workProgress >= 1) {
    const mins = inc.surplus ? ` (${inc.surplus} unit(s) sent were not needed)` : '';
    finishIncident(w, inc, 'RESOLVED', `Scene cleared${mins}.`);
  } else if (inc.pressure >= inc.failAfter) {
    finishIncident(w, inc, 'FAILED', tpl.failText);
  } else refreshStatus(w, inc);
}

const SUBSTEP = 0.5;
export function step(w: World, dt: number) {
  if (w.over) return;
  let left = dt;
  while (left > 1e-9 && !w.over) {
    const d = Math.min(SUBSTEP, left);
    left -= d;
    w.time += d;
    directorStep(w);
    for (const c of w.calls) {
      if (c.status === 'ringing' && w.time >= c.deadline) {
        c.status = 'missed';
        w.stats.missed++;
        log(w, 'bad', `Call missed. A passerby reports an incident instead.`);
        createIncident(w, c, true);
      }
    }
    for (const u of w.units) {
      if (u.status === 'BUSY' && w.time >= u.busyUntil) sendHome(w, u);
      else if (u.legs.length) moveUnit(w, u, d);
    }
    for (const inc of w.incidents) if (isOpen(inc)) updateIncident(w, inc, d);
    if (w.time >= w.length) w.over = true;
  }
  if (w.calls.length > 60) w.calls = w.calls.filter((c) => c.status === 'ringing').concat(w.calls.slice(-20));
}

/* -------------------------------------------------------------- summary */

export interface Summary {
  answered: number; missed: number; resolved: number; failed: number; unresolved: number;
  avgResponse: number | null; accuracy: number; unnecessary: number; spent: number; reward: number;
  net: number; xp: number; reputation: number; grade: string; significant: string[];
}

export function buildSummary(w: World): Summary {
  const s = w.stats;
  const unresolved = activeIncidents(w).length;
  const total = s.resolved + s.failed + unresolved;
  const avg = s.responseTimes.length ? s.responseTimes.reduce((a, b) => a + b, 0) / s.responseTimes.length : null;
  const accuracy = s.dispatched ? 1 - s.unnecessary / s.dispatched : 1;
  const resolveRate = total ? s.resolved / total : 1;
  const respScore = avg === null ? 0.5 : Math.max(0, Math.min(1, 1 - (avg - 25) / 90));
  const score = 0.45 * resolveRate + 0.3 * respScore + 0.25 * accuracy - 0.03 * s.missed;
  const grade = score >= 0.88 ? 'S' : score >= 0.78 ? 'A' : score >= 0.66 ? 'B' : score >= 0.52 ? 'C' : score >= 0.38 ? 'D' : 'F';
  const base = 2000;
  const net = base + s.reward - s.spent;
  const reputation = s.resolved * 2 - s.failed * 4 - s.missed + (score >= 0.78 ? 3 : 0);
  const significant = w.incidents
    .filter((i) => i.status === 'FAILED' || i.severity >= 3)
    .slice(0, 5)
    .map((i) => `#${i.id} ${i.title} (${i.label}) in ${w.city.districts.find((d) => d.id === i.district)!.name}: ${i.status === 'RESOLVED' ? 'resolved' : i.status === 'FAILED' ? i.outcome : 'unresolved at end of shift'}`);
  return {
    answered: s.answered, missed: s.missed, resolved: s.resolved, failed: s.failed, unresolved,
    avgResponse: avg, accuracy, unnecessary: s.unnecessary, spent: s.spent, reward: s.reward, net,
    xp: 40 + s.resolved * 20 - s.failed * 5, reputation, grade, significant,
  };
}
