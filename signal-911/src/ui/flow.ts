// The dispatcher's flow for one incident: where it is in answer → locate → classify → send → on scene,
// and the single most useful thing to do next. Used by the incident header, the incident list and the
// "next thing" hotkey so the game always tells you what it is waiting on.
import { matchCoverage, reqText, type GameEngine } from '../sim/engine';
import { TEMPLATE_BY_ID } from '../sim/content/templates';
import { pendingNeeds } from '../sim/radioreq';
import type { Incident } from '../sim/types';

export type Step = 'location' | 'classify' | 'dispatch' | 'enroute' | 'scene' | 'done';
export interface NextAction { step: Step; short: string; text: string; tone: 'red' | 'amber' | 'blue' | 'green' | 'neutral'; act?: 'call' | 'location' | 'classify' | 'dispatch' | 'radio' }
export const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'location', label: 'Location' }, { id: 'classify', label: 'Type' }, { id: 'dispatch', label: 'Units' }, { id: 'scene', label: 'On scene' },
];
const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s) % 60)).padStart(2, '0')}`;

export function nextAction(e: GameEngine, inc: Incident): NextAction {
  const st = e.state;
  if (['RESOLVED', 'CLOSED'].includes(inc.status)) return { step: 'done', short: 'closed', text: 'Closed.', tone: 'neutral' };
  const call = Object.values(st.calls).filter((c) => c.incidentId === inc.id).sort((a, b) => b.ringStart - a.ringStart)[0];
  const tpl = TEMPLATE_BY_ID[inc.templateId];
  if (call?.state === 'ringing') return { step: 'location', short: 'ringing', text: 'The caller is still ringing — answer it.', tone: 'red', act: 'call' };
  const need = pendingNeeds(e, inc.id)[0];
  if (inc.reportedNode === null) {
    const heard = call?.heard.filter((h) => h.reliability !== 'contradicted').length ?? 0;
    return heard
      ? { step: 'location', short: 'set location', text: `Set the location — ${heard} place${heard > 1 ? 's' : ''} heard on the call.`, tone: 'amber', act: 'location' }
      : { step: 'location', short: 'where?', text: call && call.state === 'active' ? 'Ask the caller where they are.' : 'No location yet — call back, trace, or pick it on the map.', tone: 'red', act: call && call.state === 'active' ? 'call' : 'location' };
  }
  if (tpl?.nonEmergency || (inc.requires.length === 0 && inc.truth.false_alarm === true && !inc.assignedUnits.length)) return { step: 'classify', short: 'not 911?', text: 'Doesn’t sound like an emergency — send them to the non-emergency line, or check it out.', tone: 'blue', act: 'call' };
  const assigned = inc.assignedUnits.map((id) => st.units[id]).filter(Boolean);
  if (!assigned.length) {
    if (!inc.classification) return { step: 'classify', short: 'classify', text: 'Classify the call so you know what to send.', tone: 'amber', act: 'classify' };
    return { step: 'dispatch', short: 'send units', text: `Send units — ${inc.knownReqs.length ? reqText(inc.knownReqs) : 'pick what the call needs'}.`, tone: 'red', act: 'dispatch' };
  }
  if (need) return { step: 'scene', short: 'crew asking', text: `${need.unitId ? st.units[need.unitId]?.callsign : 'Crews'} need the ${need.name.toLowerCase()} — answer on the radio.`, tone: 'amber', act: 'radio' };
  const here = e.onScene(inc);
  if (!here.length) {
    const etas = assigned.map((u) => (u.status === 'DISPATCHED' ? u.timer : 0) + (u.eta ?? 0)).filter((x) => x > 0);
    const first = etas.length ? Math.min(...etas) : 0;
    return { step: 'enroute', short: first ? `ETA ${fmt(first)}` : 'rolling', text: first ? `Units en route — first one in about ${fmt(first)}. Keep the caller talking.` : 'Units are rolling.', tone: 'blue' };
  }
  const cov = matchCoverage(inc.requires, here.concat(assigned));
  if (cov.missing.length && inc.sceneReported) return { step: 'scene', short: 'needs more', text: `Crews on scene need ${reqText(cov.missing)}.`, tone: 'amber', act: 'dispatch' };
  const pct = Math.round(Math.min(100, (inc.workProgress / Math.max(1, inc.work)) * 100));
  return { step: 'scene', short: `working ${pct}%`, text: `Crews working on scene — ${pct}% done.`, tone: 'green' };
}

/** how far along the four steps an incident is (for the stepper) */
export function stepState(e: GameEngine, inc: Incident, s: Step): 'done' | 'now' | 'todo' {
  const a = nextAction(e, inc);
  const order: Step[] = ['location', 'classify', 'dispatch', 'enroute', 'scene', 'done'];
  const cur = order.indexOf(a.step === 'enroute' ? 'scene' : a.step);
  const idx = order.indexOf(s);
  if (s === 'classify' && inc.classification) return 'done';
  if (s === 'dispatch' && inc.assignedUnits.length) return 'done';
  if (s === 'location' && inc.reportedNode !== null) return 'done';
  if (s === 'scene' && a.step === 'scene' && e.onScene(inc).length) return 'now';
  return idx < cur ? 'done' : idx === cur ? 'now' : 'todo';
}

/** the most urgent thing on the board, for the N key */
export function mostUrgent(e: GameEngine): { kind: 'call' | 'incident'; id: string } | null {
  const st = e.state;
  const ringing = Object.values(st.calls).filter((c) => c.state === 'ringing').sort((a, b) => a.ringStart - b.ringStart)[0];
  if (ringing) return { kind: 'call', id: ringing.id };
  const open = Object.values(st.incidents).filter((i) => !i.hidden && !['RESOLVED', 'CLOSED'].includes(i.status));
  const score = (i: Incident) => { const a = nextAction(e, i); return (a.tone === 'red' ? 300 : a.tone === 'amber' ? 200 : a.tone === 'blue' ? 50 : 0) + i.severity * 20 + i.threat; };
  const top = open.sort((a, b) => score(b) - score(a))[0];
  return top ? { kind: 'incident', id: top.id } : null;
}
