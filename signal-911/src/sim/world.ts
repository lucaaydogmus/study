import { createRng, type Rng } from './rng';
import { getCity } from './city';
import { findPath, isConnected } from './pathfinding';
import { COMPLICATION_TEXT, CONTINUE, DECISIONS, DECISION_SECONDS, LINKED, SUPERVISOR, SUPERVISORS_PER_SHIFT, type DecisionOption } from './decisions';
import { VEHICLES, type Leg, type Unit } from './units';
import { BASE_SPEED, CLASS_MULT } from './constants';
import { EQUIPMENT } from './equipment';
import { defaultFleet, totalUpkeep, type FleetUnit } from './fleet';
import { TEMPLATES, type Template } from './incidents';
import { PERSONALITIES, scriptFor, type Personality, type Twist } from './dialogueData';
import { endCall, openSession, tickSession, type Session } from './calls';
import type {
  Capability, City, DistrictId, Difficulty, Edge, IncidentStatus, Weather,
} from './types';

export interface Config { seed: number; shiftMinutes: number; difficulty: Difficulty; weather: Weather }
export interface LogEntry { t: number; text: string; kind: 'info' | 'call' | 'dispatch' | 'arrive' | 'warn' | 'good' | 'bad' }

export interface Spec {
  templateId: string; variationId: string; district: DistrictId; nodeId: number; address: string; opening: string;
  personality: Personality; twist: Twist; perceivedVariationId: string;
  wrongNodeId: number | null; wrongAddress: string | null; discAfter: number | null;
}
export interface Note { text: string; kind: 'confirmed' | 'unconfirmed' | 'warning' | 'info'; t: number }
export interface Turn { who: 'caller' | 'dispatcher' | 'system'; text: string; t: number }
export interface Mod { id: string; label: string; speed: number; risk: number; unitId: string | null }
export interface Believed { caps: Capability[]; severity: number }
export interface Call {
  id: number; ringAt: number; deadline: number; status: 'ringing' | 'answered' | 'missed'; spec: Spec; incidentId?: number;
}
export interface Incident {
  id: number; templateId: string; title: string; label: string; district: DistrictId; nodeId: number;
  x: number; y: number; address: string; severity: number; required: Capability[]; status: IncidentStatus;
  /** Truth is hidden from the player until responders reach the real scene. */
  trueAddress: string; believedNode: number | null; addrConfirmed: boolean; locFixAt: number | null;
  believed: Believed; truthKnown: boolean; transcript: Turn[]; session: Session | null; callEndedAt: number | null;
  /** Scene dynamics: complication risk, decisions taken, a possible road closure, links to other incidents. */
  risk: number; mods: Mod[]; decision: { expiresAt: number } | null; decided: boolean; complications: number;
  blockEdge: number | null; blockActive: boolean; linkedTo: number | null; linkSpawned: boolean; rng: Rng;
  callAt: number; notes: Note[]; assigned: string[]; firstArrival: number | null;
  pressure: number; failAfter: number; workProgress: number; duration: number;
  escalations: number; complication: boolean; resolvedAt: number | null; outcome: string;
  surplus: number;
}
export interface Stats {
  answered: number; missed: number; resolved: number; failed: number; dispatched: number; unnecessary: number;
  responseTimes: number[]; spent: number; reward: number; fastResponses: number; hungUp: number; breakdowns: number;
  decisions: number; complications: number; linked: number; supervisorsLeft: number;
}

export interface World {
  config: Config; rng: Rng; city: City; time: number; length: number; over: boolean;
  units: Unit[]; incidents: Incident[]; calls: Call[]; log: LogEntry[]; stats: Stats;
  nextIncidentId: number; nextCallId: number; nextCallAt: number;
  recentTemplates: string[]; recentOpenings: string[]; finalSpawned: boolean;
  blocked: Set<number>; trafficPhase: Record<DistrictId, number>;
  activeCall: number | null; recentPersonalities: Personality[]; logSeq: number; mrng: Rng;
}

export { BASE_SPEED };
export const CALL_RING_SECONDS = 20;
const BUSY_SECONDS = 4;
const MAX_ESCALATIONS = 2;

const DIFF = {
  easy: { interval: 1.3, fail: 1.25 },
  normal: { interval: 1, fail: 1 },
  hard: { interval: 0.75, fail: 0.85 },
} as const;

