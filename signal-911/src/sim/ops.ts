// More of the job: text-to-911 sessions, swatting hoaxes you can catch by ringing the address, pursuits
// you may have to call off, the day the CAD goes down, address hazard flags, a supervisor with
// opinions, neighbours asking you for help, and a quality-assurance audit of your calls.
import type { GameEngine } from './engine';
import { addressOf } from './city';
import { isAir } from './fleet';
import { TEMPLATE_BY_ID } from './content/templates';
import type { Call, GameState, Incident, Unit } from './types';
import { reportPosition } from './radioops';

const h01 = (a: number, b: number) => { let h = Math.imul(a + 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const live = (inc: Incident) => !['RESOLVED', 'CLOSED'].includes(inc.status);

// ── Text-to-911 ─────────────────────────────────────────────────────────────
const TEXT_TEMPLATES = new Set(['domestic_disturbance', 'burglary_progress', 'kidnapping', 'active_shooter', 'hostage_barricade', 'strange_noise', 'suspicious_activity', 'silent_call']);
/** someone who cannot speak — hiding, or deaf — texts instead */
export function maybeText(inc: Incident, call: Call) {
  if (call.profile.archetype === 'child_caller' || call.profile.callerIdType !== 'mobile' && !TEXT_TEMPLATES.has(inc.templateId)) return;
  const r = h01(inc.num, 501);
  if ((TEXT_TEMPLATES.has(inc.templateId) && r < 0.28) || (inc.category === 'medical' && r < 0.04)) { call.text = true; call.profile.callerIdType = 'mobile'; call.callerId = `TEXT ${call.profile.phone}`; }
}
/** how a frightened person types on a phone under a duvet */
export function textSpeak(s: string): string {
  let t = s.replace(/\([^)]*\)\s*/g, '').trim();
  const swaps: Array<[RegExp, string]> = [[/\byou\b/gi, 'u'], [/\bare\b/gi, 'r'], [/\bplease\b/gi, 'pls'], [/\bbecause\b/gi, 'bc'], [/\bI'm\b/gi, 'im'], [/\bdon't\b/gi, 'dont'], [/\bcan't\b/gi, 'cant'], [/\bwith\b/gi, 'w'], [/\bokay\b/gi, 'ok'], [/\bright now\b/gi, 'rn'], [/\bsomeone\b/gi, 'some1'], [/\bthe\b/gi, 'teh'], [/\bthat\b/gi, 'tht'], [/\bwhat\b/gi, 'wat'], [/\bhe's\b/gi, 'hes'], [/\bshe's\b/gi, 'shes'], [/\bit's\b/gi, 'its']];
  for (const [re, w] of swaps) t = t.replace(re, w);
  t = t.replace(/[—–]/g, ' ').replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  return t.toLowerCase();
}

// ── Swatting hoaxes, and ringing the address ────────────────────────────────
/** ring the landline listed at the address: catches hoaxes, and tells you something about real calls */
export function callPremises(e: GameEngine, incId: string): { ok: boolean; reason?: string; text?: string } {
  const st = e.state, inc = st.incidents[incId];
  if (!inc || !live(inc)) return { ok: false, reason: 'Incident closed' };
  if (inc.reportedNode === null) return { ok: false, reason: 'Set the location first — there is no address to ring' };
  if (inc.premisesCalled) return { ok: false, reason: 'You already rang the address' };
  inc.premisesCalled = st.time;
  const addr = addressOf(e.city, inc.reportedNode);
  let text: string;
  const wrongPlace = inc.reportedNode !== inc.nodeId && !inc.pursuit && !inc.mover;
  if (inc.hoax && !wrongPlace) {
    text = `You ring the number listed for ${addr}. A sleepy man answers: "Hostages? What? No — it's just me and my wife, we were asleep. Is this a joke?" It is a swatting hoax.`;
    inc.verified = true; inc.requires = []; inc.knownReqs = []; inc.threat = 0; inc.growth = 0;
    e.addFact(inc, 'false_alarm', true, 'confirmed', 'caller');
    st.stats.hoaxesCaught = (st.stats.hoaxesCaught ?? 0) + 1; st.budget += 500; st.stats.bonus += 500;
    for (const id of inc.assignedUnits) { const u = st.units[id]; if (u) e.radio('DISPATCH', `${u.spoken}, slow it down — the address is confirmed a hoax. Code 2, one unit to make contact.`, 'dispatch', u.id, inc.id); }
    e.headline('Swatting hoax caught before officers went in', 'good');
  } else if (wrongPlace) text = `You ring the number listed for ${addr}. A confused resident: "No, nothing's happening here." Either it is a hoax — or you have the wrong address.`;
  else if (TEMPLATE_BY_ID[inc.templateId]?.ambience === 'indoor' && ['police'].includes(inc.category)) text = `You ring the number listed for ${addr}. It rings out. Nobody picks up.`;
  else if (inc.category === 'fire') text = `You ring ${addr}. A neighbour answers in a rush: "Yes, there's smoke everywhere — we're getting out!"`;
  else text = `You ring the listed number for ${addr}. "Yes, it's real — they're on their way, aren't they?"`;
  const call = e.callFor(inc);
  if (call && call.state !== 'ended' && call.state !== 'missed') e.addTranscript(call, 'SYSTEM', text);
  e.log('info', `Rang the address: ${addr}`, { incidentId: inc.id });
  return { ok: true, text };
}
/** officers going through the door of a family home on a hoax */
export function hoaxTick(e: GameEngine, inc: Incident, here: Unit[]) {
  if (!inc.hoax || inc.hoaxDone || !here.length) return;
  inc.hoaxDone = true;
  const st = e.state;
  if (!inc.verified) {
    e.consequence(inc, 'Officers forced their way into a family home on a swatting hoax — nobody checked the address first');
    st.reputation = Math.max(0, st.reputation - 3);
    for (const u of here) for (const p of e.crewOf(u)) p.stress = Math.min(100, (p.stress ?? 0) + 12);
    e.radio(here[0].spoken, `Dispatch, ${here[0].spoken}. There's nobody here but a terrified family in their pyjamas. This was a swatting call.`, 'unit', here[0].id, inc.id);
    e.headline('Family held at gunpoint after hoax call — police chief to review', 'bad');
  } else e.radio(here[0].spoken, `Dispatch, ${here[0].spoken}. Spoke to the residents — all fine. Hoax confirmed.`, 'unit', here[0].id, inc.id);
  e.closeIncident(inc, 'false_alarm');
}

// ── Pursuit risk and termination ────────────────────────────────────────────
/** chases get more dangerous the longer they go; at some point the right call is to stop */
export function pursuitRisk(e: GameEngine, inc: Incident, contacts: number, dt: number) {
  const m = inc.mover!, st = e.state;
  if (m.foot || m.terminated) return;
  const night = st.timeOfDay % 24 >= 21 || st.timeOfDay % 24 < 5;
  const district = e.city.nodes[m.prev]?.district ?? '';
  const busy = ['downtown', 'financial', 'oldtown', 'university'].includes(district);
  const wet = ['rain', 'storm', 'snow', 'fog'].includes(st.weather);
  if (contacts > 0) m.risk = Math.min(100, (m.risk ?? 0) + dt * (0.55 + (busy ? 0.45 : 0) + (night ? 0.2 : 0) + (wet ? 0.35 : 0) + (m.heliId ? -0.3 : 0)));
  else m.risk = Math.max(0, (m.risk ?? 0) - dt * 0.6);
  if ((m.risk ?? 0) > 70 && h01(inc.num, Math.floor(st.time * 2)) < 0.004 * ((m.risk ?? 0) - 70) / 10) {
    m.risk = 35;
    const crash = e.spawnConnected(inc, 'collision_injury', { noCall: false });
    e.consequence(inc, 'The pursuit ran on too long through busy streets — the suspect hit an innocent driver');
    st.reputation = Math.max(0, st.reputation - 2.5);
    st.stats.pursuitCrashes = (st.stats.pursuitCrashes ?? 0) + 1;
    e.radio('DISPATCH', `All units, the suspect vehicle has collided with a civilian car at ${addressOf(e.city, m.prev)}. Medics responding.`, 'alert', undefined, inc.id);
    if (crash) e.notify('The pursuit caused a crash — injuries reported', 'bad', crash.id);
  }
}
export function terminatePursuit(e: GameEngine, incId: string): { ok: boolean; reason?: string; text?: string } {
  const st = e.state, inc = st.incidents[incId];
  if (!inc?.mover || !inc.pursuit || !live(inc)) return { ok: false, reason: 'No pursuit' };
  if (inc.mover.foot) return { ok: false, reason: 'Foot chases are not terminated from dispatch' };
  const m = inc.mover;
  e.radio('DISPATCH', `All units, terminate the pursuit. Terminate. Lights and sirens off, resume normal driving.`, 'alert', undefined, inc.id);
  st.stats.pursuitsTerminated = (st.stats.pursuitsTerminated ?? 0) + 1;
  for (const id of [...inc.assignedUnits]) { const u = st.units[id]; if (u && !isAir(u)) { e.detach(u, true); u.status = 'RETURNING'; u.assignedIncidentId = undefined; e.routeUnit(u, u.postNode, false); } }
  if (m.heliId) {
    m.terminated = true; m.risk = 0; m.speed *= 0.6;
    e.radio(st.units[m.heliId]?.spoken ?? 'Air One', 'Air One copies. Ground units backing off — we\'ll stay up high with him. He\'s slowing down already.', 'unit', m.heliId, inc.id);
    return { ok: true, text: 'Ground units have backed off. The helicopter is still on him — send cars in quietly when he stops.' };
  }
  e.consequence(inc, 'The pursuit was called off — the suspect got away, but nobody was hurt');
  e.closeIncident(inc, 'lost');
  return { ok: true, text: 'Pursuit terminated. The suspect got away — nobody got hurt.' };
}

// ── CAD outage ──────────────────────────────────────────────────────────────
export const cadDown = (st: GameState) => !!st.cad && st.time < st.cad.downUntil;
/** once in a while the computer-aided dispatch system falls over: no live unit positions until it is back */
export function cadTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script || st.rank < 2 || st.config.mode === 'scenario') return;
  st.cad ??= { downUntil: 0, snap: {}, nextAt: 240 + h01(st.seed % 9973, 3) * Math.max(60, st.config.durationSec - 520) };
  if (st.cad.nextAt !== undefined && st.time >= st.cad.nextAt) {
    st.cad.nextAt = undefined;
    if (h01(st.seed % 9973, 4) > 0.4) return;
    st.cad.downUntil = st.time + 150;
    st.cad.snap = {};
    for (const u of Object.values(st.units)) reportPosition(st, u);
    e.radio('DISPATCH', 'All units, all units: CAD is down and AVL is offline. Announce every status change on the radio. Expect delays.', 'alert');
    e.notify('CAD OUTAGE — the map only shows where units last told you they were. Use roll call.', 'bad');
    st.stats.cadOutages = (st.stats.cadOutages ?? 0) + 1;
  }
  if (st.cad.downUntil && st.time >= st.cad.downUntil && st.cad.downUntil > 0) { st.cad.downUntil = 0; e.radio('DISPATCH', 'All units, CAD is back up. AVL restored.', 'dispatch'); e.notify('CAD restored — live positions are back', 'good'); }
}
/** what the map shows: live positions, or the last ones reported while CAD is down */
export function viewState(st: GameState): GameState {
  if (!cadDown(st)) return st;
  const units: GameState['units'] = {};
  for (const [id, u] of Object.entries(st.units)) {
    const s = st.cad!.snap[id];
    units[id] = s ? { ...u, x: s.x, y: s.y, route: [], speed: 0 } : { ...u, route: [], speed: 0 };
  }
  return { ...st, units };
}

