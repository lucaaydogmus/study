// More of the city and the room around you: a colleague who picks up overflow calls (and is not always
// right), air ambulances that need a landing zone, chemical plumes that drift with the wind, districts
// that remember how you treated them, handovers between shifts, planned events you prepare for,
// lightning, and a news helicopter that gets in the way.
import type { GameEngine } from './engine';
import { RESOURCE_BY_ID, recommendFor } from './engine';
import { addressOf } from './city';
import { isAir } from './fleet';
import { TEMPLATE_BY_ID } from './content/templates';
import type { Call, GameState, Incident, Unit } from './types';

const h01 = (a: number, b: number) => { let h = Math.imul(a + 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const live = (inc: Incident) => !['RESOLVED', 'CLOSED'].includes(inc.status);

// ── The colleague at the next desk ──────────────────────────────────────────
const COLLEAGUES = ['Priya Shah', 'Marcus Webb', 'Joanne Ellery', 'Tomás Rivera'];
export function colleagueOf(st: GameState) {
  if (!st.colleague) { const k = st.seed % COLLEAGUES.length; st.colleague = { name: COLLEAGUES[k], skill: 0.62 + h01(st.seed % 997, 5) * 0.3, callId: null, doneAt: 0, handled: 0, mistakes: 0 }; }
  return st.colleague;
}
/** when the board is busy, your colleague picks up a ringing call and works it themselves */
export function colleagueTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script || st.rank < 1) return;
  const c = colleagueOf(st);
  if (c.callId) {
    const call = st.calls[c.callId];
    if (!call || call.state !== 'hold' || !call.colleague) { c.callId = null; return; }
    if (st.time >= c.doneAt) finishColleague(e, call);
    return;
  }
  const ringing = Object.values(st.calls).filter((x) => x.state === 'ringing' && !x.isCallback).sort((a, b) => a.ringStart - b.ringStart);
  const busy = ringing.length >= 2 || (!!st.activeCallId && ringing.length >= 1);
  const oldest = ringing[0];
  if (!busy || !oldest || st.time - oldest.ringStart < 7) return;
  // they answer it and keep it on their desk; it shows as theirs until they are done or you take it
  const inc = st.incidents[oldest.incidentId];
  oldest.state = 'hold'; oldest.holdSince = null; oldest.answeredAt = st.time; oldest.colleague = { name: c.name, since: st.time };
  inc.answeredAt = inc.answeredAt ?? st.time;
  st.stats.callsAnswered++; st.stats.answerTimes.push(st.time - oldest.ringStart);
  c.callId = oldest.id; c.doneAt = st.time + 22 + (1 - c.skill) * 40 + h01(inc.num, 31) * 10;
  e.addTranscript(oldest, 'SYSTEM', `${c.name} (dispatcher, desk 2) picked up this call.`);
  e.notify(`${c.name} picked up a call you could not get to — take it over from the call list if you want it`, 'info', inc.id);
}
function finishColleague(e: GameEngine, call: Call) {
  const st = e.state, c = colleagueOf(st);
  const inc = st.incidents[call.incidentId];
  c.callId = null; call.colleague = undefined;
  const tpl = TEMPLATE_BY_ID[inc.templateId];
  const good = (salt: number) => h01(inc.num, salt) < c.skill;
  c.handled++;
  if (tpl?.nonEmergency || (inc.requires.length === 0 && inc.truth.false_alarm === true)) {
    e.addTranscript(call, 'SYSTEM', `${c.name} sent the caller to the non-emergency line.`);
    e.endCall(call.id, 'transferred');
    inc.dismissed = true; e.closeIncident(inc, 'false_alarm', true);
    return;
  }
  // location: usually right, sometimes a street out
  let node = inc.nodeId;
  if (!good(32)) { const nb = e.city.adj[node].map((x) => { const ed = e.city.edges[x]; return ed.a === node ? ed.b : ed.a; }); node = nb[Math.floor(h01(inc.num, 33) * nb.length)] ?? node; c.mistakes++; }
  e.setIncidentLocation(inc.id, node, 'candidate');
  if (good(34) && tpl) e.setClassification(inc.id, tpl.cls);
  // units: what the plan says — though sometimes one short
  const rec = recommendFor(inc, st.rank);
  const sent: string[] = [];
  rec.forEach((r, i) => {
    const n = !good(35 + i) && r.n > 1 ? r.n - 1 : r.n;
    for (let k = inc.assignedUnits.filter((id) => st.units[id]?.capabilities.includes(r.cap)).length; k < n; k++) {
      const u = Object.values(st.units).filter((x) => x.status === 'AVAILABLE' && !isAir(x) && x.capabilities.includes(r.cap) && !inc.assignedUnits.includes(x.id)).sort((a, b) => (e.estimate(a.id, node)?.eta ?? 1e9) - (e.estimate(b.id, node)?.eta ?? 1e9))[0];
      if (u && e.dispatch(u.id, inc.id).ok) sent.push(u.callsign);
    }
  });
  e.addTranscript(call, 'SYSTEM', `${c.name} confirmed ${addressOf(e.city, node)} and sent ${sent.length ? sent.join(', ') : 'nobody yet'}.`);
  e.endCall(call.id, 'transferred');
  st.stats.colleagueCalls = (st.stats.colleagueCalls ?? 0) + 1;
  e.notify(`${c.name} handled INC-${String(inc.num).padStart(4, '0')} ${inc.label}: ${addressOf(e.city, node)}, ${sent.length ? sent.join(', ') : 'no units sent'} — check it`, node === inc.nodeId ? 'info' : 'warn', inc.id);
}
/** take a call back from your colleague (it becomes your active call) */
export function takeOver(e: GameEngine, callId: string): { ok: boolean; reason?: string } {
  const st = e.state, call = st.calls[callId], c = colleagueOf(st);
  if (!call?.colleague) return { ok: false, reason: 'Not your colleague’s call' };
  call.colleague = undefined; c.callId = null;
  e.addTranscript(call, 'SYSTEM', `${c.name} passed the call back to you.`);
  call.state = 'hold'; call.holdSince = st.time;
  e.answerCall(callId);
  return { ok: true };
}

