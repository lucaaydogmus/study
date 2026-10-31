// Talking to crews on the radio: type (or say) anything, the crew answers from what they can see,
// in their own voice. Each crew has a personality drawn from who is riding in it.
import type { GameEngine } from './engine';
import { matchCoverage, reqText } from './engine';
import { addressOf } from './city';
import { TEMPLATE_BY_ID } from './content/templates';
import { fill } from './dialogue';
import type { Incident, Unit } from './types';

export type CrewIntent = 'status' | 'eta' | 'see' | 'need' | 'expedite' | 'slow' | 'caution' | 'relay' | 'stage' | 'proceed' | 'return' | 'thanks' | 'suspect' | 'patient' | 'hurry_patient' | 'unknown';
export type Personality = 'veteran' | 'rookie' | 'joker' | 'formal';

export const CREW_CHIPS: Array<{ intent: CrewIntent; label: string; say: string }> = [
  { intent: 'status', label: 'Status?', say: 'What is your status?' },
  { intent: 'eta', label: 'ETA?', say: 'What is your ETA?' },
  { intent: 'see', label: 'What do you see?', say: 'What have you got on scene?' },
  { intent: 'need', label: 'Need anything?', say: 'Do you need anything else?' },
  { intent: 'expedite', label: 'Expedite', say: 'Expedite, lights and sirens.' },
  { intent: 'slow', label: 'Code 2', say: 'Downgrade to code two.' },
  { intent: 'caution', label: 'Use caution', say: 'Use caution, possible weapon on scene.' },
  { intent: 'relay', label: 'Caller update', say: 'Update from the caller —' },
  { intent: 'suspect', label: 'Suspect info', say: 'Suspect description to follow.' },
  { intent: 'patient', label: 'Patient condition?', say: 'How is the patient doing?' },
  { intent: 'stage', label: 'Stage', say: 'Stage short of the scene until PD secures it.' },
  { intent: 'return', label: 'Return to station', say: 'Return to quarters.' },
  { intent: 'thanks', label: 'Good work', say: 'Good work out there.' },
];