// ── Premise history ─────────────────────────────────────────────────────────
export interface PremiseFlag { kind: 'weapons' | 'violent' | 'dog' | 'oxygen' | 'hoarder' | 'dv' | 'mental'; text: string; learned?: boolean }
const FLAGS: PremiseFlag[] = [
  { kind: 'weapons', text: 'Weapons on premises — resident holds licensed firearms' }, { kind: 'violent', text: 'Caution — prior assault on officers at this address' },
  { kind: 'dog', text: 'Dangerous dog on premises' }, { kind: 'oxygen', text: 'Home oxygen in use — no naked flames' },
  { kind: 'hoarder', text: 'Hoarding — blocked exits, heavy fire load' }, { kind: 'dv', text: 'Three prior domestic violence calls' }, { kind: 'mental', text: 'Resident with a history of mental health crises' },
];
export function premiseFlags(e: GameEngine, nodeId: number): PremiseFlag[] {
  const out: PremiseFlag[] = [];
  if (h01(nodeId, 811) < 0.13) out.push(FLAGS[Math.floor(h01(nodeId, 812) * FLAGS.length)]);
  for (const k of e.state.config.premises?.[nodeId] ?? []) { const f = FLAGS.find((x) => x.kind === k); if (f && !out.some((o) => o.kind === k)) out.push({ ...f, learned: true }); }
  for (const k of e.state.premiseLog?.[nodeId] ?? []) { const f = FLAGS.find((x) => x.kind === k); if (f && !out.some((o) => o.kind === k)) out.push({ ...f, learned: true }); }
  return out;
}
export function warnPremise(e: GameEngine, incId: string): { ok: boolean; reason?: string } {
  const inc = e.state.incidents[incId];
  if (!inc || inc.reportedNode === null) return { ok: false, reason: 'No location' };
  const flags = premiseFlags(e, inc.reportedNode);
  if (!flags.length) return { ok: false, reason: 'No flags on this address' };
  if (inc.premiseWarned) return { ok: false, reason: 'Crews already warned' };
  inc.premiseWarned = true;
  e.radio('DISPATCH', `Units responding to ${addressOf(e.city, inc.reportedNode)}, be advised: ${flags.map((f) => f.text.toLowerCase()).join('; ')}.`, 'dispatch', undefined, inc.id);
  if (flags.some((f) => ['weapons', 'violent', 'dv'].includes(f.kind))) inc.weaponRelayed = true;
  e.state.stats.premiseWarnings = (e.state.stats.premiseWarnings ?? 0) + 1;
  return { ok: true };
}
/** the first crew through the door finds out whether you warned them */
export function premiseArrival(e: GameEngine, inc: Incident, u: Unit) {
  if (inc.premiseChecked || inc.reportedNode === null || inc.reportedNode !== inc.nodeId) return;
  inc.premiseChecked = true;
  const flags = premiseFlags(e, inc.nodeId);
  if (!flags.length) return;
  const warned = !!inc.premiseWarned;
  for (const f of flags) {
    if (['weapons', 'violent', 'dv'].includes(f.kind) && u.service === 'police' && !warned) { inc.weaponMissed = true; e.consequence(inc, `Officers went in without being told: ${f.text.toLowerCase()}`); }
    if (f.kind === 'dog' && !warned) { inc.accessDelayUntil = Math.max(inc.accessDelayUntil ?? 0, e.state.time + 25); e.radio(u.spoken, `Dispatch, ${u.spoken}. Nobody told us about the dog! We're backing out until it's shut away.`, 'unit', u.id, inc.id); }
    if (f.kind === 'oxygen' && inc.category === 'fire' && !warned) { inc.threat = Math.min(95, inc.threat + 18); e.consequence(inc, 'Oxygen cylinders inside fed the fire — crews were not warned'); }
    if (f.kind === 'hoarder' && inc.category === 'fire') inc.work *= warned ? 1.08 : 1.25;
  }
}
/** dangerous addresses get remembered */
export function learnPremise(st: GameState, inc: Incident) {
  const w = inc.truth.weapon;
  if (w && w !== 'none' && inc.category === 'police') ((st.premiseLog ??= {})[inc.nodeId] ??= []).includes('weapons') || st.premiseLog![inc.nodeId].push('weapons');
  if (inc.templateId === 'domestic_disturbance') ((st.premiseLog ??= {})[inc.nodeId] ??= []).includes('dv') || st.premiseLog![inc.nodeId].push('dv');
}

