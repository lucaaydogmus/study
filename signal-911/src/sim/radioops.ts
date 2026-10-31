// Running the radio. Talkgroups for police and fire/EMS plus the outside line; emergency traffic only
// when something big is happening; transmissions that get stepped on or lost in a dead spot until you
// ask for a repeat; roll calls; patches that put police and fire on one channel; and the orange button
// on an officer's radio, which gives you seconds to act.
import type { GameEngine } from './engine';
import { addressOf } from './city';
import { isAir } from './fleet';
import { isOutside } from './radioreq';
import type { GameState, RadioMsg, Unit } from './types';

export type Talkgroup = 'police' | 'fire' | 'outside';
export const TALKGROUPS: Array<{ id: Talkgroup; name: string; short: string }> = [
  { id: 'police', name: 'Police Ops 1', short: 'OPS-1' },
  { id: 'fire', name: 'Fire & EMS 2', short: 'FIRE-2' },
  { id: 'outside', name: 'Outside line', short: 'OUTSIDE' },
];
const tgOfUnit = (u?: Unit) => (!u ? null : u.service === 'police' ? 'police' : 'fire') as Talkgroup | null;
/** which talkgroup a transmission went out on (null = every channel: all-call alerts) */
export function talkgroupOf(st: GameState, m: RadioMsg): Talkgroup | null {
  if (isOutside(m)) return 'outside';
  if (m.kind === 'hospital') return 'fire';
  if (m.unitId) return tgOfUnit(st.units[m.unitId]);
  if (m.incidentId) { const inc = st.incidents[m.incidentId]; if (inc) return inc.category === 'police' ? 'police' : 'fire'; }
  return null;
}
const ctl = (st: GameState) => (st.radioCtl ??= { held: {}, queue: [], emergencies: [], repeats: 0 });

// ── Emergency traffic only ──────────────────────────────────────────────────
/** clear a talkgroup for an emergency: routine traffic waits, the people in trouble get through */
export function setEmergencyTraffic(e: GameEngine, tg: 'police' | 'fire', on: boolean): { ok: boolean; reason?: string } {
  const st = e.state, c = ctl(st);
  const name = TALKGROUPS.find((t) => t.id === tg)!.name;
  if (on === (c.held[tg] !== undefined)) return { ok: false, reason: on ? 'Already holding the channel' : 'Channel is already open' };
  if (on) { c.held[tg] = st.time; e.radio('DISPATCH', `All units on ${name}: emergency traffic only. Emergency traffic only.`, 'alert'); }
  else {
    const held = st.time - (c.held[tg] ?? st.time);
    delete c.held[tg];
    e.radio('DISPATCH', `All units on ${name}: resume normal traffic.`, 'dispatch');
    if (held > 150) { e.notify(`${name} was held for ${Math.round(held / 60)} minutes — crews had a backlog to clear`, 'warn'); st.stats.radioHeldLong = (st.stats.radioHeldLong ?? 0) + 1; }
  }
  return { ok: true };
}
export const isHeld = (st: GameState, tg: Talkgroup | null) => !!tg && tg !== 'outside' && st.radioCtl?.held[tg] !== undefined;
/** is there something on this channel that deserves emergency traffic? */
export function emergencyOn(st: GameState, tg: 'police' | 'fire'): boolean {
  if ((st.radioCtl?.emergencies ?? []).some((x) => !x.done && tgOfUnit(st.units[x.unitId]) === tg)) return true;
  return (st.decisions ?? []).some((d) => !d.chosen && d.kind === 'mayday' && tg === 'fire');
}
/** per second: holding a channel too long costs the crews waiting to talk */
export function heldTick(e: GameEngine) {
  const st = e.state, c = st.radioCtl;
  if (!c) return;
  for (const tg of ['police', 'fire'] as const) {
    const since = c.held[tg];
    if (since === undefined) continue;
    const t = st.time - since;
    if (t > 120 && Math.floor(t) % 40 === 0 && !emergencyOn(st, tg)) {
      e.notify(`${TALKGROUPS.find((x) => x.id === tg)!.name} is still on emergency traffic only — units are waiting to report`, 'warn');
      for (const u of Object.values(st.units)) if (tgOfUnit(u) === tg) for (const p of e.crewOf(u)) p.morale = Math.max(0, p.morale - 1);
    }
  }
}

