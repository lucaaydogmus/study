// Callers who are not simple. Regulars you get to know over a career (and who are, now and then, telling
// the truth); people calling for someone else who cannot see the patient; and drivers on the move whose
// position you have to keep up with landmark by landmark.
import type { GameEngine } from './engine';
import { addressOf } from './city';
import { fill } from './dialogue';
import type { Intent } from './dialogue';
import { findRoute } from './routing';
import { WEATHER_SPEED } from './events';
import type { Call, Incident } from './types';

// ── Regulars ────────────────────────────────────────────────────────────────
export interface Regular {
  id: string; name: string; age: number; district: string; archetype: string;
  /** what the CAD note on the number says */
  note: string;
  /** what they usually ring about */
  nuisance: string[];
  /** the day it is real */
  real: Array<{ template: string; open: string[] }>;
}
export interface RegularRecord { calls: number; real: number; lastShift: number; log: string[] }
export const REGULARS: Regular[] = [
  { id: 'doris', name: 'Doris Pemberton', age: 84, district: 'westres', archetype: 'confused_elderly',
    note: 'Lives alone, hard of hearing. Calls when lonely. Had a genuine fall two years ago and lay on the floor for nine hours.',
    nuisance: ["Hello dear, it's Doris again. There's a noise in the garden. I think it's the fox. Could someone come and look?", "Is it Tuesday? My carer hasn't come and the television's gone all fuzzy.", "Oh hello. I just wanted to check the number still worked. Are you the nice one from last week?"],
    real: [{ template: 'fall_elderly', open: ["It's Doris. I know, dear, I know. But I've fallen in the bathroom and I can't get up. My hip... it's very bad this time."] }, { template: 'breathing_trouble', open: ["It's Doris... I'm sorry... I can't... get my breath. It's not like the other times."] }] },
  { id: 'kroll', name: 'Alvin Kroll', age: 66, district: 'oldtown', archetype: 'angry_motorist',
    note: 'Repeated complaints about neighbours: parking, bins, noise. Has been warned about misuse of 911.',
    nuisance: ["It's Kroll. Number fourteen has parked across my driveway AGAIN. I want him towed. Today.", "The people opposite have put their bins out on the wrong night. I want it on record.", "There's a man walking a dog on my verge. That's trespass. Send a car."],
    real: [{ template: 'burglary_progress', open: ["It's Kroll — and this is NOT about the parking. There's someone in my garage. I can hear them. Right now."] }] },
  { id: 'tee', name: 'Terrence Malone', age: 37, district: 'downtown', archetype: 'drunk_caller',
    note: 'Frequently intoxicated. Reports conspiracies, stolen items later found. Known to outreach team.',
    nuisance: ["Yeah it's Tee. The helicopters are doing the thing again. The lights, man. They're watching my flat.", "Someone nicked my bike. Wait. No. It's here. Sorry. Sorry, man.", "Can you tell the guy at the shop I'm not barred any more? It's an emergency, kind of."],
    real: [{ template: 'overdose', open: ["Tee. Listen. LISTEN. My mate's gone blue, man. He's not breathing right. I'm not messing about this time, I swear down."] }] },
  { id: 'rosa', name: 'Rosa Delgado', age: 29, district: 'southside', archetype: 'panicked_parent',
    note: 'First-time mother. Many calls about minor illness in her son (Mateo, 2). Advised to use the nurse line.',
    nuisance: ["It's Rosa, Mateo's mum. His temperature is thirty-seven point four. Is that bad? Should I come in?", "Mateo sneezed four times in a row. Is that normal? I'm sorry, I know you said the nurse line.", "He won't eat his peas. He's never not eaten his peas."],
    real: [{ template: 'allergic_reaction', open: ["It's Rosa — please, please, this is different. Mateo ate something at the party and his face is swelling up and he's making a noise when he breathes."] }] },
  { id: 'finch', name: 'Gerald Finch', age: 71, district: 'harbor', archetype: 'professional',
    note: 'Retired police sergeant. Reports suspicious vehicles and people several times a week. Usually nothing.',
    nuisance: ["Finch here, retired, you'll know the name. White van, no markings, parked by the dock gate for forty minutes. Bears watching.", "Two youths loitering by the chandlery. Hoods up. I'd send a unit past if I were you.", "Gerald Finch. A car's gone round the block three times. Could be casing. Could be lost. Your call."],
    real: [{ template: 'robbery', open: ["Finch. This one's real, son. Two men just went into the chandlery with a shotgun. I'm across the road. I'll talk you through it."] }] },
];
export const REGULAR_BY_ID = Object.fromEntries(REGULARS.map((r) => [r.id, r]));