// ── Supervisor directives ───────────────────────────────────────────────────
export interface Directive { id: string; kind: 'answer' | 'hold' | 'cover' | 'clear'; text: string; from: number; until: number; district?: string; target: number; progress: number; result?: 'done' | 'failed'; base?: number }
export function directiveTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script) return;
  const list = (st.directives ??= []);
  const cur = list.find((d) => !d.result);
  if (cur) {
    const fail = (why: string) => { cur.result = 'failed'; st.reputation = Math.max(0, st.reputation - 1); e.radio('Supervisor Okafor', `Dispatch, Okafor. ${why} We'll talk about it at the debrief.`, 'chatter'); e.notify(`Supervisor: directive failed — ${why}`, 'bad'); };
    if (cur.kind === 'answer' && Object.values(st.calls).some((c) => c.ringStart >= cur.from && ((c.state === 'ringing' && st.time - c.ringStart > cur.target) || (c.answeredAt !== null && c.answeredAt - c.ringStart > cur.target) || c.state === 'missed'))) return fail('A call rang too long.');
    if (cur.kind === 'hold' && Object.values(st.calls).some((c) => c.state === 'hold' && c.holdSince !== null && st.time - c.holdSince > cur.target)) return fail('Someone sat on hold too long.');
    if (cur.kind === 'cover' && cur.district && !Object.values(st.units).some((u) => u.status === 'AVAILABLE' && !isAir(u) && u.capabilities.includes('transport') && e.city.nodes[u.prevNode]?.district === cur.district)) return fail(`${e.city.districtById[cur.district]?.name ?? cur.district} was left without an ambulance.`);
    if (cur.kind === 'clear') { cur.progress = st.stats.resolved - (cur.base ?? 0); if (cur.progress >= cur.target) { cur.result = 'done'; reward(e, cur); return; } }
    if (st.time >= cur.until) { if (cur.kind === 'clear') return fail(`Only ${cur.progress} of ${cur.target} cleared.`); cur.result = 'done'; reward(e, cur); }
    return;
  }
  if (st.time < (st.nextDirectiveAt ?? 210) || st.time > st.config.durationSec - 200) return;
  st.nextDirectiveAt = st.time + 300 + h01(Math.floor(st.time), 41) * 180;
  const k = Math.floor(h01(Math.floor(st.time), 42) * 4);
  const ds = st.config.districts;
  const district = ds[Math.floor(h01(Math.floor(st.time), 43) * ds.length)];
  const d: Directive = [
    { id: '', kind: 'answer' as const, text: 'Answer every call within 12 seconds for the next four minutes. The chief is listening to the queue.', from: st.time, until: st.time + 240, target: 12, progress: 0 },
    { id: '', kind: 'hold' as const, text: 'Nobody on hold longer than 30 seconds for the next four minutes.', from: st.time, until: st.time + 240, target: 30, progress: 0 },
    { id: '', kind: 'cover' as const, text: `Keep at least one ambulance free in ${e.city.districtById[district]?.name ?? district} for the next three minutes — the mayor is visiting.`, from: st.time, until: st.time + 180, target: 1, progress: 0, district },
    { id: '', kind: 'clear' as const, text: 'Clear three incidents in the next five minutes. The board is getting long.', from: st.time, until: st.time + 300, target: 3, progress: 0, base: st.stats.resolved },
  ][k];
  d.id = `dir${list.length + 1}`;
  list.push(d);
  e.radio('Supervisor Okafor', `Dispatch, this is Okafor. ${d.text}`, 'chatter');
  e.notify(`Supervisor: ${d.text}`, 'info');
}
function reward(e: GameEngine, d: Directive) {
  const st = e.state;
  st.budget += 1500; st.stats.bonus += 1500; st.reputation = Math.min(100, st.reputation + 1.5);
  st.stats.directivesDone = (st.stats.directivesDone ?? 0) + 1;
  e.radio('Supervisor Okafor', `Nice work, dispatch. That's what I like to see.`, 'chatter');
  e.notify(`Supervisor: directive met (+$1,500) — ${d.text.split('.')[0]}`, 'good');
}