// ── Air ambulance landing zones ─────────────────────────────────────────────
const LZ_KINDS = new Set(['park', 'school', 'stadium', 'mall', 'university']);
/** where an air ambulance could put down near a scene */
export function landingZones(e: GameEngine, inc: Incident): Array<{ id: string; label: string; node: number; dist: number }> {
  const n = e.city.nodes[inc.reportedNode ?? inc.nodeId];
  const out = e.city.landmarks.filter((l) => LZ_KINDS.has(l.kind)).map((l) => ({ id: `lz${l.nodeId}`, label: l.name, node: l.nodeId, dist: Math.hypot(e.city.nodes[l.nodeId].x - n.x, e.city.nodes[l.nodeId].y - n.y) }))
    .filter((z) => z.dist < 420).sort((a, b) => a.dist - b.dist).slice(0, 2);
  return [...out, { id: 'lzroad', label: 'The road at the scene', node: inc.reportedNode ?? inc.nodeId, dist: 0 }];
}
/** asked when the air ambulance is requested: crews want to know where it is landing */
export function askLandingZone(e: GameEngine, inc: Incident) {
  const st = e.state;
  const u = e.onScene(inc).find((x) => !isAir(x)) ?? inc.assignedUnits.map((id) => st.units[id]).find(Boolean);
  const zones = landingZones(e, inc);
  (st.decisions ??= []).push({
    id: `d${st.decisions.length + 1}-lz${Math.floor(st.time)}`, incId: inc.id, unitId: u?.id ?? '', at: st.time, expiresAt: st.time + 30, kind: 'lz',
    prompt: `${u?.spoken ?? 'Air Med'}: air ambulance is inbound — where do you want it to land?`,
    options: zones.map((z) => ({ id: z.id, label: z.id === 'lzroad' ? 'Land on the road at the scene' : `Land at ${z.label}`, hint: z.id === 'lzroad' ? 'Closest — police must close the road first' : `${Math.round(z.dist * 4)} m away — needs securing` })),
    defaultId: zones[0].id,
  });
  if (u) e.radio(u.spoken, `Dispatch, ${u.spoken}. Air ambulance is on its way — where's it landing? ${zones.filter((z) => z.id !== 'lzroad').map((z) => z.label).join(' or ')}, or the road here?`, 'unit', u.id, inc.id);
}
export function decideLandingZone(e: GameEngine, d: import('./types').Decision, optionId: string): { ok: boolean; outcome?: string } {
  const st = e.state, inc = st.incidents[d.incId];
  if (!inc?.resources?.air_ambulance) { d.outcome = 'The air ambulance was stood down.'; return { ok: true, outcome: d.outcome }; }
  const z = landingZones(e, inc).find((x) => x.id === optionId) ?? landingZones(e, inc)[0];
  const police = inc.assignedUnits.some((id) => st.units[id]?.service === 'police');
  const secure = police ? 0 : 45;
  const flight = 70 + h01(inc.num, 61) * 40;
  const carry = z.id === 'lzroad' ? (police ? 0 : 60) : z.dist / 6;
  inc.resources.air_ambulance.arriveAt = st.time + flight + secure + carry;
  inc.lz = z.label;
  d.outcome = `Air ambulance landing ${z.id === 'lzroad' ? 'on the road at the scene' : `at ${z.label}`}${police ? '' : ' — no police on scene to secure it, so it circles first'}.`;
  e.radio('Air Med 1', `Air Med 1 copies, landing zone ${z.id === 'lzroad' ? 'the road at the scene' : z.label}. About ${Math.round((flight + secure + carry) / 60)} minutes.`, 'chatter', undefined, inc.id);
  return { ok: true, outcome: d.outcome };
}