// ── Blocked transmissions ───────────────────────────────────────────────────
/** two units keying up together, or a crew in a dead spot: the message is lost until you ask */
export function maybeBreak(e: GameEngine, m: RadioMsg) {
  const st = e.state;
  if (m.kind !== 'unit' || !m.unitId || st.config.mode === 'tutorial' || st.config.script) return;
  const u = st.units[m.unitId];
  if (!u || isAir(u)) return;
  const prev = st.radio[st.radio.length - 2];
  const stepped = prev && prev.kind === 'unit' && prev.unitId !== m.unitId && st.time - prev.t < 1.1;
  const district = e.city.nodes[u.prevNode]?.district;
  const dead = (district === 'industrial' || district === 'harbor') && u.status === 'ON_SCENE';
  const h = hashStr(m.id);
  if ((stepped && h < 0.5) || (dead && h < 0.18)) { m.broken = true; m.brokenWhy = stepped ? 'stepped' : 'dead'; }
}
/** "Unit that was blocked, say again" */
export function sayAgainRadio(e: GameEngine, msgId: string): { ok: boolean; reason?: string } {
  const st = e.state;
  const m = st.radio.find((x) => x.id === msgId);
  if (!m || !m.broken) return { ok: false, reason: 'Nothing to repeat' };
  m.broken = false; m.repeated = true;
  const u = m.unitId ? st.units[m.unitId] : undefined;
  e.radio('DISPATCH', m.brokenWhy === 'stepped' ? 'Units, you doubled. Last unit, say again.' : `${u?.spoken ?? 'Unit'}, you're broken and unreadable. Say again.`, 'dispatch', m.unitId, m.incidentId);
  ctl(st).queue.push({ at: st.time + 2, from: m.from, text: m.text.replace(/^Dispatch, /, 'Dispatch, repeating: '), unitId: m.unitId, incId: m.incidentId });
  ctl(st).repeats++;
  return { ok: true };
}

// ── Roll call ───────────────────────────────────────────────────────────────
/** every unit on the talkgroup reports where it is and what it is doing */
export function rollCall(e: GameEngine, tg: 'police' | 'fire'): { ok: boolean; reason?: string } {
  const st = e.state, c = ctl(st);
  if (c.queue.some((q) => q.roll === tg)) return { ok: false, reason: 'Roll call already under way' };
  const units = Object.values(st.units).filter((u) => tgOfUnit(u) === tg && !isAir(u)).sort((a, b) => a.callsign.localeCompare(b.callsign));
  e.radio('DISPATCH', `All units on ${TALKGROUPS.find((x) => x.id === tg)!.name}, roll call. Report your location and status.`, 'dispatch');
  units.forEach((u, i) => c.queue.push({ at: st.time + 2 + i * 1.6, from: u.spoken, unitId: u.id, roll: tg, text: '' }));
  st.stats.rollCalls = (st.stats.rollCalls ?? 0) + 1;
  return { ok: true };
}
function statusLine(e: GameEngine, u: Unit): string {
  const where = addressOf(e.city, e.city.nearestNode(u.x, u.y));
  const inc = u.assignedIncidentId ? e.state.incidents[u.assignedIncidentId] : undefined;
  switch (u.status) {
    case 'ON_SCENE': return `${u.spoken}, on scene at ${inc ? addressOf(e.city, inc.reportedNode ?? inc.nodeId) : where}.`;
    case 'EN_ROUTE': case 'DISPATCHED': return `${u.spoken}, responding, passing ${where}.`;
    case 'TRANSPORTING': return `${u.spoken}, transporting, near ${where}.`;
    case 'RETURNING': return `${u.spoken}, available, returning — ${where}.`;
    case 'OUT_OF_SERVICE': return `${u.spoken}, out of service${u.note ? ` — ${u.note.toLowerCase()}` : ''}.`;
    case 'BUSY': return `${u.spoken}, busy at ${where}.`;
    default: return e.onPatrol(u) ? `${u.spoken}, patrolling ${where}.` : `${u.spoken}, in quarters.`;
  }
}
/** deliver queued transmissions (roll-call answers, repeats) */
export function radioQueueTick(e: GameEngine) {
  const st = e.state, c = st.radioCtl;
  if (!c?.queue.length) return;
  const due = c.queue.filter((q) => q.at <= st.time);
  c.queue = c.queue.filter((q) => q.at > st.time);
  for (const q of due) {
    const u = q.unitId ? st.units[q.unitId] : undefined;
    if (q.roll && u) { e.radio(u.spoken, statusLine(e, u), 'unit', u.id); reportPosition(st, u); }
    else e.radio(q.from, q.text, 'unit', q.unitId, q.incId);
  }
}
/** a unit telling dispatch where it is (what the map shows while CAD is down) */
export function reportPosition(st: GameState, u: Unit) {
  if (!st.cad) return;
  st.cad.snap[u.id] = { x: u.x, y: u.y, status: u.status, t: st.time };
}