// ── Neighbours asking you for help ──────────────────────────────────────────
export function aidOutTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script || st.rank < 2 || st.aidOutAsked || st.time < 300 || st.time > st.config.durationSec - 240) return;
  if (h01(Math.floor(st.time / 30), st.seed % 7717) > 0.035) return;
  st.aidOutAsked = true;
  const cap = h01(Math.floor(st.time), 61) < 0.5 ? 'transport' : 'fire_suppression';
  const u = Object.values(st.units).filter((x) => x.status === 'AVAILABLE' && !isAir(x) && !x.temp && x.capabilities.includes(cap))[0];
  if (!u) return;
  const what = cap === 'transport' ? 'an ambulance' : 'an engine company';
  (st.decisions ??= []).push({ id: `d${st.decisions.length + 1}-a${Math.floor(st.time)}`, incId: '', unitId: u.id, at: st.time, expiresAt: st.time + 30, kind: 'aidOut',
    prompt: `Harlow County: multi-vehicle pile-up on Route 9, everything we have is committed. Can Ravenport send ${what} for about ten minutes?`,
    options: [{ id: 'send', label: `Send ${u.callsign}`, hint: 'Good neighbours get paid back — but you are one unit down' }, { id: 'decline', label: 'Decline', hint: 'Keep your coverage; Harlow will remember' }], defaultId: 'decline' });
  e.radio('Harlow County', `Ravenport, Harlow County. Requesting mutual aid — ${what} to Route 9.`, 'chatter');
}
export function decideAidOut(e: GameEngine, d: import('./types').Decision, optionId: string): { ok: boolean; outcome?: string } {
  const st = e.state, u = st.units[d.unitId];
  if (optionId === 'send' && u && u.status === 'AVAILABLE') {
    u.status = 'OUT_OF_SERVICE'; u.note = 'Mutual aid — Harlow County'; u.timer = 300; u.route = []; u.speed = 0;
    st.budget += 2500; st.stats.income += 2500; st.reputation = Math.min(100, st.reputation + 1.5);
    e.radio('DISPATCH', `Harlow County, Ravenport. ${u.callsign} is on the way to you.`, 'dispatch', u.id);
    d.outcome = `${u.callsign} went to help Harlow County (+$2,500). Back in about five minutes.`;
  } else {
    st.reputation = Math.max(0, st.reputation - 0.5);
    e.radio('DISPATCH', 'Harlow County, Ravenport. Sorry — we can\'t spare anyone right now.', 'dispatch');
    d.outcome = 'Declined. Harlow will try elsewhere.';
  }
  return { ok: true, outcome: d.outcome };
}