// ── Wind and chemical plumes ────────────────────────────────────────────────
const PLUME = new Set(['hazmat_spill', 'tanker_fire', 'industrial_accident', 'warehouse_smoke', 'train_derailment', 'gas_leak']);
export function windTick(e: GameEngine) {
  const st = e.state;
  st.wind ??= { dir: h01(st.seed % 991, 1) * Math.PI * 2, speed: 6 + h01(st.seed % 991, 2) * 14, nextShift: 140 };
  if (st.time >= st.wind.nextShift) {
    st.wind.nextShift = st.time + 110 + h01(Math.floor(st.time), 3) * 120;
    const turn = (h01(Math.floor(st.time), 4) - 0.5) * 1.6;
    st.wind.dir += turn; st.wind.speed = Math.max(3, Math.min(28, st.wind.speed + (h01(Math.floor(st.time), 5) - 0.5) * 8));
    if (Math.abs(turn) > 0.45 && Object.values(st.incidents).some((i) => i.plume && live(i))) e.radio('Weather Service', `Wind shifting — now from the ${compass(st.wind.dir + Math.PI)} at ${Math.round(st.wind.speed)} mph.`, 'chatter');
  }
  for (const inc of Object.values(st.incidents)) {
    if (!PLUME.has(inc.templateId) || !live(inc) || inc.hidden) { if (inc.plume) inc.plume = null; continue; }
    const len = 90 + inc.threat * 1.6 + st.wind.speed * 3;
    const n = e.city.nodes[inc.nodeId];
    const ex = n.x + Math.cos(st.wind.dir) * len, ey = n.y + Math.sin(st.wind.dir) * len;
    const down = e.city.nodes[e.city.nearestNode(ex, ey)].district;
    const prev = inc.plume?.district;
    inc.plume = { dir: st.wind.dir, len, district: down };
    if (down !== inc.district && down !== prev && st.config.districts.includes(down)) e.notify(`The plume from ${inc.label} is drifting over ${e.city.districtById[down]?.name ?? down} — tell them to shelter`, 'warn', inc.id);
    // people downwind breathe it in if nobody told them to stay indoors
    const bucket = Math.floor(st.time / 50);
    if (down !== inc.district && st.config.districts.includes(down) && inc.plumeAlerted !== down && inc.threat > 35 && inc.plumeBucket !== bucket && st.time - inc.createdAt > 60) {
      inc.plumeBucket = bucket;
      if (h01(inc.num, bucket) > 0.18) continue;
      inc.casualties++; st.stats.casualties++;
      e.consequence(inc, `Residents in ${e.city.districtById[down]?.name ?? down} were caught in the plume — nobody told them to shelter`);
    }
  }
}
export function shelterDownwind(e: GameEngine, incId: string): { ok: boolean; reason?: string } {
  const st = e.state, inc = st.incidents[incId];
  if (!inc?.plume) return { ok: false, reason: 'No plume' };
  if (inc.plumeAlerted === inc.plume.district) return { ok: false, reason: 'They have already been told' };
  inc.plumeAlerted = inc.plume.district;
  e.radio('DISPATCH', `Shelter-in-place alert issued for ${e.city.districtById[inc.plume.district]?.name ?? inc.plume.district}: stay indoors, close windows, turn off ventilation.`, 'alert', undefined, inc.id);
  st.stats.plumeAlerts = (st.stats.plumeAlerts ?? 0) + 1;
  return { ok: true };
}
export const compass = (a: number) => ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];