const RX: Array<[CrewIntent, RegExp]> = [
  ['thanks', /\b(thank|thanks|good (job|work)|nice (one|work)|well done|cheers|appreciate)/i],
  ['expedite', /\b(expedite|hurry|faster|step on it|code ?3|lights and sirens?|run hot|asap|quick(ly)?)\b/i],
  ['slow', /\b(code ?2|no lights|downgrade|slow down|routine|no rush|take it easy)\b/i],
  ['caution', /\b(caution|careful|armed|weapon|gun|knife|danger|unsafe|watch (out|yourselves))\b/i],
  ['suspect', /\b(suspect|description|looking for|wearing|male|female|vehicle description|plate)\b/i],
  ['stage', /\b(stage|hold back|wait (for|until)|don'?t go in|stand off)\b/i],
  ['proceed', /\b(proceed|go in|clear to enter|scene is safe|cancel staging)\b/i],
  ['return', /\b(return|go back|back to (the )?station|quarters|you'?re clear|clear the scene|in service)\b/i],
  ['patient', /\b(patient|vitals|breathing|conscious|pulse|how('?s| is) (he|she|the)|condition)\b/i],
  ['hurry_patient', /\b(load and go|transport now|get (him|her|them) to (the )?hospital)\b/i],
  ['relay', /\b(caller (says|said|reports|advises|states)|update|be advised|advis(e|ing)|fyi|heads up|info(rmation)?)\b/i],
  ['eta', /\b(eta|how long|how far|minutes out|when will|arriv)/i],
  ['see', /\b(what (do|can) you see|what('?ve| have) you got|size ?up|describe|scene|look like|situation)\b/i],
  ['need', /\b(need|anything else|require|request|backup|more units|resources)\b/i],
  ['status', /\b(status|update me|sitrep|how('?s| is) it going|where are you|you there|radio check|location)\b/i],
];
export function classifyCrew(text: string): CrewIntent {
  for (const [k, rx] of RX) if (rx.test(text)) return k;
  return 'unknown';
}

export function personalityOf(e: GameEngine, u: Unit): Personality {
  let h = 0; for (const ch of u.id) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  const crew = e.crewOf(u);
  const exp = crew.length ? crew.reduce((s, p) => s + p.experience, 0) / crew.length : 50;
  if (exp > 72) return h % 3 === 0 ? 'formal' : 'veteran';
  if (exp < 38) return 'rookie';
  return (['veteran', 'joker', 'formal', 'rookie'] as Personality[])[h % 4];
}
/** the crew member doing the talking */
export function speakerOf(e: GameEngine, u: Unit): string {
  const p = e.crewOf(u)[0];
  return p ? p.name.split(' ').slice(-1)[0] : u.spoken;
}

function flavour(p: Personality, line: string, pick: (n: number) => number): string {
  const r = pick(3);
  switch (p) {
    case 'veteran': return line.replace(/^(Copy|Okay|Roger)[,.]? /i, 'Copy. ');
    case 'formal': return line.replace(/^Copy[,.]? /i, '10-4. ').replace(/\bon scene\b/i, 'on scene, 10-97');
    case 'rookie': return r === 0 ? `Uh — ${line.charAt(0).toLowerCase()}${line.slice(1)}` : r === 1 ? `${line} Over.` : line;
    case 'joker': return r === 0 && !/hurt|dead|fire|shot|critical|weapon/i.test(line) ? `${line} ${['Someone owes me a coffee.', 'Living the dream.', 'Never a dull day.'][pick(3)]}` : line;
  }
}

/** what the dispatcher said, and what the crew says back */
export function talkToUnit(e: GameEngine, unitId: string, input: { intent?: CrewIntent; text?: string }): { ok: boolean; reply?: string; reason?: string; intent?: CrewIntent } {
  const st = e.state;
  const u = st.units[unitId];
  if (!u) return { ok: false, reason: 'No such unit' };
  const intent = input.intent ?? classifyCrew(input.text ?? '');
  const said = (input.text ?? CREW_CHIPS.find((c) => c.intent === intent)?.say ?? '').trim();
  const inc: Incident | undefined = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
  const live = !!inc && !['RESOLVED', 'CLOSED'].includes(inc.status);
  let n = 0;
  const pick = (k: number) => { n++; let h = Math.floor(st.time * 3) + n * 7919; for (const ch of u.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % k; };
  const P = personalityOf(e, u);
  const where = inc ? addressOf(e.city, inc.reportedNode ?? inc.nodeId) : '';
  const etaText = () => { const t = u.eta ?? 0; return t >= 60 ? `about ${Math.round(t / 60)} minute${Math.round(t / 60) === 1 ? '' : 's'} out` : `${Math.max(10, Math.round(t / 10) * 10)} seconds out`; };
  e.radio('DISPATCH', `${u.spoken}, ${said || '…'}`, 'dispatch', u.id, inc?.id);
  st.stats.crewTalks = (st.stats.crewTalks ?? 0) + 1;
  let reply = '';
  let askBack = false;
  switch (intent) {
    case 'status':
    case 'eta': {
      if (u.status === 'EN_ROUTE' || u.status === 'DISPATCHED') reply = u.status === 'DISPATCHED' ? `Copy, still getting rolling — we'll be ${etaText()}.` : `Copy, ${etaText()} from ${where}${u.staging ? ', staged and waiting for PD' : ''}.`;
      else if (u.status === 'ON_SCENE' && live) { const pct = Math.min(99, Math.round((inc!.workProgress / Math.max(1, inc!.work)) * 100)); reply = `On scene at ${where}, about ${pct} percent done${inc!.threat > 70 ? ' — it is getting away from us' : ''}.`; }
      else if (u.status === 'TRANSPORTING') reply = `Transporting one, ${etaText()} from the hospital.`;
      else if (u.status === 'AVAILABLE') reply = e.onPatrol(u) ? `In service, patrolling ${e.city.nodes[u.prevNode].addrStreet}. Available.` : 'Available and in quarters.';
      else if (u.status === 'RETURNING') reply = 'Clear and heading back to quarters, available if you need us.';
      else if (u.status === 'OUT_OF_SERVICE') reply = `We're out of service — ${u.note ?? 'not available'}.`;
      else reply = `${u.status.replace(/_/g, ' ').toLowerCase()}.`;
      if (intent === 'eta' && u.status === 'ON_SCENE') reply = `We're already on scene at ${where}.`;
      break;
    }
    case 'see': {
      if (!live) { reply = 'Nothing to report — we are not on a job.'; break; }
      const tpl = TEMPLATE_BY_ID[inc!.templateId];
      if (u.status !== 'ON_SCENE') { reply = `Still ${etaText()}. ${inc!.category === 'fire' && (u.eta ?? 99) < 70 ? 'We can see a column of smoke from here.' : 'Nothing in sight yet.'}`; break; }
      const parts = [inc!.twist && inc!.twistRevealed ? inc!.twist.scene : fill(tpl.scene, inc!.vars)];
      if (inc!.casualties) parts.push(`${inc!.casualties} casualt${inc!.casualties > 1 ? 'ies' : 'y'}.`);
      if (inc!.survival !== undefined) parts.push(inc!.survival > 66 ? 'Patient is holding.' : inc!.survival > 35 ? 'Patient is critical.' : 'Patient is in a very bad way.');
      if (inc!.threat > 70) parts.push('It is escalating.');
      reply = parts.join(' ');
      askBack = true;
      break;
    }
    case 'need': {
      if (!live || u.status !== 'ON_SCENE') { reply = u.status === 'EN_ROUTE' ? "Not yet — we'll let you know once we've eyes on." : "We're good, thanks."; break; }
      const cov = matchCoverage(inc!.requires, e.onScene(inc!));
      const extra: string[] = [];
      if (inc!.agency && !inc!.agency.here && inc!.agency.calledAt == null) extra.push(`a ${inc!.agency.kind === 'tow' ? 'tow truck' : inc!.agency.kind === 'gas' ? 'gas company crew' : inc!.agency.kind === 'power' ? 'power company crew' : 'animal control officer'}`);
      for (const k of Object.keys(inc!.specialistAsked ?? {})) if (!inc!.specialists?.[k as 'eod' | 'federal']) extra.push(k === 'eod' ? 'bomb techs' : 'the federal team');
      reply = cov.missing.length || extra.length ? `Affirmative — we need ${[cov.missing.length ? reqText(cov.missing) : '', ...extra].filter(Boolean).join(', and ')}.` : "We're good for resources, thanks. Will advise.";
      break;
    }
    case 'expedite': {
      if (!['EN_ROUTE', 'DISPATCHED'].includes(u.status)) { reply = "We're not en route to anything."; break; }
      if (u.code === 3 || u.code === undefined) reply = "Copy — we're already running hot, doing what we can.";
      else { e.setCode(u.id, 3); reply = 'Copy, upgrading — lights and sirens.'; }
      break;
    }
    case 'slow': {
      if (!['EN_ROUTE', 'DISPATCHED'].includes(u.status)) { reply = 'Copy.'; break; }
      e.setCode(u.id, 2); reply = 'Copy, downgrading to code two.';
      break;
    }
    case 'caution': {
      if (!live) { reply = 'Copy, noted.'; break; }
      const armed = !!inc!.truth.weapon && inc!.truth.weapon !== 'none';
      if (armed) inc!.weaponRelayed = true;
      reply = u.service === 'police' ? 'Copy, we\'ll approach with caution.' : 'Copy — we\'ll hold back until PD gives us the all clear.';
      if (u.service !== 'police' && ['EN_ROUTE', 'DISPATCHED'].includes(u.status) && !u.staging) e.setStaging(u.id, true);
      askBack = true;
      break;
    }
    case 'relay': {
      if (!live) { reply = 'Copy.'; break; }
      const r = e.briefUnits(inc!.id);
      reply = r.ok ? 'Copy all, thanks for the update.' : 'Copy — nothing new on our side.';
      break;
    }
    case 'suspect': {
      if (u.service !== 'police') { reply = "Copy, we'll keep an eye out, but that's one for PD."; break; }
      const desc = inc?.facts.find((f) => f.key === 'suspect_desc')?.value;
      reply = desc ? `Copy, looking for ${String(desc)}.` : 'Copy — go ahead with the description when you have it.';
      break;
    }
    case 'patient': {
      if (!live || u.service === 'police' && u.status !== 'ON_SCENE') { reply = u.service === 'police' ? "Medics will have a better picture, but we'll check." : 'No patient with us at the moment.'; break; }
      reply = inc!.survival === undefined ? (u.status === 'ON_SCENE' ? 'Patient is stable, conscious and talking.' : 'Not with the patient yet.') : inc!.survival > 66 ? 'Patient is stable for now, vitals improving.' : inc!.survival > 35 ? "Patient is critical but holding. We're working on them." : "Patient's in a really bad way — we need to move.";
      break;
    }
    case 'hurry_patient': {
      reply = inc?.needsTransport ? "Copy, packaging now — we'll be rolling in a minute." : "Copy, but they don't need transport.";
      break;
    }
    case 'stage': {
      if (u.service === 'police') { reply = "Copy, we'll hold the perimeter."; break; }
      reply = e.setStaging(u.id, true) ? 'Copy, staging a block back.' : "Copy — we're already committed.";
      st.radio.pop(); st.radio.pop();
      break;
    }
    case 'proceed': {
      reply = u.staging && e.setStaging(u.id, false) ? 'Copy, moving in.' : 'Copy, we are proceeding.';
      if (reply === 'Copy, moving in.') { st.radio.pop(); st.radio.pop(); }
      break;
    }
    case 'return': {
      if (live && ['EN_ROUTE', 'ON_SCENE', 'DISPATCHED'].includes(u.status)) { reply = `Negative — we're still committed at ${where}. Cancel us from the incident first.`; break; }
      reply = e.recall(u.id) ? 'Copy, returning to quarters.' : 'Copy, we are already available.';
      break;
    }
    case 'thanks': {
      if (st.time - (u.thankedAt ?? -999) > 60) { u.thankedAt = st.time; for (const p of e.crewOf(u)) p.morale = Math.min(100, p.morale + 4); }
      reply = ['Appreciate it, dispatch.', "Thanks — couldn't do it without you.", 'Copy that, thanks.', 'Cheers, dispatch. Good teamwork.'][pick(4)];
      break;
    }
    default:
      reply = ['Say again, dispatch? You broke up.', "Dispatch, you're unreadable, say again?", 'Repeat your last, dispatch.'][pick(3)];
  }
  reply = flavour(P, reply, pick);
  e.radio(u.spoken, reply, 'unit', u.id, inc?.id);
  // crews ask back sometimes, especially the less experienced
  if (askBack && live && (P === 'rookie' || pick(3) === 0)) e.crewAsks(u.id);
  return { ok: true, reply, intent };
}