const hash = (a: number, b: number) => { let h = Math.imul(a + 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; };

/** a regular rings, now and then: most of the time it is nothing; once in a while it is not */
export function regularsTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script || st.time < 150 || st.time > st.config.durationSec - 90) return;
  const done = st.regularLog ?? [];
  if (done.length >= 2 || (done.length && st.time - done[done.length - 1].at < 240)) return;
  if (hash(Math.floor(st.time / 20), st.seed % 9973) > 0.045) return;
  const pool = REGULARS.filter((r) => st.config.districts.includes(r.district) && !done.some((d) => d.id === r.id));
  if (!pool.length) return;
  const r = pool[Math.floor(hash(Math.floor(st.time), 7) * pool.length)];
  const hist = st.config.regulars?.[r.id];
  // the more you have heard from someone, the more likely it is that today is the day it is real
  const real = hash(Math.floor(st.time), 11) < 0.22 + Math.min(0.2, (hist?.calls ?? 0) * 0.04) - (hist?.real ?? 0) * 0.08;
  spawnRegular(e, r, real);
}
export function spawnRegular(e: GameEngine, r: Regular, real: boolean): Incident {
  const st = e.state;
  const nodes = e.city.nodesInDistrict[r.district] ?? e.city.nodesInDistrict.downtown;
  const home = nodes[Math.floor(hash(r.id.length * 97 + r.id.charCodeAt(0), 3) * nodes.length)];
  const choice = real ? r.real[Math.floor(hash(Math.floor(st.time), 13) * r.real.length)] : null;
  const inc = e.spawnIncident(choice ? choice.template : 'regular_caller', r.district, { archetype: r.archetype, accuracy: 'exact', nodeId: home });
  inc.regular = { id: r.id, real };
  inc.openOverride = choice ? choice.open : [r.nuisance[Math.floor(hash(Math.floor(st.time), 17) * r.nuisance.length)]];
  inc.callerName = r.name; inc.callerProfile.name = r.name;
  const call = inc.callId ? st.calls[inc.callId] : null;
  if (call) { call.profile.name = r.name; call.profile.age = r.age; }
  (st.regularLog ??= []).push({ id: r.id, real, at: st.time, incId: inc.id });
  return inc;
}
/** the CAD recognises the number */
export function regularOnAnswer(e: GameEngine, call: Call, inc: Incident) {
  const r = inc.regular ? REGULAR_BY_ID[inc.regular.id] : null;
  if (!r) return;
  const h = e.state.config.regulars?.[r.id];
  const prev = h ? `${h.calls} previous 911 call${h.calls === 1 ? '' : 's'} on your shifts${h.real ? `, ${h.real} genuine` : ', none genuine'}` : 'known to the centre';
  e.addTranscript(call, 'SYSTEM', `CAD: number on file — ${r.name} (${r.age}), ${prev}. Note: ${r.note}`);
  if (h?.log.length) e.addTranscript(call, 'SYSTEM', `Last time: ${h.log[h.log.length - 1]}`);
}
/** what the dispatcher did with a regular, for their file */
export function regularOutcome(inc: Incident, how: 'redirected' | 'resolved' | 'failed' | 'dismissed'): string {
  const real = inc.regular?.real;
  if (how === 'redirected') return real ? `sent to the non-emergency line — it was real (${inc.label.toLowerCase()})` : 'sent to the non-emergency line';
  if (how === 'failed') return `${inc.label.toLowerCase()} — it went badly`;
  if (how === 'resolved') return real ? `${inc.label.toLowerCase()} — handled` : 'nothing to it';
  return real ? `${inc.label.toLowerCase()} — not taken seriously` : 'brushed off';
}