// ── Quality assurance ───────────────────────────────────────────────────────
export interface Audit { incId: string; label: string; caller: string; score: number; items: Array<{ ok: boolean; text: string }> }
/** the supervisor pulls a few of your calls and grades them against the protocol */
export function auditCalls(st: GameState): Audit[] {
  const calls = Object.values(st.calls).filter((c) => c.answeredAt !== null && !c.isCallback && st.incidents[c.incidentId] && !TEMPLATE_BY_ID[st.incidents[c.incidentId].templateId]?.nonEmergency && st.incidents[c.incidentId].requires.length);
  const pick = calls.sort((a, b) => h01(a.ringStart * 10, 9) - h01(b.ringStart * 10, 9)).slice(0, 3);
  return pick.map((c) => {
    const inc = st.incidents[c.incidentId];
    const items: Audit['items'] = [];
    const ans = c.answeredAt!;
    items.push({ ok: ans - c.ringStart <= 15, text: `Answered in ${Math.round(ans - c.ringStart)} s (target 15)` });
    items.push({ ok: inc.locatedAt !== null && inc.locatedAt - ans <= 40, text: inc.locatedAt !== null ? `Location set ${Math.round(inc.locatedAt - ans)} s into the call (target 40)` : 'Location never set' });
    items.push({ ok: !inc.mislocated, text: inc.mislocated ? 'Units were sent to the wrong place' : 'Location correct' });
    items.push({ ok: inc.firstDispatchAt !== null && inc.firstDispatchAt - ans <= 75, text: inc.firstDispatchAt !== null ? `First unit sent ${Math.round(inc.firstDispatchAt - ans)} s after answering (target 75)` : 'No unit was ever sent' });
    if (inc.category === 'medical') items.push({ ok: !!(c.asked.breathing || c.asked.conscious), text: c.asked.breathing || c.asked.conscious ? 'Asked about breathing / consciousness' : 'Never asked if the patient was breathing or conscious' });
    if (inc.lifeThreat) items.push({ ok: !!inc.aid && inc.aid.fit !== 'bad', text: inc.aid ? (inc.aid.fit === 'bad' ? 'Gave the wrong instructions' : 'Gave life-saving instructions') : 'No pre-arrival instructions for a life threat' });
    if (inc.category === 'police') items.push({ ok: !!(c.asked.weapon || c.asked.suspect), text: c.asked.weapon || c.asked.suspect ? 'Asked about weapons / the suspect' : 'Never asked about weapons' });
    items.push({ ok: c.promises.length > 0 || !!c.asked.promise, text: c.promises.length || c.asked.promise ? 'Told the caller help was coming' : 'Never reassured the caller' });
    const score = Math.round((items.filter((i) => i.ok).length / items.length) * 100);
    return { incId: inc.id, label: inc.label, caller: c.profile.name, score, items };
  });
}
