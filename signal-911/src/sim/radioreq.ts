// Requests over the radio. Nothing outside your own fleet comes from a menu: crews on scene ask for what
// they need, you get it rolling on the outside line (county, utilities, state and federal), and if you
// forget — or are too slow — they come back on the radio, more and more insistently, until it costs them.
import type { GameEngine } from './engine';
import { AGENCY, RESOURCES, RESOURCE_BY_ID, matchCoverage } from './engine';
import { isAir } from './fleet';
import type { Incident, Unit } from './types';

export interface Need { incId: string; resId: string; unitId: string | null; at: number; nag: number; name: string; source: 'agency' | 'specialist' | 'resource' }

const live = (inc: Incident) => !['RESOLVED', 'CLOSED'].includes(inc.status) && !inc.hidden;
/** everything crews have asked for that has not been sent yet */
export function pendingNeeds(e: GameEngine, incId?: string): Need[] {
  const st = e.state;
  const out: Need[] = [];
  for (const inc of Object.values(st.incidents)) {
    if ((incId && inc.id !== incId) || !live(inc)) continue;
    const here = e.onScene(inc).find((u) => !isAir(u)) ?? null;
    const declined = inc.declined ?? {};
    const a = inc.agency;
    if (a && a.askedAt !== null && a.calledAt == null && declined[a.kind] === undefined) out.push({ incId: inc.id, resId: a.kind, unitId: here?.id ?? null, at: a.askedAt, nag: a.nagged, name: AGENCY[a.kind].name, source: 'agency' });
    for (const [k, at] of Object.entries(inc.specialistAsked ?? {})) if (!inc.specialists?.[k as 'eod' | 'federal'] && declined[k] === undefined) out.push({ incId: inc.id, resId: k, unitId: here?.id ?? null, at, nag: inc.needNag?.[k] ?? 0, name: RESOURCE_BY_ID[k].name, source: 'specialist' });
    for (const [k, at] of Object.entries(inc.resAsked ?? {})) if (!inc.resources?.[k] && declined[k] === undefined && RESOURCE_BY_ID[k]) out.push({ incId: inc.id, resId: k, unitId: here?.id ?? null, at, nag: inc.needNag?.[k] ?? 0, name: RESOURCE_BY_ID[k].name, source: 'resource' });
  }
  return out.sort((x, y) => x.at - y.at);
}

/** crews notice what they need, and keep asking until they get it */
export function needsTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script) return;
  // 1. a scene that is short of a capability your fleet does not have free: they ask for mutual aid
  for (const inc of Object.values(st.incidents)) {
    if (!live(inc) || inc.pursuit || !inc.sceneSeen || inc.severity < 3 || st.time - (inc.sceneAt ?? st.time) < 25) continue;
    if (Object.keys(inc.resAsked ?? {}).some((k) => k.startsWith('ma_'))) continue;
    const here = e.onScene(inc).filter((u) => !isAir(u));
    if (!here.length) continue;
    const cov = matchCoverage(inc.requires, inc.assignedUnits.map((id) => st.units[id]).filter((u): u is Unit => !!u));
    const miss = cov.missing.find((r) => !Object.values(st.units).some((u) => u.status === 'AVAILABLE' && !isAir(u) && u.capabilities.includes(r.cap)));
    if (!miss) continue;
    const ma = RESOURCES.find((r) => r.kind === 'mutual' && (r.cap === miss.cap || (r.cap === 'transport' && miss.cap === 'bls')));
    if (!ma || inc.mutualAid >= 2) continue;
    (inc.resAsked ??= {})[ma.id] = st.time;
    const u = here[0];
    e.radio(u.spoken, `Dispatch, ${u.spoken}. We're short here and you've got nobody free — can you get ${ma.name.replace('Mutual aid — ', 'a ').toLowerCase()} from county on mutual aid?`, 'unit', u.id, inc.id);
    tagOutside(e);
  }
  // 2. reminders for specialists and services nobody has called (agencies have their own follow-up)
  for (const n of pendingNeeds(e)) {
    if (n.source === 'agency') continue;
    const inc = st.incidents[n.incId];
    const waited = st.time - n.at;
    const nag = inc.needNag?.[n.resId] ?? 0;
    const u = n.unitId ? st.units[n.unitId] : null;
    const due = [45, 95, 150][nag];
    if (due === undefined || waited < due) continue;
    (inc.needNag ??= {})[n.resId] = nag + 1;
    const lower = n.name.toLowerCase();
    if (nag === 0 && u) e.radio(u.spoken, `Dispatch, ${u.spoken}. Following up — is the ${lower} on the way?`, 'unit', u.id, inc.id);
    else if (nag === 1 && u) { e.radio(u.spoken, `Dispatch, ${u.spoken}! We still need the ${lower}. We can't do this without them.`, 'alert', u.id, inc.id); e.notify(`${u.callsign} is still waiting for the ${lower} — request it on the radio`, 'warn', inc.id); }
    else if (nag === 2) {
      // too late: the scene pays for it
      inc.threat = Math.min(95, inc.threat + 14);
      inc.work *= 1.12;
      for (const x of e.onScene(inc)) for (const p of e.crewOf(x)) { p.morale = Math.max(0, p.morale - 5); p.stress = Math.min(100, (p.stress ?? 0) + 4); }
      st.stats.needsMissed = (st.stats.needsMissed ?? 0) + 1;
      e.consequence(inc, `Crews asked for the ${lower} three times and it never came`);
      if (u) e.radio(u.spoken, `Dispatch, ${u.spoken}. Forget the ${lower} — we're doing what we can without them. It's getting worse.`, 'alert', u.id, inc.id);
    }
    tagOutside(e);
  }
}