// ── Community trust ─────────────────────────────────────────────────────────
export const trustOf = (st: GameState, district: string) => st.trust?.[district] ?? 60;
/** how the district's callers feel about you after this one */
export function trustAfter(st: GameState, inc: Incident, outcome: string) {
  if (inc.hidden || inc.onView) return;
  const t = (st.trust ??= {});
  const rt = inc.firstArrivalAt !== null ? inc.firstArrivalAt - (inc.answeredAt ?? inc.createdAt) : null;
  let d = 0;
  if (outcome === 'success') d += rt !== null && rt < 150 ? 1.2 : rt !== null && rt > 300 ? -1.5 : 0.3;
  if (outcome === 'failed' || outcome === 'mishandled' || outcome === 'lost') d -= 3;
  if (inc.casualties) d -= Math.min(4, inc.casualties);
  t[inc.district] = Math.max(5, Math.min(95, trustOf(st, inc.district) + d));
}
/** low trust: callers start angrier and less willing */
export function applyTrust(st: GameState, district: string, mood: { frustration: number; cooperation: number; trust: number }) {
  const t = trustOf(st, district);
  if (t < 40) { mood.frustration = Math.min(100, mood.frustration + (40 - t) * 0.6); mood.cooperation = Math.max(5, mood.cooperation - (40 - t) * 0.35); mood.trust = Math.max(5, mood.trust - (40 - t)); }
  else if (t > 75) { mood.cooperation = Math.min(100, mood.cooperation + 5); mood.trust = Math.min(100, mood.trust + 8); }
}

// ── Handover between shifts ─────────────────────────────────────────────────
export interface Handover { from: number; notes: string[]; carry: Array<{ template: string; district: string; node: number; label: string }> }
/** what the outgoing dispatcher leaves for the next shift */
export function writeHandover(st: GameState, shift: number): Handover {
  const open = Object.values(st.incidents).filter((i) => live(i) && !i.hidden && i.requires.length && !i.pursuit && !i.mover && !TEMPLATE_BY_ID[i.templateId]?.major).sort((a, b) => b.severity - a.severity);
  const notes = open.slice(0, 4).map((i) => `${i.label} at ${i.reportedNode !== null ? 'a known address' : 'an unconfirmed location'} in ${i.district} — ${i.assignedUnits.length ? 'crews still working' : 'nobody sent yet'}${i.notes ? ` (“${i.notes.split('\n')[0].slice(0, 60)}”)` : ''}`);
  return { from: shift, notes, carry: open.filter((i) => !i.assignedUnits.length).slice(0, 2).map((i) => ({ template: i.templateId, district: i.district, node: i.nodeId, label: i.label })) };
}
/** the incoming shift picks up what was left: the callers ring back */
export function handoverTick(e: GameEngine) {
  const st = e.state, h = st.config.handover;
  if (!h || st.handoverDone || st.time < 25 || st.config.mode !== 'career') return;
  st.handoverDone = true;
  for (const c of h.carry) {
    if (!TEMPLATE_BY_ID[c.template] || !st.config.districts.includes(c.district)) continue;
    const inc = e.spawnIncident(c.template, c.district, { nodeId: c.node, accuracy: 'exact' });
    inc.openOverride = [`I rang before your shift change about the ${c.label.toLowerCase()} — nobody ever came! It's still happening!`];
    inc.threat = Math.max(inc.threat, 55);
    inc.carried = true;
  }
  if (h.carry.length) e.notify('Callers from the last shift are ringing back — the previous dispatcher left them unsent', 'warn');
}