// ── Third-party callers ─────────────────────────────────────────────────────
const PATIENT_INTENTS = new Set<Intent>(['breathing', 'conscious', 'injuries', 'cause', 'inst_cpr', 'inst_recovery', 'inst_pressure', 'inst_still', 'inst_lift', 'inst_water']);
const relOf = (inc: Incident) => { const he = inc.vars.He === 'He'; const old = (Number(inc.truth.age) || 40) >= 62; return old ? (he ? 'Grandad' : 'Grandma') : he ? 'Daddy' : 'Mummy'; };
/** some callers are ringing for someone they cannot see: a child for a parent, a neighbour at a locked door */
export function setupThirdParty(inc: Incident, archetype: string, tplPatient: string | undefined) {
  if (inc.category !== 'medical' || !tplPatient || tplPatient === 'none' || tplPatient === 'child' || inc.vars.self === '1') return;
  const r = hash(inc.num, 41);
  if (archetype === 'child_caller' && r < 0.75) {
    const rel = relOf(inc);
    inc.thirdParty = { kind: 'child', near: false, tried: 0, rel };
    inc.openOverride = [fill(`Hello? Um... ${rel} fell down and {he} won't get up. I'm in the hallway. Is this the police?`, inc.vars), fill(`My ${rel.toLowerCase()} is on the floor and {he} won't talk to me. I'm scared to go in.`, inc.vars)];
  } else if (archetype === 'worried_neighbor' && r < 0.5) {
    inc.thirdParty = { kind: 'door', near: false, tried: 0, rel: 'neighbour' };
    inc.openOverride = [fill("I'm outside my neighbour's flat. I heard a crash and a groan and now {he}'s not answering the door. I can't see in.", inc.vars), fill("It's my neighbour — {his} TV's been blaring all night, the milk's still on the step, and {he}'s not answering. I'm at {his} door now.", inc.vars)];
  }
}
/** a question the caller cannot answer because they are not with the patient */
export function thirdPartyBlock(inc: Incident, intent: Intent): string | null {
  const tp = inc.thirdParty;
  if (!tp || tp.near || !PATIENT_INTENTS.has(intent)) return null;
  const k = (inc.num + intent.length + tp.tried) % 3;
  if (tp.kind === 'door') return fill(["I can't see {him} — I'm on the other side of the door!", "I don't know, I'm outside! The door's locked.", "How can I tell from out here? Can someone just come?"][k], inc.vars);
  return fill([`I don't know... ${tp.rel} is just lying there.`, "I don't know what that means. I'm only seven.", `${tp.rel} isn't talking to me. I'm in the hall.`][k], inc.vars);
}
/** ask the caller to get to the patient: find a key, look through a window, take the phone to the parent */
export function getCloser(e: GameEngine, callId: string): { ok: boolean; reason?: string } {
  const st = e.state;
  const call = st.calls[callId];
  if (!call || call.state !== 'active') return { ok: false, reason: 'No active call' };
  const inc = st.incidents[call.incidentId];
  const tp = inc.thirdParty;
  if (!tp) return { ok: false, reason: 'The caller is already with the patient' };
  if (tp.near) return { ok: false, reason: tp.kind === 'door' ? 'They are already inside' : 'They are already beside them' };
  if (tp.tried >= 2) return { ok: false, reason: 'They have tried everything they can' };
  tp.tried++;
  const t = st.time;
  if (tp.kind === 'door') {
    e.addTranscript(call, 'DISPATCHER', 'Is there any way in? A spare key, a neighbour with a key, a window you can look through? Only if it is safe.');
    const r = hash(inc.num, 50 + tp.tried);
    if (r < 0.45) { call.pending.push({ at: t + 6, text: fill("Hang on... the spare key's under the plant pot. I'm going in. Oh — oh no. {He}'s on the kitchen floor.", inc.vars) }); call.pending.push({ at: t + 9, text: fill("I'm with {him} now. What do I do?", inc.vars) }); tp.nearAt = t + 6; }
    else if (r < 0.75) { call.pending.push({ at: t + 7, text: fill("I can see through the front window. {He}'s lying on the floor by the sofa. {He}'s not moving. The door's still locked.", inc.vars), facts: { conscious: false } }); tp.window = true; inc.work += 12; }
    else { call.pending.push({ at: t + 7, text: "The door's solid and all the windows are shut. I can't get in. I'm sorry." }); inc.work += 18; }
  } else {
    e.addTranscript(call, 'DISPATCHER', `You're being so brave. Can you take the phone over to ${tp.rel}? Stay right next to them.`);
    if (inc.truth.conscious === true) {
      call.pending.push({ at: t + 5, text: `(footsteps) ${tp.rel}, the lady wants to talk to you...` });
      call.pending.push({ at: t + 9, text: fill("(weak, out of breath) Hello? ... It's all right, sweetheart. I'm here. I've had a fall... I can't get up.", inc.vars) });
      tp.handedAt = t + 9;
    } else {
      call.pending.push({ at: t + 5, text: fill(`(footsteps) I'm next to ${tp.rel} now. {His} eyes are closed. {He}'s not waking up even when I shake {him}.`, inc.vars), facts: { conscious: false } });
    }
    tp.nearAt = t + 5;
  }
  return { ok: true };
}
/** per-second: callers who got to the patient can now answer for them */
export function thirdPartyTick(e: GameEngine, inc: Incident) {
  const tp = inc.thirdParty;
  if (!tp || tp.near) return;
  if (tp.nearAt !== undefined && e.state.time >= tp.nearAt) {
    tp.near = true;
    if (tp.handedAt !== undefined) {
      const call = e.callFor(inc);
      if (call) { call.profile.archetype = 'injured_self'; call.profile.age = Number(inc.truth.age) || call.profile.age; inc.vars.self = '1'; }
    }
  }
}