/** tell a crew it is not coming */
export function declineNeed(e: GameEngine, incId: string, resId: string): { ok: boolean; reason?: string } {
  const inc = e.state.incidents[incId];
  if (!inc) return { ok: false, reason: 'Unknown incident' };
  (inc.declined ??= {})[resId] = e.state.time;
  const def = RESOURCE_BY_ID[resId];
  const u = e.onScene(inc).find((x) => !isAir(x));
  e.radio('DISPATCH', `${u ? `${u.spoken}, ` : ''}negative on the ${(def?.name ?? resId).toLowerCase()} — none available. Work with what you have.`, 'dispatch', u?.id, inc.id);
  if (u) e.radio(u.spoken, 'Copy. We\'ll make do.', 'unit', u.id, inc.id);
  if (inc.agency?.kind === resId) inc.agency.askedAt = null;
  inc.work *= 1.08;
  tagOutside(e, 2);
  return { ok: true };
}

/** put in a request on the outside line, read back over the radio */
export function radioRequest(e: GameEngine, incId: string, resId: string): { ok: boolean; reason?: string; eta?: number } {
  const st = e.state;
  const inc = st.incidents[incId];
  const def = RESOURCE_BY_ID[resId];
  if (!inc || !def) return { ok: false, reason: 'Pick an incident and what to send' };
  const before = st.radio.length;
  const r = e.requestResource(incId, resId);
  if (!r.ok) return r;
  // the crew who asked hears it is coming
  const asker = e.onScene(inc).find((x) => !isAir(x));
  const asked = inc.resAsked?.[resId] !== undefined || inc.specialistAsked?.[resId as 'eod'] !== undefined || inc.agency?.kind === resId;
  if (asker && asked) e.radio(asker.spoken, `Copy, ${def.name.toLowerCase()} rolling. Thanks, dispatch.`, 'unit', asker.id, inc.id);
  tagOutside(e, st.radio.length - before + 1);
  st.stats.radioRequests = (st.stats.radioRequests ?? 0) + 1;
  return r;
}

/** what you typed or said, as a request: "get a tow down here", "we need the K-9", "mutual aid engine" */
const WORDS: Array<[RegExp, string]> = [
  [/\b(tow|wrecker|recovery truck)\b/i, 'tow'], [/\b(power|electric(ity)?|utility)\s*(co|company|crew)?\b/i, 'power'], [/\bgas\s*(co|company|board|crew)\b/i, 'gas'],
  [/\banimal (control|warden)|dog warden\b/i, 'animal'], [/\b(public works|road crew|dpw|sandbags?|highways)\b/i, 'publicworks'], [/\b(transit|trains?|buses|rail control)\b/i, 'transit'],
  [/\b(red cross|shelter)\b/i, 'redcross'], [/\b(coroner|medical examiner|m\.?e\.?)\b/i, 'coroner'], [/\b(k-?9|canine|dog unit|dog team)\b/i, 'k9'],
  [/\bnegotiat/i, 'negotiator'], [/\b(regional hazmat|hazmat team|county hazmat)\b/i, 'regional_hazmat'], [/\b(usar|search and rescue|task force)\b/i, 'usar'],
  [/\bcoast ?guard\b/i, 'coast_guard'], [/\b(federal|fbi|hostage rescue|swat team)\b/i, 'federal'], [/\b(eod|bomb (squad|tech|techs|disposal)|national guard)\b/i, 'eod'],
];
const MUTUAL: Array<[RegExp, string]> = [[/\bparamedic|als\b/i, 'ma_als'], [/\bambulance|ems|medic\b/i, 'ma_ems'], [/\bengine|fire\b/i, 'ma_fire'], [/\brescue\b/i, 'ma_rescue'], [/\bpublic order|riot\b/i, 'ma_crowd'], [/\bpolice|patrol|cops?|officers?\b/i, 'ma_police']];
export function parseRequest(text: string): string | null {
  if (/\bmutual aid|from (the )?county|neighbou?ring\b/i.test(text)) { for (const [re, id] of MUTUAL) if (re.test(text)) return id; return null; }
  for (const [re, id] of WORDS) if (re.test(text)) return id;
  return null;
}
/** messages to and from outside agencies show on the outside line */
export function tagOutside(e: GameEngine, n = 1) {
  const r = e.state.radio;
  for (let i = Math.max(0, r.length - n); i < r.length; i++) r[i].chan = 'outside';
}
const OUTSIDE_FROM = /(tow|company|animal control|public works|transit|red cross|medical examiner|k-?9|negotiat|hazmat team|task force|coast guard|federal|eod|national guard|mutual aid|county)/i;
/** traffic that belongs on the outside line */
export const isOutside = (m: { chan?: string; from: string; text: string }) => m.chan === 'outside' || OUTSIDE_FROM.test(m.from) || /\b(mutual aid|is on the way, about|copies\. mobilising|requesting response to)\b/i.test(m.text);