// ── Planned events: get crews in place before it starts ────────────────────
export function plannedEventDirective(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script || st.prepostSet) return;
  const ev = st.config.events.find((x) => ['marathon', 'festival', 'protest', 'halloween'].includes(x.type) && x.at > 70);
  if (!ev) { st.prepostSet = true; return; }
  st.prepostSet = true;
  const district = ev.districts?.[0] ?? (st.config.districts.includes('downtown') ? 'downtown' : st.config.districts[0]);
  const name = e.city.districtById[district]?.name ?? district;
  (st.directives ??= []).push({ id: `dir-pre`, kind: 'prepost' as never, text: `The ${ev.type.replace('_', ' ')} starts in ${Math.max(1, Math.round((ev.at - st.time) / 60))} min. Have an ambulance and a patrol car posted in ${name} when it begins.`, from: st.time, until: ev.at, target: 2, progress: 0, district });
  e.radio('Supervisor Okafor', `Dispatch, Okafor. Event planning: get an ambulance and a patrol posted in ${name} before the ${ev.type.replace('_', ' ')} kicks off.`, 'chatter');
}
/** checked by the directive system when a pre-post directive comes due */
export function prepostMet(e: GameEngine, district: string): boolean {
  const st = e.state;
  const inD = (u: Unit) => e.city.nodes[u.postNode]?.district === district || e.city.nodes[u.prevNode]?.district === district;
  const avail = Object.values(st.units).filter((u) => u.status === 'AVAILABLE' && !isAir(u) && inD(u));
  return avail.some((u) => u.capabilities.includes('transport')) && avail.some((u) => u.capabilities.includes('patrol'));
}

// ── Lightning ───────────────────────────────────────────────────────────────
export function lightningTick(e: GameEngine) {
  const st = e.state;
  for (const c of st.storms ?? []) {
    if (h01(c.id, Math.floor(st.time / 9)) > 0.05 * c.power || st.time - (st.lastStrike ?? -99) < 9) continue;
    st.lastStrike = st.time; st.strikeAt = { x: c.x + (h01(c.id, Math.floor(st.time)) - 0.5) * c.r, y: c.y + (h01(c.id + 1, Math.floor(st.time)) - 0.5) * c.r, t: st.time };
    const n = e.city.nearestNode(st.strikeAt.x, st.strikeAt.y);
    const d = e.city.nodes[n].district;
    if (st.config.districts.includes(d) && h01(c.id, Math.floor(st.time) + 7) < 0.3 && st.time < st.config.durationSec - 60 && (c.spawned ?? 0) < 3) {
      c.spawned = (c.spawned ?? 0) + 1;
      e.spawnIncident(e.city.districtById[d]?.tags.includes('suburb') || e.city.districtById[d]?.tags.includes('river') ? 'brush_fire' : 'electrical_fire', d, { nodeId: n });
      e.radio('Weather Service', `Lightning strike reported near ${addressOf(e.city, n)}.`, 'chatter');
    }
  }
}

// ── The news helicopter ─────────────────────────────────────────────────────
export function newsHeliTick(e: GameEngine) {
  const st = e.state;
  const h = st.newsHeli;
  if (h) {
    const inc = st.incidents[h.incId];
    if (!inc || !live(inc) || st.time > h.until) { st.newsHeli = null; return; }
    const n = e.city.nodes[inc.reportedNode ?? inc.nodeId];
    const r = h.tfr ? 260 : 70, a = st.time / (h.tfr ? 18 : 9);
    h.x = n.x + Math.cos(a) * r; h.y = n.y + Math.sin(a) * r;
    // Air One complains if it is working the same patch of sky
    const air = Object.values(st.units).find((u) => isAir(u) && u.assignedIncidentId === inc.id && u.status === 'ON_SCENE');
    if (air && !h.tfr && !h.asked) { h.asked = true; (inc.resAsked ??= {}).tfr = st.time; e.radio(air.spoken, `Dispatch, ${air.spoken}. There's a news helicopter in our airspace. Get the FAA to put a temporary flight restriction on this.`, 'unit', air.id, inc.id); }
    if (inc.resources?.tfr?.here && !h.tfr) { h.tfr = true; e.radio('Channel 7 SkyCam', 'SkyCam copies the TFR, moving off to two miles.', 'chatter'); }
    return;
  }
  if (st.config.mode === 'tutorial' || st.config.script) return;
  const big = Object.values(st.incidents).find((i) => live(i) && !i.hidden && (TEMPLATE_BY_ID[i.templateId]?.major || i.severity >= 5) && st.time - i.createdAt > 90 && !i.newsDone);
  if (!big) return;
  big.newsDone = true;
  st.newsHeli = { incId: big.id, x: 0, y: 0, until: st.time + 600, tfr: false, asked: false };
  e.headline(`LIVE: Channel 7 SkyCam over ${big.label.toLowerCase()} in ${e.city.districtById[big.district]?.name ?? big.district}`, 'info');
}
/** a news helicopter circling low makes your own air unit less useful */
export const airCrowded = (st: GameState, incId: string) => !!st.newsHeli && st.newsHeli.incId === incId && !st.newsHeli.tfr;
export { RESOURCE_BY_ID };