// ── Drivers on the move ─────────────────────────────────────────────────────
/** the closest named place, for a caller who does not know street names */
export function landmarkNear(e: GameEngine, x: number, y: number, within = 140): { name: string; nodeId: number } | null {
  let best: { name: string; nodeId: number } | null = null, bd = within;
  for (const l of e.city.landmarks) { const n = e.city.nodes[l.nodeId]; const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = { name: l.name, nodeId: l.nodeId }; } }
  return best;
}
const dirWord = (h: number) => ['east', 'south', 'west', 'north'][((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4];
/** the caller is driving: the car keeps moving until they are told to pull over (or an ambulance flags them down) */
export function updateMovingCaller(e: GameEngine, inc: Incident, dt: number): boolean {
  const st = e.state, city = e.city, m = inc.mover;
  if (!m?.caller || m.stopped) return false;
  if (st.time < m.startAt) return true;
  if (!m.path || !m.path.length) {
    const r = findRoute(city, m.prev, m.dest ?? m.prev, e.tm(false), 1);
    m.path = r ? r.path.slice(1) : [];
    if (!m.path.length) { stopCar(e, inc, 'arrived'); return false; }
  }
  // driving in ordinary traffic, faster than they should
  let remaining = m.speed * 0.32 * (WEATHER_SPEED[st.weather] ?? 1) * dt * 3.2;
  let guard = 0;
  while (remaining > 1e-6 && m.path.length && guard++ < 6) {
    const tgt = city.nodes[m.path[0]];
    const dx = tgt.x - m.x, dy = tgt.y - m.y, d = Math.hypot(dx, dy);
    if (d <= remaining) { m.x = tgt.x; m.y = tgt.y; remaining -= d; m.came = m.prev; m.prev = m.path.shift()!; }
    else { m.x += (dx / d) * remaining; m.y += (dy / d) * remaining; m.heading = Math.atan2(dy, dx); remaining = 0; }
  }
  const last = m.trail[m.trail.length - 1];
  if (!last || Math.hypot(last.x - m.x, last.y - m.y) > 8) { m.trail.push({ x: m.x, y: m.y }); if (m.trail.length > 30) m.trail.shift(); }
  inc.nodeId = m.prev; inc.district = city.nodes[m.prev].district;
  if (!m.path.length) { stopCar(e, inc, 'arrived'); return false; }
  // an ambulance coming the other way flags them down
  const crew = inc.assignedUnits.map((id) => st.units[id]).find((u) => u && Math.hypot(u.x - m.x, u.y - m.y) < 24 && !['AVAILABLE', 'RETURNING'].includes(u.status));
  if (crew) { stopCar(e, inc, 'flagged'); return false; }
  // the caller tells you where they are, in their own words, a few seconds late
  const call = e.callFor(inc);
  if (call && call.state === 'active' && st.time - (m.lastUpdate ?? 0) > 11 && !call.pending.length) {
    m.lastUpdate = st.time;
    const lag = m.trail[Math.max(0, m.trail.length - 3)] ?? { x: m.x, y: m.y };
    const lm = landmarkNear(e, lag.x, lag.y);
    const n = city.nodes[city.nearestNode(lag.x, lag.y)];
    const k = hash(inc.num, Math.floor(st.time));
    if (lm && k < 0.6) call.pending.push({ at: st.time + 0.5, text: [`We just went past ${lm.name}!`, `There's ${lm.name} on my left — keep going?`, `I think that was ${lm.name}... I'm going ${dirWord(m.heading)}.`][Math.floor(k * 5) % 3], heard: [{ nodeId: lm.nodeId, label: `Passing ${lm.name}`, source: 'landmark', reliability: 'unsure' }] });
    else call.pending.push({ at: st.time + 0.5, text: k < 0.8 ? `I'm on ${n.addrStreet}, I think? Going ${dirWord(m.heading)}. ${inc.vars.He ?? 'He'}'s gone really pale.` : `I don't know where I am! Lights... a big junction... ${n.crossStreet}?`, heard: [{ nodeId: n.id, label: `${n.addrStreet} & ${n.crossStreet} (moving)`, source: 'cross', reliability: k < 0.8 ? 'unsure' : 'unsure' }] });
  }
  // the patient gets worse on the way
  inc.threat += inc.growth * dt;
  if (inc.threat >= 100) { e.escalate(inc); if (!['RESOLVED', 'CLOSED'].includes(inc.status)) stopCar(e, inc, 'worse'); return false; }
  return true;
}
function stopCar(e: GameEngine, inc: Incident, why: 'told' | 'flagged' | 'arrived' | 'worse') {
  const st = e.state, m = inc.mover!;
  m.stopped = true; m.path = [];
  const node = e.city.nearestNode(m.x, m.y);
  inc.nodeId = node; inc.district = e.city.nodes[node].district;
  const n = e.city.nodes[node];
  m.x = n.x; m.y = n.y;
  const call = e.callFor(inc);
  const where = addressOf(e.city, node);
  if (why === 'arrived') {
    if (call && call.state === 'active') call.pending.push({ at: st.time + 0.5, text: "We're here — we're at the hospital! People are coming out with a trolley!" });
    e.consequence(inc, 'The caller drove the patient to hospital themselves');
    inc.reportedNode = node;
    e.resolveIncident(inc, 'success');
    return;
  }
  const lines = { told: `Okay — okay, I've pulled over. We're outside ${where}. I've got the hazards on.`, flagged: "There's an ambulance — it's flashing at us! I'm pulling over!", worse: `${inc.vars.He ?? 'He'}'s gone — he's slumped over! I've stopped! I've stopped the car! ${where}!` };
  if (call && call.state === 'active') call.pending.push({ at: st.time + 0.6, text: lines[why], heard: [{ nodeId: node, label: `Stopped: ${where}`, source: 'cross', reliability: 'sure' }] });
  if (why === 'flagged') { inc.reportedNode = node; const u = inc.assignedUnits.map((id) => st.units[id]).find(Boolean); if (u) e.routeUnit(u, node, true); }
  e.log('info', `Caller's car stopped at ${where}`, { incidentId: inc.id });
}
/** tell a driving caller to stop somewhere safe and wait for the ambulance */
export function pullOver(e: GameEngine, callId: string): { ok: boolean; reason?: string } {
  const call = e.state.calls[callId];
  if (!call || call.state !== 'active') return { ok: false, reason: 'No active call' };
  const inc = e.state.incidents[call.incidentId];
  if (!inc.mover?.caller) return { ok: false, reason: 'The caller is not driving' };
  if (inc.mover.stopped) return { ok: false, reason: 'They have already stopped' };
  e.addTranscript(call, 'DISPATCHER', "I need you to pull over as soon as it's safe, put your hazards on and tell me exactly where you stop. The ambulance will come to you.");
  stopCar(e, inc, 'told');
  return { ok: true };
}

// ── Relayed calls: the car that rings for its driver, the alarm company ────
/** automated crash notifications and alarm-company operators: exact locations, almost no detail */
export function relaysTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script || st.time < 120 || st.time > st.config.durationSec - 90) return;
  const n = (st.relayLog ??= []);
  if (n.length >= 3 || (n.length && st.time - n[n.length - 1] < 200)) return;
  if (hash(Math.floor(st.time / 20), (st.seed % 7919) + 5) > 0.035) return;
  const dists = st.config.districts;
  const district = dists[Math.floor(hash(Math.floor(st.time), 21) * dists.length)];
  n.push(st.time);
  if (hash(Math.floor(st.time), 22) < 0.5) {
    // a car's telematics box detected a crash and an operator relays it
    const inc = e.spawnIncident('collision_injury', district, { archetype: 'professional', accuracy: 'exact' });
    const where = addressOf(e.city, inc.nodeId);
    inc.openOverride = [`This is an automated crash notification relayed by the Velora Connect operations centre. One of our vehicles reported a severe frontal impact at ${where} forty seconds ago. Airbags deployed. Our operator spoke into the cabin and got no reply.`];
    inc.callerName = 'Velora Connect (ACN)'; inc.callerProfile.name = inc.callerName;
    const call = inc.callId ? st.calls[inc.callId] : null;
    if (call) { call.profile.name = inc.callerName; call.relay = 'acn'; }
  } else {
    const real = hash(Math.floor(st.time), 23) < 0.25;
    const inc = e.spawnIncident(real ? 'electrical_fire' : 'alarm_relay', district, { archetype: 'professional', accuracy: 'exact' });
    const where = addressOf(e.city, inc.nodeId);
    inc.openOverride = [real ? `Sentinel Alarms central station, operator 4471. We have a fire alarm at ${where} — two zones now, smoke and heat. Keyholder is not answering.` : `Sentinel Alarms central station, operator 4471. Fire alarm activation at ${where}, one zone, smoke detector. Keyholder is not answering. Can you send someone to check?`];
    inc.callerName = 'Sentinel Alarms'; inc.callerProfile.name = inc.callerName;
    const call = inc.callId ? st.calls[inc.callId] : null;
    if (call) { call.profile.name = inc.callerName; call.relay = 'alarm'; }
  }
}
/** an operator relaying a machine's signal knows the address and nothing else */
export function relayBlock(call: Call, intent: Intent): string | null {
  if (!call.relay || ['address', 'landmark', 'callback', 'name', 'district', 'thanks', 'repeat', 'calm', 'stay', 'promise'].includes(intent)) return null;
  return call.relay === 'acn'
    ? ["I only have what the vehicle reports — frontal impact, airbags out, one occupant registered. I can't see them.", "No reply from the cabin. I can try the cabin microphone again, but that's all I've got.", "The car doesn't tell us that, I'm afraid. Just the impact data and the location."][Object.keys(call.asked).length % 3]
    : ["All I have is the panel signal, I'm afraid. Nobody's on site.", "No keyholder yet. We're still trying the numbers on the account.", "The panel shows the zone, that's all. Zone 3, ground floor."][Object.keys(call.asked).length % 3];
}