export function createWorld(config: Config, fleet: FleetUnit[] = defaultFleet()): World {
  const city = getCity();
  const rng = createRng(config.seed);
  const units: Unit[] = fleet.map((f) => {
    const v = VEHICLES[f.vehicle];
    const station = city.stations.find((s) => s.id === f.stationId)!;
    const node = city.nodes[station.nodeId];
    // A badly worn vehicle starts the shift in the workshop.
    const broken = f.condition <= 10;
    return {
      id: f.id, callsign: f.id, vehicle: f.vehicle, service: v.service, stationId: f.stationId,
      x: node.x, y: node.y, node: node.id, status: broken ? 'OUT OF SERVICE' : 'AVAILABLE', caps: [...v.caps], personnel: v.personnel,
      equipment: [...v.equipment], incidentId: null, legs: [], eta: 0, busyUntil: 0, wrongSite: false,
      upgrades: [...f.upgrades], condition: f.condition, oosUntil: broken ? 45 : 0,
    };
  });
  const phase = {} as Record<DistrictId, number>;
  for (const d of city.districts) phase[d.id] = rng.next() * Math.PI * 2;
  return {
    config, rng, city, time: 0, length: config.shiftMinutes * 60, over: false, units, incidents: [], calls: [],
    log: [{ t: 0, kind: 'info', text: 'Shift briefing complete. Ravenport dispatch is online.' }],
    stats: { answered: 0, missed: 0, resolved: 0, failed: 0, dispatched: 0, unnecessary: 0, responseTimes: [], spent: 0, reward: 0, fastResponses: 0, hungUp: 0, breakdowns: 0, decisions: 0, complications: 0, linked: 0, supervisorsLeft: SUPERVISORS_PER_SHIFT },
    nextIncidentId: 1, nextCallId: 1, nextCallAt: 6 + rng.next() * 6,
    recentTemplates: [], recentOpenings: [], finalSpawned: false, blocked: new Set(), trafficPhase: phase,
    activeCall: null, recentPersonalities: [], logSeq: 0, mrng: createRng(config.seed ^ 0x5bd1e995),
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
  return (BASE_SPEED * VEHICLES[u.vehicle].speed * cls * (w.config.weather === 'rain' ? 0.85 : 1) * (u.upgrades.includes('comms') ? EQUIPMENT.comms.travel! : 1)) / penalty;
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

/** What the dispatcher believes is needed: the truth only once responders have assessed the scene. */
export const shownCaps = (inc: Incident): Capability[] => (inc.truthKnown ? inc.required : inc.believed.caps);
export const shownSeverity = (inc: Incident): number => (inc.truthKnown ? inc.severity : inc.believed.severity);
/** Units that actually stand at the real incident (units at a wrong address do not count). */
export const coverers = (w: World, inc: Incident) => w.units.filter((u) => u.incidentId === inc.id && !u.wrongSite);
const onSceneUnits = (w: World, inc: Incident) => coverers(w, inc).filter((u) => u.status === 'ON SCENE');

export type SlotState = 'met' | 'enroute' | 'open';
export function slotStates(w: World, inc: Incident): SlotState[] {
  const caps = shownCaps(inc);
  const onScene = matchSlots(caps, onSceneUnits(w, inc));
  const all = matchSlots(caps, coverers(w, inc));
  return caps.map((_, i) => (onScene[i] ? 'met' : all[i] ? 'enroute' : 'open'));
}

/* -------------------------------------------------------------- logging */

export function log(w: World, kind: LogEntry['kind'], text: string) {
  w.logSeq++;
  w.log.push({ t: w.time, kind, text });
  if (w.log.length > 200) w.log.splice(0, w.log.length - 200);
}

export function say(w: World, inc: Incident, who: Turn['who'], text: string) { inc.transcript.push({ who, text, t: w.time }); }
export function addNote(w: World, inc: Incident, text: string, kind: Note['kind']) { inc.notes.push({ text, kind, t: w.time }); }

export function setBelieved(w: World, inc: Incident, nodeId: number, address: string) {
  const n = w.city.nodes[nodeId];
  inc.believedNode = nodeId; inc.address = address; inc.x = n.x; inc.y = n.y;
}

/** The real address becomes known: move the marker and send responders to the right place. */
export function correctLocation(w: World, inc: Incident, noteText: string, kind: Note['kind']) {
  if (inc.believedNode === inc.nodeId) return;
  setBelieved(w, inc, inc.nodeId, inc.trueAddress);
  inc.addrConfirmed = true; inc.locFixAt = null;
  addNote(w, inc, noteText, kind);
  for (const u of w.units.filter((x) => x.incidentId === inc.id && (x.status === 'EN ROUTE' || x.status === 'ON SCENE'))) {
    const plan = planRoute(w, u, inc.nodeId);
    if (!plan) continue;
    u.legs = plan.legs; u.eta = plan.eta; u.wrongSite = false; u.status = 'EN ROUTE';
    log(w, 'dispatch', `${u.callsign} redirected to ${inc.trueAddress}.`);
    if (!u.legs.length) arrive(w, u);
  }
}

/** Call ended with no address: the phone system gives an approximate position. */
export function traceLocation(w: World, inc: Incident) {
  const rng = createRng(w.config.seed * 13 + inc.id * 101);
  const t = w.city.nodes[inc.nodeId];
  const near = w.city.nodesByDistrict[inc.district].filter((id) => Math.hypot(w.city.nodes[id].x - t.x, w.city.nodes[id].y - t.y) <= 170);
  const id = rng.pick(near);
  const n = w.city.nodes[id];
  setBelieved(w, inc, id, `near ${n.street}`);
  inc.addrConfirmed = false;
  addNote(w, inc, `No address obtained. Call trace places the caller near ${n.street} (approximate).`, 'unconfirmed');
  if (id !== inc.nodeId) inc.locFixAt = w.time + 60;
  else inc.address = inc.trueAddress;
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
  // Misunderstandings: the caller's first impression can differ from the truth, or the address can be wrong.
  const twistChance = { easy: 0.25, normal: 0.35, hard: 0.45 }[w.config.difficulty];
  const higher = tpl.variations.filter((v) => v.severity > variation.severity);
  const lower = tpl.variations.filter((v) => v.severity < variation.severity);
  let twist: Twist = 'none';
  if (rng.next() < twistChance) {
    const opts: Twist[] = ['wrong_location', 'wrong_location', 'disconnect'];
    if (higher.length) opts.push('milder');
    if (lower.length) opts.push('worse');
    twist = rng.pick(opts);
  }
  const perceived = twist === 'milder' ? rng.pick(higher) : twist === 'worse' ? rng.pick(lower) : variation;
  const fresh = perceived.openings.filter((o) => !w.recentOpenings.includes(o));
  const opening = rng.pick(fresh.length ? fresh : perceived.openings);
  const pw = (Object.keys(PERSONALITIES) as Personality[]).map((k) => PERSONALITIES[k].weight * (w.recentPersonalities[0] === k ? 0.25 : 1));
  const personality = (Object.keys(PERSONALITIES) as Personality[])[weighted(rng, pw)];
  w.recentTemplates = [tpl.id, ...w.recentTemplates].slice(0, 2);
  w.recentOpenings = [opening, ...w.recentOpenings].slice(0, 5);
  w.recentPersonalities = [personality, ...w.recentPersonalities].slice(0, 2);
  const n = city.nodes[nodeId];
  const address = `${rng.int(10, 98) * 10} ${n.street}`;
  let wrongNodeId: number | null = null, wrongAddress: string | null = null;
  if (twist === 'wrong_location') {
    const far = city.nodesByDistrict[district].filter((id) => Math.hypot(city.nodes[id].x - n.x, city.nodes[id].y - n.y) >= 110);
    wrongNodeId = rng.pick(far.length ? far : city.nodesByDistrict[district].filter((id) => id !== nodeId));
    wrongAddress = `${rng.int(10, 98) * 10} ${city.nodes[wrongNodeId].street}`;
  }
  return {
    templateId: tpl.id, variationId: variation.id, district, nodeId, address, opening, personality, twist,
    perceivedVariationId: perceived.id, wrongNodeId, wrongAddress, discAfter: rng.int(2, 3),
  };
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
  w.nextCallAt = w.time + base * phaseFactor(p) * DIFF[w.config.difficulty].interval * (1 + 0.35 * Math.max(0, load - 2)) * (free === 0 ? 1.5 : 1) * Math.sqrt(11 / Math.max(6, w.units.length));
}

function createIncident(w: World, spec: Spec, callAt: number, kind: 'call' | 'late' | 'linked', linkedTo: number | null = null): Incident {
  const tpl = tplOf(spec.templateId);
  const v = tpl.variations.find((x) => x.id === spec.variationId)!;
  const pv = tpl.variations.find((x) => x.id === spec.perceivedVariationId)!;
  const id = w.nextIncidentId++;
  const rng = createRng(w.config.seed * 17 + id * 131);
  const inc: Incident = {
    id, templateId: tpl.id, title: tpl.title, label: v.label, district: spec.district,
    nodeId: spec.nodeId, x: 0, y: 0, address: 'Unknown', trueAddress: spec.address, believedNode: null,
    addrConfirmed: false, locFixAt: null, severity: v.severity, required: [...v.caps], status: 'AWAITING DISPATCH',
    believed: { caps: [...scriptFor(tpl.id, pv.id).hint], severity: pv.severity }, truthKnown: false,
    transcript: [], session: null, callEndedAt: null, callAt, notes: [],
    risk: v.risk, mods: [], decision: null, decided: false, complications: 0,
    blockEdge: null, blockActive: false, linkedTo, linkSpawned: false, rng,
    assigned: [], firstArrival: null, pressure: 0, failAfter: tpl.failAfter * DIFF[w.config.difficulty].fail,
    workProgress: 0, duration: tpl.duration * (0.8 + 0.2 * v.severity), escalations: 0, complication: false,
    resolvedAt: null, outcome: '', surplus: 0,
  };
  if (v.blockRoad && rng.next() < v.blockRoad) inc.blockEdge = pickBlockEdge(w, inc);
  w.incidents.push(inc);
  if (kind !== 'call') {
    setBelieved(w, inc, spec.nodeId, spec.address);
    inc.addrConfirmed = true;
  }
  if (kind === 'late') {
    say(w, inc, 'system', 'The call went unanswered. A passerby reported the incident later.');
    addNote(w, inc, `Reported late by a passerby at ${spec.address}.`, 'info');
    log(w, 'info', `Incident #${inc.id}: ${inc.title} at ${inc.address} (late report).`);
  }
  return inc;
}

/** Choose a road at the incident that can be closed without cutting the city in two. */
function pickBlockEdge(w: World, inc: Incident): number | null {
  const edges = w.city.adj[inc.nodeId].map((a) => a.edge).filter((e) => e.cls !== 'bridge' && !w.blocked.has(e.id));
  while (edges.length) {
    const e = edges.splice(inc.rng.int(0, edges.length - 1), 1)[0];
    if (isConnected(w.city, w.blocked, e.id) && w.city.adj[inc.nodeId].some((a) => a.edge.id !== e.id && !w.blocked.has(a.edge.id))) return e.id;
  }
  return null;
}

/** Re-plan every moving unit so routes respect the current road closures. */
function replanAll(w: World) {
  for (const u of w.units) {
    if ((u.status !== 'EN ROUTE' && u.status !== 'RETURNING') || !u.legs.length) continue;
    const dest = u.legs[u.legs.length - 1].to;
    const plan = planRoute(w, u, dest);
    if (plan) { u.legs = plan.legs; u.eta = plan.eta; }
  }
}

export function activateBlock(w: World, inc: Incident) {
  if (inc.blockEdge === null || inc.blockActive) return;
  inc.blockActive = true;
  w.blocked.add(inc.blockEdge);
  const e = w.city.edges[inc.blockEdge];
  const street = w.city.nodes[e.a].street === w.city.nodes[e.b].street ? w.city.nodes[e.a].street : w.city.nodes[inc.nodeId].street;
  addNote(w, inc, `Road closure: ${street} is blocked. Routes updated.`, 'warning');
  log(w, 'warn', `#${inc.id}: ${street} closed by the incident. Units are being re-routed.`);
  replanAll(w);
}

function liftBlock(w: World, inc: Incident, why: string) {
  if (!inc.blockActive || inc.blockEdge === null) return;
  inc.blockActive = false;
  w.blocked.delete(inc.blockEdge);
  addNote(w, inc, `Road reopened: ${why}.`, 'info');
  log(w, 'info', `#${inc.id}: road reopened (${why}).`);
  replanAll(w);
}

function spawnLinked(w: World, parent: Incident, rule: { templateId: string; variationId: string; text: string }) {
  if (parent.linkSpawned) return;
  parent.linkSpawned = true;
  const near = w.city.adj[parent.nodeId].map((a) => a.to);
  const nodeId = parent.rng.pick(near);
  const n = w.city.nodes[nodeId];
  const spec: Spec = {
    templateId: rule.templateId, variationId: rule.variationId, perceivedVariationId: rule.variationId,
    district: n.district, nodeId, address: `${parent.rng.int(10, 98) * 10} ${n.street}`, opening: '',
    personality: 'calm', twist: 'none', wrongNodeId: null, wrongAddress: null, discAfter: null,
  };
  const inc = createIncident(w, spec, w.time, 'linked', parent.id);
  inc.truthKnown = false;
  addNote(w, inc, `Linked to #${parent.id}: ${rule.text}`, 'warning');
  addNote(w, parent, `Linked incident #${inc.id} opened: ${rule.text}`, 'warning');
  say(w, inc, 'system', rule.text);
  w.stats.linked++;
  log(w, 'warn', `New incident #${inc.id} linked to #${parent.id}: ${rule.text}`);
}

/* ------------------------------------------------------------ decisions */

export function decisionOptions(inc: Incident): DecisionOption[] {
  const dp = DECISIONS[inc.templateId];
  return dp ? [...dp.options, SUPERVISOR, CONTINUE] : [SUPERVISOR, CONTINUE];
}

/** Why an option cannot be chosen right now (null when it can). */
export function optionBlocked(w: World, inc: Incident, o: DecisionOption): string | null {
  if (o.supervisor && w.stats.supervisorsLeft <= 0) return 'No supervisors left this shift';
  if (o.needs && !onSceneUnits(w, inc).some((u) => u.caps.includes(o.needs!))) return `Needs a ${o.needs} unit on scene`;
  if (o.fetch && !nearestFree(w, inc, o.fetch)) return `No free ${o.fetch} unit`;
  return null;
}

function nearestFree(w: World, inc: Incident, cap: Capability): Unit | null {
  if (inc.believedNode === null) return null;
  let best: { u: Unit; eta: number } | null = null;
  for (const u of w.units) {
    if (!dispatchable(u) || !u.caps.includes(cap)) continue;
    const eta = planRoute(w, u, inc.believedNode)?.eta ?? Infinity;
    if (isFinite(eta) && (!best || eta < best.eta)) best = { u, eta };
  }
  return best ? best.u : null;
}

function maybeOffer(w: World, inc: Incident) {
  const dp = DECISIONS[inc.templateId];
  if (!dp || inc.decided || inc.decision) return;
  const variation = tplOf(inc.templateId).variations.find((v) => v.label === inc.label)!;
  const chance = dp.chance[variation.id] ?? 0;
  if (inc.rng.next() >= chance) { inc.decided = true; return; }
  inc.decision = { expiresAt: w.time + DECISION_SECONDS };
  addNote(w, inc, `Decision needed: ${dp.prompt}`, 'warning');
  log(w, 'warn', `#${inc.id}: decision needed on scene.`);
}

export function decide(w: World, incidentId: number, optionId: string): { ok: boolean; error?: string } {
  const inc = w.incidents.find((i) => i.id === incidentId);
  if (!inc || !inc.decision || !isOpen(inc)) return { ok: false, error: 'No decision pending.' };
  const o = decisionOptions(inc).find((x) => x.id === optionId);
  if (!o) return { ok: false, error: 'Unknown option.' };
  const blocked = optionBlocked(w, inc, o);
  if (blocked) return { ok: false, error: blocked };
  inc.decision = null; inc.decided = true;
  w.stats.decisions++;
  w.stats.spent += o.cost ?? 0;
  let unitId: string | null = null;
  if (o.fetch) {
    const u = nearestFree(w, inc, o.fetch)!;
    dispatch(w, inc.id, [u.id], { support: true });
    unitId = u.id;
  }
  if (o.supervisor) {
    w.stats.supervisorsLeft--;
    inc.pressure = Math.max(0, inc.pressure - 20);
  }
  if (o.liftBlock) liftBlock(w, inc, 'traffic diverted');
  if (o.speed || o.risk) inc.mods.push({ id: o.id, label: o.label, speed: o.speed ?? 1, risk: o.risk ?? 0, unitId });
  addNote(w, inc, o.id === 'continue' ? 'Decision: continue with current resources.' : `Decision: ${o.label}.`, 'info');
  log(w, 'dispatch', `#${inc.id}: ${o.label}.`);
  return { ok: true };
}

export const modActive = (w: World, inc: Incident, m: Mod) =>
  m.unitId === null || onSceneUnits(w, inc).some((u) => u.id === m.unitId);
/** Equipment carried by units on scene: each kind counts once, however many units carry it. */
function gear(w: World, inc: Incident): { speed: number; risk: number } {
  const ids = new Set<string>();
  for (const u of onSceneUnits(w, inc)) for (const g of u.upgrades) ids.add(g);
  let speed = 1, risk = 0;
  for (const id of ids) {
    const e = EQUIPMENT[id];
    if (!e || (e.templates && !e.templates.includes(inc.templateId))) continue;
    speed *= e.speed ?? 1; risk += e.risk ?? 0;
  }
  return { speed, risk };
}
const workRate = (w: World, inc: Incident) => inc.mods.reduce((r, m) => (modActive(w, inc, m) ? r * m.speed : r), gear(w, inc).speed);
export const currentRisk = (w: World, inc: Incident) =>
  Math.max(0, inc.mods.reduce((r, m) => (modActive(w, inc, m) ? r + m.risk : r), inc.risk + gear(w, inc).risk));

export function answerCall(w: World, callId: number): Incident | null {
  const c = w.calls.find((x) => x.id === callId);
  if (!c || c.status !== 'ringing' || w.over || w.activeCall !== null) return null;
  c.status = 'answered';
  w.stats.answered++;
  const inc = createIncident(w, c.spec, c.ringAt, 'call');
  c.incidentId = inc.id;
  openSession(w, inc, c.spec);
  return inc;
}

/* ------------------------------------------------------------ dispatch */

const isOpen = (i: Incident) => i.status !== 'RESOLVED' && i.status !== 'FAILED';
const dispatchable = (u: Unit) => u.status === 'AVAILABLE' || u.status === 'RETURNING';

export function dispatch(w: World, incidentId: number, unitIds: string[], opts: { support?: boolean } = {}): { sent: number; error?: string } {
  const inc = w.incidents.find((i) => i.id === incidentId);
  if (!inc || !isOpen(inc)) return { sent: 0, error: 'Incident is no longer active.' };
  if (inc.believedNode === null) return { sent: 0, error: 'Location unknown. Ask the caller for the address.' };
  let sent = 0;
  for (const id of unitIds) {
    const u = w.units.find((x) => x.id === id);
    if (!u || !dispatchable(u)) continue;
    const plan = planRoute(w, u, inc.believedNode);
    if (!plan) { log(w, 'warn', `${u.callsign} cannot find a route to ${inc.address}.`); continue; }
    // Does this unit fill a still-open slot? Otherwise it is an unnecessary deployment.
    const before = matchSlots(inc.required, coverers(w, inc)).filter(Boolean).length;
    const after = matchSlots(inc.required, [...coverers(w, inc), u]).filter(Boolean).length;
    if (after === before && !opts.support) { w.stats.unnecessary++; inc.surplus++; }
    w.stats.dispatched++;
    w.stats.spent += VEHICLES[u.vehicle].cost;
    u.condition = Math.max(0, u.condition - 6); // every trip wears the vehicle
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
  u.incidentId = null; u.wrongSite = false;
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
    if (inc.believedNode !== inc.nodeId) {
      // The caller gave the wrong address: nothing here. A call-back will correct it shortly.
      u.wrongSite = true;
      inc.locFixAt = Math.min(inc.locFixAt ?? Infinity, w.time + 20);
      addNote(w, inc, `${u.callsign} found nothing at ${inc.address}. The address may be wrong.`, 'warning');
      log(w, 'warn', `${u.callsign} at ${inc.address}: no sign of an incident. Address may be wrong.`);
      return;
    }
    if (!inc.truthKnown) assess(w, inc);
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

/** First responders reach the real scene and report what is actually going on. */
function assess(w: World, inc: Incident) {
  inc.truthKnown = true;
  const diff = (a: Capability[], b: Capability[]) => b.filter((c) => a.filter((x) => x === c).length < b.filter((x) => x === c).length);
  const extra = diff(inc.believed.caps, inc.required), fewer = diff(inc.required, inc.believed.caps);
  inc.believed = { caps: [...inc.required], severity: inc.severity };
  const kind = extra.length ? 'warning' : 'confirmed';
  addNote(w, inc, `On-scene assessment: ${inc.label}.${extra.length ? ` Additional capability needed: ${extra.join(', ')}.` : ''}${fewer.length ? ' Less serious than reported.' : ''}`, kind);
  if (extra.length) log(w, 'warn', `#${inc.id}: responders report the scene needs more than first reported.`);
  activateBlock(w, inc);
  maybeOffer(w, inc);
}

function refreshStatus(w: World, inc: Incident) {
  if (!isOpen(inc)) return;
  const mine = w.units.filter((u) => u.incidentId === inc.id);
  const onScene = onSceneUnits(w, inc);
  const covered = matchSlots(inc.required, onScene).every(Boolean);
  if (mine.length === 0) inc.status = 'AWAITING DISPATCH';
  else if (onScene.length && covered) inc.status = 'STABILIZING';
  else if (inc.complication && !covered) inc.status = 'COMPLICATION';
  else if (onScene.length) inc.status = 'ON SCENE';
  else inc.status = 'RESPONDING';
}

/* ----------------------------------------------------------- simulation */

/** A worn vehicle on an emergency run may break down and be out of service for a while. */
function breakdown(w: World, u: Unit) {
  const inc = w.incidents.find((i) => i.id === u.incidentId);
  if (inc) { inc.assigned = inc.assigned.filter((id) => id !== u.id); }
  u.incidentId = null; u.legs = []; u.eta = 0; u.wrongSite = false;
  u.status = 'OUT OF SERVICE'; u.oosUntil = w.time + 45;
  w.stats.breakdowns++;
  log(w, 'bad', `${u.callsign} broke down on the way${inc ? ` to #${inc.id}` : ''}! Out of service for repairs.`);
  if (inc) { addNote(w, inc, `${u.callsign} broke down en route and is out of service.`, 'warning'); refreshStatus(w, inc); }
}

function moveUnit(w: World, u: Unit, dt: number) {
  if (u.status === 'EN ROUTE' && u.condition < 70 && w.mrng.next() < ((100 - u.condition) / 100) ** 2 * 0.004 * dt) { breakdown(w, u); return; }
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
  if (inc.session) endCall(w, inc, 'system');
  inc.decision = null;
  if (inc.blockActive) liftBlock(w, inc, status === 'RESOLVED' ? 'scene cleared' : 'incident closed');
  for (const u of w.units.filter((x) => x.incidentId === inc.id)) {
    if (status === 'RESOLVED') { u.status = 'BUSY'; u.busyUntil = w.time + BUSY_SECONDS; u.legs = []; u.eta = 0; }
    else sendHome(w, u);
  }
  inc.assigned = [];
  if (status === 'RESOLVED') {
    w.stats.resolved++;
    const tpl = tplOf(inc.templateId);
    const fast = inc.firstArrival !== null && inc.firstArrival - inc.callAt <= 45 ? 1.25 : 1;
    const clean = Math.max(0.4, 1 - 0.15 * inc.complications);
    const gain = Math.round(tpl.reward * (0.7 + 0.3 * inc.severity) * fast * clean);
    w.stats.reward += gain;
    log(w, 'good', `#${inc.id} ${inc.title} resolved. ${outcome} (+$${gain})`);
  } else {
    w.stats.failed++;
    log(w, 'bad', `#${inc.id} ${inc.title} FAILED. ${outcome}`);
  }
}

function updateIncident(w: World, inc: Incident, dt: number) {
  const tpl = tplOf(inc.templateId);
  const onScene = onSceneUnits(w, inc);
  const covered = matchSlots(inc.required, onScene).every(Boolean);

  // An undecided decision lapses into "continue with current resources".
  if (inc.decision && w.time >= inc.decision.expiresAt) {
    inc.decision = null; inc.decided = true;
    addNote(w, inc, 'No decision made: continuing with current resources.', 'info');
  }
  // Traffic units on scene direct vehicles and reopen the road.
  if (inc.blockActive && onScene.some((u) => u.caps.includes('TRAFFIC'))) liftBlock(w, inc, 'traffic unit directing vehicles');

  if (covered) {
    inc.workProgress += (dt / inc.duration) * workRate(w, inc);
    inc.complication = false;
  } else {
    inc.pressure += dt * (onScene.length ? 0.4 : 1);
  }

  // Neglect escalation: depends on how long needed capabilities were missing.
  if (inc.escalations < MAX_ESCALATIONS && inc.pressure >= tpl.escalateEvery * (inc.escalations + 1)) {
    inc.escalations++;
    raise(w, inc, tpl.escalateAdd, `Update: ${tpl.escalateText}`);
    log(w, 'warn', `#${inc.id} escalated: ${tpl.escalateText}`);
    const link = LINKED[inc.templateId];
    if (link?.on === 'escalation2' && inc.escalations >= 2) spawnLinked(w, inc, link);
  }
  // Scene complication: depends on the scene's risk, which decisions change.
  if (onScene.length && inc.complications < 2 && inc.rng.next() < currentRisk(w, inc) * 0.008 * dt) {
    inc.complications++; w.stats.complications++;
    const text = COMPLICATION_TEXT[inc.templateId] ?? 'The situation changes on scene.';
    raise(w, inc, tpl.escalateAdd, `Complication: ${text}`);
    log(w, 'warn', `#${inc.id} complication: ${text}`);
    const link = LINKED[inc.templateId];
    if (link?.on === 'complication1') spawnLinked(w, inc, link);
  }

  if (inc.workProgress >= 1) {
    const mins = inc.surplus ? ` ${inc.surplus} unit(s) sent were not needed.` : '';
    const comp = inc.complications ? ` Resolved despite ${inc.complications} complication(s).` : '';
    finishIncident(w, inc, 'RESOLVED', `Scene cleared.${comp}${mins}`);
  } else if (inc.pressure >= inc.failAfter) {
    finishIncident(w, inc, 'FAILED', tpl.failText);
  } else refreshStatus(w, inc);
}

function raise(w: World, inc: Incident, add: Capability | null, note: string) {
  inc.severity = Math.min(4, inc.severity + 1);
  if (add) { inc.required.push(add); inc.believed.caps.push(add); inc.complication = true; }
  inc.believed.severity = Math.max(inc.believed.severity, inc.severity);
  addNote(w, inc, note, 'warning');
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
        c.incidentId = createIncident(w, c.spec, c.ringAt, 'late').id;
      }
    }
    for (const u of w.units) {
      if (u.status === 'OUT OF SERVICE') {
        if (w.time >= u.oosUntil) { u.condition = Math.max(u.condition, 40); sendHome(w, u); log(w, 'info', `${u.callsign} is back in service.`); }
      } else if (u.status === 'BUSY' && w.time >= u.busyUntil) sendHome(w, u);
      else if (u.legs.length) moveUnit(w, u, d);
    }
    for (const inc of w.incidents) {
      if (!isOpen(inc)) continue;
      tickSession(w, inc);
      if (inc.locFixAt !== null && w.time >= inc.locFixAt && inc.believedNode !== inc.nodeId) {
        log(w, 'info', `#${inc.id}: the caller called back with the correct address.`);
        correctLocation(w, inc, `Caller called back: the real address is ${inc.trueAddress}.`, 'confirmed');
      }
      updateIncident(w, inc, d);
    }
    if (w.time >= w.length) w.over = true;
  }
  if (w.calls.length > 60) w.calls = w.calls.filter((c) => c.status === 'ringing').concat(w.calls.slice(-20));
}

/* -------------------------------------------------------------- summary */

export interface Summary {
  answered: number; missed: number; hungUp: number; resolved: number; failed: number; unresolved: number;
  avgResponse: number | null; upkeep: number; breakdowns: number; accuracy: number; unnecessary: number; decisions: number; complications: number; linked: number; spent: number; reward: number;
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
  const upkeep = totalUpkeep(fleetAfterShift(w));
  const net = base + s.reward - s.spent - upkeep;
  const reputation = s.resolved * 2 - s.failed * 4 - s.missed + (score >= 0.78 ? 3 : 0);
  const significant = w.incidents
    .filter((i) => i.status === 'FAILED' || i.severity >= 3)
    .slice(0, 5)
    .map((i) => `#${i.id} ${i.title} (${i.label}) in ${w.city.districts.find((d) => d.id === i.district)!.name}: ${i.status === 'RESOLVED' ? 'resolved' : i.status === 'FAILED' ? i.outcome : 'unresolved at end of shift'}`);
  return {
    answered: s.answered, missed: s.missed, hungUp: s.hungUp, resolved: s.resolved, failed: s.failed, unresolved,
    avgResponse: avg, accuracy, unnecessary: s.unnecessary, decisions: s.decisions, complications: s.complications, linked: s.linked, spent: s.spent, upkeep, breakdowns: s.breakdowns, reward: s.reward, net,
    xp: 40 + s.resolved * 20 - s.failed * 5, reputation, grade, significant,
  };
}

/** The fleet as it should be saved after the shift: same units, with their new condition. */
export function fleetAfterShift(w: World): FleetUnit[] {
  return w.units.map((u) => ({ id: u.id, vehicle: u.vehicle, stationId: u.stationId, upgrades: [...u.upgrades], condition: Math.round(u.condition) }));
}