// ── The orange button ───────────────────────────────────────────────────────
/** an officer hits the emergency button: open mic, seconds to act */
export function emergencyActivation(e: GameEngine, u: Unit, incId: string) {
  const st = e.state, c = ctl(st);
  const lines = ['(open mic — shouting) Get on the ground! Get on the — (struggle)', '(open mic — heavy breathing, scuffling) — let go of it! LET GO —', '(open mic — a crash, shouting in the background)'];
  c.emergencies.push({ id: `em${c.emergencies.length + 1}`, unitId: u.id, incId, at: st.time, until: st.time + 22, acked: false, done: false });
  e.radio(`EMERGENCY — ${u.callsign}`, lines[c.emergencies.length % lines.length], 'alert', u.id, incId);
  e.notify(`EMERGENCY ACTIVATION — ${u.callsign}. Acknowledge and get backup rolling code 3`, 'bad', incId);
  e.emit({ type: 'alert', text: 'Emergency activation', incId, cine: 'mayday' });
}
export function ackEmergency(e: GameEngine, id: string): { ok: boolean; reason?: string } {
  const st = e.state;
  const em = st.radioCtl?.emergencies.find((x) => x.id === id);
  if (!em || em.done) return { ok: false, reason: 'Gone' };
  if (em.acked) return { ok: false, reason: 'Already acknowledged' };
  em.acked = true;
  const u = st.units[em.unitId];
  e.radio('DISPATCH', `${u?.spoken ?? 'Unit'} with the emergency, I copy. All units, emergency traffic only — officer needs assistance at ${addressOf(e.city, st.incidents[em.incId]?.reportedNode ?? st.incidents[em.incId]?.nodeId ?? 0)}.`, 'alert', em.unitId, em.incId);
  if (st.radioCtl!.held.police === undefined) st.radioCtl!.held.police = st.time;
  return { ok: true };
}
export function emergencyTick(e: GameEngine) {
  const st = e.state, c = st.radioCtl;
  if (!c) return;
  for (const em of c.emergencies) {
    if (em.done || st.time < em.until) continue;
    em.done = true;
    const u = st.units[em.unitId], inc = st.incidents[em.incId];
    if (!u || !inc) continue;
    const backup = inc.assignedUnits.some((id) => id !== u.id && st.units[id]?.service === 'police' && ['EN_ROUTE', 'ON_SCENE', 'DISPATCHED'].includes(st.units[id].status));
    const good = em.acked && backup ? true : em.acked || backup ? e.hrandPublic(inc.num, 77) < 0.5 : false;
    if (good) {
      e.radio(u.spoken, `Dispatch, ${u.spoken}. Code 4 — one in custody. I'm okay. Thanks for the cover.`, 'unit', u.id, inc.id);
      st.stats.emergenciesHandled = (st.stats.emergenciesHandled ?? 0) + 1;
      for (const p of e.crewOf(u)) { p.morale = Math.min(100, p.morale + 6); p.stress = Math.min(100, (p.stress ?? 0) + 8); }
    } else e.officerDown(u, inc, em.acked ? 'Backup was not sent in time after the emergency activation' : 'Nobody answered the emergency activation');
  }
  c.emergencies = c.emergencies.filter((x) => !x.done || st.time - x.until < 30);
}

// ── Patching ────────────────────────────────────────────────────────────────
/** put police and fire on one channel for a big incident: unified command */
export function patchIncident(e: GameEngine, incId: string): { ok: boolean; reason?: string } {
  const st = e.state, inc = st.incidents[incId];
  if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'Incident closed' };
  if (inc.patched) return { ok: false, reason: 'Already patched' };
  const svcs = new Set(e.onScene(inc).map((u) => u.service));
  if (svcs.size < 2) return { ok: false, reason: 'A patch needs more than one service on scene' };
  inc.patched = true;
  e.radio('DISPATCH', `All units at INC-${String(inc.num).padStart(4, '0')}, patching Ops One and Fire Two. Unified command on the patch.`, 'dispatch', undefined, inc.id);
  st.stats.patches = (st.stats.patches ?? 0) + 1;
  return { ok: true };
}
/** crews at a big multi-service scene ask for a patch once */
export function patchAskTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script) return;
  for (const inc of Object.values(st.incidents)) {
    if (inc.patched || inc.patchAsked || inc.severity < 4 || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
    const here = e.onScene(inc);
    if (new Set(here.map((u) => u.service)).size < 2) continue;
    inc.patchAsked = st.time;
    const u = here.find((x) => x.service === 'fire') ?? here[0];
    e.radio(u.spoken, `Dispatch, ${u.spoken}. We can't hear PD on our channel — can you patch us together?`, 'unit', u.id, inc.id);
  }
}

function hashStr(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }
